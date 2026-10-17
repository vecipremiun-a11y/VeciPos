// Aviso de estado a miniveci.cl desde el SERVIDOR.
//
// El cambio de estado que hace la pestaña Tienda lo avisa el navegador
// (/api/integration/notify-miniveci-status). Este es para los que pasan sin una
// pantalla de Tienda abierta: el pedido que llega (queda "Preparando"), el
// repartidor que lo retira ("En reparto") o lo entrega cobrando ("Entregado").
// Mismo destino y mismas credenciales (tienda_config), que nunca salen al navegador.
//
// Best-effort: si miniveci.cl no contesta, el estado en POSVECI queda igual y el
// intento queda en integration_sync_logs.

import { getTiendaConfig, logSync } from '../integration/_db.js';

const ESTADO_TIENDA = {
    preparing: 'preparing',
    ready: 'ready',
    out_for_delivery: 'out_for_delivery',
    delivered: 'delivered',
    canceled: 'cancelled', // miniveci usa doble L
};

// `esperaMs`: cuánto se espera a miniveci.cl. Al recibir un pedido se espera poco,
// porque miniveci.cl está esperando la respuesta de ese mismo pedido (corta a los 5 s).
// `pago`: 'paid' cuando el local confirmó la transferencia (ahí nace la venta).
export async function avisarEstadoTienda(companyId, publicCode, status, { reason = null, via = 'servidor', esperaMs = 6000, pago = null } = {}) {
    const mapped = ESTADO_TIENDA[status];
    if (!publicCode || !mapped) return { sent: false, reason: 'no_aplica' };
    try {
        const config = await getTiendaConfig(companyId);
        if (!config || config.is_active === 0 || !config.api_key || !config.api_secret) {
            return { sent: false, reason: 'integration_not_configured' };
        }
        let baseUrl = process.env.MINIVECI_BASE_URL_OVERRIDE || config.tienda_url;
        if (!baseUrl) return { sent: false, reason: 'tienda_url_missing' };
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

        const ctrl = new AbortController();
        const corte = setTimeout(() => ctrl.abort(), esperaMs);
        let response, text;
        try {
            response = await fetch(`${baseUrl}/api/pos/bakery/orders/${encodeURIComponent(publicCode)}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.api_key,
                    'x-api-secret': config.api_secret,
                    'x-api-consumer-key': config.api_key,
                    'x-api-consumer-secret': config.api_secret,
                },
                body: JSON.stringify({ status: mapped, ...(reason ? { reason } : {}), ...(pago ? { payment_status: pago } : {}) }),
                signal: ctrl.signal,
            });
            text = await response.text();
        } finally {
            clearTimeout(corte);
        }
        await logSync({
            company_id: companyId,
            direction: 'pos_to_store',
            event: 'bakery_order.status_updated',
            status: response.ok ? 'ok' : 'error',
            message: response.ok ? `Estado enviado a miniveci (${via})` : `Falló envío de estado a miniveci (${via})`,
            payload: { public_code: publicCode, status: mapped, via, ...(pago ? { payment_status: pago } : {}) },
            response: { status: response.status, body: String(text || '').slice(0, 300) },
        });
        return { sent: true, ok: response.ok, status: response.status };
    } catch (e) {
        try {
            await logSync({
                company_id: companyId,
                direction: 'pos_to_store',
                event: 'bakery_order.status_updated',
                status: 'error',
                message: `Error de red notificando estado a miniveci (${via})`,
                payload: { public_code: publicCode, status: mapped, via },
                error: e?.message || String(e),
            });
        } catch { /* noop */ }
        return { sent: false, reason: 'request_failed' };
    }
}
