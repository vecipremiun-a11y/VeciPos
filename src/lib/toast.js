// Notificaciones del sistema (reemplazan los alert() nativos del navegador).
// toast(mensaje, tipo?) muestra una tarjeta con estilo propio; installAlertBridge()
// redirige window.alert aquí, cubriendo de una vez todos los alert existentes.

let listeners = [];
let idSeq = 1;

// Tipo inferido cuando el mensaje viene de window.alert (sin tipo explícito).
// El orden importa: "No se pudo guardar" debe caer en error, no en success.
function inferType(msg) {
    const m = msg.toLowerCase();
    if (/(error|no se pudo|no fue posible|fall[óo]|inv[áa]lid|insuficiente|denegad|bloquead|ya existe|no encontrad|no tienes|requiere|debe |⚠|❌)/.test(m)) return 'error';
    if (/(éxito|exitos|guardad|cread|actualizad|eliminad|complet|registrad|sincronizad|listo|correctamente|✅)/.test(m)) return 'success';
    return 'info';
}

// `ms`: cuánto se queda (sin él, lo de siempre). `fuerte`: tarjeta de color lleno.
export function toast(message, type, { ms, fuerte = false } = {}) {
    const msg = String(message ?? '');
    if (!msg.trim()) return;
    const item = { id: idSeq++, message: msg, type: type || inferType(msg), ms, fuerte };
    listeners.forEach(l => l(item));
}

/**
 * Lo que el usuario tiene que ver que se hizo: se descargó, se mandó a imprimir,
 * se guardó (Kevin, 4-nov-2026: "un mensaje visible que se note que esa acción se
 * hizo"). Verde lleno y más tiempo en pantalla.
 */
export function avisoHecho(message) {
    toast(message, 'success', { ms: 6000, fuerte: true });
}

export function subscribeToasts(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
}

// Reemplaza el alert nativo ("app.posveci.com dice...") por el toast del sistema.
export function installAlertBridge() {
    if (typeof window === 'undefined' || window.__pvAlertBridged) return;
    window.__pvAlertBridged = true;
    window.alert = (msg) => toast(msg);
}
