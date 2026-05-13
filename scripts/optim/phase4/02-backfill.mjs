// FASE 4 · Backfill histórico desde sales.items / purchases.items JSON
// hacia sale_items / purchase_items.
//
// Características:
//   · Idempotente: detecta sale_ids ya migrados y los salta.
//   · Por lotes (CHUNK_SIZE) para no bloquear ni saturar Turso.
//   · Tolerante a errores: una venta corrupta no detiene la migración.
//   · Resumible: se puede ejecutar varias veces; sigue donde quedó.
//   · Logs cada N filas con progreso.
//   · NO modifica sales / purchases originales. NO toca JSON.
//
// Uso:
//   node scripts/optim/phase4/02-backfill.mjs                  # sales + purchases
//   node scripts/optim/phase4/02-backfill.mjs sales            # solo ventas
//   node scripts/optim/phase4/02-backfill.mjs purchases        # solo compras
//   node scripts/optim/phase4/02-backfill.mjs --dry            # vista previa
//   node scripts/optim/phase4/02-backfill.mjs --chunk 100      # tamaño lote

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const chunkArgIdx = args.indexOf('--chunk');
const CHUNK_SIZE = chunkArgIdx >= 0 ? Number(args[chunkArgIdx + 1]) || 50 : 50;
const target = args.find(a => a === 'sales' || a === 'purchases') || 'both';

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const stamp = nowStamp();
const reportPath = path.join(REPORTS_DIR, `backfill_${target}_${stamp}.json`);

console.log(`Fase 4 · Backfill ${target}${DRY ? ' (DRY-RUN)' : ''}  chunk=${CHUNK_SIZE}`);
console.log('='.repeat(60));

// ─── Normalización (espejo exacto de src/lib/itemNormalization.js) ────────
// Mantenida acá inline para que el script funcione standalone sin imports
// del bundle de la app.
function normalizeItemId(rawId, isComboFlag) {
  if (rawId === undefined || rawId === null) {
    return { productId: null, productRef: null, isCombo: !!isComboFlag };
  }
  const str = String(rawId);
  if (str.startsWith('combo_')) {
    return { productId: null, productRef: str, isCombo: true };
  }
  const n = Number(rawId);
  if (Number.isFinite(n) && Number.isInteger(n)) {
    return { productId: n, productRef: null, isCombo: !!isComboFlag };
  }
  return { productId: null, productRef: str, isCombo: !!isComboFlag };
}

