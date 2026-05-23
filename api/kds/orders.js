// Endpoint pensado para la pantalla KDS de cocina (public/kds.html).
// Devuelve los encargos del día que necesitan producción: pending,
// confirmed, preparing, ready. Excluye delivered y canceled.
// Eje temporal = due_date (matchea con Producción).
//
// Diseñado para ser consumido por navegadores VIEJOS de Smart TV →
// JSON simple, sin streaming, sin headers raros. CORS abierto porque
// la TV podría llamar desde cualquier origen.

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
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const turso = getTurso();
        const day = req.query?.day || new Date().toISOString().slice(0, 10);

        // Resolución de empresa: preferir token secreto (seguro, multiempresa).
        // company_id pelado se acepta solo como fallback (testing local).
        const token = req.query?.token;
        let companyId;
        if (token) {
            const cr = await turso.execute({
                sql: 'SELECT id FROM companies WHERE kds_token = ? LIMIT 1',
                args: [token]
            });
            if (!cr.rows.length) {
                return res.status(403).json({ ok: false, error: 'Token inválido' });
            }
            companyId = cr.rows[0].id;
        } else {
            companyId = req.query?.company_id || req.query?.company;
            if (!companyId) {
                return res.status(400).json({ ok: false, error: 'Falta token' });
            }
        }

        // Pedidos activos del día (due_date) — los que cocina debe ver.
        const ordersRes = await turso.execute({
            sql: `SELECT id, client_name, client_phone, status, due_date, due_time,
                         total_amount, deposit_amount, created_at, notes
                  FROM preorders
                  WHERE company_id = ?
                    AND due_date = ?
                    AND status IN ('pending', 'confirmed', 'preparing', 'ready')
                  ORDER BY due_time ASC, id ASC`,
            args: [companyId, day]
        });

        const orderIds = ordersRes.rows.map(r => r.id);
        let itemsByOrder = {};

        if (orderIds.length > 0) {
            // Una sola query para items de todos los pedidos.
            const placeholders = orderIds.map(() => '?').join(',');
            const itemsRes = await turso.execute({
                sql: `SELECT preorder_id, product_name, qty, unit, billing_unit, note
                      FROM preorder_items
                      WHERE preorder_id IN (${placeholders})
                      ORDER BY id ASC`,
                args: orderIds
            });
            for (const it of itemsRes.rows) {
                if (!itemsByOrder[it.preorder_id]) itemsByOrder[it.preorder_id] = [];
                itemsByOrder[it.preorder_id].push({
                    name: it.product_name,
                    qty: Number(it.qty) || 0,
                    unit: it.unit || 'Und',
                    billing_unit: it.billing_unit || 'unit',
                    note: it.note || null,
                });
            }
        }

        const orders = ordersRes.rows.map(r => ({
            id: r.id,
            client_name: r.client_name || null,
            client_phone: r.client_phone || null,
            status: r.status,
            due_date: r.due_date,
            due_time: r.due_time,
            created_at: r.created_at,
            notes: r.notes || null,
            items: itemsByOrder[r.id] || []
        }));

        return res.status(200).json({
            ok: true,
            day,
            now: new Date().toISOString(),
            orders
        });
    } catch (error) {
        console.error('KDS orders error:', error);
        return res.status(500).json({ ok: false, error: 'Internal error', message: error.message });
    }
}
