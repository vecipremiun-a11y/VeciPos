// Benchmark final · simula exactamente lo que hace ProductProfile.jsx
// para 5 productos distintos y reporta speedup real promedio.
import { db } from '../_client.mjs';
import {
  productSalesHistoryNormalized,
  productSalesHistoryViaJson,
  productPurchasesHistoryNormalized,
  productPurchasesHistoryViaJson,
} from '../../../src/lib/analyticsQueries.js';

const cos = await db.execute(`SELECT company_id FROM sale_items GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1`);
const companyId = cos.rows[0].company_id;

// Top 5 productos con buen volumen para una prueba realista
const pids = await db.execute({
  sql: `SELECT product_id, MAX(name) AS name, COUNT(*) AS c
        FROM sale_items WHERE company_id = ? AND product_id IS NOT NULL
        GROUP BY product_id HAVING c BETWEEN 50 AND 500
        ORDER BY RANDOM() LIMIT 5`,
  args: [companyId],
});

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = today.toISOString().slice(0, 10);

console.log(`\nEmpresa: ${companyId}   rango: ${monthStart} → ${monthEnd}\n`);
console.log('| Producto | Sales JSON | Sales Norm | Speed Sales | Purch JSON | Purch Norm | Speed Purch |');
console.log('|---|---:|---:|---:|---:|---:|---:|');

const acc = { salesJ: 0, salesN: 0, purchJ: 0, purchN: 0 };
for (const p of pids.rows) {
  const ctx = { turso: db, companyId, productId: Number(p.product_id), dateFrom: monthStart, dateTo: monthEnd };

  const tSN = Date.now(); await productSalesHistoryNormalized({ ...ctx, limit: 200 }); const sNorm = Date.now() - tSN;
  const tSJ = Date.now(); await productSalesHistoryViaJson({ ...ctx, limit: 200 }); const sJson = Date.now() - tSJ;
  const tPN = Date.now(); await productPurchasesHistoryNormalized({ ...ctx, limit: 100 }); const pNorm = Date.now() - tPN;
  const tPJ = Date.now(); await productPurchasesHistoryViaJson({ ...ctx, limit: 100 }); const pJson = Date.now() - tPJ;

  acc.salesJ += sJson; acc.salesN += sNorm;
  acc.purchJ += pJson; acc.purchN += pNorm;

  const nameShort = (p.name || '').slice(0, 25);
  const speedS = sNorm > 0 ? (sJson / sNorm).toFixed(2) : '∞';
  const speedP = pNorm > 0 ? (pJson / pNorm).toFixed(2) : '∞';
  console.log(`| ${nameShort} | ${sJson} | ${sNorm} | ${speedS}× | ${pJson} | ${pNorm} | ${speedP}× |`);
}

console.log('\n**Totales promedio:**');
console.log(`  Sales: JSON=${(acc.salesJ/5).toFixed(0)}ms  Norm=${(acc.salesN/5).toFixed(0)}ms  speedup=${(acc.salesJ/acc.salesN).toFixed(2)}×`);
console.log(`  Purchases: JSON=${(acc.purchJ/5).toFixed(0)}ms  Norm=${(acc.purchN/5).toFixed(0)}ms  speedup=${(acc.purchJ/acc.purchN).toFixed(2)}×`);
