import { createClient } from '@libsql/client';
import { getSession, isCompanyMember } from '../_lib/guard.js';
import { renovarSesionSiHaceFalta } from '../_lib/auth.js';
import { personalActions } from '../_lib/personalActions.js';
import { saleCommit, saleAggregations, saleAggregationsReverse, saleCancel, saleDetails, calentarEscritura } from '../_lib/salesActions.js';
import { registerActions } from '../_lib/registerActions.js';
import { purchaseActions } from '../_lib/purchaseActions.js';
import { preorderActions } from '../_lib/preorderActions.js';
import { deliveryActions } from '../_lib/deliveryActions.js';
import { reportRun, PRODUCT_COLS_SIN_IMAGEN } from '../_lib/reportActions.js';
import { sorteoActions } from '../_lib/sorteoActions.js';
import { companyActions } from '../_lib/companyActions.js';
import { paymentActions } from '../_lib/paymentActions.js';
import { comboActions } from '../_lib/comboActions.js';
import { alertActions } from '../_lib/alertActions.js';
import { roleActions } from '../_lib/roleActions.js';
import { supportActions } from '../_lib/supportActions.js';
import { inventoryActions } from '../_lib/inventoryActions.js';
import { saleAdjustActions } from '../_lib/saleAdjustActions.js';
import { userActions } from '../_lib/userActions.js';
import { maintenanceActions } from '../_lib/maintenanceActions.js';
import { telemetryActions } from '../_lib/telemetryActions.js';
import { taxActions } from '../_lib/taxActions.js';
import { bootstrapActions } from '../_lib/bootstrapActions.js';
import { financeActions } from '../_lib/financeActions.js';
import { appActions } from '../_lib/appActions.js';

// Endpoint de datos del app normal (Fase 1 · Paso 4).
// Exige: sesión firmada + que el usuario sea MIEMBRO de la empresa (companyId).
// Establece el patrón para migrar el resto de dominios sacando el token del navegador.

