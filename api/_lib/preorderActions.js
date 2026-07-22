// Encargos (preorders) server-side (Fase 1 · Paso 15).
// Lógica portada tal cual. FIX cross-tenant: las operaciones por preorderId
// ahora verifican que el encargo pertenezca a la empresa de la sesión
// (antes UPDATE/SELECT iban solo por id).

import { broadcastPreorderEvent } from '../events/preorders-stream.js';

const nowIso = () => new Date().toISOString();

// order_kind separa encargos ('encargo') de pedidos de la tienda web ('store').
// La columna se agrega perezosamente (una vez por proceso) para que reportes y
// listados funcionen también en bases que aún no reciben pedidos web.
let _orderKindEnsured = false;
async function ensureOrderKindColumn(turso) {
    if (_orderKindEnsured) return;
    try {
        await turso.execute("ALTER TABLE preorders ADD COLUMN order_kind TEXT DEFAULT 'encargo'");
    } catch { /* la columna ya existe */ }
    _orderKindEnsured = true;
}

// Filtro para que los reportes/listados de ENCARGOS excluyan pedidos de tienda.
const ONLY_ENCARGO = (alias = '') => ` AND COALESCE(${alias}order_kind, 'encargo') = 'encargo'`;

// Guard: el encargo debe ser de la empresa. Devuelve la fila o null.
async function ownPreorder(turso, companyId, preorderId, cols = '*') {
    const r = await turso.execute({
        sql: `SELECT ${cols} FROM preorders WHERE id = ? AND company_id = ?`,
        args: [preorderId, companyId],
    });
    return r.rows[0] || null;
}

async function preorderCreate(turso, companyId, session, { preorderData, registerId }) {
    if (!preorderData?.items?.length) return { success: false, error: 'Encargo sin items' };
    const estimatedTotal = preorderData.total_amount;

    const result = await turso.execute({
        sql: `INSERT INTO preorders
              (company_id, client_id, client_name, client_phone, due_date, due_time,
               status, total_amount, estimated_total, deposit_amount, remaining_amount,
               delivery_type, delivery_address, notes, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            companyId, preorderData.client_id || null, preorderData.client_name || '',
            preorderData.client_phone || '', preorderData.due_date, preorderData.due_time,
            estimatedTotal, estimatedTotal, preorderData.deposit_amount || 0,
            estimatedTotal - (preorderData.deposit_amount || 0),
            preorderData.delivery_type || 'pickup', preorderData.delivery_address || '',
            preorderData.notes || '', session?.username || '', nowIso(),
        ],
    });
    const preorderId = Number(result.lastInsertRowid);

    // Items (batch atómico, mismos campos de panadería)
    const itemQueries = preorderData.items.map(item => ({
        sql: `INSERT INTO preorder_items
              (preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
               billing_unit, price_per_kg, gram_per_unit, estimated_total)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [preorderId, item.product_id, item.product_name, item.qty, item.unit || 'Und',
            item.unit_price, item.line_total, item.note || '', item.billing_unit || 'unit',
            item.price_per_kg || 0, item.gram_per_unit || 0, item.line_total],
    }));
    if (itemQueries.length) await turso.batch(itemQueries);

    // Abono inicial (el movimiento de caja en efectivo lo registra el cliente vía cashMovementAdd)
    if (preorderData.deposit_amount > 0) {
        const depositMethod = preorderData.deposit_method || 'Efectivo';
        const tId = depositMethod === 'Tarjeta' ? (preorderData.deposit_terminal_id || null) : null;
        const baId = depositMethod === 'Transferencia' ? (preorderData.deposit_bank_account_id || null) : null;
        const authCode = depositMethod === 'Tarjeta' ? (preorderData.deposit_auth_code || null) : null;
        await turso.execute({
            sql: `INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id, auth_code)
                  VALUES (?, ?, ?, 'deposit', ?, ?, ?, ?)`,
            args: [preorderId, preorderData.deposit_amount, depositMethod, registerId || null, tId, baId, authCode],
        });
    }

    // Señal en vivo (Pusher) para que los badges se actualicen en todos los
    // dispositivos sin recargar. Usamos 'order.updated' (refresca contadores,
    // sin el toast de "nuevo pedido web" que es exclusivo del canal web).
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: preorderId, kind: 'encargo' });

    return { success: true, preorderId };
}

