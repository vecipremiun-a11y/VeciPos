// Lotes + control de inventario + reconciliación server-side (Fase 1 · Paso 29).
// Lógica portada tal cual de useStore; company_id forzado en toda query.
// Los audit_logs y stock_adjustments se firman con el usuario de la sesión.

const nowIso = () => new Date().toISOString();
const userName = (session) => session?.username || 'Desconocido';

// ── Lotes: reporte + stats + write-off ───────────────────────────

async function lotsReport(turso, companyId, session, { productLimit = 20, productOffset = 0, searchTerm = '' }) {
    let prodSql, prodArgs;
    if (String(searchTerm).trim()) {
        const like = `%${String(searchTerm).trim()}%`;
        prodSql = `SELECT pl.product_id, MIN(pl.expiry_date) as min_expiry
                   FROM product_lots pl JOIN products p ON pl.product_id = p.id
                   WHERE pl.company_id = ? AND pl.quantity > 0 AND pl.expiry_date IS NOT NULL
                   AND (p.name LIKE ? OR p.sku LIKE ?)
                   GROUP BY pl.product_id ORDER BY min_expiry ASC LIMIT ? OFFSET ?`;
        prodArgs = [companyId, like, like, productLimit, productOffset];
    } else {
        prodSql = `SELECT product_id, MIN(expiry_date) as min_expiry
                   FROM product_lots WHERE company_id = ? AND quantity > 0 AND expiry_date IS NOT NULL
                   GROUP BY product_id ORDER BY min_expiry ASC LIMIT ? OFFSET ?`;
        prodArgs = [companyId, productLimit, productOffset];
    }
    const prodRes = await turso.execute({ sql: prodSql, args: prodArgs });
    const productIds = prodRes.rows.map(r => r.product_id);
    if (productIds.length === 0) return { success: true, products: [], hasMore: false };

    const ph = productIds.map(() => '?').join(',');
    const res = await turso.execute({
        sql: `SELECT pl.*, p.name as p_name, p.sku as p_sku, p.image as p_image,
                p.stock as p_stock, p.unit as p_unit, p.price as p_price,
                pu.invoice_number as invoice_number, pu.date as purchase_date
              FROM product_lots pl JOIN products p ON pl.product_id = p.id
              LEFT JOIN purchases pu ON pl.purchase_id = pu.id
              WHERE pl.company_id = ? AND pl.quantity > 0 AND pl.product_id IN (${ph})
              ORDER BY pl.product_id, (pl.expiry_date IS NULL) ASC, pl.expiry_date ASC`,
        args: [companyId, ...productIds],
    });
    const lots = res.rows.map(row => ({
        id: row.id, product_id: row.product_id, batch_number: row.batch_number,
        expiry_date: row.expiry_date, quantity: row.quantity,
        initial_quantity: row.initial_quantity || row.quantity, cost: row.cost,
        supplier_name: row.supplier_name, created_at: row.created_at, purchase_id: row.purchase_id,
        invoice_number: row.invoice_number || null, purchase_date: row.purchase_date || null,
        product_name: row.p_name, product_sku: row.p_sku, product_image: row.p_image,
        product_stock: row.p_stock, product_unit: row.p_unit, product_price: row.p_price,
    }));
    return { success: true, products: lots, hasMore: productIds.length === productLimit };
}

async function lotsGlobalStats(turso, companyId, session, { today, nextMonth }) {
    const res = await turso.execute({
        sql: `SELECT COUNT(*) as total_lots, COUNT(DISTINCT product_id) as total_products,
                SUM(CASE WHEN expiry_date < ? THEN 1 ELSE 0 END) as expired_lots,
                SUM(CASE WHEN expiry_date >= ? AND expiry_date <= ? THEN 1 ELSE 0 END) as near_expiry_lots,
                SUM(CASE WHEN expiry_date < ? THEN (cost * quantity) ELSE 0 END) as expiry_value_lost
              FROM product_lots WHERE company_id = ? AND quantity > 0`,
        args: [today, today, nextMonth, today, companyId],
    });
    const row = res.rows[0];
    const total = row.total_lots || 0, expired = row.expired_lots || 0, near = row.near_expiry_lots || 0;
    return {
        success: true,
        stats: {
            validLots: total - expired - near, nearExpiryLots: near, expiredLots: expired,
            totalLots: total, totalItems: row.total_products || 0, expiryValueLost: row.expiry_value_lost || 0,
        },
    };
}

