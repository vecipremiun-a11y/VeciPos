// Ventas suspendidas + preventas + devoluciones server-side (Fase 1 · Paso 30).
// company_id forzado en toda query. processReturn: reverso PARCIAL de agregaciones
// (product_daily_profit + product_movement_stats) corregido — el store llamaba
// funciones ya eliminadas en Paso 11 (bug latente).

const nowIso = () => new Date().toISOString();

// ── Ventas suspendidas ───────────────────────────────────────────

async function suspendedCount(turso, companyId) {
    const r = await turso.execute({
        sql: "SELECT COUNT(*) as count FROM suspended_sales WHERE company_id = ? AND status = 'suspended'",
        args: [companyId],
    });
    return { success: true, count: r.rows[0]?.count || 0 };
}

async function suspendCreate(turso, companyId, session, { cart, clientData, subtotal, tax, total, itemsCount, now }) {
    await turso.execute({
        sql: `INSERT INTO suspended_sales (company_id, user_id, items, client_data, subtotal, tax, total, items_count, suspended_at, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?)`,
        args: [companyId, session?.uid ?? null, JSON.stringify(cart), clientData ? JSON.stringify(clientData) : null,
            subtotal, tax, total, itemsCount, now, now],
    });
    return { success: true };
}

async function suspendedList(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT s.id, s.total, s.items_count, s.suspended_at, u.name as user_name
              FROM suspended_sales s LEFT JOIN users u ON s.user_id = u.id
              WHERE s.company_id = ? AND s.status = 'suspended'
              ORDER BY s.suspended_at DESC LIMIT 50`,
        args: [companyId],
    });
    return { success: true, rows: r.rows };
}

async function suspendRecover(turso, companyId, session, { saleId }) {
    const r = await turso.execute({
        sql: "SELECT items, client_data FROM suspended_sales WHERE id = ? AND company_id = ? AND status = 'suspended'",
        args: [saleId, companyId],
    });
    if (r.rows.length === 0) return { success: false, error: 'Esta venta ya fue recuperada o no existe' };
    await turso.execute({
        sql: "UPDATE suspended_sales SET status = 'recovered', recovered_at = ?, recovered_by = ? WHERE id = ? AND company_id = ?",
        args: [nowIso(), session?.uid ?? null, saleId, companyId],
    });
    const sale = r.rows[0];
    return {
        success: true,
        items: JSON.parse(sale.items),
        clientData: sale.client_data ? JSON.parse(sale.client_data) : null,
    };
}

async function suspendDelete(turso, companyId, session, { saleId }) {
    await turso.execute({
        sql: "UPDATE suspended_sales SET status = 'deleted' WHERE id = ? AND company_id = ?",
        args: [saleId, companyId],
    });
    return { success: true };
}

// ── Preventas ────────────────────────────────────────────────────

async function ensurePreventasTable(turso) {
    await turso.execute(`CREATE TABLE IF NOT EXISTS preventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, code TEXT NOT NULL,
        items TEXT NOT NULL, client_data TEXT, total REAL NOT NULL DEFAULT 0,
        created_by INTEGER, created_by_name TEXT, status TEXT NOT NULL DEFAULT 'pending',
        completed_by INTEGER, completed_at TEXT, sale_id INTEGER, created_at TEXT NOT NULL,
        UNIQUE(company_id, code))`).catch(() => {});
}

async function preventaCreate(turso, companyId, session, { items, clientData, total, code, now }) {
    await ensurePreventasTable(turso);
    await turso.execute({
        sql: `INSERT INTO preventas (company_id, code, items, client_data, total, created_by, created_by_name, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        args: [companyId, code, JSON.stringify(items), clientData ? JSON.stringify(clientData) : null,
            total, session?.uid ?? null, session?.username || '', now],
    });
    return { success: true, code };
}