async function preordersFetch(turso, companyId, session, { filters = {} }) {
    // kind: 'encargo' (default — Encargos/history no ven pedidos de tienda),
    // 'store' (pestaña Tienda) o 'all'. COALESCE cubre filas previas a la columna.
    await ensureOrderKindColumn(turso);
    const kind = filters.kind || 'encargo';
    let sql = `SELECT p.*,
                (SELECT GROUP_CONCAT(pi.product_name || ' x' || pi.qty, ', ')
                 FROM preorder_items pi WHERE pi.preorder_id = p.id) as items_summary
               FROM preorders p
               WHERE p.company_id = ?`;
    const args = [companyId];
    if (kind !== 'all') { sql += " AND COALESCE(p.order_kind, 'encargo') = ?"; args.push(kind); }
    if (filters.date) { sql += ' AND p.due_date = ?'; args.push(filters.date); }
    if (filters.status && filters.status !== 'all') { sql += ' AND p.status = ?'; args.push(filters.status); }
    if (filters.startDate && filters.endDate) { sql += ' AND p.due_date BETWEEN ? AND ?'; args.push(filters.startDate, filters.endDate); }
    // Tienda: lo más reciente primero (fecha del pedido); encargos: por entrega.
    sql += kind === 'store' ? ' ORDER BY p.created_at DESC' : ' ORDER BY p.due_date ASC, p.due_time ASC';
    const result = await turso.execute({ sql, args });
    return { success: true, preorders: result.rows };
}

async function pendingWebOrders(turso, companyId) {
    await ensureOrderKindColumn(turso);
    const result = await turso.execute({
        sql: `SELECT p.id, p.external_public_code as public_code, p.client_name,
                     p.due_date, p.due_time, p.total_amount,
                     COALESCE(p.order_kind, 'encargo') as order_kind,
                     (SELECT GROUP_CONCAT(pi.product_name || ' x' || pi.qty, ', ')
                      FROM preorder_items pi WHERE pi.preorder_id = p.id) as items_summary
              FROM preorders p
              WHERE p.company_id = ? AND p.external_source = 'miniveci' AND p.status = 'pending'
              ORDER BY p.created_at DESC`,
        args: [companyId],
    });
    return { success: true, rows: result.rows };
}

// Conteo de pedidos ACTIVOS (no entregados/cancelados) para los badges:
//   - Encargos: solo los de HOY (due_date = today) que faltan por finalizar,
//     igual que la vista por defecto de la pestaña Encargos.
//   - Tienda: todos los activos (esa pestaña no filtra por fecha).
async function preorderActiveCounts(turso, companyId, session, { today = null } = {}) {
    await ensureOrderKindColumn(turso);

    const encSql = `SELECT COUNT(*) AS n FROM preorders
                    WHERE company_id = ? AND COALESCE(order_kind, 'encargo') = 'encargo'
                      AND status NOT IN ('delivered', 'canceled')`;
    const enc = await turso.execute(
        today
            ? { sql: encSql + ' AND due_date = ?', args: [companyId, today] }
            : { sql: encSql, args: [companyId] }
    );

    const sto = await turso.execute({
        sql: `SELECT COUNT(*) AS n FROM preorders
              WHERE company_id = ? AND order_kind = 'store'
                AND status NOT IN ('delivered', 'canceled')`,
        args: [companyId],
    });

    return {
        success: true,
        counts: {
            encargo: Number(enc.rows[0]?.n) || 0,
            store: Number(sto.rows[0]?.n) || 0,
        },
    };
}

async function preorderDetails(turso, companyId, session, { preorderId }) {
    const preorder = await ownPreorder(turso, companyId, preorderId);
    if (!preorder) return { success: true, preorder: null, items: [], payments: [] };
    const [itemsRes, paymentsRes] = await turso.batch([
        { sql: 'SELECT * FROM preorder_items WHERE preorder_id = ?', args: [preorderId] },
        { sql: 'SELECT * FROM preorder_payments WHERE preorder_id = ? ORDER BY created_at ASC', args: [preorderId] },
    ], 'read');
    return { success: true, preorder, items: itemsRes.rows, payments: paymentsRes.rows };
}

