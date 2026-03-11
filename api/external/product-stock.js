import {
    authenticateRequest,
    buildWhereByProductIdentifier,
    emitCatalogWebhook,
    ensureProductsSyncColumns,
    mapProductRow,
    parseCompanyId,
    parseJsonBody,
    setCorsHeaders,
    turso,
} from './_common.js';

export default async function handler(req, res) {
    setCorsHeaders(req, res, 'PATCH, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'PATCH') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!authenticateRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await ensureProductsSyncColumns();
        const companyId = parseCompanyId();
        const payload = parseJsonBody(req);

        const identifier = buildWhereByProductIdentifier({
            pos_id: payload.pos_id,
            sku: payload.sku,
        });

        if (!identifier) {
            return res.status(400).json({
                success: false,
                error: 'Missing product identifier. Use pos_id or sku.',
            });
        }

        if (payload.stock === undefined || payload.stock === null) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: stock',
            });
        }

        const targetStock = Math.floor(Number(payload.stock));
        if (!Number.isFinite(targetStock)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid stock value',
            });
        }

        const beforeResult = await turso.execute({
            sql: `SELECT * FROM products WHERE company_id = ? AND ${identifier.sql} LIMIT 1`,
            args: [companyId, ...identifier.args],
        });

        const current = beforeResult.rows?.[0];
        if (!current) {
            return res.status(404).json({
                success: false,
                error: 'Product not found',
            });
        }

        const now = new Date().toISOString();
        const update = await turso.execute({
            sql: `
                UPDATE products
                SET stock = ?, updated_at = ?
                WHERE id = ? AND company_id = ?
                RETURNING *
            `,
            args: [targetStock, now, current.id, companyId],
        });

        const affectedRows = update.rows?.length || 0;
        if (affectedRows === 0) {
            console.warn('⚠️ External stock update affected 0 rows', {
                company_id: companyId,
                sent_sku: payload?.sku,
                normalized_sku: String(payload?.sku || '').trim().toUpperCase(),
                product_id: current.id,
                target_stock: targetStock,
            });

            return res.status(409).json({
                success: false,
                error: 'Stock update affected 0 rows',
                affected_rows: 0,
            });
        }

        const product = mapProductRow(update.rows?.[0]);
        const webhook = await emitCatalogWebhook('product.stock_updated', {
            company_id: companyId,
            product,
            stock_change: {
                from: current.stock,
                to: product.stock,
                reason: payload.reason || 'external_api',
            },
        });

        return res.status(200).json({
            success: true,
            affected_rows: affectedRows,
            product,
            stock_change: {
                from: current.stock,
                to: product.stock,
            },
            webhook,
        });
    } catch (error) {
        console.error('❌ External stock update error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
