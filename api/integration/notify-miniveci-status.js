// Endpoint server-side llamado por el cliente cuando el panadero cambia el estado
// de un encargo originado en miniveci. Reenvía el cambio a miniveci con las
// credenciales del servidor (los secretos no salen al browser).
//
// Las credenciales se leen de `tienda_config` (la misma tabla que ya usa la
// sincronización de productos), por lo que no requiere env vars adicionales.

import { getTiendaConfig, turso, logSync } from './_db.js';

const STATUS_MAP = {
    pending: 'pending',
    confirmed: 'confirmed',
    preparing: 'preparing',
    ready: 'ready',
    out_for_delivery: 'out_for_delivery',
    delivered: 'delivered',
    canceled: 'cancelled', // miniveci usa doble L
};

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

// Al entregar, miniveci necesita el detalle real (no la estimación): kilos/qty
// reales por producto, total real, abono ya pagado, saldo cobrado al entregar y
// con qué medio. Se lee de la DB (server-side) en vez de confiar en el browser.
async function buildDeliveryDetail(preorderId) {
    const prRes = await turso.execute({
        sql: 'SELECT real_total, deposit_amount, total_amount FROM preorders WHERE id = ? LIMIT 1',
        args: [preorderId],
    });
    const pr = prRes.rows?.[0];
    if (!pr) return null;

    const realTotal = Number(pr.real_total ?? pr.total_amount) || 0;
    const depositPaid = Number(pr.deposit_amount) || 0;

    // Pago del saldo final (la diferencia cobrada al entregar) + su medio.
    const finalRes = await turso.execute({
        sql: `SELECT amount, method FROM preorder_payments
              WHERE preorder_id = ? AND type = 'final'
              ORDER BY id DESC LIMIT 1`,
        args: [preorderId],
    });
    const finalRow = finalRes.rows?.[0];
    const balancePaid = finalRow ? (Number(finalRow.amount) || 0) : Math.max(0, realTotal - depositPaid);
    const balanceMethod = finalRow?.method || null;

    const itemsRes = await turso.execute({
        sql: `SELECT product_name, external_product_id, billing_unit,
                     real_qty, real_weight_kg, real_total
              FROM preorder_items WHERE preorder_id = ? ORDER BY id ASC`,
        args: [preorderId],
    });
    const items = (itemsRes.rows || []).map(it => ({
        external_product_id: it.external_product_id || null,
        product_name: it.product_name,
        pricing_mode: it.billing_unit === 'kg' ? 'kg' : 'unit',
        real_qty: Number(it.real_qty) || 0,
        real_weight_kg: it.real_weight_kg != null ? Number(it.real_weight_kg) : null,
        real_total: Number(it.real_total) || 0,
    }));

    return {
        real_total: realTotal,
        deposit_paid: depositPaid,
        balance_paid: balancePaid,
        balance_payment_method: balanceMethod,
        items,
    };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { public_code, status, reason } = parseJsonBody(req);

    if (!public_code) {
        return res.status(400).json({ sent: false, error: 'Missing public_code' });
    }

    const mappedStatus = STATUS_MAP[status];
    if (!mappedStatus) {
        return res.status(400).json({ sent: false, error: `Invalid status: ${status}` });
    }

    // Resolver company_id desde la DB por public_code (no confiar en el cliente)
    const preorderRow = await turso.execute({
        sql: 'SELECT id, company_id, external_order_id FROM preorders WHERE external_public_code = ? LIMIT 1',
        args: [public_code],
    });
    const preorder = preorderRow.rows?.[0];
    if (!preorder) {
        return res.status(404).json({ sent: false, error: 'Preorder not found for public_code' });
    }

    const config = await getTiendaConfig(preorder.company_id);
    if (!config || config.is_active === 0 || !config.api_key || !config.api_secret) {
        return res.status(200).json({
            sent: false,
            reason: 'integration_not_configured',
        });
    }

    // Override solo-local para testing: si está seteado en .env.local, manda el
    // callback ahí en vez de a la tienda_url de la DB (que es compartida con prod).
    // En prod esta env var no existe → usa tienda_url normal.
    const baseUrl = sanitizeBaseUrl(process.env.MINIVECI_BASE_URL_OVERRIDE || config.tienda_url);
    if (!baseUrl) {
        return res.status(200).json({ sent: false, reason: 'tienda_url_missing' });
    }

    const url = `${baseUrl}/api/pos/bakery/orders/${encodeURIComponent(public_code)}/status`;

    // Solo al entregar adjuntamos el detalle real (kilos, total, abono, saldo y
    // medio de pago). Best-effort: si falla la lectura, igual mandamos el estado.
    let deliveryDetail = null;
    if (mappedStatus === 'delivered') {
        try { deliveryDetail = await buildDeliveryDetail(preorder.id); } catch { /* noop */ }
    }

    const body = JSON.stringify({
        status: mappedStatus,
        ...(reason ? { reason } : {}),
        ...(deliveryDetail ? { delivery: deliveryDetail } : {}),
    });

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': config.api_key,
        'x-api-secret': config.api_secret,
        'x-api-consumer-key': config.api_key,
        'x-api-consumer-secret': config.api_secret,
    };

    try {
        const response = await fetch(url, { method: 'PATCH', headers, body });
        const text = await response.text();

        await logSync({
            company_id: preorder.company_id,
            direction: 'pos_to_store',
            event: 'bakery_order.status_updated',
            status: response.ok ? 'ok' : 'error',
            message: response.ok ? 'Estado de encargo enviado a miniveci' : 'Falló envío de estado a miniveci',
            payload: { public_code, status: mappedStatus, reason: reason || null, external_order_id: preorder.external_order_id },
            response: { status: response.status, body: text.slice(0, 500) },
        });

        return res.status(200).json({
            sent: true,
            upstream_status: response.status,
            upstream_ok: response.ok,
            upstream_body: text.slice(0, 500),
        });
    } catch (error) {
        await logSync({
            company_id: preorder.company_id,
            direction: 'pos_to_store',
            event: 'bakery_order.status_updated',
            status: 'error',
            message: 'Error de red al notificar miniveci',
            payload: { public_code, status: mappedStatus, external_order_id: preorder.external_order_id },
            error: error.message,
        });

        return res.status(200).json({
            sent: false,
            reason: 'request_failed',
            error: error.message,
        });
    }
}
