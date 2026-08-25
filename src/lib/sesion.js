// Aviso central de "la sesión ya no vale".
//
// El servidor contesta 401 / "No autenticado" cuando la cookie `pv_session`
// venció o no llegó. Hasta ahora NADIE escuchaba ese 401: la app se quedaba
// adentro mostrando el nombre del usuario —que sale de localStorage, no de la
// sesión— con todas las pantallas vacías y errores sueltos. El cajero no tenía
// forma de saber que lo único que hacía falta era volver a entrar.
//
// Vive en un módulo aparte porque el 401 puede llegar por tres caminos
// distintos: el store (useStore.js), las páginas (lib/dataApi.js) y el sync del
// catálogo (lib/db/sync.js). Los tres avisan acá y el store se encarga del resto.

let avisar = null;
let yaAvisado = false;

/** Lo registra el store al cargarse. */
export function alExpirarSesion(fn) {
    avisar = fn;
}

/** ¿Esta respuesta dice que la sesión ya no vale? */
export function esSesionExpirada(respuesta) {
    return respuesta?._status === 401 || respuesta?.error === 'No autenticado';
}

/**
 * Dispara el aviso UNA sola vez.
 *
 * Cuando la sesión muere no falla una llamada: fallan todas las que estaban en
 * vuelo (el catálogo, la caja, los permisos, el polling). Sin este candado el
 * cajero vería el mismo cartel cinco veces seguidas.
 */
export function sesionExpirada() {
    if (yaAvisado) return;
    yaAvisado = true;
    try {
        avisar?.();
    } catch {
        /* noop */
    }
}

/** Al volver a entrar se rearma, para que el próximo vencimiento vuelva a avisar. */
export function reiniciarAvisoSesion() {
    yaAvisado = false;
}
