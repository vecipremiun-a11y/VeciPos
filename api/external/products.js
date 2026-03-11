import {
    authenticateRequest,
    buildWhereByProductIdentifier,
    emitCatalogWebhook,
    ensureProductsSyncColumns,
    mapProductRow,
    normalizeImagePayload,
    parseCompanyId,
    parseJsonBody,
    parseUpdatedSince,
    setCorsHeaders,
    turso,
} from './_common.js';

function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function findProduct({ companyId, pos_id, sku }) {
    const identifier = buildWhereByProductIdentifier({ pos_id, sku });
    if (!identifier) return null;

    const result = await turso.execute({
        sql: `SELECT * FROM products WHERE company_id = ? AND ${identifier.sql} LIMIT 1`,
        args: [companyId, ...identifier.args],
    });

    return result.rows?.[0] || null;
}

async function handleListProducts(req, res) {
    const companyId = parseCompanyId();
    const { category, limit, offset, updated_since } = req.query || {};

    await ensureProductsSyncColumns();

    let sql = 'SELECT * FROM products WHERE company_id = ? AND COALESCE(is_active, 1) = 1';
    const args = [companyId];

    if (category) {
        sql += ' AND category = ?';
        args.push(category);
    }

    if (updated_since) {
        const updatedSinceIso = parseUpdatedSince(updated_since);
        if (!updatedSinceIso) {
            return res.status(400).json({
                success: false,
                error: 'Invalid updated_since. Use ISO date format.',
            });
        }

        sql += ' AND updated_at >= ?';
        args.push(updatedSinceIso);
    }

    sql += ' ORDER BY updated_at ASC, id ASC';

    if (limit !== undefined) {
        const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 10000);
        const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
        sql += ' LIMIT ? OFFSET ?';
        args.push(parsedLimit, parsedOffset);
    }

    const result = await turso.execute({ sql, args });
    const products = result.rows.map(mapProductRow);

    return res.status(200).json({
        success: true,
        total: products.length,
        synced_at: new Date().toISOString(),
        incremental_supported: true,
        products,
    });
}

async function handleCreateProduct(req, res) {
    const companyId = parseCompanyId();
    const payload = parseJsonBody(req);
    await ensureProductsSyncColumns();

    if (!payload.name || (!payload.sku && !payload.barcode)) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: name and sku/barcode',
        });
    }

    const now = new Date().toISOString();
    const image = normalizeImagePayload(payload);
    const sku = payload.sku || payload.barcode;
    const price = payload.sale_price !== undefined ? payload.sale_price : payload.price;

    const insert = await turso.execute({
        sql: `
            INSERT INTO products (
                name, price, stock, category, sku, image, cost, unit, is_offer, offer_price,
                company_id, is_active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING *
        `,
        args: [
            payload.name,
            parseNumber(price, 0),
            Math.floor(parseNumber(payload.stock, 0)),
            payload.category || 'General',
            sku,
            image.image,
            payload.cost_price !== undefined ? parseNumber(payload.cost_price, 0) : 0,
            payload.unit || 'un',
            payload.is_offer ? 1 : 0,
            payload.offer_price !== undefined ? parseNumber(payload.offer_price, 0) : 0,
            companyId,
            payload.is_active === false ? 0 : 1,
            now,
            now,
        ],
    });

    const product = insert.rows?.[0];
    const mapped = mapProductRow(product);
    const webhook = await emitCatalogWebhook('product.created', {
        company_id: companyId,
        product: mapped,
    });

    return res.status(201).json({
        success: true,
        product: mapped,
        webhook,
    });
}

