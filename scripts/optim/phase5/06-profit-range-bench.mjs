// Probar profitReport con rangos crecientes para ver dónde gana sale_items.
import { db } from '../_client.mjs';
import { profitReportNormalized } from '../../../src/lib/analyticsQueries.js';

const cos = await db.execute(`SELECT company_id FROM sale_items GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1`);
const companyId = cos.rows[0].company_id;

const ranges = [7, 30, 90, 180, 365]; // días atrás

console.log(`Empresa: ${companyId}\n`);
console.log('| Rango | Filas | Norm ms | JSON ms | Speedup | Paridad |');
console.log('|---:|---:|---:|---:|---:|---|');

for (const d of ranges) {
  const dt = new Date();
  const df = new Date(); df.setDate(df.getDate() - d);
  const dfs = df.toISOString().slice(0, 10);
  const dts = dt.toISOString().slice(0, 10);

  // Normalized
  const t0 = Date.now();
  const norm = await profitReportNormalized({ turso: db, companyId, dateFrom: dfs, dateTo: dts });
  const tNorm = Date.now() - t0;

  // JSON
  const t1 = Date.now();
  const r = await db.execute({
    sql: `SELECT id, date, items FROM sales
          WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?)
            AND status != 'cancelled'`,
    args: [companyId, dfs, dts],
  });
  let jsonCount = 0;
  let jsonSale = 0;
  for (const s of r.rows) {
    try {
      const items = JSON.parse(s.items || '[]');
      for (const it of items) {
        jsonCount++;
        jsonSale += (Number(it.price) || 0) * (Number(it.quantity) || 0);
      }
    } catch {}
  }
  const tJson = Date.now() - t1;

  const normSale = norm.reduce((s, x) => s + x.totalSale, 0);
  const ok = Math.abs(normSale - jsonSale) < 1 && norm.length === jsonCount ? '✓' : '✗';
  const speedup = tNorm > 0 ? (tJson / tNorm).toFixed(2) : '∞';
  console.log(`| ${d}d | ${norm.length} | ${tNorm} | ${tJson} | ${speedup}× | ${ok} |`);
}
