// Endpoint serverless: empuja un encargo presencial de POSVECI a miniveci.
// Lo llama el browser después de createPreorder (presencial) — best-effort,
// no bloquea ni rompe la venta si miniveci todavía no tiene el endpoint o
// la integración no está configurada.
//
// Flujo:
//   1. Lee el preorder + items + cliente desde Turso.
//   2. Skip si:
//        - el preorder vino de la web (external_source = 'miniveci')
//        - ya fue empujado (tiene external_public_code)
//        - la tienda no está configurada / inactiva
//        - el cliente no es identificable (sin external_id ni rut ni teléfono ni email)
//   3. POST a {tienda_url}/api/pos/bakery/orders con identificadores del cliente +
//      items + horario + totales.
//   4. Miniveci responde { public_code, external_order_id }.
//   5. Actualiza el preorder: external_public_code, external_order_id.
//      (No tocamos external_source — queda NULL, esto NO es un encargo que
//      "vino de" miniveci; solo está sincronizado con la cuenta web del cliente.)
//
// Las credenciales (api_key/secret) están en tienda_config y NUNCA salen al
// browser (mismo patrón que notify-miniveci-status).

import { getTiendaConfig, turso, logSync, requireIntegrationSession, sessionIsMemberOf } from './_db.js';

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
}

function parseJsonBody(req) {
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body || {};
}

