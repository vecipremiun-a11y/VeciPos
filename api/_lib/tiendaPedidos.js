// Pedidos de la tienda web (miniveci.cl) dentro de POSVECI (migración 0034).
//
// Cómo camina un pedido (definido con Kevin el 8-oct-2026):
//   · Llega        → queda "Preparando" y su stock se SEPARA (products.stock baja).
//   · Listo        → "Listo para retiro". Si es a domicilio, aparece en Delivery.
//   · En reparto   → lo marca la Tienda o el repartidor al retirarlo del local.
//   · Entregado    → solo cobrando, si se paga al recibir: se devuelve lo separado
//                    y se registra la venta (boleta o nota de venta), que descuenta
//                    el stock por el camino de siempre. Así se descuenta UNA vez.
//   · Cancelado    → lo separado vuelve al stock.
// Cada paso se le avisa a miniveci.cl, que también descuenta su copia una sola vez.

import { moverStock } from './stockSeparado.js';
import { avisarEstadoTienda } from './avisoTienda.js';
import { syncProductToStore } from '../integration/client.js';
import { broadcastPreorderEvent } from '../events/preorders-stream.js';

const nowIso = () => new Date().toISOString();

// Historial del pedido (migración 0028). Best-effort, igual que en preorderActions.
async function anotarEstado(turso, { companyId, preorderId, from, to, reason = null, session = null, userName = null }) {
    try {
        await turso.execute({
            sql: `INSERT INTO preorder_status_history
                    (company_id, preorder_id, from_status, to_status, reason, user_id, user_name, source, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'tienda', ?)`,
            args: [companyId, preorderId, from || null, to, reason, session?.uid ?? null,
                userName || session?.username || null, nowIso()],
        });
    } catch (e) {
        console.error('preorder_status_history (tienda):', e?.message || e);
    }
}

/** El pedido, solo si es de la tienda web y de la empresa. */
export async function pedidoTienda(turso, companyId, preorderId) {
    if (!preorderId) return null;
    const r = await turso.execute({
        sql: 'SELECT * FROM preorders WHERE id = ? AND company_id = ? LIMIT 1',
        args: [preorderId, companyId],
    });
    const p = r.rows[0];
    return p && p.order_kind === 'store' ? p : null;
}

// El producto del POS de cada renglón. Los pedidos que llegaron antes del
// 8-oct-2026 tienen product_id = 0 (la búsqueda al recibirlos fallaba siempre):
// para esos se busca por lo que mandó la tienda (nuestro id, o el SKU).
// Lleva DOS veces el company_id como parámetro (id primero, SKU después).
const PRODUCTO_DEL_RENGLON = `COALESCE(NULLIF(pi.product_id, 0),
        (SELECT px.id FROM products px WHERE px.company_id = ? AND CAST(px.id AS TEXT) = pi.external_product_id LIMIT 1),
        (SELECT py.id FROM products py WHERE py.company_id = ? AND py.sku = pi.external_product_id LIMIT 1))`;

/** Lo que separa un pedido: sus renglones con producto del POS, sumados por producto. */
async function reservasDelPedido(turso, companyId, preorderId) {
    const r = await turso.execute({
        sql: `SELECT ${PRODUCTO_DEL_RENGLON} AS product_id, pi.qty FROM preorder_items pi WHERE pi.preorder_id = ?`,
        args: [companyId, companyId, preorderId],
    });
    const m = new Map();
    for (const it of r.rows) {
        const id = Number(it.product_id);
        const q = Number(it.qty) || 0;
        if (!(id > 0) || !(q > 0)) continue;   // producto que el POS no reconoce: no se separa
        m.set(id, (m.get(id) || 0) + q);
    }
    return [...m].map(([productId, qty]) => ({ productId, qty: Math.round(qty * 1000) / 1000 }));
}

/**
 * Separa el stock del pedido, una sola vez (la marca stock_reserved 0 → 1 decide).
 * Se separa aunque no alcance: el pedido ya se vendió en la web y no se puede
 * rechazar. El stock en negativo es la señal de que hay que contarlo.
 */
