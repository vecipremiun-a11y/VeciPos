import { turso } from './_db.js';
import { encryptPassword } from './_sii.js';

export default async function handler(req, res) {
    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        return res.status(400).json({ error: 'x-company-id header requerido' });
    }

    if (req.method === 'GET') {
        try {
            const result = await turso.execute({
                sql: `SELECT company_id, rut_emisor, razon_social, giro, direccion, comuna, ciudad, acteco,
                             ambiente, sii_resolution_number, sii_resolution_date, auto_emit, is_active,
                             CASE WHEN certificado_pfx IS NOT NULL THEN 1 ELSE 0 END as has_cert,
                             created_at, updated_at
                      FROM sii_config WHERE company_id = ?`,
                args: [companyId]
            });

            if (result.rows.length === 0) {
                return res.status(200).json({ config: null });
            }

            return res.status(200).json({ config: result.rows[0] });
        } catch (e) {
            console.error('Error fetching SII config:', e);
            return res.status(500).json({ error: e.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const data = req.body;
            const now = new Date().toISOString();

            // Validate RUT format
            if (!data.rut_emisor || !/^\d{1,8}-[\dkK]$/i.test(data.rut_emisor)) {
                return res.status(400).json({ error: 'RUT emisor inválido. Formato: 12345678-9' });
            }

            // Check if config exists
            const existing = await turso.execute({
                sql: 'SELECT company_id FROM sii_config WHERE company_id = ?',
                args: [companyId]
            });

            if (existing.rows.length > 0) {
                // Update
                await turso.execute({
                    sql: `UPDATE sii_config SET
                            rut_emisor = ?, razon_social = ?, giro = ?,
                            direccion = ?, comuna = ?, ciudad = ?, acteco = ?,
                            ambiente = ?, sii_resolution_number = ?, sii_resolution_date = ?,
                            auto_emit = ?, is_active = ?, updated_at = ?
                          WHERE company_id = ?`,
                    args: [
                        data.rut_emisor, data.razon_social, data.giro,
                        data.direccion || null, data.comuna || null, data.ciudad || null, data.acteco || null,
                        data.ambiente || 'certificacion', data.sii_resolution_number || null, data.sii_resolution_date || null,
                        data.auto_emit ? 1 : 0, data.is_active ? 1 : 0, now,
                        companyId
                    ]
                });
            } else {
                // Insert
                await turso.execute({
                    sql: `INSERT INTO sii_config
                          (company_id, rut_emisor, razon_social, giro, direccion, comuna, ciudad, acteco,
                           ambiente, sii_resolution_number, sii_resolution_date, auto_emit, is_active, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [
                        companyId, data.rut_emisor, data.razon_social, data.giro,
                        data.direccion || null, data.comuna || null, data.ciudad || null, data.acteco || null,
                        data.ambiente || 'certificacion', data.sii_resolution_number || null, data.sii_resolution_date || null,
                        data.auto_emit ? 1 : 0, data.is_active ? 1 : 0, now, now
                    ]
                });
            }

            return res.status(200).json({ success: true });
        } catch (e) {
            console.error('Error saving SII config:', e);
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
