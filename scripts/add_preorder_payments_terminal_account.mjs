// Agrega terminal_id + bank_account_id a preorder_payments.
//
// Propósito: capturar qué datáfono (Tarjeta) o qué cuenta bancaria
// (Transferencia) se usó al cobrar un encargo. Mismo concepto que POS, que
// guarda esos campos en payment_details JSON. Para encargos usamos columnas
// dedicadas (consultable sin parsear JSON).
//
// Compatibilidad: additive. Pagos viejos quedan con NULL → en la UI se
// muestra '—' (igual que ahora). Pagos nuevos quedan estampados desde los
// modales de createPreorder / addPreorderPayment / deliverPreorder.
//
// Idempotente.
//
// Uso: node scripts/add_preorder_payments_terminal_account.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · preorder_payments.terminal_id + bank_account_id');
console.log('='.repeat(60));

if (await colExists('preorder_payments', 'terminal_id')) {
  console.log('  preorder_payments.terminal_id ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorder_payments ADD COLUMN terminal_id INTEGER`);
  console.log(`  OK  ALTER preorder_payments ADD terminal_id  (${Date.now() - t0} ms)`);
}

if (await colExists('preorder_payments', 'bank_account_id')) {
  console.log('  preorder_payments.bank_account_id ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorder_payments ADD COLUMN bank_account_id INTEGER`);
  console.log(`  OK  ALTER preorder_payments ADD bank_account_id  (${Date.now() - t0} ms)`);
}

console.log('\n' + '='.repeat(60));
console.log('Listo.');
process.exit(0);
