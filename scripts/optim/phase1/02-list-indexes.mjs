// FASE 1 · Paso 2
// Lista TODOS los índices reales por tabla, con sus columnas y unicidad.
// SOLO LECTURA. Guarda salida JSON + reporte legible.

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';

const stamp = nowStamp();
fs.mkdirSync(REPORTS_DIR, { recursive: true });
const outJson = path.join(REPORTS_DIR, `indexes_${stamp}.json`);
const outTxt = path.join(REPORTS_DIR, `indexes_${stamp}.txt`);

const tables = (await db.execute(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`)).rows.map((r) => r.name);

const report = {};
const txt = [];
txt.push(`Índices actuales · ${new Date().toISOString()}`);
txt.push('='.repeat(80));

for (const t of tables) {
  const idxList = (await db.execute(`PRAGMA index_list("${t}")`)).rows;
  if (idxList.length === 0) continue;
  report[t] = [];
  txt.push(`\n[${t}]`);
  for (const ix of idxList) {
    const cols = (await db.execute(`PRAGMA index_info("${ix.name}")`)).rows
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name);
    // Recuperar SQL original (puede ser null en índices auto-creados por UNIQUE/PK)
    const sqlRow = await db.execute({
      sql: `SELECT sql FROM sqlite_master WHERE type='index' AND name = ?`,
      args: [ix.name],
    });
    const entry = {
      name: ix.name,
      unique: !!ix.unique,
      origin: ix.origin, // 'c' = CREATE INDEX, 'u' = UNIQUE, 'pk' = PRIMARY KEY
      partial: !!ix.partial,
      columns: cols,
      sql: sqlRow.rows[0]?.sql || null,
    };
    report[t].push(entry);
    const flags = [
      ix.unique ? 'UNIQUE' : '',
      ix.partial ? 'PARTIAL' : '',
      `origin=${ix.origin}`,
    ]
      .filter(Boolean)
      .join(' ');
    txt.push(`  - ${ix.name}  (${cols.join(', ')})  ${flags}`);
    if (entry.sql) txt.push(`      ${entry.sql}`);
  }
}

fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(outTxt, txt.join('\n'), 'utf8');

console.log('OK · reporte:', outTxt);
console.log('JSON:', outJson);

// Resumen rápido en consola
const totals = Object.entries(report).map(([t, list]) => ({
  table: t,
  indexes: list.length,
  user_created: list.filter((i) => i.origin === 'c').length,
}));
console.table(totals);

process.exit(0);
