// Compras y proveedores server-side (Fase 1 · Paso 14).
// Lógica portada tal cual de useStore: compra = INSERT + stock/lotes + audit
// + espejo purchase_items (mismo módulo compartido) + resumen por proveedor.

import { mirrorPurchaseItems } from '../../src/lib/itemNormalization.js';

const nowIso = () => new Date().toISOString();

async function auditLog(turso, companyId, session, action, entity, details) {
    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, action, entity, JSON.stringify(details), nowIso()],
    });
}

// ── Proveedores ──────────────────────────────────────────────────

async function supplierCreate(turso, companyId, session, { supplier }) {
    if (!supplier?.name) return { success: false, error: 'Falta el nombre del proveedor' };
    const result = await turso.execute({
        sql: `INSERT INTO suppliers (name, phone, email, seller_name, order_days, delivery_days, status, company_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [supplier.name, supplier.phone || '', supplier.email || '', supplier.seller_name || '',
            supplier.order_days || '', supplier.delivery_days || '', supplier.status || 'active',
            companyId, nowIso()],
    });
    await auditLog(turso, companyId, session, 'CREATE', 'SUPPLIER', { name: supplier.name });
    return { success: true, supplier: result.rows[0] };
}

async function supplierUpdate(turso, companyId, session, { id, supplier }) {
    if (!id || !supplier) return { success: false, error: 'Faltan datos' };

    const prev = await turso.execute({
        sql: 'SELECT name FROM suppliers WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (prev.rows.length === 0) return { success: false, error: 'Supplier not found' };
    const oldName = prev.rows[0].name;
    const nameChanged = oldName !== supplier.name;

    const queries = [{
        sql: 'UPDATE suppliers SET name = ?, phone = ?, email = ?, seller_name = ?, order_days = ?, delivery_days = ?, status = ? WHERE id = ? AND company_id = ?',
        args: [supplier.name, supplier.phone || '', supplier.email || '', supplier.seller_name || '',
            supplier.order_days || '', supplier.delivery_days || '', supplier.status || 'active', id, companyId],
    }];
    if (nameChanged) {
        queries.push({
            sql: 'UPDATE products SET supplier = ? WHERE supplier = ? AND company_id = ?',
            args: [supplier.name, oldName, companyId],
        });
    }
    queries.push({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'UPDATE', 'SUPPLIER', JSON.stringify({ id, name: supplier.name }), nowIso()],
    });
    await turso.batch(queries);
    return { success: true, nameChanged, oldName };
}

async function supplierDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM suppliers WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'SUPPLIER', { id });
    return { success: true };
}

// ── Órdenes a proveedor ──────────────────────────────────────────

async function supplierOrdersFetch(turso, companyId, session, { filters = {} }) {
    let sql = 'SELECT * FROM supplier_orders WHERE company_id = ?';
    const args = [companyId];
    if (filters.supplier_id) { sql += ' AND supplier_id = ?'; args.push(filters.supplier_id); }
    if (filters.status) { sql += ' AND status = ?'; args.push(filters.status); }
    sql += ' ORDER BY created_at DESC';
    const result = await turso.execute({ sql, args });
    return { success: true, rows: result.rows };
}

async function supplierOrderCreate(turso, companyId, session, { orderData }) {
    const result = await turso.execute({
        sql: `INSERT INTO supplier_orders (
                company_id, user_id, supplier_id, supplier_name, seller_name,
                total_amount, items, status, created_at, expected_delivery_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING *`,
        args: [companyId, session?.uid ?? null, orderData.supplier_id, orderData.supplier_name,
            orderData.seller_name || null, orderData.total_amount, JSON.stringify(orderData.items),
            nowIso(), orderData.expected_delivery_date || null],
    });
    return { success: true, order: result.rows[0] };
}

// Cambia el estado de un pedido a proveedor. Lo usa "Pasar a Compra": una vez
// guardada la compra, el pedido queda 'received' y deja de figurar como
// pendiente —si no, seguía apareciendo por cobrar y se corría el riesgo de
// cargarlo dos veces—.
async function supplierOrderSetStatus(turso, companyId, session, { id, status }) {
    if (!id || !status) return { success: false, error: 'Faltan datos' };
    if (!['pending', 'received', 'cancelled'].includes(status)) {
        return { success: false, error: 'Estado inválido' };
    }
    const r = await turso.execute({
        sql: 'UPDATE supplier_orders SET status = ? WHERE id = ? AND company_id = ?',
        args: [status, id, companyId],
    });
    if (!r.rowsAffected) return { success: false, error: 'Pedido no encontrado' };
    return { success: true };
}

// Agrega productos a un pedido YA creado (se olvidó alguno al armarlo).
//
// La fusión se hace acá y no en el navegador: los items viven en una columna
// JSON, así que leer-modificar-escribir desde el cliente pisaría lo que otro
// haya agregado mientras tanto. El total se recalcula del lado del servidor por
// lo mismo.
async function supplierOrderAddItems(turso, companyId, session, { id, items }) {
    if (!id || !Array.isArray(items) || !items.length) return { success: false, error: 'Faltan datos' };

    const r = await turso.execute({
        sql: 'SELECT items, status FROM supplier_orders WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    const row = r.rows[0];
    if (!row) return { success: false, error: 'Pedido no encontrado' };
    // Un pedido recibido ya tiene su compra cargada: sumarle productos ahora
    // dejaría el pedido y la compra diciendo cosas distintas.
    if (row.status === 'received') return { success: false, error: 'El pedido ya fue recibido' };

    let actuales = [];
    try { actuales = JSON.parse(row.items) || []; } catch { actuales = []; }
    if (!Array.isArray(actuales)) actuales = [];

    const fusionados = [...actuales];
    for (const nuevo of items) {
        const bruto = Number(nuevo.costWithTax) || Number(nuevo.cost) || 0;
        const linea = {
            id: nuevo.id,
            name: nuevo.name,
            sku: nuevo.sku || '',
            cost: Number(nuevo.cost) || 0,
            costWithTax: bruto,
            quantity: Number(nuevo.quantity) || 0,
            taxRate: Number(nuevo.taxRate) || 0,
        };
        linea.total = bruto * linea.quantity;

        // Si el producto ya estaba en el pedido se suma la cantidad, en vez de
        // dejar dos líneas del mismo producto.
        const idx = fusionados.findIndex(i => String(i.id) === String(linea.id));
        if (idx >= 0) {
            const cantidad = (Number(fusionados[idx].quantity) || 0) + linea.quantity;
            fusionados[idx] = { ...linea, quantity: cantidad, total: bruto * cantidad };
        } else {
            fusionados.push(linea);
        }
    }

    const total = fusionados.reduce((s, i) => s + (Number(i.total) || 0), 0);
    await turso.execute({
        sql: 'UPDATE supplier_orders SET items = ?, total_amount = ? WHERE id = ? AND company_id = ?',
        args: [JSON.stringify(fusionados), total, id, companyId],
    });
    return { success: true, items: fusionados, total_amount: total };
}

async function supplierOrderDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM supplier_orders WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'SUPPLIER_ORDER', { id });
    return { success: true };
}

// ── Compras ──────────────────────────────────────────────────────

async function purchaseCreate(turso, companyId, session, { purchase }) {
    if (!purchase?.items?.length) return { success: false, error: 'Compra sin items' };

    // 1. Insert compra (primero, para enlazar lotes por purchase_id)
    const purchaseResult = await turso.execute({
        sql: `INSERT INTO purchases (supplier_id, supplier_name, invoice_number, date, total, items, status, user_id,
                is_credit, credit_days, expiry_date, deposit, payment_method, company_id, payment_observation, payment_document)
              VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [
            purchase.supplierId, purchase.supplierName, purchase.invoiceNumber || '', purchase.date,
            purchase.total, JSON.stringify(purchase.items), session?.uid ?? null,
            purchase.isCredit ? 1 : 0, purchase.creditDays || null, purchase.expiryDate || null,
            purchase.deposit || 0, purchase.paymentMethod || 'Efectivo', companyId,
            purchase.observation || null, purchase.document || null,
        ],
    });
    const rawId = purchaseResult.rows[0]?.id || purchaseResult.lastInsertRowid;
    const purchaseId = typeof rawId === 'bigint' ? Number(rawId) : rawId;

    // 2. Batch: stock/costo/precio + lote por item + audit
    const queries = [];
    purchase.items.forEach(item => {
        queries.push({
            sql: 'UPDATE products SET stock = ROUND(stock + ?, 3), cost = ?, price = ?, sku = ?, tax_rate = ?, supplier = ? WHERE id = ? AND company_id = ?',
            args: [item.quantity, item.cost, item.price, item.sku, item.tax || 0, purchase.supplierName, item.id, companyId],
        });
        queries.push({
            sql: `INSERT INTO product_lots (product_id, batch_number, expiry_date, quantity, initial_quantity, cost,
                    supplier_name, created_at, status, company_id, purchase_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            args: [item.id, item.batchNumber || '', item.expiryDate || null, item.quantity, item.quantity,
                item.cost, purchase.supplierName, nowIso(), companyId, purchaseId],
        });
    });
    queries.push({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'CREATE', 'PURCHASE', JSON.stringify({ total: purchase.total }), nowIso()],
    });
    await turso.batch(queries);

    // 3. Espejo purchase_items (post-commit; nunca hace fallar la compra)
    try {
        await mirrorPurchaseItems(turso, {
            purchaseId, companyId, purchaseDate: purchase.date, items: purchase.items, source: 'live',
        });
    } catch (err) {
        console.error('[fase4] mirrorPurchaseItems:', err?.message || err);
    }

    // 4. Resumen por proveedor (portado de updateSupplierPurchaseSummary)
    try {
        const purchaseDate = new Date(purchase.date || nowIso());
        const dateStr = purchaseDate.toLocaleDateString('en-CA');
        const supplierId = purchase.supplierId;
        const summaryId = `supp_buy_${companyId}_${supplierId}_${dateStr}`;
        const totalItems = purchase.items.reduce((sum, item) => sum + Number(item.quantity), 0);

        const existing = await turso.execute({
            sql: 'SELECT * FROM supplier_purchase_summary WHERE company_id = ? AND supplier_id = ? AND date = ?',
            args: [companyId, supplierId, dateStr],
        });
        if (existing.rows.length === 0) {
            await turso.execute({
                sql: `INSERT INTO supplier_purchase_summary
                      (id, company_id, supplier_id, supplier_name, date, total_purchases, total_amount, total_items, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
                args: [summaryId, companyId, supplierId, purchase.supplierName, dateStr, purchase.total, totalItems, nowIso(), nowIso()],
            });
        } else {
            await turso.execute({
                sql: `UPDATE supplier_purchase_summary SET
                        total_purchases = total_purchases + 1,
                        total_amount = total_amount + ?,
                        total_items = total_items + ?,
                        updated_at = ?
                      WHERE id = ?`,
                args: [purchase.total, totalItems, nowIso(), summaryId],
            });
        }
    } catch (e) {
        console.error('Error updating supplier summary:', e);
    }

    return { success: true, purchaseId };
}

async function purchasesFetch(turso, companyId, session, { offset = 0, limit = 50 }) {
    const result = await turso.execute({
        sql: 'SELECT * FROM purchases WHERE company_id = ? ORDER BY date DESC LIMIT ? OFFSET ?',
        args: [companyId, limit, offset],
    });
    return { success: true, rows: result.rows };
}

async function purchaseDetails(turso, companyId, session, { id }) {
    const result = await turso.execute({
        sql: 'SELECT * FROM purchases WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true, purchase: result.rows[0] || null };
}

async function purchaseDelete(turso, companyId, session, { id }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM purchases WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'PURCHASE', { id });
    return { success: true };
}

async function supplierPurchaseSummaryGet(turso, companyId, session, { startDate, endDate }) {
    const result = await turso.execute({
        sql: `SELECT supplier_id, supplier_name,
                SUM(total_purchases) as total_purchases,
                SUM(total_amount) as total_amount,
                SUM(total_items) as total_items
              FROM supplier_purchase_summary
              WHERE company_id = ? AND date BETWEEN ? AND ?
              GROUP BY supplier_id, supplier_name
              ORDER BY total_amount DESC`,
        args: [companyId, startDate, endDate],
    });
    return { success: true, suppliers: result.rows };
}

// Pagos de facturas de compra (Paso 21) — FIX cross-tenant: antes el UPDATE
// iba solo por id; ahora siempre filtra por company_id.
async function invoicePayFull(turso, companyId, session, { ids, paymentDate }) {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
    if (!list.length) return { success: false, error: 'Sin facturas' };
    const ph = list.map(() => '?').join(',');
    await turso.execute({
        sql: `UPDATE purchases SET amount_paid = total, status = 'paid', payment_date = ? WHERE id IN (${ph}) AND company_id = ?`,
        args: [paymentDate, ...list, companyId],
    });
    await auditLog(turso, companyId, session, 'UPDATE', 'INVOICE_PAY', { ids: list, full: true });
    return { success: true };
}

async function invoicePayPartial(turso, companyId, session, { id, newPaid, isPaidFull, paymentDate }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'UPDATE purchases SET amount_paid = ?, status = ?, payment_date = ? WHERE id = ? AND company_id = ?',
        args: [newPaid, isPaidFull ? 'paid' : 'partial', paymentDate, id, companyId],
    });
    await auditLog(turso, companyId, session, 'UPDATE', 'INVOICE_PAY', { id, newPaid });
    return { success: true };
}

export const purchaseActions = {
    invoicePayFull,
    invoicePayPartial,
    supplierCreate,
    supplierUpdate,
    supplierDelete,
    supplierOrdersFetch,
    supplierOrderCreate,
    supplierOrderSetStatus,
    supplierOrderAddItems,
    supplierOrderDelete,
    purchaseCreate,
    purchasesFetch,
    purchaseDetails,
    purchaseDelete,
    supplierPurchaseSummaryGet,
};
