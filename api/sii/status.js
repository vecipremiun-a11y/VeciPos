import { turso } from './_db.js';
import { loadCertificado, consultarEstado } from './_sii.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        return res.status(400).json({ error: 'x-company-id header requerido' });
    }

    const dteId = req.query?.dte_id;
    const trackId = req.query?.track_id;

    if (!dteId && !trackId) {
        return res.status(400).json({ error: 'Se requiere dte_id o track_id' });
    }

    try {
        // Find DTE
        let dteRow;
        if (dteId) {
            const result = await turso.execute({
                sql: 'SELECT * FROM sii_dtes WHERE id = ? AND company_id = ?',
                args: [dteId, companyId]
            });
            dteRow = result.rows[0];
        } else {
            const result = await turso.execute({
                sql: 'SELECT * FROM sii_dtes WHERE track_id = ? AND company_id = ?',
                args: [trackId, companyId]
            });
            dteRow = result.rows[0];
        }

        if (!dteRow) {
            return res.status(404).json({ error: 'DTE no encontrado' });
        }

        if (!dteRow.track_id) {
            return res.status(200).json({
                estado: dteRow.estado,
                message: 'DTE no tiene track_id (no fue enviado al SII)',
            });
        }

        // Load config and cert
        const configRes = await turso.execute({
            sql: 'SELECT * FROM sii_config WHERE company_id = ?',
            args: [companyId]
        });

        if (configRes.rows.length === 0) {
            return res.status(400).json({ error: 'Configuración SII no encontrada' });
        }

        const siiConfig = configRes.rows[0];
        const cert = loadCertificado(siiConfig);

        // Query SII
        const estadoResult = await consultarEstado(dteRow.track_id, siiConfig, cert);

        // Interpret result
        let nuevoEstado = dteRow.estado;
        const estadoSii = estadoResult.estado || estadoResult.ESTADO || '';

        if (['EPR', 'RPR'].includes(estadoSii)) {
            nuevoEstado = 'accepted';
        } else if (['RSC', 'RFR', 'RCT'].includes(estadoSii)) {
            nuevoEstado = 'rejected';
        } else if (['DOK'].includes(estadoSii)) {
            nuevoEstado = 'accepted';
        } else if (['FAU', 'FNA', 'FAN', 'AND', 'ANC', 'EMP'].includes(estadoSii)) {
            nuevoEstado = 'rejected';
        }
        // REC, SOK, FOK, CRT, PRD, PDR = still processing

        const now = new Date().toISOString();

        // Update if changed
        if (nuevoEstado !== dteRow.estado) {
            await turso.execute({
                sql: 'UPDATE sii_dtes SET estado = ?, sii_response = ?, updated_at = ? WHERE id = ?',
                args: [nuevoEstado, JSON.stringify(estadoResult), now, dteRow.id]
            });
        }

        return res.status(200).json({
            dte_id: dteRow.id,
            folio: dteRow.folio,
            tipo_dte: dteRow.tipo_dte,
            track_id: dteRow.track_id,
            estado_anterior: dteRow.estado,
            estado: nuevoEstado,
            sii_response: estadoResult,
        });
    } catch (e) {
        console.error('Error checking DTE status:', e);
        return res.status(500).json({ error: e.message });
    }
}
