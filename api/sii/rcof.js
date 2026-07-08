import { turso } from './_db.js';
import { requireCompanySession } from '../_lib/guard.js';
import { loadCertificado } from './_sii.js';
import { EnviadorSII, DTE } from '@devlas/dte-sii';
import ConsumoFolio from '@devlas/dte-sii/ConsumoFolio.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Sesión firmada + membresía a la empresa (Fase 1 · Paso 6 — blindaje SII)
    const companyId = await requireCompanySession(turso, req, res);
    if (!companyId) return;

    try {
        const { fecha } = req.body;
        const targetDate = fecha || new Date().toISOString().split('T')[0];

        // Check if RCOF already sent for this date
        const existingRcof = await turso.execute({
            sql: `SELECT id, estado FROM sii_rcof WHERE company_id = ? AND fecha = ? AND estado != 'error'`,
            args: [companyId, targetDate]
        });

        if (existingRcof.rows.length > 0) {
            return res.status(409).json({
                error: 'RCOF ya fue enviado para esta fecha',
                estado: existingRcof.rows[0].estado,
            });
        }

        // Load config
        const configRes = await turso.execute({
            sql: 'SELECT * FROM sii_config WHERE company_id = ?',
            args: [companyId]
        });

        if (configRes.rows.length === 0 || !configRes.rows[0].is_active) {
            return res.status(400).json({ error: 'Configuración SII no activa' });
        }

        const siiConfig = configRes.rows[0];
        const cert = loadCertificado(siiConfig);

        // Get all boletas emitted today
        const boletasRes = await turso.execute({
            sql: `SELECT * FROM sii_dtes
                  WHERE company_id = ? AND tipo_dte = 39 AND DATE(created_at) = ?
                  AND estado IN ('sent', 'accepted')
                  ORDER BY folio ASC`,
            args: [companyId, targetDate]
        });

        if (boletasRes.rows.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No hay boletas para este día, RCOF vacío',
                boletas_count: 0,
            });
        }

        // Build RCOF
        const ambiente = siiConfig.ambiente || 'certificacion';
        const rcof = new ConsumoFolio({ certificado: cert });

        // Load CAFs for reconstructing DTEs
        const cafCache = new Map();

        for (const bol of boletasRes.rows) {
            if (bol.xml_firmado) {
                // Use actual XML if available
                const dte = new DTE();
                dte.fromXml(bol.xml_firmado);
                rcof.agregar(dte);
            }
        }

        rcof.setCaratula({
            RutEmisor: siiConfig.rut_emisor,
            FchResol: siiConfig.sii_resolution_date || '2014-08-22',
            NroResol: parseInt(siiConfig.sii_resolution_number) || 0,
            FchInicio: targetDate,
            FchFinal: targetDate,
        });
        rcof.generar();

        // Send to SII
        const enviador = new EnviadorSII(cert, ambiente);
        let trackId = null;
        let estado = 'pending';
        const now = new Date().toISOString();

        try {
            const resultado = await enviador.enviarRcofSoap(rcof);
            trackId = resultado.trackId || resultado.TRACKID || null;
            estado = trackId ? 'sent' : 'error';
            console.log(`📊 RCOF ${targetDate} enviado. TrackID: ${trackId}`);
        } catch (sendErr) {
            console.error('❌ Error enviando RCOF:', sendErr);
            estado = 'error';
        }

        // Save RCOF record
        const rcofXml = rcof.getXML ? rcof.getXML() : null;

        await turso.execute({
            sql: `INSERT INTO sii_rcof (company_id, fecha, xml, track_id, estado, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [companyId, targetDate, rcofXml, trackId, estado, now]
        });

        return res.status(200).json({
            success: estado !== 'error',
            fecha: targetDate,
            track_id: trackId,
            estado,
            boletas_count: boletasRes.rows.length,
        });
    } catch (e) {
        console.error('Error generating RCOF:', e);
        return res.status(500).json({ error: e.message });
    }
}
