import { createClient } from '@libsql/client';

let tursoClient = null;

function getTursoClient() {
    if (tursoClient) return tursoClient;

    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;

    if (!url || !authToken) {
        throw new Error('Faltan variables Turso: VITE_TURSO_DATABASE_URL o VITE_TURSO_AUTH_TOKEN');
    }

    tursoClient = createClient({ url, authToken });
    return tursoClient;
}

export const turso = {
    execute: (...args) => getTursoClient().execute(...args),
    batch: (...args) => getTursoClientSafe().batch(...args),
};

function getTursoClientSafe() {
    return getTursoClient();
}

let schemaReady = false;

export async function ensureIntegrationSchema() {
    if (schemaReady) return;

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS tienda_config (
            company_id TEXT PRIMARY KEY,
            tienda_url TEXT,
            api_key TEXT,
            api_secret TEXT,
            webhook_secret TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        )
    `);

    const tableInfo = await turso.execute('PRAGMA table_info(tienda_config)');
    const columns = new Set((tableInfo.rows || []).map(col => col.name));

    if (!columns.has('api_key')) {
        await turso.execute('ALTER TABLE tienda_config ADD COLUMN api_key TEXT');
    }

    if (!columns.has('api_secret')) {
        await turso.execute('ALTER TABLE tienda_config ADD COLUMN api_secret TEXT');
    }

    if (!columns.has('api_consumer_key')) {
        await turso.execute('ALTER TABLE tienda_config ADD COLUMN api_consumer_key TEXT');
    }

    if (!columns.has('api_consumer_secret')) {
        await turso.execute('ALTER TABLE tienda_config ADD COLUMN api_consumer_secret TEXT');
    }

    await turso.execute(`
        UPDATE tienda_config
        SET api_key = COALESCE(api_key, api_consumer_key)
        WHERE api_key IS NULL
    `);

    await turso.execute(`
        UPDATE tienda_config
        SET api_secret = COALESCE(api_secret, api_consumer_secret)
        WHERE api_secret IS NULL
    `);

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS integration_sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT,
            direction TEXT,
            event TEXT,
            status TEXT,
            message TEXT,
            payload TEXT,
            response TEXT,
            error TEXT,
            created_at TEXT
        )
    `);

    await turso.execute('CREATE INDEX IF NOT EXISTS idx_integration_logs_company_date ON integration_sync_logs(company_id, created_at DESC)');
    await turso.execute('CREATE INDEX IF NOT EXISTS idx_integration_logs_event ON integration_sync_logs(event, created_at DESC)');

    schemaReady = true;
}

export function resolveCompanyId(req) {
    return req.query?.company_id || req.headers['x-company-id'] || process.env.EXTERNAL_COMPANY_ID || 'default';
}

// ── Guards (blindaje C1) ─────────────────────────────────────────────
// Los endpoints de /api/integration los llama el NAVEGADOR del POS (misma
// origin, cookie pv_session). Antes no exigían nada: cualquiera podía leer o
// sobreescribir la tienda_config de cualquier empresa, o disparar pushes.

// Sesión firmada o null (respondiendo 401). El handler debe hacer `return`.
export async function requireIntegrationSession(req, res) {
    const { getSession } = await import('../_lib/guard.js');
    const session = getSession(req);
    if (!session) {
        res.status(401).json({ success: false, error: 'No autenticado' });
        return null;
    }
    return session;
}

// Sesión + membresía sobre la empresa resuelta de query/header. Devuelve el
// companyId validado o null (ya respondió 401/403 — el handler debe `return`).
export async function requireMemberForIntegration(req, res) {
    const session = await requireIntegrationSession(req, res);
    if (!session) return null;
    const companyId = resolveCompanyId(req);
    if (session.role === 'super_admin') return companyId;
    const { isCompanyMember } = await import('../_lib/guard.js');
    if (!(await isCompanyMember(turso, session.uid, companyId))) {
        res.status(403).json({ success: false, error: 'No perteneces a esta empresa' });
        return null;
    }
    return companyId;
}

// Membresía sobre una empresa ya resuelta desde la BD (push-preorder/notify).
export async function sessionIsMemberOf(session, companyId) {
    if (!session || !companyId) return false;
    if (session.role === 'super_admin') return true;
    const { isCompanyMember } = await import('../_lib/guard.js');
    return isCompanyMember(turso, session.uid, companyId);
}

export function parseBody(req) {
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            return {};
        }
    }

    return req.body || {};
}

export async function getTiendaConfig(companyId) {
    await ensureIntegrationSchema();

    const result = await turso.execute({
        sql: `
            SELECT company_id, tienda_url,
                   COALESCE(api_key, api_consumer_key) as api_key,
                   COALESCE(api_secret, api_consumer_secret) as api_secret,
                   webhook_secret, is_active, created_at, updated_at
            FROM tienda_config
            WHERE company_id = ?
            LIMIT 1
        `,
        args: [companyId],
    });

    return result.rows?.[0] || null;
}

export async function saveTiendaConfig(companyId, payload) {
    await ensureIntegrationSchema();
    const now = new Date().toISOString();

    const apiKey = payload.api_key || payload.api_consumer_key || null;
    const apiSecret = payload.api_secret || payload.api_consumer_secret || null;

    await turso.execute({
        sql: `
            INSERT INTO tienda_config (
                company_id, tienda_url, api_key, api_secret, webhook_secret, is_active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(company_id) DO UPDATE SET
                tienda_url = excluded.tienda_url,
                api_key = excluded.api_key,
                api_secret = excluded.api_secret,
                webhook_secret = excluded.webhook_secret,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
        `,
        args: [
            companyId,
            payload.tienda_url || null,
            apiKey,
            apiSecret,
            payload.webhook_secret || null,
            payload.is_active === false ? 0 : 1,
            now,
            now,
        ],
    });

    return getTiendaConfig(companyId);
}

export async function logSync(entry) {
    await ensureIntegrationSchema();

    await turso.execute({
        sql: `
            INSERT INTO integration_sync_logs (
                company_id, direction, event, status, message, payload, response, error, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            entry.company_id || null,
            entry.direction || null,
            entry.event || null,
            entry.status || null,
            entry.message || null,
            entry.payload ? JSON.stringify(entry.payload) : null,
            entry.response ? JSON.stringify(entry.response) : null,
            entry.error || null,
            new Date().toISOString(),
        ],
    });
}

export async function listPendingStockRetries({ companyId, limit = 20 }) {
    await ensureIntegrationSchema();

    const result = await turso.execute({
        sql: `
            SELECT id, company_id, payload
            FROM integration_sync_logs
            WHERE company_id = ?
              AND direction = 'pos_to_store'
              AND event = 'product.stock_updated'
              AND status = 'pending_retry'
            ORDER BY id ASC
            LIMIT ?
        `,
        args: [companyId, Math.max(1, Math.min(Number(limit) || 20, 100))],
    });

    return result.rows || [];
}

export async function updateSyncLogStatus({ id, status, message, response, error }) {
    await ensureIntegrationSchema();

    await turso.execute({
        sql: `
            UPDATE integration_sync_logs
            SET status = ?,
                message = COALESCE(?, message),
                response = COALESCE(?, response),
                error = ?
            WHERE id = ?
        `,
        args: [
            status || null,
            message || null,
            response ? JSON.stringify(response) : null,
            error || null,
            id,
        ],
    });
}

export async function hasProductUpdatedAtColumn() {
    const info = await turso.execute('PRAGMA table_info(products)');
    return (info.rows || []).some(col => col.name === 'updated_at');
}
