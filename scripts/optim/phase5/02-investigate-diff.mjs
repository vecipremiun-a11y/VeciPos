// Investigar de dónde vienen los 506 items / $586k faltantes en sale_items
// vs JSON para el último mes.
import { db } from '../_client.mjs';

const cos = await db.execute(`
  SELECT company_id, COUNT(*) AS c FROM sale_items GROUP BY company_id ORDER BY c DESC LIMIT 1
`);
const companyId = cos.rows[0].company_id;
const dt = new Date().toISOString().slice(0, 10);
const lm = new Date(); lm.setMonth(lm.getMonth() - 1);
const df = lm.toISOString().slice(0, 10);
console.log(`Empresa: ${companyId}  rango ${df} → ${dt}`);

// 1) Cuántas sales hay y cuántas tienen items mirroreados?
const a = await db.execute({
  sql: `SELECT COUNT(*) AS c FROM sales
        WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?)
          AND status != 'cancelled'`,
  args: [companyId, df, dt],
});
const b = await db.execute({
  sql: `SELECT COUNT(DISTINCT sale_id) AS c FROM sale_items
        WHERE company_id = ? AND date(sale_date) BETWEEN date(?) AND date(?)`,
  args: [companyId, df, dt],
});
console.log(`sales en rango (no cancelled): ${a.rows[0].c}`);
console.log(`sales con items mirror:        ${b.rows[0].c}`);

// 2) Ventas SIN mirror — listar 10
const missing = await db.execute({
  sql: `SELECT s.id, s.date, length(s.items) AS items_len,
               (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS mirror_count
        FROM sales s
        WHERE s.company_id = ?
          AND date(s.date) BETWEEN date(?) AND date(?)
          AND s.status != 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
        ORDER BY s.date DESC LIMIT 20`,
  args: [companyId, df, dt],
});
console.log(`\nVentas sin mirror (top 20):`);
for (const r of missing.rows) {
  console.log(`  sale_id=${r.id}  date=${r.date}  items_len=${r.items_len}`);
}

// 3) Sample items de una venta sin mirror
if (missing.rows[0]) {
  const sid = missing.rows[0].id;
  const r = await db.execute({
    sql: `SELECT items FROM sales WHERE id = ?`, args: [sid],
  });
  const items = JSON.parse(r.rows[0].items || '[]');
  console.log(`\n=== sale_id ${sid} → ${items.length} items en JSON ===`);
  for (const it of items.slice(0, 3)) {
    console.log({
      id: it.id, name: it.name, quantity: it.quantity, price: it.price, sku: it.sku, isCombo: it.isCombo,
    });
  }
}

// 4) Diff de # items entre JSON y mirror, por venta
const diff = await db.execute({
  sql: `
    WITH sale_with_items AS (
      SELECT id, items FROM sales
      WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?) AND status != 'cancelled'
    )
    SELECT
      (SELECT COUNT(*) FROM sale_with_items s WHERE NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)) AS sales_zero_mirror,
      (SELECT COUNT(*) FROM sale_items WHERE company_id = ? AND date(sale_date) BETWEEN date(?) AND date(?)) AS mirror_items_total
  `,
  args: [companyId, df, dt, companyId, df, dt],
});
console.log(`\n${JSON.stringify(diff.rows[0])}`);

// 5) Mismo total contando items dentro del JSON?
const sw = await db.execute({
  sql: `SELECT id, items FROM sales
        WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?) AND status != 'cancelled'`,
  args: [companyId, df, dt],
});
let jsonTotal = 0;
let salesEmptyItems = 0;
for (const s of sw.rows) {
  try {
    const it = JSON.parse(s.items || '[]');
    if (!it.length) salesEmptyItems++;
    jsonTotal += it.length;
  } catch {}
}
console.log(`\nTotal items en JSON: ${jsonTotal}`);
console.log(`Sales con items=[]: ${salesEmptyItems}`);
