// Agrega preorder_items.real_qty para registrar las unidades REALMENTE
// entregadas (separadas de qty planeado, igual que real_total/line_total).
//
// Caso de uso: cliente encarga 20 unidades, al entregar pide 5 más → se
// entregan 25 con un peso real. real_qty=25 deja el conteo exacto sin
// romper la planeación original.
//
// Compatibilidad: additive. Items viejos quedan con NULL → analytics caen
// a qty con COALESCE (sin pérdida). Items nuevos quedan estampados desde
// deliverPreorder.
//
// Idempotente. Uso: node scripts/add_preorder_items_real_qty.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · preorder_items.real_qty');
console.log('='.repeat(60));

if (await colExists('preorder_items', 'real_qty')) {
  console.log('  preorder_items.real_qty ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorder_items ADD COLUMN real_qty REAL`);
  console.log(`  OK  ALTER preorder_items ADD real_qty  (${Date.now() - t0} ms)`);
}

console.log('\n' + '='.repeat(60));
console.log('Listo.');
process.exit(0);
