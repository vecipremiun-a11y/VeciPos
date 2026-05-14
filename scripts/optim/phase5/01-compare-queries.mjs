// FASE 5 · Comparativa de paridad y rendimiento — JSON vs Normalizado.
//
// Ejecuta ambas versiones para los queries analíticos y reporta:
//   · counts (filas devueltas)
//   · tiempos (ms)
//   · speedup (b/a)
//   · paridad de valores principales (totales por producto)
//
// SOLO LEE de la BD. No modifica nada.

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';
import {
  productSalesHistoryNormalized,
  productSalesHistoryViaJson,
  productPurchasesHistoryNormalized,
  productPurchasesHistoryViaJson,
  profitReportNormalized,
  topProductsByRevenue,
  compareResults,
} from '../../../src/lib/analyticsQueries.js';

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const stamp = nowStamp();
const reportPath = path.join(REPORTS_DIR, `phase5_compare_${stamp}.md`);
const lines = [];
lines.push(`# Fase 5 · Comparativa JSON vs Normalizado`);
lines.push(`*${new Date().toISOString()}*`);
lines.push('');

// 1) Encontrar una empresa y un producto con buen volumen de datos
const cos = await db.execute(`
  SELECT company_id, COUNT(*) AS c FROM sale_items
  GROUP BY company_id ORDER BY c DESC LIMIT 1
`);
const companyId = cos.rows[0]?.company_id;
if (!companyId) {
  console.log('No hay datos en sale_items');
  process.exit(0);
}
lines.push(`**Empresa:** \`${companyId}\``);

const topProd = await db.execute({
  sql: `SELECT product_id, MAX(name) AS name, COUNT(*) AS c
        FROM sale_items
        WHERE company_id = ? AND product_id IS NOT NULL
        GROUP BY product_id ORDER BY c DESC LIMIT 5`,
  args: [companyId],
});
lines.push(`\n**Top 5 productos por # ventas (para histórico):**`);
for (const r of topProd.rows) lines.push(`- product_id=${r.product_id} (${r.c} líneas) — ${r.name}`);

const productId = Number(topProd.rows[0].product_id);
const dateFrom = '2026-01-01';
const dateTo = '2026-12-31';

lines.push(`\n---\n`);

// ─── A. productSalesHistory ───────────────────────────────────────────────
lines.push(`## A. productSalesHistory — product_id=${productId} (${dateFrom} → ${dateTo})\n`);
const A = await compareResults({
  name: 'productSalesHistory',
  normalized: () => productSalesHistoryNormalized({ turso: db, companyId, productId, dateFrom, dateTo, limit: 1000 }),
  viaJson:    () => productSalesHistoryViaJson({ turso: db, companyId, productId, dateFrom, dateTo, limit: 1000 }),
  keyFn: r => r.sale_id,
  valueFn: r => Number(r.quantity) || 0,
});
console.log('A·', JSON.stringify(A));
lines.push('```json');
lines.push(JSON.stringify(A, null, 2));
lines.push('```\n');

// ─── B. productPurchasesHistory ───────────────────────────────────────────
// Buscar producto con compras
const prodWithPurchases = await db.execute({
  sql: `SELECT product_id FROM purchase_items
        WHERE company_id = ? AND product_id IS NOT NULL
        GROUP BY product_id ORDER BY COUNT(*) DESC LIMIT 1`,
  args: [companyId],
});
const pId2 = Number(prodWithPurchases.rows[0]?.product_id || productId);
lines.push(`## B. productPurchasesHistory — product_id=${pId2}\n`);
const B = await compareResults({
  name: 'productPurchasesHistory',
  normalized: () => productPurchasesHistoryNormalized({ turso: db, companyId, productId: pId2, dateFrom: '2025-01-01', dateTo: '2026-12-31', limit: 500 }),
  viaJson:    () => productPurchasesHistoryViaJson({ turso: db, companyId, productId: pId2, dateFrom: '2025-01-01', dateTo: '2026-12-31', limit: 500 }),
  keyFn: r => r.purchase_id,
  valueFn: r => Number(r.quantity) || 0,
});
console.log('B·', JSON.stringify(B));
lines.push('```json');
lines.push(JSON.stringify(B, null, 2));
lines.push('```\n');

