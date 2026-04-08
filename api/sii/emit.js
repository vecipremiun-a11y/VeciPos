import { turso } from './_db.js';
import { loadCertificado, loadCAF, buildBoleta, buildFactura, buildFacturaExenta, enviarDTE } from './_sii.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        return res.status(400).json({ error: 'x-company-id header requerido' });
    }

    try {
        const { sale_id, tipo_dte, rut_receptor, razon_social_receptor, giro_receptor, dir_receptor, comuna_receptor, ciudad_receptor, forma_pago, dias_credito } = req.body;

        if (!sale_id) {
            return res.status(400).json({ error: 'sale_id requerido' });
        }

        const tipoDte = tipo_dte || 39; // Default: boleta

        if (![33, 34, 39].includes(tipoDte)) {
            return res.status(400).json({ error: 'tipo_dte debe ser 33 (factura), 34 (factura exenta) o 39 (boleta)' });
        }

        // Factura requires RUT receptor
        if ((tipoDte === 33 || tipoDte === 34) && !rut_receptor) {
            return res.status(400).json({ error: 'RUT receptor requerido para factura' });
        }

        // Check if DTE already exists for this sale
        const existingDte = await turso.execute({
            sql: `SELECT id, folio, estado FROM sii_dtes WHERE company_id = ? AND sale_id = ? AND tipo_dte = ? AND estado != 'error'`,
            args: [companyId, sale_id, tipoDte]
        });

        if (existingDte.rows.length > 0) {
            const existing = existingDte.rows[0];
            return res.status(409).json({
                error: 'Ya existe un DTE para esta venta',
                folio: existing.folio,
                estado: existing.estado,
            });
        }

        // 1. Load SII config
        const configRes = await turso.execute({
            sql: 'SELECT * FROM sii_config WHERE company_id = ?',
            args: [companyId]
        });

        if (configRes.rows.length === 0) {
            return res.status(400).json({ error: 'Configuración SII no encontrada' });
        }

        const siiConfig = configRes.rows[0];

        // Load company timezone
        const companyRes = await turso.execute({
            sql: 'SELECT timezone FROM companies WHERE id = ?',
            args: [companyId]
        });
        const companyTimezone = companyRes.rows[0]?.timezone || 'America/Santiago';

        if (!siiConfig.is_active) {
            return res.status(400).json({ error: 'Facturación electrónica no está activa para esta empresa' });
        }

        if (!siiConfig.certificado_pfx) {
            return res.status(400).json({ error: 'Certificado digital no configurado' });
        }

        // 2. Load certificate
        const cert = loadCertificado(siiConfig);

        // 3. Get active CAF and reserve folio (atomic)
        const cafRes = await turso.execute({
            sql: `SELECT * FROM sii_cafs
                  WHERE company_id = ? AND tipo_dte = ? AND estado = 'active' AND folio_actual <= folio_hasta
                  ORDER BY folio_desde ASC LIMIT 1`,
            args: [companyId, tipoDte]
        });

        if (cafRes.rows.length === 0) {
            return res.status(400).json({ error: `No hay folios disponibles para ${tipoDte === 33 ? 'factura' : tipoDte === 34 ? 'factura exenta' : 'boleta'}. Solicite nuevos folios.` });
        }

        const cafRow = cafRes.rows[0];
        const folio = cafRow.folio_actual;
        const nextFolio = folio + 1;
        const now = new Date().toISOString();

        // Reserve folio atomically
        const updateResult = await turso.execute({
            sql: `UPDATE sii_cafs SET folio_actual = ?, 
                  estado = CASE WHEN ? > folio_hasta THEN 'exhausted' ELSE 'active' END,
                  updated_at = ?
                  WHERE id = ? AND folio_actual = ?`,
            args: [nextFolio, nextFolio, now, cafRow.id, folio]
        });

        if (updateResult.rowsAffected === 0) {
            return res.status(409).json({ error: 'Conflicto de folio, reintente la operación' });
        }

        // 4. Load sale data
        const saleRes = await turso.execute({
            sql: 'SELECT * FROM sales WHERE id = ? AND company_id = ?',
            args: [sale_id, companyId]
        });

        if (saleRes.rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const sale = saleRes.rows[0];
        const items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;

        const saleData = {
            items,
            total: sale.total,
            timezone: companyTimezone,
            rut_receptor: rut_receptor || '66666666-6',
            razon_social_receptor: razon_social_receptor || 'CLIENTE',
            giro_receptor: giro_receptor || '',
            dir_receptor: dir_receptor || '',
            comuna_receptor: comuna_receptor || '',
            ciudad_receptor: ciudad_receptor || '',
            forma_pago: forma_pago || 'contado',
            dias_credito: dias_credito || null,
        };

        // 5. Build and sign DTE
        const caf = loadCAF(cafRow.caf_xml);
        let result;

        if (tipoDte === 39) {
            result = buildBoleta(saleData, siiConfig, folio, caf);
        } else if (tipoDte === 34) {
            result = buildFacturaExenta(saleData, siiConfig, folio, caf);
        } else {
            result = buildFactura(saleData, siiConfig, folio, caf);
        }

        const { dte, montoTotal, montoNeto, montoIva } = result;
        dte.firmar(cert);

        // 6. Send to SII
        let trackId = null;
        let estado = 'pending';
        let siiResponse = null;

        try {
            const envioResult = await enviarDTE(dte, siiConfig, cert, tipoDte);
            trackId = envioResult.trackId || envioResult.TRACKID || null;
            estado = trackId ? 'sent' : 'error';
            siiResponse = JSON.stringify(envioResult);

            console.log(`📄 DTE ${tipoDte} Folio ${folio} enviado. TrackID: ${trackId}`);
            if (!trackId) {
                console.error(`⚠️ SII respuesta sin TrackID:`, JSON.stringify(envioResult, null, 2));
            }
        } catch (sendErr) {
            console.error(`❌ Error enviando DTE al SII:`, sendErr);
            estado = 'error';
            siiResponse = JSON.stringify({ error: sendErr.message });
        }

        // 7. Save DTE record
        const xmlFirmado = dte.getXML ? dte.getXML() : null;

        await turso.execute({
            sql: `INSERT INTO sii_dtes
                  (company_id, sale_id, tipo_dte, folio, rut_receptor, razon_social_receptor,
                   monto_total, monto_neto, monto_iva, xml_firmado, track_id, estado, sii_response, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                companyId, sale_id, tipoDte, folio,
                saleData.rut_receptor, saleData.razon_social_receptor,
                montoTotal, montoNeto, montoIva,
                xmlFirmado, trackId, estado, siiResponse,
                now, now
            ]
        });

        return res.status(200).json({
            success: estado !== 'error',
            folio,
            tipo_dte: tipoDte,
            track_id: trackId,
            estado,
            monto_total: montoTotal,
        });
    } catch (e) {
        console.error('Error emitting DTE:', e);
        return res.status(500).json({ error: e.message });
    }
}
