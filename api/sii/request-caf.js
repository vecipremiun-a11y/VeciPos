import { turso } from './_db.js';
import { decryptPassword } from './_sii.js';
import { CafSolicitor, CAF, createCafFingerprint } from '@devlas/dte-sii';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Intenta extraer un mensaje de error legible del HTML que devuelve el SII
 * cuando la solicitud de CAF falla (ej: "Usted no está autorizado",
 * "Excede tope autorizado", "Debe completar el proceso de certificación", etc).
 */
function extractSiiError(html = '') {
    if (!html || typeof html !== 'string') return null;
    // Quitar tags y normalizar whitespace
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // Patrones comunes que el SII usa para errores
    const patterns = [
        /(usted no est[áa] autorizad[oa][^.]*)/i,
        /(no est[áa] autorizad[oa] [^.]*)/i,
        /(debe completar [^.]*certificaci[óo]n[^.]*)/i,
        /(excede [^.]*tope[^.]*)/i,
        /(no puede solicitar [^.]*)/i,
        /(no existe[^.]*)/i,
        /(error[:\s][^.]{5,200})/i,
        /(rechazo[^.]*)/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m) return m[1].trim().slice(0, 300);
    }
    // Si nada matchea, devolver primeros 300 chars no vacíos
    if (text.length > 30) return text.slice(0, 300);
    return null;
}

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

        // Validación específica para facturas afectas: el SII exige que el
        // contribuyente tenga giro/acteco registrado y haya completado la
        // certificación de facturas. Damos un aviso temprano.
        if (tipo_dte === 33 && !siiConfig.acteco) {
            console.warn('[request-caf] Solicitando factura (33) sin código de actividad económica configurado.');
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
        if (cantidadesToIntentar[0] > 10) cantidadesToIntentar.push(10);
        if (cantidadesToIntentar[cantidadesToIntentar.length - 1] > 1) cantidadesToIntentar.push(1);

        let cafResult = null;
        let lastDebugDir = null;
        for (const cant of cantidadesToIntentar) {
            console.log(`[request-caf] Intentando tipo_dte=${tipo_dte}, cantidad=${cant}`);
            cafResult = await solicitor.solicitar({
                tipoDte: tipo_dte,
                cantidad: cant,
            });
            console.log(`[request-caf] Resultado:`, JSON.stringify({ success: cafResult?.success, error: cafResult?.error, hasXml: !!cafResult?.xml }));
            // Recordar el último directorio de debug para parsear su HTML si fallamos
            try {
                lastDebugDir = solicitor._getDebugDir(tipo_dte);
            } catch { /* noop */ }
            if (cafResult?.success && cafResult?.xml) break;
            if (cafResult?.error?.includes('No se obtuvo CAF')) {
                console.log(`[request-caf] Reintentando con cantidad menor...`);
                continue;
            }
            break;
        }

        if (!cafResult || !cafResult.success || !cafResult.xml) {
            // Intentar leer el HTML final del SII para extraer mensaje real
            let siiMessage = null;
            if (lastDebugDir) {
                try {
                    const finalHtmlPath = path.join(lastDebugDir, 'caf-final.html');
                    if (fs.existsSync(finalHtmlPath)) {
                        const html = fs.readFileSync(finalHtmlPath, 'utf-8');
                        siiMessage = extractSiiError(html);
                    }
                } catch (readErr) {
                    console.warn('[request-caf] No se pudo leer caf-final.html:', readErr.message);
                }
            }

            const baseError = cafResult?.error || 'No se pudo obtener CAF del SII';
            // Pista contextual para tipo_dte 33/34
            let hint = null;
            if (tipo_dte === 33 || tipo_dte === 34) {
                hint = 'Verifica que el contribuyente esté autorizado por el SII para emitir facturas electrónicas (proceso de certificación distinto al de boletas) y que tenga registrado el giro/código de actividad económica.';
            }
            return res.status(500).json({
                error: baseError,
                sii_message: siiMessage,
                hint,
                tipo_dte,
                ambiente,
            });
        }

        // Parse CAF to extract range
        const caf = new CAF(cafResult.xml);
        const folioDesde = caf.getFolioDesde();
        const folioHasta = caf.getFolioHasta();
        const fingerprint = createCafFingerprint(cafResult.xml);

        const now = new Date().toISOString();

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
        if (tmpPfxPath) {
            try { fs.unlinkSync(tmpPfxPath); } catch (_) {}
        }
    }
}
