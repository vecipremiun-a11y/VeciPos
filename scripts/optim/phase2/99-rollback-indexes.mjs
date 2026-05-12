// FASE 2 · Rollback
// Elimina SOLO los índices creados por 01-apply-indexes.mjs.
// NO toca índices originales del sistema.
//
// Uso:
//   node scripts/optim/phase2/99-rollback-indexes.mjs --confirm

import { db } from '../_client.mjs';

const CONFIRM = process.argv.includes('--confirm');

const NAMES = [
  'idx_sales_company_date_id_desc',
  'idx_sales_company_payment_date',
  'idx_sales_company_user_date',
  'idx_sales_company_external_order',
  'idx_products_company_sku',
  'idx_products_company_updated_id',
  'idx_products_company_offer_name',
  'idx_products_company_category_offer_name',
  'idx_product_lots_company_product_expiry_active',
  'idx_product_lots_company_expiry_product_active',
  'idx_inventory_alerts_company_created',
  'idx_sii_dtes_company_created',
  'idx_sales_credit_client_pending',
];

if (!CONFIRM) {
  console.log('Rollback Fase 2 (vista previa). Para ejecutar usar: --confirm');
  for (const n of NAMES) console.log('  DROP INDEX IF EXISTS', n);
  process.exit(0);
}

for (const n of NAMES) {
  const t0 = Date.now();
  try {
    await db.execute(`DROP INDEX IF EXISTS ${n}`);
    console.log(`  OK   DROP ${n}  (${Date.now() - t0} ms)`);
  } catch (e) {
    console.log(`  ERR  ${n} -> ${e.message}`);
  }
}
process.exit(0);
