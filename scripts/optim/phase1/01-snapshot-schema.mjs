// FASE 1 · Paso 1
// Snapshot lógico del schema actual (DDL + conteo de filas por tabla).
// SOLO LECTURA. No modifica la base. Guarda salida en scripts/optim/snapshots/<timestamp>/.

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, SNAPSHOTS_DIR, dbUrl } from '../_client.mjs';

const stamp = nowStamp();
const outDir = path.join(SNAPSHOTS_DIR, stamp);
fs.mkdirSync(outDir, { recursive: true });

console.log('Conectado a:', dbUrl);
console.log('Snapshot →', outDir);

// 1) Schema completo (DDL de tablas, índices, triggers, views)
const schema = await db.execute(`
  SELECT type, name, tbl_name, sql
  FROM sqlite_master
  WHERE sql IS NOT NULL
    AND name NOT LIKE 'sqlite_%'
  ORDER BY type, tbl_name, name
`);

const lines = [];
lines.push(`-- Snapshot schema · ${new Date().toISOString()}`);
lines.push(`-- DB: ${dbUrl}`);
lines.push('');
for (const row of schema.rows) {
  lines.push(`-- [${row.type}] ${row.name} (tbl: ${row.tbl_name})`);
  lines.push(String(row.sql).trim() + ';');
  lines.push('');
}
fs.writeFileSync(path.join(outDir, 'schema.sql'), lines.join('\n'), 'utf8');

// 2) Conteo de filas por tabla
const tables = (await db.execute(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`)).rows.map((r) => r.name);

const counts = {};
for (const t of tables) {
  try {
    const r = await db.execute(`SELECT COUNT(*) AS c FROM "${t}"`);
    counts[t] = Number(r.rows[0].c);
  } catch (e) {
    counts[t] = `ERROR: ${e.message}`;
  }
}
fs.writeFileSync(
  path.join(outDir, 'row_counts.json'),
  JSON.stringify({ takenAt: new Date().toISOString(), dbUrl, counts }, null, 2),
  'utf8'
);

// 3) PRAGMA básicas (informativas)
const pragmas = {};
for (const p of ['journal_mode', 'synchronous', 'page_size', 'cache_size', 'foreign_keys']) {
  try {
    const r = await db.execute(`PRAGMA ${p}`);
    pragmas[p] = r.rows[0] ? Object.values(r.rows[0])[0] : null;
  } catch (e) {
    pragmas[p] = `ERROR: ${e.message}`;
  }
}
fs.writeFileSync(path.join(outDir, 'pragmas.json'), JSON.stringify(pragmas, null, 2), 'utf8');

console.log('OK · tablas:', tables.length);
console.log('Top 15 por filas:');
const sorted = Object.entries(counts)
  .filter(([, v]) => typeof v === 'number')
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
console.table(sorted.map(([name, rows]) => ({ name, rows })));

process.exit(0);
