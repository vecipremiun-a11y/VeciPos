/**
 * GET /api/external/ping
 *
 * Endpoint de salud para que MiniVeci verifique la conexión
 * con el servicio PosVeci desde su panel de administración.
 */

// Dominios permitidos para CORS
const ALLOWED_ORIGINS = (process.env.EXTERNAL_CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

function setCorsHeaders(req, res) {
    const origin = req.headers.origin || '';

    if (ALLOWED_ORIGINS.length === 0) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}

function authenticateRequest(req) {
    const apiKey = process.env.EXTERNAL_API_KEY;
    if (!apiKey) return false;

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return false;

    return authHeader.slice(7) === apiKey;
}

export default async function handler(req, res) {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!authenticateRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.status(200).json({
        success: true,
        service: 'PosVeci',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
}
