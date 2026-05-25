import crypto from 'crypto';
import { createClient } from '@libsql/client';

// Lazy: el cliente se construye en la primera llamada para que dotenv ya haya
// cargado las env vars cuando se ejecute en server.js local (los `import` ESM
// se hoistean antes de dotenv.config()). En Vercel da igual porque las vars
// están en el proceso desde el inicio.
let _client = null;
function getClient() {
    if (_client) return _client;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
        throw new Error('Faltan VITE_TURSO_DATABASE_URL o VITE_TURSO_AUTH_TOKEN');
    }
    _client = createClient({ url, authToken });
    return _client;
}

export const turso = {
    execute: (...args) => getClient().execute(...args),
    batch: (...args) => getClient().batch(...args),
};

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

export async function ensurePreordersSyncColumns() {
    const preorderCols = await getTableColumns('preorders');
    const additions = [
        ['external_order_id', 'TEXT'],
        ['external_public_code', 'TEXT'],
        ['external_source', 'TEXT'],
        ['client_email', 'TEXT'],
        ['client_rut', 'TEXT'],
        ['client_external_id', 'TEXT'],
        ['delivery_fee', 'REAL DEFAULT 0'],
        ['payment_method', 'TEXT'],
    ];
    for (const [col, type] of additions) {
        if (!preorderCols.has(col)) {
            await turso.execute(`ALTER TABLE preorders ADD COLUMN ${col} ${type}`);
        }
    }

    const itemCols = await getTableColumns('preorder_items');
    // preorder_items ya tiene billing_unit, gram_per_unit. Añadimos los externos.
    const itemAdditions = [
        ['external_product_id', 'TEXT'],
    ];
    for (const [col, type] of itemAdditions) {
        if (!itemCols.has(col)) {
            await turso.execute(`ALTER TABLE preorder_items ADD COLUMN ${col} ${type}`);
        }
    }
}

export async function ensureClientsSyncColumns() {
    const cols = await getTableColumns('clients');
    const additions = [
        ['external_id', 'TEXT'],
        ['external_source', 'TEXT'],
    ];
    for (const [col, type] of additions) {
        if (!cols.has(col)) {
            await turso.execute(`ALTER TABLE clients ADD COLUMN ${col} ${type}`);
        }
    }
}

export function normalizePhoneForLookup(value) {
    if (!value) return '';
    // Stripeamos todo lo no-numérico y comparamos por los últimos 9 dígitos.
    // Cubre formatos `+56 9 5022 5491`, `+56950225491`, `950225491`, `9-5022-5491`.
    return String(value).replace(/\D+/g, '').slice(-9);
}

export function normalizeRutForLookup(value) {
    if (!value) return '';
    // RUT chileno: quitamos puntos, guiones, espacios y normalizamos la `k`.
    return String(value).replace(/[.\s-]/g, '').toLowerCase();
}

/**
 * Busca un cliente existente (external_id → rut → phone) o lo crea si no
 * existe. Devuelve el `id` numérico del cliente, o `null` si el payload no
 * tiene datos suficientes para crear uno (en cuyo caso el preorder queda con
 * client_id=null, comportamiento pre-existente).
 *
 * Idempotencia: si matchea por rut o phone pero el cliente no tenía
 * external_id guardado, lo backfilleamos. Esto evita duplicar clientes cuando
 * miniveci empieza a mandar UUIDs después de haber mandado solo teléfono.
 */
export async function resolveOrCreateClient(client, companyId, { source = null } = {}) {
    if (!client || typeof client !== 'object') return null;

    const externalId = (client.external_id ?? '').toString().trim() || null;
    const rutRaw = (client.rut ?? '').toString().trim();
    const phoneRaw = (client.phone ?? '').toString().trim();
    const name = (client.name ?? '').toString().trim();
    const email = (client.email ?? '').toString().trim() || null;
    const address = (client.address ?? '').toString().trim() || null;

    const rutNorm = normalizeRutForLookup(rutRaw);
    const phoneNorm = normalizePhoneForLookup(phoneRaw); // se guarda, ya no matchea
    const emailNorm = email ? email.toLowerCase() : null;

    if (!externalId && !rutNorm && !emailNorm && !phoneNorm && !name) return null;

    const backfillExternal = async (clientId) => {
        if (!externalId) return;
        await turso.execute({
            sql: `UPDATE clients
                  SET external_id = COALESCE(NULLIF(external_id, ''), ?),
                      external_source = COALESCE(NULLIF(external_source, ''), ?)
                  WHERE id = ?`,
            args: [externalId, source, clientId],
        });
    };

    // 1) Match por external_id (la llave más estable)
    if (externalId) {
        const r = await turso.execute({
            sql: 'SELECT id FROM clients WHERE company_id = ? AND external_id = ? LIMIT 1',
            args: [companyId, externalId],
        });
        if (r.rows?.[0]) return r.rows[0].id;
    }

    // 2) Match por RUT normalizado
    if (rutNorm) {
        const r = await turso.execute({
            sql: `SELECT id FROM clients
                  WHERE company_id = ?
                    AND rut IS NOT NULL AND rut != ''
                    AND lower(replace(replace(replace(rut, '.', ''), '-', ''), ' ', '')) = ?
                  LIMIT 1`,
            args: [companyId, rutNorm],
        });
        if (r.rows?.[0]) {
            await backfillExternal(r.rows[0].id);
            return r.rows[0].id;
        }
    }

    // 3) Match por email (normalizado lower/trim). NO se matchea por teléfono
    //    (decisión: solo RUT y correo son llaves de identidad confiables).
    if (emailNorm) {
        const r = await turso.execute({
            sql: `SELECT id FROM clients
                  WHERE company_id = ?
                    AND email IS NOT NULL AND email != ''
                    AND lower(trim(email)) = ?
                  LIMIT 1`,
            args: [companyId, emailNorm],
        });
        if (r.rows?.[0]) {
            await backfillExternal(r.rows[0].id);
            return r.rows[0].id;
        }
    }

    // 4) No matcheó: crear cliente nuevo. `name` es NOT NULL en la tabla.
    if (!name) return null;

    const insertRes = await turso.execute({
        sql: `INSERT INTO clients
              (name, rut, phone, email, address, created_at, company_id, external_id, external_source)
              VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
              RETURNING id`,
        args: [
            name,
            rutRaw || null,
            phoneRaw || null,
            email,
            address,
            companyId,
            externalId,
            source,
        ],
    });
    const newId = insertRes.rows?.[0]?.id;
    if (newId) {
        console.log(`✅ [clients] Cliente nuevo creado #${newId} desde ${source || 'externa'} (${name}${phoneRaw ? ' · ' + phoneRaw : ''})`);
    }
    return newId || null;
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
        stock: typeof row.stock === 'number' ? Math.round(row.stock * 1000) / 1000 : 0,
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