export async function separarStockPedido(turso, companyId, preorderId) {
    const reservas = await reservasDelPedido(turso, companyId, preorderId);
    const marca = await turso.execute({
        sql: `UPDATE preorders SET stock_reserved = 1, reserved_items = ?
              WHERE id = ? AND company_id = ? AND stock_reserved = 0
                AND status NOT IN ('delivered', 'canceled') RETURNING id`,
        args: [JSON.stringify(reservas), preorderId, companyId],
    });
    if (!marca.rows[0]) return { reservados: [] };
    try {
        await moverStock(turso, companyId, reservas, -1, { permitirNegativo: true });
    } catch (e) {
        await turso.execute({ sql: 'UPDATE preorders SET stock_reserved = 0 WHERE id = ? AND company_id = ?', args: [preorderId, companyId] });
        throw e;
    }
    return { reservados: reservas };
}

/** Devuelve lo separado, UNA sola vez: la marca pasa de 1 a 0 en la misma sentencia. */
export async function liberarStockPedido(turso, companyId, preorderId) {
    const marca = await turso.execute({
        sql: 'UPDATE preorders SET stock_reserved = 0 WHERE id = ? AND company_id = ? AND stock_reserved = 1 RETURNING reserved_items',
        args: [preorderId, companyId],
    });
    if (!marca.rows[0]) return { liberados: [] };
    let reservas = [];
    try { reservas = JSON.parse(marca.rows[0].reserved_items || '[]'); } catch { reservas = []; }
    await moverStock(turso, companyId, reservas, +1);
    return { liberados: reservas };
}

/** La venta no se pudo registrar: el pedido vuelve a separar lo mismo que tenía. */
export async function volverASepararPedido(turso, companyId, preorderId) {
    const marca = await turso.execute({
        sql: `UPDATE preorders SET stock_reserved = 1
              WHERE id = ? AND company_id = ? AND stock_reserved = 0 AND reserved_items IS NOT NULL
                AND status NOT IN ('delivered', 'canceled') RETURNING reserved_items`,
        args: [preorderId, companyId],
    });
    if (!marca.rows[0]) return { reservados: [] };
    let reservas = [];
    try { reservas = JSON.parse(marca.rows[0].reserved_items || '[]'); } catch { reservas = []; }
    await moverStock(turso, companyId, reservas, -1, { permitirNegativo: true });
    return { reservados: reservas };
}

/** Se editaron los productos del pedido: lo separado pasa a ser lo nuevo. */
export async function rehacerReservaPedido(turso, companyId, preorderId) {
    const { liberados } = await liberarStockPedido(turso, companyId, preorderId);
    if (!liberados.length) {
        // Sin reserva previa (pedido anterior a la 0034): no se empieza a separar ahora.
        const p = await turso.execute({ sql: 'SELECT reserved_items FROM preorders WHERE id = ? AND company_id = ?', args: [preorderId, companyId] });
        if (!p.rows[0]?.reserved_items) return { liberados: [], reservados: [] };
    }
    const { reservados } = await separarStockPedido(turso, companyId, preorderId);
    return { liberados, reservados };
}

/**
 * Le manda a la tienda el stock actual de estos productos. Para los cambios que
 * pasan en el servidor sin una caja de por medio (una cancelación que llega de
 * miniveci.cl): en la caja lo hace el navegador después de cada movimiento.
 */