function buildSaleItemRows(sale) {
  let items;
  try { items = JSON.parse(sale.items || '[]'); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const now = new Date().toISOString();
  let seq = 0;
  return items
    .filter(it => it && typeof it === 'object')
    .map(it => {
      const { productId, productRef, isCombo } = normalizeItemId(it.id, it.is_combo);
      const quantity = Number(it.quantity) || 0;
      const price = Number(it.price) || 0;
      const cost = Number(it.cost) || 0;
      const taxRate = Number(it.tax_rate) || 0;
      const discountPct = Number(it.discountPercent) || 0;
      const lineTotal = quantity * price * (1 - discountPct / 100);
      return {
        sale_id: sale.id,
        company_id: sale.company_id,
        product_id: productId,
        product_ref: productRef,
        sku: it.sku || null,
        name: it.name || null,
        quantity,
        price,
        cost,
        tax_rate: taxRate,
        discount_pct: discountPct,
        line_total: lineTotal,
        is_combo: isCombo ? 1 : 0,
        sale_date: sale.date,
        created_at: now,
        source: 'backfill',
        seq: seq++,
      };
    });
}

function buildPurchaseItemRows(purchase) {
  let items;
  try { items = JSON.parse(purchase.items || '[]'); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const now = new Date().toISOString();
  let seq = 0;
  return items
    .filter(it => it && typeof it === 'object')
    .map(it => {
      const { productId, productRef } = normalizeItemId(it.id, false);
      const quantity = Number(it.quantity) || 0;
      const cost = Number(it.cost) || 0;
      const price = Number(it.price) || 0;
      const taxRate = Number(it.tax ?? it.tax_rate) || 0;
      const lineTotal = Number(it.total) || (quantity * cost);
      return {
        purchase_id: purchase.id,
        company_id: purchase.company_id,
        product_id: productId,
        product_ref: productRef,
        sku: it.sku || null,
        name: it.name || null,
        quantity,
        cost,
        price,
        tax_rate: taxRate,
        line_total: lineTotal,
        batch_number: it.batchNumber || null,
        expiry_date: it.expiryDate || null,
        purchase_date: purchase.date,
        created_at: now,
        source: 'backfill',
        seq: seq++,
      };
    });
}

// ─── Backfill SALES ───────────────────────────────────────────────────────
async function backfillSales() {
  console.log('\n── SALES ──');
  // 1. Total de ventas
  const totalRes = await db.execute(`
    SELECT COUNT(*) AS c FROM sales WHERE items IS NOT NULL AND items <> ''
  `);
  const total = Number(totalRes.rows[0].c);

  // 2. IDs ya migrados (DISTINCT sale_id en sale_items)
  const migratedRes = await db.execute(`SELECT DISTINCT sale_id FROM sale_items`);
  const migrated = new Set(migratedRes.rows.map(r => Number(r.sale_id)));

  console.log(`  Total ventas con items: ${total}`);
  console.log(`  Ya migradas: ${migrated.size}`);
  console.log(`  Pendientes: ${total - migrated.size}`);

  if (DRY) return { table: 'sales', total, migrated: migrated.size, pending: total - migrated.size, dry: true };

  let offset = 0;
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const errorSamples = [];

  while (true) {
    const res = await db.execute({
      sql: `SELECT id, company_id, date, items
            FROM sales
            WHERE items IS NOT NULL AND items <> ''
            ORDER BY id
            LIMIT ? OFFSET ?`,
      args: [CHUNK_SIZE, offset],
    });
    if (res.rows.length === 0) break;

    // Acumulamos todas las queries del chunk en UN solo batch (mucho más rápido
    // que un batch por venta — antes hacíamos N round-trips, ahora hacemos 1).
    // Turso soporta cientos de statements por batch; cortamos cada 100 para
    // estar seguros y mantener buena progresividad.
    const BATCH_LIMIT = 100;
    let pendingQueries = [];
    let pendingSaleIds = [];

    const flush = async () => {
      if (pendingQueries.length === 0) return;
      try {
        await db.batch(pendingQueries);
        inserted += pendingQueries.length;
        for (const sid of pendingSaleIds) migrated.add(sid);
      } catch (e) {
        // Si el batch falla, marcamos error sobre todas las ventas del batch
        // (no podemos saber cuál fue la culpable sin reintentar 1×1).
        errors += pendingSaleIds.length;
        if (errorSamples.length < 10) {
          errorSamples.push({ batch_size: pendingQueries.length, sample_sale_ids: pendingSaleIds.slice(0, 5), error: e.message });
        }
      }
      pendingQueries = [];
      pendingSaleIds = [];
    };

    for (const sale of res.rows) {
      processed++;
      if (migrated.has(Number(sale.id))) { skipped++; continue; }
      const rows = buildSaleItemRows(sale);
      if (rows.length === 0) { skipped++; continue; }
      for (const r of rows) {
        pendingQueries.push({
          sql: `INSERT OR IGNORE INTO sale_items
                  (sale_id, company_id, product_id, product_ref, sku, name,
                   quantity, price, cost, tax_rate, discount_pct, line_total,
                   is_combo, sale_date, created_at, source, seq)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            r.sale_id, r.company_id, r.product_id, r.product_ref, r.sku, r.name,
            r.quantity, r.price, r.cost, r.tax_rate, r.discount_pct, r.line_total,
            r.is_combo, r.sale_date, r.created_at, r.source, r.seq,
          ],
        });
      }
      pendingSaleIds.push(Number(sale.id));
      if (pendingQueries.length >= BATCH_LIMIT) await flush();
    }
    await flush();

    offset += res.rows.length;
    console.log(`  ${processed}/${total} ventas · insertadas: ${inserted} · skip: ${skipped} · err: ${errors}`);
  }

  console.log(`\n  ✅ sales done — processed=${processed} inserted=${inserted} skipped=${skipped} errors=${errors}`);
  return { table: 'sales', processed, inserted, skipped, errors, errorSamples };
}

// ─── Backfill PURCHASES ───────────────────────────────────────────────────
async function backfillPurchases() {
  console.log('\n── PURCHASES ──');
  const totalRes = await db.execute(`
    SELECT COUNT(*) AS c FROM purchases WHERE items IS NOT NULL AND items <> ''
  `);
  const total = Number(totalRes.rows[0].c);

  const migratedRes = await db.execute(`SELECT DISTINCT purchase_id FROM purchase_items`);
  const migrated = new Set(migratedRes.rows.map(r => Number(r.purchase_id)));

  console.log(`  Total compras con items: ${total}`);
  console.log(`  Ya migradas: ${migrated.size}`);
  console.log(`  Pendientes: ${total - migrated.size}`);

  if (DRY) return { table: 'purchases', total, migrated: migrated.size, pending: total - migrated.size, dry: true };

  let offset = 0;
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const errorSamples = [];

  while (true) {
    const res = await db.execute({
      sql: `SELECT id, company_id, date, items
            FROM purchases
            WHERE items IS NOT NULL AND items <> ''
            ORDER BY id
            LIMIT ? OFFSET ?`,
      args: [CHUNK_SIZE, offset],
    });
    if (res.rows.length === 0) break;

    const BATCH_LIMIT = 100;
    let pendingQueries = [];
    let pendingPurchaseIds = [];

    const flush = async () => {
      if (pendingQueries.length === 0) return;
      try {
        await db.batch(pendingQueries);
        inserted += pendingQueries.length;
        for (const pid of pendingPurchaseIds) migrated.add(pid);
      } catch (e) {
        errors += pendingPurchaseIds.length;
        if (errorSamples.length < 10) {
          errorSamples.push({ batch_size: pendingQueries.length, sample_purchase_ids: pendingPurchaseIds.slice(0, 5), error: e.message });
        }
      }
      pendingQueries = [];
      pendingPurchaseIds = [];
    };

    for (const p of res.rows) {
      processed++;
      if (migrated.has(Number(p.id))) { skipped++; continue; }
      const rows = buildPurchaseItemRows(p);
      if (rows.length === 0) { skipped++; continue; }
      for (const r of rows) {
        pendingQueries.push({
          sql: `INSERT OR IGNORE INTO purchase_items
                  (purchase_id, company_id, product_id, product_ref, sku, name,
                   quantity, cost, price, tax_rate, line_total,
                   batch_number, expiry_date, purchase_date, created_at, source, seq)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            r.purchase_id, r.company_id, r.product_id, r.product_ref, r.sku, r.name,
            r.quantity, r.cost, r.price, r.tax_rate, r.line_total,
            r.batch_number, r.expiry_date, r.purchase_date, r.created_at, r.source, r.seq,
          ],
        });
      }
      pendingPurchaseIds.push(Number(p.id));
      if (pendingQueries.length >= BATCH_LIMIT) await flush();
    }
    await flush();

    offset += res.rows.length;
    console.log(`  ${processed}/${total} compras · insertadas: ${inserted} · skip: ${skipped} · err: ${errors}`);
  }

  console.log(`\n  ✅ purchases done — processed=${processed} inserted=${inserted} skipped=${skipped} errors=${errors}`);
  return { table: 'purchases', processed, inserted, skipped, errors, errorSamples };
}

// ─── Main ────────────────────────────────────────────────────────────────
const results = [];
const t0 = Date.now();
try {
  if (target === 'sales' || target === 'both') {
    results.push(await backfillSales());
  }
  if (target === 'purchases' || target === 'both') {
    results.push(await backfillPurchases());
  }
} catch (e) {
  console.error('\n❌ Backfill aborted:', e.message);
  results.push({ aborted: true, error: e.message });
}

const elapsed = Date.now() - t0;
fs.writeFileSync(
  reportPath,
  JSON.stringify({ takenAt: new Date().toISOString(), target, dry: DRY, chunkSize: CHUNK_SIZE, elapsed_ms: elapsed, results }, null, 2),
  'utf8'
);

console.log(`\n⏱ ${elapsed} ms total`);
console.log(`Reporte: ${reportPath}`);
process.exit(0);
