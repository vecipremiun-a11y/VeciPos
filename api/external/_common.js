import crypto from 'crypto';
import { createClient } from '@libsql/client';

export const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const ALLOWED_ORIGINS = (process.env.EXTERNAL_CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

export function setCorsHeaders(req, res, methods = 'GET, OPTIONS') {
    const origin = req.headers.origin || '';

    if (ALLOWED_ORIGINS.length === 0) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}

export function authenticateRequest(req) {
    const apiKey = process.env.EXTERNAL_API_KEY;
    if (!apiKey) return false;

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return false;

    return authHeader.slice(7) === apiKey;
}

export function parseCompanyId() {
    return process.env.EXTERNAL_COMPANY_ID || 'default';
}

export function normalizeSku(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim().toUpperCase();
}

export async function getTableColumns(tableName) {
    const result = await turso.execute(`PRAGMA table_info(${tableName})`);
    return new Set((result.rows || []).map(row => row.name));
}

export async function ensureProductsSyncColumns() {
    const columns = await getTableColumns('products');

    if (!columns.has('updated_at')) {
        await turso.execute('ALTER TABLE products ADD COLUMN updated_at TEXT');
    }

    if (!columns.has('created_at')) {
        await turso.execute('ALTER TABLE products ADD COLUMN created_at TEXT');
    }

    if (!columns.has('is_active')) {
        await turso.execute('ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1');
    }

    await turso.execute(`
        UPDATE products
        SET updated_at = COALESCE(updated_at, created_at, datetime('now')),
            created_at = COALESCE(created_at, updated_at, datetime('now')),
            is_active = COALESCE(is_active, 1)
        WHERE updated_at IS NULL OR created_at IS NULL OR is_active IS NULL
    `);
}

export async function ensureSalesSyncColumns() {
    const columns = await getTableColumns('sales');

    if (!columns.has('updated_at')) {
        await turso.execute('ALTER TABLE sales ADD COLUMN updated_at TEXT');
    }

    if (!columns.has('created_at')) {
        await turso.execute('ALTER TABLE sales ADD COLUMN created_at TEXT');
    }

    if (!columns.has('external_order_id')) {
        await turso.execute('ALTER TABLE sales ADD COLUMN external_order_id TEXT');
    }

    await turso.execute(`
        UPDATE sales
        SET updated_at = COALESCE(updated_at, created_at, date, datetime('now')),
            created_at = COALESCE(created_at, date, datetime('now'))
        WHERE updated_at IS NULL OR created_at IS NULL
    `);
}

export function buildWhereByProductIdentifier({ pos_id, sku }) {
    if (pos_id !== undefined && pos_id !== null && pos_id !== '') {
        return { sql: 'id = ?', args: [pos_id] };
    }

    const normalizedSku = normalizeSku(sku);
    if (normalizedSku) {
        return { sql: 'TRIM(UPPER(sku)) = ?', args: [normalizedSku] };
    }

    return null;
}

export function mapProductRow(row) {
    const salePrice = (row.is_offer && row.offer_price)
        ? Math.round(row.offer_price)
        : Math.round(row.price || 0);

    const costPrice = row.cost ? Math.round(row.cost) : null;
    const imageValue = row.image || null;
    const imageType = imageValue
        ? (typeof imageValue === 'string' && imageValue.startsWith('http') ? 'public_url' : 'base64')
        : null;

    return {
        pos_id: String(row.id),
        sku: row.sku || `PROD-${row.id}`,
        barcode: row.sku || null,
        name: row.name,
        sale_price: salePrice,
        cost_price: costPrice,
        stock: typeof row.stock === 'number' ? Math.floor(row.stock) : 0,
        category: row.category || null,
        image_url: imageType === 'public_url' ? imageValue : null,
        image_base64: imageType === 'base64' ? imageValue : null,
        image_format: imageType,
        unit: row.unit || 'un',
        is_active: row.is_active !== 0,
        updated_at: row.updated_at || null,
        created_at: row.created_at || null,
    };
}

export function normalizeImagePayload(payload = {}) {
    const imageUrl = payload.image_url;
    const imageBase64 = payload.image_base64;

    if (typeof imageBase64 === 'string' && imageBase64.trim()) {
        return { image: imageBase64.trim(), image_format: 'base64' };
    }

    if (typeof imageUrl === 'string' && imageUrl.trim()) {
        return { image: imageUrl.trim(), image_format: 'public_url' };
    }

    return { image: null, image_format: null };
}

export async function emitCatalogWebhook(event, payload) {
    const webhookUrl = process.env.EXTERNAL_WEBHOOK_URL || process.env.EXTERNAL_OUTBOUND_WEBHOOK_URL;
    if (!webhookUrl) {
        return { sent: false, reason: 'missing_webhook_url' };
    }

    const timestamp = new Date().toISOString();
    const body = JSON.stringify({
        event,
        timestamp,
        source: 'poskem',
        ...payload,
    });

    const headers = {
        'Content-Type': 'application/json',
        'x-poskem-event': event,
        'x-poskem-timestamp': timestamp,
    };

    const secret = process.env.EXTERNAL_WEBHOOK_SECRET || '';
    if (secret) {
        const signature = crypto
            .createHmac('sha256', secret)
            .update(`${timestamp}.${body}`)
            .digest('hex');
        headers['x-poskem-signature'] = signature;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body,
        });

        const text = await response.text();

        return {
            sent: true,
            status: response.status,
            ok: response.ok,
            response: text.slice(0, 500),
        };
    } catch (error) {
        return {
            sent: false,
            reason: 'request_failed',
            error: error.message,
        };
    }
}

export function parseJsonBody(req) {
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            return {};
        }
    }

    return req.body || {};
}

export function parseUpdatedSince(updatedSince) {
    if (!updatedSince) return null;
    const parsed = new Date(updatedSince);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}
