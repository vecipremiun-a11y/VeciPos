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
            sql: 'SELECT status, company_id FROM preorders WHERE id = ? LIMIT 1',
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

        return res.status(200).json({ ok: true, status: trans.to });
    } catch (error) {
        console.error('KDS update-status error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
