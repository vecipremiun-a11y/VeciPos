// FASE 4 · Crear tablas normalizadas COMPLEMENTARIAS.
//
// IMPORTANTE:
//   · NO reemplazan a sales.items / purchases.items (JSON). Son TABLAS PARALELAS
//     poblada por escritura dual y backfill. Si fallan, la venta sigue.
//   · Diseño "fat row": guardo snapshot de name/sku/price/cost/tax/total junto
//     con product_id. Así los analytics no necesitan JOIN a products y se
//     mantienen históricamente correctos (precio del momento de la venta).
//   · product_id NULLABLE: combos en sales.items tienen id="combo_4" (string).
//     Para ellos guardo product_id = NULL y un campo `product_ref` con el id raw.
//   · is_combo: marca venta/compra de combo (no tiene producto físico).
//   · created_at: ISO 8601 — mismo formato que el resto de la app.
//   · Idempotente: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

import { db } from '../_client.mjs';

console.log('Fase 4 · Crear tablas normalizadas');
console.log('='.repeat(60));

const statements = [
  // ─── sale_items ────────────────────────────────────────────────────────
  // Una fila por item dentro de cada sales.items.
  // sale_id + company_id + product_id permite todas las queries analíticas.
  `CREATE TABLE IF NOT EXISTS sale_items (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     sale_id      INTEGER NOT NULL,
     company_id   TEXT    NOT NULL,
     product_id   INTEGER,
     product_ref  TEXT,
     sku          TEXT,
     name         TEXT,
     quantity     REAL    NOT NULL,
     price        REAL    NOT NULL DEFAULT 0,
     cost         REAL    NOT NULL DEFAULT 0,
     tax_rate     REAL    NOT NULL DEFAULT 0,
     discount_pct REAL    NOT NULL DEFAULT 0,
     line_total   REAL,
     is_combo     INTEGER NOT NULL DEFAULT 0,
     sale_date    TEXT,
     created_at   TEXT    NOT NULL,
     source       TEXT    NOT NULL DEFAULT 'live',
     seq          INTEGER
   )`,

  // ─── purchase_items ────────────────────────────────────────────────────
  // Una fila por item dentro de cada purchases.items.
  // OJO: purchases.items.image (base64) NO se replica → ahorro masivo.
  `CREATE TABLE IF NOT EXISTS purchase_items (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     purchase_id   INTEGER NOT NULL,
     company_id    TEXT    NOT NULL,
     product_id    INTEGER,
     product_ref   TEXT,
     sku           TEXT,
     name          TEXT,
     quantity      REAL    NOT NULL,
     cost          REAL    NOT NULL DEFAULT 0,
     price         REAL    NOT NULL DEFAULT 0,
     tax_rate      REAL    NOT NULL DEFAULT 0,
     line_total    REAL,
     batch_number  TEXT,
     expiry_date   TEXT,
     purchase_date TEXT,
     created_at    TEXT    NOT NULL,
     source        TEXT    NOT NULL DEFAULT 'live',
     seq           INTEGER
   )`,

  // ─── Índices para analytics ────────────────────────────────────────────
  // sale_items
  `CREATE INDEX IF NOT EXISTS idx_sale_items_sale
     ON sale_items(sale_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sale_items_company_product_date
     ON sale_items(company_id, product_id, sale_date DESC)
     WHERE product_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_sale_items_company_date_product
     ON sale_items(company_id, sale_date DESC, product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sale_items_company_sku
     ON sale_items(company_id, sku)
     WHERE sku IS NOT NULL`,

  // purchase_items
  `CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
     ON purchase_items(purchase_id)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_items_company_product_date
     ON purchase_items(company_id, product_id, purchase_date DESC)
     WHERE product_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_items_company_date
     ON purchase_items(company_id, purchase_date DESC)`,

  // ─── UNIQUE INDEX para idempotencia frente a retries/reintentos ────────
  // (sale_id, seq) y (purchase_id, seq) — seq es la posición 0-based del
  // item dentro del JSON original; permite items idénticos legítimos en una
  // misma venta (mismo producto escaneado N veces).
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_sale_items_sale_id_seq
     ON sale_items(sale_id, seq) WHERE seq IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_purchase_items_purchase_id_seq
     ON purchase_items(purchase_id, seq) WHERE seq IS NOT NULL`,

  // ─── Trigger para mantener created_at si se omite ──────────────────────
  // (similar al trigger products.updated_at — defensivo, no obligatorio)
  // Nota: SQLite no permite DEFAULT con strftime dinámico portable, así que
  //       el código de inserción siempre debe pasar created_at. Este trigger
  //       es solo failsafe.
  `DROP TRIGGER IF EXISTS trg_sale_items_created_at`,
  `CREATE TRIGGER trg_sale_items_created_at
     AFTER INSERT ON sale_items
     FOR EACH ROW
     WHEN NEW.created_at IS NULL OR NEW.created_at = ''
     BEGIN
       UPDATE sale_items
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = NEW.id;
     END`,
  `DROP TRIGGER IF EXISTS trg_purchase_items_created_at`,
  `CREATE TRIGGER trg_purchase_items_created_at
     AFTER INSERT ON purchase_items
     FOR EACH ROW
     WHEN NEW.created_at IS NULL OR NEW.created_at = ''
     BEGIN
       UPDATE purchase_items
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = NEW.id;
     END`,
];

for (const sql of statements) {
  const label = sql.replace(/\s+/g, ' ').slice(0, 80) + '...';
  const t0 = Date.now();
  try {
    await db.execute(sql);
    console.log(`  OK   (${Date.now() - t0} ms)  ${label}`);
  } catch (e) {
    console.error(`  ERR  ${label}\n        → ${e.message}`);
    process.exit(1);
  }
}

console.log('\nListo. sale_items y purchase_items creadas.');
console.log('NO se lee aún desde estas tablas en producción.');
process.exit(0);
