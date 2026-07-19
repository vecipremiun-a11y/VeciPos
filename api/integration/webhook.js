import crypto from 'crypto';
import {
    getTiendaConfig,
    hasProductUpdatedAtColumn,
    logSync,
    parseBody,
    resolveCompanyId,
    turso,
} from './_db.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id, x-api-consumer-key, x-signature');
}

function parseRawBody(req) {
    if (typeof req.body === 'string') return req.body;
    try {
        return JSON.stringify(req.body || {});
    } catch {
        return '{}';
    }
}

function extractApiConsumerKey(req, payload) {
    return req.headers['x-api-consumer-key'] || payload.api_consumer_key || null;
}

function validateSignature(rawBody, signature, secret) {
    if (!signature || !secret) return false;

    const hmacHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const hmacBase64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return signature === hmacHex || signature === hmacBase64;
}

function normalizeSaleItems(payload) {
    const sourceItems = payload.items || payload.line_items || payload.sale?.items || [];

    if (Array.isArray(sourceItems) && sourceItems.length > 0) {
        return sourceItems.map(item => ({
            product_id: item.product_id ?? item.id ?? item.pos_id ?? null,
            sku: item.sku || null,
            quantity: Number(item.quantity || item.qty || 0),
        })).filter(item => item.quantity > 0 && (item.product_id !== null || item.sku));
    }

    const singleQty = Number(payload.quantity || payload.qty || 0);
    const singleProductId = payload.product_id ?? payload.id ?? payload.pos_id ?? null;
    const singleSku = payload.sku || null;

    if (singleQty > 0 && (singleProductId !== null || singleSku)) {
        return [{ product_id: singleProductId, sku: singleSku, quantity: singleQty }];
    }

    return [];
}

async function findProduct(companyId, item) {
    if (item.product_id !== null && item.product_id !== undefined && item.product_id !== '') {
        const byId = await turso.execute({
            sql: 'SELECT * FROM products WHERE company_id = ? AND id = ? LIMIT 1',
            args: [companyId, item.product_id],
        });
        if (byId.rows?.[0]) return byId.rows[0];
    }

    if (item.sku) {
        const bySku = await turso.execute({
            sql: 'SELECT * FROM products WHERE company_id = ? AND sku = ? LIMIT 1',
            args: [companyId, item.sku],
        });
        if (bySku.rows?.[0]) return bySku.rows[0];
    }

    return null;
}

async function applyStockDecrease({ companyId, productId, quantity, includeUpdatedAt }) {
    if (includeUpdatedAt) {
        return turso.execute({
            sql: `
                UPDATE products
                SET stock = CASE WHEN COALESCE(stock, 0) - ? < 0 THEN 0 ELSE COALESCE(stock, 0) - ? END,
                    updated_at = ?
                WHERE company_id = ? AND id = ?
                RETURNING *
            `,
            args: [quantity, quantity, new Date().toISOString(), companyId, productId],
        });
    }

    return turso.execute({
        sql: `
            UPDATE products
            SET stock = CASE WHEN COALESCE(stock, 0) - ? < 0 THEN 0 ELSE COALESCE(stock, 0) - ? END
            WHERE company_id = ? AND id = ?
            RETURNING *
        `,
        args: [quantity, quantity, companyId, productId],
    });
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const companyId = resolveCompanyId(req);
    const payload = parseBody(req);
    const rawBody = parseRawBody(req);
    const event = req.headers['x-webhook-event'] || payload.event || 'sale.created';

    try {
        const config = await getTiendaConfig(companyId);
        if (!config || config.is_active === 0) {
            await logSync({
                company_id: companyId,
                direction: 'store_to_pos',
                event,
                status: 'error',
                message: 'tienda_config no existe o está inactiva',
                payload,
            });

            return res.status(400).json({ success: false, error: 'Configuración de tienda no encontrada' });
        }

        const incomingKey = extractApiConsumerKey(req, payload);
        if (!incomingKey || incomingKey !== config.api_key) {
            await logSync({
                company_id: companyId,
                direction: 'store_to_pos',
                event,
                status: 'error',
                message: 'api_key inválida',
                payload,
            });

            return res.status(401).json({ success: false, error: 'api_key inválida' });
        }

        // Blindaje: si la empresa tiene webhook_secret, la firma es OBLIGATORIA
        // (antes bastaba omitir el header para saltarse la validación).
        const signature = req.headers['x-signature'] || req.headers['x-wc-webhook-signature'];
        if (config.webhook_secret) {
            const validSignature = signature && validateSignature(rawBody, signature, config.webhook_secret);
            if (!validSignature) {
                await logSync({
                    company_id: companyId,
                    direction: 'store_to_pos',
                    event,
                    status: 'error',
                    message: 'Firma webhook inválida',
                    payload,
                });

                return res.status(401).json({ success: false, error: 'Firma webhook inválida' });
            }
        }

        const items = normalizeSaleItems(payload);
        if (items.length === 0) {
            await logSync({
                company_id: companyId,
                direction: 'store_to_pos',
                event,
                status: 'ignored',
                message: 'Webhook válido sin items',
                payload,
            });

            return res.status(200).json({ success: true, processed: 0, message: 'Sin items para descontar stock' });
        }

        const includeUpdatedAt = await hasProductUpdatedAtColumn();
        const updated = [];
        const missing = [];

        for (const item of items) {
            const product = await findProduct(companyId, item);
            if (!product) {
                missing.push(item);
                continue;
            }

            const updatedResult = await applyStockDecrease({
                companyId,
                productId: product.id,
                quantity: item.quantity,
                includeUpdatedAt,
            });

            const row = updatedResult.rows?.[0] || product;
            updated.push({
                product_id: row.id,
                sku: row.sku,
                stock: row.stock,
                quantity_discounted: item.quantity,
            });
        }

        await logSync({
            company_id: companyId,
            direction: 'store_to_pos',
            event,
            status: missing.length ? 'partial' : 'ok',
            message: `Actualizados ${updated.length}, no encontrados ${missing.length}`,
            payload,
            response: { updated, missing },
        });

        return res.status(200).json({
            success: true,
            processed: items.length,
            updated_count: updated.length,
            missing_count: missing.length,
            updated,
            missing,
        });
    } catch (error) {
        await logSync({
            company_id: companyId,
            direction: 'store_to_pos',
            event,
            status: 'error',
            message: 'Error procesando webhook',
            payload,
            error: error.message,
        });

        console.error('❌ /api/integration/webhook error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