async function lotWriteOff(turso, companyId, session, { lot, notes = '', reason = 'expired' }) {
    const now = nowIso();
    const totalLoss = reason === 'expired' ? (lot.cost || 0) * (lot.quantity || 0) : 0;
    await turso.batch([
        {
            sql: `INSERT INTO inventory_losses (company_id, lot_id, product_id, product_name, product_sku, batch_number, expiry_date, quantity, cost_per_unit, total_loss, reason, notes, user_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [companyId, lot.id, lot.product_id, lot.product_name || '', lot.product_sku || '',
                lot.batch_number || '', lot.expiry_date || null, lot.quantity, lot.cost || 0, totalLoss,
                reason, notes, session?.uid ?? null, now],
        },
        { sql: 'UPDATE products SET stock = ROUND(stock - ?, 3) WHERE id = ? AND company_id = ?', args: [lot.quantity, lot.product_id, companyId] },
        { sql: 'UPDATE product_lots SET quantity = 0 WHERE id = ? AND company_id = ?', args: [lot.id, companyId] },
        {
            sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'WRITE_OFF', 'LOT', ?, ?)",
            args: [companyId, session?.uid ?? null, JSON.stringify({ lot_id: lot.id, product: lot.product_name, quantity: lot.quantity, loss: totalLoss, reason }), now],
        },
    ]);
    return { success: true, totalLoss };
}

async function lotWriteOffAll(turso, companyId, session, { lots, notes = '', reason = 'expired' }) {
    const now = nowIso();
    const queries = [];
    let totalLossSum = 0, totalQtySum = 0;
    const deductions = new Map();
    for (const lot of lots) {
        const totalLoss = reason === 'expired' ? (lot.cost || 0) * (lot.quantity || 0) : 0;
        totalLossSum += totalLoss;
        totalQtySum += lot.quantity;
        deductions.set(lot.product_id, (deductions.get(lot.product_id) || 0) + lot.quantity);
        queries.push({
            sql: `INSERT INTO inventory_losses (company_id, lot_id, product_id, product_name, product_sku, batch_number, expiry_date, quantity, cost_per_unit, total_loss, reason, notes, user_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [companyId, lot.id, lot.product_id, lot.product_name || '', lot.product_sku || '',
                lot.batch_number || '', lot.expiry_date || null, lot.quantity, lot.cost || 0, totalLoss,
                reason, notes, session?.uid ?? null, now],
        });
        queries.push({ sql: 'UPDATE product_lots SET quantity = 0 WHERE id = ? AND company_id = ?', args: [lot.id, companyId] });
    }
    for (const [productId, qty] of deductions) {
        queries.push({ sql: 'UPDATE products SET stock = ROUND(stock - ?, 3) WHERE id = ? AND company_id = ?', args: [qty, productId, companyId] });
    }
    queries.push({
        sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'WRITE_OFF_BATCH', 'LOT', ?, ?)",
        args: [companyId, session?.uid ?? null, JSON.stringify({ lots_count: lots.length, total_qty: totalQtySum, total_loss: totalLossSum }), now],
    });
    for (let i = 0; i < queries.length; i += 50) await turso.batch(queries.slice(i, i + 50));
    return { success: true, totalLoss: totalLossSum, lotsProcessed: lots.length, deductions: [...deductions] };
}

async function lossesList(turso, companyId, session, { limit = 50, offset = 0 }) {
    const res = await turso.execute({
        sql: `SELECT il.*, u.name as user_name FROM inventory_losses il
              LEFT JOIN users u ON il.user_id = u.id WHERE il.company_id = ?
              ORDER BY il.created_at DESC LIMIT ? OFFSET ?`,
        args: [companyId, limit, offset],
    });
    return { success: true, rows: res.rows };
}