let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Faltan variables Turso');
    _turso = createClient({ url, authToken });
    return _turso;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // 1) Sesión válida
    const session = getSession(req);
    if (!session) return res.status(401).json({ success: false, error: 'No autenticado' });

    // 1a) Sesión deslizante. Este endpoint lo toca TODO el POS, así que renovar
    // acá alcanza para que a nadie se le venza la sesión mientras trabaja.
    renovarSesionSiHaceFalta(session, res);

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { action, companyId, expectedUserId } = body;

        // 1b) Anti-"pestaña zombi". La cookie de sesión es del NAVEGADOR, no de la
        // pestaña: si en otra pestaña se inicia sesión con otro usuario, esta seguiría
        // mostrando al anterior pero escribiendo a nombre del nuevo (así se perdieron
        // ventas de una cajera dentro de la caja de otro). La pestaña manda a nombre de
        // quién cree actuar; si no coincide con la sesión real, se corta ANTES de tocar
        // la base.
        //
        // Se responde 200 a propósito: es un rechazo de negocio, no un fallo de red. Con
        // 4xx/5xx el cliente encolaría la venta y la reintentaría para siempre.
        if (expectedUserId != null && Number(expectedUserId) !== Number(session.uid)) {
            return res.status(200).json({
                success: false,
                error: 'SESSION_MISMATCH',
                message: 'Se inició sesión con otro usuario en esta misma ventana del navegador. Esta pestaña quedó desactualizada y no puede seguir operando.',
                sessionUserId: session.uid,
            });
        }

        const turso = getTurso();

        // Acciones de sesión (sin companyId): empresas del usuario (recarga / selector)
        // y reconstrucción de la sesión desde la cookie (pestaña que quedó con otra
        // cuenta y necesita adoptar la que realmente está activa).
        if (action === 'userCompanies') {
            return res.status(200).json(await bootstrapActions.userCompanies(turso, session));
        }
        if (action === 'sessionUser') {
            return res.status(200).json(await bootstrapActions.sessionUser(turso, session));
        }

        if (!companyId) return res.status(400).json({ success: false, error: 'Falta companyId' });

        // 2) Membresía: el usuario debe pertenecer a esa empresa (aislamiento multi-empresa)
        if (!(await isCompanyMember(turso, session.uid, companyId))) {
            return res.status(403).json({ success: false, error: 'No perteneces a esta empresa' });
        }

        // La IP queda en el registro de asistencia: una marca de kiosco tiene que
        // poder decir desde dónde se hizo. Se toma del proxy, nunca del cliente.
        session.ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket?.remoteAddress || null;

        // 3a) Dominio Personal/Nómina (Fase 1 · Paso 9): acciones 'personal.<clave>'
        if (typeof action === 'string' && action.startsWith('personal.')) {
            const handler = personalActions[action.slice('personal.'.length)];
            if (!handler) return res.status(400).json({ success: false, error: 'Acción no válida' });
            return res.status(200).json(await handler(turso, companyId, session, body));
        }

        if (typeof action === 'string' && action.startsWith('finance.')) {
            const financeHandler = financeActions[action.slice('finance.'.length)];
            if (!financeHandler) return res.status(400).json({ success: false, error: 'Acción financiera no válida' });
            return res.status(200).json(await financeHandler(turso, companyId, session, body));
        }

        // 3) Despacho por acción (todas ya con companyId validado)
        switch (action) {
            case 'dashboard':
                return res.status(200).json({ success: true, data: await dashboard(turso, companyId, body) });
            case 'fetchSales':
                return res.status(200).json({ success: true, data: await fetchSales(turso, companyId, body) });
            case 'syncCatalog':
                return res.status(200).json({ success: true, data: await syncCatalog(turso, companyId, body) });
            case 'catalogoIds':
                return res.status(200).json({ success: true, data: await catalogoIds(turso, companyId) });
            // Carga inicial de la app (Fase 1 · Paso 35)
            case 'bootstrap':
                return res.status(200).json(await bootstrapActions.bootstrap(turso, companyId));
            // Lectura paginada de productos para sync WooCommerce (Fase 1 · Paso 37)
            case 'productsForStoreSync':
                return res.status(200).json(await productsForStoreSync(turso, companyId, body));
            // Recompresión de imágenes: lectura paginada + update (Paso final)
            case 'productsWithImages':
                return res.status(200).json(await productsWithImages(turso, companyId, body));
            case 'productImageUpdate':
                return res.status(200).json(await productImageUpdate(turso, companyId, body));
            // Inventario (Fase 1 · Paso 7)
            case 'productCreate':
                return res.status(200).json(await productCreate(turso, companyId, session, body.product));
            case 'productPriceUpdate':
                return res.status(200).json(await productPriceUpdate(turso, companyId, session, body));
            case 'productUpdate':
                return res.status(200).json(await productUpdate(turso, companyId, session, body.id, body.product));
            case 'productDelete':
                return res.status(200).json(await productDelete(turso, companyId, session, body.id));
            case 'categoryCreate':
                return res.status(200).json(await categoryCreate(turso, companyId, session, body.category));
            case 'categoryUpdate':
                return res.status(200).json(await categoryUpdate(turso, companyId, session, body.id, body.category));
            case 'categoryDelete':
                return res.status(200).json(await categoryDelete(turso, companyId, session, body.id));
            // Clientes y cuenta corriente (Fase 1 · Paso 8)
            case 'clientCreate':
                return res.status(200).json(await clientCreate(turso, companyId, session, body.client));
            case 'clientUpdate':
                return res.status(200).json(await clientUpdate(turso, companyId, session, body.id, body.client));
            case 'clientDelete':
                return res.status(200).json(await clientDelete(turso, companyId, session, body.id));
            case 'clientRegisterPayment':
                return res.status(200).json(await clientRegisterPayment(turso, companyId, session, body));
            case 'clientSyncDebt':
                return res.status(200).json(await clientSyncDebt(turso, companyId, body.clientId));
            case 'clientCreditStatus':
                return res.status(200).json(await clientCreditStatus(turso, companyId, body));
            case 'clientsDebtSummary':
                return res.status(200).json(await clientsDebtSummary(turso, companyId));
            // Tasas de impuesto (Fase 1 · Paso 34)
            case 'taxRateCreate':
            case 'taxRateUpdate':
            case 'taxRateDelete':
                return res.status(200).json(await taxActions[action](turso, companyId, session, body));
            // Venta (Fase 1 · Paso 10 — corazón del POS, lógica portada tal cual)
            case 'saleCommit':
                return res.status(200).json(await saleCommit(turso, companyId, session, body));
            // Prepara el camino de escritura para que no lo pague la primera venta.
            case 'calentarEscritura':
                return res.status(200).json(await calentarEscritura(turso));
            case 'saleAggregations':
                return res.status(200).json(await saleAggregations(turso, companyId, session, body));
            case 'saleAggregationsReverse':
                return res.status(200).json(await saleAggregationsReverse(turso, companyId, session, body));
            // Anulación y detalle de venta + caja registradora (Fase 1 · Paso 12)
            case 'saleCancel':
                return res.status(200).json(await saleCancel(turso, companyId, session, body));
            case 'saleDetails':
                return res.status(200).json(await saleDetails(turso, companyId, session, body));
            // Caja: mutaciones (Paso 12) + lecturas/stats/conciliación (Paso 13)
            case 'registerCheck':
            case 'registerOpen':
            case 'registerClose':
            case 'cashMovementAdd':
            case 'registerActiveList':
            case 'registerStats':
            case 'registerMethodTransactions':
            case 'registersClosed':
            case 'cashMovementsList':
            case 'registerReport':
            case 'terminalCardSales':
            case 'conciliatedSaleIds':
            case 'untaggedCardSalesCount':
            case 'reconciliationsList':
            case 'reconciliationSave':
            case 'reconciliationDelete':
                return res.status(200).json(await registerActions[action](turso, companyId, session, body));
            // Compras y proveedores (Fase 1 · Paso 14)
            case 'supplierCreate':
            case 'supplierUpdate':
            case 'supplierDelete':
            case 'supplierOrdersFetch':
            case 'supplierOrderCreate':
            case 'supplierOrderSetStatus':
            case 'supplierOrderAddItems':
            case 'supplierOrderDelete':
            case 'purchaseCreate':
            case 'purchasesFetch':
            case 'purchaseDetails':
            case 'purchaseDelete':
            case 'invoicePayFull':
            case 'invoicePayPartial':
            case 'supplierPurchaseSummaryGet':
                return res.status(200).json(await purchaseActions[action](turso, companyId, session, body));
            // Recuerda cómo escribe el proveedor un producto en su factura, a
            // partir de la corrección que hizo la persona al cargarla.
            case 'productAliasLearn':
                return res.status(200).json(await purchaseActions.productAliasLearn(turso, companyId, session, body));
            // Códigos de proveedor escritos a mano desde la ficha del producto.
            // Misma tabla que los aprendidos: lo que se escribe acá también hace
            // que las facturas de ese proveedor se emparejen solas.
            case 'productAliasesList':
            case 'productAliasAdd':
            case 'productAliasDelete':
                return res.status(200).json(await purchaseActions[action](turso, companyId, session, body));
            // Encargos / preorders (Fase 1 · Paso 15)
            case 'preorderCreate':
            case 'preordersFetch':
            case 'pendingWebOrders':
            case 'preorderActiveCounts':
            case 'preorderDetails':
            case 'preorderItemsEdit':
            case 'preorderStatusUpdate':
            case 'preorderPaymentAdd':
            case 'preorderDeliver':
            case 'preorderReportsRaw':
            case 'preorderAnalyticsRaw':
            case 'preorderableProducts':
                return res.status(200).json(await preorderActions[action](turso, companyId, session, body));
            // App Delivery (migración 0013)
            case 'courierList':
            case 'courierSave':
            case 'courierDelete':
            case 'deliveryBoard':
            case 'deliveryCreate':
            case 'deliveryAssign':
            case 'deliveryStatus':
            case 'deliveryImportable':
            case 'deliveryDetail':
            case 'courierMyDeliveries':
            case 'courierTake':
            case 'courierPing':
            case 'deliveryTracking':
            case 'settlementCreate':
            case 'settlementList':
            case 'deliverySettingsSave':
                return res.status(200).json(await deliveryActions[action](turso, companyId, session, body));
            // Reportes generales (catálogo whitelisteado — Fase 1 · Paso 18)
            case 'report':
                return res.status(200).json(await reportRun(turso, companyId, session, body));
            // Sorteos (Fase 1 · Paso 22)
            case 'sorteoLoad':
            case 'sorteoParticipants':
            case 'sorteoSave':
            case 'sorteoClearParticipants':
                return res.status(200).json(await sorteoActions[action](turso, companyId, session, body));
            // Complementos del Marketplace
            case 'appList':
            case 'appActivate':
            case 'appCancel':
            case 'appChargeQuote':
                return res.status(200).json(await appActions[action](turso, companyId, session, body));
            // Configuración de empresa / folios / DTEs (Fase 1 · Paso 23).
            // OJO: estas viven en companyActions. Estaban agrupadas con las de Apps,
            // así que se llamaba appActions['companyFieldsUpdate'] (inexistente) y la
            // pantalla de Empresa decía "guardado" sin escribir nada.
            case 'companyFieldsUpdate':
            case 'folioSettingsLoad':
            case 'folioSettingsSave':
            case 'dteRetryDelete':
            case 'companyModuleUpdate':
            case 'companyLinkedCreate':
            case 'companyBranches':
            case 'kdsTokenEnsure':
            case 'receiptSettingsLoad':
            case 'preventaSettingsLoad':
            case 'receiptSettingsSave':
            case 'preventaSettingsSave':
            case 'paymentSettingsGet':
                return res.status(200).json(await companyActions[action](turso, companyId, session, body));
            // Telemetría de fallback analítico (Fase 1 · Paso 33)
            case 'telemetryFlush':
                return res.status(200).json(await telemetryActions.telemetryFlush(turso, companyId, session, body));
            // Mantenimiento de agregaciones (Fase 1 · Paso 32)
            case 'recalculateProductProfits':
            case 'cleanOldProductStats':
            case 'recalculateProductAverages':
                return res.status(200).json(await maintenanceActions[action](turso, companyId, session, body));
            // Usuarios de la empresa (Fase 1 · Paso 31)
            case 'userCreate':
            case 'userUpdate':
            case 'userDelete':
            case 'userRevokeAccess':
                return res.status(200).json(await userActions[action](turso, companyId, session, body));
            // Medios de pago: config + datáfonos + cuentas (Fase 1 · Paso 25)
            case 'paymentSettingsLoad':
            case 'paymentMethodToggle':
            case 'terminalCreate':
            case 'terminalUpdate':
            case 'terminalDelete':
            case 'bankAccountCreate':
            case 'bankAccountUpdate':
            case 'bankAccountDelete':
            case 'transferIntentCreate':
                return res.status(200).json(await paymentActions[action](turso, companyId, session, body));
            // Combos / packs (Fase 1 · Paso 25)
            case 'combosFetch':
            case 'combosForPos':
            case 'comboCreate':
            case 'comboUpdate':
            case 'comboDelete':
            case 'comboToggle':
                return res.status(200).json(await comboActions[action](turso, companyId, session, body));
            // Alertas de inventario (Fase 1 · Paso 26)
            case 'alertSettingsGet':
            case 'alertSettingsSave':
            case 'alertsList':
            case 'alertsUnreadCount':
            case 'alertMarkRead':
            case 'alertsMarkAllRead':
            case 'alertsDeleteOld':
            case 'alertSummary':
            case 'alertsCheck':
            case 'stockPredictionsCheck':
                return res.status(200).json(await alertActions[action](turso, companyId, session, body));
            // Roles y permisos (Fase 1 · Paso 27)
            case 'rolePermissionsList':
            case 'companyRolesList':
            case 'rolePermissionUpdate':
            case 'customRoleCreate':
            case 'customRoleDelete':
            case 'customRoleRename':
            case 'roleResetDefaults':
            case 'permissionsSeedDefaults':
                return res.status(200).json(await roleActions[action](turso, companyId, session, body));
            // Soporte (lado cliente — Fase 1 · Paso 28)
            case 'supportTicketCreate':
            case 'supportTicketsList':
            case 'supportTicketMessages':
            case 'supportMessageSend':
            case 'supportMessagesMarkRead':
            case 'supportAttachmentUpload':
            case 'supportMessageAttachments':
                return res.status(200).json(await supportActions[action](turso, companyId, session, body));
            // Lotes + control de inventario + reconciliación (Fase 1 · Paso 29)
            case 'lotsReport':
            case 'lotsGlobalStats':
            case 'lotWriteOff':
            case 'lotWriteOffAll':
            case 'lossesList':
            case 'lossesStats':
            case 'controlCreate':
            case 'controlActive':
            case 'controlProducts':
            case 'controlSaveItem':
            case 'controlRemoveItem':
            case 'controlComplete':
            case 'controlCancel':
            case 'controlReport':
            case 'controlHistory':
            case 'reconciliationData':
            case 'reconciliationLots':
            case 'reconcileProduct':
            case 'productProfitReport':
                return res.status(200).json(await inventoryActions[action](turso, companyId, session, body));
            // Suspendidas + preventas + devoluciones (Fase 1 · Paso 30)
            case 'suspendedCount':
            case 'suspendCreate':
            case 'suspendedList':
            case 'suspendRecover':
            case 'suspendDelete':
            case 'preventaCreate':
            case 'preventasPending':
            case 'preventaByCode':
            case 'preventaComplete':
            case 'preventaCancel':
            case 'preventasCount':
            case 'saleReturnCommit':
            case 'saleReturnsList':
                return res.status(200).json(await saleAdjustActions[action](turso, companyId, session, body));
            default:
                return res.status(400).json({ success: false, error: 'Acción no válida' });
        }
    } catch (e) {
        console.error('❌ /api/data/actions error:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

// Devuelve los datos crudos del dashboard (el cliente hace la presentación).
// Las fechas (todayStr/monthStartStr) llegan del cliente ya calculadas en su zona horaria.
async function dashboard(turso, companyId, { todayStr, monthStartStr }) {
    const [todayStatsRes, monthStatsRes, todayUtilityRes] = await Promise.all([
        turso.execute({
            sql: `SELECT COALESCE(SUM(total_sales), 0) as total_sales, COALESCE(SUM(total_orders), 0) as total_orders
                  FROM sales_daily_summary WHERE company_id = ? AND day = ?`,
            args: [companyId, todayStr],
        }),
        turso.execute({
            sql: `SELECT day, total_sales, total_orders FROM sales_daily_summary
                  WHERE company_id = ? AND day >= ? AND day <= ? ORDER BY day ASC`,
            args: [companyId, monthStartStr, todayStr],
        }),
        turso.execute({
            sql: `SELECT COALESCE(SUM(total_profit), 0) as total_profit FROM product_daily_profit
                  WHERE company_id = ? AND day = ?`,
            args: [companyId, todayStr],
        }),
    ]);
    const [recentSalesRes, lowStockRes, topProductsRes] = await Promise.all([
        turso.execute({
            sql: `SELECT s.*, u.name as user_name FROM sales s
                  LEFT JOIN users u ON s.user_id = u.id
                  WHERE s.company_id = ? ORDER BY s.date DESC LIMIT 20`,
            args: [companyId],
        }),
        turso.execute({
            // El widget "Sin Stock" solo pinta name y sku (ver Dashboard.jsx) — antes
            // se traía PRODUCT_COLS_SIN_IMAGEN entero (14 columnas) para usar 2.
            //
            // Angosto además de sin-foto: aunque no se pida `image`, ir a buscar
            // CUALQUIER columna de un producto obliga a SQLite a traer su fila
            // completa (no guarda por columnas), y esa fila tiene la foto adentro.
            // Con la página en caché no se nota; en frío, cada producto puede costar
            // cientos de ms — medido en producción el 3-sep-2026: 635 ms para 20
            // filas en la empresa "veci-2". El índice de cobertura
            // idx_products_stock_covering (migración 0026) hace que esta consulta
            // conteste desde el índice y nunca toque la tabla.
            sql: `SELECT id, name, sku FROM products WHERE company_id = ? AND stock <= 0 LIMIT 20`,
            args: [companyId],
        }),
        turso.execute({
            sql: `SELECT p.id, p.name, p.category, p.unit, pdp.total_quantity, pdp.total_revenue
                  FROM product_daily_profit pdp
                  JOIN products p ON pdp.product_id = p.id
                  WHERE pdp.company_id = ? AND pdp.day = ?
                  ORDER BY pdp.total_quantity DESC LIMIT 10`,
            args: [companyId, todayStr],
        }),
    ]);

    return {
        todayStats: todayStatsRes.rows[0] || { total_sales: 0, total_orders: 0 },
        monthlyStats: monthStatsRes.rows,
        todayUtility: todayUtilityRes.rows[0]?.total_profit || 0,
        recentSales: recentSalesRes.rows,
        lowStockProducts: lowStockRes.rows,
        topProducts: topProductsRes.rows,
    };
}

// Historial de ventas (columnas livianas) con filtros. Las fechas llegan del cliente
// (ya calculadas en su zona horaria). Devuelve las filas crudas.
async function fetchSales(turso, companyId, body) {
    const { start, end, saleIdFilter, paymentMethodFilter, sellerIdFilter } = body;
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 30, 1), 200);
    const offset = Math.max(parseInt(body.offset, 10) || 0, 0);

    let query = 'SELECT id, date, total, status, user_id, payment_method, client_name, client_id FROM sales WHERE company_id = ?';
    const args = [companyId];

    if (saleIdFilter) {
        query += ' AND id = ?';
        args.push(saleIdFilter);
    } else {
        query += ' AND date >= ? AND date <= ?';
        args.push(start, end);
        if (paymentMethodFilter && paymentMethodFilter !== 'Todos') { query += ' AND payment_method = ?'; args.push(paymentMethodFilter); }
        if (sellerIdFilter && sellerIdFilter !== 'Todos') { query += ' AND user_id = ?'; args.push(sellerIdFilter); }
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const result = await turso.execute({ sql: query, args });
    return result.rows;
}

// Catálogo para el sync offline (Dexie). Sin `since`: full (lots con quantity > 0).
// Con `since`: incremental (updated_at > since; lots SIN filtro de quantity para
// detectar lotes que llegan a 0).
//
// NOTA: products EXCLUYE la columna `image` (base64, ~160 MB en la empresa más
// grande): no cabe en una respuesta serverless y las imágenes ya se cargan bajo
// demanda. Fuente única: la misma lista que usa la búsqueda del POS (todas las
// columnas menos la foto en base64). Ver el porqué en reportActions.js.
//
// Acá NO va `has_image`. Se probó y se sacó: la consulta seguía leyendo las mismas
// filas (no gastaba más cuota) pero tardaba 67% más por página —36 ms contra 60 ms
// en 1.500 productos—, porque preguntar si la foto existe obliga a ir a buscarla a
// las páginas donde viven esos 160 MB. Medido aparte: recorrer 4.379 productos
// tocando `name` cuesta 0 ms; tocando `image`, 1.079 ms. Y no lo usaba nadie: todo
// el código que mira `has_image` trabaja sobre filas de las consultas online
// (productsSearch, categoryProducts), que sí lo traen. Lo que guarda el sync en el
// equipo nunca se consultaba — las fotos offline se buscan por id (imagenesLocal.js).
const PRODUCT_COLS = PRODUCT_COLS_SIN_IMAGEN;

// Cuántas filas como máximo por respuesta.
//
// Por qué se pagina: medido el 19-ago-2026 contra la base real, el catálogo de la
// empresa más grande (4.367 productos + 3.792 lotes) pesaba 3,53 MB en UNA sola
// respuesta — 78% del techo de 4,5 MB de las funciones de Vercel. Un cliente con
// ~6.000 productos lo reventaba sin aviso y se quedaba sin catálogo offline, que
// es justo lo que hace falta cuando se cae el internet.
//
// products (~600 B/fila) y product_lots (~270 B/fila) son las únicas tablas que
// crecen sin techo; clients, categories y tax_rates viajan enteras en la primera
// página (juntas no llegan a 20 KB).
const PAGINA_SYNC = 1500;

/**
 * Paginado por cursor de id (no por OFFSET): si mientras baja el catálogo alguien
 * crea o borra un producto, OFFSET saltearía o repetiría filas. Con `id > ?` cada
 * fila se ve exactamente una vez.
 *
 * Contrato:
 *  - Primera llamada: sin `cursor` → devuelve también las tablas chicas.
 *  - Si una tabla trajo la página completa, el `cursor` de la respuesta trae su
 *    último id; si trajo menos, esa tabla terminó y desaparece del cursor.
 *  - Cuando no queda ninguna, la respuesta NO trae `cursor`: ahí termina el sync.
 *
 * PAGINAR ES OPCIONAL Y LO PIDE EL CLIENTE (`paginado`). No es un detalle de
 * estilo: durante un despliegue conviven las dos versiones. Una pestaña que ya
 * estaba abierta corre el JS viejo, que no sabe de cursores — si el servidor le
 * contestara paginado, se guardaría solo la primera página y BORRARÍA el resto
 * del catálogo local (el sync viejo borra y reescribe). O sea que el despliegue
 * en sí dejaría cajas sin catálogo offline, que es justo lo que vinimos a
 * arreglar. Sin `paginado`, la respuesta sale entera como siempre.
 *
 * Al revés también funciona: el cliente nuevo contra un servidor viejo recibe
 * todo de una y sin `cursor`, así que su bucle termina en la primera vuelta.
 */
/**
 * Solo los NÚMEROS de lo que existe hoy en el servidor, para que el equipo sepa
 * qué borrar de su copia local.
 *
 * Existe para no bajar el catálogo entero por esto. La descarga liviana
 * (`updated_at > ?`) sabe agregar y actualizar pero no sabe borrar, así que
 * hasta ahora la única forma de sacar un producto borrado era tirar el catálogo
 * local y bajar los 4.419 de nuevo: medido contra producción el 4-sep-2026,
 * 54 segundos y 2,52 MB, en CADA inicio de sesión.
 *
 * Pedir solo los id se contesta desde un índice y ni toca la fila del producto
 * —que lleva la foto en base64 adentro, 36 KB de promedio—. Misma tarea:
 * 157 ms y 22 KB. Trescientas cuarenta veces más rápido.
 */
export async function catalogoIds(turso, companyId) {
    const [prod, lotes, cli, cat, iva] = await turso.batch([
        { sql: 'SELECT id FROM products WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT id FROM product_lots WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT id FROM clients WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT id FROM categories WHERE company_id = ?', args: [companyId] },
        { sql: 'SELECT id FROM tax_rates WHERE company_id = ?', args: [companyId] },
    ], 'read');
    const ids = (r) => r.rows.map((f) => Number(f.id));
    return {
        products: ids(prod),
        productLots: ids(lotes),
        clients: ids(cli),
        categories: ids(cat),
        taxRates: ids(iva),
    };
}

export async function syncCatalog(turso, companyId, { since, cursor, limit, paginado }) {
    // Sin paginar: un tope enorme que en la práctica trae todo, y nunca hay cursor.
    const lim = paginado
        ? Math.min(Math.max(parseInt(limit, 10) || PAGINA_SYNC, 1), 5000)
        : 1_000_000_000;
    const primeraPagina = !cursor;
    const seguirProductos = primeraPagina || Number.isFinite(Number(cursor?.product));
    const seguirLotes = primeraPagina || Number.isFinite(Number(cursor?.lot));
    const desdeProducto = primeraPagina ? 0 : Number(cursor?.product) || 0;
    const desdeLote = primeraPagina ? 0 : Number(cursor?.lot) || 0;

    const queries = [];
    const indices = {};

    if (seguirProductos) {
        indices.products = queries.length;
        // El índice de cobertura idx_products_company_sync_covering (migración 0026)
        // hace que esto conteste enteramente desde el índice, sin tocar la fila del
        // producto —que lleva la foto en base64 adentro—. Sin él, un recorrido
        // secuencial como este igual paga el costo de esa foto por cada producto,
        // aunque la columna no esté en el SELECT: SQLite no guarda por columnas.
        // Medido en frío contra una empresa real el 3-sep-2026: 9,4 s para apenas
        // 202 productos. Este catálogo se descarga COMPLETO en cada login (ver el
        // porqué en App.jsx: detecta productos borrados en el servidor), así que
        // el costo lo paga cada inicio de sesión, no solo quien mira reportes.
        queries.push(since
            ? { sql: `SELECT ${PRODUCT_COLS} FROM products WHERE company_id = ? AND updated_at > ? AND id > ? ORDER BY id LIMIT ?`, args: [companyId, since, desdeProducto, lim] }
            : { sql: `SELECT ${PRODUCT_COLS} FROM products WHERE company_id = ? AND id > ? ORDER BY id LIMIT ?`, args: [companyId, desdeProducto, lim] });
    }
    if (seguirLotes) {
        indices.productLots = queries.length;
        queries.push(since
            ? { sql: 'SELECT * FROM product_lots WHERE company_id = ? AND updated_at > ? AND id > ? ORDER BY id LIMIT ?', args: [companyId, since, desdeLote, lim] }
            : { sql: 'SELECT * FROM product_lots WHERE company_id = ? AND quantity > 0 AND id > ? ORDER BY id LIMIT ?', args: [companyId, desdeLote, lim] });
    }
    if (primeraPagina) {
        indices.clients = queries.length;
        queries.push(since
            ? { sql: 'SELECT * FROM clients WHERE company_id = ? AND updated_at > ?', args: [companyId, since] }
            : { sql: 'SELECT * FROM clients WHERE company_id = ?', args: [companyId] });
        indices.categories = queries.length;
        queries.push(since
            ? { sql: 'SELECT * FROM categories WHERE company_id = ? AND updated_at > ?', args: [companyId, since] }
            : { sql: 'SELECT * FROM categories WHERE company_id = ?', args: [companyId] });
        indices.taxRates = queries.length;
        queries.push(since
            ? { sql: 'SELECT * FROM tax_rates WHERE company_id = ? AND updated_at > ?', args: [companyId, since] }
            : { sql: 'SELECT * FROM tax_rates WHERE company_id = ?', args: [companyId] });
    }

    const res = queries.length ? await turso.batch(queries, 'read') : [];
    const filas = (nombre) => (indices[nombre] === undefined ? [] : res[indices[nombre]].rows);

    const products = filas('products');
    const productLots = filas('productLots');

    // Una tabla siguió si llenó la página completa. Si trajo menos, ya no queda nada.
    const siguiente = {};
    if (paginado) {
        if (products.length === lim) siguiente.product = products[products.length - 1].id;
        if (productLots.length === lim) siguiente.lot = productLots[productLots.length - 1].id;
    }

    return {
        products,
        productLots,
        clients: filas('clients'),
        categories: filas('categories'),
        taxRates: filas('taxRates'),
        ...(Object.keys(siguiente).length ? { cursor: siguiente } : {}),
    };
}

// Productos con SKU para sincronizar hacia WooCommerce (Paso 37). Paginado porque
// incluye `image` (base64) y el payload debe caber en la respuesta serverless.
// El envío a Woo sigue siendo del cliente (loop intacto); esto solo mueve la lectura.
async function productsForStoreSync(turso, companyId, { offset = 0, limit = 25 }) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const [rowsRes, countRes] = await turso.batch([
        {
            sql: `SELECT id, name, sku, price, stock, category, cost, unit, is_offer, offer_price, tax_rate, image, price_ranges
                  FROM products WHERE company_id = ? AND sku IS NOT NULL AND TRIM(sku) <> ''
                  ORDER BY id ASC LIMIT ? OFFSET ?`,
            args: [companyId, lim, off],
        },
        { sql: "SELECT COUNT(*) AS c FROM products WHERE company_id = ? AND sku IS NOT NULL AND TRIM(sku) <> ''", args: [companyId] },
    ], 'read');
    return { success: true, products: rowsRes.rows, total: countRes.rows[0].c };
}

