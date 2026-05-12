// FASE 1 · Paso 3
// EXPLAIN QUERY PLAN para queries críticas. SOLO LECTURA.
//
// Uso:
//   node scripts/optim/phase1/03-explain-queries.mjs              -> usa marker "before"
//   node scripts/optim/phase1/03-explain-queries.mjs after        -> marca el snapshot como "after"
//
// El reporte permite comparar el plan ANTES y DESPUÉS de aplicar índices (fase 2).

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';

const marker = process.argv[2] || 'before';
const stamp = nowStamp();
fs.mkdirSync(REPORTS_DIR, { recursive: true });
const outTxt = path.join(REPORTS_DIR, `explain_${marker}_${stamp}.txt`);
const outJson = path.join(REPORTS_DIR, `explain_${marker}_${stamp}.json`);

// Tomamos un company_id real para que el optimizador use estadísticas realistas.
let SAMPLE_COMPANY = null;
try {
  const r = await db.execute(`SELECT company_id FROM sales GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1`);
  SAMPLE_COMPANY = r.rows[0]?.company_id ?? null;
} catch {}
if (SAMPLE_COMPANY == null) SAMPLE_COMPANY = 1;

// Cache de columnas reales por tabla (para feature-detect)
async function columnsOf(table) {
  try {
    const r = await db.execute(`PRAGMA table_info("${table}")`);
    return new Set(r.rows.map((x) => x.name));
  } catch {
    return new Set();
  }
}
const COLS = {
  sales: await columnsOf('sales'),
  products: await columnsOf('products'),
  product_lots: await columnsOf('product_lots'),
};

const SAMPLE_USER = 1;
const SAMPLE_PRODUCT = 1;
const SAMPLE_CLIENT = 1;
const TODAY = new Date().toISOString().slice(0, 10);
const A_MONTH_AGO = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

// Cada query trae: id, descripción, SQL y args.
const QUERIES = [
  {
    id: 'sales_history_by_company_date',
    desc: 'Historial de ventas por empresa, ordenado por fecha desc (paginado típico)',
    sql: `SELECT id, date, total, status, user_id, payment_method, client_name, client_id
          FROM sales WHERE company_id = ? ORDER BY date DESC, id DESC LIMIT 50`,
    args: [SAMPLE_COMPANY],
  },
  {
    id: 'sales_by_company_payment_method',
    desc: 'Filtro por método de pago dentro de una empresa',
    sql: `SELECT id, date, total FROM sales
          WHERE company_id = ? AND payment_method = ?
          ORDER BY date DESC, id DESC LIMIT 50`,
    args: [SAMPLE_COMPANY, 'Efectivo'],
  },
  {
    id: 'sales_by_user_date_range',
    desc: 'Ventas de un usuario en rango (turnos / cierre de caja)',
    sql: `SELECT * FROM sales
          WHERE company_id = ? AND user_id = ? AND date BETWEEN ? AND ?`,
    args: [SAMPLE_COMPANY, SAMPLE_USER, A_MONTH_AGO, TODAY],
  },
  {
    id: 'sales_by_external_order',
    desc: 'Lookup por external_order_id (WooCommerce / APIs)',
    sql: `SELECT id FROM sales WHERE company_id = ? AND external_order_id = ?`,
    args: [SAMPLE_COMPANY, 'wc_123456'],
    requires: { sales: ['external_order_id'] },
  },
  {
    id: 'sales_credit_pending',
    desc: 'Crédito pendiente por cliente (cobranza)',
    sql: `SELECT id, total, payment_due_date FROM sales
          WHERE company_id = ? AND client_id = ?
            AND payment_method = 'Crédito'
            AND status NOT IN ('paid','cancelled')`,
    args: [SAMPLE_COMPANY, SAMPLE_CLIENT],
  },
  {
    id: 'products_by_sku',
    desc: 'Búsqueda producto por SKU exacto',
    sql: `SELECT * FROM products WHERE company_id = ? AND sku = ? LIMIT 1`,
    args: [SAMPLE_COMPANY, 'TEST-SKU'],
  },
  {
    id: 'products_search_name_like',
    desc: 'Búsqueda por nombre/SKU LIKE (POS search actual)',
    sql: `SELECT * FROM products WHERE company_id = ? AND (name LIKE ? OR sku LIKE ?) LIMIT 50`,
    args: [SAMPLE_COMPANY, '%agua%', '%agua%'],
  },
  {
    id: 'products_incremental_sync',
    desc: 'Sync incremental: productos modificados desde X',
    sql: `SELECT id FROM products WHERE company_id = ? AND updated_at > ? ORDER BY updated_at, id LIMIT 500`,
    args: [SAMPLE_COMPANY, A_MONTH_AGO],
    requires: { products: ['updated_at'] },
  },
  {
    id: 'products_offer_by_name',
    desc: 'Listado ofertas ordenadas por nombre',
    sql: `SELECT id, name FROM products
          WHERE company_id = ? AND is_offer = 1
          ORDER BY name COLLATE NOCASE LIMIT 100`,
    args: [SAMPLE_COMPANY],
  },
  {
    id: 'products_by_category_offer',
    desc: 'Productos por categoría priorizando ofertas',
    sql: `SELECT id, name FROM products
          WHERE company_id = ? AND category = ?
          ORDER BY is_offer DESC, name COLLATE NOCASE LIMIT 100`,
    args: [SAMPLE_COMPANY, 'Bebidas'],
  },
  {
    id: 'product_lots_active_by_expiry',
    desc: 'Lotes activos por producto ordenados por vencimiento (FEFO)',
    sql: `SELECT id, expiry_date, quantity FROM product_lots
          WHERE company_id = ? AND product_id = ? AND quantity > 0
          ORDER BY expiry_date`,
    args: [SAMPLE_COMPANY, SAMPLE_PRODUCT],
  },
  {
    id: 'product_lots_expiring_soon',
    desc: 'Lotes activos por vencer (alertas)',
    sql: `SELECT id, product_id, expiry_date, quantity FROM product_lots
          WHERE company_id = ? AND quantity > 0 AND expiry_date IS NOT NULL
            AND expiry_date <= ?
          ORDER BY expiry_date`,
    args: [SAMPLE_COMPANY, TODAY],
  },
  {
    id: 'inventory_alerts_recent',
    desc: 'Alertas inventario recientes',
    sql: `SELECT * FROM inventory_alerts WHERE company_id = ? ORDER BY created_at DESC LIMIT 50`,
    args: [SAMPLE_COMPANY],
  },
  {
    id: 'sii_dtes_recent',
    desc: 'DTEs SII recientes por empresa',
    sql: `SELECT id, sale_id, tipo_dte, folio, estado, created_at FROM sii_dtes
          WHERE company_id = ? ORDER BY created_at DESC LIMIT 50`,
    args: [SAMPLE_COMPANY],
  },
];

