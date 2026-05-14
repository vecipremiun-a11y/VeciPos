// FASE 5 · Queries analíticas migradas a las tablas normalizadas sale_items /
// purchase_items. Cada función tiene 3 modos:
//
//   · normalized()  → query rápida usando tablas normalizadas (Fase 4)
//   · viaJson()     → query lenta original (lee sales.items / purchases.items)
//   · auto()        → intenta normalized, si falla cae a viaJson silenciosamente
//
// REGLAS ESTRICTAS:
//   · Solo se usa en analytics / reportes / dashboards.
//   · NUNCA en el POS core, ventas, SII, impresión, offline ni APIs.
//   · La forma del resultado es IDÉNTICA en ambas versiones (compat con la UI).
//   · Si las tablas normalizadas tienen un sale_id no migrado o vacío, auto()
//     debe caer a viaJson() — paridad garantizada.
//
// Diseño de seguridad:
//   · NUNCA importa el cliente de Turso aquí — se le pasa por parámetro.
//   · NUNCA muta estado global ni cachea.
//   · NUNCA escribe a la BD.

/**
 * Histórico de ventas de un producto en un rango de fechas.
 *
 * @param {object} ctx
 *   - turso         (cliente libsql con .execute({sql, args}))
 *   - companyId     (string)
 *   - productId     (number|string)
 *   - dateFrom      (string YYYY-MM-DD)
 *   - dateTo        (string YYYY-MM-DD)
 *   - limit         (default 200)
 *
 * Resultado: array de filas con la misma forma que el código viejo:
 *   { sale_id, sale_date, quantity, price, name, sku, line_total, user_id }
 */
export async function productSalesHistoryNormalized(ctx) {
  const { turso, companyId, productId, dateFrom, dateTo, limit = 200 } = ctx;
  const pidNum = Number(productId);
  if (!Number.isFinite(pidNum)) {
    // combos / product_ref → usar fallback (productSalesHistoryViaJson)
    throw new Error('product_id_no_numeric');
  }

  const res = await turso.execute({
    sql: `
      SELECT
        si.sale_id         AS sale_id,
        si.sale_date       AS sale_date,
        si.quantity        AS quantity,
        si.price           AS price,
        si.cost            AS cost,
        si.discount_pct    AS discount_pct,
        si.line_total      AS line_total,
        si.name            AS name,
        si.sku             AS sku,
        s.user_id          AS user_id,
        s.date             AS full_date,
        s.status           AS status,
        u.name             AS user_name,
        s.payment_method   AS payment_method,
        s.client_name      AS client_name
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      LEFT JOIN users u  ON u.id = s.user_id
      WHERE si.company_id = ?
        AND si.product_id = ?
        AND date(si.sale_date) BETWEEN date(?) AND date(?)
        AND s.status != 'cancelled'
      ORDER BY si.sale_date DESC
      LIMIT ?
    `,
    args: [companyId, pidNum, dateFrom, dateTo, limit],
  });

  return res.rows;
}

/**
 * Versión legacy (LIKE + JSON.parse). Mantenida como fallback.
 */
export async function productSalesHistoryViaJson(ctx) {
  const { turso, companyId, productId, dateFrom, dateTo, limit = 200 } = ctx;
  const productIdStr = String(productId);
  const res = await turso.execute({
    sql: `
      SELECT s.*, u.name AS user_name
      FROM sales s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.company_id = ?
        AND date(s.date) BETWEEN date(?) AND date(?)
        AND s.items LIKE ?
        AND s.status != 'cancelled'
      ORDER BY s.date DESC
      LIMIT ?
    `,
    args: [companyId, dateFrom, dateTo, `%${productIdStr}%`, limit],
  });
  const out = [];
  for (const sale of res.rows) {
    let items;
    try { items = JSON.parse(sale.items || '[]'); } catch { continue; }
    const item = items.find(it =>
      String(it?.id) === productIdStr || String(it?.productId) === productIdStr
    );
    if (!item) continue;
    out.push({
      sale_id: sale.id,
      sale_date: sale.date,
      full_date: sale.date,
      quantity: item.quantity,
      price: item.price,
      cost: item.cost,
      discount_pct: item.discountPercent || 0,
      line_total: (Number(item.quantity) || 0) * (Number(item.price) || 0),
      name: item.name,
      sku: item.sku || null,
      user_id: sale.user_id,
      user_name: sale.user_name,
      status: sale.status,
      payment_method: sale.payment_method,
      client_name: sale.client_name,
    });
  }
  return out;
}