// Productos con imagen (paginado) para la recompresión de imágenes (Paso final).
// La compresión ocurre en el navegador (canvas); server solo lee y actualiza.
async function productsWithImages(turso, companyId, { offset = 0, limit = 10 }) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const [rowsRes, countRes] = await turso.batch([
        {
            sql: "SELECT id, name, image FROM products WHERE company_id = ? AND image IS NOT NULL AND image != '[object Object]' ORDER BY id ASC LIMIT ? OFFSET ?",
            args: [companyId, lim, off],
        },
        { sql: "SELECT COUNT(*) AS c FROM products WHERE company_id = ? AND image IS NOT NULL AND image != '[object Object]'", args: [companyId] },
    ], 'read');
    return { success: true, products: rowsRes.rows, total: countRes.rows[0].c };
}

async function productImageUpdate(turso, companyId, { id, image }) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'UPDATE products SET image = ? WHERE id = ? AND company_id = ?',
        args: [image, id, companyId],
    });
    return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Inventario (Fase 1 · Paso 7) — mutaciones de productos y categorías.
// Mismas queries que hacía el navegador, ahora con sesión + membresía
// validadas y el audit_log firmado con el usuario de la sesión.
// ─────────────────────────────────────────────────────────────────

async function auditLog(turso, companyId, session, action, entity, details) {
    await turso.execute({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, action, entity, JSON.stringify(details), new Date().toISOString()],
    });
}

