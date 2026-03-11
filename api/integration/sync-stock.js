import { parseBody, resolveCompanyId, logSync } from './_db.js';
import { syncStockToStore } from './client.js';

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
        const items = Array.isArray(payload.items) ? payload.items : [];

        if (items.length === 0) {
            return res.status(400).json({ success: false, error: 'Missing items payload' });
        }

        const result = await syncStockToStore({
            companyId,
            sale: {
                sale_id: payload.sale_id || payload.saleId || null,
                sold_at: payload.sold_at || payload.soldAt || null,
                retry_attempt: payload.retry_attempt || 0,
                items,
            },
        });

        if (!result.success) {
            if (!result.retryable) {
                await logSync({
                    company_id: companyId,
                    direction: 'pos_to_store',
                    event: 'product.stock_updated',
                    status: 'error',
                    message: 'No se pudo sincronizar stock',
                    payload,
                    response: result,
                });
            }

            return res.status(result.retryable ? 503 : 502).json({ success: false, ...result });
        }

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('❌ /api/integration/sync-stock error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
