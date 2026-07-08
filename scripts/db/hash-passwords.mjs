// scripts/db/hash-passwords.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Migra las contraseñas de users que estén en TEXTO PLANO a hash bcrypt.
// Idempotente: salta las que ya son bcrypt ($2a$/$2b$/$2y$).
//
// SEGURIDAD: dry-run por defecto (no escribe). Con --apply ejecuta.
//
// Uso:
//   node scripts/db/hash-passwords.mjs                      # dry-run, todas las bases
//   node scripts/db/hash-passwords.mjs -- --apply           # aplica en todas
//   node scripts/db/hash-passwords.mjs -- --only=poskem --apply   # solo una base
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1] : null;

const isHashed = (v) => typeof v === 'string' && /^\$2[aby]\$\d{2}\$/.test(v);

const registry = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'databases.json'), 'utf8'));
let dbs = registry.databases;
if (ONLY) {
    dbs = dbs.filter(d => d.name === ONLY);
    if (!dbs.length) { console.error(`No existe la base "${ONLY}"`); process.exit(1); }
}

console.log(`=== hash-passwords · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);

let totalHashed = 0;
for (const d of dbs) {
    console.log(`\n── ${d.name} [${d.role}] ──`);
    const token = process.env[d.tokenEnv];
    if (!token) { console.log(`  ⚠️  sin token (${d.tokenEnv}) — SALTADA`); continue; }

    const db = createClient({ url: d.url, authToken: token });
    let users;
    try {
        users = (await db.execute('SELECT id, username, password FROM users')).rows;
    } catch (e) {
        console.log('  ✗ no se pudo leer users: ' + e.message); continue;
    }

    const plano = users.filter(u => u.password && !isHashed(u.password));
    const yaHash = users.length - plano.length;
    console.log(`  usuarios: ${users.length} · ya hasheados: ${yaHash} · en texto plano: ${plano.length}`);

    for (const u of plano) {
        if (!APPLY) { console.log(`  [dry] hashearía ${u.username}`); continue; }
        const hash = await bcrypt.hash(String(u.password), 10);
        await db.execute({ sql: 'UPDATE users SET password = ? WHERE id = ?', args: [hash, u.id] });
        totalHashed++;
        console.log(`  ✓ ${u.username}`);
    }
}

console.log('\n=== Resumen ===');
if (APPLY) console.log(`Contraseñas hasheadas: ${totalHashed}`);
else console.log('DRY-RUN: nada aplicado. Re-ejecuta con --apply.');
process.exit(0);
