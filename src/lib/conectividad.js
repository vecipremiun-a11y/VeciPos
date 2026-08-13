// Monitor de conectividad REAL del POS.
//
// El problema que resuelve: `navigator.onLine` solo dice si el equipo está
// conectado a una red. Con el WiFi del local encendido y el internet caído
// responde "sí hay conexión", así que el POS creía estar online, la venta salía
// a buscar el servidor y quedaba esperando. El modo offline recién se activaba
// cuando una venta fallaba —o sea, después de hacer esperar al cajero—.
//
// Acá se comprueba de verdad: un latido periódico a /api/ping (que no toca la
// base) dice si el servidor CONTESTA. Apenas deja de contestar, el sistema pasa
// a offline solo, sin que nadie tenga que intentar nada.
//
// Ritmo:
//   · online  → cada 15 s (barato, no molesta)
//   · offline → cada 4 s (para volver rápido apenas regresa el internet)
//   · el latido corta a los 4 s: una respuesta más lenta que eso, en un POS, es
//     lo mismo que no tener conexión.
//
// Además escucha los eventos del navegador: si avisa que se cayó la red, no hay
// nada que comprobar y se pasa a offline en el acto.

const PING_URL = '/api/ping';
const TIMEOUT_MS = 4000;
const INTERVALO_ONLINE = 15000;
const INTERVALO_OFFLINE = 4000;

// Dos fallos seguidos antes de declarar la caída: un micro-corte puntual no
// debería sacar al POS de línea y disparar la sincronización de ida y vuelta.
const FALLOS_PARA_CAER = 2;

let hayInternet = true;
let fallosSeguidos = 0;
let timer = null;
let arrancado = false;
// Cuándo se confirmó por última vez que hay conexión (por latido o por una
// llamada real de la app).
let ultimoOk = 0;
const oyentes = new Set();

const avisar = () => oyentes.forEach(fn => { try { fn(hayInternet); } catch { /* noop */ } });

/**
 * fetch con tiempo límite que funciona en TODOS los entornos.
 *
 * El AbortController solo no alcanza: dentro de la app (Capacitor) el plugin
 * CapacitorHttp reemplaza `fetch` por peticiones nativas y NO conecta la señal
 * de cancelación. O sea que en el teléfono —justo donde el offline más
 * importa— el corte no se aplicaría y la venta seguiría colgada.
 *
 * Por eso además se corre una carrera contra un temporizador: la promesa
 * siempre termina, respete o no la cancelación el transporte de abajo. El
 * AbortController se mantiene porque en el navegador sí aborta de verdad la
 * petición, en vez de dejarla viva en segundo plano.
 */
export function fetchConLimite(url, opciones = {}, ms = 12000) {
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), ms);
    const peticion = fetch(url, { ...opciones, signal: ctrl.signal });
    const reloj = new Promise((_, rechazar) => {
        setTimeout(() => {
            const e = new Error('Tiempo de espera agotado');
            e.name = 'TimeoutError';
            rechazar(e);
        }, ms);
    });
    return Promise.race([peticion, reloj]).finally(() => clearTimeout(corte));
}

function fijar(nuevo) {
    if (nuevo === hayInternet) return;
    hayInternet = nuevo;
    console.log(nuevo ? '🌐 Conexión recuperada' : '📴 Sin conexión: el POS pasa a modo offline');
    avisar();
}

async function latir() {
    // Si el navegador ya sabe que no hay red, no hace falta preguntar.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        fallosSeguidos = FALLOS_PARA_CAER;
        fijar(false);
        programar();
        return;
    }

    // Si una llamada REAL de la app ya confirmó la conexión hace poco, este
    // latido no aporta nada: se saltea. En una caja con movimiento (búsquedas,
    // ventas) el latido casi no llega a dispararse; solo trabaja cuando el POS
    // está quieto, que es justo cuando nada más avisaría de una caída.
    if (hayInternet && Date.now() - ultimoOk < INTERVALO_ONLINE) {
        programar();
        return;
    }

    try {
        const r = await fetchConLimite(`${PING_URL}?t=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store',
        }, TIMEOUT_MS);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        ultimoOk = Date.now();
        fallosSeguidos = 0;
        fijar(true);
    } catch {
        fallosSeguidos++;
        if (fallosSeguidos >= FALLOS_PARA_CAER) fijar(false);
    } finally {
        programar();
    }
}

function programar() {
    clearTimeout(timer);
    timer = setTimeout(latir, hayInternet ? INTERVALO_ONLINE : INTERVALO_OFFLINE);
}

/** Arranca el monitor. Se llama una sola vez, al cargar la app. */
export function iniciarMonitorConexion() {
    if (arrancado || typeof window === 'undefined') return;
    arrancado = true;

    window.addEventListener('offline', () => {
        fallosSeguidos = FALLOS_PARA_CAER;
        fijar(false);
        programar();
    });
    // Volver a tener red no garantiza internet: se comprueba en vez de asumir.
    window.addEventListener('online', () => { fallosSeguidos = 0; latir(); });
    // Al volver a la pestaña se revisa enseguida, sin esperar el próximo latido.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') latir();
    });

    latir();
}

/** ¿Hay internet hasta el servidor AHORA? */
export function hayConexion() {
    return hayInternet;
}

/** Avisa cada vez que cambia el estado. Devuelve la función para desuscribirse. */
export function alCambiarConexion(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
}

/** Fuerza una comprobación inmediata (p. ej. antes de una operación importante). */
export function comprobarConexionYa() {
    return latir();
}

/**
 * Lo que aprendieron las llamadas REALES de la app.
 *
 * El latido corre cada 15 s, así que entre uno y otro queda una ventana: si el
 * internet se cae justo después de un latido bueno, el POS todavía se cree
 * online y la próxima venta espera a que se agote el tiempo (12 s) antes de
 * guardarse offline. La venta no se pierde, pero el cajero espera.
 *
 * Con esto esa ventana se cierra sola: cada llamada que la app ya hace
 * (guardar una venta, cargar productos) informa cómo le fue.
 *   · falló por red  → el POS pasa a offline EN EL ACTO, así la venta siguiente
 *                      es instantánea.
 *   · funcionó       → confirma que hay conexión y adelanta el próximo latido.
 *
 * Solo cuentan los fallos de RED. Un error del servidor (500) o un rechazo de
 * negocio no significan falta de internet.
 */
export function reportarResultadoRed(ok, porTiempo = false) {
    if (ok) {
        ultimoOk = Date.now();
        fallosSeguidos = 0;
        const estaba = hayInternet;
        fijar(true);
        if (!estaba) programar();
        return;
    }

    // Que una consulta se pase del tiempo NO significa que no haya internet.
    // Significa que ESA consulta es lenta, que es otra cosa.
    //
    // Pasó de verdad: el detalle de cierre de caja tardaba 49 segundos por una
    // consulta mal indexada. El POS lo tomaba como caída, se declaraba sin
    // conexión y mandaba las ventas a la cola offline — con el internet
    // andando perfecto. Un reporte lento no puede arrastrar a todo el sistema.
    //
    // Ante la duda se le pregunta al latido, que es barato y responde en
    // milisegundos: si /api/ping contesta, hay internet y la lentitud era de esa
    // consulta nomás.
    if (porTiempo) {
        latir();
        return;
    }

    // Un fallo de red de verdad (la petición ni salió) sí es evidencia directa:
    // se declara la caída sin esperar al segundo latido.
    fallosSeguidos = FALLOS_PARA_CAER;
    const estaba = hayInternet;
    fijar(false);
    if (estaba) programar();
}
