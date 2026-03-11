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

        const salePrice = Number(payload.sale_price ?? payload.price);
        if (!Number.isFinite(salePrice) || salePrice < 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid sale_price',
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
        const isOffer = payload.is_offer !== undefined ? (payload.is_offer ? 1 : 0) : current.is_offer;
        const offerPrice = payload.offer_price !== undefined ? Number(payload.offer_price) : current.offer_price;

        const update = await turso.execute({
            sql: `
                UPDATE products
                SET price = ?, is_offer = ?, offer_price = ?, updated_at = ?
                WHERE id = ? AND company_id = ?
                RETURNING *
            `,
            args: [salePrice, isOffer, Number.isFinite(offerPrice) ? offerPrice : 0, now, current.id, companyId],
        });

        const product = mapProductRow(update.rows?.[0]);
        const beforeSalePrice = (current.is_offer && current.offer_price) ? Number(current.offer_price) : Number(current.price || 0);

        const webhook = await emitCatalogWebhook('product.price_updated', {
            company_id: companyId,
            product,
            price_change: {
                from: beforeSalePrice,
                to: product.sale_price,
                is_offer: Boolean(product.sale_price === Math.round(Number(update.rows?.[0]?.offer_price || 0)) && update.rows?.[0]?.is_offer),
            },
        });

        return res.status(200).json({
            success: true,
            product,
            price_change: {
                from: beforeSalePrice,
                to: product.sale_price,
            },
            webhook,
        });
    } catch (error) {
        console.error('❌ External price update error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
