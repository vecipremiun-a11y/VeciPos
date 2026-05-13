// FASE 4 · ROLLBACK
//
// Elimina las tablas normalizadas sale_items y purchase_items, sus índices
// y triggers. NO toca sales / purchases (los JSON siguen intactos).
//
// Antes de correr, MUY IMPORTANTE: revertir también la escritura dual en
// el código (commits de la Fase 4 sobre src/store/useStore.js y
// src/lib/itemNormalization.js). Si no, la app seguirá intentando escribir
// a tablas inexistentes (lo cual no rompe ventas porque está en try/catch,
// pero llenará el log de errores).
//
// Confirma escribiendo CONFIRM como variable de entorno:
//   $env:CONFIRM="YES"
//   node scripts/optim/phase4/99-rollback.mjs

import { db } from '../_client.mjs';

const ok = (process.env.CONFIRM || '').toUpperCase();
if (ok !== 'YES') {
  console.log('Rollback NO ejecutado.');
  console.log('Para confirmar: $env:CONFIRM="YES"; node scripts/optim/phase4/99-rollback.mjs');
  process.exit(0);
}

const stmts = [
  `DROP TRIGGER IF EXISTS trg_sale_items_created_at`,
  `DROP TRIGGER IF EXISTS trg_purchase_items_created_at`,
  `DROP INDEX  IF EXISTS idx_sale_items_sale`,
  `DROP INDEX  IF EXISTS idx_sale_items_company_product_date`,
  `DROP INDEX  IF EXISTS idx_sale_items_company_date_product`,
  `DROP INDEX  IF EXISTS idx_sale_items_company_sku`,
  `DROP INDEX  IF EXISTS idx_purchase_items_purchase`,
  `DROP INDEX  IF EXISTS idx_purchase_items_company_product_date`,
  `DROP INDEX  IF EXISTS idx_purchase_items_company_date`,
  `DROP TABLE  IF EXISTS sale_items`,
  `DROP TABLE  IF EXISTS purchase_items`,
];

console.log('Fase 4 · ROLLBACK iniciado');
for (const s of stmts) {
  try {
    await db.execute(s);
    console.log('  ', s);
  } catch (e) {
    console.error('  ERR', s, '→', e.message);
  }
}
console.log('Rollback completo.');
process.exit(0);
