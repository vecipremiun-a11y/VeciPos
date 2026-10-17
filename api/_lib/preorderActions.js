// Encargos (preorders) server-side (Fase 1 · Paso 15).
// Lógica portada tal cual. FIX cross-tenant: las operaciones por preorderId
// ahora verifican que el encargo pertenezca a la empresa de la sesión
// (antes UPDATE/SELECT iban solo por id).

import { broadcastPreorderEvent } from '../events/preorders-stream.js';
import { saleAggregations } from './salesActions.js';
import { deliveryActions, envioActivoDePedido, marcarRetiradoDesdeTienda, cerrarEnvioDesdeTienda } from './deliveryActions.js';
import {
    pedidoTienda, liberarStockPedido, volverASepararPedido, rehacerReservaPedido,
    cerrarPedidoTienda, ventaDelPedido, esTransferenciaPorConfirmar, confirmarPagoPedido,
    pagadoSinDocumento, anotarDocumento,
} from './tiendaPedidos.js';

const nowIso = () => new Date().toISOString();

// Día y hora en la zona horaria de la empresa, que es como se agrupan los
// reportes (product_daily_profit.day, hourly_sales_stats.hour). El cliente hace
// lo mismo con formatInCompanyTime; acá se resuelve sin depender del navegador.
function companyDayAndHour(iso, tz) {
    const d = new Date(iso);
    const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    const hour = parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', hourCycle: 'h23',
    }).format(d), 10) || 0;
    return { day, hour };
}

// order_kind separa encargos ('encargo') de pedidos de la tienda web ('store').
// La columna se agrega perezosamente (una vez por proceso) para que reportes y
// listados funcionen también en bases que aún no reciben pedidos web.
let _orderKindEnsured = false;
async function ensureOrderKindColumn(turso) {
    if (_orderKindEnsured) return;
    try {
        await turso.execute("ALTER TABLE preorders ADD COLUMN order_kind TEXT DEFAULT 'encargo'");
    } catch { /* la columna ya existe */ }
    _orderKindEnsured = true;
}

// Filtro para que los reportes/listados de ENCARGOS excluyan pedidos de tienda.
const ONLY_ENCARGO = (alias = '') => ` AND COALESCE(${alias}order_kind, 'encargo') = 'encargo'`;

// ===== Historial de estados =====
//
// Cada cambio de estado deja una fila con quién, cuándo, por qué y desde dónde.
// Antes no quedaba nada: el 8-sep-2026 hubo que reconstruir la cancelación del
// encargo #690 desde los logs de integración, y aun así el usuario quedó sin
// identificar. Ver migrations/0028.
//
// Es best-effort a propósito: si el INSERT falla, el cambio de estado sigue su
// curso. Perder una línea del historial es malo; frenar un encargo en el
// mostrador porque no se pudo escribir esa línea es peor.
const FUENTES = new Set(['encargos', 'produccion', 'kds', 'tienda', 'sistema']);

// El nombre se guarda como foto del momento (ver 0028). La sesión trae `uid` y
// `username`, no el nombre visible, así que se busca en `users`.
async function nombreDeUsuario(turso, session) {
    if (!session?.uid) return null;
    try {
        const r = await turso.execute({
            sql: 'SELECT name, username FROM users WHERE id = ? LIMIT 1',
            args: [session.uid],
        });
        return r.rows[0]?.name || r.rows[0]?.username || session.username || null;
    } catch {
        return session.username || null;
    }
}

