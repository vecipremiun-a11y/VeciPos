// Investiga las ventas que no tienen mirror en sale_items.
import { db } from '../_client.mjs';

const r = await db.execute(`
  SELECT id, items, payment_method, status, client_name
  FROM sales
  WHERE items IS NOT NULL AND items <> ''
    AND id NOT IN (SELECT sale_id FROM sale_items)
  ORDER BY id DESC
`);

console.log(`Total ventas sin mirror: ${r.rows.length}`);

const summaries = {};
const samples = [];
for (const sale of r.rows) {
  let items;
  try { items = JSON.parse(sale.items); } catch { continue; }
  if (!Array.isArray(items)) continue;
  const firstName = items[0]?.name || '(empty)';
  const key = firstName.slice(0, 40);
  summaries[key] = (summaries[key] || 0) + 1;
  if (samples.length < 5) {
    samples.push({ id: sale.id, items_count: items.length, first_item: items[0], status: sale.status, payment_method: sale.payment_method });
  }
}
console.log('\nAgrupado por primer item.name:');
for (const [k, v] of Object.entries(summaries).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.toString().padStart(4)}  ${k}`);
}
console.log('\nMuestras:');
for (const s of samples) console.log('  ', JSON.stringify(s).slice(0, 200));
