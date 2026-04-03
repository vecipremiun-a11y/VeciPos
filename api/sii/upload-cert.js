import { turso } from './_db.js';
import { encryptPassword } from './_sii.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        return res.status(400).json({ error: 'x-company-id header requerido' });
    }

    try {
        const { pfx_base64, password } = req.body;

        if (!pfx_base64 || !password) {
            return res.status(400).json({ error: 'Se requiere pfx_base64 y password' });
        }

        // Validate it's valid base64
        try {
            const buffer = Buffer.from(pfx_base64, 'base64');
            if (buffer.length < 100) {
                return res.status(400).json({ error: 'Archivo .pfx inválido o muy pequeño' });
            }
        } catch {
            return res.status(400).json({ error: 'Base64 inválido' });
        }

        // Validate that the certificate can be loaded
        try {
            const { Certificado } = await import('@devlas/dte-sii');
            const pfxBuffer = Buffer.from(pfx_base64, 'base64');
            new Certificado(pfxBuffer, password);
        } catch (certErr) {
            return res.status(400).json({ error: `Certificado inválido o contraseña incorrecta: ${certErr.message}` });
        }

        const encryptedPassword = encryptPassword(password);
        const now = new Date().toISOString();

        // Check if config exists
        const existing = await turso.execute({
            sql: 'SELECT company_id FROM sii_config WHERE company_id = ?',
            args: [companyId]
        });

        if (existing.rows.length > 0) {
            await turso.execute({
                sql: `UPDATE sii_config SET certificado_pfx = ?, certificado_password = ?, updated_at = ? WHERE company_id = ?`,
                args: [pfx_base64, encryptedPassword, now, companyId]
            });
        } else {
            return res.status(400).json({ error: 'Primero configure los datos de la empresa (RUT, razón social, etc.)' });
        }

        return res.status(200).json({ success: true, message: 'Certificado cargado correctamente' });
    } catch (e) {
        console.error('Error uploading certificate:', e);
        return res.status(500).json({ error: e.message });
    }
}