async function registrarCambioDeEstado(turso, { companyId, preorderId, from, to, reason, userId, userName, source }) {
    try {
        await turso.execute({
            sql: `INSERT INTO preorder_status_history
                    (company_id, preorder_id, from_status, to_status, reason, user_id, user_name, source, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                companyId,
                preorderId,
                from || null,
                to,
                (reason && String(reason).trim()) ? String(reason).trim().slice(0, 300) : null,
                userId ?? null,
                userName || null,
                FUENTES.has(source) ? source : 'encargos',
                nowIso(),
            ],
        });
    } catch (e) {
        // La tabla puede no existir todavía en una base sin migrar. No se
        // interrumpe el flujo por eso.
        console.error('preorder_status_history:', e?.message || e);
    }
}

// Guard: el encargo debe ser de la empresa. Devuelve la fila o null.
async function ownPreorder(turso, companyId, preorderId, cols = '*') {
    const r = await turso.execute({
        sql: `SELECT ${cols} FROM preorders WHERE id = ? AND company_id = ?`,
        args: [preorderId, companyId],
    });
    return r.rows[0] || null;
}

async function preorderCreate(turso, companyId, session, { preorderData, registerId }) {
    if (!preorderData?.items?.length) return { success: false, error: 'Encargo sin items' };
    const estimatedTotal = preorderData.total_amount;

    const result = await turso.execute({
        sql: `INSERT INTO preorders
              (company_id, client_id, client_name, client_phone, due_date, due_time,
               status, total_amount, estimated_total, deposit_amount, remaining_amount,
               delivery_type, delivery_address, notes, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            companyId, preorderData.client_id || null, preorderData.client_name || '',
            preorderData.client_phone || '', preorderData.due_date, preorderData.due_time,
            estimatedTotal, estimatedTotal, preorderData.deposit_amount || 0,
            estimatedTotal - (preorderData.deposit_amount || 0),
            preorderData.delivery_type || 'pickup', preorderData.delivery_address || '',
            preorderData.notes || '', session?.username || '', nowIso(),
        ],
    });
    const preorderId = Number(result.lastInsertRowid);

    // Items (batch atómico, mismos campos de panadería)
    const itemQueries = preorderData.items.map(item => ({
        sql: `INSERT INTO preorder_items
              (preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
               billing_unit, price_per_kg, gram_per_unit, estimated_total)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [preorderId, item.product_id, item.product_name, item.qty, item.unit || 'Und',
            item.unit_price, item.line_total, item.note || '', item.billing_unit || 'unit',
            item.price_per_kg || 0, item.gram_per_unit || 0, item.line_total],
    }));
    if (itemQueries.length) await turso.batch(itemQueries);

    // Abono inicial (el movimiento de caja en efectivo lo registra el cliente vía cashMovementAdd)
    if (preorderData.deposit_amount > 0) {
        const depositMethod = preorderData.deposit_method || 'Efectivo';
        const tId = depositMethod === 'Tarjeta' ? (preorderData.deposit_terminal_id || null) : null;
        const baId = depositMethod === 'Transferencia' ? (preorderData.deposit_bank_account_id || null) : null;
        const authCode = depositMethod === 'Tarjeta' ? (preorderData.deposit_auth_code || null) : null;
        await turso.execute({
            sql: `INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id, auth_code)
                  VALUES (?, ?, ?, 'deposit', ?, ?, ?, ?)`,
            args: [preorderId, preorderData.deposit_amount, depositMethod, registerId || null, tId, baId, authCode],
        });
    }

    // Primera línea del historial: sin ella la línea de tiempo del encargo
    // empezaría por el segundo movimiento y no se vería quién lo tomó.
    await registrarCambioDeEstado(turso, {
        companyId,
        preorderId,
        from: null,
        to: 'pending',
        reason: null,
        userId: session?.uid ?? null,
        userName: await nombreDeUsuario(turso, session),
        source: 'encargos',
    });

    // Señal en vivo (Pusher) para que los badges se actualicen en todos los
    // dispositivos sin recargar. Usamos 'order.updated' (refresca contadores,
    // sin el toast de "nuevo pedido web" que es exclusivo del canal web).
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: preorderId, kind: 'encargo' });

    return { success: true, preorderId };
}

async function preordersFetch(turso, companyId, session, { filters = {} }) {
    // kind: 'encargo' (default — Encargos/history no ven pedidos de tienda),
    // 'store' (pestaña Tienda) o 'all'. COALESCE cubre filas previas a la columna.
    await ensureOrderKindColumn(turso);
    const kind = filters.kind || 'encargo';
    let sql = `SELECT p.*,
                (SELECT GROUP_CONCAT(pi.product_name || ' x' || pi.qty, ', ')
                 FROM preorder_items pi WHERE pi.preorder_id = p.id) as items_summary
               FROM preorders p
               WHERE p.company_id = ?`;
    const args = [companyId];
    if (kind !== 'all') { sql += " AND COALESCE(p.order_kind, 'encargo') = ?"; args.push(kind); }
    if (filters.date) { sql += ' AND p.due_date = ?'; args.push(filters.date); }
    if (filters.status && filters.status !== 'all') { sql += ' AND p.status = ?'; args.push(filters.status); }
    if (filters.startDate && filters.endDate) { sql += ' AND p.due_date BETWEEN ? AND ?'; args.push(filters.startDate, filters.endDate); }
    // Tienda: lo más reciente primero (fecha del pedido); encargos: por entrega.
    sql += kind === 'store' ? ' ORDER BY p.created_at DESC' : ' ORDER BY p.due_date ASC, p.due_time ASC';
    const result = await turso.execute({ sql, args });
    return { success: true, preorders: result.rows };
}

async function pendingWebOrders(turso, companyId) {
    await ensureOrderKindColumn(turso);
    const result = await turso.execute({
        sql: `SELECT p.id, p.external_public_code as public_code, p.client_name,
                     p.due_date, p.due_time, p.total_amount,
                     COALESCE(p.order_kind, 'encargo') as order_kind,
                     (SELECT GROUP_CONCAT(pi.product_name || ' x' || pi.qty, ', ')
                      FROM preorder_items pi WHERE pi.preorder_id = p.id) as items_summary
              FROM preorders p
              WHERE p.company_id = ? AND p.external_source = 'miniveci'
                AND (p.status = 'pending' OR (p.order_kind = 'store' AND p.status = 'preparing'))
              ORDER BY p.created_at DESC`,
        args: [companyId],
    });
    return { success: true, rows: result.rows };
}

// Conteo de pedidos ACTIVOS (no entregados/cancelados) para los badges:
//   - Encargos: solo los de HOY (due_date = today) que faltan por finalizar,
//     igual que la vista por defecto de la pestaña Encargos.
//   - Tienda: todos los activos (esa pestaña no filtra por fecha).
//   - Delivery: los envíos que siguen en la calle o esperando salir (pendiente,
//     asignado, aceptado, retirado, en ruta). Entregado y fallido ya no cuentan,
//     igual que en el tablero de Envíos.
async function preorderActiveCounts(turso, companyId, session, { today = null } = {}) {
    await ensureOrderKindColumn(turso);

    const encSql = `SELECT COUNT(*) AS n FROM preorders
                    WHERE company_id = ? AND COALESCE(order_kind, 'encargo') = 'encargo'
                      AND status NOT IN ('delivered', 'canceled')`;
    const enc = await turso.execute(
        today
            ? { sql: encSql + ' AND due_date = ?', args: [companyId, today] }
            : { sql: encSql, args: [companyId] }
    );

    const sto = await turso.execute({
        sql: `SELECT COUNT(*) AS n FROM preorders
              WHERE company_id = ? AND order_kind = 'store'
                AND status NOT IN ('delivered', 'canceled')`,
        args: [companyId],
    });

    // La tabla de envíos es de la App Delivery: si la empresa no la tiene, la
    // consulta no debe tumbar los otros dos contadores.
    let delivery = 0;
    try {
        const del = await turso.execute({
            sql: `SELECT COUNT(*) AS n FROM deliveries
                  WHERE company_id = ? AND status NOT IN ('delivered', 'failed', 'canceled', 'cancelled')`,
            args: [companyId],
        });
        delivery = Number(del.rows[0]?.n) || 0;
    } catch (error) {
        console.warn('preorderActiveCounts: no se pudo contar envíos:', error.message);
    }

    return {
        success: true,
        counts: {
            encargo: Number(enc.rows[0]?.n) || 0,
            store: Number(sto.rows[0]?.n) || 0,
            delivery,
        },
    };
}

async function preorderDetails(turso, companyId, session, { preorderId }) {
    const preorder = await ownPreorder(turso, companyId, preorderId);
    if (!preorder) return { success: true, preorder: null, items: [], payments: [], history: [] };
    const [itemsRes, paymentsRes] = await turso.batch([
        { sql: 'SELECT * FROM preorder_items WHERE preorder_id = ?', args: [preorderId] },
        { sql: 'SELECT * FROM preorder_payments WHERE preorder_id = ? ORDER BY created_at ASC', args: [preorderId] },
    ], 'read');

    // Aparte del batch: en una base sin la migración 0028 esta tabla no existe,
    // y ahí el batch entero se caería llevándose los items y los abonos con él.
    let history = [];
    try {
        const h = await turso.execute({
            sql: `SELECT id, from_status, to_status, reason, user_id, user_name, source, created_at
                  FROM preorder_status_history
                  WHERE preorder_id = ? AND company_id = ?
                  ORDER BY created_at ASC, id ASC`,
            args: [preorderId, companyId],
        });
        history = h.rows;
    } catch { /* base sin migrar: el encargo se muestra igual, sin la línea de tiempo */ }

    return { success: true, preorder, items: itemsRes.rows, payments: paymentsRes.rows, history };
}

// Edita los productos de un pedido (pestaña Tienda): reemplaza los items y
// recalcula el total. deposit_amount NO se toca (es lo ya pagado); el saldo
// (remaining_amount = total - deposit) puede quedar negativo = a devolver al
// entregar. Si el pedido tenía stock separado (migración 0034), lo separado pasa
// a ser lo de los productos nuevos.
async function preorderItemsEdit(turso, companyId, session, { preorderId, items }) {
    const pr = await ownPreorder(turso, companyId, preorderId, 'status, deposit_amount, delivery_fee, order_kind');
    if (!pr) return { success: false, error: 'Pedido no encontrado' };
    if (['delivered', 'canceled'].includes(pr.status)) {
        return { success: false, error: 'No se puede editar un pedido entregado o cancelado' };
    }
    if (!Array.isArray(items) || items.length === 0) {
        return { success: false, error: 'El pedido debe tener al menos un producto' };
    }

    const norm = items.map(it => {
        const qty = Number(it.qty) || 0;
        const unitPrice = Number(it.unit_price) || 0;
        const lineTotal = it.line_total !== undefined ? Number(it.line_total) : qty * unitPrice;
        return {
            product_id: it.product_id || 0,
            product_name: it.product_name || 'Producto',
            qty,
            unit: it.unit || 'Und',
            unit_price: unitPrice,
            line_total: lineTotal,
            note: it.note || '',
            billing_unit: it.billing_unit || 'unit',
            // El precio por kilo y los gramos por unidad se perdían al editar: el
            // INSERT no los incluía, así que un producto por kilo quedaba con
            // price_per_kg = 0 y al entregarlo el peso real multiplicaba por cero.
            // Se cobraba $0 sin que nada avisara.
            price_per_kg: Number(it.price_per_kg) || 0,
            gram_per_unit: Number(it.gram_per_unit) || 0,
            external_product_id: it.external_product_id || null,
        };
    });

    const itemsTotal = norm.reduce((acc, it) => acc + it.line_total, 0);
    const deliveryFee = Number(pr.delivery_fee) || 0;
    const total = itemsTotal + deliveryFee;
    const deposit = Number(pr.deposit_amount) || 0;
    const remaining = total - deposit;

    // Reemplazo atómico de items + recálculo de totales.
    const queries = [
        { sql: 'DELETE FROM preorder_items WHERE preorder_id = ?', args: [preorderId] },
        ...norm.map(it => ({
            sql: `INSERT INTO preorder_items
                  (preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
                   billing_unit, price_per_kg, gram_per_unit, estimated_total, external_product_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [preorderId, it.product_id, it.product_name, it.qty, it.unit, it.unit_price,
                it.line_total, it.note, it.billing_unit, it.price_per_kg, it.gram_per_unit,
                it.line_total, it.external_product_id],
        })),
        {
            sql: `UPDATE preorders SET total_amount = ?, estimated_total = ?, remaining_amount = ?, updated_at = datetime('now')
                  WHERE id = ? AND company_id = ?`,
            args: [total, total, remaining, preorderId, companyId],
        },
    ];
    await turso.batch(queries);

    return { success: true, total, remaining, deposit, liberados, reservados };
}

