// FASE 4 · Helpers para escritura dual a sale_items / purchase_items.
//
// REGLA DE ORO:
//   Estas funciones NUNCA deben hacer fallar la venta o compra original.
//   Toda llamada está envuelta en try/catch y log silencioso. Las tablas
//   normalizadas son SECUNDARIAS — el JSON sales.items / purchases.items
//   sigue siendo la fuente de verdad para SII, impresión, WooCommerce,
//   offline y APIs.
//
// Diseño:
//   · Llamar `mirrorSaleItems(turso, ...)` después de `tx.commit()` de la venta.
//     Si falla, se loggea y se continúa. La venta YA ESTÁ GUARDADA en sales.
//   · Lo mismo para `mirrorPurchaseItems`.
//   · Backfill usa las MISMAS funciones para garantizar consistencia.

/**
 * Normaliza un id de item: puede ser número (producto real) o string ("combo_4").
 * Retorna { productId: number|null, productRef: string|null, isCombo: bool }.
 */
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
  // Cualquier otro string raro: lo guardo en product_ref para no perderlo.
  return { productId: null, productRef: str, isCombo: !!isComboFlag };
}

/**
 * Inserta filas en sale_items para una venta recién creada.
 * NO debe llamarse dentro de una transacción del usuario — se llama
 * post-commit, con try/catch externo.
 *
 * @param {*} turso  Cliente libsql
 * @param {object} params
 *   - saleId       (number, requerido)
 *   - companyId    (string, requerido)
 *   - saleDate     (string ISO 8601, requerido — fecha de la venta original)
 *   - items        (array — el array original que se serializó al JSON)
 *   - source       ('live' | 'backfill' | 'offline')
 */
export async function mirrorSaleItems(turso, { saleId, companyId, saleDate, items, source = 'live' }) {
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
  if (!saleId || !companyId) {
    return { inserted: 0, error: 'saleId/companyId requeridos' };
  }

  const now = new Date().toISOString();
  let seq = 0;
  const rows = items
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
        sale_id: saleId,
        company_id: companyId,
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
        sale_date: saleDate,
        created_at: now,
        source,
        seq: seq++,
      };
    });

  if (rows.length === 0) return { inserted: 0 };

  // INSERT OR IGNORE para idempotencia frente a retries del cliente libsql.
  // UNIQUE INDEX(sale_id, seq) garantiza que un re-envío no inserta duplicados.
  const queries = rows.map(r => ({
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
  }));

  await turso.batch(queries);
  return { inserted: rows.length };
}

/**
 * Inserta filas en purchase_items para una compra recién creada.
 * NOTA: ignora explícitamente `image` (base64 gigante en purchases.items).
 *
 * @param {*} turso  Cliente libsql
 * @param {object} params
 *   - purchaseId   (number, requerido)
 *   - companyId    (string, requerido)
 *   - purchaseDate (string, requerido)
 *   - items        (array)
 *   - source       ('live' | 'backfill')
 */
export async function mirrorPurchaseItems(turso, { purchaseId, companyId, purchaseDate, items, source = 'live' }) {
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
  if (!purchaseId || !companyId) {
    return { inserted: 0, error: 'purchaseId/companyId requeridos' };
  }

  const now = new Date().toISOString();
  let seq = 0;
  const rows = items
    .filter(it => it && typeof it === 'object')
    .map(it => {
      const { productId, productRef } = normalizeItemId(it.id, false);
      const quantity = Number(it.quantity) || 0;
      const cost = Number(it.cost) || 0;
      const price = Number(it.price) || 0;
      // En purchases.items la tasa viene como `tax` (no `tax_rate`)
      const taxRate = Number(it.tax ?? it.tax_rate) || 0;
      const lineTotal = Number(it.total) || (quantity * cost);
      return {
        purchase_id: purchaseId,
        company_id: companyId,
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
        purchase_date: purchaseDate,
        created_at: now,
        source,
        seq: seq++,
      };
    });

  if (rows.length === 0) return { inserted: 0 };

  // INSERT OR IGNORE — UNIQUE INDEX(purchase_id, seq) garantiza idempotencia.
  const queries = rows.map(r => ({
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
  }));

  await turso.batch(queries);
  return { inserted: rows.length };
}

// Export para tests y backfill
export { normalizeItemId };