async function lossesStats(turso, companyId) {
    const res = await turso.execute({
        sql: `SELECT COUNT(*) as total_records, SUM(quantity) as total_units,
                SUM(CASE WHEN reason = 'expired' THEN total_loss ELSE 0 END) as total_value,
                SUM(CASE WHEN reason = 'supplier_exchange' THEN quantity ELSE 0 END) as total_exchanged_units,
                SUM(CASE WHEN reason = 'supplier_exchange' THEN 1 ELSE 0 END) as total_exchanges,
                COUNT(DISTINCT product_id) as total_products
              FROM inventory_losses WHERE company_id = ?`,
        args: [companyId],
    });
    return { success: true, stats: res.rows[0] || { total_records: 0, total_units: 0, total_value: 0, total_products: 0, total_exchanged_units: 0, total_exchanges: 0 } };
}

// ── Control de inventario (toma física) ──────────────────────────

async function controlCreate(turso, companyId, session, { name, type, category }) {
    const now = nowIso();
    const existing = await turso.execute({
        sql: "SELECT id, user_name, started_at FROM inventory_controls WHERE company_id = ? AND user_id = ? AND status = 'in_progress' LIMIT 1",
        args: [companyId, session?.uid ?? null],
    });
    if (existing.rows.length > 0) {
        const e = existing.rows[0];
        return { success: false, error: `Ya tienes un control en progreso desde ${e.started_at}`, existing: e };
    }
    let totalProducts = 0;
    if (type === 'complete') {
        totalProducts = (await turso.execute({ sql: 'SELECT COUNT(*) as c FROM products WHERE company_id = ?', args: [companyId] })).rows[0]?.c || 0;
    } else if (type === 'category') {
        totalProducts = (await turso.execute({ sql: 'SELECT COUNT(*) as c FROM products WHERE company_id = ? AND category = ?', args: [companyId, category] })).rows[0]?.c || 0;
    } else if (type === 'supplier') {
        totalProducts = (await turso.execute({ sql: 'SELECT COUNT(*) as c FROM products WHERE company_id = ? AND supplier = ?', args: [companyId, category] })).rows[0]?.c || 0;
    }
    const res = await turso.execute({
        sql: `INSERT INTO inventory_controls (company_id, user_id, user_name, name, type, category, status, total_products, counted_products, started_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, 0, ?, ?) RETURNING id`,
        args: [companyId, session?.uid ?? null, userName(session), name, type, category || null, totalProducts, now, now],
    });
    const id = Number(res.rows[0]?.id);
    return { success: true, control: { id, company_id: companyId, user_id: session?.uid, user_name: userName(session), name, type, category, status: 'in_progress', total_products: totalProducts, counted_products: 0, started_at: now } };
}

async function controlActive(turso, companyId, session) {
    const res = await turso.execute({
        sql: "SELECT * FROM inventory_controls WHERE company_id = ? AND user_id = ? AND status = 'in_progress' LIMIT 1",
        args: [companyId, session?.uid ?? null],
    });
    return { success: true, control: res.rows[0] || null };
}