export async function empujarStockATienda(turso, companyId, productIds) {
    const ids = [...new Set((productIds || []).map(Number).filter(n => n > 0))];
    if (!ids.length) return;
    try {
        const r = await turso.execute({
            sql: `SELECT id, sku, stock, unit FROM products WHERE company_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
            args: [companyId, ...ids],
        });
        for (const p of r.rows) {
            if (!p.sku) continue;
            try {
                await syncProductToStore({ companyId, product: { id: p.id, sku: p.sku, stock: Number(p.stock) || 0, unit: p.unit } });
            } catch (e) {
                console.warn('[tienda] no se pudo mandar el stock', p.id, e?.message);
            }
        }
    } catch (e) {
        console.warn('[tienda] no se pudo leer el stock para la tienda', e?.message);
    }
}

/**
 * Cierra el pedido como entregado. `saleId`: la venta que se registró al cobrar
 * (el pedido queda pagado). Sin venta, es un pedido que ya venía pagado.
 * Idempotente: un pedido ya entregado o cancelado no se toca.
 */
export async function cerrarPedidoTienda(turso, companyId, preorderId, { saleId = null, session = null, nota = null } = {}) {
    const p = await pedidoTienda(turso, companyId, preorderId);
    if (!p || ['delivered', 'canceled'].includes(p.status)) return { cerrado: false };
    const pagadoAhora = saleId ? 1 : 0;
    const r = await turso.execute({
        sql: `UPDATE preorders
              SET status = 'delivered', delivered_at = COALESCE(delivered_at, datetime('now')), updated_at = datetime('now'),
                  sale_id = COALESCE(?, sale_id),
                  remaining_amount = CASE WHEN ? = 1 THEN 0 ELSE remaining_amount END,
                  deposit_amount = CASE WHEN ? = 1 THEN total_amount ELSE deposit_amount END
              WHERE id = ? AND company_id = ? AND status NOT IN ('delivered', 'canceled')`,
        args: [saleId, pagadoAhora, pagadoAhora, preorderId, companyId],
    });
    if (Number(r.rowsAffected) !== 1) return { cerrado: false };
    await anotarEstado(turso, { companyId, preorderId, from: p.status, to: 'delivered', reason: nota, session });
    // Entregado = pagado para miniveci.cl (en POSVECI solo se entrega cobrado).
    await avisarEstadoTienda(companyId, p.external_public_code, 'delivered', { via: 'entrega' });
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: Number(preorderId), status: 'delivered' });
    return { cerrado: true };
}

/**
 * Transferencia que el local todavía no revisó: el pedido llega "Pendiente" y
 * solo pasa a "Preparando" confirmando el pago (ahí nace la venta).
 */
export function esTransferenciaPorConfirmar(p) {
    return !!p && p.order_kind === 'store' && ['pending', 'confirmed'].includes(p.status)
        && String(p.payment_method || '').toLowerCase() === 'transferencia'
        && Number(p.remaining_amount) > 0;
}

/**
 * El local revisó el comprobante y la plata llegó: la venta ya se registró
 * (`saleId`) y el pedido pasa a "Preparando", pagado. Desde ahí sigue como
 * cualquier pedido pagado: se entrega sin cobrar.
 */
export async function confirmarPagoPedido(turso, companyId, preorderId, { saleId, session = null } = {}) {
    const p = await pedidoTienda(turso, companyId, preorderId);
    if (!p || !['pending', 'confirmed'].includes(p.status)) return { cambiado: false };
    const r = await turso.execute({
        sql: `UPDATE preorders
              SET status = 'preparing', updated_at = datetime('now'), sale_id = ?,
                  remaining_amount = 0, deposit_amount = total_amount, payment_status = 'paid'
              WHERE id = ? AND company_id = ? AND status IN ('pending', 'confirmed')`,
        args: [saleId, preorderId, companyId],
    });
    if (Number(r.rowsAffected) !== 1) return { cambiado: false };
    await anotarEstado(turso, { companyId, preorderId, from: p.status, to: 'preparing', reason: `Transferencia confirmada · venta #${saleId}`, session });
    await avisarEstadoTienda(companyId, p.external_public_code, 'preparing', { via: 'transferencia confirmada', pago: 'paid' });
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: Number(preorderId), status: 'preparing' });
    return { cambiado: true };
}

/**
 * Pedido pagado en la web (Mercado Pago) que todavía no tiene su venta: el local
 * la registra a mano desde la pestaña Tienda con "Hacer boleta" / "Hacer
 * factura" (decidido con Kevin el 13-oct-2026). Hasta entonces no pasa a "Listo".
 * Los pedidos de antes de la migración 0034 (sin payment_status) no aplican.
 */
export function pagadoSinDocumento(p) {
    return !!p && p.order_kind === 'store' && p.payment_status === 'paid' && !p.sale_id
        && !['delivered', 'canceled'].includes(p.status);
}

/** Se hizo la boleta o la factura del pedido pagado: queda anotada su venta. */
export async function anotarDocumento(turso, companyId, preorderId, { saleId, session = null, nota = null } = {}) {
    const p = await pedidoTienda(turso, companyId, preorderId);
    if (!p) return { cambiado: false };
    const r = await turso.execute({
        sql: `UPDATE preorders SET sale_id = ?, updated_at = datetime('now')
              WHERE id = ? AND company_id = ? AND sale_id IS NULL`,
        args: [saleId, preorderId, companyId],
    });
    if (Number(r.rowsAffected) !== 1) return { cambiado: false };
    await anotarEstado(turso, { companyId, preorderId, from: p.status, to: p.status, reason: nota || `Documento hecho · venta #${saleId}`, session });
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: Number(preorderId), status: p.status });
    return { cambiado: true };
}

