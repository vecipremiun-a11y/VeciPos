// FASE 4 · Validación de consistencia entre JSON y tablas normalizadas.
//
// Compara, para cada venta/compra:
//   · SUM(quantity*price) en sale_items  vs  total derivado del JSON
//   · count(items en JSON)               vs  count(filas en sale_items)
//   · idem para purchase_items
//
// Reporta:
//   · ventas/compras sin mirror (deberían estar migradas)
//   · diferencias > umbral por redondeo (default 1 centavo)
//   · stats globales y por empresa

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';

const args = process.argv.slice(2);
const SAMPLE_LIMIT = args.includes('--full') ? null : 5000;
const TOLERANCE = 0.5;

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const stamp = nowStamp();
const reportPath = path.join(REPORTS_DIR, `validate_phase4_${stamp}.json`);

console.log(`Fase 4 · Validación  sample=${SAMPLE_LIMIT ?? 'FULL'}  tolerance=${TOLERANCE}`);
console.log('='.repeat(60));

const out = { takenAt: new Date().toISOString(), sample: SAMPLE_LIMIT, tolerance: TOLERANCE };

// ─── 1. Row counts globales ──────────────────────────────────────────────
// Excluimos ventas/compras con items vacíos ('[]') — esas no necesitan mirror.
const salesRows = await db.execute(`
  SELECT COUNT(*) AS c FROM sales
  WHERE items IS NOT NULL AND items <> '' AND items <> '[]'
`);
const saleItemsRows = await db.execute(`SELECT COUNT(*) AS c FROM sale_items`);
const saleItemsDistinct = await db.execute(`SELECT COUNT(DISTINCT sale_id) AS c FROM sale_items`);
const purchasesRows = await db.execute(`
  SELECT COUNT(*) AS c FROM purchases
  WHERE items IS NOT NULL AND items <> '' AND items <> '[]'
`);
const purchaseItemsRows = await db.execute(`SELECT COUNT(*) AS c FROM purchase_items`);
const purchaseItemsDistinct = await db.execute(`SELECT COUNT(DISTINCT purchase_id) AS c FROM purchase_items`);

out.counts = {
  sales: {
    sales_with_items: Number(salesRows.rows[0].c),
    sale_items_rows: Number(saleItemsRows.rows[0].c),
    sale_items_distinct_sale_ids: Number(saleItemsDistinct.rows[0].c),
    coverage_pct: Number(salesRows.rows[0].c) === 0
      ? 100
      : (Number(saleItemsDistinct.rows[0].c) / Number(salesRows.rows[0].c) * 100).toFixed(2),
  },
  purchases: {
    purchases_with_items: Number(purchasesRows.rows[0].c),
    purchase_items_rows: Number(purchaseItemsRows.rows[0].c),
    purchase_items_distinct_purchase_ids: Number(purchaseItemsDistinct.rows[0].c),
    coverage_pct: Number(purchasesRows.rows[0].c) === 0
      ? 100
      : (Number(purchaseItemsDistinct.rows[0].c) / Number(purchasesRows.rows[0].c) * 100).toFixed(2),
  },
};
console.log('  Counts:');
console.log(JSON.stringify(out.counts, null, 2).split('\n').map(l => '    ' + l).join('\n'));

// ─── 2. Detectar ventas sin mirror ───────────────────────────────────────
const missingSales = await db.execute({
  sql: `SELECT id FROM sales
        WHERE items IS NOT NULL AND items <> '' AND items <> '[]'
          AND id NOT IN (SELECT sale_id FROM sale_items)
        ORDER BY id DESC LIMIT 50`,
  args: [],
});
out.missing_sales = {
  count_sample: missingSales.rows.length,
  ids: missingSales.rows.map(r => Number(r.id)),
};

const missingPurchases = await db.execute({
  sql: `SELECT id FROM purchases
        WHERE items IS NOT NULL AND items <> '' AND items <> '[]'
          AND id NOT IN (SELECT purchase_id FROM purchase_items)
        ORDER BY id DESC LIMIT 50`,
  args: [],
});
out.missing_purchases = {
  count_sample: missingPurchases.rows.length,
  ids: missingPurchases.rows.map(r => Number(r.id)),
};

console.log(`  Missing sales (sample): ${out.missing_sales.count_sample}`);
console.log(`  Missing purchases (sample): ${out.missing_purchases.count_sample}`);

// ─── 3. Comparación cuantitativa por sample (bulk-friendly) ──────────────
console.log('\n  Comparando totales JSON vs sale_items...');
const saleSample = await db.execute({
  sql: `SELECT id, total, items FROM sales
        WHERE items IS NOT NULL AND items <> ''
        ORDER BY id DESC
        LIMIT ?`,
  args: [SAMPLE_LIMIT ?? 1000000],
});

let salesOk = 0;
let salesDiff = 0;
let salesNoMirror = 0;
const salesDiffSamples = [];

