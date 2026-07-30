// Siembra los permisos del rol "Repartidor" en las empresas que ya existían.
//
// POR QUÉ. permissionsSeedDefaults() solo corre cuando una empresa no tiene
// ningún permiso, así que un rol agregado DESPUÉS (como Repartidor) se queda con
// cero filas y el usuario ve "Acceso Denegado" con el menú vacío. El código nuevo
// lo rellena solo (ensureRoleSeeded), pero las empresas ya creadas necesitan este
// empujón una vez.
//
// Es ADITIVO e idempotente: solo inserta si la empresa no tiene filas del rol.
// Revertir = DELETE FROM role_permissions WHERE role = 'Repartidor'.
//
// Uso:
//   node scripts/db/seed-repartidor.mjs            # dry-run
//   node scripts/db/seed-repartidor.mjs --apply    # aplica

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PERMS, ALL_PERMS } from '../../api/_lib/permissions.js';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const APPLY = process.argv.includes('--apply');
const ROLE = 'Repartidor';
const allowed = DEFAULT_PERMS[ROLE] || [];

const registry = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'databases.json'), 'utf8'));
const dbs = registry.databases || registry;

console.log(`=== seed-repartidor · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`Permisos concedidos al rol: ${allowed.join(', ')}\n`);

let totalCompanies = 0;
for (const db of dbs) {
    const url = process.env[db.urlEnv] || db.url;
    const token = process.env[db.tokenEnv] || db.authToken;
    if (!url || !token) { console.log(`── ${db.name}: sin credenciales, se omite`); continue; }
    const c = createClient({ url, authToken: token });

    const companies = (await c.execute('SELECT id FROM companies')).rows;
    let done = 0, skipped = 0;
    for (const { id } of companies) {
        const has = await c.execute({
            sql: 'SELECT COUNT(*) AS n FROM role_permissions WHERE company_id = ? AND role = ?',
            args: [id, ROLE],
        });
        if (Number(has.rows[0].n) > 0) { skipped++; continue; }
        if (APPLY) {
            const queries = ALL_PERMS.map(p => ({
                sql: 'INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
                args: [id, ROLE, p, allowed.includes(p) ? 1 : 0],
            }));
            for (let i = 0; i < queries.length; i += 50) await c.batch(queries.slice(i, i + 50));
        }
        done++;
    }
    totalCompanies += done;
    console.log(`── ${db.name} [${db.role || ''}]: ${done} empresa(s) ${APPLY ? 'sembradas' : 'a sembrar'} · ${skipped} ya la tenían`);
}

console.log(`\n=== Resumen ===`);
console.log(APPLY ? `Sembradas: ${totalCompanies}` : `DRY-RUN: nada escrito. Re-ejecuta con --apply.`);