/** El repartidor se lo llevó: el pedido pasa a "En reparto" (si estaba Listo). */
export async function pasarAEnReparto(turso, companyId, preorderId, { session = null, nota = null } = {}) {
    const r = await turso.execute({
        sql: `UPDATE preorders SET status = 'out_for_delivery', updated_at = datetime('now')
              WHERE id = ? AND company_id = ? AND order_kind = 'store' AND status = 'ready'
              RETURNING external_public_code`,
        args: [preorderId, companyId],
    });
    if (!r.rows[0]) return { cambiado: false };
    await anotarEstado(turso, { companyId, preorderId, from: 'ready', to: 'out_for_delivery', reason: nota, session });
    await avisarEstadoTienda(companyId, r.rows[0].external_public_code, 'out_for_delivery', { via: 'repartidor' });
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: Number(preorderId), status: 'out_for_delivery' });
    return { cambiado: true };
}

/**
 * El envío se anuló o no se pudo entregar: la mercadería vuelve al local y el
 * pedido vuelve a "Listo para retiro" (se puede mandar de nuevo o retirar).
 * miniveci.cl no tiene vuelta atrás desde "En camino": allá queda igual.
 */
export async function volverAListo(turso, companyId, preorderId, { session = null, nota = null } = {}) {
    const r = await turso.execute({
        sql: `UPDATE preorders SET status = 'ready', updated_at = datetime('now')
              WHERE id = ? AND company_id = ? AND order_kind = 'store' AND status = 'out_for_delivery'
              RETURNING id`,
        args: [preorderId, companyId],
    });
    if (!r.rows[0]) return { cambiado: false };
    await anotarEstado(turso, { companyId, preorderId, from: 'out_for_delivery', to: 'ready', reason: nota, session });
    await broadcastPreorderEvent('order.updated', { company_id: companyId, id: Number(preorderId), status: 'ready' });
    return { cambiado: true };
}

/**
 * Lo que se vende al cobrar: los renglones del pedido con costo e impuesto del
 * POS, a los precios que pagó el cliente. Si la tienda aplicó un descuento
 * (cupón), se reparte entre los renglones para que la venta sume lo cobrado.
 */
export async function ventaDelPedido(turso, companyId, p) {
    const r = await turso.execute({
        sql: `SELECT x.*, pr.cost, pr.tax_rate
              FROM (SELECT pi.id, ${PRODUCTO_DEL_RENGLON} AS product_id, pi.product_name, pi.qty, pi.unit,
                           pi.unit_price, pi.line_total
                    FROM preorder_items pi WHERE pi.preorder_id = ?) x
              LEFT JOIN products pr ON pr.id = x.product_id AND pr.company_id = ?
              ORDER BY x.id`,
        args: [companyId, companyId, p.id, companyId],
    });
    const renglones = r.rows.map(it => {
        const qty = Number(it.qty) || 0;
        const unit = Number(it.unit_price) || 0;
        const linea = Number(it.line_total) || 0;
        // El precio es el del renglón; si no cuadra con la línea (precio por kilo), manda la línea.
        const precio = qty > 0 && Math.abs(qty * unit - linea) > 1 ? linea / qty : unit;
        return {
            id: Number(it.product_id) || 0,
            name: it.product_name || 'Producto',
            quantity: qty,
            price: precio,
            cost: Number(it.cost) || 0,
            tax_rate: it.tax_rate == null ? 19 : Number(it.tax_rate),
            unit: it.unit || 'Und',
        };
    });
    const suma = renglones.reduce((a, it) => a + it.price * it.quantity, 0);
    const productos = Math.max(0, (Number(p.total_amount) || 0) - (Number(p.delivery_fee) || 0));
    const factor = suma > 0 && productos > 0 && productos < suma - 0.5 ? productos / suma : 1;
    const items = renglones.map(it => ({ ...it, price: Math.round(it.price * factor * 100) / 100 }));
    const total = factor === 1 ? Math.round(suma) : Math.round(productos);
    const cliente = p.client_id ? { id: Number(p.client_id), name: p.client_name || null } : null;
    return { items, total, client: cliente, clientName: p.client_name || null, fee: Number(p.delivery_fee) || 0 };
}