// Edita los productos de un pedido (pestaña Tienda): reemplaza los items y
// recalcula el total. deposit_amount NO se toca (es lo ya pagado); el saldo
// (remaining_amount = total - deposit) puede quedar negativo = a devolver al
// entregar. NO toca stock (el stock de tienda lo maneja el webhook sale.created).
async function preorderItemsEdit(turso, companyId, session, { preorderId, items }) {
    const pr = await ownPreorder(turso, companyId, preorderId, 'status, deposit_amount, delivery_fee');
    if (!pr) return { success: false, error: 'Pedido no encontrado' };
    if (['delivered', 'canceled'].includes(pr.status)) {
        return { success: false, error: 'No se puede editar un pedido entregado o cancelado' };
    }
    if (!Array.isArray(items) || items.length === 0) {
        return { success: false, error: 'El pedido debe tener al menos un producto' };
    }

    const norm = items.map(it => {
        const qty = Number(it.qty) || 0;
        const unitPrice = Number(it.unit_price) || 0;
        const lineTotal = it.line_total !== undefined ? Number(it.line_total) : qty * unitPrice;
        return {
            product_id: it.product_id || 0,
            product_name: it.product_name || 'Producto',
            qty,
            unit: it.unit || 'Und',
            unit_price: unitPrice,
            line_total: lineTotal,
            note: it.note || '',
            billing_unit: it.billing_unit || 'unit',
            external_product_id: it.external_product_id || null,
        };
    });

    const itemsTotal = norm.reduce((acc, it) => acc + it.line_total, 0);
    const deliveryFee = Number(pr.delivery_fee) || 0;
    const total = itemsTotal + deliveryFee;
    const deposit = Number(pr.deposit_amount) || 0;
    const remaining = total - deposit;

    // Reemplazo atómico de items + recálculo de totales.
    const queries = [
        { sql: 'DELETE FROM preorder_items WHERE preorder_id = ?', args: [preorderId] },
        ...norm.map(it => ({
            sql: `INSERT INTO preorder_items
                  (preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
                   billing_unit, estimated_total, external_product_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [preorderId, it.product_id, it.product_name, it.qty, it.unit, it.unit_price,
                it.line_total, it.note, it.billing_unit, it.line_total, it.external_product_id],
        })),
        {
            sql: `UPDATE preorders SET total_amount = ?, estimated_total = ?, remaining_amount = ?, updated_at = datetime('now')
                  WHERE id = ? AND company_id = ?`,
            args: [total, total, remaining, preorderId, companyId],
        },
    ];
    await turso.batch(queries);

    return { success: true, total, remaining, deposit };
}

async function preorderStatusUpdate(turso, companyId, session, { preorderId, newStatus, reason = null }) {
    const info = await ownPreorder(turso, companyId, preorderId, 'external_source, external_public_code, status, client_name');
    if (!info) return { success: false, error: 'Encargo no encontrado' };
    const prevStatus = info.status;

    if (reason && reason.trim()) {
        await turso.execute({
            sql: `UPDATE preorders SET status = ?, notes = TRIM(COALESCE(notes,'') || ' · Rechazo: ' || ?), updated_at = datetime('now') WHERE id = ? AND company_id = ?`,
            args: [newStatus, reason.trim(), preorderId, companyId],
        });
    } else {
        await turso.execute({
            sql: "UPDATE preorders SET status = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?",
            args: [newStatus, preorderId, companyId],
        });
    }

    // Si se cancela (y no estaba cancelado), calcular efectivo a devolver.
    // El movimiento de caja OUT lo registra el cliente (caja abierta del cajero).
    let cashPaid = 0;
    if (newStatus === 'canceled' && prevStatus !== 'canceled') {
        const cashRes = await turso.execute({
            sql: "SELECT COALESCE(SUM(amount), 0) as cash_paid FROM preorder_payments WHERE preorder_id = ? AND method = 'Efectivo'",
            args: [preorderId],
        });
        cashPaid = Number(cashRes.rows[0]?.cash_paid) || 0;
    }

    // Señal en vivo (Pusher): un cambio de estado altera el conteo activo → los
    // badges de otros dispositivos/pestañas se actualizan sin recargar ni pollear.
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: preorderId, status: newStatus });

    return {
        success: true,
        prevStatus,
        cashPaid,
        clientName: info.client_name || '',
        externalPublicCode: info.external_public_code || null,
    };
}

async function preorderPaymentAdd(turso, companyId, session, { preorderId, amount, method, type = 'final', registerId = null, terminalId = null, bankAccountId = null, authCode = null }) {
    const preorder = await ownPreorder(turso, companyId, preorderId, 'id, total_amount');
    if (!preorder) return { success: false, error: 'Encargo no encontrado' };

    const tId = method === 'Tarjeta' ? (terminalId || null) : null;
    const baId = method === 'Transferencia' ? (bankAccountId || null) : null;
    const ac = method === 'Tarjeta' ? (authCode || null) : null;
    await turso.execute({
        sql: 'INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id, auth_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [preorderId, amount, method, type, registerId, tId, baId, ac],
    });

    const paymentsRes = await turso.execute({
        sql: 'SELECT SUM(amount) as total_paid FROM preorder_payments WHERE preorder_id = ?',
        args: [preorderId],
    });
    const totalPaid = paymentsRes.rows[0]?.total_paid || 0;
    const totalAmount = preorder.total_amount || 0;

    await turso.execute({
        sql: "UPDATE preorders SET deposit_amount = ?, remaining_amount = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?",
        args: [totalPaid, totalAmount - totalPaid, preorderId, companyId],
    });

    if (totalPaid >= totalAmount && type === 'final') {
        await turso.execute({
            sql: "UPDATE preorders SET status = 'delivered', updated_at = datetime('now') WHERE id = ? AND company_id = ?",
            args: [preorderId, companyId],
        });
    }

    return { success: true, totalPaid };
}

// Entrega con pesos reales (Fase 1 · Paso 16). Congela costo/tax al entregar
// (snapshot, patrón sale_items). Devuelve aggregationItems para que el cliente
// alimente updateAllAggregations (ya server-side) y el efectivo va por caja.
async function preorderDeliver(turso, companyId, session, { preorderId, itemWeights, paymentMethod = 'Efectivo', registerId = null, terminalId = null, bankAccountId = null, authCode = null }) {
    const own = await ownPreorder(turso, companyId, preorderId, 'id, external_public_code');
    if (!own) return { success: false, error: 'Encargo no encontrado' };

    const productMetaRes = await turso.execute({
        sql: `SELECT pi.id AS preorder_item_id, pi.product_id,
                     COALESCE(p.cost, 0) AS cost,
                     COALESCE(p.tax_rate, 0) AS tax_rate
              FROM preorder_items pi
              LEFT JOIN products p ON p.id = pi.product_id
              WHERE pi.preorder_id = ?`,
        args: [preorderId],
    });
    const productMetaById = new Map(
        (productMetaRes.rows || []).map(r => [r.preorder_item_id, {
            product_id: r.product_id,
            cost: Number(r.cost) || 0,
            tax_rate: Number(r.tax_rate) || 0,
        }])
    );

    let realTotal = 0;
    const aggregationItems = [];
    const itemQueries = [];
    for (const iw of itemWeights) {
        const realQty = iw.real_qty !== undefined && iw.real_qty !== null && iw.real_qty !== ''
            ? Number(iw.real_qty)
            : Number(iw.qty || 0);
        const isKg = iw.billing_unit === 'kg';
        const realWeightKg = Number(iw.real_weight_kg) || 0;
        const pricePerKg = Number(iw.price_per_kg) || 0;
        const unitPrice = Number(iw.unit_price) || 0;
        const realItemTotal = isKg ? realWeightKg * pricePerKg : realQty * unitPrice;
        realTotal += realItemTotal;

        const meta = productMetaById.get(iw.id) || { product_id: null, cost: 0, tax_rate: 0 };
        itemQueries.push({
            sql: 'UPDATE preorder_items SET real_qty = ?, real_weight_kg = ?, real_total = ?, unit_cost = ? WHERE id = ?',
            args: [realQty, iw.real_weight_kg || null, realItemTotal, meta.cost, iw.id],
        });
        if (meta.product_id) {
            aggregationItems.push({
                id: meta.product_id,
                quantity: isKg ? realWeightKg : realQty,
                price: isKg ? pricePerKg : unitPrice,
                cost: meta.cost,
                tax_rate: meta.tax_rate,
            });
        }
    }
    if (itemQueries.length) await turso.batch(itemQueries);

    const paymentsRes = await turso.execute({
        sql: 'SELECT SUM(amount) as total_paid FROM preorder_payments WHERE preorder_id = ?',
        args: [preorderId],
    });
    const totalPaid = paymentsRes.rows[0]?.total_paid || 0;
    const balanceDue = Math.max(0, realTotal - totalPaid);

    if (balanceDue > 0) {
        const tId = paymentMethod === 'Tarjeta' ? (terminalId || null) : null;
        const baId = paymentMethod === 'Transferencia' ? (bankAccountId || null) : null;
        const authCodeFinal = paymentMethod === 'Tarjeta' ? (authCode || null) : null;
        await turso.execute({
            sql: "INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id, auth_code) VALUES (?, ?, ?, 'final', ?, ?, ?, ?)",
            args: [preorderId, balanceDue, paymentMethod, registerId || null, tId, baId, authCodeFinal],
        });
    }

    await turso.execute({
        sql: `UPDATE preorders SET real_total = ?, total_amount = ?, remaining_amount = 0, deposit_amount = ?, status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND company_id = ?`,
        args: [realTotal, realTotal, totalPaid, preorderId, companyId],
    });

    return {
        success: true,
        realTotal,
        balanceDue,
        aggregationItems,
        externalPublicCode: own.external_public_code || null,
    };
}

// Reportes de encargos (Fase 1 · Paso 17) — queries crudas server-side;
// el post-procesamiento (formatos/cálculos de UI) sigue en el cliente.

async function preorderReportsRaw(turso, companyId, session, { startDate, endDate }) {
    await ensureOrderKindColumn(turso);
    const df = (col) => `SUBSTR(${col}, 1, 10) BETWEEN ? AND ?`;
    const [summaryRes, byProductRes, byClientRes, detailsRes] = await turso.batch([
        {
            sql: `SELECT COUNT(*) as total_orders,
                    SUM(COALESCE(real_total, total_amount)) as total_revenue,
                    SUM(deposit_amount) as total_deposits,
                    COUNT(*) as delivered_count,
                    AVG(COALESCE(real_total, total_amount)) as avg_ticket
                  FROM preorders
                  WHERE status = 'delivered' AND ${df('delivered_at')} AND company_id = ?${ONLY_ENCARGO()}`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT p.name, p.sku,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty)) as quantity,
                    pi.billing_unit,
                    SUM(COALESCE(pi.real_total, pi.line_total)) as revenue,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty) * COALESCE(p.original_price, 0)) as approximate_cost
                  FROM preorder_items pi
                  JOIN preorders po ON pi.preorder_id = po.id
                  JOIN products p ON pi.product_id = p.id
                  WHERE po.status = 'delivered' AND ${df('po.delivered_at')} AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY pi.product_id ORDER BY revenue DESC`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT po.client_id, po.client_name, MAX(po.client_phone) as phone,
                    COUNT(*) as orders_count,
                    SUM(COALESCE(po.real_total, po.total_amount)) as total_spend,
                    MAX(po.delivered_at) as last_order_date
                  FROM preorders po
                  WHERE po.status = 'delivered' AND ${df('po.delivered_at')} AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY COALESCE(po.client_id, po.client_name)
                  ORDER BY total_spend DESC LIMIT 100`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT po.id, po.created_at, po.delivered_at, po.due_date, po.status, po.client_name,
                    COALESCE(po.real_total, po.total_amount) as total_amount, po.deposit_amount,
                    (SELECT GROUP_CONCAT(p.name || ' (' || COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty) || ')', ', ')
                     FROM preorder_items pi JOIN products p ON pi.product_id = p.id
                     WHERE pi.preorder_id = po.id) as items_summary
                  FROM preorders po
                  WHERE po.status = 'delivered' AND ${df('po.delivered_at')} AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  ORDER BY po.delivered_at DESC`,
            args: [startDate, endDate, companyId],
        },
    ], 'read');
    return {
        success: true,
        summary: summaryRes.rows[0] || null,
        byProduct: byProductRes.rows,
        byClient: byClientRes.rows,
        details: detailsRes.rows,
    };
}

async function preorderAnalyticsRaw(turso, companyId, session, { startDate, endDate, prevStartStr, prevEndStr }) {
    await ensureOrderKindColumn(turso);
    const results = await turso.batch([
        {
            sql: `SELECT status, COUNT(*) as count, SUM(COALESCE(real_total, total_amount)) as amount
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()} GROUP BY status`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT COUNT(*) as total_orders,
                    SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered_count,
                    SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) as canceled_count,
                    SUM(CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN 1 ELSE 0 END) as inprocess_count,
                    SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue,
                    SUM(CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN COALESCE(estimated_total, total_amount) ELSE 0 END) as pipeline_value,
                    SUM(deposit_amount) as total_deposits,
                    AVG(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) END) as avg_ticket
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()}`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT pp.method, COUNT(DISTINCT pp.preorder_id) as orders, SUM(pp.amount) as total
                  FROM preorder_payments pp JOIN preorders po ON pp.preorder_id = po.id
                  WHERE po.status = 'delivered' AND po.due_date BETWEEN ? AND ? AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY pp.method ORDER BY total DESC`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT due_date as day, COUNT(*) as orders,
                    SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue,
                    SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()}
                  GROUP BY due_date ORDER BY due_date`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT p.name, p.sku, pi.billing_unit,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty)) as quantity,
                    SUM(COALESCE(pi.real_total, pi.line_total)) as revenue,
                    COUNT(DISTINCT po.id) as orders
                  FROM preorder_items pi
                  JOIN preorders po ON pi.preorder_id = po.id
                  JOIN products p ON pi.product_id = p.id
                  WHERE po.status != 'canceled' AND po.due_date BETWEEN ? AND ? AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY pi.product_id ORDER BY quantity DESC LIMIT 15`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT po.client_id, po.client_name, MAX(po.client_phone) as phone,
                    COUNT(*) as orders_count,
                    SUM(CASE WHEN po.status='delivered' THEN 1 ELSE 0 END) as delivered_count,
                    SUM(CASE WHEN po.status='canceled' THEN 1 ELSE 0 END) as canceled_count,
                    SUM(CASE WHEN po.status='delivered' THEN COALESCE(po.real_total, po.total_amount) ELSE 0 END) as total_spend
                  FROM preorders po
                  WHERE po.due_date BETWEEN ? AND ? AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY COALESCE(po.client_id, po.client_name)
                  ORDER BY total_spend DESC LIMIT 15`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT COUNT(*) as total_orders,
                    SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()}`,
            args: [prevStartStr, prevEndStr, companyId],
        },
    ], 'read');
    return { success: true, rows: results.map(r => r.rows) };
}

// Productos encargables (el cache Dexie/memoria sigue en el cliente)
async function preorderableProducts(turso, companyId) {
    try {
        await turso.execute('CREATE INDEX IF NOT EXISTS idx_products_company_salemode ON products(company_id, sale_mode)');
    } catch { /* índice ya existe */ }
    const result = await turso.execute({
        sql: `SELECT id, name, sku, price, cost, image, category, unit,
              sale_mode, is_offer, offer_price, allow_item_notes, price_ranges,
              preorder_unit, preorder_billing_unit, preorder_price_per_kg,
              preorder_gram_per_unit, preorder_use_base_price
              FROM products
              WHERE company_id = ? AND sale_mode IN ('preorder_only', 'both')
              ORDER BY name ASC`,
        args: [companyId],
    });
    return { success: true, rows: result.rows };
}

export const preorderActions = {
    preorderDeliver,
    preorderReportsRaw,
    preorderAnalyticsRaw,
    preorderableProducts,
    preorderCreate,
    preordersFetch,
    pendingWebOrders,
    preorderActiveCounts,
    preorderDetails,
    preorderItemsEdit,
    preorderStatusUpdate,
    preorderPaymentAdd,
};
