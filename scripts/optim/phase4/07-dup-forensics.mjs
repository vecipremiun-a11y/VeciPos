import { db } from '../_client.mjs';

const r = await db.execute({
  sql: `SELECT id, sale_id, product_id, name, quantity, price, source, created_at
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id`,
  args: [3416],
});
console.log(`sale_id=3416  total rows=${r.rows.length}`);
for (const row of r.rows) {
  console.log(`  id=${row.id} pid=${row.product_id} name=${(row.name||'').slice(0,30).padEnd(30)} qty=${row.quantity} price=${row.price} src=${row.source} created=${row.created_at}`);
}

console.log('\n— Distinct created_at counts (sale_id=3416):');
const c = await db.execute({
  sql: `SELECT created_at, COUNT(*) AS n FROM sale_items WHERE sale_id = ? GROUP BY created_at`,
  args: [3416],
});
for (const row of c.rows) console.log(`  ${row.created_at} → ${row.n}`);

console.log('\n— Range of created_at across all sale_items:');
const r2 = await db.execute(`SELECT MIN(created_at) AS mn, MAX(created_at) AS mx FROM sale_items`);
console.log(`  min=${r2.rows[0].mn}   max=${r2.rows[0].mx}`);

console.log('\n— Histogram of created_at by hour:');
const hist = await db.execute(`
  SELECT substr(created_at, 1, 13) AS hour, COUNT(*) AS n
  FROM sale_items
  GROUP BY hour ORDER BY hour
`);
for (const row of hist.rows) console.log(`  ${row.hour}  ${row.n}`);

process.exit(0);
