// FASE 4 · Inspección de items JSON
// SOLO LECTURA. Detecta todas las claves usadas en sales.items y purchases.items
// para diseñar el schema normalizado correctamente.

import { db } from '../_client.mjs';

async function inspect(table, jsonCol = 'items', limit = 500) {
  console.log(`\n=== ${table}.${jsonCol} ===`);
  const r = await db.execute(`
    SELECT ${jsonCol} FROM ${table}
    WHERE ${jsonCol} IS NOT NULL AND ${jsonCol} <> ''
    ORDER BY id DESC LIMIT ${limit}
  `);
  const keyCounts = new Map();
  let comboCount = 0;
  let totalItems = 0;
  let parseErrors = 0;
  const sampleByShape = new Map(); // signature → 1 sample
  for (const row of r.rows) {
    let arr;
    try { arr = JSON.parse(row[jsonCol]); } catch { parseErrors++; continue; }
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      totalItems++;
      if (it.is_combo) comboCount++;
      const keys = Object.keys(it).sort();
      for (const k of keys) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
      const sig = keys.join(',');
      if (!sampleByShape.has(sig)) sampleByShape.set(sig, it);
    }
  }
  console.log(`  rows: ${r.rows.length}, items: ${totalItems}, combos: ${comboCount}, parseErrors: ${parseErrors}`);
  console.log(`  shape variants: ${sampleByShape.size}`);
  const sorted = [...keyCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  key frequency (top 25):`);
  for (const [k, v] of sorted.slice(0, 25)) {
    console.log(`    ${k.padEnd(28)} ${v}`);
  }
  console.log(`  shape samples (top 5):`);
  for (const [, sample] of [...sampleByShape.entries()].slice(0, 5)) {
    console.log('   ', JSON.stringify(sample).slice(0, 200));
  }
}

await inspect('sales', 'items', 1000);
await inspect('purchases', 'items', 500);
process.exit(0);
