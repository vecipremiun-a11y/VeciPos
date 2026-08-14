// Reportes generales de ventas (Fase 1 · Paso 18) — catálogo whitelisteado.
// Cada reporte es una query parametrizada con company_id forzado; el cliente
// pide `report` con { name, params } y conserva su post-procesamiento.

import {
    productSalesHistoryNormalized, productSalesHistoryViaJson,
    productPurchasesHistoryNormalized, productPurchasesHistoryViaJson,
} from '../../src/lib/analyticsQueries.js';
import { billingSummary } from './billing.js';

// Reportes con lógica (fallback normalizado→JSON, Fase 5) — módulo compartido
const SPECIAL = {
    // Resumen de facturación (plan + Apps + total mensual + próximo cobro). Solo lectura.
    billingSummary: async (turso, companyId) => billingSummary(turso, companyId),
    productSalesHistory: async (turso, companyId, { productId, dateFrom, dateTo, limit = 200 }) => {
        const ctx = { turso, companyId, productId, dateFrom, dateTo, limit };
        try { return await productSalesHistoryNormalized(ctx); }
        catch { return await productSalesHistoryViaJson(ctx); }
    },
    productPurchasesHistory: async (turso, companyId, { productId, dateFrom, dateTo, limit = 100 }) => {
        const ctx = { turso, companyId, productId, dateFrom, dateTo, limit };
        try { return await productPurchasesHistoryNormalized(ctx); }
        catch { return await productPurchasesHistoryViaJson(ctx); }
    },
};

// Filtros de facturas de compra (Paso 21) — el WHERE se arma AQUÍ con
// parámetros estructurados; el cliente jamás manda SQL.
function invoiceWhere({ dateFrom, dateTo, supplierFilter, paymentType, search } = {}) {
    const conds = ['company_id = ?'];
    const extra = [];
    if (dateFrom) { conds.push('date >= ?'); extra.push(dateFrom); }
    if (dateTo) { conds.push('date <= ?'); extra.push(dateTo); }
    if (supplierFilter) { conds.push('supplier_id = ?'); extra.push(parseInt(supplierFilter, 10)); }
    if (paymentType === 'cash') conds.push('is_credit = 0');
    if (paymentType === 'credit') conds.push('is_credit = 1');
    if (search) {
        conds.push("(LOWER(COALESCE(invoice_number,'')) LIKE ? OR LOWER(COALESCE(supplier_name,'')) LIKE ?)");
        const like = `%${String(search).toLowerCase()}%`;
        extra.push(like, like);
    }
    return { where: conds.join(' AND '), extra };
}

// Todas las columnas de products MENOS `image`.
//
// `image` guarda la foto en base64 y pesa el 99,5% de la tabla (153 MB sobre 154
// medidos el 7-ago-2026, con 1.734 fotos de 39 KB promedio). Un `SELECT *` en la
// búsqueda del POS bajaba entre 1,3 y 3,3 MB por búsqueda y tardaba hasta 1 s;
// sin esta columna son 0,03 MB y 150 ms. Las fotos se piden aparte con
// `productImages`, que es para lo que existe.
export const PRODUCT_COLS_SIN_IMAGEN =
    'id, name, price, stock, category, sku, cost, tax_rate, unit, supplier, '
    + 'pending_adjustment, is_offer, offer_price, price_ranges, scale_group_id, '
    + 'company_id, original_price, sale_mode, allow_item_notes, preorder_unit, '
    + 'preorder_billing_unit, preorder_price_per_kg, preorder_gram_per_unit, '
    + 'preorder_use_base_price, units_per_box, updated_at';

