// Agrega columna preorder_payments.register_id + índice.
//
// Propósito: atar cada cobro de encargo a la caja que lo cobró. Permite
// reflejar tarjeta/transferencia de encargos en el desglose de la caja
// abierta (CashStatusWidget) sin que se mezclen entre cajeras concurrentes.
//
// Compatibilidad: additive. La columna es nullable; pagos viejos quedan
// con register_id NULL (no aparecen en el desglose de ninguna caja, pero
// no rompen nada). Los pagos nuevos quedan estampados desde createPreorder
// / addPreorderPayment / deliverPreorder.
//
// Idempotente: chequea existencia antes de crear.
//
// Uso:
//   node scripts/add_preorder_payments_register_id.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

console.log('Migration · preorder_payments.register_id');
console.log('='.repeat(60));

if (await colExists('preorder_payments', 'register_id')) {
  console.log('  preorder_payments.register_id ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorder_payments ADD COLUMN register_id INTEGER`);
  console.log(`  OK  ALTER preorder_payments ADD register_id  (${Date.now() - t0} ms)`);
}

// Índice para la query del desglose: WHERE register_id = ? AND method = ?
if (await indexExists('idx_preorder_payments_register_method')) {
  console.log('  idx_preorder_payments_register_method ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_preorder_payments_register_method
    ON preorder_payments(register_id, method)
  `);
  console.log(`  OK  idx_preorder_payments_register_method  (${Date.now() - t0} ms)`);
}

// Reporte de cuántos pagos hay (referencia)
const stats = await db.execute(`
  SELECT COUNT(*) total,
         SUM(CASE WHEN register_id IS NOT NULL THEN 1 ELSE 0 END) with_register
  FROM preorder_payments
`);
const row = stats.rows[0];
console.log(`\n  Total pagos: ${row.total} · con register_id: ${row.with_register} (los nuevos se estampan desde la app)`);

console.log('\n' + '='.repeat(60));
console.log('Listo.');
process.exit(0);