// `crearEnvio`: la pestaña Tienda lo manda al marcar "Listo para retiro" un pedido
// a domicilio, si la empresa tiene Delivery: el pedido aparece ahí para repartir.
async function preorderStatusUpdate(turso, companyId, session, { preorderId, newStatus, reason = null, source = 'encargos', crearEnvio = false }) {
    const info = await ownPreorder(turso, companyId, preorderId);
    if (!info) return { success: false, error: 'Encargo no encontrado' };
    const prevStatus = info.status;
    const esTienda = info.order_kind === 'store';

    const motivo = (reason && String(reason).trim()) ? String(reason).trim().slice(0, 300) : '';

    // Un pedido de la tienda que se paga al recibir se entrega COBRANDO: ahí nace
    // la venta con su boleta o nota de venta (storeOrderRelease/Complete).
    if (esTienda && newStatus === 'delivered' && prevStatus !== 'delivered' && Number(info.remaining_amount) > 0) {
        return { success: false, error: 'Este pedido se paga al recibir: se entrega con "Cobrar".' };
    }
    // Transferencia sin revisar: avanza solo confirmando el pago (ahí nace la venta).
    if (esTransferenciaPorConfirmar(info) && !['canceled', prevStatus].includes(newStatus)) {
        return { success: false, error: 'Primero revisá el comprobante y confirmá la transferencia con "Confirmar pago".' };
    }
    // Pagado en la web (Mercado Pago) sin boleta: primero se hace el documento,
    // que es donde queda registrada la venta. Después sigue como siempre.
    if (pagadoSinDocumento(info) && ['ready', 'out_for_delivery', 'delivered'].includes(newStatus)) {
        return { success: false, error: 'Primero hacé la boleta (o la factura) del pedido.' };
    }
    // Pedido que ya tiene su venta (transferencia confirmada, o cobrado): para
    // cancelarlo primero se anula la venta, que es la que devuelve el stock.
    if (esTienda && newStatus === 'canceled' && prevStatus !== 'canceled' && info.sale_id) {
        const v = await turso.execute({
            sql: 'SELECT status FROM sales WHERE id = ? AND company_id = ? LIMIT 1',
            args: [info.sale_id, companyId],
        });
        if (v.rows[0] && v.rows[0].status !== 'cancelled') {
            return { success: false, error: `Este pedido ya tiene la venta #${info.sale_id}. Para cancelarlo, primero anulá esa venta en Historial de ventas (ahí vuelve el stock).` };
        }
    }

    // Cancelar SIEMPRE pide motivo, y se valida acá y no solo en la pantalla:
    // una cancelación es lo único que borra un pedido de la vista de producción,
    // y sin motivo no hay forma de saber después si fue un error de carga, una
    // falta de stock o un cliente que se arrepintió.
    if (newStatus === 'canceled' && prevStatus !== 'canceled' && !motivo) {
        return { success: false, error: 'Hay que escribir el motivo de la cancelación.' };
    }

    if (motivo) {
        // "Cancelado" cuando se cancela; "Rechazo" queda para el resto (es el
        // texto que ya tienen las notas de pedidos web rechazados).
        const etiqueta = newStatus === 'canceled' ? 'Cancelado' : 'Rechazo';
        await turso.execute({
            sql: `UPDATE preorders SET status = ?, notes = TRIM(COALESCE(notes,'') || ' · ' || ? || ': ' || ?), updated_at = datetime('now') WHERE id = ? AND company_id = ?`,
            args: [newStatus, etiqueta, motivo, preorderId, companyId],
        });
    } else {
        await turso.execute({
            sql: "UPDATE preorders SET status = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?",
            args: [newStatus, preorderId, companyId],
        });
    }

    // Quién lo movió, cuándo y por qué. Va después del UPDATE para no dejar
    // historial de un cambio que no ocurrió.
    await registrarCambioDeEstado(turso, {
        companyId,
        preorderId,
        from: prevStatus,
        to: newStatus,
        reason: motivo,
        userId: session?.uid ?? null,
        userName: await nombreDeUsuario(turso, session),
        source,
    });

    // Pedido de la tienda web: el stock separado y el envío siguen al pedido.
    let stockDevuelto = [];
    let envioId = null;
    let envioError = null;
    if (esTienda && newStatus !== prevStatus) {
        try {
            const envio = await envioActivoDePedido(turso, companyId, preorderId);
            if (newStatus === 'canceled') {
                stockDevuelto = (await liberarStockPedido(turso, companyId, preorderId)).liberados;
                if (envio) await deliveryActions.deliveryStatus(turso, companyId, session, { id: envio.id, status: 'canceled', reason: motivo || 'Pedido cancelado' });
            } else if (newStatus === 'ready' && crearEnvio && info.delivery_type === 'delivery' && !envio) {
                const r = await deliveryActions.deliveryCreate(turso, companyId, session, {
                    sourceType: 'preorder', sourceId: Number(preorderId),
                    clientName: info.client_name, clientPhone: info.client_phone,
                    address: info.delivery_address || '',
                    amountToCollect: Math.max(0, Number(info.remaining_amount) || 0),
                    deliveryFee: Number(info.delivery_fee) || 0,
                    notes: info.external_public_code ? `Pedido web ${info.external_public_code}` : null,
                });
                if (r?.success) envioId = r.id; else envioError = r?.error || 'No se pudo crear el envío';
            } else if (newStatus === 'out_for_delivery' && envio) {
                await marcarRetiradoDesdeTienda(turso, companyId, session, envio);
            } else if (newStatus === 'delivered' && envio) {
                await cerrarEnvioDesdeTienda(turso, companyId, session, envio);
            }
        } catch (e) {
            console.error('[tienda] estado', preorderId, newStatus, e?.message || e);
        }
    }

    // Si se cancela (y no estaba cancelado), calcular efectivo a devolver.
    // El movimiento de caja OUT lo registra el cliente (caja abierta del cajero).
    let cashPaid = 0;
    if (newStatus === 'canceled' && prevStatus !== 'canceled') {
        const cashRes = await turso.execute({
            sql: "SELECT COALESCE(SUM(amount), 0) as cash_paid FROM preorder_payments WHERE preorder_id = ? AND method = 'Efectivo'",
            args: [preorderId],
        });
        cashPaid = Number(cashRes.rows[0]?.cash_paid) || 0;
    }

    // Señal en vivo (Pusher): un cambio de estado altera el conteo activo → los
    // badges de otros dispositivos/pestañas se actualizan sin recargar ni pollear.
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: preorderId, status: newStatus });

    return {
        success: true,
        prevStatus,
        cashPaid,
        clientName: info.client_name || '',
        externalPublicCode: info.external_public_code || null,
        stockDevuelto,
        envioId,
        envioError,
    };
}

