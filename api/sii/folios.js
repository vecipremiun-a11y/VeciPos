import { turso } from './_db.js';
import { requireCompanySession } from '../_lib/guard.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Sesión firmada + membresía a la empresa (Fase 1 · Paso 6 — blindaje SII)
    const companyId = await requireCompanySession(turso, req, res);
    if (!companyId) return;

    try {
        const result = await turso.execute({
            sql: `SELECT tipo_dte, folio_desde, folio_hasta, folio_actual, estado, created_at
                  FROM sii_cafs
                  WHERE company_id = ? AND estado = 'active'
                  ORDER BY tipo_dte, folio_desde`,
            args: [companyId]
        });

        const folios = result.rows.map(row => ({
            tipo_dte: row.tipo_dte,
            tipo_nombre: row.tipo_dte === 33 ? 'Factura' : row.tipo_dte === 39 ? 'Boleta' : `Tipo ${row.tipo_dte}`,
            folio_desde: row.folio_desde,
            folio_hasta: row.folio_hasta,
            folio_actual: row.folio_actual,
            disponibles: row.folio_hasta - row.folio_actual + 1,
            total: row.folio_hasta - row.folio_desde + 1,
            estado: row.estado,
            created_at: row.created_at,
        }));

        return res.status(200).json({ folios });
    } catch (e) {
        console.error('Error fetching folios:', e);
        return res.status(500).json({ error: e.message });
    }
}
