import { parseBody, resolveCompanyId, logSync } from './_db.js';
import { syncProductToStore } from './client.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id');
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const companyId = resolveCompanyId(req);

    try {
        const payload = parseBody(req);
        if (!payload.product || !payload.product.sku) {
            return res.status(400).json({ success: false, error: 'Missing product payload or SKU' });
        }

        const result = await syncProductToStore({
            companyId,
            product: payload.product,
        });

        if (!result.success) {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'product.synced',
                status: 'error',
                message: 'No se pudo sincronizar producto',
                payload,
                response: result,
            });

            return res.status(502).json({ success: false, ...result });
        }

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('❌ /api/integration/sync-product error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