const REPORTS = {
    // Lecturas de catálogo del POS (Paso 24)
    //
    // Mismo patrón que `categoryProducts`: sin la foto y con `has_image`, para que
    // los resultados aparezcan al instante y las imágenes lleguen después
    // (loadProductImages). Esta consulta se había quedado en `SELECT *`.
    productsSearch: ({ term, limit = 50 }) => [{
        sql: `SELECT ${PRODUCT_COLS_SIN_IMAGEN},
                CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS has_image
              FROM products WHERE company_id = ? AND (name LIKE ? OR sku LIKE ?) LIMIT ?`,
        args: (cid) => [cid, `%${term}%`, `%${term}%`, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)],
    }],
    productByBarcode: ({ barcode }) => [{
        sql: 'SELECT * FROM products WHERE company_id = ? AND (sku = ? OR name = ?) LIMIT 1',
        args: (cid) => [cid, barcode, barcode],
    }],
    categoryProducts: ({ category, offset = 0, limit = 30 }) => {
        const conds = ['company_id = ?'];
        const extra = [];
        if (category && category !== 'Todos') { conds.push('category = ?'); extra.push(category); }
        const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200);
        const off = Math.max(parseInt(offset, 10) || 0, 0);
        return [{
            sql: `SELECT id, name, sku, price, cost, stock, category, unit,
                    CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS has_image,
                    tax_rate, is_offer, offer_price, company_id, price_ranges, scale_group_id, original_price
                  FROM products WHERE ${conds.join(' AND ')}
                  ORDER BY is_offer DESC, name ASC LIMIT ? OFFSET ?`,
            args: (cid) => [cid, ...extra, lim, off],
        }];
    },
    // Datos actuales de varios productos por id. Lo usa "Pasar a Compra": el
    // pedido guarda el costo con el que se pidió, pero no el precio de venta, y
    // al recibir la mercadería hay que revisar el margen con el costo real.
    productsByIds: ({ ids = [] }) => {
        const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
        const ph = list.length ? list.map(() => '?').join(',') : '0';
        return [{
            sql: `SELECT id, name, sku, price, cost, tax_rate, unit
                  FROM products WHERE company_id = ? AND id IN (${ph})`,
            args: (cid) => [cid, ...list],
        }];
    },
    productImages: ({ ids = [] }) => {
        const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
        const ph = list.length ? list.map(() => '?').join(',') : '0';
        return [{
            sql: `SELECT id, image FROM products WHERE company_id = ? AND id IN (${ph})`,
            args: (cid) => [cid, ...list],
        }];
    },
    taxRates: () => [{
        sql: 'SELECT * FROM tax_rates WHERE company_id = ? ORDER BY rate ASC',
        args: (cid) => [cid],
    }],
    companyModules: () => [{
        sql: 'SELECT * FROM company_modules WHERE company_id = ?',
        args: (cid) => [cid],
    }],
    subscriptionRow: () => [{
        sql: `SELECT c.status, c.trial_ends_at, c.access_until, c.plan, c.country_code, s.current_period_end, s.plan_id
              FROM companies c LEFT JOIN subscriptions s ON c.subscription_id = s.id WHERE c.id = ?`,
        args: (cid) => [cid],
    }],
    paymentHistory: () => [{
        sql: "SELECT * FROM payments WHERE company_id = ? AND status != 'pending' ORDER BY created_at DESC",
        args: (cid) => [cid],
    }],
    salesForReport: ({ start, end }) => [{
        sql: `SELECT id, date, total, status, user_id, payment_method, client_name, client_id, items
              FROM sales WHERE company_id = ? AND date >= ? AND date <= ? AND status != 'cancelled'
              ORDER BY date DESC`,
        args: (cid) => [cid, start, end],
    }],
    clientSales: ({ clientId }) => [{
        sql: 'SELECT * FROM sales WHERE client_id = ? AND company_id = ? ORDER BY date DESC LIMIT 500',
        args: (cid) => [clientId, cid],
    }],
    monthlyStats: ({ start, end }) => [{
        sql: 'SELECT id, date, total, company_id, summary FROM sales WHERE company_id = ? AND date >= ? AND date <= ?',
        args: (cid) => [cid, start, end],
    }],
    todaySales: ({ start, end }) => [{
        sql: `SELECT s.*, u.name as user_name FROM sales s
              LEFT JOIN users u ON s.user_id = u.id
              WHERE s.company_id = ? AND s.date >= ? AND s.date <= ? ORDER BY s.date DESC`,
        args: (cid) => [cid, start, end],
    }],
    recentSales: () => [{
        sql: 'SELECT * FROM sales WHERE company_id = ? ORDER BY id DESC LIMIT 20',
        args: (cid) => [cid],
    }],
    // Sin la foto: son 20 filas, pero con `image` eran ~780 KB para un aviso de
    // stock que solo muestra nombre y cantidad.
    lowStockProducts: () => [{
        sql: `SELECT ${PRODUCT_COLS_SIN_IMAGEN} FROM products WHERE company_id = ? AND stock <= 0 LIMIT 20`,
        args: (cid) => [cid],
    }],
    inventoryProducts: ({ searchTerm, category, offset = 0, limit = 50 }) => {
        const conds = ['company_id = ?'];
        const extra = [];
        if (searchTerm) {
            conds.push('(name LIKE ? OR sku LIKE ?)');
            extra.push('%' + searchTerm + '%', '%' + searchTerm + '%');
        }
        if (category && category !== 'Todos') { conds.push('category = ?'); extra.push(category); }
        const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        const off = Math.max(parseInt(offset, 10) || 0, 0);
        return [{
            sql: `SELECT * FROM products WHERE ${conds.join(' AND ')} ORDER BY is_offer DESC, name ASC LIMIT ? OFFSET ?`,
            args: (cid) => [cid, ...extra, lim, off],
        }];
    },
    // Páginas menores (Paso 23)
    purchasesAll: () => [{
        sql: 'SELECT * FROM purchases WHERE company_id = ? ORDER BY date DESC',
        args: (cid) => [cid],
    }],
    scaleGroups: () => [{
        sql: `SELECT DISTINCT scale_group_id FROM products
              WHERE company_id = ? AND scale_group_id IS NOT NULL AND scale_group_id != ''
              ORDER BY scale_group_id ASC`,
        args: (cid) => [cid],
    }],
    siiConfigPos: () => [{
        sql: 'SELECT is_active, enabled_dtes, default_dte FROM sii_config WHERE company_id = ?',
        args: (cid) => [cid],
    }],
    companyPreventaInfo: () => [{
        sql: `SELECT name, receipt_business_name, receipt_phone, receipt_address,
                preventa_business_name, preventa_address, preventa_phone,
                preventa_header_message, preventa_footer_message,
                preventa_show_phone, preventa_show_address, preventa_format
              FROM companies WHERE id = ?`,
        args: (cid) => [cid],
    }],
    companyInfo: () => [{
        sql: `SELECT legal_name, full_address, tax_id_legal, phone_main, email_main,
                city, country, postal_code, website, business_type, currency, kds_token
              FROM companies WHERE id = ?`,
        args: (cid) => [cid],
    }],
    dtesList: ({ startUtc, endUtc, tipoFilter, statusFilter }) => {
        const conds = ['d.company_id = ?'];
        const extra = [];
        if (startUtc) { conds.push('d.created_at >= ?'); extra.push(startUtc); }
        if (endUtc) { conds.push('d.created_at <= ?'); extra.push(endUtc); }
        if (tipoFilter) { conds.push('d.tipo_dte = ?'); extra.push(Number(tipoFilter)); }
        if (statusFilter) { conds.push('d.estado = ?'); extra.push(statusFilter); }
        return [{
            sql: `SELECT d.*, d.tipo_dte AS tipo, d.estado AS status, s.total as sale_total, s.payment_method
                  FROM sii_dtes d LEFT JOIN sales s ON d.sale_id = s.id
                  WHERE ${conds.join(' AND ')} ORDER BY d.created_at DESC LIMIT 200`,
            args: (cid) => [cid, ...extra],
        }];
    },
    // Órdenes de compra (Paso 22)
    productLastPurchaseCosts: ({ productId }) => [{
        sql: `SELECT
                json_extract(item.value, '$.cost') as item_cost,
                json_extract(item.value, '$.supplier_code') as supplier_code,
                p.date
              FROM purchases p, json_each(p.items) as item
              WHERE p.company_id = ?
                AND CAST(json_extract(item.value, '$.id') AS INTEGER) = ?
              ORDER BY p.date DESC LIMIT 2`,
        args: (cid) => [cid, productId],
    }],
    productsForOrder: ({ supplierName, search, lowStock }) => {
        const conds = ['company_id = ?'];
        const extra = [];
        if (supplierName) { conds.push('supplier = ?'); extra.push(supplierName); }
        if (search) {
            conds.push("(LOWER(COALESCE(name,'')) LIKE ? OR LOWER(COALESCE(sku,'')) LIKE ?)");
            const like = `%${String(search).toLowerCase()}%`;
            extra.push(like, like);
        }
        if (lowStock) conds.push('stock <= 5');
        return [{
            // Sin `image`: eran hasta 100 fotos base64 (~4 MB) en cada carga de la
            // pantalla de pedidos. Se marca cuáles tienen y se piden aparte.
            sql: `SELECT id, name, sku, price, cost, stock, tax_rate, unit, category, supplier, price_ranges,
                    CASE WHEN image IS NOT NULL AND image != '' THEN 1 ELSE 0 END AS has_image
                  FROM products WHERE ${conds.join(' AND ')} ORDER BY stock ASC LIMIT 100`,
            args: (cid) => [cid, ...extra],
        }];
    },
    // Facturas de compra (Paso 21)
    invoiceStats: (f) => {
        const { where, extra } = invoiceWhere(f);
        return [{
            sql: `SELECT COUNT(*) as total_count, COALESCE(SUM(total), 0) as total_sum,
                    COALESCE(SUM(CASE WHEN is_credit = 0 THEN total ELSE 0 END), 0) as contado_sum,
                    COUNT(CASE WHEN is_credit = 0 THEN 1 END) as contado_count,
                    COALESCE(SUM(CASE WHEN is_credit = 1 THEN total ELSE 0 END), 0) as credito_sum,
                    COUNT(CASE WHEN is_credit = 1 THEN 1 END) as credito_count
                  FROM purchases WHERE ${where}`,
            args: (cid) => [cid, ...extra],
        }];
    },
    invoiceMonthly: ({ sixMonthsAgo }) => [{
        sql: `SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(total), 0) as total,
                COALESCE(SUM(CASE WHEN is_credit = 0 THEN total ELSE 0 END), 0) as cash,
                COALESCE(SUM(CASE WHEN is_credit = 1 THEN total ELSE 0 END), 0) as credit
              FROM purchases WHERE company_id = ? AND date >= ?
              GROUP BY strftime('%Y-%m', date) ORDER BY month`,
        args: (cid) => [cid, sixMonthsAgo],
    }],
    invoicesPending: () => [{
        sql: `SELECT id, supplier_id, supplier_name, invoice_number, date, expiry_date, total, is_credit, status, amount_paid
              FROM purchases WHERE company_id = ? AND is_credit = 1 AND status != 'paid'
              ORDER BY supplier_name, date DESC`,
        args: (cid) => [cid],
    }],
    invoicesList: (f) => {
        const { where, extra } = invoiceWhere(f);
        const limit = Math.min(Math.max(parseInt(f.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(f.offset, 10) || 0, 0);
        return [{
            sql: `SELECT id, supplier_id, supplier_name, invoice_number, date, total, is_credit, status, amount_paid
                  FROM purchases WHERE ${where} ORDER BY date DESC LIMIT ? OFFSET ?`,
            args: (cid) => [cid, ...extra, limit, offset],
        }];
    },
    // Historial de ventas (Paso 20): DTEs y config de boleta
    dteMapBySales: ({ saleIds = [] }) => {
        const ids = (Array.isArray(saleIds) ? saleIds : []).map(Number).filter(Number.isFinite);
        const ph = ids.length ? ids.map(() => '?').join(',') : '0';
        return [{
            sql: `SELECT sale_id, folio, tipo_dte AS tipo, estado AS status FROM sii_dtes WHERE company_id = ? AND sale_id IN (${ph})`,
            args: (cid) => [cid, ...ids],
        }];
    },
    dteForSale: ({ saleId }) => [{
        sql: 'SELECT folio, tipo_dte AS tipo, estado AS status, track_id, created_at, xml_firmado FROM sii_dtes WHERE company_id = ? AND sale_id = ? LIMIT 1',
        args: (cid) => [cid, saleId],
    }],
    receiptConfig: () => [{
        sql: `SELECT receipt_business_name as business_name, receipt_address as address, receipt_tax_id as tax_id,
                receipt_phone as phone, receipt_email as email, receipt_header_message as header_message,
                receipt_footer_message as footer_message, receipt_show_tax_id as show_tax_id,
                receipt_show_phone as show_phone, receipt_show_email as show_email
              FROM companies WHERE id = ?`,
        args: (cid) => [cid],
    }],
    // Último DTE emitido de un tipo (polling del modal de venta)
    latestDteByType: ({ tipoDte }) => [{
        sql: `SELECT folio, tipo_dte AS tipo, estado AS status, track_id, xml_firmado FROM sii_dtes
              WHERE company_id = ? AND tipo_dte = ? ORDER BY created_at DESC LIMIT 1`,
        args: (cid) => [cid, tipoDte],
    }],
    productSalesStats: ({ productId, thirtyDaysAgo, today }) => [
        {
            sql: `SELECT COALESCE(SUM(total_quantity), 0) as total_sold, COUNT(DISTINCT day) as days_with_sales
                  FROM product_daily_profit
                  WHERE company_id = ? AND product_id = ? AND day >= ? AND day <= ?`,
            args: (cid) => [cid, productId, thirtyDaysAgo, today],
        },
        {
            sql: 'SELECT last_sale_date FROM product_movement_stats WHERE company_id = ? AND product_id = ?',
            args: (cid) => [cid, productId],
        },
    ],
    productLots: ({ productId }) => [{
        sql: 'SELECT * FROM product_lots WHERE product_id = ? AND company_id = ? ORDER BY expiry_date DESC',
        args: (cid) => [productId, cid],
    }],
    productAdjustments: ({ productId, dateFrom, dateTo }) => [{
        sql: `SELECT * FROM stock_adjustments
              WHERE company_id = ? AND product_id = ? AND date(created_at) BETWEEN date(?) AND date(?)
              ORDER BY created_at DESC LIMIT 100`,
        args: (cid) => [cid, productId, dateFrom, dateTo],
    }],
    salesSummaryByDate: ({ date }) => [{
        sql: 'SELECT * FROM sales_daily_summary WHERE company_id = ? AND day = ?',
        args: (cid) => [cid, date],
    }],
    salesSummaryByRange: ({ startDate, endDate }) => [
        {
            sql: `SELECT day, total_sales, total_orders FROM sales_daily_summary
                  WHERE company_id = ? AND day BETWEEN ? AND ? ORDER BY day ASC`,
            args: (cid) => [cid, startDate, endDate],
        },
        {
            sql: `SELECT day, SUM(total_revenue) as total_revenue, SUM(total_cost) as total_cost, SUM(total_profit) as total_profit, SUM(total_tax) as total_tax
                  FROM product_daily_profit
                  WHERE company_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day ASC`,
            args: (cid) => [cid, startDate, endDate],
        },
    ],
    vendorRanking: ({ startDate, endDate }) => [{
        sql: `SELECT user_id, user_name, SUM(total_sales) as total_sales, SUM(total_amount) as total_amount,
                SUM(total_profit) as total_profit, AVG(avg_ticket) as avg_ticket, SUM(total_items_sold) as total_items_sold
              FROM vendor_daily_performance
              WHERE company_id = ? AND date BETWEEN ? AND ?
              GROUP BY user_id, user_name ORDER BY total_amount DESC`,
        args: (cid) => [cid, startDate, endDate],
    }],
    topProducts: ({ startDate, endDate, limit = 10 }) => [{
        sql: `SELECT pdp.product_id, p.name as product_name,
                SUM(pdp.total_quantity) as total_sold, SUM(pdp.total_revenue) as total_revenue,
                SUM(pdp.total_profit) as total_profit,
                CASE WHEN SUM(pdp.total_revenue) > 0 THEN (SUM(pdp.total_profit) / SUM(pdp.total_revenue)) * 100 ELSE 0 END as avg_margin
              FROM product_daily_profit pdp LEFT JOIN products p ON pdp.product_id = p.id
              WHERE pdp.company_id = ? AND pdp.day BETWEEN ? AND ?
              GROUP BY pdp.product_id ORDER BY total_sold DESC LIMIT ?`,
        args: (cid) => [cid, startDate, endDate, limit],
    }],
    bestMarginProducts: ({ startDate, endDate, limit = 10 }) => [{
        sql: `SELECT pdp.product_id, p.name as product_name,
                SUM(pdp.total_quantity) as total_sold, SUM(pdp.total_revenue) as total_revenue,
                SUM(pdp.total_profit) as total_profit,
                CASE WHEN SUM(pdp.total_revenue) > 0 THEN (SUM(pdp.total_profit) / SUM(pdp.total_revenue)) * 100 ELSE 0 END as avg_margin
              FROM product_daily_profit pdp LEFT JOIN products p ON pdp.product_id = p.id
              WHERE pdp.company_id = ? AND pdp.day BETWEEN ? AND ?
              GROUP BY pdp.product_id HAVING total_sold > 0 ORDER BY avg_margin DESC LIMIT ?`,
        args: (cid) => [cid, startDate, endDate, limit],
    }],
    salesByPaymentMethod: ({ utcStart, utcEnd, userId = null }) => [{
        sql: `SELECT payment_method, COUNT(*) as count, SUM(total) as amount FROM sales
              WHERE company_id = ? AND date >= ? AND date <= ? AND status != 'cancelled'
              ${userId ? 'AND user_id = ?' : ''}
              GROUP BY payment_method ORDER BY amount DESC`,
        args: (cid) => userId ? [cid, utcStart, utcEnd, userId] : [cid, utcStart, utcEnd],
    }],
    vendorItems: ({ utcStart, utcEnd, userId }) => [{
        sql: `SELECT items FROM sales
              WHERE company_id = ? AND date >= ? AND date <= ? AND status != 'cancelled' AND user_id = ?`,
        args: (cid) => [cid, utcStart, utcEnd, userId],
    }],
    vendorSalesSummary: ({ utcStart, utcEnd }) => [{
        sql: `SELECT s.user_id, u.name as user_name, COUNT(*) as total_sales, SUM(s.total) as total_amount,
                SUM(CASE WHEN s.payment_method = 'Efectivo' THEN s.total ELSE 0 END) as cash,
                SUM(CASE WHEN s.payment_method = 'Tarjeta' THEN s.total ELSE 0 END) as card,
                SUM(CASE WHEN s.payment_method = 'Transferencia' THEN s.total ELSE 0 END) as transfer,
                SUM(CASE WHEN s.payment_method = 'Mixto' THEN s.total ELSE 0 END) as mixed,
                SUM(CASE WHEN s.payment_method = 'Crédito' THEN s.total ELSE 0 END) as credit
              FROM sales s LEFT JOIN users u ON s.user_id = u.id
              WHERE s.company_id = ? AND s.date >= ? AND s.date <= ? AND s.status != 'cancelled'
              GROUP BY s.user_id ORDER BY total_amount DESC`,
        args: (cid) => [cid, utcStart, utcEnd],
    }],
    peakHours: ({ startDate, endDate }) => [{
        sql: `SELECT hour, SUM(total_sales) as total_sales, SUM(total_amount) as total_amount,
                AVG(total_amount / NULLIF(total_sales, 0)) as avg_ticket
              FROM hourly_sales_stats
              WHERE company_id = ? AND date BETWEEN ? AND ? GROUP BY hour ORDER BY hour ASC`,
        args: (cid) => [cid, startDate, endDate],
    }],
    // Productos verdaderamente detenidos: sin VENDER y sin COMPRAR desde una
    // fecha. Distinto de slowMovingProducts, que filtra por `avg_daily_sales < 1`
    // y corta en 20: ese criterio deja pasar productos que se venden todos los
    // días (medido: uno con 3.093 unidades el último mes y venta de hoy lo
    // cumplía), así que no sirve para responder "qué no se mueve" — solo parecía
    // servir porque el orden dejaba los viejos primero.
    //
    // Se ordena por plata inmovilizada (stock × costo), no por fecha: al dueño le
    // importa más el producto con $400.000 detenidos que uno con dos unidades.
    stalledProducts: ({ since, limit = 40 }) => [{
        sql: `SELECT p.id, p.name, p.stock, p.cost,
                     ROUND(COALESCE(p.stock, 0) * COALESCE(p.cost, 0)) AS capital_detenido,
                     pms.last_sale_date,
                     (SELECT MAX(pi.purchase_date) FROM purchase_items pi
                       WHERE pi.company_id = p.company_id AND pi.product_id = p.id) AS last_purchase_date
              FROM products p
              LEFT JOIN product_movement_stats pms
                     ON pms.product_id = p.id AND pms.company_id = p.company_id
              WHERE p.company_id = ?
                AND (pms.last_sale_date IS NULL OR pms.last_sale_date < ?)
                AND NOT EXISTS (
                      SELECT 1 FROM purchase_items pi
                       WHERE pi.company_id = p.company_id AND pi.product_id = p.id
                         AND pi.purchase_date >= ?)
              ORDER BY capital_detenido DESC
              LIMIT ?`,
        args: (cid) => [cid, since, since, Math.min(Number(limit) || 40, 100)],
    }, {
        // Segunda consulta: el total real. Sin esto, el asistente diría "estos
        // son" mostrando 40 de 445, sin que nadie sepa que faltan.
        sql: `SELECT COUNT(*) AS total FROM products p
              LEFT JOIN product_movement_stats pms
                     ON pms.product_id = p.id AND pms.company_id = p.company_id
              WHERE p.company_id = ?
                AND (pms.last_sale_date IS NULL OR pms.last_sale_date < ?)
                AND NOT EXISTS (
                      SELECT 1 FROM purchase_items pi
                       WHERE pi.company_id = p.company_id AND pi.product_id = p.id
                         AND pi.purchase_date >= ?)`,
        args: (cid) => [cid, since, since],
    }],
    slowMovingProducts: () => [{
        sql: `SELECT product_id, product_name, total_sold_all_time, sold_last_7_days, sold_last_30_days,
                avg_daily_sales, last_sale_date
              FROM product_movement_stats
              WHERE company_id = ? AND avg_daily_sales < 1
              ORDER BY avg_daily_sales ASC, last_sale_date ASC LIMIT 20`,
        args: (cid) => [cid],
    }],

    // ── Reportes para el Asistente IA ────────────────────────────────────
    //
    // Cubren los dominios que el catálogo no tenía: personal, caja, gastos,
    // deudores, mermas y pedidos a proveedor. Ninguno selecciona contraseñas,
    // PIN, datos bancarios ni RUT — y aunque alguno se equivocara, el filtro de
    // api/_lib/aiRedaccion.js los saca antes de que salgan del servidor.

    // Caja: cómo cerraron los turnos y si hubo descuadres.
    cajasResumen: ({ from, to }) => [{
        sql: `SELECT cr.id, cr.user_id, u.name AS cajero, cr.opening_amount, cr.opening_time,
                     cr.closing_time, cr.final_amount, cr.difference, cr.status, cr.observations
              FROM cash_registers cr LEFT JOIN users u ON u.id = cr.user_id
              WHERE cr.company_id = ? AND cr.opening_time BETWEEN ? AND ?
              ORDER BY cr.opening_time DESC LIMIT 60`,
        args: (cid) => [cid, from, to],
    }],
    cajaMovimientos: ({ from, to }) => [{
        sql: `SELECT cm.type, cm.amount, cm.reason, cm.date, cm.register_id
              FROM cash_movements cm
              WHERE cm.company_id = ? AND cm.date BETWEEN ? AND ?
              ORDER BY cm.date DESC LIMIT 100`,
        args: (cid) => [cid, from, to],
    }],

    // Gastos del negocio (arriendo, luz, sueldos externos…).
    gastosPorPeriodo: ({ from, to }) => [{
        sql: `SELECT be.description, be.supplier, be.amount, be.expense_date, be.due_date,
                     be.status, be.payment_method, ec.name AS categoria
              FROM business_expenses be LEFT JOIN expense_categories ec ON ec.id = be.category_id
              WHERE be.company_id = ? AND be.expense_date BETWEEN ? AND ?
              ORDER BY be.amount DESC LIMIT 100`,
        args: (cid) => [cid, from, to],
    }, {
        sql: `SELECT COALESCE(ec.name,'Sin categoría') AS categoria, COUNT(*) AS cantidad,
                     ROUND(SUM(be.amount)) AS total,
                     ROUND(SUM(CASE WHEN be.status != 'paid' THEN be.amount ELSE 0 END)) AS pendiente
              FROM business_expenses be LEFT JOIN expense_categories ec ON ec.id = be.category_id
              WHERE be.company_id = ? AND be.expense_date BETWEEN ? AND ?
              GROUP BY categoria ORDER BY total DESC`,
        args: (cid) => [cid, from, to],
    }],
    gastosRecurrentes: () => [{
        sql: `SELECT re.description, re.supplier, re.amount, re.frequency, re.due_day,
                     re.active, ec.name AS categoria
              FROM recurring_expenses re LEFT JOIN expense_categories ec ON ec.id = re.category_id
              WHERE re.company_id = ? ORDER BY re.active DESC, re.amount DESC`,
        args: (cid) => [cid],
    }],

    // Clientes que deben. Sin RUT, teléfono ni dirección: para saber quién debe
    // y cuánto alcanza con el nombre.
    clientesDeudores: () => [{
        sql: `SELECT name, total_debt, pending_sales_count, overdue_count,
                     credit_limit, credit_enabled, client_status
              FROM clients
              WHERE company_id = ? AND COALESCE(total_debt,0) > 0
              ORDER BY total_debt DESC LIMIT 60`,
        args: (cid) => [cid],
    }, {
        sql: `SELECT COUNT(*) AS deudores, ROUND(SUM(total_debt)) AS deuda_total,
                     SUM(overdue_count) AS ventas_vencidas
              FROM clients WHERE company_id = ? AND COALESCE(total_debt,0) > 0`,
        args: (cid) => [cid],
    }],

    // Mermas y ajustes: plata que se perdió sin vender.
    mermas: ({ from, to }) => [{
        sql: `SELECT product_name, product_sku, quantity, cost_per_unit, total_loss,
                     reason, notes, created_at
              FROM inventory_losses
              WHERE company_id = ? AND created_at BETWEEN ? AND ?
              ORDER BY total_loss DESC LIMIT 80`,
        args: (cid) => [cid, from, to],
    }, {
        sql: `SELECT COALESCE(reason,'Sin motivo') AS motivo, COUNT(*) AS casos,
                     ROUND(SUM(total_loss)) AS perdido
              FROM inventory_losses
              WHERE company_id = ? AND created_at BETWEEN ? AND ?
              GROUP BY motivo ORDER BY perdido DESC`,
        args: (cid) => [cid, from, to],
    }],
    ajustesStock: ({ from, to }) => [{
        sql: `SELECT sa.user_name, sa.old_stock, sa.new_stock, sa.difference, sa.reason,
                     sa.created_at, p.name AS producto
              FROM stock_adjustments sa LEFT JOIN products p ON p.id = sa.product_id
              WHERE sa.company_id = ? AND sa.created_at BETWEEN ? AND ?
              ORDER BY ABS(sa.difference) DESC LIMIT 80`,
        args: (cid) => [cid, from, to],
    }],

    // Lotes por vencer: lo que hay que rematar antes de que se pierda.
    lotesPorVencer: ({ hasta }) => [{
        sql: `SELECT pl.batch_number, pl.expiry_date, pl.quantity, pl.cost,
                     ROUND(pl.quantity * pl.cost) AS valor, p.name AS producto
              FROM product_lots pl LEFT JOIN products p ON p.id = pl.product_id
              WHERE pl.company_id = ? AND pl.expiry_date IS NOT NULL
                AND pl.expiry_date <= ? AND COALESCE(pl.quantity,0) > 0
              ORDER BY pl.expiry_date ASC LIMIT 80`,
        args: (cid) => [cid, hasta],
    }],

    // Personal: asistencia, ausencias, nómina, anticipos y vacaciones.
    // Se identifica a la gente por NOMBRE. Nunca se traen PIN ni datos bancarios.
    personalPlantilla: () => [{
        sql: `SELECT id, name, role, labor_position, labor_branch, labor_start_date,
                     labor_status, pay_type, pay_day
              FROM users WHERE company_id = ? AND has_labor_profile = 1
              ORDER BY name`,
        args: (cid) => [cid],
    }],
    ausenciasPorPeriodo: ({ from, to }) => [{
        sql: `SELECT u.name AS persona, la.absence_date, la.type, la.status,
                     la.half_day, la.hours, la.notes
              FROM labor_absences la LEFT JOIN users u ON u.id = la.user_id
              WHERE la.company_id = ? AND la.absence_date BETWEEN ? AND ?
              ORDER BY la.absence_date DESC LIMIT 120`,
        args: (cid) => [cid, from, to],
    }, {
        sql: `SELECT u.name AS persona, la.type AS tipo, COUNT(*) AS cantidad
              FROM labor_absences la LEFT JOIN users u ON u.id = la.user_id
              WHERE la.company_id = ? AND la.absence_date BETWEEN ? AND ?
              GROUP BY u.name, la.type ORDER BY cantidad DESC`,
        args: (cid) => [cid, from, to],
    }],
    nominaPeriodos: ({ from, to }) => [{
        sql: `SELECT u.name AS persona, pp.period_label, pp.period_start, pp.period_end,
                     pp.days_absent, pp.late_count, pp.late_minutes, pp.extra_hours,
                     pp.manual_bonus, pp.manual_discount, pp.advances_discounted,
                     pp.base_amount, pp.total_to_pay, pp.is_closed
              FROM payroll_periods pp LEFT JOIN users u ON u.id = pp.user_id
              WHERE pp.company_id = ? AND pp.period_start BETWEEN ? AND ?
              ORDER BY pp.period_start DESC, u.name LIMIT 100`,
        args: (cid) => [cid, from, to],
    }],
    anticipos: ({ from, to }) => [{
        sql: `SELECT u.name AS persona, sa.amount, sa.advance_date, sa.reason,
                     sa.pay_method, sa.status
              FROM salary_advances sa LEFT JOIN users u ON u.id = sa.user_id
              WHERE sa.company_id = ? AND sa.advance_date BETWEEN ? AND ?
              ORDER BY sa.advance_date DESC LIMIT 80`,
        args: (cid) => [cid, from, to],
    }],
    vacaciones: () => [{
        sql: `SELECT u.name AS persona, vr.start_date, vr.end_date, vr.total_days,
                     vr.status, vr.notes
              FROM vacation_requests vr LEFT JOIN users u ON u.id = vr.user_id
              WHERE vr.company_id = ? ORDER BY vr.start_date DESC LIMIT 60`,
        args: (cid) => [cid],
    }, {
        sql: `SELECT u.name AS persona, vb.*
              FROM vacation_balances vb LEFT JOIN users u ON u.id = vb.user_id
              WHERE vb.company_id = ?`,
        args: (cid) => [cid],
    }],
    asistenciaResumen: ({ from, to }) => [{
        sql: `SELECT u.name AS persona, COUNT(DISTINCT ar.date) AS dias_con_marca,
                     SUM(CASE WHEN ar.type = 'in' THEN 1 ELSE 0 END) AS entradas,
                     SUM(CASE WHEN ar.type = 'out' THEN 1 ELSE 0 END) AS salidas,
                     MIN(ar.date) AS primera, MAX(ar.date) AS ultima
              FROM attendance_records ar LEFT JOIN users u ON u.id = ar.user_id
              WHERE ar.company_id = ? AND ar.date BETWEEN ? AND ?
              GROUP BY u.name ORDER BY dias_con_marca DESC`,
        args: (cid) => [cid, from, to],
    }],

    // Devoluciones y pedidos a proveedor.
    devoluciones: ({ from, to }) => [{
        sql: `SELECT sr.sale_id, sr.total, sr.reason, sr.created_at, u.name AS usuario
              FROM sale_returns sr LEFT JOIN users u ON u.id = sr.user_id
              WHERE sr.company_id = ? AND sr.created_at BETWEEN ? AND ?
              ORDER BY sr.created_at DESC LIMIT 80`,
        args: (cid) => [cid, from, to],
    }],
    pedidosProveedor: ({ from, to }) => [{
        sql: `SELECT supplier_name, seller_name, total_amount, status,
                     created_at, expected_delivery_date
              FROM supplier_orders
              WHERE company_id = ? AND created_at BETWEEN ? AND ?
              ORDER BY created_at DESC LIMIT 80`,
        args: (cid) => [cid, from, to],
    }],

    // Buscar UN producto y ver todo lo suyo: stock, costo, precio, margen.
    //
    // Faltaba, y se noto: preguntando "cuanto stock me queda de huevo extra" el
    // asistente usaba el listado de inventario, que devuelve los primeros 50 de
    // 4.360 ordenados por nombre. El huevo esta en la posicion 239, asi que no
    // aparecia y el modelo concluia que el producto no existe — cuando existe y
    // tiene stock negativo, que es justo lo que habia que avisar.
    //
    // La busqueda es por palabras y tolerante a tildes, igual que costoHistorico:
    // "huevo aristia extra" tiene que encontrar "Ariztia Huevo Extra".
    productoBuscar: ({ buscar }) => {
        const palabras = String(buscar || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().split(/\s+/).filter(p => p.length >= 3).slice(0, 6);
        if (!palabras.length) palabras.push(String(buscar || '').toLowerCase());
        const campo = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(name),'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u')`;
        const puntaje = palabras.map(() => `(CASE WHEN ${campo} LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
        const alguna = palabras.map(() => `${campo} LIKE ?`).join(' OR ');
        const comodines = palabras.map(p => `%${p}%`);
        return [{
            sql: `SELECT id, name, sku, category, unit, stock, cost, price, tax_rate, supplier,
                         ROUND(COALESCE(stock,0) * COALESCE(cost,0)) AS valor_en_stock,
                         CASE WHEN COALESCE(cost,0) > 0
                              THEN ROUND((price - cost) * 100.0 / cost, 1) END AS margen_pct,
                         ${puntaje} AS coincidencias
                  FROM products
                  WHERE company_id = ? AND (${alguna})
                  ORDER BY coincidencias DESC, LENGTH(name) ASC LIMIT 15`,
            args: (cid) => [...comodines, cid, ...comodines],
        }, {
            sql: `SELECT COUNT(*) AS total FROM products WHERE company_id = ? AND (${alguna})`,
            args: (cid) => [cid, ...comodines],
        }];
    },

    // Detalle de lo que se compró: el renglón de cada factura, no solo el total.
    //
    // Faltaba. El asistente tenía el gasto por mes y las facturas pendientes,
    // pero nada que dijera QUÉ se compró ni a cuánto — así que ante "cuánto me
    // costaría reponer 17 cajas de huevo" tenía que responder que no sabía, aun
    // teniendo la factura de Ariztia cargada con 720 unidades a $172.
    comprasDetalle: ({ from, to, buscar = '' }) => {
        const filtro = buscar ? 'AND (pi.name LIKE ? OR p.supplier_name LIKE ?)' : '';
        const extra = buscar ? [`%${buscar}%`, `%${buscar}%`] : [];
        return [{
            sql: `SELECT pi.name AS producto, pi.quantity AS cantidad, pi.cost AS costo_unitario,
                         pi.line_total AS total_linea, pi.tax_rate AS iva,
                         pi.purchase_date AS fecha, p.supplier_name AS proveedor,
                         p.invoice_number AS factura, p.is_credit AS a_credito
                  FROM purchase_items pi
                  LEFT JOIN purchases p ON p.id = pi.purchase_id
                  WHERE pi.company_id = ? AND pi.purchase_date BETWEEN ? AND ? ${filtro}
                  ORDER BY pi.purchase_date DESC LIMIT 120`,
            args: (cid) => [cid, from, to, ...extra],
        }];
    },

    // Historial de costo de UN producto: a cuánto lo vengo comprando y a quién.
    // Sirve para "¿me subió el precio?" y para presupuestar una reposición.
    //
    // La búsqueda NO es un LIKE del texto completo, y hay un motivo concreto:
    // preguntando por voz salió "huevo aristia", y el producto se llama "Ariztia
    // Huevo Primera". Un LIKE literal falla dos veces ahí — por el orden de las
    // palabras y por la letra cambiada— y el asistente terminaba diciendo "no
    // tengo datos" teniendo 26 compras cargadas.
    //
    // Por eso se parte en palabras y se puntúa: cada palabra que aparece —en el
    // producto o en el proveedor— suma. Alcanza con que UNA acierte, y las que
    // más coinciden quedan arriba. Así "huevo aristia" encuentra igual, aunque
    // "aristia" no exista en ningún lado.
    costoHistorico: ({ buscar }) => {
        const palabras = String(buscar || '')
            .split(/\s+/).filter(p => p.length >= 3).slice(0, 6);
        if (!palabras.length) palabras.push(String(buscar || ''));
        const campos = 'pi.name || \' \' || COALESCE(p.supplier_name, \'\')';
        const puntaje = palabras.map(() => `(CASE WHEN ${campos} LIKE ? THEN 1 ELSE 0 END)`).join(' + ');
        const alguna = palabras.map(() => `${campos} LIKE ?`).join(' OR ');
        const comodines = palabras.map(p => `%${p}%`);
        return [{
            sql: `SELECT pi.name AS producto, pi.purchase_date AS fecha, pi.quantity AS cantidad,
                         pi.cost AS costo_unitario, pi.line_total AS total_linea,
                         p.supplier_name AS proveedor, p.invoice_number AS factura,
                         ${puntaje} AS coincidencias
                  FROM purchase_items pi
                  LEFT JOIN purchases p ON p.id = pi.purchase_id
                  WHERE pi.company_id = ? AND (${alguna})
                  ORDER BY coincidencias DESC, pi.purchase_date DESC LIMIT 40`,
            args: (cid) => [...comodines, cid, ...comodines],
        }, {
            // El resumen va POR PRODUCTO, no junto. Con la búsqueda floja, un
            // promedio único mezcla cosas distintas: buscando "huevo" entraba
            // "Chubi Chocolate Huevo 30g" a $532 y el promedio del huevo saltaba
            // de $162 a $712. Un número así suena creíble y está mal, que es la
            // peor combinación posible.
            //
            // Separado por producto, el modelo ve "Ariztia Huevo Primera: $162"
            // al lado de "Chocolate: $532" y elige el que corresponde.
            sql: `SELECT pi.name AS producto,
                         ${puntaje} AS coincidencias,
                         COUNT(*) AS compras,
                         ROUND(MIN(pi.cost)) AS costo_minimo,
                         ROUND(MAX(pi.cost)) AS costo_maximo,
                         ROUND(AVG(pi.cost)) AS costo_promedio,
                         ROUND(SUM(pi.quantity)) AS unidades_totales,
                         MAX(pi.purchase_date) AS ultima_compra
                  FROM purchase_items pi
                  LEFT JOIN purchases p ON p.id = pi.purchase_id
                  WHERE pi.company_id = ? AND (${alguna})
                  GROUP BY pi.name
                  ORDER BY coincidencias DESC, compras DESC LIMIT 15`,
            args: (cid) => [...comodines, cid, ...comodines],
        }];
    },

    // Con qué proveedores se trabaja y qué se les compra. Sirve para que el
    // asistente encuentre el nombre correcto cuando el usuario lo escribe
    // distinto ("aristia" por "Ariztia") en vez de contestar que no hay datos.
    proveedoresLista: () => [{
        sql: `SELECT COALESCE(p.supplier_name,'Sin proveedor') AS proveedor,
                     COUNT(DISTINCT p.id) AS facturas,
                     ROUND(SUM(p.total)) AS total_comprado,
                     MAX(p.date) AS ultima_compra
              FROM purchases p
              WHERE p.company_id = ?
              GROUP BY proveedor ORDER BY total_comprado DESC LIMIT 60`,
        args: (cid) => [cid],
    }],

    // Cuánto se le compró a cada proveedor en el período.
    comprasPorProveedor: ({ from, to }) => [{
        sql: `SELECT COALESCE(supplier_name,'Sin proveedor') AS proveedor,
                     COUNT(*) AS facturas, ROUND(SUM(total)) AS total_comprado,
                     ROUND(SUM(CASE WHEN is_credit = 1 THEN total ELSE 0 END)) AS a_credito,
                     MAX(date) AS ultima_compra
              FROM purchases
              WHERE company_id = ? AND date BETWEEN ? AND ?
              GROUP BY proveedor ORDER BY total_comprado DESC`,
        args: (cid) => [cid, from, to],
    }],

    // Altas de productos por período — usa la fecha que se agregó en la v20.
    productosNuevos: ({ from, to }) => [{
        sql: `SELECT name, category, price, cost, stock, created_at
              FROM products
              WHERE company_id = ? AND created_at BETWEEN ? AND ?
              ORDER BY created_at DESC LIMIT 100`,
        args: (cid) => [cid, from, to],
    }, {
        sql: `SELECT COUNT(*) AS total FROM products
              WHERE company_id = ? AND created_at BETWEEN ? AND ?`,
        args: (cid) => [cid, from, to],
    }],
};

export async function reportRun(turso, companyId, session, { name, params = {} }) {
    const special = SPECIAL[name];
    if (special) {
        const rows = await special(turso, companyId, params);
        return { success: true, rows: [rows] };
    }
    const build = REPORTS[name];
    if (!build) return { success: false, error: 'Reporte no válido' };
    const queries = build(params).map(q => ({ sql: q.sql, args: q.args(companyId) }));
    const results = queries.length === 1
        ? [await turso.execute(queries[0])]
        : await turso.batch(queries, 'read');
    return { success: true, rows: results.map(r => r.rows) };
}
