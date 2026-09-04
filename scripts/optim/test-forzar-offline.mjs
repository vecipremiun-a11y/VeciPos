// Prueba de la lógica anti-rebote que se agregó a src/lib/conectividad.js.
//
// El problema real (3-sep-2026): la base servía LECTURAS en 140 ms con las
// ESCRITURAS colgadas. El latido comprueba con `SELECT 1` —una lectura—, así
// que decía "hay internet". Cada venta salía a intentar, esperaba los 12 s de
// corte y recién ahí se guardaba offline: 12 segundos por venta con la caja
// llena de gente.
//
// El arreglo: cuando una venta se pasa del tiempo, el POS se declara offline y
// el latido NO puede devolverlo a "online" durante un rato. Acá se comprueba
// esa regla, replicando exactamente el guard que se agregó en `fijar()`.
//
//   node scripts/optim/test-forzar-offline.mjs

let fallas = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// ── Réplica exacta de la lógica de conectividad.js ────────────────────────
let hayInternet = true;
let castigadoHasta = 0;
const cambios = [];

function fijar(nuevo) {
    // Guard nuevo: durante el castigo no se vuelve a "online".
    if (nuevo === true && Date.now() < castigadoHasta) return;
    if (nuevo === hayInternet) return;
    hayInternet = nuevo;
    cambios.push(nuevo);
}

function forzarOffline(ms) {
    castigadoHasta = Date.now() + ms;
    fijar(false);
}

// El latido, que solo LEE, siempre cree que todo está bien.
const latidoQueSoloLee = () => fijar(true);

console.log('1. Una venta que se pasa del tiempo tira el POS a offline');
check('arranca online', hayInternet === true);
forzarOffline(1000);
check('tras la venta fallida queda offline', hayInternet === false);

console.log('\n2. El latido (que solo lee) NO puede devolverlo a online');
latidoQueSoloLee();
check('sigue offline pese al latido', hayInternet === false);
latidoQueSoloLee();
latidoQueSoloLee();
check('sigue offline tras varios latidos', hayInternet === false);

console.log('\n3. Cuando pasa el castigo, sí puede volver');
await new Promise(r => setTimeout(r, 1100));
latidoQueSoloLee();
check('vuelve a online cuando expira el castigo', hayInternet === true);

console.log('\n4. Pasar a offline nunca se bloquea');
castigadoHasta = Date.now() + 60000; // castigo largo
hayInternet = true;
fijar(false);
check('puede irse a offline incluso durante el castigo', hayInternet === false);

console.log('\n5. Sin castigo, el comportamiento de siempre no cambia');
castigadoHasta = 0;
hayInternet = false;
fijar(true);
check('vuelve a online normalmente', hayInternet === true);

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
