// GET /api/sii/reserved-folios?tipo_dte=39&user_id=...
// Lista los folios pre-reservados disponibles para esta empresa (status=reserved).
// Permite al cliente sincronizar Dexie con la verdad del servidor.

import { turso } from './_db.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        return res.status(400).json({ error: 'x-company-id header requerido' });
    }

    try {
        const tipoDte = req.query?.tipo_dte ? Number(req.query.tipo_dte) : null;
        const userId = req.query?.user_id || null;

        let sql = `SELECT id, tipo_dte, folio, caf_id, reserved_for_user_id, status, reserved_at
                   FROM sii_offline_folios
                   WHERE company_id = ? AND status = 'reserved'`;
        const args = [companyId];
        if (tipoDte) { sql += ' AND tipo_dte = ?'; args.push(tipoDte); }
        if (userId) { sql += ' AND (reserved_for_user_id = ? OR reserved_for_user_id IS NULL)'; args.push(userId); }
        sql += ' ORDER BY tipo_dte, folio';

        const result = await turso.execute({ sql, args });

        return res.status(200).json({
            folios: result.rows.map(r => ({
                id: r.id,
                tipo_dte: r.tipo_dte,
                folio: r.folio,
                caf_id: r.caf_id,
                reserved_for_user_id: r.reserved_for_user_id,
                reserved_at: r.reserved_at,
            })),
            total: result.rows.length,
        });
    } catch (e) {
        console.error('Error reserved-folios:', e);
        return res.status(500).json({ error: e.message });
    }
}