// ── Cobrar un pedido de la tienda web que se paga al recibir ────────────────
//
// Mismo camino que el pedido a domicilio del POS (deliveryOrderRelease/Complete):
//   1. storeOrderRelease  devuelve lo separado y entrega lo que hay que vender.
//   2. el navegador registra la venta con addSale (boleta o nota de venta).
//   3. storeOrderComplete anota la venta y cierra el pedido (y su envío).
// Si la venta no entra, storeOrderReserve vuelve a separar el stock.
// Lo usan la pestaña Tienda (retiro en el local) y el repartidor (a domicilio).

// `confirmarPago`: transferencia que el local revisó. La venta nace al confirmar
// (no al entregar) y el pedido pasa a "Preparando", ya pagado.
// `documento`: pedido pagado en la web (Mercado Pago). La venta nace cuando el
// local hace la boleta o la factura; el estado del pedido no cambia.
async function storeOrderRelease(turso, companyId, session, { preorderId, deliveryId = null, confirmarPago = false, documento = false } = {}) {
    const p = await pedidoTienda(turso, companyId, preorderId);
    if (!p) return { success: false, error: 'Pedido no encontrado' };
    if (p.status === 'delivered') return { success: false, error: 'Ese pedido ya se entregó', saleId: p.sale_id || null };
    if (p.status === 'canceled') return { success: false, error: 'Ese pedido está cancelado' };
    if (documento) {
        if (!pagadoSinDocumento(p)) return { success: false, error: p.sale_id ? `Ese pedido ya tiene su venta #${p.sale_id}.` : 'Ese pedido no está pagado en la web.' };
        const { liberados } = await liberarStockPedido(turso, companyId, preorderId);
        const venta = await ventaDelPedido(turso, companyId, p);
        let factura = null;
        try { factura = p.invoice_data ? JSON.parse(p.invoice_data) : null; } catch { factura = null; }
        return {
            success: true,
            pedido: { ...venta, code: p.external_public_code || null, aCobrar: Number(p.total_amount) || 0, factura },
            liberados,
        };
    }
    if (!(Number(p.remaining_amount) > 0)) return { success: false, error: 'Ese pedido ya está pagado: se entrega sin cobrar.' };
    if (confirmarPago) {
        if (!esTransferenciaPorConfirmar(p)) return { success: false, error: 'Ese pedido no tiene una transferencia por confirmar.' };
    } else if (esTransferenciaPorConfirmar(p)) {
        return { success: false, error: 'Primero confirmá la transferencia con "Confirmar pago".' };
    } else if (deliveryId) {
        const r = await turso.execute({
            sql: 'SELECT id, status, source_type, source_id FROM deliveries WHERE id = ? AND company_id = ? LIMIT 1',
            args: [deliveryId, companyId],
        });
        const d = r.rows[0];
        if (!d || d.source_type !== 'preorder' || Number(d.source_id) !== Number(preorderId)) {
            return { success: false, error: 'Ese envío no es de este pedido' };
        }
        // Se valida ANTES de la venta: si después no se pudiera cerrar el envío,
        // quedaría una venta de un pedido sin entregar.
        if (d.status !== 'on_route') return { success: false, error: 'Para entregarlo, el envío tiene que estar "En ruta".' };
    } else if (!['ready', 'out_for_delivery'].includes(p.status)) {
        return { success: false, error: 'Primero marcá el pedido como "Listo para retiro".' };
    }
    const { liberados } = await liberarStockPedido(turso, companyId, preorderId);
    const venta = await ventaDelPedido(turso, companyId, p);
    return {
        success: true,
        pedido: { ...venta, code: p.external_public_code || null, aCobrar: Number(p.remaining_amount) || 0 },
        liberados,
    };
}

