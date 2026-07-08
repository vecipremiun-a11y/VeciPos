// scripts/db/verify-all.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Alarma anti-drift: compara el ESQUEMA de cada base de databases.json contra una
// base de referencia (por defecto la de role 'produccion'), y muestra la versión
// de migración de cada una. SOLO LECTURA.
//
// Uso:
//   npm run verify-all                 # referencia = la base 'produccion'
//   npm run verify-all -- --ref=poskem # referencia explícita
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: '.env.databases.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const refArg = process.argv.find(a => a.startsWith('--ref='));
const REF = refArg ? refArg.split('=')[1] : null;
const VERSION_KEY = 'db_migration_version';

const registry = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'databases.json'), 'utf8'));

function client(d) {
  const token = process.env[d.tokenEnv];
  if (!token) return null;
  return createClient({ url: d.url, authToken: token });
}

async function introspect(db) {
  const tables = (await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )).rows.map(r => r.name);
  const cols = {};
  for (const t of tables) {
    cols[t] = new Set((await db.execute(`PRAGMA table_info("${t}")`)).rows.map(r => r.name));
  }
  let mig = 0;
  try {
    const r = await db.execute({ sql: "SELECT value FROM system_settings WHERE key = ?", args: [VERSION_KEY] });
    mig = r.rows.length ? (parseInt(r.rows[0].value, 10) || 0) : 0;
  } catch { /* sin tabla */ }
  return { tables, tableSet: new Set(tables), cols, mig };
}

const refEntry = REF
  ? registry.databases.find(d => d.name === REF)
  : registry.databases.find(d => d.role === 'produccion') || registry.databases[0];

if (!refEntry) { console.error('No hay base de referencia.'); process.exit(1); }

console.log('=== verify-all · referencia:', refEntry.name, `[${refEntry.role}] ===`);

const refDb = client(refEntry);
if (!refDb) { console.error(`Referencia ${refEntry.name} sin token (${refEntry.tokenEnv}).`); process.exit(1); }
const R = await introspect(refDb);
console.log(`Referencia: ${R.tables.length} tablas · migración v${R.mig}\n`);

let drift = 0;
for (const d of registry.databases) {
  if (d.name === refEntry.name) continue;
  const db = client(d);
  if (!db) { console.log(`── ${d.name} [${d.role}]: ⚠️ sin token — saltada`); continue; }

  const T = await introspect(db);
  const missing = R.tables.filter(t => !T.tableSet.has(t));
  const extra = T.tables.filter(t => !R.tableSet.has(t));
  const colDiffs = [];
  for (const t of R.tables) {
    if (!T.tableSet.has(t)) continue;
    const miss = [...R.cols[t]].filter(c => !T.cols[t].has(c));
    const ext = [...T.cols[t]].filter(c => !R.cols[t].has(c));
    if (miss.length || ext.length) colDiffs.push(`${t}: faltan[${miss.join(',') || '-'}] sobran[${ext.join(',') || '-'}]`);
  }

  const sameVersion = T.mig === R.mig;
  const aligned = missing.length === 0 && extra.length === 0 && colDiffs.length === 0;
  if (!aligned) drift++;

  console.log(`── ${d.name} [${d.role}]: ${T.tables.length} tablas · migración v${T.mig} ${sameVersion ? '' : `(≠ ref v${R.mig})`}`);
  if (aligned) {
    console.log('   ✅ esquema alineado con la referencia');
  } else {
    if (missing.length) console.log('   tablas faltantes : ' + missing.join(', '));
    if (extra.length)   console.log('   tablas de más    : ' + extra.join(', '));
    colDiffs.forEach(c => console.log('   ' + c));
  }
}

console.log('\n=== Resumen ===');
console.log(drift === 0
  ? '✅ Todas las bases alineadas con la referencia.'
  : `⚠️ ${drift} base(s) con diferencias (revisa arriba). Si es la base de DEV con migraciones pendientes, es esperado.`);
process.exit(0);