async function controlProducts(turso, companyId, session, { controlId, limit = 50, offset = 0, search = '', filter = 'all', type = 'complete', category = null }) {
    let where = 'WHERE p.company_id = ?';
    const args = [companyId];
    if (type === 'category' && category) { where += ' AND p.category = ?'; args.push(category); }
    if (type === 'supplier' && category) { where += ' AND p.supplier = ?'; args.push(category); }
    if (search) { where += ' AND (p.name LIKE ? OR p.sku LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
    let having = '';
    if (filter === 'pending') having = 'HAVING ci.id IS NULL';
    else if (filter === 'counted') having = 'HAVING ci.id IS NOT NULL';
    const res = await turso.execute({
        sql: `SELECT p.id, p.name, p.sku, p.stock, p.cost, p.category, p.image, p.unit,
                ci.id as item_id, ci.system_stock, ci.counted_stock, ci.difference, ci.counted_at
              FROM products p
              LEFT JOIN inventory_control_items ci ON ci.product_id = p.id AND ci.control_id = ?
              ${where} GROUP BY p.id ${having}
              ORDER BY ci.id IS NOT NULL ASC, p.name ASC LIMIT ? OFFSET ?`,
        args: [controlId, ...args, limit, offset],
    });
    return { success: true, rows: res.rows };
}

async function controlSaveItem(turso, companyId, session, { controlId, productId, countedStock }) {
    const now = nowIso();
    const prodRes = await turso.execute({
        sql: 'SELECT id, name, sku, stock, cost FROM products WHERE id = ? AND company_id = ?',
        args: [productId, companyId],
    });
    if (prodRes.rows.length === 0) return { success: false, error: 'Producto no encontrado' };
    const product = prodRes.rows[0];
    const existingItem = await turso.execute({
        sql: 'SELECT id, system_stock FROM inventory_control_items WHERE control_id = ? AND product_id = ?',
        args: [controlId, productId],
    });
    const roundedCount = Math.round(countedStock * 1000) / 1000;

    if (existingItem.rows.length > 0) {
        const systemStock = existingItem.rows[0].system_stock;
        const difference = Math.round((roundedCount - systemStock) * 1000) / 1000;
        await turso.execute({
            sql: 'UPDATE inventory_control_items SET counted_stock = ?, difference = ?, updated_at = ? WHERE control_id = ? AND product_id = ?',
            args: [roundedCount, difference, now, controlId, productId],
        });
        await turso.execute({ sql: 'UPDATE products SET stock = ROUND(?, 3) WHERE id = ? AND company_id = ?', args: [roundedCount, productId, companyId] });
        if (Math.abs(roundedCount - (parseFloat(product.stock) || 0)) >= 0.001) {
            await turso.execute({
                sql: 'INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                args: [companyId, productId, session?.uid ?? null, userName(session), product.stock, roundedCount, Math.round((roundedCount - product.stock) * 1000) / 1000, 'control_inventario', now],
            });
        }
        await turso.execute({
            sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'INVENTORY_CONTROL', 'PRODUCT', ?, ?)",
            args: [companyId, session?.uid ?? null, JSON.stringify({ controlId, productId, productName: product.name, action: 're-edit', systemStock, oldCounted: product.stock, newCounted: roundedCount, difference }), now],
        });
        return { success: true, item: { product_id: productId, product_name: product.name, product_sku: product.sku, system_stock: systemStock, counted_stock: roundedCount, difference, cost: product.cost || 0, reEdit: true } };
    }

    const systemStock = product.stock;
    const difference = Math.round((roundedCount - systemStock) * 1000) / 1000;
    await turso.execute({
        sql: 'INSERT INTO inventory_control_items (control_id, product_id, product_name, product_sku, system_stock, counted_stock, difference, cost, counted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [controlId, productId, product.name, product.sku || '', systemStock, roundedCount, difference, product.cost || 0, now],
    });
    await turso.execute({ sql: 'UPDATE products SET stock = ROUND(?, 3) WHERE id = ? AND company_id = ?', args: [roundedCount, productId, companyId] });
    if (Math.abs(roundedCount - systemStock) >= 0.001) {
        await turso.execute({
            sql: 'INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [companyId, productId, session?.uid ?? null, userName(session), systemStock, roundedCount, difference, 'control_inventario', now],
        });
    }
    await turso.execute({ sql: 'UPDATE inventory_controls SET counted_products = counted_products + 1 WHERE id = ? AND company_id = ?', args: [controlId, companyId] });
    await turso.execute({
        sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'INVENTORY_CONTROL', 'PRODUCT', ?, ?)",
        args: [companyId, session?.uid ?? null, JSON.stringify({ controlId, productId, productName: product.name, action: 'count', systemStock, countedStock: roundedCount, difference }), now],
    });
    return { success: true, item: { product_id: productId, product_name: product.name, product_sku: product.sku, system_stock: systemStock, counted_stock: roundedCount, difference, cost: product.cost || 0, reEdit: false } };
}