async function storeOrderReserve(turso, companyId, session, { preorderId } = {}) {
    const p = await pedidoTienda(turso, companyId, preorderId);
    if (!p) return { success: false, error: 'Pedido no encontrado' };
    const { reservados } = await volverASepararPedido(turso, companyId, preorderId);
    return { success: true, reservados };
}

async function storeOrderComplete(turso, companyId, session, {
    preorderId, saleId, deliveryId = null, confirmarPago = false, documento = false,
    collectedAmount, collectedMethod, receivedBy, receivedByKind, proofPhoto,
} = {}) {
    const p = await pedidoTienda(turso, companyId, preorderId);
    if (!p) return { success: false, error: 'Pedido no encontrado' };
    if (!saleId) return { success: false, error: 'Falta la venta del pedido' };
    const v = await turso.execute({
        sql: 'SELECT id, register_id FROM sales WHERE id = ? AND company_id = ? LIMIT 1',
        args: [saleId, companyId],
    });
    const venta = v.rows[0];
    if (!venta) return { success: false, error: 'La venta del pedido no existe' };
    if (p.status === 'delivered') return { success: true, yaEstaba: true, saleId: p.sale_id || saleId };

    if (documento) {
        // Pagado en la web: queda la venta (boleta o factura); el estado no cambia.
        if (p.sale_id) return { success: true, yaEstaba: true, saleId: p.sale_id };
        await anotarDocumento(turso, companyId, preorderId, { saleId, session });
        return { success: true, saleId, registerId: venta.register_id ?? null };
    }

    if (confirmarPago) {
        // Transferencia confirmada: pagado y a preparar. Se entrega después, sin cobrar.
        if (p.sale_id) return { success: true, yaEstaba: true, saleId: p.sale_id };
        await confirmarPagoPedido(turso, companyId, preorderId, { saleId, session });
        return { success: true, saleId, registerId: venta.register_id ?? null };
    }

    if (deliveryId) {
        // El repartidor cobró: el envío lleva la venta y queda entregado con lo
        // cobrado (que rinde después). El pedido se cierra con el envío.
        await turso.execute({
            sql: `UPDATE deliveries SET sale_id = ?, sale_register_id = ?, updated_at = ?
                  WHERE id = ? AND company_id = ? AND source_type = 'preorder' AND source_id = ?`,
            args: [saleId, venta.register_id ?? null, nowIso(), deliveryId, companyId, preorderId],
        });
        const r = await deliveryActions.deliveryStatus(turso, companyId, session, {
            id: deliveryId, status: 'delivered', collectedAmount, collectedMethod, receivedBy, receivedByKind, proofPhoto,
        });
        if (!r?.success) return r || { success: false, error: 'No se pudo cerrar el envío' };
    } else {
        // Cobrado en el local: si había un envío abierto, se cierra sin plata que rendir.
        const envio = await envioActivoDePedido(turso, companyId, preorderId);
        if (envio) await cerrarEnvioDesdeTienda(turso, companyId, session, envio, { saleId, saleRegisterId: venta.register_id ?? null });
    }
    await cerrarPedidoTienda(turso, companyId, preorderId, { saleId, session });
    return { success: true, saleId, registerId: venta.register_id ?? null };
}

