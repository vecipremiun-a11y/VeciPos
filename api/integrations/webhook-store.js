import crypto from 'crypto';
import {
    getIntegrationConfig,
    getProductsColumns,
    logIntegrationSync,
    parseBody,
    resolveCompanyId,
    turso,
} from './_storage.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id, x-webhook-token, x-wc-webhook-signature');
}

function extractBearerToken(authorization) {
    if (!authorization || typeof authorization !== 'string') return null;
    if (!authorization.startsWith('Bearer ')) return null;
    return authorization.slice(7).trim();
}

function validateWebhookAuth({ req, rawBody, webhookToken }) {
    if (!webhookToken) return false;

    const headerToken = req.headers['x-webhook-token'];
    const bearerToken = extractBearerToken(req.headers.authorization);
    const signatureHeader = req.headers['x-wc-webhook-signature'] || req.headers['x-poskem-signature'];

    const byToken = headerToken === webhookToken || bearerToken === webhookToken;

    let bySignature = false;
    if (signatureHeader && rawBody) {
        const hmacBase64 = crypto
            .createHmac('sha256', webhookToken)
            .update(rawBody)
            .digest('base64');

        const hmacHex = crypto
            .createHmac('sha256', webhookToken)
            .update(rawBody)
            .digest('hex');

        bySignature = signatureHeader === hmacBase64 || signatureHeader === hmacHex;
    }

    return byToken || bySignature;
}

function normalizeWebhookItems(payload) {
    const lineItems = payload?.line_items || payload?.items || payload?.data?.line_items || [];
    if (Array.isArray(lineItems) && lineItems.length > 0) {
        return lineItems.map(item => ({
            sku: item.sku || item.SKU || null,
            pos_id: item.pos_id || item.product_id || item.id || null,
            quantity: Number(item.quantity || item.qty || 0),
            raw: item,
        })).filter(item => item.quantity > 0);
    }

    const singleSku = payload?.sku || payload?.product?.sku || null;
    const singlePosId = payload?.product_id || payload?.pos_id || payload?.product?.id || null;
    const singleQty = Number(payload?.quantity || payload?.qty || payload?.product?.quantity || 0);

    if (singleQty > 0 && (singleSku || singlePosId)) {
        return [{
            sku: singleSku,
            pos_id: singlePosId,
            quantity: singleQty,
            raw: payload,
        }];
    }

    return [];
}

async function getProductByIdentifier({ companyId, sku, posId }) {
    if (sku) {
        const bySku = await turso.execute({
            sql: 'SELECT * FROM products WHERE company_id = ? AND sku = ? LIMIT 1',
            args: [companyId, sku],
        });

        if (bySku.rows?.[0]) return bySku.rows[0];
    }

    if (posId !== undefined && posId !== null && posId !== '') {
        const byId = await turso.execute({
            sql: 'SELECT * FROM products WHERE company_id = ? AND id = ? LIMIT 1',
            args: [companyId, posId],
        });

        if (byId.rows?.[0]) return byId.rows[0];
    }

    return null;
}

async function decrementStock({ productId, companyId, quantity, hasUpdatedAt }) {
    if (hasUpdatedAt) {
        const now = new Date().toISOString();
        return turso.execute({
            sql: `
                UPDATE products
                SET stock = CASE WHEN COALESCE(stock, 0) - ? < 0 THEN 0 ELSE COALESCE(stock, 0) - ? END,
                    updated_at = ?
                WHERE id = ? AND company_id = ?
                RETURNING *
            `,
            args: [quantity, quantity, now, productId, companyId],
        });
    }

    return turso.execute({
        sql: `
            UPDATE products
            SET stock = CASE WHEN COALESCE(stock, 0) - ? < 0 THEN 0 ELSE COALESCE(stock, 0) - ? END
            WHERE id = ? AND company_id = ?
            RETURNING *
        `,
        args: [quantity, quantity, productId, companyId],
    });
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const companyId = resolveCompanyId(req);
    const provider = req.query?.provider || 'woocommerce';
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const payload = parseBody(req);
    const event = req.headers['x-wc-webhook-topic'] || payload?.event || 'order.updated';

    try {
        const config = await getIntegrationConfig({ companyId, provider });

        if (!config || config.is_active === 0) {
            await logIntegrationSync({
                company_id: companyId,
                provider,
                direction: 'store_to_pos',
                event,
                status: 'error',
                message: 'Integración no configurada o inactiva',
                payload,
            });

            return res.status(400).json({
                success: false,
                error: 'Integración no configurada o inactiva',
            });
        }

        const isAuthentic = validateWebhookAuth({
            req,
            rawBody,
            webhookToken: config.webhook_token,
        });

        if (!isAuthentic) {
            await logIntegrationSync({
                company_id: companyId,
                provider,
                direction: 'store_to_pos',
                event,
                status: 'error',
                message: 'Webhook no autenticado',
                payload,
            });

            return res.status(401).json({
                success: false,
                error: 'Webhook no autenticado',
            });
        }

        const items = normalizeWebhookItems(payload);
        if (items.length === 0) {
            await logIntegrationSync({
                company_id: companyId,
                provider,
                direction: 'store_to_pos',
                event,
                status: 'ignored',
                message: 'Webhook válido sin items procesables',
                payload,
            });

            return res.status(200).json({
                success: true,
                processed: 0,
                message: 'Sin items procesables',
            });
        }

        const columns = await getProductsColumns();
        const hasUpdatedAt = columns.has('updated_at');

        const updated = [];
        const notFound = [];

        for (const item of items) {
            const product = await getProductByIdentifier({
                companyId,
                sku: item.sku,
                posId: item.pos_id,
            });

            if (!product) {
                notFound.push({ sku: item.sku, pos_id: item.pos_id, quantity: item.quantity });
                continue;
            }

            const result = await decrementStock({
                productId: product.id,
                companyId,
                quantity: item.quantity,
                hasUpdatedAt,
            });

            const current = result.rows?.[0] || product;
            updated.push({
                pos_id: String(current.id),
                sku: current.sku || null,
                stock: current.stock,
                quantity_discounted: item.quantity,
            });
        }

        const status = notFound.length > 0 ? 'partial' : 'ok';
        await logIntegrationSync({
            company_id: companyId,
            provider,
            direction: 'store_to_pos',
            event,
            status,
            message: `Actualizados ${updated.length}, no encontrados ${notFound.length}`,
            payload,
            response: { updated, notFound },
        });

        return res.status(200).json({
            success: true,
            status,
            processed: items.length,
            updated_count: updated.length,
            not_found_count: notFound.length,
            updated,
            not_found: notFound,
        });
    } catch (error) {
        await logIntegrationSync({
            company_id: companyId,
            provider,
            direction: 'store_to_pos',
            event,
            status: 'error',
            message: 'Error procesando webhook',
            payload,
            error: error.message,
        });

        console.error('❌ webhook-store error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