async function controlRemoveItem(turso, companyId, session, { controlId, productId }) {
    const now = nowIso();
    const item = await turso.execute({
        sql: 'SELECT * FROM inventory_control_items WHERE control_id = ? AND product_id = ?',
        args: [controlId, productId],
    });
    if (item.rows.length === 0) return { success: false, error: 'Item no encontrado' };
    const row = item.rows[0];
    await turso.execute({ sql: 'UPDATE products SET stock = ROUND(?, 3) WHERE id = ? AND company_id = ?', args: [row.system_stock, productId, companyId] });
    await turso.execute({ sql: 'DELETE FROM inventory_control_items WHERE control_id = ? AND product_id = ?', args: [controlId, productId] });
    await turso.execute({ sql: 'UPDATE inventory_controls SET counted_products = MAX(counted_products - 1, 0) WHERE id = ? AND company_id = ?', args: [controlId, companyId] });
    await turso.execute({
        sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'INVENTORY_CONTROL', 'PRODUCT', ?, ?)",
        args: [companyId, session?.uid ?? null, JSON.stringify({ controlId, productId, productName: row.product_name, action: 'remove', revertedTo: row.system_stock }), now],
    });
    return { success: true };
}

async function controlComplete(turso, companyId, session, { controlId }) {
    await turso.execute({
        sql: "UPDATE inventory_controls SET status = 'completed', completed_at = ? WHERE id = ? AND company_id = ?",
        args: [nowIso(), controlId, companyId],
    });
    return { success: true };
}

async function controlCancel(turso, companyId, session, { controlId }) {
    await turso.execute({
        sql: "UPDATE inventory_controls SET status = 'cancelled', completed_at = ? WHERE id = ? AND company_id = ?",
        args: [nowIso(), controlId, companyId],
    });
    return { success: true };
}

async function controlReport(turso, companyId, session, { controlId }) {
    // Verificar que el control sea de esta empresa
    const own = await turso.execute({ sql: 'SELECT 1 FROM inventory_controls WHERE id = ? AND company_id = ? LIMIT 1', args: [controlId, companyId] });
    if (own.rows.length === 0) return { success: true, items: [], stats: { totalCounted: 0, withDifference: 0, missing: 0, surplus: 0, matched: 0, missingValue: 0, surplusValue: 0, totalDifferenceValue: 0 } };
    const itemsRes = await turso.execute({ sql: 'SELECT * FROM inventory_control_items WHERE control_id = ? ORDER BY counted_at ASC', args: [controlId] });
    const items = itemsRes.rows;
    const withDifference = items.filter(i => Math.abs(i.difference) > 0.001);
    const missing = items.filter(i => i.difference < -0.001);
    const surplus = items.filter(i => i.difference > 0.001);
    const matched = items.filter(i => Math.abs(i.difference) <= 0.001);
    return {
        success: true, items,
        stats: {
            totalCounted: items.length, withDifference: withDifference.length,
            missing: missing.length, surplus: surplus.length, matched: matched.length,
            missingValue: Math.round(missing.reduce((s, i) => s + Math.abs(i.difference) * (i.cost || 0), 0) * 100) / 100,
            surplusValue: Math.round(surplus.reduce((s, i) => s + i.difference * (i.cost || 0), 0) * 100) / 100,
            totalDifferenceValue: Math.round(withDifference.reduce((s, i) => s + Math.abs(i.difference) * (i.cost || 0), 0) * 100) / 100,
        },
    };
}

async function controlHistory(turso, companyId, session, { limit = 20, offset = 0 }) {
    const res = await turso.execute({
        sql: "SELECT * FROM inventory_controls WHERE company_id = ? AND status IN ('completed', 'cancelled') ORDER BY completed_at DESC LIMIT ? OFFSET ?",
        args: [companyId, limit, offset],
    });
    return { success: true, rows: res.rows };
}

