// FASE 5 · Backfill incremental — completa el mirror de las ventas que
// se hayan creado por clientes con cache viejo (service worker que aún no
// tiene el código de mirror).
//
// Estrategia:
//   1. Encontrar ventas (status != cancelled) sin mirror en sale_items
//   2. Por cada venta, parsear sus items y hacer mirrorSaleItems INSERT OR IGNORE
//   3. Mismo proceso para compras
//
// IDEMPOTENTE: INSERT OR IGNORE + UNIQUE(sale_id, seq) garantizan que múltiples
// runs no insertan duplicados.

import { db } from '../_client.mjs';
import { mirrorSaleItems, mirrorPurchaseItems } from '../../../src/lib/itemNormalization.js';

const MAX_PER_RUN = Number(process.argv.find(a => a.startsWith('--max='))?.split('=')[1]) || 5000;
const DRY = process.argv.includes('--dry');

async function gapSales() {
  const r = await db.execute(`
    SELECT s.id, s.company_id, s.date, s.items
    FROM sales s
    WHERE s.status != 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
      AND s.items IS NOT NULL
      AND s.items != '[]'
    ORDER BY s.id DESC
    LIMIT ${MAX_PER_RUN}
  `);
  return r.rows;
}

async function gapPurchases() {
  const r = await db.execute(`
    SELECT p.id, p.company_id, p.date, p.items
    FROM purchases p
    WHERE NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id)
      AND p.items IS NOT NULL
      AND p.items != '[]'
    ORDER BY p.id DESC
    LIMIT ${MAX_PER_RUN}
  `);
  return r.rows;
}

console.log(`Modo: ${DRY ? 'DRY (no inserta)' : 'LIVE'}  max/run: ${MAX_PER_RUN}`);

console.log('\n→ Buscando ventas sin mirror...');
const sales = await gapSales();
console.log(`  Encontradas: ${sales.length}`);

let mirroredSales = 0;
let errorsSales = 0;
let itemsInserted = 0;
const t0 = Date.now();
for (let i = 0; i < sales.length; i++) {
  const s = sales[i];
  let items;
  try { items = JSON.parse(s.items || '[]'); } catch { errorsSales++; continue; }
  if (!Array.isArray(items) || items.length === 0) continue;
  if (DRY) { mirroredSales++; itemsInserted += items.length; continue; }
  try {
    const r = await mirrorSaleItems(db, {
      saleId: s.id,
      companyId: s.company_id,
      saleDate: s.date,
      items,
      source: 'backfill_inc',
    });
    mirroredSales++;
    itemsInserted += r.inserted || 0;
  } catch (e) {
    errorsSales++;
    console.error(`  ❌ sale_id=${s.id}:`, e?.message || e);
  }
  if ((i + 1) % 50 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${i+1}/${sales.length} (${elapsed}s)`);
  }
}
console.log(`✔ Ventas mirroreadas: ${mirroredSales}  items: ${itemsInserted}  errores: ${errorsSales}`);

console.log('\n→ Buscando compras sin mirror...');
const purchases = await gapPurchases();
console.log(`  Encontradas: ${purchases.length}`);

let mirroredPurchases = 0;
let errorsPurchases = 0;
let pItemsInserted = 0;
for (let i = 0; i < purchases.length; i++) {
  const p = purchases[i];
  let items;
  try { items = JSON.parse(p.items || '[]'); } catch { errorsPurchases++; continue; }
  if (!Array.isArray(items) || items.length === 0) continue;
  if (DRY) { mirroredPurchases++; pItemsInserted += items.length; continue; }
  try {
    const r = await mirrorPurchaseItems(db, {
      purchaseId: p.id,
      companyId: p.company_id,
      purchaseDate: p.date,
      items,
      source: 'backfill_inc',
    });
    mirroredPurchases++;
    pItemsInserted += r.inserted || 0;
  } catch (e) {
    errorsPurchases++;
    console.error(`  ❌ purchase_id=${p.id}:`, e?.message || e);
  }
}
console.log(`✔ Compras mirroreadas: ${mirroredPurchases}  items: ${pItemsInserted}  errores: ${errorsPurchases}`);

const totalSecs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nTiempo total: ${totalSecs}s`);
