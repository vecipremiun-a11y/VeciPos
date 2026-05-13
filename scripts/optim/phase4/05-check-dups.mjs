// Verifica si hay sale_ids con más de un INSERT batch (escritura dual + backfill).
// Si hay duplicados, los deduplica conservando el más viejo (id menor).

import { db } from '../_client.mjs';

const dups = await db.execute(`
  SELECT sale_id, COUNT(*) AS rows, COUNT(DISTINCT source) AS sources, GROUP_CONCAT(DISTINCT source) AS src_list
  FROM sale_items
  GROUP BY sale_id
  HAVING rows > (SELECT MAX(cnt) FROM (
    SELECT sale_id, COUNT(*) AS cnt FROM sale_items GROUP BY sale_id
  ))/2
  ORDER BY rows DESC LIMIT 5
`);
console.log('Top sale_ids por filas:');
for (const r of dups.rows) {
  console.log(`  sale_id=${r.sale_id}  rows=${r.rows}  sources=${r.src_list}`);
}

// Mejor enfoque: ¿hay sale_ids con filas duplicadas (mismo sale_id + product_id + quantity + price)?
const dupRows = await db.execute(`
  SELECT sale_id, product_id, name, quantity, price, COUNT(*) AS dups
  FROM sale_items
  GROUP BY sale_id, product_id, name, quantity, price
  HAVING dups > 1
  ORDER BY dups DESC, sale_id DESC
  LIMIT 20
`);
console.log('\nFilas con duplicados exactos (sale_id + producto):');
for (const r of dupRows.rows) {
  console.log(`  sale_id=${r.sale_id} pid=${r.product_id} name=${(r.name||'').slice(0,30)} qty=${r.quantity} price=${r.price} dups=${r.dups}`);
}

const totalDups = await db.execute(`
  SELECT COUNT(*) - COUNT(DISTINCT sale_id || '/' || COALESCE(product_id,product_ref) || '/' || quantity || '/' || price || '/' || name) AS excess
  FROM sale_items
`);
console.log(`\nExceso global estimado de filas duplicadas en sale_items: ${totalDups.rows[0].excess}`);

const purDups = await db.execute(`
  SELECT COUNT(*) - COUNT(DISTINCT purchase_id || '/' || COALESCE(product_id,product_ref) || '/' || quantity || '/' || cost || '/' || name) AS excess
  FROM purchase_items
`);
console.log(`Exceso global estimado de filas duplicadas en purchase_items: ${purDups.rows[0].excess}`);

process.exit(0);
