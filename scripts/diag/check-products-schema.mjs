import { db } from '../optim/_client.mjs';
const r = await db.execute(`SELECT name, sql FROM sqlite_master WHERE tbl_name='products'`);
for (const row of r.rows) console.log(`${row.name}\n  ${row.sql || '(no sql)'}\n`);

// Verificar si hay duplicados actuales por (company_id, sku)
const dups = await db.execute(`
  SELECT company_id, sku, COUNT(*) AS c
  FROM products
  WHERE sku IS NOT NULL AND TRIM(sku) <> ''
  GROUP BY company_id, sku HAVING c > 1
  LIMIT 10
`);
console.log(`\nDuplicados actuales (company_id, sku): ${dups.rows.length === 0 ? 'NINGUNO ✓' : dups.rows.length}`);
for (const r of dups.rows) console.log(`  co=${r.company_id} sku=${r.sku}  veces=${r.c}`);