// ── Reconciliación stock vs lotes ────────────────────────────────

async function reconciliationData(turso, companyId, session, { limit = 30, offset = 0, search = '' }) {
    const baseWhere = search ? 'WHERE p.company_id = ? AND (p.name LIKE ? OR p.sku LIKE ?)' : 'WHERE p.company_id = ?';
    const baseArgs = search ? [companyId, `%${search}%`, `%${search}%`] : [companyId];

    let stats = null;
    if (offset === 0 && !search) {
        const statsRes = await turso.execute({
            sql: `SELECT COUNT(*) as total,
                    SUM(CASE WHEN diff > 0 THEN 1 ELSE 0 END) as stock_greater,
                    SUM(CASE WHEN diff < 0 THEN 1 ELSE 0 END) as lots_greater,
                    SUM(CASE WHEN sub.stock < 0 THEN 1 ELSE 0 END) as negative_stock
                  FROM (
                    SELECT p.stock, (p.stock - COALESCE(SUM(pl.quantity), 0)) as diff
                    FROM products p
                    LEFT JOIN product_lots pl ON pl.product_id = p.id AND pl.company_id = p.company_id AND pl.quantity > 0
                    WHERE p.company_id = ? GROUP BY p.id
                    HAVING ABS(p.stock - COALESCE(SUM(pl.quantity), 0)) > 0.01 OR (p.stock < 0)
                  ) sub`,
            args: [companyId],
        });
        const s = statsRes.rows[0];
        stats = { total: s.total || 0, stockGreater: s.stock_greater || 0, lotsGreater: s.lots_greater || 0, negativeStock: s.negative_stock || 0 };
    }
    const res = await turso.execute({
        sql: `SELECT p.id, p.name, p.sku, p.stock, p.image, p.unit, p.cost,
                COALESCE(SUM(pl.quantity), 0) as lots_total, COUNT(pl.id) as lots_count
              FROM products p
              LEFT JOIN product_lots pl ON pl.product_id = p.id AND pl.company_id = p.company_id AND pl.quantity > 0
              ${baseWhere} GROUP BY p.id
              HAVING ABS(p.stock - COALESCE(SUM(pl.quantity), 0)) > 0.01 OR (p.stock < 0)
              ORDER BY ABS(p.stock - COALESCE(SUM(pl.quantity), 0)) DESC LIMIT ? OFFSET ?`,
        args: [...baseArgs, limit, offset],
    });
    const products = res.rows.map(r => ({
        id: r.id, name: r.name, sku: r.sku, image: r.image, unit: r.unit, cost: r.cost,
        stock: r.stock, lots_total: r.lots_total, lots_count: r.lots_count,
        difference: Math.round((r.stock - r.lots_total) * 1000) / 1000,
    }));
    return { success: true, products, hasMore: products.length === limit, stats };
}

async function reconciliationLots(turso, companyId, session, { productId }) {
    const res = await turso.execute({
        sql: `SELECT pl.*, pu.invoice_number FROM product_lots pl
              LEFT JOIN purchases pu ON pl.purchase_id = pu.id
              WHERE pl.product_id = ? AND pl.company_id = ?
              ORDER BY pl.quantity > 0 DESC, pl.expiry_date ASC`,
        args: [productId, companyId],
    });
    return { success: true, rows: res.rows };
}