function sanitizeBaseUrl(url) {
    if (!url) return null;
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Combina due_date 'YYYY-MM-DD' + due_time 'HH:MM' en ISO 8601 local de Chile.
// Miniveci debe parsear como hora local de la panadería. Si esto cambia,
// agregar timezone explícito al payload.
function buildScheduledFor(dueDate, dueTime) {
    if (!dueDate) return null;
    const t = dueTime || '00:00';
    return `${dueDate}T${t}:00`;
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    try {
        // Blindaje: sesión firmada; la membresía se valida tras resolver la
        // empresa dueña del preorder (no se confía en el cliente).
        const session = await requireIntegrationSession(req, res);
        if (!session) return;

        const body = parseJsonBody(req);
        const preorderId = Number(body.preorder_id || body.preorderId);
        if (!preorderId) {
            return res.status(400).json({ ok: false, error: 'Falta preorder_id' });
        }

        // 1. Cargar preorder
        const pr = await turso.execute({
            sql: `SELECT id, company_id, client_id, client_name, client_phone,
                         due_date, due_time, status,
                         total_amount, estimated_total, deposit_amount,
                         delivery_type, delivery_address, notes,
                         external_order_id, external_public_code, external_source,
                         client_email, client_rut, client_external_id,
                         delivery_fee, payment_method
                  FROM preorders WHERE id = ? LIMIT 1`,
            args: [preorderId]
        });
        if (!pr.rows.length) {
            return res.status(404).json({ ok: false, error: 'Preorder no encontrado' });
        }
        const preorder = pr.rows[0];
        const companyId = preorder.company_id;
        if (!(await sessionIsMemberOf(session, companyId))) {
            return res.status(403).json({ ok: false, error: 'No perteneces a esta empresa' });
        }

        // 2. Skips defensivos (no son errores, son no-aplica)
        if (preorder.external_source === 'miniveci') {
            return res.status(200).json({ ok: true, skipped: true, reason: 'from_miniveci' });
        }
        if (preorder.external_public_code) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'already_pushed', public_code: preorder.external_public_code });
        }

        // 3. Cargar cliente para identificadores (rut/email/external_id/phone/name)
        //    Preferir datos de la tabla clients (canónicos) > columnas del preorder.
        let client = {
            external_id: preorder.client_external_id || null,
            rut: preorder.client_rut || null,
            phone: preorder.client_phone || null,
            email: preorder.client_email || null,
            name: preorder.client_name || null,
        };
        if (preorder.client_id) {
            const cr = await turso.execute({
                sql: 'SELECT name, rut, phone, email, external_id FROM clients WHERE id = ? LIMIT 1',
                args: [preorder.client_id]
            });
            const c = cr.rows?.[0];
            if (c) {
                client = {
                    external_id: c.external_id || client.external_id,
                    rut: c.rut || client.rut,
                    phone: c.phone || client.phone,
                    email: c.email || client.email,
                    name: c.name || client.name,
                };
            }
        }

        // Sin identificadores no tiene sentido empujar (miniveci no puede asociarlo)
        const hasIdentifier = !!(client.external_id || client.rut || client.phone || client.email);
        if (!hasIdentifier) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'client_not_identifiable' });
        }

        // 4. Config de integración
        const config = await getTiendaConfig(companyId);
        if (!config || config.is_active === 0 || !config.api_key || !config.api_secret) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'integration_not_configured' });
        }
        const baseUrl = sanitizeBaseUrl(process.env.MINIVECI_BASE_URL_OVERRIDE || config.tienda_url);
        if (!baseUrl) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'tienda_url_missing' });
        }

        // 5. Items
        const itemsRes = await turso.execute({
            sql: `SELECT product_id, product_name, qty, unit, unit_price, line_total, note,
                         billing_unit, price_per_kg, gram_per_unit, external_product_id
                  FROM preorder_items WHERE preorder_id = ? ORDER BY id ASC`,
            args: [preorderId]
        });
        const items = itemsRes.rows.map(it => ({
            product_external_id: it.external_product_id || (it.product_id ? String(it.product_id) : null),
            product_name: it.product_name,
            quantity: Number(it.qty) || 0,
            unit: it.unit || 'Und',
            pricing_mode: it.billing_unit === 'kg' ? 'kg' : 'unit',
            unit_price: Number(it.billing_unit === 'kg' ? it.price_per_kg : it.unit_price) || 0,
            line_subtotal: Number(it.line_total) || 0,
            grams_per_unit: Number(it.gram_per_unit) || 0,
            note: it.note || null,
        }));

        // 6. Payload para miniveci
        const externalOrderId = preorder.external_order_id || `posveci_${preorderId}`;
        const payload = {
            external_order_id: externalOrderId,
            source: 'posveci_presencial',
            client,
            scheduled_for: buildScheduledFor(preorder.due_date, preorder.due_time),
            method: preorder.delivery_type === 'delivery' ? 'delivery' : 'pickup',
            address: preorder.delivery_address || null,
            items,
            subtotal: Number(preorder.estimated_total || preorder.total_amount) || 0,
            delivery_fee: Number(preorder.delivery_fee) || 0,
            total: Number(preorder.total_amount) || 0,
            deposit: Number(preorder.deposit_amount) || 0,
            payment_method: preorder.payment_method || null,
            general_notes: preorder.notes || null,
        };

        const url = `${baseUrl}/api/pos/bakery/orders`;
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': config.api_key,
            'x-api-secret': config.api_secret,
            'x-api-consumer-key': config.api_key,
            'x-api-consumer-secret': config.api_secret,
        };

        // 7. POST best-effort
        let upstream;
        try {
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            const text = await response.text();
            let data = null;
            try { data = JSON.parse(text); } catch { /* respuesta no-JSON */ }
            upstream = { status: response.status, ok: response.ok, text: text.slice(0, 500), data };
        } catch (error) {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'bakery_order.push_presencial',
                status: 'error',
                message: 'Error de red empujando encargo presencial a miniveci',
                payload: { preorder_id: preorderId, external_order_id: externalOrderId },
                error: error.message,
            });
            return res.status(200).json({ ok: false, reason: 'request_failed', error: error.message });
        }

        // 8. Procesar respuesta
        if (!upstream.ok) {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'bakery_order.push_presencial',
                status: 'error',
                message: 'Miniveci respondió error empujando encargo presencial',
                payload: { preorder_id: preorderId, external_order_id: externalOrderId },
                response: { status: upstream.status, body: upstream.text },
            });
            return res.status(200).json({ ok: false, reason: 'upstream_error', upstream_status: upstream.status, body: upstream.text });
        }

        const publicCode = upstream.data?.public_code || upstream.data?.preorder?.public_code || null;
        const upstreamExtOrderId = upstream.data?.external_order_id || externalOrderId;
        // ID único de la cuenta de miniveci con la que quedó asociado el encargo.
        // Solo viene cuando se enlazó a una cuenta REAL (no en guest orders).
        const customerId = upstream.data?.customer_id || upstream.data?.customer?.id || null;

        // 9. Guardar public_code en el preorder → futuros cambios de estado
        //    notificarán automáticamente vía notify-miniveci-status.
        if (publicCode) {
            await turso.execute({
                sql: `UPDATE preorders
                      SET external_public_code = ?,
                          external_order_id = COALESCE(external_order_id, ?),
                          client_external_id = COALESCE(NULLIF(client_external_id, ''), ?),
                          updated_at = datetime('now')
                      WHERE id = ?`,
                args: [publicCode, upstreamExtOrderId, customerId ? String(customerId) : null, preorderId],
            });
        }

        // 9b. Enlace PERMANENTE por ID: si miniveci devolvió el customer_id y el
        //     encargo tiene cliente, guardamos ese ID en el cliente de POSVECI.
        //     Desde ahí, ese cliente queda amarrado a su cuenta web por ID exacto
        //     (los próximos pedidos ya no dependen del match por rut/teléfono/email).
        //     Solo si el cliente aún no tenía external_id (no pisar vínculo previo).
        if (customerId && preorder.client_id) {
            await turso.execute({
                sql: `UPDATE clients
                      SET external_id = COALESCE(NULLIF(external_id, ''), ?)
                      WHERE id = ?`,
                args: [String(customerId), preorder.client_id],
            });
        }

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'bakery_order.push_presencial',
            status: 'ok',
            message: 'Encargo presencial sincronizado con cuenta de miniveci',
            payload: { preorder_id: preorderId, external_order_id: upstreamExtOrderId, customer_id: customerId },
            response: { status: upstream.status, body: upstream.text, public_code: publicCode },
        });

        return res.status(200).json({
            ok: true,
            public_code: publicCode,
            external_order_id: upstreamExtOrderId,
            upstream_status: upstream.status,
        });
    } catch (error) {
        console.error('push-preorder error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