async function preorderPaymentAdd(turso, companyId, session, { preorderId, amount, method, type = 'final', registerId = null, terminalId = null, bankAccountId = null, authCode = null }) {
    const preorder = await ownPreorder(turso, companyId, preorderId, 'id, total_amount');
    if (!preorder) return { success: false, error: 'Encargo no encontrado' };

    const tId = method === 'Tarjeta' ? (terminalId || null) : null;
    const baId = method === 'Transferencia' ? (bankAccountId || null) : null;
    const ac = method === 'Tarjeta' ? (authCode || null) : null;
    await turso.execute({
        sql: 'INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id, auth_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [preorderId, amount, method, type, registerId, tId, baId, ac],
    });

    const paymentsRes = await turso.execute({
        sql: 'SELECT SUM(amount) as total_paid FROM preorder_payments WHERE preorder_id = ?',
        args: [preorderId],
    });
    const totalPaid = paymentsRes.rows[0]?.total_paid || 0;
    const totalAmount = preorder.total_amount || 0;

    await turso.execute({
        sql: "UPDATE preorders SET deposit_amount = ?, remaining_amount = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?",
        args: [totalPaid, totalAmount - totalPaid, preorderId, companyId],
    });

    if (totalPaid >= totalAmount && type === 'final') {
        await turso.execute({
            sql: "UPDATE preorders SET status = 'delivered', updated_at = datetime('now') WHERE id = ? AND company_id = ?",
            args: [preorderId, companyId],
        });
    }

    return { success: true, totalPaid };
}

