// FASE 2.5 · Verificar que el trigger trg_products_updated_at funciona.
// Toma 1 producto real, hace un UPDATE idempotente y comprueba que updated_at cambió.

import { db } from '../_client.mjs';

const r = await db.execute(`SELECT id, name, updated_at FROM products LIMIT 1`);
if (!r.rows.length) {
  console.log('Sin productos en la base.');
  process.exit(0);
}
const p = r.rows[0];
console.log('Antes:', p);

await new Promise((res) => setTimeout(res, 10));
await db.execute({ sql: `UPDATE products SET name = name WHERE id = ?`, args: [p.id] });

const r2 = await db.execute({ sql: `SELECT id, name, updated_at FROM products WHERE id = ?`, args: [p.id] });
console.log('Después:', r2.rows[0]);
console.log('Trigger funciona:', r2.rows[0].updated_at !== p.updated_at);
process.exit(0);