async function productCreate(turso, companyId, session, product) {
    if (!product?.name) return { success: false, error: 'Falta el nombre del producto' };

    // Pre-check de SKU duplicado (mismo comportamiento que tenía el cliente)
    if (product.sku && !String(product.sku).startsWith('QUICK-')) {
        const dup = await turso.execute({
            sql: 'SELECT id, name FROM products WHERE sku = ? AND company_id = ? LIMIT 1',
            args: [product.sku, companyId],
        });
        if (dup.rows.length > 0) {
            const existing = dup.rows[0];
            return {
                success: false,
                error: 'SKU_DUPLICATE',
                message: `Ya existe un producto con SKU ${product.sku}: "${existing.name}" (id=${existing.id}). Ábrelo desde el listado para editarlo.`,
                existingProductId: existing.id,
            };
        }
    }

    const result = await turso.execute({
        // created_at lo pone el servidor, no el cliente: es el dato con el que se
        // distingue un producto recién dado de alta de uno detenido hace meses, y
        // no puede depender del reloj (ni de la buena fe) del navegador.
        sql: `INSERT INTO products (name, price, stock, category, sku, image, cost, tax_rate, unit, supplier,
                is_offer, offer_price, price_ranges, scale_group_id, company_id, sale_mode, allow_item_notes,
                preorder_unit, preorder_billing_unit, preorder_price_per_kg, preorder_gram_per_unit,
                preorder_use_base_price, units_per_box, created_at, category_id)
              VALUES (?, ?, ROUND(?, 3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                -- El nombre se sigue guardando (lo usan 19 consultas y 12 pantallas),
                -- pero la verdad pasa a ser el id: es lo que permite que "Granel"
                -- exista colgando de Mascotas y de Abarrotes a la vez.
                (SELECT id FROM categories WHERE company_id = ? AND name = ? LIMIT 1)) RETURNING *`,
        args: [
            product.name, product.price, product.stock, product.category, product.sku,
            product.image || null, product.cost || 0, product.tax_rate || 0, product.unit || 'Und',
            product.supplier || null, product.is_offer ? 1 : 0, product.offer_price || 0,
            JSON.stringify(product.price_ranges || []), product.scale_group_id || null, companyId,
            product.sale_mode || 'sale_only', product.allow_item_notes ? 1 : 0,
            product.preorder_unit || null, product.preorder_billing_unit || 'unit',
            product.preorder_price_per_kg || 0, product.preorder_gram_per_unit || 0,
            product.preorder_use_base_price !== undefined ? (product.preorder_use_base_price ? 1 : 0) : 1,
            product.units_per_box || 0,
            new Date().toISOString(),
            companyId, product.category,
        ],
    });

    await auditLog(turso, companyId, session, 'CREATE', 'PRODUCT', { name: product.name, sku: product.sku });
    return { success: true, product: result.rows[0] };
}