async function reconcileProduct(turso, companyId, session, { productId, mode, notes = '' }) {
    const now = nowIso();
    if (mode === 'adjust_stock') {
        const lotsTotal = (await turso.execute({ sql: 'SELECT COALESCE(SUM(quantity), 0) as total FROM product_lots WHERE product_id = ? AND company_id = ? AND quantity > 0', args: [productId, companyId] })).rows[0]?.total || 0;
        const prod = (await turso.execute({ sql: 'SELECT stock, name FROM products WHERE id = ? AND company_id = ?', args: [productId, companyId] })).rows[0];
        if (!prod) return { success: false, error: 'Producto no encontrado' };
        const oldStock = prod.stock || 0;
        await turso.execute({ sql: 'UPDATE products SET stock = ? WHERE id = ? AND company_id = ?', args: [lotsTotal, productId, companyId] });
        if (Math.abs(lotsTotal - oldStock) >= 0.001) {
            await turso.execute({
                sql: 'INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                args: [companyId, productId, session?.uid ?? null, userName(session), oldStock, lotsTotal, Math.round((lotsTotal - oldStock) * 1000) / 1000, 'reconciliacion', now],
            });
        }
        await turso.execute({
            sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'RECONCILIATION', 'INVENTORY', ?, ?)",
            args: [companyId, session?.uid ?? null, JSON.stringify({ productId, productName: prod.name, action: 'adjust_stock', oldStock, newStock: lotsTotal, notes }), now],
        });
        return { success: true, message: `Stock ajustado de ${oldStock} a ${lotsTotal}`, productId, newStock: lotsTotal };
    }
    if (mode === 'adjust_lots') {
        const prod = (await turso.execute({ sql: 'SELECT stock, name FROM products WHERE id = ? AND company_id = ?', args: [productId, companyId] })).rows[0];
        if (!prod) return { success: false, error: 'Producto no encontrado' };
        const currentStock = prod.stock || 0;
        const today = now.slice(0, 10);
        const expiredRes = await turso.execute({
            sql: 'SELECT id FROM product_lots WHERE product_id = ? AND company_id = ? AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date < ?',
            args: [productId, companyId, today],
        });
        for (const lot of expiredRes.rows) {
            await turso.execute({ sql: 'UPDATE product_lots SET quantity = 0 WHERE id = ? AND company_id = ?', args: [lot.id, companyId] });
        }
        const lotsRes = await turso.execute({
            sql: 'SELECT id, quantity FROM product_lots WHERE product_id = ? AND company_id = ? AND quantity > 0 AND (expiry_date IS NULL OR expiry_date >= ?) ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC',
            args: [productId, companyId, today],
        });
        let remaining = Math.max(currentStock, 0);
        const updates = [];
        for (const lot of lotsRes.rows) {
            if (remaining <= 0) updates.push({ id: lot.id, newQty: 0 });
            else { const assign = Math.min(lot.quantity, remaining); updates.push({ id: lot.id, newQty: assign }); remaining -= assign; }
        }
        for (const u of updates) {
            await turso.execute({ sql: 'UPDATE product_lots SET quantity = ? WHERE id = ? AND company_id = ?', args: [u.newQty, u.id, companyId] });
        }
        await turso.execute({
            sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'RECONCILIATION', 'INVENTORY', ?, ?)",
            args: [companyId, session?.uid ?? null, JSON.stringify({ productId, productName: prod.name, action: 'adjust_lots', stock: currentStock, lotsAdjusted: updates.length, notes }), now],
        });
        return { success: true, message: `${updates.length} lotes ajustados al stock (${currentStock})` };
    }
    return { success: false, error: 'Acción no válida' };
}

async function productProfitReport(turso, companyId, session, { startDate, endDate }) {
    const result = await turso.execute({
        sql: `SELECT pdp.day, pdp.product_id, pdp.total_quantity, pdp.total_revenue, pdp.total_cost, pdp.total_profit,
                p.name as product_name, p.sku as product_sku
              FROM product_daily_profit pdp JOIN products p ON pdp.product_id = p.id
              WHERE pdp.company_id = ? AND pdp.day >= ? AND pdp.day <= ?
              ORDER BY pdp.day DESC, pdp.total_revenue DESC`,
        args: [companyId, startDate, endDate],
    });
    return { success: true, rows: result.rows };
}

export const inventoryActions = {
    lotsReport, lotsGlobalStats, lotWriteOff, lotWriteOffAll, lossesList, lossesStats,
    controlCreate, controlActive, controlProducts, controlSaveItem, controlRemoveItem,
    controlComplete, controlCancel, controlReport, controlHistory,
    reconciliationData, reconciliationLots, reconcileProduct, productProfitReport,
};
