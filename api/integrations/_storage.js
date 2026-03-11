import { createClient } from '@libsql/client';

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

let schemaReady = false;

export async function ensureIntegrationSchema() {
    if (schemaReady) return;

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS integration_settings (
            company_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            store_url TEXT,
            api_key TEXT,
            api_secret TEXT,
            webhook_token TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT,
            PRIMARY KEY (company_id, provider)
        )
    `);

    await turso.execute(`
        CREATE TABLE IF NOT EXISTS integration_sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT,
            provider TEXT,
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

    await turso.execute('CREATE INDEX IF NOT EXISTS idx_sync_logs_company_date ON integration_sync_logs(company_id, created_at DESC)');
    await turso.execute('CREATE INDEX IF NOT EXISTS idx_sync_logs_provider ON integration_sync_logs(provider, created_at DESC)');

    schemaReady = true;
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

export function resolveCompanyId(req) {
    const queryCompany = req.query?.company_id;
    const headerCompany = req.headers['x-company-id'];
    return queryCompany || headerCompany || process.env.EXTERNAL_COMPANY_ID || 'default';
}

export async function getIntegrationConfig({ companyId, provider = 'woocommerce' }) {
    await ensureIntegrationSchema();

    const result = await turso.execute({
        sql: `
            SELECT company_id, provider, store_url, api_key, api_secret, webhook_token, is_active, created_at, updated_at
            FROM integration_settings
            WHERE company_id = ? AND provider = ?
            LIMIT 1
        `,
        args: [companyId, provider],
    });

    return result.rows?.[0] || null;
}

export async function saveIntegrationConfig({ companyId, provider = 'woocommerce', config }) {
    await ensureIntegrationSchema();

    const now = new Date().toISOString();
    await turso.execute({
        sql: `
            INSERT INTO integration_settings (
                company_id, provider, store_url, api_key, api_secret, webhook_token, is_active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(company_id, provider) DO UPDATE SET
                store_url = excluded.store_url,
                api_key = excluded.api_key,
                api_secret = excluded.api_secret,
                webhook_token = excluded.webhook_token,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
        `,
        args: [
            companyId,
            provider,
            config.store_url || null,
            config.api_key || null,
            config.api_secret || null,
            config.webhook_token || null,
            config.is_active === false ? 0 : 1,
            now,
            now,
        ],
    });

    return getIntegrationConfig({ companyId, provider });
}

export async function logIntegrationSync(entry) {
    await ensureIntegrationSchema();

    await turso.execute({
        sql: `
            INSERT INTO integration_sync_logs (
                company_id, provider, direction, event, status, message, payload, response, error, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            entry.company_id || null,
            entry.provider || null,
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

export async function getProductsColumns() {
    const info = await turso.execute('PRAGMA table_info(products)');
    return new Set((info.rows || []).map(col => col.name));
}

export { turso };
