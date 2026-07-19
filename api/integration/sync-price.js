import { parseBody, resolveCompanyId, logSync , requireMemberForIntegration } from './_db.js';
import { syncPriceToStore } from './client.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id');
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Blindaje: sesión + membresía (antes cualquiera disparaba pushes).
    const companyId = await requireMemberForIntegration(req, res);
    if (!companyId) return;

    try {
        const payload = parseBody(req);
        if (!payload.product || payload.product.id === undefined) {
            return res.status(400).json({ success: false, error: 'Missing product payload' });
        }

        const result = await syncPriceToStore({
            companyId,
            product: payload.product,
        });

        if (!result.success) {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'product.price_updated',
                status: 'error',
                message: 'No se pudo sincronizar precio',
                payload,
                response: result,
            });

            return res.status(502).json({ success: false, ...result });
        }

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('❌ /api/integration/sync-price error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