/**
 * Histórico de compras de un producto.
 */
export async function productPurchasesHistoryNormalized(ctx) {
  const { turso, companyId, productId, dateFrom, dateTo, limit = 100 } = ctx;
  const pidNum = Number(productId);
  if (!Number.isFinite(pidNum)) throw new Error('product_id_no_numeric');

  const res = await turso.execute({
    sql: `
      SELECT
        pi.purchase_id         AS purchase_id,
        pi.purchase_date       AS purchase_date,
        pi.quantity            AS quantity,
        pi.cost                AS cost,
        pi.price               AS price,
        pi.line_total          AS line_total,
        pi.batch_number        AS batch_number,
        pi.expiry_date         AS expiry_date,
        pi.name                AS name,
        pi.sku                 AS sku,
        p.invoice_number       AS invoice_number,
        p.supplier_id          AS supplier_id,
        p.user_id              AS user_id,
        p.date                 AS full_date,
        sup.name               AS supplier_name,
        sup.email              AS supplier_email,
        sup.phone              AS supplier_phone,
        u.name                 AS purchase_user_name
      FROM purchase_items pi
      INNER JOIN purchases p  ON p.id = pi.purchase_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN users u       ON u.id = p.user_id
      WHERE pi.company_id = ?
        AND pi.product_id = ?
        AND date(pi.purchase_date) BETWEEN date(?) AND date(?)
      ORDER BY pi.purchase_date DESC
      LIMIT ?
    `,
    args: [companyId, pidNum, dateFrom, dateTo, limit],
  });
  return res.rows;
}

export async function productPurchasesHistoryViaJson(ctx) {
  const { turso, companyId, productId, dateFrom, dateTo, limit = 100 } = ctx;
  const productIdStr = String(productId);
  const res = await turso.execute({
    sql: `
      SELECT p.*, s.name AS supplier_name, s.email AS supplier_email,
             s.phone AS supplier_phone, u.name AS purchase_user_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u     ON p.user_id = u.id
      WHERE p.company_id = ?
        AND date(p.date) BETWEEN date(?) AND date(?)
        AND p.items LIKE ?
      ORDER BY p.date DESC
      LIMIT ?
    `,
    args: [companyId, dateFrom, dateTo, `%${productIdStr}%`, limit],
  });
  const out = [];
  for (const purchase of res.rows) {
    let items;
    try { items = JSON.parse(purchase.items || '[]'); } catch { continue; }
    const item = items.find(it =>
      String(it?.id) === productIdStr || String(it?.productId) === productIdStr
    );
    if (!item) continue;
    out.push({
      purchase_id: purchase.id,
      purchase_date: purchase.date,
      full_date: purchase.date,
      quantity: item.quantity,
      cost: item.cost,
      price: item.price,
      line_total: (Number(item.quantity) || 0) * (Number(item.cost) || 0),
      batch_number: item.batchNumber || null,
      expiry_date: item.expiryDate || null,
      name: item.name,
      sku: item.sku || null,
      invoice_number: purchase.invoice_number,
      supplier_id: purchase.supplier_id,
      supplier_name: purchase.supplier_name,
      supplier_email: purchase.supplier_email,
      supplier_phone: purchase.supplier_phone,
      purchase_user_name: purchase.purchase_user_name,
      user_id: purchase.user_id,
    });
  }
  return out;
}

/**
 * Reporte de utilidad (line-items) en un rango de fechas, sin agrupar.
 * Used by SalesProfitReport.jsx. Devuelve UN registro POR LÍNEA de venta.
 *
 * Forma del resultado (igual que la versión legacy):
 *   { saleId, saleDate, productName, barcode, quantity, unitCost, unitPrice,
 *     tax, totalCost, totalSale, totalProfit }
 */