async function handleUpdateProduct(req, res) {
    const companyId = parseCompanyId();
    const payload = parseJsonBody(req);
    await ensureProductsSyncColumns();

    const current = await findProduct({
        companyId,
        pos_id: payload.pos_id,
        sku: payload.sku,
    });

    if (!current) {
        return res.status(404).json({
            success: false,
            error: 'Product not found. Use pos_id or sku.',
        });
    }

    const now = new Date().toISOString();
    const image = normalizeImagePayload(payload);
    const updated = {
        name: payload.name ?? current.name,
        price: payload.sale_price !== undefined ? parseNumber(payload.sale_price, 0) : (payload.price !== undefined ? parseNumber(payload.price, 0) : current.price),
        stock: payload.stock !== undefined ? Math.floor(parseNumber(payload.stock, 0)) : current.stock,
        category: payload.category ?? current.category,
        sku: payload.new_sku || payload.sku || current.sku,
        image: image.image !== null ? image.image : current.image,
        cost: payload.cost_price !== undefined ? parseNumber(payload.cost_price, 0) : current.cost,
        unit: payload.unit ?? current.unit,
        is_offer: payload.is_offer !== undefined ? (payload.is_offer ? 1 : 0) : current.is_offer,
        offer_price: payload.offer_price !== undefined ? parseNumber(payload.offer_price, 0) : current.offer_price,
        is_active: payload.is_active !== undefined ? (payload.is_active ? 1 : 0) : (current.is_active ?? 1),
    };

    const save = await turso.execute({
        sql: `
            UPDATE products
            SET name = ?, price = ?, stock = ?, category = ?, sku = ?, image = ?,
                cost = ?, unit = ?, is_offer = ?, offer_price = ?, is_active = ?, updated_at = ?
            WHERE id = ? AND company_id = ?
            RETURNING *
        `,
        args: [
            updated.name,
            updated.price,
            updated.stock,
            updated.category,
            updated.sku,
            updated.image,
            updated.cost,
            updated.unit,
            updated.is_offer,
            updated.offer_price,
            updated.is_active,
            now,
            current.id,
            companyId,
        ],
    });

    const mapped = mapProductRow(save.rows?.[0]);
    const webhook = await emitCatalogWebhook('product.updated', {
        company_id: companyId,
        product: mapped,
    });

    return res.status(200).json({
        success: true,
        product: mapped,
        webhook,
    });
}

async function handleDeleteOrDeactivate(req, res) {
    const companyId = parseCompanyId();
    const payload = parseJsonBody(req);
    await ensureProductsSyncColumns();

    const posId = payload.pos_id || req.query?.pos_id;
    const sku = payload.sku || req.query?.sku;
    const mode = (payload.mode || req.query?.mode || 'deactivate').toLowerCase();

    const current = await findProduct({ companyId, pos_id: posId, sku });
    if (!current) {
        return res.status(404).json({
            success: false,
            error: 'Product not found. Use pos_id or sku.',
        });
    }

    const now = new Date().toISOString();
    let operation = 'deactivated';

    if (mode === 'hard') {
        await turso.execute({
            sql: 'DELETE FROM products WHERE id = ? AND company_id = ?',
            args: [current.id, companyId],
        });
        operation = 'deleted';
    } else {
        await turso.execute({
            sql: 'UPDATE products SET is_active = 0, updated_at = ? WHERE id = ? AND company_id = ?',
            args: [now, current.id, companyId],
        });
    }

    const webhook = await emitCatalogWebhook(`product.${operation}`, {
        company_id: companyId,
        product: mapProductRow({ ...current, is_active: 0, updated_at: now }),
    });

    return res.status(200).json({
        success: true,
        operation,
        product: {
            pos_id: String(current.id),
            sku: current.sku || `PROD-${current.id}`,
        },
        webhook,
    });
}

export default async function handler(req, res) {
    setCorsHeaders(req, res, 'GET, POST, PUT, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (!authenticateRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        if (req.method === 'GET') return await handleListProducts(req, res);
        if (req.method === 'POST') return await handleCreateProduct(req, res);
        if (req.method === 'PUT') return await handleUpdateProduct(req, res);
        if (req.method === 'DELETE') return await handleDeleteOrDeactivate(req, res);

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('❌ External products API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