const results = [];
const txt = [];
txt.push(`EXPLAIN QUERY PLAN · marker=${marker} · ${new Date().toISOString()}`);
txt.push(`sample company_id = ${SAMPLE_COMPANY}`);
txt.push('='.repeat(80));

for (const q of QUERIES) {
  txt.push(`\n[${q.id}] ${q.desc}`);
  txt.push(`SQL: ${q.sql.replace(/\s+/g, ' ').trim()}`);
  const entry = { id: q.id, desc: q.desc, sql: q.sql, args: q.args, plan: [], timing_ms: null, error: null, skipped: false };

  // Feature-detect: si faltan columnas requeridas, marcar como SKIPPED sin ejecutar.
  if (q.requires) {
    const missing = [];
    for (const [tbl, cols] of Object.entries(q.requires)) {
      const have = COLS[tbl] || new Set();
      for (const c of cols) if (!have.has(c)) missing.push(`${tbl}.${c}`);
    }
    if (missing.length) {
      entry.skipped = true;
      entry.error = `SKIP (columnas inexistentes: ${missing.join(', ')})`;
      txt.push(`  ${entry.error}`);
      results.push(entry);
      continue;
    }
  }

  try {
    const planRes = await db.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.args });
    entry.plan = planRes.rows.map((r) => ({
      id: r.id,
      parent: r.parent,
      notused: r.notused,
      detail: r.detail,
    }));
    for (const p of entry.plan) txt.push(`  · ${p.detail}`);

    // Medición simple (ejecución real)
    const t0 = Date.now();
    await db.execute({ sql: q.sql, args: q.args });
    entry.timing_ms = Date.now() - t0;
    txt.push(`  ⏱ ${entry.timing_ms} ms`);
  } catch (e) {
    entry.error = e.message;
    txt.push(`  ERROR: ${e.message}`);
  }
  results.push(entry);
}

fs.writeFileSync(outTxt, txt.join('\n'), 'utf8');
fs.writeFileSync(
  outJson,
  JSON.stringify({ marker, takenAt: new Date().toISOString(), sampleCompany: SAMPLE_COMPANY, results }, null, 2),
  'utf8'
);

console.log('OK · reporte:', outTxt);
console.log('JSON:', outJson);
console.log(`\nResumen tiempos (marker=${marker}):`);
console.table(
  results.map((r) => ({
    id: r.id,
    ms: r.skipped ? 'SKIP' : r.error ? 'ERR' : r.timing_ms,
    plan_steps: r.plan.length,
  }))
);

process.exit(0);
