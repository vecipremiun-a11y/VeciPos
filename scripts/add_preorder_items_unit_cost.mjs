// Agrega preorder_items.unit_cost: snapshot del costo del producto al momento
// de la entrega. Se usa para calcular la utilidad histórica del encargo sin
// depender del cost actual del producto (que puede haber cambiado después).
//
// Patrón análogo a sale_items: el sale_item guarda el costo del momento de la
// venta. Acá hacemos lo mismo para los items del encargo, pero el snapshot se
// estampa al ENTREGAR (no al crear), porque ahí es cuando se concreta la venta
// y se sabe el peso real.
//
// Compatibilidad: additive. Items viejos quedan con NULL (no contribuyen al
// reporte de utilidad, no hay info histórica de costo). Items entregados
// después del despliegue quedan estampados desde deliverPreorder.
//
// Idempotente. Uso: node scripts/add_preorder_items_unit_cost.mjs

import { db } from './optim/_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

console.log('Migration · preorder_items.unit_cost');
console.log('='.repeat(60));

if (await colExists('preorder_items', 'unit_cost')) {
  console.log('  preorder_items.unit_cost ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE preorder_items ADD COLUMN unit_cost REAL`);
  console.log(`  OK  ALTER preorder_items ADD unit_cost  (${Date.now() - t0} ms)`);
}

console.log('\n' + '='.repeat(60));
console.log('Listo.');
process.exit(0);
