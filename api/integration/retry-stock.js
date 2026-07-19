import {
    listPendingStockRetries,
    parseBody,
    resolveCompanyId,
    updateSyncLogStatus,
    requireMemberForIntegration,
} from './_db.js';
import { syncStockToStore } from './client.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id');
}

function safeParsePayload(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Blindaje: sesión + membresía (antes cualquiera disparaba pushes).
    const companyId = await requireMemberForIntegration(req, res);
    if (!companyId) return;

    try {
        const body = parseBody(req);
        const limit = body.limit || 20;
        const pending = await listPendingStockRetries({ companyId, limit });

        if (pending.length === 0) {
            return res.status(200).json({ success: true, processed: 0, message: 'No hay sincronizaciones pendientes' });
        }

        let retriedOk = 0;
        let stillPending = 0;
        let failed = 0;

        for (const logRow of pending) {
            const payload = safeParsePayload(logRow.payload);

            if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
                failed += 1;
                await updateSyncLogStatus({
                    id: logRow.id,
                    status: 'error',
                    message: 'Payload inválido para reintento',
                    error: 'missing_items_payload',
                });
                continue;
            }

            const result = await syncStockToStore({
                companyId,
                sale: {
                    sale_id: payload.sale_id || null,
                    sold_at: payload.sold_at || null,
                    retry_attempt: Number(payload.retry_attempt || 0) + 1,
                    items: payload.items,
                },
            });

            if (result.success) {
                retriedOk += 1;
                await updateSyncLogStatus({
                    id: logRow.id,
                    status: 'ok',
                    message: 'Reintento exitoso',
                    response: result,
                    error: null,
                });
            } else if (result.retryable) {
                stillPending += 1;
                await updateSyncLogStatus({
                    id: logRow.id,
                    status: 'pending_retry',
                    message: 'Reintento falló, sigue pendiente',
                    response: result,
                    error: result.error || null,
                });
            } else {
                failed += 1;
                await updateSyncLogStatus({
                    id: logRow.id,
                    status: 'error',
                    message: 'Reintento falló definitivamente',
                    response: result,
                    error: result.error || null,
                });
            }
        }

        return res.status(200).json({
            success: true,
            processed: pending.length,
            retried_ok: retriedOk,
            still_pending: stillPending,
            failed,
        });
    } catch (error) {
        console.error('❌ /api/integration/retry-stock error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
