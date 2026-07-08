// Combos / packs server-side (Fase 1 · Paso 25). Todas las queries con
// company_id forzado; los items del combo van en batch.

const nowIso = () => new Date().toISOString();

async function combosFetch(turso, companyId, session, { search }) {
    let sql = 'SELECT * FROM product_combos WHERE company_id = ?';
    const args = [companyId];
    if (search) { sql += ' AND (name LIKE ? OR sku LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY created_at DESC';
    const result = await turso.execute({ sql, args });

    const combos = [];
    for (const combo of result.rows) {
        const itemsRes = await turso.execute({
            sql: 'SELECT ci.*, p.stock as current_stock FROM product_combo_items ci LEFT JOIN products p ON p.id = ci.product_id WHERE ci.combo_id = ?',
            args: [combo.id],
        });
        combos.push({ ...combo, items: itemsRes.rows });
    }
    return { success: true, combos };
}

async function combosForPos(turso, companyId, session, { today }) {
    const result = await turso.execute({
        sql: 'SELECT * FROM product_combos WHERE company_id = ? AND is_active = 1',
        args: [companyId],
    });

    const combosForPOS = [];
    for (const combo of result.rows) {
        if (combo.has_dates) {
            if (combo.start_date && today < combo.start_date) continue;
            if (combo.end_date && today > combo.end_date) continue;
        }
        const itemsRes = await turso.execute({
            sql: 'SELECT ci.*, p.stock as current_stock FROM product_combo_items ci LEFT JOIN products p ON p.id = ci.product_id WHERE ci.combo_id = ?',
            args: [combo.id],
        });

        let availableStock = Infinity;
        const comboItems = [];
        for (const item of itemsRes.rows) {
            const qty = parseFloat(item.quantity) || 1;
            const stock = parseFloat(item.current_stock) || 0;
            availableStock = Math.min(availableStock, Math.floor(stock / qty));
            comboItems.push({
                product_id: item.product_id, product_name: item.product_name,
                product_sku: item.product_sku, quantity: qty, cost: parseFloat(item.cost) || 0,
            });
        }
        if (availableStock === Infinity) availableStock = 0;

        combosForPOS.push({
            id: `combo_${combo.id}`, name: combo.name, price: parseFloat(combo.price),
            cost: parseFloat(combo.cost) || 0, stock: availableStock, sku: combo.sku || '',
            image: combo.image || null, tax_rate: parseFloat(combo.tax_rate) || 0, unit: 'Und',
            category: 'Combos', is_combo: true, combo_id: combo.id, combo_items: comboItems,
            is_offer: false, offer_price: null, price_ranges: [], scale_group_id: null,
            original_price: parseFloat(combo.price),
        });
    }
    return { success: true, combos: combosForPOS };
}

function comboItemQueries(comboId, items) {
    return (items || []).map(item => ({
        sql: 'INSERT INTO product_combo_items (combo_id, product_id, product_name, product_sku, quantity, cost) VALUES (?, ?, ?, ?, ?, ?)',
        args: [comboId, item.product_id, item.product_name, item.product_sku || null,
            parseFloat(item.quantity) || 1, parseFloat(item.cost) || 0],
    }));
}

async function comboCreate(turso, companyId, session, { data }) {
    const now = nowIso();
    const totalCost = (data.items || []).reduce((s, it) => s + (parseFloat(it.cost) || 0) * (parseFloat(it.quantity) || 1), 0);
    const result = await turso.execute({
        sql: `INSERT INTO product_combos (company_id, name, sku, price, cost, image, description, is_active, has_dates, start_date, end_date, tax_rate, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [companyId, data.name, data.sku || null, parseFloat(data.price),
            Math.round(totalCost * 100) / 100, data.image || null, data.description || null,
            data.has_dates ? 1 : 0, data.start_date || null, data.end_date || null,
            parseFloat(data.tax_rate) || 0, now, now],
    });
    const rawId = result.rows[0]?.id ?? result.lastInsertRowid;
    const comboId = typeof rawId === 'bigint' ? Number(rawId) : rawId;
    const iq = comboItemQueries(comboId, data.items);
    if (iq.length) await turso.batch(iq);
    return { success: true, comboId };
}

async function comboUpdate(turso, companyId, session, { comboId, data }) {
    // Verificar pertenencia + actualizar en un solo UPDATE con company_id
    const totalCost = (data.items || []).reduce((s, it) => s + (parseFloat(it.cost) || 0) * (parseFloat(it.quantity) || 1), 0);
    const upd = await turso.execute({
        sql: 'UPDATE product_combos SET name=?, sku=?, price=?, cost=?, image=?, description=?, has_dates=?, start_date=?, end_date=?, tax_rate=?, updated_at=? WHERE id=? AND company_id=?',
        args: [data.name, data.sku || null, parseFloat(data.price), Math.round(totalCost * 100) / 100,
            data.image || null, data.description || null, data.has_dates ? 1 : 0,
            data.start_date || null, data.end_date || null, parseFloat(data.tax_rate) || 0,
            nowIso(), comboId, companyId],
    });
    if (Number(upd.rowsAffected ?? 0) === 0) return { success: false, error: 'Combo no encontrado' };

    await turso.execute({ sql: 'DELETE FROM product_combo_items WHERE combo_id = ?', args: [comboId] });
    const iq = comboItemQueries(comboId, data.items);
    if (iq.length) await turso.batch(iq);
    return { success: true };
}

async function comboDelete(turso, companyId, session, { comboId }) {
    await turso.execute({ sql: 'DELETE FROM product_combos WHERE id = ? AND company_id = ?', args: [comboId, companyId] });
    return { success: true };
}

async function comboToggle(turso, companyId, session, { comboId }) {
    await turso.execute({
        sql: 'UPDATE product_combos SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ? AND company_id = ?',
        args: [nowIso(), comboId, companyId],
    });
    return { success: true };
}

export const comboActions = { combosFetch, combosForPos, comboCreate, comboUpdate, comboDelete, comboToggle };