// Cambio de precio/costo de UN producto, y nada más.
//
// Existe aparte de productUpdate por una razón concreta: aquel reemplaza los 22
// campos del producto, asi que cualquiera que omita el que llama se borra. Para
// una accion propuesta por el Asistente eso es inaceptable — se corrige el
// precio y de paso se vacia la categoria, el proveedor y los rangos.
//
// Esta solo puede tocar precio y costo. No es una restriccion de permisos: es
// que la funcion, literalmente, no sabe escribir en ningun otro lado.
//
// La confirma una PERSONA desde la pantalla. El modelo propone, nunca ejecuta:
// preguntando por "zapallo italiano" el asistente encontro dos productos con
// precios distintos, y elegir mal habria cambiado el precio equivocado en todas
// las ventas siguientes.
async function productPriceUpdate(turso, companyId, session, { id, price, cost, valores }) {
    // `valores` viene de una propuesta del Asistente ya resuelta: categoría, IVA,
    // oferta y escala incluidas. Igual se sigue tocando SOLO este conjunto de
    // campos — nunca los 22 de productUpdate.
    if (valores && typeof valores === 'object') {
        const prev0 = await turso.execute({
            sql: 'SELECT id, name, price, cost, category, tax_rate, is_offer, offer_price FROM products WHERE id = ? AND company_id = ?',
            args: [id, companyId],
        });
        const antes0 = prev0.rows[0];
        if (!antes0) return { success: false, error: 'Producto no encontrado' };
        await turso.execute({
            sql: `UPDATE products SET price = ?, cost = ?, category = ?, tax_rate = ?,
                         is_offer = ?, offer_price = ?, price_ranges = ?, updated_at = ?
                   WHERE id = ? AND company_id = ?`,
            args: [
                Number(valores.price), Number(valores.cost), valores.category,
                Number(valores.tax_rate), valores.is_offer ? 1 : 0, Number(valores.offer_price) || 0,
                JSON.stringify(valores.price_ranges || []), new Date().toISOString(), id, companyId,
            ],
        });
        await auditLog(turso, companyId, session, 'UPDATE', 'PRODUCT_PRICE', {
            id, name: antes0.name, origen: 'asistente_ia', valores,
        });
        return { success: true, producto: antes0.name, aplicado: true };
    }

    if (!id) return { success: false, error: 'Falta el producto' };

    const prev = await turso.execute({
        sql: 'SELECT id, name, price, cost FROM products WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    const antes = prev.rows[0];
    if (!antes) return { success: false, error: 'Producto no encontrado' };

    const nuevoPrecio = price != null ? Number(price) : Number(antes.price);
    const nuevoCosto = cost != null ? Number(cost) : Number(antes.cost);
    if (!Number.isFinite(nuevoPrecio) || nuevoPrecio < 0) return { success: false, error: 'Precio inválido' };
    if (!Number.isFinite(nuevoCosto) || nuevoCosto < 0) return { success: false, error: 'Costo inválido' };

    await turso.execute({
        sql: 'UPDATE products SET price = ?, cost = ?, updated_at = ? WHERE id = ? AND company_id = ?',
        args: [nuevoPrecio, nuevoCosto, new Date().toISOString(), id, companyId],
    });

    // Queda registrado quién lo cambió y desde dónde: un precio que se movió sin
    // que nadie recuerde por qué es de las cosas más difíciles de reconstruir.
    await auditLog(turso, companyId, session, 'UPDATE', 'PRODUCT_PRICE', {
        id, name: antes.name,
        precio: { antes: Number(antes.price), ahora: nuevoPrecio },
        costo: { antes: Number(antes.cost), ahora: nuevoCosto },
        origen: 'asistente_ia',
    });

    return {
        success: true,
        producto: antes.name,
        precio: { antes: Number(antes.price), ahora: nuevoPrecio },
        costo: { antes: Number(antes.cost), ahora: nuevoCosto },
    };
}

async function productUpdate(turso, companyId, session, id, product) {
    if (!id || !product) return { success: false, error: 'Faltan datos' };

    // Stock anterior leído del servidor (fuente de verdad) para el registro de ajuste
    const prev = await turso.execute({
        sql: 'SELECT stock FROM products WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (prev.rows.length === 0) return { success: false, error: 'Producto no encontrado' };
    const oldStock = parseFloat(prev.rows[0].stock) || 0;
    const newStock = Math.round((parseFloat(product.stock) || 0) * 1000) / 1000;

    await turso.execute({
        // `image` es el único campo que se actualiza con COALESCE.
        //
        // Las pantallas ya no traen la foto junto con el producto —pesa 39 KB
        // promedio y hacía que la lista tardara medio minuto—, así que llega
        // después, aparte. Si alguien abre a editar y guarda antes de que la
        // foto llegue, el formulario mandaría `image` vacío y el UPDATE la
        // borraría sin que nadie lo pidiera.
        //
        // Con COALESCE: no mandar el campo (null) significa "dejala como está";
        // mandar cadena vacía —que es lo que hace el botón de quitar foto—
        // sigue borrándola. Se puede seguir sacando una foto a propósito, pero
        // no por accidente.
        sql: `UPDATE products SET name=?, price=?, stock=ROUND(?, 3), category=?, sku=?, image=COALESCE(?, image), cost=?, tax_rate=?,
                unit=?, supplier=?, is_offer=?, offer_price=?, price_ranges=?, scale_group_id=?, sale_mode=?,
                allow_item_notes=?, preorder_unit=?, preorder_billing_unit=?, preorder_price_per_kg=?,
                preorder_gram_per_unit=?, preorder_use_base_price=?, units_per_box=?,
                category_id=(SELECT id FROM categories WHERE company_id = ? AND name = ? LIMIT 1)
              WHERE id = ? AND company_id = ?`,
        args: [
            // undefined no es un valor válido para el driver: se traduce a null,
            // que acá significa "no la toques".
            product.name, product.price, product.stock, product.category, product.sku,
            product.image === undefined ? null : product.image,
            product.cost || 0, product.tax_rate || 0, product.unit || 'Und', product.supplier || null,
            product.is_offer ? 1 : 0, product.offer_price || 0, JSON.stringify(product.price_ranges || []),
            product.scale_group_id || null, product.sale_mode || 'sale_only', product.allow_item_notes ? 1 : 0,
            product.preorder_unit || null, product.preorder_billing_unit || 'unit',
            product.preorder_price_per_kg || 0, product.preorder_gram_per_unit || 0,
            product.preorder_use_base_price !== undefined ? (product.preorder_use_base_price ? 1 : 0) : 1,
            product.units_per_box || 0,
            companyId, product.category,
            id, companyId,
        ],
    });

    if (Math.abs(newStock - oldStock) >= 0.001) {
        await turso.execute({
            sql: `INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [companyId, id, session?.uid ?? null, session?.username || 'Desconocido', oldStock, newStock,
                Math.round((newStock - oldStock) * 1000) / 1000, 'manual', new Date().toISOString()],
        });
    }

    await auditLog(turso, companyId, session, 'UPDATE', 'PRODUCT', { id, name: product.name, sku: product.sku });
    return { success: true };
}

async function productDelete(turso, companyId, session, id) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM products WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'PRODUCT', { id });
    return { success: true };
}

// ── Jerarquía de categorías ─────────────────────────────────────────────
//
// Tres niveles: categoría → subcategoría → sub-subcategoría. Una categoría
// cuelga de una sola madre (parent_id NULL = primer nivel).
//
// El tope de tres no es capricho: la barra del POS despliega las hijas hacia
// abajo y las nietas hacia el costado. Un cuarto nivel no tendría dónde ir, y
// permitirlo en la base para que después la pantalla no lo sepa mostrar es
// prometer algo que no se cumple.
const NIVELES_MAXIMOS = 3;

/**
 * Devuelve la cadena de madres de una categoría, de la más cercana a la raíz.
 * Sirve para dos cosas: saber a qué profundidad quedaría una categoría, y
 * detectar que alguien no la esté colgando de su propia descendencia.
 */
async function cadenaDeMadres(turso, companyId, parentId) {
    const cadena = [];
    let actual = parentId;
    // El tope de vueltas es la red de seguridad por si algún día quedara un
    // ciclo en la base: sin él, esto giraría para siempre.
    for (let i = 0; actual && i < 20; i++) {
        const r = await turso.execute({
            sql: 'SELECT id, parent_id FROM categories WHERE id = ? AND company_id = ?',
            args: [actual, companyId],
        });
        const fila = r.rows[0];
        if (!fila) break;
        cadena.unshift(Number(fila.id));
        actual = fila.parent_id;
    }
    return cadena;
}

/**
 * Valida a quién se le puede colgar una categoría.
 * @param idPropio  al editar, para no dejar que se cuelgue de sí misma ni de una hija
 */
async function validarMadre(turso, companyId, parentId, idPropio = null) {
    if (parentId == null || parentId === '') return { ok: true, parentId: null };

    const madre = Number(parentId);
    if (!Number.isFinite(madre)) return { ok: false, error: 'Categoría madre inválida' };
    if (idPropio && madre === Number(idPropio)) {
        return { ok: false, error: 'Una categoría no puede colgar de sí misma' };
    }

    const existe = await turso.execute({
        sql: 'SELECT id FROM categories WHERE id = ? AND company_id = ?',
        args: [madre, companyId],
    });
    if (!existe.rows[0]) return { ok: false, error: 'Esa categoría madre no es de esta empresa' };

    const cadena = await cadenaDeMadres(turso, companyId, madre);
    if (idPropio && cadena.includes(Number(idPropio))) {
        return { ok: false, error: 'No se puede colgar una categoría de una de sus propias subcategorías' };
    }
    // cadena incluye a la madre; la nueva quedaría un nivel más abajo.
    if (cadena.length + 1 > NIVELES_MAXIMOS) {
        return { ok: false, error: `Solo se permiten ${NIVELES_MAXIMOS} niveles: categoría, subcategoría y sub-subcategoría` };
    }
    return { ok: true, parentId: madre };
}

async function categoryCreate(turso, companyId, session, category) {
    if (!category?.name) return { success: false, error: 'Falta el nombre de la categoría' };

    const madre = await validarMadre(turso, companyId, category.parentId ?? category.parent_id);
    if (!madre.ok) return { success: false, error: madre.error };

    const result = await turso.execute({
        sql: 'INSERT INTO categories (name, color, status, show_in_pos, show_in_preorders, company_id, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
        args: [
            // `?? null`: el driver no acepta undefined, y una subcategoría creada
            // sin elegir color es un caso normal —no todas las pantallas piden uno—.
            // Sin esto reventaba con "Unsupported type of value".
            category.name, category.color ?? null, category.status || 'active',
            category.showInPos !== false ? 1 : 0, category.showInPreorders !== false ? 1 : 0, companyId,
            madre.parentId,
        ],
    });
    await auditLog(turso, companyId, session, 'CREATE', 'CATEGORY', { name: category.name, parentId: madre.parentId });
    return { success: true, category: result.rows[0] };
}

async function categoryUpdate(turso, companyId, session, id, category) {
    if (!id || !category) return { success: false, error: 'Faltan datos' };

    const prev = await turso.execute({
        sql: 'SELECT name FROM categories WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (prev.rows.length === 0) return { success: false, error: 'Categoría no encontrada' };
    const oldName = prev.rows[0].name;
    const nameChanged = oldName !== category.name;

    const madre = await validarMadre(turso, companyId, category.parentId ?? category.parent_id, id);
    if (!madre.ok) return { success: false, error: madre.error };

    const queries = [
        {
            sql: 'UPDATE categories SET name = ?, color = ?, status = ?, show_in_pos = ?, show_in_preorders = ?, parent_id = ? WHERE id = ? AND company_id = ?',
            args: [
                category.name, category.color ?? null, category.status || 'active',
                category.showInPos !== false ? 1 : 0, category.showInPreorders !== false ? 1 : 0,
                madre.parentId, id, companyId,
            ],
        },
    ];
    if (nameChanged) {
        // Renombrar la categoría en los productos que la usan (mismo batch atómico)
        queries.push({
            sql: 'UPDATE products SET category = ? WHERE category = ? AND company_id = ?',
            args: [category.name, oldName, companyId],
        });
    }
    queries.push({
        sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [companyId, session?.uid ?? null, 'UPDATE', 'CATEGORY', JSON.stringify({ id, name: category.name }), new Date().toISOString()],
    });

    await turso.batch(queries);
    return { success: true, nameChanged, oldName };
}

// Se exportan para poder probar la jerarquía contra la base real sin pasar por
// HTTP (Vercel usa solo el default export, así que esto no cambia nada en runtime).
export const categoryActions = {
    crear: (...a) => categoryCreate(...a),
    actualizar: (...a) => categoryUpdate(...a),
    borrar: (...a) => categoryDelete(...a),
};

async function categoryDelete(turso, companyId, session, id) {
    if (!id) return { success: false, error: 'Falta id' };

    // Con hijas colgando no se borra: dejarlas huérfanas las haría desaparecer de
    // la pantalla sin que nadie se entere, con sus productos adentro. Que la
    // persona decida qué hacer con ellas primero.
    const hijas = await turso.execute({
        sql: 'SELECT COUNT(*) n FROM categories WHERE parent_id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (Number(hijas.rows[0].n) > 0) {
        return {
            success: false,
            error: `Esta categoría tiene ${hijas.rows[0].n} subcategoría(s) colgando. Movelas o borralas primero.`,
        };
    }

    await turso.execute({
        sql: 'DELETE FROM categories WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'CATEGORY', { id });
    return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Clientes y cuenta corriente (Fase 1 · Paso 8).
// RUT/email únicos se validan contra la BD (no contra el estado del
// navegador). El abono de deuda queda estampado con company_id y los
// UPDATE de ventas filtran por company_id (fix cross-tenant).
// ─────────────────────────────────────────────────────────────────

const cleanRutSrv = (rut) => (rut ? String(rut).replace(/[.\-\s]/g, '').toUpperCase() : '');
// Normalización de RUT en SQL, equivalente a cleanRutSrv
const SQL_RUT_NORM = "UPPER(REPLACE(REPLACE(REPLACE(COALESCE(rut,''),'.',''),'-',''),' ',''))";

async function checkClientDuplicates(turso, companyId, client, excludeId = null) {
    const rutClean = cleanRutSrv(client.rut);
    if (rutClean) {
        const dup = await turso.execute({
            sql: `SELECT id, name FROM clients WHERE company_id = ? AND ${SQL_RUT_NORM} = ?${excludeId ? ' AND id != ?' : ''} LIMIT 1`,
            args: excludeId ? [companyId, rutClean, excludeId] : [companyId, rutClean],
        });
        if (dup.rows.length) {
            const d = dup.rows[0];
            return { success: false, error: 'RUT_DUPLICATE', message: `Ya existe ${excludeId ? 'otro' : 'un'} cliente con ese RUT: ${d.name}`, existingClientId: d.id, existingClientName: d.name };
        }
    }
    const emailClean = (client.email || '').trim().toLowerCase();
    if (emailClean) {
        const dup = await turso.execute({
            sql: `SELECT id, name FROM clients WHERE company_id = ? AND LOWER(TRIM(COALESCE(email,''))) = ?${excludeId ? ' AND id != ?' : ''} LIMIT 1`,
            args: excludeId ? [companyId, emailClean, excludeId] : [companyId, emailClean],
        });
        if (dup.rows.length) {
            const d = dup.rows[0];
            return { success: false, error: 'EMAIL_DUPLICATE', message: `Ya existe ${excludeId ? 'otro' : 'un'} cliente con ese correo: ${d.name}`, existingClientId: d.id, existingClientName: d.name };
        }
    }
    return null;
}

async function clientCreate(turso, companyId, session, client) {
    if (!client?.name) return { success: false, error: 'Falta el nombre del cliente' };
    const dup = await checkClientDuplicates(turso, companyId, client);
    if (dup) return dup;

    const result = await turso.execute({
        sql: `INSERT INTO clients (name, rut, phone, email, address, razon_social, giro, comuna, ciudad, created_at,
                company_id, credit_limit, credit_period_days, credit_enabled, client_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [
            client.name, client.rut || '', client.phone || '', client.email || '', client.address || '',
            client.razon_social || '', client.giro || '', client.comuna || '', client.ciudad || '',
            new Date().toISOString(), companyId, client.credit_limit || 0, client.credit_period_days || 30,
            client.credit_enabled !== undefined ? (client.credit_enabled ? 1 : 0) : 1,
            client.client_status || 'active',
        ],
    });
    await auditLog(turso, companyId, session, 'CREATE', 'CLIENT', { name: client.name });
    return { success: true, client: result.rows[0] };
}

async function clientUpdate(turso, companyId, session, id, client) {
    if (!id || !client) return { success: false, error: 'Faltan datos' };
    const dup = await checkClientDuplicates(turso, companyId, client, id);
    if (dup) return dup;

    await turso.execute({
        sql: `UPDATE clients SET name = ?, rut = ?, phone = ?, email = ?, address = ?, razon_social = ?, giro = ?,
                comuna = ?, ciudad = ?, credit_limit = ?, credit_period_days = ?, credit_enabled = ?, client_status = ?
              WHERE id = ? AND company_id = ?`,
        args: [
            client.name, client.rut ?? '', client.phone ?? '', client.email ?? '', client.address ?? '',
            client.razon_social || '', client.giro || '', client.comuna || '', client.ciudad || '',
            client.credit_limit || 0, client.credit_period_days || 30,
            client.credit_enabled !== undefined ? (client.credit_enabled ? 1 : 0) : 1,
            client.client_status || 'active', id, companyId,
        ],
    });
    await auditLog(turso, companyId, session, 'UPDATE', 'CLIENT', { id, name: client.name });
    return { success: true };
}

async function clientDelete(turso, companyId, session, id) {
    if (!id) return { success: false, error: 'Falta id' };
    await turso.execute({
        sql: 'DELETE FROM clients WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    await auditLog(turso, companyId, session, 'DELETE', 'CLIENT', { id });
    return { success: true };
}

// Recalcula y persiste la deuda de un cliente (columnas total_debt / pending / overdue).
async function clientSyncDebt(turso, companyId, clientId) {
    if (!clientId) return { success: false, error: 'Falta clientId' };

    let debtFormula = 'total';
    let sinCentavos = '';
    try {
        const cols = await turso.execute('PRAGMA table_info(sales)');
        if (cols.rows.some(c => c.name === 'amount_paid')) {
            debtFormula = 'total - COALESCE(amount_paid, 0)';
            // Las boletas a las que solo les quedan centavos no son deuda: repartir
            // un abono en pesos enteros entre boletas con decimales (los productos
            // por peso los tienen) deja restos que nadie puede pagar, y sin esto
            // seguían sumando a la deuda y contando como venta pendiente.
            // Ver src/utils/deuda.js
            sinCentavos = 'AND (total - COALESCE(amount_paid, 0)) >= 1';
        }
    } catch { /* columna probablemente existe */ }

    const res = await turso.execute({
        sql: `SELECT COALESCE(SUM(${debtFormula}), 0) as total_debt,
                     COUNT(*) as pending_count,
                     COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN 1 END) as overdue_count
              FROM sales
              WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito'
                AND status NOT IN ('paid', 'cancelled') ${sinCentavos}`,
        args: [clientId, companyId],
    });
    const r = res.rows[0] || {};
    const totalDebt = parseFloat(r.total_debt) || 0;
    const pendingCount = parseInt(r.pending_count, 10) || 0;
    const overdueCount = parseInt(r.overdue_count, 10) || 0;

    await turso.execute({
        sql: 'UPDATE clients SET total_debt = ?, pending_sales_count = ?, overdue_count = ? WHERE id = ? AND company_id = ?',
        args: [totalDebt, pendingCount, overdueCount, clientId, companyId],
    });

    return { success: true, totalDebt, pendingCount, overdueCount };
}

// Estado de crédito de UN cliente (deuda, vencidos, por vencer) — solo agregación;
// el cliente combina con credit_limit/status desde su estado local.
async function clientCreditStatus(turso, companyId, { clientId }) {
    if (!clientId) return { success: false, error: 'Falta clientId' };
    let debtFormula = 'total';
    let sinCentavos = '';
    try {
        const cols = await turso.execute('PRAGMA table_info(sales)');
        if (cols.rows.some(c => c.name === 'amount_paid')) {
            debtFormula = 'total - COALESCE(amount_paid, 0)';
            // Las boletas a las que solo les quedan centavos no son deuda: repartir
            // un abono en pesos enteros entre boletas con decimales (los productos
            // por peso los tienen) deja restos que nadie puede pagar, y sin esto
            // seguían sumando a la deuda y contando como venta pendiente.
            // Ver src/utils/deuda.js
            sinCentavos = 'AND (total - COALESCE(amount_paid, 0)) >= 1';
        }
    } catch { /* columna probablemente existe */ }

    const result = await turso.execute({
        sql: `SELECT
                COALESCE(SUM(${debtFormula}), 0) as total_debt,
                COUNT(*) as pending_count,
                MIN(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') AND status NOT IN ('paid','cancelled') THEN payment_due_date END) as oldest_overdue_date,
                COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') AND status NOT IN ('paid','cancelled') THEN 1 END) as overdue_count,
                COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date >= datetime('now') AND payment_due_date <= datetime('now', '+3 days') AND status NOT IN ('paid','cancelled') THEN 1 END) as due_soon_count
              FROM sales
              WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito'
              AND status NOT IN ('paid', 'cancelled') ${sinCentavos}`,
        args: [clientId, companyId],
    });
    return { success: true, row: result.rows[0] || null };
}

// Resumen de deuda de TODOS los clientes (indicadores del listado).
async function clientsDebtSummary(turso, companyId) {
    const result = await turso.execute({
        sql: `SELECT
                client_id,
                COALESCE(SUM(total), 0) as total_debt,
                COUNT(*) as pending_count,
                MIN(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN payment_due_date END) as oldest_overdue_date,
                COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN 1 END) as overdue_count,
                COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date >= datetime('now') AND payment_due_date <= datetime('now', '+3 days') THEN 1 END) as due_soon_count
              FROM sales
              WHERE company_id = ? AND payment_method = 'Crédito'
              AND status NOT IN ('paid', 'cancelled')
              AND client_id IS NOT NULL
              GROUP BY client_id`,
        args: [companyId],
    });
    return { success: true, rows: result.rows };
}

// Abono / pago de deuda: crea la venta-abono y marca las boletas pagadas.
// FIX vs versión navegador: el abono se estampa con company_id y los UPDATE
// de ventas filtran por company_id (antes se podía marcar pagada una boleta ajena).
async function clientRegisterPayment(turso, companyId, session, body) {
    const { client, amount, distribution, paymentMethod, date } = body;
    if (!client?.id || !Array.isArray(distribution) || distribution.length === 0) {
        return { success: false, error: 'Faltan datos del pago' };
    }

    // Asegurar columna amount_paid (migración perezosa heredada)
    try {
        const cols = await turso.execute('PRAGMA table_info(sales)');
        if (!cols.rows.some(c => c.name === 'amount_paid')) {
            await turso.execute('ALTER TABLE sales ADD COLUMN amount_paid REAL DEFAULT 0');
        }
    } catch { /* columna probablemente existe */ }

    const partialCount = distribution.filter(d => !d.fullyPaid).length;
    let summaryDetail = `${distribution.length} boleta${distribution.length > 1 ? 's' : ''}`;
    if (partialCount > 0) summaryDetail += ` (${partialCount} parcial)`;

    const items = JSON.stringify([{
        id: 'payment-adj',
        name: `Abono / Pago de Deuda (${summaryDetail})`,
        price: amount, quantity: 1, unit: 'Und',
    }]);
    const paymentDetails = JSON.stringify({ amount, change: 0, type: 'debt_payment', distribution });

    // El abono también entra al cajón, así que debe quedar amarrado a la caja abierta
    // del cajero (migración 0012). Sin esto la lectura de caja, que ahora filtra por
    // register_id, no lo vería y el arqueo saldría corto.
    const openReg = await turso.execute({
        sql: "SELECT id FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
        args: [session?.uid ?? null, companyId],
    });
    const paymentRegisterId = openReg.rows[0]?.id ?? null;

    const queries = [{
        sql: `INSERT INTO sales (date, total, summary, items, payment_method, payment_details, user_id, status,
                has_negative_stock, client_id, client_name, company_id, register_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 0, ?, ?, ?, ?)`,
        args: [date || new Date().toISOString(), amount, `Abono de Cliente: ${client.name}`, items,
            paymentMethod, paymentDetails, session?.uid ?? null, client.id, client.name, companyId,
            paymentRegisterId],
    }];

    for (const d of distribution) {
        if (d.fullyPaid) {
            queries.push({
                sql: "UPDATE sales SET status = 'paid', amount_paid = total WHERE id = ? AND company_id = ?",
                args: [Number(d.saleId), companyId],
            });
        } else {
            // `total - ? < 0.5` y no `? >= total`: repartir un abono en pesos enteros
            // entre boletas con decimales (los productos por peso los tienen) deja
            // restos de centavos. Con la comparación exacta, esa boleta se quedaba
            // "pendiente" para siempre por 20 centavos que nadie puede pagar.
            queries.push({
                sql: "UPDATE sales SET amount_paid = ?, status = CASE WHEN total - ? < 1 THEN 'paid' ELSE status END WHERE id = ? AND company_id = ?",
                args: [d.newTotalPaid, d.newTotalPaid, Number(d.saleId), companyId],
            });
        }
    }

    await turso.batch(queries);
    await auditLog(turso, companyId, session, 'CREATE', 'CLIENT_PAYMENT', { clientId: client.id, amount, boletas: distribution.length });

    // Recalcular deuda del cliente y devolverla para actualizar la UI
    const debt = await clientSyncDebt(turso, companyId, client.id);
    return { success: true, debt };
}
