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

async function resolveProductId(externalProductId, productName, companyId) {
    if (!externalProductId) return 0;
    try {
        const r = await turso.execute({
            sql: `SELECT id FROM products
                  WHERE company_id = ?
                    AND (CAST(id AS TEXT) = ? OR sku = ? OR external_id = ?)
                  LIMIT 1`,
            args: [companyId, String(externalProductId), String(externalProductId), String(externalProductId)],
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
    // preorder_payments; cancelar no mueve caja). Contra entrega ('contra_entrega')
    // queda con saldo = total, igual que un encargo: se cobra al entregar.
    const paidOnline = orderKind === 'store'
        && String(payload.payment_method || 'online').toLowerCase() !== 'contra_entrega';
    const depositAmount = paidOnline ? total : 0;
    const remainingAmount = paidOnline ? 0 : total;

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
              VALUES (?, ?, ?, ?, ?, ?, 'pending',
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

        await turso.execute({
            sql: `INSERT INTO preorder_items
                  (preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
                   billing_unit, price_per_kg, gram_per_unit, estimated_total, external_product_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
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
            ],
        });
    }

    const out = {
        id: preorderId,
        external_order_id: preorder.external_order_id,
        public_code: preorder.external_public_code,
        status: 'pending',
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

    await turso.execute({
        sql: `UPDATE preorders
              SET status = 'canceled',
                  notes = COALESCE(NULLIF(?, ''), notes),
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [payload.reason || '', row.id],
    });

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