// Bulk-fetch aggregates por sale_id en bloques de 200 IDs (mucho más rápido
// que 1 SELECT por venta).
const BULK_SIZE = 200;
for (let i = 0; i < saleSample.rows.length; i += BULK_SIZE) {
  const block = saleSample.rows.slice(i, i + BULK_SIZE);
  const ids = block.map(r => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const aggRes = await db.execute({
    sql: `SELECT sale_id, COUNT(*) AS c, COALESCE(SUM(line_total), 0) AS s
          FROM sale_items WHERE sale_id IN (${placeholders})
          GROUP BY sale_id`,
    args: ids,
  });
  const aggMap = new Map();
  for (const row of aggRes.rows) {
    aggMap.set(Number(row.sale_id), { c: Number(row.c), s: Number(row.s) });
  }
  for (const sale of block) {
    let items;
    try { items = JSON.parse(sale.items); } catch { continue; }
    if (!Array.isArray(items) || items.length === 0) continue;
    const jsonItemCount = items.filter(it => it && typeof it === 'object').length;
    const jsonLineSum = items.reduce((s, it) => {
      const q = Number(it?.quantity) || 0;
      const p = Number(it?.price) || 0;
      const d = Number(it?.discountPercent) || 0;
      return s + (q * p * (1 - d / 100));
    }, 0);
    const agg = aggMap.get(Number(sale.id));
    if (!agg) { salesNoMirror++; continue; }
    const diff = Math.abs(jsonLineSum - agg.s);
    if (agg.c !== jsonItemCount || diff > TOLERANCE) {
      salesDiff++;
      if (salesDiffSamples.length < 10) {
        salesDiffSamples.push({ sale_id: Number(sale.id), json_items: jsonItemCount, db_items: agg.c, json_sum: jsonLineSum, db_sum: agg.s, diff });
      }
    } else {
      salesOk++;
    }
  }
  if ((i + BULK_SIZE) % 1000 === 0) {
    console.log(`    ${Math.min(i + BULK_SIZE, saleSample.rows.length)}/${saleSample.rows.length}`);
  }
}

out.sales_comparison = { ok: salesOk, diff: salesDiff, no_mirror: salesNoMirror, samples: salesDiffSamples };
console.log(`  Sales OK=${salesOk}  DIFF=${salesDiff}  NO_MIRROR=${salesNoMirror}`);

// ─── 4. Comparación purchase ─────────────────────────────────────────────
console.log('\n  Comparando totales JSON vs purchase_items...');
const purSample = await db.execute({
  sql: `SELECT id, total, items FROM purchases
        WHERE items IS NOT NULL AND items <> ''
        ORDER BY id DESC
        LIMIT ?`,
  args: [SAMPLE_LIMIT ?? 1000000],
});

let purOk = 0;
let purDiff = 0;
let purNoMirror = 0;
const purDiffSamples = [];

for (let i = 0; i < purSample.rows.length; i += BULK_SIZE) {
  const block = purSample.rows.slice(i, i + BULK_SIZE);
  const ids = block.map(r => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const aggRes = await db.execute({
    sql: `SELECT purchase_id, COUNT(*) AS c, COALESCE(SUM(line_total), 0) AS s
          FROM purchase_items WHERE purchase_id IN (${placeholders})
          GROUP BY purchase_id`,
    args: ids,
  });
  const aggMap = new Map();
  for (const row of aggRes.rows) aggMap.set(Number(row.purchase_id), { c: Number(row.c), s: Number(row.s) });
  for (const p of block) {
    let items;
    try { items = JSON.parse(p.items); } catch { continue; }
    if (!Array.isArray(items) || items.length === 0) continue;
    const jsonItemCount = items.filter(it => it && typeof it === 'object').length;
    const jsonLineSum = items.reduce((s, it) => {
      const q = Number(it?.quantity) || 0;
      const c = Number(it?.cost) || 0;
      const t = Number(it?.total);
      return s + (Number.isFinite(t) ? t : q * c);
    }, 0);
    const agg = aggMap.get(Number(p.id));
    if (!agg) { purNoMirror++; continue; }
    const diff = Math.abs(jsonLineSum - agg.s);
    if (agg.c !== jsonItemCount || diff > TOLERANCE) {
      purDiff++;
      if (purDiffSamples.length < 10) {
        purDiffSamples.push({ purchase_id: Number(p.id), json_items: jsonItemCount, db_items: agg.c, json_sum: jsonLineSum, db_sum: agg.s, diff });
      }
    } else {
      purOk++;
    }
  }
}

out.purchases_comparison = { ok: purOk, diff: purDiff, no_mirror: purNoMirror, samples: purDiffSamples };
console.log(`  Purchases OK=${purOk}  DIFF=${purDiff}  NO_MIRROR=${purNoMirror}`);

// ─── 5. Distribución por empresa ─────────────────────────────────────────
const perCompany = await db.execute(`
  SELECT company_id, COUNT(*) AS sale_items_rows, COUNT(DISTINCT sale_id) AS sales_with_mirror
  FROM sale_items GROUP BY company_id ORDER BY sale_items_rows DESC
`);
out.sale_items_per_company = perCompany.rows.map(r => ({
  company_id: r.company_id,
  sale_items_rows: Number(r.sale_items_rows),
  sales_with_mirror: Number(r.sales_with_mirror),
}));

const perCompanyP = await db.execute(`
  SELECT company_id, COUNT(*) AS purchase_items_rows, COUNT(DISTINCT purchase_id) AS purchases_with_mirror
  FROM purchase_items GROUP BY company_id ORDER BY purchase_items_rows DESC
`);
out.purchase_items_per_company = perCompanyP.rows.map(r => ({
  company_id: r.company_id,
  purchase_items_rows: Number(r.purchase_items_rows),
  purchases_with_mirror: Number(r.purchases_with_mirror),
}));

fs.writeFileSync(reportPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`\nReporte: ${reportPath}`);
process.exit(0);
