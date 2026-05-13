// FASE 2.5 · Añadir columnas faltantes
//
// 1) products.updated_at  TEXT (ISO 8601) + trigger AFTER UPDATE para mantenerla sola.
//    Permite sync incremental (Fase 8) sin tocar el código de la app.
// 2) sales.external_order_id TEXT  → para WooCommerce / APIs externas.
//
// Idempotente: detecta si la columna ya existe antes de ALTER.
//
// Compatibilidad:
// - NO cambia ninguna query existente.
// - Las nuevas columnas son NULL para filas existentes; el trigger solo dispara
//   en UPDATEs posteriores.
// - El backfill inicial usa CURRENT_TIMESTAMP para que las filas existentes
//   tengan un valor razonable (puede ajustarse después si se requiere precisión).

import { db } from '../_client.mjs';

async function colExists(table, col) {
  const r = await db.execute(`PRAGMA table_info("${table}")`);
  return r.rows.some((x) => x.name === col);
}

async function triggerExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

console.log('Fase 2.5 · Añadir columnas faltantes');
console.log('='.repeat(60));

// ---------- products.updated_at ----------
if (await colExists('products', 'updated_at')) {
  console.log('  products.updated_at ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE products ADD COLUMN updated_at TEXT`);
  console.log(`  OK  ALTER products ADD updated_at  (${Date.now() - t0} ms)`);

  // Backfill: poner timestamp actual a filas existentes (NULL no sirve para sync incremental).
  const bf = await db.execute(
    `UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL`
  );
  console.log(`      backfill: ${bf.rowsAffected} filas`);
}

// Trigger para mantener updated_at automáticamente en cada UPDATE.
// IMPORTANTE: WHEN guard evita recursión infinita.
if (await triggerExists('trg_products_updated_at')) {
  console.log('  trg_products_updated_at ya existe — skip');
} else {
  await db.execute(`
    CREATE TRIGGER trg_products_updated_at
    AFTER UPDATE ON products
    FOR EACH ROW
    WHEN COALESCE(NEW.updated_at, '') = COALESCE(OLD.updated_at, '')
    BEGIN
      UPDATE products
      SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = NEW.id;
    END;
  `);
  console.log('  OK  trigger trg_products_updated_at creado');
}

// Ahora SÍ podemos crear el índice de sync incremental.
if (await indexExists('idx_products_company_updated_id')) {
  console.log('  idx_products_company_updated_id ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_products_company_updated_id
    ON products(company_id, updated_at, id)
  `);
  console.log(`  OK  idx_products_company_updated_id  (${Date.now() - t0} ms)`);
}

// ---------- sales.external_order_id ----------
if (await colExists('sales', 'external_order_id')) {
  console.log('  sales.external_order_id ya existe — skip ALTER');
} else {
  const t0 = Date.now();
  await db.execute(`ALTER TABLE sales ADD COLUMN external_order_id TEXT`);
  console.log(`  OK  ALTER sales ADD external_order_id  (${Date.now() - t0} ms)`);
}

// Índice parcial para WooCommerce/APIs.
if (await indexExists('idx_sales_company_external_order')) {
  console.log('  idx_sales_company_external_order ya existe — skip');
} else {
  const t0 = Date.now();
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_sales_company_external_order
    ON sales(company_id, external_order_id)
    WHERE external_order_id IS NOT NULL
  `);
  console.log(`  OK  idx_sales_company_external_order  (${Date.now() - t0} ms)`);
}

console.log('\nListo. Las nuevas columnas son nullable y no afectan queries existentes.');
process.exit(0);
