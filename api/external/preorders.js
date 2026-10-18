import {
    authenticateAndResolveCompany,
    emitCatalogWebhook,
    ensureClientsSyncColumns,
    ensurePreordersSyncColumns,
    parseJsonBody,
    resolveOrCreateClient,
    setCorsHeaders,
    turso,
} from './_common.js';
import { broadcastPreorderEvent } from '../events/preorders-stream.js';
import { separarStockPedido, liberarStockPedido, empujarStockATienda, cajaParaGuardar } from '../_lib/tiendaPedidos.js';
import { avisarEstadoTienda } from '../_lib/avisoTienda.js';
import { deliveryActions, envioActivoDePedido } from '../_lib/deliveryActions.js';

const ALLOWED_INCOMING_STATUSES = new Set(['canceled']);
const COMPANY_TIMEZONE = process.env.EXTERNAL_COMPANY_TIMEZONE || 'America/Santiago';

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function splitScheduledFor(iso) {
    if (!iso) return { date: null, time: null };
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: null, time: null };

    // Render date/time in company timezone, then parse pieces back
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: COMPANY_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
    }, {});
    const hh = parts.hour === '24' ? '00' : parts.hour;
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${hh}:${parts.minute}`,
    };
}

// Datos de factura que el cliente dejó en el checkout ("Quiero factura"). Sin RUT
// o sin razón social no sirven para facturar: se ignoran y el pedido va con boleta.
function datosDeFactura(inv) {
    if (!inv || typeof inv !== 'object') return null;
    const t = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const datos = {
        rut: t(inv.rut, 12),
        razon_social: t(inv.razon_social),
        giro: t(inv.giro, 80),
        direccion: t(inv.direccion),
        comuna: t(inv.comuna, 60),
        ciudad: t(inv.ciudad, 60),
        email: t(inv.email, 120),
    };
    return datos.rut && datos.razon_social ? JSON.stringify(datos) : null;
}

// El producto del POS: miniveci.cl manda nuestro id (posProductId) o, si no lo
// tiene, el SKU. Antes la consulta preguntaba también por `external_id`, columna
// que products no tiene: la consulta fallaba, el catch devolvía 0 y TODOS los
// pedidos de la tienda quedaban sin producto (product_id = 0, visto el 8-oct-2026).
async function resolveProductId(externalProductId, productName, companyId) {
    if (!externalProductId) return 0;
    try {
        const ext = String(externalProductId);
        const r = await turso.execute({
            sql: `SELECT id FROM products
                  WHERE company_id = ? AND (CAST(id AS TEXT) = ? OR sku = ?)
                  ORDER BY CASE WHEN CAST(id AS TEXT) = ? THEN 0 ELSE 1 END
                  LIMIT 1`,
            args: [companyId, ext, ext, ext],
        });
        return r.rows?.[0]?.id || 0;
    } catch {
        return 0;
    }
}

async function createPreorder(req, res, companyId) {
    await ensurePreordersSyncColumns();
    await ensureClientsSyncColumns();
    const payload = parseJsonBody(req);

    // 'store' = pedido normal de la tienda web (pagado online, retiro/entrega
    // inmediata); 'encargo' = pedido de amasandería con fecha programada.
    const orderKind = payload.order_type === 'store' ? 'store' : 'encargo';

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return res.status(400).json({ success: false, error: 'Missing items[]' });
    }
    if (!payload.scheduled_for && orderKind === 'encargo') {
        return res.status(400).json({ success: false, error: 'Missing scheduled_for (ISO 8601)' });
    }
    if (!payload.external_order_id) {
        return res.status(400).json({ success: false, error: 'Missing external_order_id' });
    }

    // Idempotencia: si ya existe un preorder con ese external_order_id, devolverlo
    const existing = await turso.execute({
        sql: 'SELECT id FROM preorders WHERE company_id = ? AND external_order_id = ? LIMIT 1',
        args: [companyId, payload.external_order_id],
    });
    if (existing.rows?.[0]) {
        return res.status(200).json({
            success: true,
            duplicate: true,
            preorder: {
                id: existing.rows[0].id,
                external_order_id: payload.external_order_id,
            },
        });
    }

    // Pedidos de tienda sin fecha programada: usan la fecha/hora del pedido.
    const scheduledIso = payload.scheduled_for || (orderKind === 'store' ? new Date().toISOString() : null);
    const { date: due_date, time: due_time } = splitScheduledFor(scheduledIso);
    if (!due_date || !due_time) {
        return res.status(400).json({ success: false, error: 'Invalid scheduled_for format' });
    }

    const client = payload.client || {};
    const itemsTotal = payload.items.reduce((acc, it) => acc + toNumber(it.line_subtotal, 0), 0);
    const subtotal = payload.subtotal !== undefined ? toNumber(payload.subtotal, itemsTotal) : itemsTotal;
    const deliveryFee = toNumber(payload.delivery_fee, 0);
    const total = payload.total !== undefined ? toNumber(payload.total, subtotal + deliveryFee) : subtotal + deliveryFee;

    const now = new Date().toISOString();

    // Dedupe & link contra la tabla `clients`. Si el cliente ya existe en
    // POSVECI (match por external_id/rut/teléfono) reusamos su id y mostramos
    // sus datos canónicos. Si es nuevo, lo damos de alta automáticamente.
    const resolvedClientId = await resolveOrCreateClient(client, companyId, { source: 'miniveci' });
    let displayName = client.name || 'Cliente web';
    let displayPhone = client.phone || null;
    let displayEmail = client.email || null;
    let displayRut = client.rut || null;
    if (resolvedClientId) {
        const c = await turso.execute({
            sql: 'SELECT name, phone, email, rut FROM clients WHERE id = ? LIMIT 1',
            args: [resolvedClientId],
        });
        const row = c.rows?.[0];
        if (row) {
            displayName = row.name || displayName;
            displayPhone = row.phone || displayPhone;
            displayEmail = row.email || displayEmail;
            displayRut = row.rut || displayRut;
        }
    }

    // Pedidos de tienda pagados online: depósito = total, saldo = 0 (sin fila en
    // preorder_payments; cancelar no mueve caja). Lo que se paga al recibir queda
    // con saldo = total: se cobra al entregar, y ahí nace la venta.
    //
    // Quién está pagado lo dice miniveci.cl con `payment_status` (oct-2026): una
    // transferencia sin confirmar NO está pagada. Sin ese campo (versión vieja de
    // la tienda) vale la regla de antes: todo lo que no es contra entrega.
    const paymentStatus = ['paid', 'pending'].includes(payload.payment_status) ? payload.payment_status : null;
    const paidOnline = orderKind === 'store' && (paymentStatus
        ? paymentStatus === 'paid'
        : String(payload.payment_method || 'online').toLowerCase() !== 'contra_entrega');
    const depositAmount = paidOnline ? total : 0;
    const remainingAmount = paidOnline ? 0 : total;
    // El pedido de la tienda llega "Preparando": no hay que aceptarlo, su stock ya
    // queda separado. Salvo la transferencia sin revisar: llega "Pendiente" hasta
    // que el local confirma que la plata llegó (9-oct-2026). El encargo de
    // amasandería sigue entrando "Pendiente".
    const transferenciaPorRevisar = orderKind === 'store' && !paidOnline
        && String(payload.payment_method || '').toLowerCase() === 'transferencia';
    const estadoInicial = orderKind === 'store' && !transferenciaPorRevisar ? 'preparing' : 'pending';

    // Insert preorder (todas las columnas ya garantizadas por ensurePreordersSyncColumns)
    const insertRes = await turso.execute({
        sql: `INSERT INTO preorders
              (company_id, client_id, client_name, client_phone,
               due_date, due_time, status,
               total_amount, estimated_total, deposit_amount, remaining_amount,
               delivery_type, delivery_address, notes, created_by, created_at, updated_at,
               external_order_id, external_public_code, external_source,
               client_email, client_rut, client_external_id,
               delivery_fee, payment_method, order_kind)
              VALUES (?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?,
                      ?, ?, 'miniveci',
                      ?, ?, ?,
                      ?, ?, ?)
              RETURNING *`,
        args: [
            companyId,
            resolvedClientId,
            displayName,
            displayPhone,
            due_date,
            due_time,
            estadoInicial,
            total,
            total,
            depositAmount,
            remainingAmount,
            payload.method === 'delivery' ? 'delivery' : 'pickup',
            payload.address || null,
            payload.general_notes || null,
            'miniveci',
            now,
            now,
            payload.external_order_id,
            payload.public_code || null,
            displayEmail,
            displayRut,
            client.external_id || null,
            deliveryFee,
            payload.payment_method || (orderKind === 'store' ? 'online' : 'pending_on_pickup'),
            orderKind,
        ],
    });

    const preorder = insertRes.rows[0];
    const preorderId = preorder.id;

    // Insert items
    for (const item of payload.items) {
        const productId = await resolveProductId(item.product_external_id, item.product_name, companyId);
        const qty = toNumber(item.quantity, 1);
        const unitPrice = toNumber(item.unit_price, 0);
        const lineSubtotal = toNumber(item.line_subtotal, qty * unitPrice);
        const pricingMode = item.pricing_mode === 'kg' ? 'kg' : 'unit';
        const gramsPerUnit = toNumber(item.grams_per_unit, 0);
        // Caja, bandeja o pack que eligió el cliente (contrato POSVECI-UNIDADES.md).
        const presentacion = pricingMode === 'unit' ? cajaParaGuardar(item.presentation, qty) : null;

        const columnas = `preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
                   billing_unit, price_per_kg, gram_per_unit, estimated_total, external_product_id`;
        const valores = [
            preorderId,
            productId,
            item.product_name || 'Producto',
            qty,
            item.unit || (pricingMode === 'kg' ? 'kg' : 'Und'),
            unitPrice,
            lineSubtotal,
            item.note || '',
            pricingMode,
            pricingMode === 'kg' ? unitPrice : 0,
            gramsPerUnit,
            lineSubtotal,
            item.product_external_id || null,
        ];
        const sinCaja = () => turso.execute({
            sql: `INSERT INTO preorder_items (${columnas}) VALUES (${valores.map(() => '?').join(', ')})`,
            args: valores,
        });
        if (!presentacion) {
            await sinCaja();
        } else {
            try {
                await turso.execute({
                    sql: `INSERT INTO preorder_items (${columnas}, presentation) VALUES (${valores.map(() => '?').join(', ')}, ?)`,
                    args: [...valores, JSON.stringify(presentacion)],
                });
            } catch (err) {
                // Base sin la migración 0035: el renglón entra igual, por unidad.
                if (!/no such column/i.test(String(err?.message))) throw err;
                await sinCaja();
            }
        }
    }

    // Pedido de la tienda: se separa su stock y miniveci.cl se entera de que está
    // "Preparando". Si algo de esto falla, el pedido igual queda creado.
    if (orderKind === 'store') {
        try {
            // El comprobante de la transferencia (lo sube el cliente en la tienda).
            const comprobante = typeof payload.payment_proof_url === 'string' && /^https?:\/\//.test(payload.payment_proof_url)
                ? payload.payment_proof_url.slice(0, 500) : null;
            await turso.execute({
                sql: 'UPDATE preorders SET payment_status = ?, payment_proof_url = ?, invoice_data = ? WHERE id = ?',
                args: [paidOnline ? 'paid' : 'pending', comprobante, datosDeFactura(payload.invoice), preorderId],
            });
            // El stock se separa igual en la transferencia sin revisar: si se
            // rechaza, vuelve.
            await separarStockPedido(turso, companyId, preorderId);
        } catch (e) {
            console.error(`❌ [preorders] no se pudo separar el stock del pedido #${preorderId}:`, e?.message || e);
        }
        if (estadoInicial === 'preparing') {
            await avisarEstadoTienda(companyId, preorder.external_public_code, 'preparing', { via: 'pedido recibido', esperaMs: 2500 });
        }
    }

    const out = {
        id: preorderId,
        external_order_id: preorder.external_order_id,
        public_code: preorder.external_public_code,
        status: estadoInicial,
        order_kind: orderKind,
        due_date,
        due_time,
        total,
        // Para el aviso en vivo del POS (tarjeta de "Encargo amasandería"):
        // nombre del cliente + productos/cantidades, sin que el front tenga que
        // re-consultar el detalle.
        client_name: displayName,
        items: payload.items.map(it => ({
            name: it.product_name || 'Producto',
            qty: toNumber(it.quantity, 1),
            unit: it.unit || null,
        })),
    };

    console.log(`✅ [preorders] ${orderKind === 'store' ? 'Pedido tienda' : 'Encargo'} creado #${preorderId} (${out.public_code || 's/código'}) · ${payload.items.length} items · entrega ${due_date} ${due_time}`);

    // Empuje en vivo a la pantalla de Producción (SSE). No bloquea la respuesta.
    broadcastPreorderEvent('order.created', { ...out, company_id: companyId });

    // Aviso opcional a webhook genérico (no bloqueante)
    emitCatalogWebhook('preorder.created', { company_id: companyId, preorder: out }).catch(() => { });

    return res.status(201).json({ success: true, preorder: out });
}

