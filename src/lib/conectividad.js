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

// `?db=1`: el latido comprueba también que la base conteste. Sin esto, el
// 23-ago-2026 hubo internet y servidor vivos con Turso tardando 9-24 s por
// consulta: el POS se creyó online todo el día, se colgaba en cada operación y
// NUNCA entró en modo offline — porque para él no había ninguna caída.
const PING_URL = '/api/ping?db=1';
// Ahora el latido espera a que la base conteste, y el servidor le da hasta 3 s a
// esa comprobación. 6 s deja margen para la red sin dejar de ser "si tarda más
// que esto, en una caja es lo mismo que no tener conexión".
const TIMEOUT_MS = 6000;
const INTERVALO_ONLINE = 15000;
const INTERVALO_OFFLINE = 4000;

// Dos fallos seguidos antes de declarar la caída: un micro-corte puntual no
// debería sacar al POS de línea y disparar la sincronización de ida y vuelta.
const FALLOS_PARA_CAER = 2;

// ── Modo offline puesto A MANO por el cajero ─────────────────────────────
//
// El monitor automático comprueba con `SELECT 1`, que es una LECTURA. El
// 3-sep-2026 la base servía lecturas en 140 ms con las ESCRITURAS colgadas: el
// latido decía "hay internet", cada venta salía a intentar y esperaba los 12 s
// del corte antes de guardarse. Con la caja llena, 12 segundos por venta.
//
// Ninguna comprobación automática va a cubrir todos los casos raros. Por eso el
// cajero puede forzarlo él: ve que las ventas se traban, aprieta el botón y
// trabaja offline de una, sin esperar a que el sistema se dé cuenta.
//
// Dura lo que dura la emergencia: aguanta recargar, muere con la pestaña y con
// la sesión. Por eso `sessionStorage` y no `localStorage`.
//
// El modo manual no es un ajuste de un momento, es un MODO DE TRABAJO: la base
// está lenta o caída, se prende, y la caja sigue vendiendo con el catálogo y los
// clientes que ya tiene guardados, sin descuadrar nada, hasta que el problema se
// resuelva. Puede durar horas.
//
// Que una recarga lo apagara era un agujero: la app es una PWA y recarga entera
// desde su propia caché, sin pedirle nada al servidor —los 97 archivos están
// guardados en el equipo—. O sea que recargar NO prueba que haya internet, y
// apagar el modo por una recarga devolvía al cajero a las ventas de 12 segundos
// en medio de la emergencia. Peor todavía: el auto-recupero de index.html
// recarga la pantalla solo cuando falla un archivo, que es más probable
// justamente cuando la conexión anda mal.
//
//   · RECARGAR (F5, o el auto-recupero)  → se mantiene.
//   · CERRAR la pestaña o la app         → se apaga.
//   · CERRAR SESIÓN                      → se apaga (lo limpia `logout`).
const CLAVE_MANUAL = 'posveci_offline_manual';
/** Canal para que las demás pestañas del mismo navegador se enteren. */
const CANAL_MANUAL = 'posveci_offline_manual_v1';

function leerModoManual() {
    try {
        if (sessionStorage.getItem(CLAVE_MANUAL) === '1') return true;
        // Migración de la versión que lo guardaba en localStorage: se respeta
        // una vez y se saca de ahí, para que no quede pegado en el equipo.
        if (localStorage.getItem(CLAVE_MANUAL) === '1') {
            localStorage.removeItem(CLAVE_MANUAL);
            sessionStorage.setItem(CLAVE_MANUAL, '1');
            return true;
        }
    } catch { /* modo privado */ }
    return false;
}

let offlineManual = leerModoManual();

let hayInternet = true;
let fallosSeguidos = 0;
let timer = null;
let arrancado = false;
// Cuándo se confirmó por última vez que hay conexión (por latido o por una
// llamada real de la app).
let ultimoOk = 0;
const oyentes = new Set();

const avisar = () => oyentes.forEach(fn => { try { fn(hayInternet); } catch { /* noop */ } });

