import { getTiendaConfig, parseBody, requireMemberForIntegration, saveTiendaConfig } from './_db.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id');
}

function mask(config) {
    if (!config) return null;

    return {
        ...config,
        api_key: config.api_key ? '***' : null,
        api_secret: config.api_secret ? '***' : null,
        webhook_secret: config.webhook_secret ? '***' : null,
    };
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        // Blindaje: sesión + membresía. Antes cualquiera leía/sobreescribía la
        // config de tienda de cualquier empresa (incluida su tienda_url).
        const companyId = await requireMemberForIntegration(req, res);
        if (!companyId) return;

        if (req.method === 'GET') {
            const config = await getTiendaConfig(companyId);
            return res.status(200).json({
                success: true,
                company_id: companyId,
                configured: Boolean(config),
                config: mask(config),
            });
        }

        if (req.method === 'POST') {
            const payload = parseBody(req);

            if (!payload.tienda_url || !(payload.api_key || payload.api_consumer_key) || !(payload.api_secret || payload.api_consumer_secret) || !payload.webhook_secret) {
                return res.status(400).json({
                    success: false,
                    error: 'Faltan campos obligatorios: tienda_url, api_key, api_secret, webhook_secret',
                });
            }

            const saved = await saveTiendaConfig(companyId, payload);

            return res.status(200).json({
                success: true,
                message: 'Configuración guardada',
                company_id: companyId,
                config: mask(saved),
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('❌ integration/config error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    }
}
