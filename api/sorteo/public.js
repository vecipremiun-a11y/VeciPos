// Endpoint público de la página de inscripción al sorteo (public/sorteo.html).
// Devuelve la configuración del sorteo de una empresa, resuelta por token
// secreto (companies.sorteo_token) → multiempresa seguro, sin exponer ids.
//
// Mismo patrón que /api/kds/orders: JSON simple, CORS abierto, sin auth de
// usuario (lo consume cualquier visitante anónimo). Solo expone datos que el
// formulario necesita; nunca participantes ni datos sensibles.

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const token = req.query?.token;
        if (!token) return res.status(400).json({ ok: false, error: 'Falta token' });

        const turso = getTurso();

        // Resolver empresa por token secreto.
        const cr = await turso.execute({
            sql: 'SELECT id, name FROM companies WHERE sorteo_token = ? LIMIT 1',
            args: [token],
        });
        if (!cr.rows.length) {
            return res.status(404).json({ ok: false, error: 'Sorteo no encontrado' });
        }
        const companyId = cr.rows[0].id;
        const companyName = cr.rows[0].name;

        // Config del sorteo (puede no existir aún → sin sorteo activo).
        const sr = await turso.execute({
            sql: `SELECT name, draw_date, active, bg_image,
                         field_name, field_phone, field_rut,
                         field_email, field_boleta, field_address,
                         boleta_min_amount
                  FROM sorteos WHERE company_id = ? LIMIT 1`,
            args: [companyId],
        });

        if (!sr.rows.length || Number(sr.rows[0].active) !== 1) {
            return res.status(200).json({
                ok: true,
                active: false,
                company_name: companyName,
            });
        }

        const s = sr.rows[0];

        // Conteo de participantes (prueba social: "X vecinos ya participan").
        const cnt = await turso.execute({
            sql: 'SELECT COUNT(*) AS n FROM sorteo_participants WHERE company_id = ?',
            args: [companyId],
        });

        return res.status(200).json({
            ok: true,
            active: true,
            company_name: companyName,
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
            participant_count: Number(cnt.rows[0]?.n) || 0,
        });
    } catch (error) {
        console.error('Sorteo public error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
