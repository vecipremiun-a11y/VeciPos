// Clasificar las ventas sin mirror: ¿abonos? ¿ventas reales?
import { db } from '../_client.mjs';

const cos = await db.execute(`
  SELECT company_id FROM sale_items GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1
`);
const companyId = cos.rows[0].company_id;
const lm = new Date(); lm.setMonth(lm.getMonth() - 1);
const df = lm.toISOString().slice(0, 10);
const dt = new Date().toISOString().slice(0, 10);

const missing = await db.execute({
  sql: `SELECT s.id, s.date, s.items, s.summary, s.client_id, s.client_name, s.total, s.payment_method
        FROM sales s
        WHERE s.company_id = ?
          AND date(s.date) BETWEEN date(?) AND date(?)
          AND s.status != 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
        ORDER BY s.date DESC LIMIT 500`,
  args: [companyId, df, dt],
});

let abonos = 0;
let realSales = 0;
let emptyItems = 0;
let others = 0;
const examples = { abono: null, real: null, otro: null };
let totalRevenueMissing = 0;
let totalRevenueAbonos = 0;

for (const r of missing.rows) {
  let items;
  try { items = JSON.parse(r.items || '[]'); } catch { items = null; }
  if (!items || items.length === 0) { emptyItems++; continue; }

  const isAbono = items.length === 1 &&
                  typeof items[0]?.name === 'string' &&
                  /Abono|Pago|Deuda/i.test(items[0].name);
  if (isAbono) {
    abonos++;
    totalRevenueAbonos += Number(r.total) || 0;
    if (!examples.abono) examples.abono = { id: r.id, date: r.date, total: r.total, items_sample: items[0] };
  } else if (items.every(it => it && Number.isInteger(Number(it.id)))) {
    realSales++;
    totalRevenueMissing += Number(r.total) || 0;
    if (!examples.real) examples.real = { id: r.id, date: r.date, total: r.total, item_count: items.length, items_sample: items.slice(0, 2) };
  } else {
    others++;
    if (!examples.otro) examples.otro = { id: r.id, date: r.date, total: r.total, items: items.slice(0, 2) };
  }
}

console.log(`Total sales sin mirror analizadas: ${missing.rows.length}`);
console.log(`  - Abonos (Pago/Deuda):  ${abonos}  total=$${totalRevenueAbonos}`);
console.log(`  - Ventas reales:        ${realSales}  total=$${totalRevenueMissing}`);
console.log(`  - items=[] vacíos:      ${emptyItems}`);
console.log(`  - otros:                ${others}`);
console.log(`\nEjemplos:`);
console.log(`abono:`, examples.abono);
console.log(`real:`,  examples.real);
console.log(`otro:`,  examples.otro);