export async function profitReportNormalized(ctx) {
  const { turso, companyId, dateFrom, dateTo, includeCombos = true } = ctx;

  // Excluir cancelled como en el original
  const res = await turso.execute({
    sql: `
      SELECT
        si.sale_id      AS sale_id,
        si.sale_date    AS sale_date,
        si.name         AS name,
        si.sku          AS sku,
        si.quantity     AS quantity,
        si.cost         AS cost,
        si.price        AS price,
        si.tax_rate     AS tax_rate,
        si.discount_pct AS discount_pct,
        si.is_combo     AS is_combo
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      WHERE si.company_id = ?
        AND date(si.sale_date) BETWEEN date(?) AND date(?)
        AND s.status != 'cancelled'
        ${includeCombos ? '' : 'AND si.is_combo = 0'}
      ORDER BY si.sale_date DESC, si.sale_id DESC
    `,
    args: [companyId, dateFrom, dateTo],
  });

  return res.rows.map(r => {
    const qty = Number(r.quantity) || 0;
    const price = Number(r.price) || 0;
    const cost = Number(r.cost) || 0;
    const taxRate = Number(r.tax_rate) || 0;
    const lineSale = price * qty;
    const lineCost = cost * qty;
    const lineProfit = (price - cost) * qty;
    // Tax calc igual que SalesProfitReport.jsx (simplificada)
    const lineTax = lineSale * (taxRate || 0);
    return {
      saleId: r.sale_id,
      saleDate: r.sale_date,
      productName: r.name,
      barcode: r.sku || '-',
      quantity: qty,
      unitCost: cost,
      unitPrice: price,
      tax: lineTax,
      totalCost: lineCost,
      totalSale: lineSale,
      totalProfit: lineProfit,
    };
  });
}

/**
 * Top N productos más vendidos en un rango. Útil para Dashboard / Rankings.
 * Devuelve filas { product_id, name, sku, total_qty, total_revenue, total_profit }.
 */
export async function topProductsByRevenue(ctx) {
  const { turso, companyId, dateFrom, dateTo, limit = 10 } = ctx;

  const res = await turso.execute({
    sql: `
      SELECT
        si.product_id                                   AS product_id,
        MAX(si.name)                                    AS name,
        MAX(si.sku)                                     AS sku,
        SUM(si.quantity)                                AS total_qty,
        SUM(si.line_total)                              AS total_revenue,
        SUM((si.price - si.cost) * si.quantity)         AS total_profit
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      WHERE si.company_id = ?
        AND si.product_id IS NOT NULL
        AND date(si.sale_date) BETWEEN date(?) AND date(?)
        AND s.status != 'cancelled'
      GROUP BY si.product_id
      ORDER BY total_revenue DESC
      LIMIT ?
    `,
    args: [companyId, dateFrom, dateTo, limit],
  });
  return res.rows;
}

/**
 * Comparador de resultados — ejecuta ambas versiones y reporta diferencias.
 * Diseñado para usarse desde scripts/diag o tests, NO en producción.
 */
export async function compareResults({ name, normalized, viaJson, keyFn, valueFn, tolerance = 0.5 }) {
  const start1 = Date.now();
  const a = await normalized();
  const tA = Date.now() - start1;
  const start2 = Date.now();
  const b = await viaJson();
  const tB = Date.now() - start2;

  const mA = new Map();
  for (const r of a) mA.set(keyFn(r), valueFn(r));
  const mB = new Map();
  for (const r of b) mB.set(keyFn(r), valueFn(r));

  const onlyInA = [];
  const onlyInB = [];
  const diff = [];
  for (const [k, v] of mA) {
    if (!mB.has(k)) onlyInA.push({ key: k, value: v });
    else if (Math.abs((v ?? 0) - (mB.get(k) ?? 0)) > tolerance) {
      diff.push({ key: k, a: v, b: mB.get(k) });
    }
  }
  for (const [k, v] of mB) {
    if (!mA.has(k)) onlyInB.push({ key: k, value: v });
  }

  return {
    name,
    counts: { normalized: a.length, viaJson: b.length },
    times_ms: { normalized: tA, viaJson: tB, speedup: tA > 0 ? +(tB / tA).toFixed(2) : null },
    paridad: onlyInA.length === 0 && onlyInB.length === 0 && diff.length === 0 ? 'OK' : 'DIFF',
    diffs: { onlyInA: onlyInA.slice(0, 10), onlyInB: onlyInB.slice(0, 10), value_diff: diff.slice(0, 10) },
  };
}
