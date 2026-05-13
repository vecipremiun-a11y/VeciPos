import { db } from '../_client.mjs';

// 1. Duplicados por (sale_id, seq) — deberían ser 0 por el UNIQUE INDEX
const dupKey = await db.execute(`
  SELECT sale_id, seq, COUNT(*) AS c
  FROM sale_items WHERE seq IS NOT NULL
  GROUP BY sale_id, seq HAVING c > 1
  LIMIT 10
`);
console.log(`Duplicados por (sale_id, seq): ${dupKey.rows.length === 0 ? '0 ✓' : dupKey.rows.length}`);
for (const r of dupKey.rows) console.log(`  sale_id=${r.sale_id} seq=${r.seq} c=${r.c}`);

// 2. Filas con seq=NULL (no protegidas por UNIQUE)
const nullSeq = await db.execute(`SELECT COUNT(*) AS c FROM sale_items WHERE seq IS NULL`);
console.log(`Filas con seq=NULL en sale_items: ${nullSeq.rows[0].c}`);

const nullSeqP = await db.execute(`SELECT COUNT(*) AS c FROM purchase_items WHERE seq IS NULL`);
console.log(`Filas con seq=NULL en purchase_items: ${nullSeqP.rows[0].c}`);

// 3. Sale_ids con MUCHAS más filas que items en su JSON (signo de duplicación tardía)
const susp = await db.execute(`
  SELECT s.id, s.items, (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS db_rows
  FROM sales s
  WHERE s.items IS NOT NULL AND s.items <> '' AND s.items <> '[]'
  ORDER BY db_rows DESC LIMIT 10
`);
console.log('\nTop sale_ids por # filas en sale_items:');
for (const r of susp.rows) {
  let items;
  try { items = JSON.parse(r.items); } catch { items = []; }
  const jsonItems = Array.isArray(items) ? items.length : 0;
  const ratio = jsonItems > 0 ? (r.db_rows / jsonItems).toFixed(2) : 'n/a';
  console.log(`  sale_id=${r.id}  json=${jsonItems}  db=${r.db_rows}  ratio=${ratio}`);
}

// 4. Repeat from script 05
const totalDups = await db.execute(`
  SELECT COUNT(*) - COUNT(DISTINCT sale_id || '/' || COALESCE(product_id,product_ref) || '/' || quantity || '/' || price || '/' || COALESCE(name,'') || '/' || seq) AS excess
  FROM sale_items
`);
console.log(`\nExceso global (mismo sale_id+seq+data): ${totalDups.rows[0].excess}`);
