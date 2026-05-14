// FASE 5.5 · Backfill incremental robusto.
//
// Mejora sobre scripts/optim/phase5/05-incremental-backfill.mjs:
//   · Flags: --since=N (días) | --max=N | --health-check | --json | --quiet
//   · Modo health-check: solo reporta el gap, no escribe
//   · Manifest JSON con resultado del último run (para cron/monitoreo externo)
//   · Salida JSON estructurada para integraciones (Vercel cron, Datadog, etc.)
//   · Exit codes:
//        0  → todo OK / gap pequeño / dry-run OK
//        2  → gap detectado pero no se reparó (modo --health-check)
//        3  → errores durante el backfill
//
// IDEMPOTENTE (INSERT OR IGNORE) — seguro de correr cada N horas en cron.
//
// Uso típico:
//   node scripts/optim/phase5_5/02-backfill-robust.mjs                  # reparar todo
//   node scripts/optim/phase5_5/02-backfill-robust.mjs --health-check   # solo reportar
//   node scripts/optim/phase5_5/02-backfill-robust.mjs --since=3        # solo últimos 3 días
//   node scripts/optim/phase5_5/02-backfill-robust.mjs --json           # output JSON

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../_client.mjs';
import { mirrorSaleItems, mirrorPurchaseItems } from '../../../src/lib/itemNormalization.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, 'last-backfill.json');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.startsWith('--') ? a.slice(2).split('=') : [a, true];
  args.set(k, v === undefined ? true : v);
}

const HEALTH_CHECK = args.has('health-check');
const DRY = args.has('dry');
const JSON_OUT = args.has('json');
const QUIET = args.has('quiet');
const MAX = Number(args.get('max') || 5000);
const SINCE_DAYS = args.get('since') ? Number(args.get('since')) : null;

function log(...x) { if (!QUIET && !JSON_OUT) console.log(...x); }

const sinceClause = SINCE_DAYS != null
  ? `AND date(s.date) >= date('now','-${SINCE_DAYS} day')`
  : '';
const sincePurClause = SINCE_DAYS != null
  ? `AND date(p.date) >= date('now','-${SINCE_DAYS} day')`
  : '';

const t0 = Date.now();
log(`Modo: ${HEALTH_CHECK ? 'HEALTH-CHECK' : DRY ? 'DRY' : 'LIVE'}   since: ${SINCE_DAYS ?? 'all'}   max: ${MAX}`);

// ─── Buscar gap ───────────────────────────────────────────────────────────
async function findGapSales() {
  const r = await db.execute(`
    SELECT s.id, s.company_id, s.date, s.items
    FROM sales s
    WHERE s.status != 'cancelled'
      AND s.items IS NOT NULL AND s.items != '[]'
      ${sinceClause}
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)
    ORDER BY s.id DESC LIMIT ${MAX}
  `);
  return r.rows;
}

async function findGapPurchases() {
  const r = await db.execute(`
    SELECT p.id, p.company_id, p.date, p.items
    FROM purchases p
    WHERE p.items IS NOT NULL AND p.items != '[]'
      ${sincePurClause}
      AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id)
    ORDER BY p.id DESC LIMIT ${MAX}
  `);
  return r.rows;
}

const gapSales = await findGapSales();
const gapPurchases = await findGapPurchases();

const summary = {
  ts: new Date().toISOString(),
  mode: HEALTH_CHECK ? 'health-check' : DRY ? 'dry' : 'live',
  sinceDays: SINCE_DAYS,
  gap: { sales: gapSales.length, purchases: gapPurchases.length },
  mirrored: { sales: 0, purchases: 0 },
  itemsInserted: { sales: 0, purchases: 0 },
  errors: { sales: 0, purchases: 0 },
  durationMs: 0,
  exitCode: 0,
};

log(`Gap ventas: ${gapSales.length}   gap compras: ${gapPurchases.length}`);

if (HEALTH_CHECK) {
  summary.durationMs = Date.now() - t0;
  if (gapSales.length > 0 || gapPurchases.length > 0) {
    summary.exitCode = 2;
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(summary, null, 2));
  if (JSON_OUT) console.log(JSON.stringify(summary));
  process.exit(summary.exitCode);
}

// ─── Reparar ──────────────────────────────────────────────────────────────
async function process_(rows, kind) {
  const isSales = kind === 'sales';
  const mirror = isSales ? mirrorSaleItems : mirrorPurchaseItems;
  let mirrored = 0;
  let items = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let parsed;
    try { parsed = JSON.parse(r.items || '[]'); }
    catch { errors++; continue; }
    if (!Array.isArray(parsed) || parsed.length === 0) continue;

    if (DRY) { mirrored++; items += parsed.length; continue; }

    try {
      const result = isSales
        ? await mirror(db, { saleId: r.id, companyId: r.company_id, saleDate: r.date, items: parsed, source: 'backfill_inc' })
        : await mirror(db, { purchaseId: r.id, companyId: r.company_id, purchaseDate: r.date, items: parsed, source: 'backfill_inc' });
      mirrored++;
      items += result?.inserted || 0;
    } catch (e) {
      errors++;
      log(`  ❌ ${kind}#${r.id}: ${e?.message || e}`);
    }
    if ((i + 1) % 50 === 0) log(`  ${kind} ${i + 1}/${rows.length}`);
  }
  return { mirrored, items, errors };
}

if (gapSales.length > 0) {
  log(`\nReparando ${gapSales.length} ventas...`);
  const r = await process_(gapSales, 'sales');
  summary.mirrored.sales = r.mirrored;
  summary.itemsInserted.sales = r.items;
  summary.errors.sales = r.errors;
}

if (gapPurchases.length > 0) {
  log(`\nReparando ${gapPurchases.length} compras...`);
  const r = await process_(gapPurchases, 'purchases');
  summary.mirrored.purchases = r.mirrored;
  summary.itemsInserted.purchases = r.items;
  summary.errors.purchases = r.errors;
}

summary.durationMs = Date.now() - t0;
if (summary.errors.sales > 0 || summary.errors.purchases > 0) {
  summary.exitCode = 3;
}

try { fs.writeFileSync(MANIFEST_PATH, JSON.stringify(summary, null, 2)); } catch {}

log(`\nResumen:`);
log(`  Ventas reparadas:  ${summary.mirrored.sales}  items: ${summary.itemsInserted.sales}  errores: ${summary.errors.sales}`);
log(`  Compras reparadas: ${summary.mirrored.purchases}  items: ${summary.itemsInserted.purchases}  errores: ${summary.errors.purchases}`);
log(`  Tiempo: ${(summary.durationMs / 1000).toFixed(1)}s`);
log(`  Manifest: ${MANIFEST_PATH}`);

if (JSON_OUT) console.log(JSON.stringify(summary));
process.exit(summary.exitCode);
