// Endpoint público de inscripción al sorteo (POST desde public/sorteo.html).
// Recibe los datos del visitante anónimo, valida según los campos que la
// empresa marcó como obligatorios y registra al participante con un número
// de ticket único. Resuelve la empresa por token secreto (multiempresa).
//
// Anti-duplicado: "una boleta = una inscripción" (índice único parcial en
// sorteo_participants). Si la boleta ya existe → error amable, sin 500.

import { createClient } from '@libsql/client';
import { fromZonedTime } from 'date-fns-tz';

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

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const body = req.body || {};
        const token = clean(body.token, 80);
        if (!token) return res.status(400).json({ ok: false, error: 'Falta token' });

        const turso = getTurso();

        // Resolver empresa + config en una sola ida.
        const cr = await turso.execute({
            sql: 'SELECT id, timezone FROM companies WHERE sorteo_token = ? LIMIT 1',
            args: [token],
        });
        if (!cr.rows.length) {
            return res.status(404).json({ ok: false, error: 'Sorteo no encontrado' });
        }
        const companyId = cr.rows[0].id;
        const companyTz = cr.rows[0].timezone || 'America/Santiago';

        const sr = await turso.execute({
            sql: `SELECT active, field_name, field_phone, field_rut,
                         field_email, field_boleta, field_address,
                         boleta_min_amount, boleta_from_date
                  FROM sorteos WHERE company_id = ? LIMIT 1`,
            args: [companyId],
        });
        if (!sr.rows.length || Number(sr.rows[0].active) !== 1) {
            return res.status(403).json({ ok: false, error: 'El sorteo no está activo' });
        }
        const cfg = sr.rows[0];

        // Recoger solo los campos habilitados; validar los obligatorios.
        const data = {
            name: clean(body.name),
            phone: clean(body.phone, 40),
            rut: clean(body.rut, 20),
            email: clean(body.email),
            boleta: clean(body.boleta, 40),
            address: clean(body.address, 300),
        };
        const map = [
            ['name', 'field_name', 'el nombre'],
            ['phone', 'field_phone', 'el celular'],
            ['rut', 'field_rut', 'el RUT'],
            ['email', 'field_email', 'el correo'],
            ['boleta', 'field_boleta', 'el N° de boleta'],
            ['address', 'field_address', 'la dirección'],
        ];
        for (const [key, flag, label] of map) {
            const enabled = Number(cfg[flag]) === 1;
            if (!enabled) {
                data[key] = ''; // ignorar lo que no se pide
            } else if (!data[key]) {
                return res.status(400).json({ ok: false, error: `Falta ${label}` });
            }
        }

        // Normalizar el N° de boleta a solo dígitos: el cliente puede teclear
        // el número con o sin separadores. Lo guardamos normalizado para que el
        // N° de participante y el dedup usen el mismo número limpio.
        let boletaDigits = '';
        if (Number(cfg.field_boleta) === 1) {
            boletaDigits = data.boleta.replace(/\D/g, '');
            if (!boletaDigits) {
                return res.status(400).json({ ok: false, error: 'N° de boleta inválido' });
            }
            data.boleta = boletaDigits;
        }

        // ── Regla: validar la boleta contra la venta real ──────────────────
        // Solo si el sorteo pide boleta Y definió un monto mínimo (>0).
        // El cliente escribe el folio SII (boleta electrónica) o el N° de la
        // boleta interna (= id de la venta). Verificamos venta real, no anulada,
        // que cumpla el monto y sea del período del sorteo.
        let saleId = null;
        const minAmount = Number(cfg.boleta_min_amount) || 0;
        if (boletaDigits && minAmount > 0) {
            const num = Number(boletaDigits);

            // 1) Folio SII (boleta afecta 39 / exenta 41).
            let sale = null;
            const f = await turso.execute({
                sql: `SELECT s.id AS sale_id, s.total AS total, s.date AS date, s.status AS status
                      FROM sii_dtes d JOIN sales s ON s.id = d.sale_id
                      WHERE d.company_id = ? AND d.folio = ? AND d.tipo_dte IN (39, 41)
                      LIMIT 1`,
                args: [companyId, num],
            });
            if (f.rows.length) sale = f.rows[0];

            // 2) Venta sin SII: el N° de boleta es el id de la venta.
            if (!sale) {
                const r = await turso.execute({
                    sql: `SELECT id AS sale_id, total, date, status
                          FROM sales WHERE company_id = ? AND id = ? LIMIT 1`,
                    args: [companyId, num],
                });
                if (r.rows.length) sale = r.rows[0];
            }

            if (!sale) {
                return res.status(404).json({ ok: false, error: 'No encontramos esa boleta. Revisa el número.' });
            }
            if (String(sale.status) === 'cancelled') {
                return res.status(409).json({ ok: false, error: 'Esa boleta está anulada.' });
            }
            if (Number(sale.total) < minAmount) {
                const fmt = '$' + Math.round(minAmount).toLocaleString('es-CL');
                return res.status(400).json({ ok: false, error: `Tu boleta debe ser de al menos ${fmt} para participar.` });
            }
            // Comparar contra la medianoche LOCAL de la empresa, no el string
            // UTC: una venta del 7 a las 23:00 en Chile se guarda como 08T03:00Z
            // y un < lexicográfico la daría por válida erróneamente.
            const fromDate = clean(cfg.boleta_from_date, 30);
            if (fromDate) {
                const cutoff = fromZonedTime(`${fromDate}T00:00:00`, companyTz);
                if (!sale.date || new Date(sale.date) < cutoff) {
                    return res.status(400).json({ ok: false, error: 'Esa boleta no corresponde al período del sorteo.' });
                }
            }
            saleId = sale.sale_id;
        }

        // N° de participante = N° de boleta (si el sorteo lo pide). Así el
        // cliente reconoce su número. Si no se pide boleta, generamos uno
        // aleatorio único por empresa.
        let ticket;
        if (boletaDigits) {
            ticket = Number(boletaDigits);
        } else {
            ticket = null;
            for (let i = 0; i < 8; i++) {
                const candidate = 1000 + Math.floor(Math.random() * 9000);
                const dup = await turso.execute({
                    sql: 'SELECT 1 FROM sorteo_participants WHERE company_id = ? AND ticket_number = ? LIMIT 1',
                    args: [companyId, candidate],
                });
                if (!dup.rows.length) { ticket = candidate; break; }
            }
            if (ticket == null) {
                ticket = Number(String(Date.now()).slice(-4));
            }
        }

        const nowIso = new Date().toISOString();
        try {
            await turso.execute({
                sql: `INSERT INTO sorteo_participants
                        (company_id, ticket_number, name, phone, rut, email, boleta, address, sale_id, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    companyId, ticket,
                    data.name || null, data.phone || null, data.rut || null,
                    data.email || null, data.boleta || null, data.address || null,
                    saleId, nowIso,
                ],
            });
        } catch (e) {
            // Choque con índice único (boleta repetida o misma venta) → inscripción repetida.
            if (String(e?.message || '').toLowerCase().includes('unique')) {
                return res.status(409).json({ ok: false, error: 'Esa boleta ya está inscrita en el sorteo' });
            }
            throw e;
        }

        return res.status(200).json({ ok: true, ticket_number: ticket });
    } catch (error) {
        console.error('Sorteo register error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
