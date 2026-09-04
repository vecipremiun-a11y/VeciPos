// Prueba de la lógica del modo offline manual (src/lib/conectividad.js).
//
// Replica el guard que se agregó: con el interruptor puesto por el cajero,
// ninguna comprobación automática puede devolver el POS a "online". El latido
// comprueba con `SELECT 1` —una LECTURA—, y el 3-sep-2026 las lecturas andaban
// mientras las escrituras estaban colgadas: por eso una persona mirando la caja
// tiene que poder mandar por encima del monitor.
//
// Y el caso que motivó la segunda tanda: apretar "Conectar" justo cuando NO hay
// internet. Antes el botón se ponía en gris al instante, sin esperar la
// comprobación, y el cajero quedaba creyendo que estaba conectado.
//
//   node scripts/optim/test-offline-manual.mjs

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const FALLOS_PARA_CAER = 2;

let hayInternet = true;
let offlineManual = false;
let fallosSeguidos = 0;
// Lo que el servidor contestaría ahora mismo. El latido solo LEE, así que puede
// decir que sí aunque las escrituras estén colgadas.
let servidorContesta = true;

function fijar(nuevo) {
    if (nuevo === true && offlineManual) return;
    if (nuevo === hayInternet) return;
    hayInternet = nuevo;
}

const hayConexion = () => (offlineManual ? false : hayInternet);

/** Mismo latido que conectividad.js: dos fallos seguidos para declarar la caída. */
async function latir() {
    if (servidorContesta) {
        fallosSeguidos = 0;
        fijar(true);
        return;
    }
    fallosSeguidos++;
    if (fallosSeguidos >= FALLOS_PARA_CAER) fijar(false);
}

/** Misma firma que la real: async y devuelve si de verdad volvió la conexión. */
async function ponerOfflineManual(activar) {
    offlineManual = !!activar;
    if (offlineManual) {
        fallosSeguidos = FALLOS_PARA_CAER;
        fijar(false);
        return false;
    }
    fallosSeguidos = 0;
    await latir();
    return hayInternet;
}

console.log('1. Prender el modo manual deja el POS offline al instante');
check('arranca con conexión', hayConexion() === true);
await ponerOfflineManual(true);
check('queda sin conexión', hayConexion() === false);

console.log('\n2. El latido automático NO puede desactivarlo');
await latir();
await latir();
await latir();
check('sigue offline pese a los latidos', hayConexion() === false);

console.log('\n3. Apagarlo con internet devuelve el control al monitor');
let volvio = await ponerOfflineManual(false);
check('avisa que SÍ volvió', volvio === true, String(volvio));
check('vuelve a haber conexión', hayConexion() === true);

console.log('\n4. Con el manual apagado, una caída real sí se detecta');
servidorContesta = false;
await latir();
await latir();
check('el monitor puede marcar offline', hayConexion() === false);
servidorContesta = true;
await latir();
check('y puede recuperarse solo', hayConexion() === true);

console.log('\n5. El manual manda incluso si el monitor dice que hay internet');
await ponerOfflineManual(true);
servidorContesta = true;
check('igual reporta sin conexión', hayConexion() === false);

console.log('\n6. Apretar "Conectar" JUSTO cuando no hay internet');
// El caso que preguntó Kevin. Lo importante: que no mienta y que no se pierda
// ninguna venta.
servidorContesta = false;
volvio = await ponerOfflineManual(false);
check('el botón avisa que NO volvió', volvio === false, String(volvio));
check('el sistema sigue offline', hayConexion() === false);
check('las ventas siguen yendo a la cola', hayConexion() === false);
check('el modo manual sí quedó apagado', offlineManual === false);

console.log('\n7. Y se reconecta solo cuando vuelve de verdad');
// Ya no hace falta tocar nada: el monitor quedó al mando.
servidorContesta = true;
await latir();
check('vuelve la conexión sin que nadie toque nada', hayConexion() === true);

console.log('\n8. Se puede volver a prender sin problema');
await ponerOfflineManual(true);
check('queda offline otra vez', hayConexion() === false);
servidorContesta = false;
volvio = await ponerOfflineManual(false);
check('segundo intento fallido también avisa', volvio === false);
servidorContesta = true;
volvio = await ponerOfflineManual(false);
check('y el tercero, con internet, funciona', volvio === true && hayConexion() === true);

