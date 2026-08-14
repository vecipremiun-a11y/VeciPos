// Diagnóstico de los dos reportes de producción:
//   1) ventas duplicadas
//   2) usuarios de caja que quedan sin acceso
// Solo LEE. No modifica nada.

import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
dotenv.config({ path: '.env.local' });

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

const desde = new Date(Date.now() - 5 * 864e5).toISOString();

console.log('\n══ 1. ¿La clave anti-duplicado está llegando? ══');
const clave = await turso.execute({
    sql: `SELECT company_id,
                 COUNT(*) AS ventas,
                 SUM(CASE WHEN client_sale_id IS NULL OR client_sale_id = '' THEN 1 ELSE 0 END) AS sin_clave
          FROM sales WHERE date >= ?
          GROUP BY company_id ORDER BY ventas DESC`,
    args: [desde],
});
for (const r of clave.rows) {
    console.log(`  empresa ${r.company_id}: ${r.ventas} ventas · sin clave: ${r.sin_clave}`);
}

console.log('\n══ 2. Duplicados de los últimos 5 días ══');
const dup = await turso.execute({
    sql: `SELECT company_id, user_id, total, COUNT(*) AS veces,
                 MIN(date) AS primera, MAX(date) AS ultima,
                 GROUP_CONCAT(id) AS ids,
                 SUM(CASE WHEN client_sale_id IS NULL OR client_sale_id='' THEN 1 ELSE 0 END) AS sin_clave
          FROM sales
          WHERE date >= ?
          GROUP BY company_id, user_id, total, substr(date, 1, 16)
          HAVING veces > 1
          ORDER BY ultima DESC LIMIT 40`,
    args: [desde],
});
console.log(`  grupos sospechosos: ${dup.rows.length}`);
for (const r of dup.rows) {
    console.log(`  emp ${r.company_id} · usr ${r.user_id} · $${r.total} × ${r.veces} · ${r.primera} → ${r.ultima} · ids ${r.ids} · sin_clave ${r.sin_clave}`);
}

console.log('\n══ 3. ¿El índice único existe? ══');
const idx = await turso.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='sales'");
for (const r of idx.rows) console.log('  ', r.name, '|', (r.sql || '').replace(/\s+/g, ' '));

console.log('\n══ 4. Usuarios Cathy / Katy / Mayra ══');
const us = await turso.execute(`
    SELECT u.id, u.username, u.name, u.role AS rol_global,
           uc.company_id, uc.role AS rol_empresa, c.name AS empresa
    FROM users u
    LEFT JOIN user_companies uc ON uc.user_id = u.id
    LEFT JOIN companies c ON c.id = uc.company_id
    WHERE LOWER(u.username) LIKE '%cath%' OR LOWER(u.name) LIKE '%cath%'
       OR LOWER(u.username) LIKE '%katy%' OR LOWER(u.name) LIKE '%katy%'
       OR LOWER(u.username) LIKE '%mayra%' OR LOWER(u.name) LIKE '%mayra%'`);
for (const r of us.rows) {
    console.log(`  #${r.id} ${r.username} (${r.name}) · global:${r.rol_global} · emp ${r.company_id} ${r.empresa} · rol:${r.rol_empresa}`);
}

console.log('\n══ 5. Permisos del rol de esos usuarios ══');
const empresas = [...new Set(us.rows.map(r => r.company_id).filter(Boolean))];
const roles = [...new Set(us.rows.map(r => r.rol_empresa).filter(Boolean))];
for (const emp of empresas) {
    for (const rol of roles) {
        const p = await turso.execute({
            sql: `SELECT permission, granted FROM role_permissions
                  WHERE company_id = ? AND role = ? ORDER BY permission`,
            args: [emp, rol],
        });
        if (!p.rows.length) continue;
        const dados = p.rows.filter(x => Number(x.granted) === 1).map(x => x.permission);
        console.log(`  emp ${emp} · rol "${rol}": ${p.rows.length} filas, ${dados.length} en 1`);
        console.log('     ', dados.join(', ') || '(ninguno)');
    }
}