// ─── C. profitReport (line items) ─────────────────────────────────────────
lines.push(`## C. profitReport (mes actual)\n`);
const lastMonth = new Date();
lastMonth.setMonth(lastMonth.getMonth() - 1);
const dfC = lastMonth.toISOString().slice(0, 10);
const dtC = new Date().toISOString().slice(0, 10);

const tStartNorm = Date.now();
const reportNorm = await profitReportNormalized({ turso: db, companyId, dateFrom: dfC, dateTo: dtC });
const tNorm = Date.now() - tStartNorm;

// JSON version: emular lo que hace SalesProfitReport.jsx
const tStartJson = Date.now();
const salesRes = await db.execute({
  sql: `SELECT id, date, items FROM sales
        WHERE company_id = ? AND date(date) BETWEEN date(?) AND date(?)
          AND status != 'cancelled'`,
  args: [companyId, dfC, dtC],
});
const reportJson = [];
for (const s of salesRes.rows) {
  let items;
  try { items = JSON.parse(s.items || '[]'); } catch { continue; }
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.price) || 0;
    const cost = Number(it.cost) || 0;
    reportJson.push({
      saleId: s.id,
      saleDate: s.date,
      productName: it.name,
      quantity: qty,
      totalSale: price * qty,
      totalCost: cost * qty,
      totalProfit: (price - cost) * qty,
    });
  }
}
const tJson = Date.now() - tStartJson;

const sumNormSale = reportNorm.reduce((s, r) => s + r.totalSale, 0);
const sumJsonSale = reportJson.reduce((s, r) => s + r.totalSale, 0);
const sumNormProfit = reportNorm.reduce((s, r) => s + r.totalProfit, 0);
const sumJsonProfit = reportJson.reduce((s, r) => s + r.totalProfit, 0);

const cReport = {
  rango: { from: dfC, to: dtC },
  counts: { normalized: reportNorm.length, viaJson: reportJson.length },
  times_ms: { normalized: tNorm, viaJson: tJson, speedup: tNorm > 0 ? +(tJson / tNorm).toFixed(2) : null },
  totals: {
    sales:  { norm: Math.round(sumNormSale),   json: Math.round(sumJsonSale),   diff: Math.round(sumNormSale - sumJsonSale) },
    profit: { norm: Math.round(sumNormProfit), json: Math.round(sumJsonProfit), diff: Math.round(sumNormProfit - sumJsonProfit) },
  },
  paridad: Math.abs(reportNorm.length - reportJson.length) <= 5
            && Math.abs(sumNormSale - sumJsonSale) < 1
            ? 'OK' : 'DIFF',
};
console.log('C·', JSON.stringify(cReport));
lines.push('```json');
lines.push(JSON.stringify(cReport, null, 2));
lines.push('```\n');

// ─── D. topProductsByRevenue ──────────────────────────────────────────────
lines.push(`## D. topProductsByRevenue (mes actual, top 10)\n`);
const tStartT = Date.now();
const top = await topProductsByRevenue({ turso: db, companyId, dateFrom: dfC, dateTo: dtC, limit: 10 });
const tTop = Date.now() - tStartT;
lines.push(`Time: ${tTop} ms · ${top.length} filas`);
lines.push('| product_id | name | qty | revenue | profit |');
lines.push('|---|---|---:|---:|---:|');
for (const r of top) {
  lines.push(`| ${r.product_id} | ${(r.name||'').slice(0,40)} | ${r.total_qty} | ${Math.round(r.total_revenue)} | ${Math.round(r.total_profit)} |`);
}
lines.push('');

fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(`\nReporte: ${reportPath}`);