console.log('\n9b. Aguanta recargar, muere con la pestaña');
// La app es una PWA: recarga entera desde su propia caché, sin pedirle nada al
// servidor. O sea que recargar NO prueba que haya internet, y apagar el modo por
// una recarga devolvía al cajero a las ventas de 12 segundos en plena
// emergencia. Peor: el auto-recupero de index.html recarga la pantalla solo
// cuando falla un archivo, que es más probable justo cuando la conexión anda mal.
//
// `sessionStorage` da exactamente eso: sobrevive al F5, se borra al cerrar la
// pestaña. Y el logout lo limpia aparte.
{
    const equipo = new Map();     // localStorage
    const pestana = new Map();    // sessionStorage
    const guardar = (v) => v ? pestana.set('m', '1') : pestana.delete('m');
    const leer = () => {
        if (pestana.get('m') === '1') return true;
        // Migración de la versión que lo guardaba en el equipo: se respeta una
        // vez y se saca de ahí para que no quede pegado.
        if (equipo.get('m') === '1') { equipo.delete('m'); pestana.set('m', '1'); return true; }
        return false;
    };
    const recargar = () => leer();                        // misma pestaña
    const cerrarYAbrirPestana = () => { pestana.clear(); return leer(); };

    guardar(true);
    check('recargar la pantalla lo MANTIENE', recargar() === true);
    check('recargar de nuevo también', recargar() === true);
    check('cerrar la pestaña y abrir otra lo apaga', cerrarYAbrirPestana() === false);

    // Equipo que venía de la versión que lo guardaba en localStorage.
    equipo.set('m', '1');
    check('lo que quedó guardado de antes se respeta una vez', leer() === true);
    check('y se saca del equipo', equipo.has('m') === false);
    check('la próxima pestaña arranca limpia', cerrarYAbrirPestana() === false);
}

console.log('\n9. El modo manual también muere al cerrar sesión');
// Lo prende una persona para SU turno. No es configuración del equipo: si lo
// hereda quien entra después, trabaja offline sin haberlo elegido —y lo veía
// hasta en la pantalla de ingreso, antes de saber quién es—.
//
// La recarga es otra cosa y sí lo mantiene (ver 9b): la emergencia sigue.
let pestanaGuarda = false;
const cerrarSesion = async () => { await ponerOfflineManual(false); pestanaGuarda = false; };
const prender = async () => { await ponerOfflineManual(true); pestanaGuarda = true; };
// Al recargar, el módulo se carga de cero y lee lo que dejó la pestaña.
const recargarPantalla = async () => { offlineManual = pestanaGuarda; if (offlineManual) fijar(false); };

servidorContesta = true;
await prender();
check('prendido queda offline', hayConexion() === false);
await recargarPantalla();
check('sigue prendido tras recargar', offlineManual === true && hayConexion() === false);
await cerrarSesion();
check('al cerrar sesión se apaga', offlineManual === false);
check('y la pestaña no se lo queda', pestanaGuarda === false);
await recargarPantalla();
check('el que entra después NO lo hereda', offlineManual === false && hayConexion() === true);

console.log('\n10. Cerrar sesión no toca la conexión real');
servidorContesta = false;
await latir(); await latir();
check('el sistema detectó la caída', hayConexion() === false);
await cerrarSesion();
check('sigue offline porque de verdad no hay internet', hayConexion() === false);
check('pero no por el modo manual', offlineManual === false);

console.log('\n11. Prenderlo en una pestaña lo prende en todas');
// El módulo de conexión vive DENTRO de cada pestaña: sin aviso entre ellas, el
// POS quedaba offline pero otra pestaña abierta seguía saliendo a buscar el
// servidor y colgándose 12 s por venta. El cajero creía haberlo apagado para
// todo el equipo.
{
    // Dos pestañas, cada una con su propio estado, unidas por un canal.
    const hacerPestana = (nombre) => ({ nombre, manual: false });
    const pestanas = [hacerPestana('POS'), hacerPestana('Reportes')];
    const ponerEn = (p, v, avisar = true) => {
        p.manual = v;
        if (avisar) pestanas.filter(o => o !== p).forEach(o => ponerEn(o, v, false));
    };

    ponerEn(pestanas[0], true);
    check('la otra pestaña también queda offline', pestanas[1].manual === true);
    ponerEn(pestanas[1], false);
    check('y apagarlo en una lo apaga en las dos', pestanas[0].manual === false && pestanas[1].manual === false);
    check('no queda rebotando entre pestañas', true); // el corte es `avisar = false` en la propagación
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
