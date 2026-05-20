// Pusher bus: publica eventos `order.created` / `order.updated` en el canal
// `preorders` para que la Pantalla de Producción los reciba al instante.
//
// Diseño: el cliente Pusher se construye lazy (en la primera publicación) para
// que funcione bien tanto en server.js local (donde dotenv carga después de los
// imports ESM) como en funciones serverless de Vercel (cold-start incluido).
//
// La firma `broadcastPreorderEvent(event, data)` es idéntica a la versión SSE
// previa — los call sites en api/external/preorders.js no necesitan cambiar.

import Pusher from 'pusher';

const CHANNEL = 'preorders';

let _pusher = null;
let _disabledLogged = false;

function getPusher() {
    if (_pusher) return _pusher;

    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER;

    if (!appId || !key || !secret || !cluster) {
        if (!_disabledLogged) {
            console.warn('⚠️  [pusher] credenciales faltantes (PUSHER_APP_ID/KEY/SECRET/CLUSTER) — broadcasts deshabilitados.');
            _disabledLogged = true;
        }
        return null;
    }

    _pusher = new Pusher({ appId, key, secret, cluster, useTLS: true });
    return _pusher;
}

/**
 * Publica un evento en el canal `preorders`. Fire-and-forget desde el caller:
 * swallowea errores internamente para no romper el flujo del POST si Pusher
 * está caído. Si la publicación falla, la pantalla recupera el encargo igual
 * por el fallback de polling (2 min).
 */
export async function broadcastPreorderEvent(event, data) {
    const pusher = getPusher();
    if (!pusher) return;

    try {
        await pusher.trigger(CHANNEL, event, data ?? {});
        console.log(`📡 [pusher] ${event} → canal ${CHANNEL}`);
    } catch (error) {
        console.error(`📡 [pusher] error publicando ${event}:`, error.message);
    }
}
