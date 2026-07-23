// Guardia de sesión por pestaña.
//
// La sesión (cookie `pv_session`) pertenece al NAVEGADOR, no a la pestaña: todas las
// pestañas del mismo navegador comparten la misma credencial. Si en una pestaña se
// inicia sesión con otro usuario, las demás siguen mostrando al usuario anterior
// —su nombre, su caja— pero cada escritura que hagan se graba a nombre del usuario
// nuevo, porque el servidor decide quién eres leyendo la cookie.
//
// Eso fue lo que pasó el 22-jul-2026 en minimarket D&A: se abrió una segunda pestaña
// con el administrador y, desde ese minuto, todas las ventas de la cajera quedaron
// guardadas en la caja del administrador. Su caja dejó de sumar y nadie fue avisado.
//
// Este módulo mantiene a nombre de quién cree actuar ESTA pestaña (lo que después se
// manda al servidor para que corte si no coincide) y avisa a las demás pestañas
// cuando alguien inicia sesión.

const CHANNEL_NAME = 'pv_session';

let tabUserId = null;
let channel = null;
const listeners = new Set();

function getChannel() {
    if (typeof BroadcastChannel === 'undefined') return null;
    if (!channel) {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (ev) => {
            const msg = ev?.data;
            if (!msg || msg.type !== 'login') return;
            // Otra pestaña inició sesión. Si es con otro usuario, esta quedó zombi.
            if (tabUserId != null && Number(msg.userId) !== Number(tabUserId)) {
                listeners.forEach(cb => { try { cb(msg); } catch { /* noop */ } });
            }
        };
    }
    return channel;
}

/** Registra a nombre de quién actúa esta pestaña. `null` al cerrar sesión. */
export function setTabUserId(id) {
    tabUserId = id ?? null;
    if (tabUserId != null) getChannel(); // deja el canal escuchando
}

/** A nombre de quién cree actuar esta pestaña (o null si no hay sesión). */
export function getTabUserId() {
    return tabUserId;
}

/** Avisa a las demás pestañas que aquí se inició sesión con `userId`. */
export function broadcastLogin(userId) {
    try {
        getChannel()?.postMessage({ type: 'login', userId, at: Date.now() });
    } catch { /* el canal no está disponible: queda el candado del servidor */ }
}

/**
 * Se dispara cuando otra pestaña tomó la sesión con un usuario distinto.
 * Devuelve la función para desuscribirse.
 */
export function onSessionTakeover(cb) {
    listeners.add(cb);
    getChannel();
    return () => listeners.delete(cb);
}
