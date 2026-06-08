// Migración · Sorteos — regla de validación de boleta (monto mínimo + fecha)
// ─────────────────────────────────────────────────────────────────────────
// Agrega la infraestructura para verificar el N° de boleta contra la venta
// real al inscribirse en un sorteo:
//   1. sorteos.boleta_min_amount  → monto mínimo configurable (0 = sin verificar).
//   2. sorteos.boleta_from_date   → solo boletas emitidas desde esta fecha.
//   3. sorteo_participants.sale_id→ la venta validada (dedup real, no por texto).
//
// Idempotente (guard colExists). 100% aditiva → cero riesgo para lo existente.
//
// Uso:  node scripts/add_sorteo_boleta_rules.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · Sorteos — reglas de boleta');
console.log('='.repeat(60));

// sorteos.boleta_min_amount
if (await colExists('sorteos', 'boleta_min_amount')) {
  console.log('  sorteos.boleta_min_amount ya existe — skip');
} else {
  await db.execute(`ALTER TABLE sorteos ADD COLUMN boleta_min_amount INTEGER NOT NULL DEFAULT 0`);
  console.log('  OK  ALTER sorteos ADD boleta_min_amount');
}

// sorteos.boleta_from_date
if (await colExists('sorteos', 'boleta_from_date')) {
  console.log('  sorteos.boleta_from_date ya existe — skip');
} else {
  await db.execute(`ALTER TABLE sorteos ADD COLUMN boleta_from_date TEXT`);
  console.log('  OK  ALTER sorteos ADD boleta_from_date');
}

// sorteo_participants.sale_id
if (await colExists('sorteo_participants', 'sale_id')) {
  console.log('  sorteo_participants.sale_id ya existe — skip');
} else {
  await db.execute(`ALTER TABLE sorteo_participants ADD COLUMN sale_id INTEGER`);
  console.log('  OK  ALTER sorteo_participants ADD sale_id');
}

// Dedup real: una venta = una inscripción (cuando se validó contra venta).
await db.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_sorteo_sale
    ON sorteo_participants(company_id, sale_id)
    WHERE sale_id IS NOT NULL
`);
console.log('  OK  índice uniq_sorteo_sale');

console.log('\nListo.');
process.exit(0);
