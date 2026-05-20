// Monitor: poll integration_sync_logs cada 2s y reporta callbacks de estado
// salientes a miniveci (event = 'bakery_order.status_updated').
import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const seen = new Set();
try {
    const init = await turso.execute("SELECT id FROM integration_sync_logs WHERE event='bakery_order.status_updated'");
    init.rows.forEach(r => seen.add(r.id));
} catch (e) {
    console.log(`[watch-cb] error init: ${e.message}`);
}
console.log(`[watch-cb] vigilando callbacks salientes (ya hay ${seen.size} previos)...`);

while (true) {
    try {
        const r = await turso.execute(`
            SELECT id, status, message, payload, response, error, created_at
            FROM integration_sync_logs
            WHERE event='bakery_order.status_updated'
            ORDER BY id DESC LIMIT 20
        `);
        for (const row of r.rows.reverse()) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                let resumen = '';
                try {
                    const p = JSON.parse(row.payload || '{}');
                    resumen = `${p.public_code || '?'} → ${p.status || '?'}`;
                } catch { /* ignore */ }
                let up = '';
                try {
                    const resp = JSON.parse(row.response || '{}');
                    up = ` · upstream ${resp.status ?? '?'}`;
                } catch { /* ignore */ }
                const icon = row.status === 'ok' ? '✅' : '❌';
                console.log(`${icon} CALLBACK ${resumen}${up} · ${row.message}${row.error ? ' · err: ' + row.error : ''}`);
            }
        }
    } catch (e) {
        console.log(`[watch-cb] error poll: ${e.message}`);
    }
    await new Promise(res => setTimeout(res, 2000));
}
