// FASE 2 · Paso 1
// Aplica índices NO INVASIVOS (CREATE INDEX IF NOT EXISTS).
//
// SEGURIDAD:
// - Cada índice declara las columnas que necesita; si alguna falta en la tabla
//   real, se omite con WARN (en vez de fallar la migración entera).
// - Soporta DRY-RUN: `node scripts/optim/phase2/01-apply-indexes.mjs --dry`
// - Mide tiempo de creación de cada índice.
// - NO elimina índices antiguos (eso queda para fases posteriores).
// - Idempotente: usar IF NOT EXISTS.
//
// Compatibilidad:
// - Estos índices son AUXILIARES. No cambian queries existentes. Solo dan al
//   planner mejores opciones. SQLite/libSQL puede seguir usando los antiguos
//   si los considera mejores.

import fs from 'node:fs';
import path from 'node:path';
import { db, nowStamp, REPORTS_DIR } from '../_client.mjs';

const DRY = process.argv.includes('--dry');
const stamp = nowStamp();
fs.mkdirSync(REPORTS_DIR, { recursive: true });
const reportPath = path.join(REPORTS_DIR, `apply_indexes_${stamp}.json`);

// Definición de índices a crear.
// Cada uno declara: name, table, columns reales que referencia (para validación), SQL.
const INDEXES = [
  {
    name: 'idx_sales_company_date_id_desc',
    table: 'sales',
    needs: { sales: ['company_id', 'date', 'id'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_sales_company_date_id_desc
          ON sales(company_id, date DESC, id DESC)`,
  },
  {
    name: 'idx_sales_company_payment_date',
    table: 'sales',
    needs: { sales: ['company_id', 'payment_method', 'date', 'id'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_sales_company_payment_date
          ON sales(company_id, payment_method, date DESC, id DESC)`,
  },
  {
    name: 'idx_sales_company_user_date',
    table: 'sales',
    needs: { sales: ['company_id', 'user_id', 'date', 'id'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_sales_company_user_date
          ON sales(company_id, user_id, date DESC, id DESC)`,
  },
  {
    name: 'idx_sales_company_external_order',
    table: 'sales',
    needs: { sales: ['company_id', 'external_order_id'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_sales_company_external_order
          ON sales(company_id, external_order_id)
          WHERE external_order_id IS NOT NULL`,
  },
  {
    name: 'idx_products_company_sku',
    table: 'products',
    needs: { products: ['company_id', 'sku'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_products_company_sku
          ON products(company_id, sku)`,
  },
  {
    name: 'idx_products_company_updated_id',
    table: 'products',
    needs: { products: ['company_id', 'updated_at', 'id'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_products_company_updated_id
          ON products(company_id, updated_at, id)`,
  },
  {
    name: 'idx_products_company_offer_name',
    table: 'products',
    needs: { products: ['company_id', 'is_offer', 'name'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_products_company_offer_name
          ON products(company_id, is_offer DESC, name COLLATE NOCASE)`,
  },
  {
    name: 'idx_products_company_category_offer_name',
    table: 'products',
    needs: { products: ['company_id', 'category', 'is_offer', 'name'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_products_company_category_offer_name
          ON products(company_id, category, is_offer DESC, name COLLATE NOCASE)`,
  },
  {
    name: 'idx_product_lots_company_product_expiry_active',
    table: 'product_lots',
    needs: { product_lots: ['company_id', 'product_id', 'expiry_date', 'quantity'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_product_lots_company_product_expiry_active
          ON product_lots(company_id, product_id, expiry_date)
          WHERE quantity > 0`,
  },
  {
    name: 'idx_product_lots_company_expiry_product_active',
    table: 'product_lots',
    needs: { product_lots: ['company_id', 'expiry_date', 'product_id', 'quantity'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_product_lots_company_expiry_product_active
          ON product_lots(company_id, expiry_date, product_id)
          WHERE quantity > 0 AND expiry_date IS NOT NULL`,
  },
  {
    name: 'idx_inventory_alerts_company_created',
    table: 'inventory_alerts',
    needs: { inventory_alerts: ['company_id', 'created_at'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_inventory_alerts_company_created
          ON inventory_alerts(company_id, created_at DESC)`,
  },
  {
    name: 'idx_sii_dtes_company_created',
    table: 'sii_dtes',
    needs: { sii_dtes: ['company_id', 'created_at'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_sii_dtes_company_created
          ON sii_dtes(company_id, created_at DESC)`,
  },
  {
    name: 'idx_sales_credit_client_pending',
    table: 'sales',
    needs: { sales: ['company_id', 'client_id', 'payment_due_date', 'payment_method', 'status'] },
    sql: `CREATE INDEX IF NOT EXISTS idx_sales_credit_client_pending
          ON sales(company_id, client_id, payment_due_date)
          WHERE payment_method = 'Crédito'
            AND client_id IS NOT NULL
            AND status NOT IN ('paid', 'cancelled')`,
  },
];

// Pre-cargar columnas reales por tabla
async function getCols(table) {
  try {
    const r = await db.execute(`PRAGMA table_info("${table}")`);
    return new Set(r.rows.map((x) => x.name));
  } catch {
    return null;
  }
}

const tables = new Set(INDEXES.flatMap((i) => Object.keys(i.needs)));
const colCache = {};
for (const t of tables) colCache[t] = await getCols(t);

console.log(`Fase 2 · aplicar índices${DRY ? ' (DRY-RUN)' : ''}`);
console.log('='.repeat(60));

const results = [];
for (const ix of INDEXES) {
  const missing = [];
  for (const [tbl, cols] of Object.entries(ix.needs)) {
    const have = colCache[tbl];
    if (!have) {
      missing.push(`tabla "${tbl}" no existe`);
      continue;
    }
    for (const c of cols) if (!have.has(c)) missing.push(`${tbl}.${c}`);
  }

  if (missing.length) {
    console.log(`  SKIP  ${ix.name}  (falta: ${missing.join(', ')})`);
    results.push({ name: ix.name, status: 'skipped', missing });
    continue;
  }

  if (DRY) {
    console.log(`  DRY   ${ix.name}`);
    results.push({ name: ix.name, status: 'dry' });
    continue;
  }

  const t0 = Date.now();
  try {
    await db.execute(ix.sql);
    const ms = Date.now() - t0;
    console.log(`  OK    ${ix.name}  (${ms} ms)`);
    results.push({ name: ix.name, status: 'created', ms });
  } catch (e) {
    console.log(`  ERR   ${ix.name}  -> ${e.message}`);
    results.push({ name: ix.name, status: 'error', error: e.message });
  }
}

const summary = {
  ok: results.filter((r) => r.status === 'created').length,
  skipped: results.filter((r) => r.status === 'skipped').length,
  errors: results.filter((r) => r.status === 'error').length,
  dry: results.filter((r) => r.status === 'dry').length,
};

fs.writeFileSync(
  reportPath,
  JSON.stringify({ takenAt: new Date().toISOString(), dry: DRY, summary, results }, null, 2),
  'utf8'
);

console.log('\nResumen:', summary);
console.log('Reporte:', reportPath);
process.exit(0);
