// Monitor: poll la DB cada 3s e imprime una línea cuando aparece un nuevo
// encargo con external_source='miniveci'. Muestra info del cliente vinculado
// (nuevo vs. existente, external_id, RUT) para validar el dedupe.
import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const mode = process.argv[2] || 'watch';

if (mode === 'cleanup') {
    // Borra encargos de prueba (selftest_*, test_*)
    const r = await turso.execute("SELECT id FROM preorders WHERE external_order_id LIKE 'selftest%' OR external_order_id LIKE 'test_local%' OR external_public_code IN ('MV-LOGCHK','MV-LOCAL')");
    for (const row of r.rows) {
        await turso.execute({ sql: 'DELETE FROM preorder_items WHERE preorder_id = ?', args: [row.id] });
        await turso.execute({ sql: 'DELETE FROM preorders WHERE id = ?', args: [row.id] });
    }
    console.log(`Borrados ${r.rows.length} encargos de prueba`);
    process.exit(0);
}

// Poblar sets iniciales — TODOS los clientes existentes para distinguir entre
// "cliente realmente nuevo" (alta hecha por el resolver) vs "cliente que ya
// existía y solo se le pegó el external_id por backfill". Ambos casos son
// dedupe correcto; queremos ver la diferencia.
const seenPreorders = new Set();
const seenClients = new Set();
const initP = await turso.execute("SELECT id FROM preorders WHERE external_source = 'miniveci'");
initP.rows.forEach(r => seenPreorders.add(r.id));
const initC = await turso.execute("SELECT id FROM clients");
initC.rows.forEach(r => seenClients.add(r.id));

console.log(`[watch] vigilando encargos miniveci (ya hay ${seenPreorders.size} previos) y conociendo ${seenClients.size} clientes existentes...`);

while (true) {
    try {
        // 1) Detectar clientes RECIÉN dados de alta por el resolver (no estaban
        //    en el set inicial y su created_at es de hace <2 min). Si está en
        //    seenClients pero su created_at es viejo, fue un reuso/backfill —
        //    se reporta junto con el encargo más abajo.
        const rc = await turso.execute(`
            SELECT id, name, phone, rut, email, external_id, created_at
            FROM clients
            ORDER BY id DESC LIMIT 20
        `);
        for (const row of rc.rows.reverse()) {
            if (!seenClients.has(row.id)) {
                seenClients.add(row.id);
                console.log(`👤 CLIENTE NUEVO DADO DE ALTA #${row.id} · ${row.name} · ph:${row.phone || '-'} · rut:${row.rut || '-'} · email:${row.email || '-'} · ext_id:${row.external_id || '-'}`);
            }
        }

        // 2) Nuevos encargos miniveci, con marca clara de alta vs reuso
        const rp = await turso.execute(`
            SELECT p.id, p.external_public_code, p.client_id, p.client_name, p.client_phone, p.client_rut, p.client_external_id,
                   p.due_date, p.due_time, p.status, p.total_amount, p.created_at as preorder_created_at,
                   (SELECT COUNT(*) FROM preorder_items pi WHERE pi.preorder_id = p.id) as n_items,
                   c.created_at as client_created_at, c.name as client_canonical_name
            FROM preorders p
            LEFT JOIN clients c ON c.id = p.client_id
            WHERE p.external_source = 'miniveci'
            ORDER BY p.id DESC LIMIT 20
        `);
        for (const row of rp.rows.reverse()) {
            if (!seenPreorders.has(row.id)) {
                seenPreorders.add(row.id);
                let clientTag;
                if (!row.client_id) {
                    clientTag = '⚠️ SIN client_id (payload sin datos)';
                } else {
                    // ¿Cliente creado <2 min antes que el preorder? → alta nueva
                    const dC = row.client_created_at ? new Date(row.client_created_at).getTime() : 0;
                    const dP = row.preorder_created_at ? new Date(row.preorder_created_at).getTime() : 0;
                    const isNew = dC && dP && (dP - dC) < 120_000;
                    clientTag = isNew
                        ? `🆕 ALTA cliente #${row.client_id}`
                        : `♻️ REUSO cliente #${row.client_id} (existente del ${row.client_created_at?.slice(0, 10) || '?'})`;
                }
                console.log(`🆕 ENCARGO #${row.id} · ${row.external_public_code || 's/código'} · ${row.client_name} · ph:${row.client_phone || '-'} · rut:${row.client_rut || '-'} · ext_id:${row.client_external_id || '-'} · ${clientTag} · ${row.n_items} items · $${row.total_amount} · ${row.due_date} ${row.due_time} · ${row.status}`);
            }
        }
    } catch (e) {
        console.log(`[watch] error poll: ${e.message}`);
    }
    await new Promise(res => setTimeout(res, 3000));
}
