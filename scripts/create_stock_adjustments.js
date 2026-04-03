import 'dotenv/config';
import { createClient } from '@libsql/client';

const client = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function main() {
    await client.execute(`CREATE TABLE IF NOT EXISTS stock_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT,
        old_stock REAL NOT NULL,
        new_stock REAL NOT NULL,
        difference REAL NOT NULL,
        reason TEXT DEFAULT 'manual',
        created_at TEXT NOT NULL
    )`);
    await client.execute('CREATE INDEX IF NOT EXISTS idx_stock_adj_product ON stock_adjustments(company_id, product_id)');
    console.log('OK: tabla stock_adjustments creada');

    // Verify
    const info = await client.execute("PRAGMA table_info(stock_adjustments)");
    console.log('Columnas:', info.rows.map(r => r.name).join(', '));
}

main().catch(e => console.error('ERROR:', e.message));
