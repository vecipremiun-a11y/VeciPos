import { db } from '../_client.mjs';

const cases = [3416, 3428, 15925, 15926];
for (const id of cases) {
  const s = await db.execute({ sql: `SELECT items FROM sales WHERE id = ?`, args: [id] });
  if (s.rows.length === 0) continue;
  let items;
  try { items = JSON.parse(s.rows[0].items); } catch { continue; }
  console.log(`\nsale_id=${id}  items en JSON: ${items.length}`);
  // counts en sale_items
  const c = await db.execute({ sql: `SELECT source, COUNT(*) c FROM sale_items WHERE sale_id = ? GROUP BY source`, args: [id] });
  console.log(`  filas en sale_items por source:`);
  for (const r of c.rows) console.log(`    ${r.source}: ${r.c}`);
}

process.exit(0);
