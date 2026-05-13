// Diagnóstico: ¿por qué hay sales sin mirror en sale_items?
import { db } from '../_client.mjs';

const missing = await db.execute(`
  SELECT id, company_id, total, length(items) AS items_len, substr(items, 1, 200) AS items_head
  FROM sales
  WHERE items IS NOT NULL AND items <> ''
    AND id NOT IN (SELECT sale_id FROM sale_items)
  ORDER BY id DESC LIMIT 30
`);

console.log(`Ventas sin mirror: ${missing.rows.length} (sample top 30)`);
for (const r of missing.rows) {
  console.log(`\nsale_id=${r.id} company=${r.company_id} total=${r.total} items_len=${r.items_len}`);
  console.log(`  head: ${r.items_head}`);
}
process.exit(0);
