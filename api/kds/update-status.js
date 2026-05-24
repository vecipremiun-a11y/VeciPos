// Endpoint para que la pantalla KDS de cocina mueva un pedido al siguiente
// estado de su flujo de producción.
//
// Transiciones PERMITIDAS desde la cocina:
//   pending    → confirmed
//   confirmed  → preparing
//   preparing  → ready
// Después de "ready" la cocina terminó; la entrega/cobro la hacen las
// vendedoras desde el sistema de Encargos (POS) — el KDS NO debe poder
// marcar delivered ni canceled.
//
// Seguridad: requiere token de KDS. El preorder debe pertenecer a la misma
// empresa que el token. Si el estado actual no coincide con la transición
// solicitada → 409 (alguien ya lo cambió, race condition o pedido viejo).

import { createClient } from '@libsql/client';
import { getTiendaConfig, logSync } from '../integration/_db.js';

// Notifica a miniveci el cambio de estado de un encargo que está sincronizado
// con la web (tiene external_public_code). Best-effort: si falla, no rompe la
// acción del KDS. Mismo destino/headers que notify-miniveci-status.js.
const MINIVECI_STATUS_MAP = { confirmed: 'confirmed', preparing: 'preparing', ready: 'ready' };
async function notifyMiniveci(companyId, publicCode, status) {
    try {
        const mapped = MINIVECI_STATUS_MAP[status];
        if (!publicCode || !mapped) return;
        const config = await getTiendaConfig(companyId);
        if (!config || config.is_active === 0 || !config.api_key || !config.api_secret) return;
        let baseUrl = process.env.MINIVECI_BASE_URL_OVERRIDE || config.tienda_url;
        if (!baseUrl) return;
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        const url = `${baseUrl}/api/pos/bakery/orders/${encodeURIComponent(publicCode)}/status`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.api_key,
                'x-api-secret': config.api_secret,
                'x-api-consumer-key': config.api_key,
                'x-api-consumer-secret': config.api_secret,
            },
            body: JSON.stringify({ status: mapped }),
        });
        const text = await response.text();
        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'bakery_order.status_updated',
            status: response.ok ? 'ok' : 'error',
            message: response.ok ? 'Estado enviado a miniveci (desde KDS)' : 'Falló envío de estado a miniveci (desde KDS)',
            payload: { public_code: publicCode, status: mapped, via: 'kds' },
            response: { status: response.status, body: text.slice(0, 300) },
        });
    } catch (e) {
        try {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'bakery_order.status_updated',
                status: 'error',
                message: 'Error de red notificando estado a miniveci (desde KDS)',
                payload: { public_code: publicCode, status, via: 'kds' },
                error: e.message,
            });
        } catch { /* noop */ }
    }
}

let _client = null;
function getTurso() {
    if (_client) return _client;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
        throw new Error('Faltan variables Turso: VITE_TURSO_DATABASE_URL o VITE_TURSO_AUTH_TOKEN');
    }
    _client = createClient({ url, authToken });
    return _client;
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
}

// action → { from (estado requerido), to (estado destino) }
const TRANSITIONS = {
    confirm: { from: 'pending', to: 'confirmed' },
    start:   { from: 'confirmed', to: 'preparing' },
    ready:   { from: 'preparing', to: 'ready' },
};

function parseBody(req) {
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body || {};
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const turso = getTurso();
        const body = parseBody(req);
        const token = body.token;
        const preorderId = Number(body.preorder_id || body.preorderId);
        const action = body.action;

        if (!token) return res.status(400).json({ ok: false, error: 'Falta token' });
        if (!preorderId) return res.status(400).json({ ok: false, error: 'Falta preorder_id' });
        const trans = TRANSITIONS[action];
        if (!trans) return res.status(400).json({ ok: false, error: 'Acción inválida' });

        // Validar token → companyId
        const cr = await turso.execute({
            sql: 'SELECT id FROM companies WHERE kds_token = ? LIMIT 1',
            args: [token]
        });
        if (!cr.rows.length) return res.status(403).json({ ok: false, error: 'Token inválido' });
        const companyId = cr.rows[0].id;

        // Verificar que el pedido pertenece a esa empresa y está en el estado esperado
        const pr = await turso.execute({
            sql: 'SELECT status, company_id, external_public_code FROM preorders WHERE id = ? LIMIT 1',
            args: [preorderId]
        });
        if (!pr.rows.length) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
        if (pr.rows[0].company_id !== companyId) {
            return res.status(403).json({ ok: false, error: 'Pedido de otra empresa' });
        }
        if (pr.rows[0].status !== trans.from) {
            return res.status(409).json({
                ok: false, error: 'Estado actual no coincide',
                currentStatus: pr.rows[0].status, expected: trans.from
            });
        }

        // Actualizar estado
        await turso.execute({
            sql: `UPDATE preorders SET status = ?, updated_at = datetime('now') WHERE id = ?`,
            args: [trans.to, preorderId]
        });

        // Si está sincronizado con la web (tiene public_code), notificar a
        // miniveci el cambio de estado. Best-effort: no bloquea la respuesta.
        const publicCode = pr.rows[0].external_public_code;
        if (publicCode) {
            await notifyMiniveci(companyId, publicCode, trans.to);
        }

        return res.status(200).json({ ok: true, status: trans.to });
    } catch (error) {
        console.error('KDS update-status error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