// Entrega con pesos reales (Fase 1 · Paso 16). Congela costo/tax al entregar
// (snapshot, patrón sale_items). Devuelve aggregationItems para que el cliente
// alimente updateAllAggregations (ya server-side) y el efectivo va por caja.
async function preorderDeliver(turso, companyId, session, { preorderId, itemWeights, paymentMethod = 'Efectivo', registerId = null, terminalId = null, bankAccountId = null, authCode = null }) {
    const own = await ownPreorder(turso, companyId, preorderId, 'id, external_public_code, status');
    if (!own) return { success: false, error: 'Encargo no encontrado' };
    // Entregar dos veces sumaría la misma mercadería dos veces en los reportes.
    const yaEntregado = own.status === 'delivered';

    const productMetaRes = await turso.execute({
        sql: `SELECT pi.id AS preorder_item_id, pi.product_id,
                     COALESCE(p.name, pi.product_name) AS name,
                     COALESCE(p.cost, 0) AS cost,
                     COALESCE(p.tax_rate, 0) AS tax_rate
              FROM preorder_items pi
              LEFT JOIN products p ON p.id = pi.product_id
              WHERE pi.preorder_id = ?`,
        args: [preorderId],
    });
    const productMetaById = new Map(
        (productMetaRes.rows || []).map(r => [Number(r.preorder_item_id), {
            product_id: r.product_id,
            name: r.name || '',
            cost: Number(r.cost) || 0,
            tax_rate: Number(r.tax_rate) || 0,
        }])
    );

    let realTotal = 0;
    const aggregationItems = [];
    const itemQueries = [];
    for (const iw of itemWeights) {
        const realQty = iw.real_qty !== undefined && iw.real_qty !== null && iw.real_qty !== ''
            ? Number(iw.real_qty)
            : Number(iw.qty || 0);
        const isKg = iw.billing_unit === 'kg';
        const realWeightKg = Number(iw.real_weight_kg) || 0;
        const pricePerKg = Number(iw.price_per_kg) || 0;
        const unitPrice = Number(iw.unit_price) || 0;
        const realItemTotal = isKg ? realWeightKg * pricePerKg : realQty * unitPrice;
        realTotal += realItemTotal;

        // El id puede llegar como texto desde el navegador; la clave del Map es
        // numérica y `get('12')` no encuentra a `12`.
        const meta = productMetaById.get(Number(iw.id)) || { product_id: null, name: '', cost: 0, tax_rate: 0 };
        itemQueries.push({
            sql: 'UPDATE preorder_items SET real_qty = ?, real_weight_kg = ?, real_total = ?, unit_cost = ? WHERE id = ?',
            args: [realQty, iw.real_weight_kg || null, realItemTotal, meta.cost, iw.id],
        });
        if (meta.product_id) {
            aggregationItems.push({
                id: meta.product_id,
                // product_movement_stats guarda el nombre al crear la fila.
                name: meta.name || iw.product_name || '',
                quantity: isKg ? realWeightKg : realQty,
                price: isKg ? pricePerKg : unitPrice,
                cost: meta.cost,
                tax_rate: meta.tax_rate,
            });
        }
    }
    if (itemQueries.length) await turso.batch(itemQueries);

    const paymentsRes = await turso.execute({
        sql: 'SELECT SUM(amount) as total_paid FROM preorder_payments WHERE preorder_id = ?',
        args: [preorderId],
    });
    const totalPaid = paymentsRes.rows[0]?.total_paid || 0;
    const balanceDue = Math.max(0, realTotal - totalPaid);

    if (balanceDue > 0) {
        const tId = paymentMethod === 'Tarjeta' ? (terminalId || null) : null;
        const baId = paymentMethod === 'Transferencia' ? (bankAccountId || null) : null;
        const authCodeFinal = paymentMethod === 'Tarjeta' ? (authCode || null) : null;
        await turso.execute({
            sql: "INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id, auth_code) VALUES (?, ?, ?, 'final', ?, ?, ?, ?)",
            args: [preorderId, balanceDue, paymentMethod, registerId || null, tId, baId, authCodeFinal],
        });
    }

    await turso.execute({
        sql: `UPDATE preorders SET real_total = ?, total_amount = ?, remaining_amount = 0, deposit_amount = ?, status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND company_id = ?`,
        args: [realTotal, realTotal, totalPaid, preorderId, companyId],
    });

    // Un encargo entregado es una venta: alimenta las mismas tablas agregadas que
    // una venta de mostrador, para que el reporte de productos muestre UN solo
    // número (1 kg vendido en caja + 10 kg por encargo = 11 kg) y no haya que
    // sumar dos pantallas a mano.
    //
    // Esto vivía en el navegador (deliverPreorder → updateAllAggregations) y no
    // estaba llegando: productos vendidos SOLO por encargo quedaban en 0 en el
    // reporte. Acá corre en la misma petición que la entrega, así que no depende
    // de que la pestaña siga abierta ni de que haya internet un segundo después.
    let aggregated = false;
    let aggregationError = null;
    if (!yaEntregado && aggregationItems.length) {
        try {
            const [tzRes, userRes] = await turso.batch([
                { sql: 'SELECT timezone FROM companies WHERE id = ?', args: [companyId] },
                { sql: 'SELECT name FROM users WHERE id = ?', args: [session?.uid ?? null] },
            ], 'read');
            const tz = tzRes.rows[0]?.timezone || 'America/Santiago';
            const iso = nowIso();
            const { day, hour } = companyDayAndHour(iso, tz);
            await saleAggregations(turso, companyId, session, {
                saleData: { total: realTotal, date: iso, items: aggregationItems },
                userId: session?.uid ?? null,
                userName: userRes.rows[0]?.name || session?.username || '',
                dateStr: day,
                hour,
            });
            aggregated = true;
        } catch (e) {
            // La entrega ya se guardó y la plata ya cambió de manos: no se revierte
            // por esto. Se registra fuerte y se avisa al cliente, en vez del
            // console.warn silencioso de antes.
            aggregationError = e.message;
            console.error(`❌ preorderDeliver #${preorderId}: el encargo NO entró a los reportes:`, e);
        }
    }

    return {
        success: true,
        realTotal,
        balanceDue,
        aggregationItems,
        aggregated,
        aggregationError,
        externalPublicCode: own.external_public_code || null,
    };
}

// Reportes de encargos (Fase 1 · Paso 17) — queries crudas server-side;
// el post-procesamiento (formatos/cálculos de UI) sigue en el cliente.