// ── Aviso entre pestañas del mismo navegador ─────────────────────────────
let canal = null;
function abrirCanal() {
    if (canal !== null || typeof BroadcastChannel === 'undefined') return canal;
    try {
        canal = new BroadcastChannel(CANAL_MANUAL);
        canal.onmessage = (e) => {
            if (typeof e?.data?.manual !== 'boolean') return;
            // `avisarAOtrasPestanas: false` corta el rebote infinito entre pestañas.
            ponerOfflineManual(e.data.manual, { avisarAOtrasPestanas: false });
        };
    } catch { canal = null; }
    return canal;
}
function avisarPestanas(manual) {
    try { abrirCanal()?.postMessage({ manual }); } catch { /* sin canal: cada pestaña se maneja sola */ }
}

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
    // Con el modo manual puesto, ninguna comprobación automática puede devolver
    // el POS a "online". Lo decidió una persona mirando la caja; el latido no
    // tiene forma de saber más que ella.
    if (nuevo === true && offlineManual) return;
    if (nuevo === hayInternet) return;
    hayInternet = nuevo;
    console.log(nuevo ? '🌐 Conexión recuperada' : '📴 Sin conexión (o base sin responder): el POS pasa a modo offline');
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
        const r = await fetchConLimite(`${PING_URL}&t=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store',
        }, TIMEOUT_MS);
        if (!r.ok) throw new Error('HTTP ' + r.status);

        // El servidor puede estar perfecto y la base caída. Para una caja es lo
        // mismo: no se puede trabajar. Si el endpoint contesta `db: false`, el POS
        // pasa a offline igual que si no hubiera internet.
        const datos = await r.json().catch(() => ({}));
        if (datos && datos.db === false) {
            fallosSeguidos++;
            if (fallosSeguidos >= FALLOS_PARA_CAER) fijar(false);
            return; // el finally reprograma el próximo latido
        }

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
    abrirCanal();

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
    return offlineManual ? false : hayInternet;
}

/** ¿El cajero puso el modo offline a mano? */
export function esOfflineManual() {
    return offlineManual;
}

/**
 * Prende o apaga el modo offline manual.
 *
 * Prendido: todas las ventas se guardan en el dispositivo al instante, sin
 * intentar contra el servidor y sin esperar ningún corte de tiempo.
 * Apagado: vuelve a mandar el monitor automático, y se comprueba enseguida
 * si de verdad hay conexión antes de dar por buena la vuelta.
 */
export async function ponerOfflineManual(activar, { avisarAOtrasPestanas = true } = {}) {
    offlineManual = !!activar;
    try {
        if (offlineManual) sessionStorage.setItem(CLAVE_MANUAL, '1');
        else sessionStorage.removeItem(CLAVE_MANUAL);
    } catch { /* modo privado: igual funciona mientras la pestaña siga abierta */ }

    // Las demás pestañas del mismo navegador tienen que enterarse.
    //
    // Este módulo vive DENTRO de cada pestaña: sin este aviso, prenderlo en la
    // pestaña del POS no hacía nada en otra pestaña abierta, que seguía saliendo
    // a buscar el servidor y colgándose 12 segundos por venta. El cajero creía
    // haberlo apagado para todo el equipo.
    if (avisarAOtrasPestanas) avisarPestanas(offlineManual);

    if (offlineManual) {
        fallosSeguidos = FALLOS_PARA_CAER;
        fijar(false);
        avisar();
        programar();
        return false;
    }

    // Volver a online: no se asume, se comprueba, y se ESPERA el resultado.
    //
    // Antes esto disparaba el latido sin esperarlo y no devolvía nada: la
    // pantalla ponía el botón en gris al instante, como si ya estuviera
    // conectado, aunque el latido después descubriera que no había internet.
    // Las ventas seguían yendo bien a la cola —eso nunca estuvo en riesgo—,
    // pero el cajero quedaba creyendo que estaba online cuando no lo estaba.
    //
    // Devuelve si de verdad volvió la conexión, para que quien apretó el botón
    // se entere en vez de suponer.
    fallosSeguidos = 0;
    avisar();
    await latir();
    programar();
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