async function preventasPending(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT id, code, items, client_data, total, created_by_name, created_at
              FROM preventas WHERE company_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 100`,
        args: [companyId],
    });
    return { success: true, rows: r.rows };
}

async function preventaByCode(turso, companyId, session, { code }) {
    const r = await turso.execute({
        sql: `SELECT id, code, items, client_data, total, created_by_name, created_at
              FROM preventas WHERE company_id = ? AND code = ? AND status = 'pending'`,
        args: [companyId, code],
    });
    return { success: true, preventa: r.rows[0] || null };
}

async function preventaComplete(turso, companyId, session, { code, saleId, now }) {
    const r = await turso.execute({
        sql: "UPDATE preventas SET status = 'completed', completed_by = ?, completed_at = ?, sale_id = ? WHERE company_id = ? AND code = ? AND status = 'pending'",
        args: [session?.uid ?? null, now, saleId, companyId, code],
    });
    return { success: true, affected: Number(r?.rowsAffected ?? 0) };
}

async function preventaCancel(turso, companyId, session, { code }) {
    const r = await turso.execute({
        sql: "UPDATE preventas SET status = 'cancelled' WHERE company_id = ? AND code = ? AND status = 'pending'",
        args: [companyId, code],
    });
    return { success: true, affected: Number(r?.rowsAffected ?? 0) };
}

async function preventasCount(turso, companyId) {
    try {
        const r = await turso.execute({
            sql: "SELECT COUNT(*) as c FROM preventas WHERE company_id = ? AND status = 'pending'",
            args: [companyId],
        });
        return { success: true, count: Number(r.rows[0].c) };
    } catch {
        return { success: true, count: 0 };
    }
}

// ── Devoluciones ─────────────────────────────────────────────────

async function ensureReturnsTable(turso) {
    await turso.execute(`CREATE TABLE IF NOT EXISTS sale_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, sale_id INTEGER NOT NULL,
        user_id INTEGER, reason TEXT NOT NULL, items TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL
    )`).catch(() => {});
}

// Reverso parcial de agregaciones por producto (product_daily_profit + movement_stats)
function reverseAggQueries(companyId, items, dateStr) {
    const q = [];
    for (const item of items) {
        const revenue = (item.price || 0) * (item.quantity || 0);
        q.push({
            sql: `UPDATE product_daily_profit SET
                    total_quantity = MAX(0, total_quantity - ?),
                    total_revenue = MAX(0, total_revenue - ?),
                    total_cost = MAX(0, total_cost - ?),
                    total_profit = MAX(0, total_profit - ?),
                    updated_at = CURRENT_TIMESTAMP
                  WHERE company_id = ? AND product_id = ? AND day = ?`,
            args: [item.quantity, revenue, (item.cost || 0) * (item.quantity || 0),
                (item.price - (item.cost || 0)) * (item.quantity || 0), companyId, item.id, dateStr],
        });
        q.push({
            sql: `UPDATE product_movement_stats SET
                    total_sold_all_time = MAX(0, total_sold_all_time - ?),
                    total_revenue_all_time = MAX(0, total_revenue_all_time - ?),
                    sold_last_7_days = MAX(0, sold_last_7_days - ?),
                    revenue_last_7_days = MAX(0, revenue_last_7_days - ?),
                    sold_last_30_days = MAX(0, sold_last_30_days - ?),
                    revenue_last_30_days = MAX(0, revenue_last_30_days - ?),
                    updated_at = ?
                  WHERE id = ?`,
            args: [item.quantity, revenue, item.quantity, revenue, item.quantity, revenue, nowIso(), `stats_${companyId}_${item.id}`],
        });
    }
    return q;
}

async function saleReturnCommit(turso, companyId, session, { saleId, returnItems, reason, saleDay, registerId }) {
    await ensureReturnsTable(turso);

    // Venta original (de esta empresa)
    const saleRes = await turso.execute({
        sql: 'SELECT items FROM sales WHERE id = ? AND company_id = ?',
        args: [saleId, companyId],
    });
    if (saleRes.rows.length === 0) return { success: false, error: 'Venta no encontrada' };
    let items = [];
    try { items = JSON.parse(saleRes.rows[0].items || '[]'); } catch { items = []; }

    // Devoluciones previas para validar cantidades
    const prevRes = await turso.execute({
        sql: 'SELECT items FROM sale_returns WHERE sale_id = ? AND company_id = ?',
        args: [saleId, companyId],
    });
    const alreadyReturned = {};
    for (const row of prevRes.rows) {
        let ri = []; try { ri = JSON.parse(row.items || '[]'); } catch { ri = []; }
        for (const it of ri) alreadyReturned[it.id] = (alreadyReturned[it.id] || 0) + it.quantity;
    }

    const validated = [];
    for (const ri of returnItems) {
        const orig = items.find(i => i.id === ri.id);
        if (!orig) continue;
        const maxReturnable = orig.quantity - (alreadyReturned[ri.id] || 0);
        if (ri.quantity <= 0 || ri.quantity > maxReturnable) {
            return { success: false, error: `Cantidad inválida para ${orig.name}. Máximo devolvible: ${maxReturnable}` };
        }
        validated.push({ id: ri.id, name: orig.name, sku: orig.sku || '', quantity: ri.quantity, price: orig.price, cost: orig.cost || 0, unit: orig.unit || 'Und' });
    }
    if (validated.length === 0) return { success: false, error: 'No hay productos válidos para devolver' };

    const returnTotal = validated.reduce((s, i) => s + (i.price * i.quantity), 0);
    const now = nowIso();

    const queries = [
        { sql: 'INSERT INTO sale_returns (company_id, sale_id, user_id, reason, items, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [companyId, saleId, session?.uid ?? null, reason, JSON.stringify(validated), returnTotal, now] },
        { sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'RETURN', 'SALE', ?, ?)", args: [companyId, session?.uid ?? null, JSON.stringify({ saleId, returnTotal, items: validated.map(i => ({ id: i.id, name: i.name, qty: i.quantity })), reason }), now] },
    ];
    for (const item of validated) {
        queries.push({ sql: 'UPDATE products SET stock = ROUND(stock + ?, 3) WHERE id = ? AND company_id = ?', args: [item.quantity, item.id, companyId] });
        queries.push({
            sql: `UPDATE product_lots SET quantity = quantity + ?
                   WHERE id = (SELECT id FROM product_lots WHERE product_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 1)`,
            args: [item.quantity, item.id, companyId],
        });
    }
    queries.push({
        sql: "UPDATE sales_daily_summary SET total_sales = MAX(0, total_sales - ?), updated_at = datetime('now') WHERE day = ? AND company_id = ?",
        args: [returnTotal, saleDay, companyId],
    });
    if (registerId) {
        queries.push({ sql: 'INSERT INTO cash_movements (register_id, type, amount, reason, date, company_id) VALUES (?, ?, ?, ?, ?, ?)', args: [registerId, 'OUT', returnTotal, `Devolución Venta #${saleId}: ${reason}`, now, companyId] });
    }
    // Reverso parcial de agregaciones (mismo batch)
    queries.push(...reverseAggQueries(companyId, validated, saleDay));

    for (let i = 0; i < queries.length; i += 50) await turso.batch(queries.slice(i, i + 50));

    // Stock fresco para sync tienda
    const productIds = validated.map(i => i.id).filter(Boolean);
    let products = [];
    if (productIds.length > 0) {
        const ph = productIds.map(() => '?').join(',');
        products = (await turso.execute({ sql: `SELECT id, sku, stock, unit FROM products WHERE id IN (${ph}) AND company_id = ?`, args: [...productIds, companyId] })).rows;
    }
    return { success: true, returnTotal, validated, products };
}

async function saleReturnsList(turso, companyId, session, { saleId }) {
    await ensureReturnsTable(turso);
    const r = await turso.execute({
        sql: 'SELECT id, sale_id, user_id, reason, items, total, created_at FROM sale_returns WHERE sale_id = ? AND company_id = ? ORDER BY created_at DESC',
        args: [saleId, companyId],
    });
    return { success: true, rows: r.rows };
}

export const saleAdjustActions = {
    suspendedCount, suspendCreate, suspendedList, suspendRecover, suspendDelete,
    preventaCreate, preventasPending, preventaByCode, preventaComplete, preventaCancel, preventasCount,
    saleReturnCommit, saleReturnsList,
};
