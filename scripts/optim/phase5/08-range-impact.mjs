// Speedup vs rango de fechas — el caso real cuando un usuario navega el
// Product Profile con rangos amplios.
import { db } from '../_client.mjs';
import {
  productSalesHistoryNormalized,
  productSalesHistoryViaJson,
  productPurchasesHistoryNormalized,
  productPurchasesHistoryViaJson,
} from '../../../src/lib/analyticsQueries.js';

const cos = await db.execute(`SELECT company_id FROM sale_items GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1`);
const companyId = cos.rows[0].company_id;

// Producto con mucha historia
const pidRes = await db.execute({
  sql: `SELECT product_id FROM sale_items
        WHERE company_id = ? AND product_id IS NOT NULL
        GROUP BY product_id ORDER BY COUNT(*) DESC LIMIT 1`,
  args: [companyId],
});
const pid = Number(pidRes.rows[0].product_id);

const today = new Date();
const ranges = [
  { name: '1 mes',  d: 30 },
  { name: '3 meses', d: 90 },
  { name: '6 meses', d: 180 },
  { name: '12 meses', d: 365 },
];

console.log(`\nProducto: ${pid}    Empresa: ${companyId}\n`);
console.log('| Rango | Sales JSON | Sales Norm | Speed Sales | Purch JSON | Purch Norm | Speed Purch |');
console.log('|---|---:|---:|---:|---:|---:|---:|');

for (const r of ranges) {
  const df = new Date(); df.setDate(df.getDate() - r.d);
  const ctx = {
    turso: db, companyId, productId: pid,
    dateFrom: df.toISOString().slice(0, 10),
    dateTo: today.toISOString().slice(0, 10),
  };

  let sJ = 0, sN = 0, pJ = 0, pN = 0;
  const RUNS = 3;
  for (let i = 0; i < RUNS; i++) {
    const tSN = Date.now(); await productSalesHistoryNormalized({ ...ctx, limit: 200 }); sN += Date.now() - tSN;
    const tSJ = Date.now(); await productSalesHistoryViaJson({ ...ctx, limit: 200 }); sJ += Date.now() - tSJ;
    const tPN = Date.now(); await productPurchasesHistoryNormalized({ ...ctx, limit: 100 }); pN += Date.now() - tPN;
    const tPJ = Date.now(); await productPurchasesHistoryViaJson({ ...ctx, limit: 100 }); pJ += Date.now() - tPJ;
  }
  sJ /= RUNS; sN /= RUNS; pJ /= RUNS; pN /= RUNS;

  const speedS = sN > 0 ? (sJ / sN).toFixed(2) : '∞';
  const speedP = pN > 0 ? (pJ / pN).toFixed(2) : '∞';
  console.log(`| ${r.name} | ${sJ.toFixed(0)} | ${sN.toFixed(0)} | ${speedS}× | ${pJ.toFixed(0)} | ${pN.toFixed(0)} | ${speedP}× |`);
}
