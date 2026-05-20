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
        sql: 'SELECT company_id, external_order_id FROM preorders WHERE external_public_code = ? LIMIT 1',
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
    const body = JSON.stringify({
        status: mappedStatus,
        ...(reason ? { reason } : {}),
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
