import { turso } from './_db.js';
import { decryptPassword } from './_sii.js';
import { CafSolicitor, CAF, createCafFingerprint } from '@devlas/dte-sii';
import fs from 'fs';
import os from 'os';
import path from 'path';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        return res.status(400).json({ error: 'x-company-id header requerido' });
    }

    let tmpPfxPath = null;

    try {
        const { tipo_dte, cantidad } = req.body;

        if (!tipo_dte || ![33, 34, 39].includes(tipo_dte)) {
            return res.status(400).json({ error: 'tipo_dte debe ser 33, 34 o 39' });
        }

        // Load SII config
        const configRes = await turso.execute({
            sql: 'SELECT * FROM sii_config WHERE company_id = ?',
            args: [companyId]
        });

        if (configRes.rows.length === 0) {
            return res.status(400).json({ error: 'Configuración SII no encontrada' });
        }

        const siiConfig = configRes.rows[0];

        if (!siiConfig.certificado_pfx || !siiConfig.certificado_password) {
            return res.status(400).json({ error: 'Certificado digital no configurado' });
        }

        const pfxBuffer = Buffer.from(siiConfig.certificado_pfx, 'base64');
        const pfxPassword = decryptPassword(siiConfig.certificado_password);
        const ambiente = siiConfig.ambiente || 'certificacion';

        // Write .pfx to temp file (CafSolicitor requires file path)
        tmpPfxPath = path.join(os.tmpdir(), `poskem_cert_${companyId}_${Date.now()}.pfx`);
        fs.writeFileSync(tmpPfxPath, pfxBuffer);

        const solicitor = new CafSolicitor({
            ambiente,
            rutEmisor: siiConfig.rut_emisor,
            pfxPath: tmpPfxPath,
            pfxPassword,
            baseDir: os.tmpdir(),
        });

        // Intentar con la cantidad solicitada, luego reducir si el SII limita
        const cantidadesToIntentar = [cantidad || 50];
        // Agregar cantidades menores como fallback
        if (cantidadesToIntentar[0] > 10) cantidadesToIntentar.push(10);
        if (cantidadesToIntentar[cantidadesToIntentar.length - 1] > 1) cantidadesToIntentar.push(1);

        let cafResult = null;
        for (const cant of cantidadesToIntentar) {
            console.log(`[request-caf] Intentando tipo_dte=${tipo_dte}, cantidad=${cant}`);
            cafResult = await solicitor.solicitar({
                tipoDte: tipo_dte,
                cantidad: cant,
            });
            console.log(`[request-caf] Resultado:`, JSON.stringify({ success: cafResult?.success, error: cafResult?.error, hasXml: !!cafResult?.xml }));
            if (cafResult?.success && cafResult?.xml) break;
            // Si el error es de cantidad máxima, reducir
            if (cafResult?.error?.includes('No se obtuvo CAF')) {
                console.log(`[request-caf] Reintentando con cantidad menor...`);
                continue;
            }
            break; // Otro tipo de error, no reintentar
        }

        if (!cafResult || !cafResult.success || !cafResult.xml) {
            return res.status(500).json({
                error: cafResult?.error || 'No se pudo obtener CAF del SII',
            });
        }

        // Parse CAF to extract range
        const caf = new CAF(cafResult.xml);
        const folioDesde = caf.getFolioDesde();
        const folioHasta = caf.getFolioHasta();
        const fingerprint = createCafFingerprint(cafResult.xml);

        const now = new Date().toISOString();

        // Save CAF to DB
        await turso.execute({
            sql: `INSERT INTO sii_cafs (company_id, tipo_dte, folio_desde, folio_hasta, folio_actual, caf_xml, caf_fingerprint, estado, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            args: [companyId, tipo_dte, folioDesde, folioHasta, folioDesde, cafResult.xml, fingerprint, now, now]
        });

        return res.status(200).json({
            success: true,
            folio_desde: folioDesde,
            folio_hasta: folioHasta,
            cantidad: folioHasta - folioDesde + 1,
        });
    } catch (e) {
        console.error('Error requesting CAF:', e);
        return res.status(500).json({ error: e.message });
    } finally {
        // Clean up temp file
        if (tmpPfxPath) {
            try { fs.unlinkSync(tmpPfxPath); } catch (_) {}
        }
    }
}