async function preorderReportsRaw(turso, companyId, session, { startDate, endDate }) {
    await ensureOrderKindColumn(turso);
    const df = (col) => `SUBSTR(${col}, 1, 10) BETWEEN ? AND ?`;
    const [summaryRes, byProductRes, byClientRes, detailsRes] = await turso.batch([
        {
            sql: `SELECT COUNT(*) as total_orders,
                    SUM(COALESCE(real_total, total_amount)) as total_revenue,
                    SUM(deposit_amount) as total_deposits,
                    COUNT(*) as delivered_count,
                    AVG(COALESCE(real_total, total_amount)) as avg_ticket
                  FROM preorders
                  WHERE status = 'delivered' AND ${df('delivered_at')} AND company_id = ?${ONLY_ENCARGO()}`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT p.name, p.sku,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty)) as quantity,
                    pi.billing_unit,
                    SUM(COALESCE(pi.real_total, pi.line_total)) as revenue,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty) * COALESCE(p.original_price, 0)) as approximate_cost
                  FROM preorder_items pi
                  JOIN preorders po ON pi.preorder_id = po.id
                  JOIN products p ON pi.product_id = p.id
                  WHERE po.status = 'delivered' AND ${df('po.delivered_at')} AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY pi.product_id ORDER BY revenue DESC`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT po.client_id, po.client_name, MAX(po.client_phone) as phone,
                    COUNT(*) as orders_count,
                    SUM(COALESCE(po.real_total, po.total_amount)) as total_spend,
                    MAX(po.delivered_at) as last_order_date
                  FROM preorders po
                  WHERE po.status = 'delivered' AND ${df('po.delivered_at')} AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY COALESCE(po.client_id, po.client_name)
                  ORDER BY total_spend DESC LIMIT 100`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT po.id, po.created_at, po.delivered_at, po.due_date, po.status, po.client_name,
                    COALESCE(po.real_total, po.total_amount) as total_amount, po.deposit_amount,
                    (SELECT GROUP_CONCAT(p.name || ' (' || COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty) || ')', ', ')
                     FROM preorder_items pi JOIN products p ON pi.product_id = p.id
                     WHERE pi.preorder_id = po.id) as items_summary
                  FROM preorders po
                  WHERE po.status = 'delivered' AND ${df('po.delivered_at')} AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  ORDER BY po.delivered_at DESC`,
            args: [startDate, endDate, companyId],
        },
    ], 'read');
    return {
        success: true,
        summary: summaryRes.rows[0] || null,
        byProduct: byProductRes.rows,
        byClient: byClientRes.rows,
        details: detailsRes.rows,
    };
}

async function preorderAnalyticsRaw(turso, companyId, session, { startDate, endDate, prevStartStr, prevEndStr }) {
    await ensureOrderKindColumn(turso);
    const results = await turso.batch([
        {
            sql: `SELECT status, COUNT(*) as count, SUM(COALESCE(real_total, total_amount)) as amount
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()} GROUP BY status`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT COUNT(*) as total_orders,
                    SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered_count,
                    SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) as canceled_count,
                    SUM(CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN 1 ELSE 0 END) as inprocess_count,
                    SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue,
                    SUM(CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN COALESCE(estimated_total, total_amount) ELSE 0 END) as pipeline_value,
                    SUM(deposit_amount) as total_deposits,
                    AVG(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) END) as avg_ticket
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()}`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT pp.method, COUNT(DISTINCT pp.preorder_id) as orders, SUM(pp.amount) as total
                  FROM preorder_payments pp JOIN preorders po ON pp.preorder_id = po.id
                  WHERE po.status = 'delivered' AND po.due_date BETWEEN ? AND ? AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY pp.method ORDER BY total DESC`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT due_date as day, COUNT(*) as orders,
                    SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue,
                    SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()}
                  GROUP BY due_date ORDER BY due_date`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT p.name, p.sku, pi.billing_unit,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty)) as quantity,
                    SUM(COALESCE(pi.real_total, pi.line_total)) as revenue,
                    COUNT(DISTINCT po.id) as orders
                  FROM preorder_items pi
                  JOIN preorders po ON pi.preorder_id = po.id
                  JOIN products p ON pi.product_id = p.id
                  WHERE po.status != 'canceled' AND po.due_date BETWEEN ? AND ? AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY pi.product_id ORDER BY quantity DESC LIMIT 15`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT po.client_id, po.client_name, MAX(po.client_phone) as phone,
                    COUNT(*) as orders_count,
                    SUM(CASE WHEN po.status='delivered' THEN 1 ELSE 0 END) as delivered_count,
                    SUM(CASE WHEN po.status='canceled' THEN 1 ELSE 0 END) as canceled_count,
                    SUM(CASE WHEN po.status='delivered' THEN COALESCE(po.real_total, po.total_amount) ELSE 0 END) as total_spend
                  FROM preorders po
                  WHERE po.due_date BETWEEN ? AND ? AND po.company_id = ?${ONLY_ENCARGO('po.')}
                  GROUP BY COALESCE(po.client_id, po.client_name)
                  ORDER BY total_spend DESC LIMIT 15`,
            args: [startDate, endDate, companyId],
        },
        {
            sql: `SELECT COUNT(*) as total_orders,
                    SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue
                  FROM preorders WHERE due_date BETWEEN ? AND ? AND company_id = ?${ONLY_ENCARGO()}`,
            args: [prevStartStr, prevEndStr, companyId],
        },
    ], 'read');
    return { success: true, rows: results.map(r => r.rows) };
}

// Productos encargables (el cache Dexie/memoria sigue en el cliente)
async function preorderableProducts(turso, companyId) {
    try {
        await turso.execute('CREATE INDEX IF NOT EXISTS idx_products_company_salemode ON products(company_id, sale_mode)');
    } catch { /* índice ya existe */ }
    const result = await turso.execute({
        sql: `SELECT id, name, sku, price, cost, image, category, unit,
              sale_mode, is_offer, offer_price, allow_item_notes, price_ranges,
              preorder_unit, preorder_billing_unit, preorder_price_per_kg,
              preorder_gram_per_unit, preorder_use_base_price
              FROM products
              WHERE company_id = ? AND sale_mode IN ('preorder_only', 'both')
              ORDER BY name ASC`,
        args: [companyId],
    });
    return { success: true, rows: result.rows };
}

export const preorderActions = {
    preorderDeliver,
    preorderReportsRaw,
    preorderAnalyticsRaw,
    preorderableProducts,
    preorderCreate,
    preordersFetch,
    pendingWebOrders,
    preorderActiveCounts,
    preorderDetails,
    preorderItemsEdit,
    preorderStatusUpdate,
    preorderPaymentAdd,
    storeOrderRelease,
    storeOrderReserve,
    storeOrderComplete,
};