async function cancelPreorder(req, res, companyId) {
    await ensurePreordersSyncColumns();
    const payload = parseJsonBody(req);

    if (!payload.external_order_id) {
        return res.status(400).json({ success: false, error: 'Missing external_order_id' });
    }
    if (!payload.status || !ALLOWED_INCOMING_STATUSES.has(payload.status)) {
        return res.status(400).json({
            success: false,
            error: `Only allowed incoming status from miniveci: ${[...ALLOWED_INCOMING_STATUSES].join(', ')}`,
        });
    }

    const before = await turso.execute({
        sql: 'SELECT * FROM preorders WHERE company_id = ? AND external_order_id = ? LIMIT 1',
        args: [companyId, payload.external_order_id],
    });
    const row = before.rows?.[0];
    if (!row) {
        return res.status(404).json({ success: false, error: 'Preorder not found' });
    }

    // Si ya estaba entregado, no permitir cancelar
    if (row.status === 'delivered') {
        return res.status(409).json({ success: false, error: 'Preorder already delivered' });
    }
    // Ya tiene su venta (transferencia confirmada): se resuelve en el local,
    // anulando la venta. Cancelarlo acá dejaría la venta y su stock colgando.
    if (row.order_kind === 'store' && row.sale_id) {
        return res.status(409).json({ success: false, error: 'Preorder already paid (sale registered in POS)' });
    }

    await turso.execute({
        sql: `UPDATE preorders
              SET status = 'canceled',
                  notes = COALESCE(NULLIF(?, ''), notes),
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [payload.reason || '', row.id],
    });

    // Pedido de la tienda: lo separado vuelve al stock (y la tienda recibe el
    // número nuevo), y el envío que tuviera queda anulado.
    if (row.order_kind === 'store' && row.status !== 'canceled') {
        try {
            const { liberados } = await liberarStockPedido(turso, companyId, row.id);
            const envio = await envioActivoDePedido(turso, companyId, row.id);
            if (envio) {
                await deliveryActions.deliveryStatus(turso, companyId, null, {
                    id: envio.id, status: 'canceled', reason: payload.reason || 'El cliente canceló en la tienda web',
                });
            }
            if (liberados.length) await empujarStockATienda(turso, companyId, liberados.map(x => x.productId));
        } catch (e) {
            console.error(`❌ [preorders] cancelación #${row.id}: no se pudo devolver el stock`, e?.message || e);
        }
    }

    // Historial (migración 0028): que la línea de tiempo distinga una
    // cancelación hecha por el cliente en la tienda web de una hecha en la
    // caja. Sin esto las dos se ven igual, que es justo lo que hizo imposible
    // saber quién canceló el encargo #690. Best-effort.
    try {
        await turso.execute({
            sql: `INSERT INTO preorder_status_history
                    (company_id, preorder_id, from_status, to_status, reason, user_id, user_name, source, created_at)
                  VALUES (?, ?, ?, 'canceled', ?, NULL, ?, 'tienda', ?)`,
            args: [
                companyId, row.id, row.status,
                payload.reason || null,
                'Tienda web (cliente)',
                new Date().toISOString(),
            ],
        });
    } catch (e) {
        console.error('preorder_status_history (tienda):', e?.message || e);
    }

    broadcastPreorderEvent('order.updated', {
        id: row.id,
        external_order_id: payload.external_order_id,
        public_code: row.external_public_code,
        status: 'canceled',
        previous_status: row.status,
        reason: payload.reason || null,
        company_id: companyId,
    });

    return res.status(200).json({
        success: true,
        preorder: {
            id: row.id,
            external_order_id: payload.external_order_id,
            status: 'canceled',
            previous_status: row.status,
        },
    });
}

export default async function handler(req, res) {
    setCorsHeaders(req, res, 'POST, PATCH, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();
    // Multiempresa: con header x-company-id valida la api_key de esa empresa
    // (tienda_config); sin header aplica el contrato legacy (key global + env).
    const auth = await authenticateAndResolveCompany(req);
    if (!auth.ok) {
        console.warn(`⚠️  [preorders] ${req.method} rechazado: credenciales inválidas o ausentes`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`📥 [preorders] ${req.method} recibido (empresa ${auth.companyId})`);
    try {
        if (req.method === 'POST') return await createPreorder(req, res, auth.companyId);
        if (req.method === 'PATCH') return await cancelPreorder(req, res, auth.companyId);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('❌ External preorders API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
