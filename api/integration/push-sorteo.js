// Endpoint serverless: empuja la config del sorteo de POSVECI a miniveci.
// Lo llama el browser DESPUÉS de guardar el sorteo (página Sorteos) —
// best-effort, no bloquea ni rompe el guardado si miniveci todavía no tiene
// el endpoint o la integración no está configurada.
//
// Flujo (mismo patrón que push-preorder):
//   1. Lee la config del sorteo + el sorteo_token desde Turso (fuente de verdad).
//   2. Skip si la tienda no está configurada / inactiva / sin credenciales.
//   3. POST a {tienda_url}/api/pos/sorteo/config con la config + el token.
//   4. miniveci la guarda en su BD y alimenta su web + app.
//
// Las credenciales (api_key/secret) viven en tienda_config y NUNCA salen al
// browser (mismo patrón que push-preorder / notify-miniveci-status).
//
// La INSCRIPCIÓN no pasa por aquí: miniveci la reenvía directo al endpoint
// público /api/sorteo/register, que valida contra las ventas reales del local.

import { getTiendaConfig, turso, logSync, requireMemberForIntegration } from './_db.js';

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-company-id');
    res.setHeader('Cache-Control', 'no-store');
}

function sanitizeBaseUrl(url) {
    if (!url) return null;
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    try {
        // Blindaje: sesión + membresía (antes cualquiera disparaba el push).
        const companyId = await requireMemberForIntegration(req, res);
        if (!companyId) return;

        // 1. Config del sorteo + token (fuente de verdad: Turso).
        const sr = await turso.execute({
            sql: `SELECT name, draw_date, active, bg_image,
                         field_name, field_phone, field_rut, field_email, field_boleta, field_address,
                         boleta_min_amount, boleta_from_date, updated_at
                  FROM sorteos WHERE company_id = ? LIMIT 1`,
            args: [companyId],
        });
        if (!sr.rows.length) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'no_sorteo_config' });
        }
        const s = sr.rows[0];

        const cr = await turso.execute({
            sql: 'SELECT sorteo_token FROM companies WHERE id = ? LIMIT 1',
            args: [companyId],
        });
        const sorteoToken = cr.rows?.[0]?.sorteo_token || null;
        if (!sorteoToken) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'no_sorteo_token' });
        }

        // 2. Config de integración (URL + credenciales de miniveci de esta empresa).
        const config = await getTiendaConfig(companyId);
        if (!config || config.is_active === 0 || !config.api_key || !config.api_secret) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'integration_not_configured' });
        }
        const baseUrl = sanitizeBaseUrl(process.env.MINIVECI_BASE_URL_OVERRIDE || config.tienda_url);
        if (!baseUrl) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'tienda_url_missing' });
        }

        // 3. Payload con la config del sorteo.
        const payload = {
            source: 'posveci',
            sorteo_token: sorteoToken,
            active: Number(s.active) === 1,
            name: s.name || 'Sorteo',
            draw_date: s.draw_date || null,
            bg_image: s.bg_image || null,
            fields: {
                name: Number(s.field_name) === 1,
                phone: Number(s.field_phone) === 1,
                rut: Number(s.field_rut) === 1,
                email: Number(s.field_email) === 1,
                boleta: Number(s.field_boleta) === 1,
                address: Number(s.field_address) === 1,
            },
            boleta_min_amount: Number(s.boleta_min_amount) || 0,
            boleta_from_date: s.boleta_from_date || null,
            updated_at: s.updated_at || new Date().toISOString(),
        };

        const url = `${baseUrl}/api/pos/sorteo/config`;
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': config.api_key,
            'x-api-secret': config.api_secret,
            'x-api-consumer-key': config.api_key,
            'x-api-consumer-secret': config.api_secret,
        };

        // 4. POST best-effort (no rompe el guardado si falla).
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
                event: 'sorteo.config_push',
                status: 'error',
                message: 'Error de red empujando config de sorteo a miniveci',
                payload: { sorteo_token: sorteoToken, active: payload.active },
                error: error.message,
            });
            return res.status(200).json({ ok: false, reason: 'request_failed', error: error.message });
        }

        if (!upstream.ok) {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'sorteo.config_push',
                status: 'error',
                message: 'Miniveci respondió error al recibir la config de sorteo',
                payload: { sorteo_token: sorteoToken, active: payload.active },
                response: { status: upstream.status, body: upstream.text },
            });
            return res.status(200).json({ ok: false, reason: 'upstream_error', upstream_status: upstream.status, body: upstream.text });
        }

        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'sorteo.config_push',
            status: 'ok',
            message: 'Config de sorteo sincronizada con miniveci',
            payload: { sorteo_token: sorteoToken, active: payload.active, name: payload.name },
            response: { status: upstream.status },
        });

        return res.status(200).json({ ok: true, upstream_status: upstream.status });
    } catch (error) {
        console.error('push-sorteo error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
