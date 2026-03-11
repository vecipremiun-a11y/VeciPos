import {
    authenticateRequest,
    emitCatalogWebhook,
    ensureSalesSyncColumns,
    parseCompanyId,
    parseJsonBody,
    setCorsHeaders,
    turso,
} from './_common.js';

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function getSalesColumns() {
    const info = await turso.execute('PRAGMA table_info(sales)');
    return new Set((info.rows || []).map(col => col.name));
}

function buildInsertStatement(table, data) {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    return {
        sql: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        args: keys.map(key => data[key]),
    };
}

async function createOrder(req, res) {
    await ensureSalesSyncColumns();
    const companyId = parseCompanyId();
    const payload = parseJsonBody(req);
    const salesColumns = await getSalesColumns();

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: items[]',
        });
    }

    const now = new Date().toISOString();
    const normalizedItems = payload.items.map((item, index) => ({
        line: index + 1,
        pos_id: item.pos_id ? String(item.pos_id) : null,
        sku: item.sku || null,
        name: item.name || null,
        quantity: toNumber(item.quantity, 0),
        price: toNumber(item.price, 0),
        subtotal: toNumber(item.quantity, 0) * toNumber(item.price, 0),
    }));

    const calculatedTotal = normalizedItems.reduce((acc, item) => acc + item.subtotal, 0);
    const total = payload.total !== undefined ? toNumber(payload.total, calculatedTotal) : calculatedTotal;

    const saleDraft = {
        company_id: companyId,
        date: now,
        total,
        summary: payload.summary || `Pedido web ${payload.external_order_id || ''}`.trim(),
        items: JSON.stringify(normalizedItems),
        payment_method: payload.payment_method || 'web',
        payment_details: JSON.stringify(payload.payment_details || { channel: 'external_api' }),
        user_id: payload.user_id || null,
        status: payload.status || 'pending',
        has_negative_stock: 0,
        client_id: payload.client_id || null,
        client_name: payload.client_name || payload.client?.name || 'Consumidor final',
        observation: payload.observation || null,
        external_order_id: payload.external_order_id || null,
        created_at: now,
        updated_at: now,
    };

    const filteredSale = {};
    for (const [key, value] of Object.entries(saleDraft)) {
        if (salesColumns.has(key)) {
            filteredSale[key] = value;
        }
    }

    const insert = buildInsertStatement('sales', filteredSale);
    const created = await turso.execute(insert);
    const order = created.rows?.[0];

    const payloadOut = {
        order_id: String(order.id),
        external_order_id: order.external_order_id || null,
        status: order.status,
        total: Number(order.total || 0),
        company_id: companyId,
        date: order.date,
        client_name: order.client_name || null,
        items: normalizedItems,
    };

    const webhook = await emitCatalogWebhook('order.created', {
        company_id: companyId,
        order: payloadOut,
    });

    return res.status(201).json({
        success: true,
        order: payloadOut,
        webhook,
    });
}

async function updateOrderStatus(req, res) {
    await ensureSalesSyncColumns();
    const companyId = parseCompanyId();
    const payload = parseJsonBody(req);

    if (!payload.status) {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: status',
        });
    }

    if (!payload.order_id && !payload.external_order_id) {
        return res.status(400).json({
            success: false,
            error: 'Missing order identifier: order_id or external_order_id',
        });
    }

    const whereSql = payload.order_id ? 'id = ?' : 'external_order_id = ?';
    const whereArg = payload.order_id || payload.external_order_id;

    const before = await turso.execute({
        sql: `SELECT * FROM sales WHERE company_id = ? AND ${whereSql} LIMIT 1`,
        args: [companyId, whereArg],
    });

    const orderBefore = before.rows?.[0];
    if (!orderBefore) {
        return res.status(404).json({
            success: false,
            error: 'Order not found',
        });
    }

    const now = new Date().toISOString();
    const updated = await turso.execute({
        sql: `
            UPDATE sales
            SET status = ?, observation = COALESCE(?, observation), updated_at = ?
            WHERE id = ? AND company_id = ?
            RETURNING *
        `,
        args: [payload.status, payload.observation || null, now, orderBefore.id, companyId],
    });

    const order = updated.rows?.[0];
    let items = [];

    try {
        items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    } catch {
        items = [];
    }

    const payloadOut = {
        order_id: String(order.id),
        external_order_id: order.external_order_id || null,
        status: order.status,
        previous_status: orderBefore.status,
        total: Number(order.total || 0),
        company_id: companyId,
        updated_at: order.updated_at || now,
        items,
    };

    const webhook = await emitCatalogWebhook('order.status_updated', {
        company_id: companyId,
        order: payloadOut,
    });

    return res.status(200).json({
        success: true,
        order: payloadOut,
        webhook,
    });
}

export default async function handler(req, res) {
    setCorsHeaders(req, res, 'POST, PATCH, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (!authenticateRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        if (req.method === 'POST') return await createOrder(req, res);
        if (req.method === 'PATCH') return await updateOrderStatus(req, res);

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('❌ External orders API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
