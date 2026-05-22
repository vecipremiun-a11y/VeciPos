// FASE 8.2 · Verificar que los triggers de updated_at funcionan en
// clients, categories, product_lots, tax_rates.
//
// Estrategia (NO destructiva):
//   Para cada tabla, toma 1 fila, le hace UPDATE idempotente (SET name = name)
//   y comprueba que updated_at cambió.
//
// Si alguna tabla no tiene filas, se reporta y se skipea.

import { db } from '../_client.mjs';

async function verifyTrigger(table, nameColumn = 'name') {
  console.log(`\n— ${table} —`);

  const r = await db.execute(`SELECT id, ${nameColumn}, updated_at FROM ${table} LIMIT 1`);
  if (!r.rows.length) {
    console.log(`  Sin filas en ${table} — no se puede testear el trigger`);
    return;
  }

  const row = r.rows[0];
  console.log('  Antes:', { id: row.id, [nameColumn]: row[nameColumn], updated_at: row.updated_at });

  // Pequeña espera para que el timestamp sea diferente
  await new Promise((res) => setTimeout(res, 10));

  await db.execute({
    sql: `UPDATE ${table} SET ${nameColumn} = ${nameColumn} WHERE id = ?`,
    args: [row.id],
  });

  const r2 = await db.execute({
    sql: `SELECT id, ${nameColumn}, updated_at FROM ${table} WHERE id = ?`,
    args: [row.id],
  });

  const after = r2.rows[0];
  console.log('  Después:', { id: after.id, [nameColumn]: after[nameColumn], updated_at: after.updated_at });

  const works = String(after.updated_at) !== String(row.updated_at);
  console.log(`  Trigger funciona: ${works ? '✅ SÍ' : '❌ NO'}`);
}

console.log('Fase 8.2 · Verificación de triggers');
console.log('='.repeat(60));

await verifyTrigger('clients');
await verifyTrigger('categories');
// product_lots no tiene `name`, usa batch_number (que existe según schema)
await verifyTrigger('product_lots', 'batch_number');
await verifyTrigger('tax_rates');

console.log('\n' + '='.repeat(60));
console.log('Verificación completa.');
process.exit(0);
