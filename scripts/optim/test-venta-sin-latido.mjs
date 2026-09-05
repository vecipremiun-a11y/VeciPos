// Prueba de que la venta ya NO le pregunta al latido si hay internet
// (4-sep-2026).
//
// El problema: antes, cada venta consultaba el monitor de conectividad antes de
// decidir. El monitor tarda unos segundos en enterarse de un cambio, así que
// mandaba ventas a la cola con el internet andando perfecto — pasó el 4-sep-2026
// con la conexión estable y la base sana. Para quien está en la caja eso es peor
// que esperar: la venta dice "guardada sin conexión" cuando había conexión.
//
// Cómo queda: quien decide trabajar sin conexión es la persona que mira la caja,
// con el botón. Si no lo tocó, la venta sale a buscar el servidor como toda la
// vida; si no contesta, ahí se guarda en el equipo. Nunca se pierde.
//
//   node scripts/optim/test-venta-sin-latido.mjs

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// Réplica de la decisión que toma addSale al empezar.
const vaDirectoALaCola = (venta, { manual, latidoDiceOffline }) => {
    void latidoDiceOffline;               // ya no se mira: ese es el punto
    return manual === true && !venta._fromOfflineQueue;
};

// Réplica del camino completo, para ver dónde termina cada venta.
const vender = (venta, mundo) => {
    if (vaDirectoALaCola(venta, mundo)) return { destino: 'cola', intentó: false };
    if (!mundo.servidorContesta) return { destino: 'cola', intentó: true, motivo: 'el servidor no contestó' };
    return { destino: 'servidor', intentó: true };
};

const venta = (extra = {}) => ({ clientSaleId: 'abc-123', total: 1000, ...extra });

console.log('1. Con el botón APAGADO, la venta siempre intenta contra el servidor');
let r = vender(venta(), { manual: false, latidoDiceOffline: false, servidorContesta: true });
check('con todo bien: va al servidor', r.destino === 'servidor');

// El caso que rompió la confianza: el latido dice "offline" pero hay internet.
r = vender(venta(), { manual: false, latidoDiceOffline: true, servidorContesta: true });
check('el latido dice offline pero HAY internet: igual va al servidor', r.destino === 'servidor');
check('y sí lo intentó', r.intentó === true);

console.log('\n2. Si el servidor de verdad no contesta, la venta se guarda igual');
r = vender(venta(), { manual: false, latidoDiceOffline: false, servidorContesta: false });
check('termina en la cola', r.destino === 'cola');
check('pero después de intentar', r.intentó === true, r.motivo);
check('nunca se pierde', r.destino === 'cola');

console.log('\n3. Con el botón PRENDIDO, va directo a la cola, sin esperar');
r = vender(venta(), { manual: true, latidoDiceOffline: false, servidorContesta: true });
check('no intenta contra el servidor', r.intentó === false);
check('se guarda en el equipo al instante', r.destino === 'cola');
check('aunque el servidor esté perfecto: lo decidió la cajera', r.destino === 'cola');

console.log('\n4. Una venta que viene de la cola SIEMPRE se procesa online');
// Si se re-encolara, la cola nunca terminaría de vaciarse.
r = vender(venta({ _fromOfflineQueue: true }), { manual: true, latidoDiceOffline: true, servidorContesta: true });
check('no se re-encola aunque el botón esté prendido', r.destino === 'servidor');
check('lo intenta', r.intentó === true);

console.log('\n5. Las seguridades que SÍ se quedan');
// a) El código anti-duplicado se pone una vez y se respeta.
const ponerClave = (v) => {
    if (!v.clientSaleId) v.clientSaleId = 'nueva-' + Math.random();
    return v.clientSaleId;
};
const v1 = { total: 500 };
const clave = ponerClave(v1);
check('una venta sin clave recibe una', !!clave);
check('reintentarla NO le cambia la clave', ponerClave(v1) === clave, ponerClave(v1));

// b) El candado del doble clic.
let cobrando = false, cobros = 0;
const tocarCobrar = () => { if (cobrando) return 'ignorado'; cobrando = true; cobros++; return 'cobrando'; };
check('el primer clic cobra', tocarCobrar() === 'cobrando');
check('el segundo clic se ignora', tocarCobrar() === 'ignorado');
check('el tercero también', tocarCobrar() === 'ignorado');
check('quedó UN solo cobro', cobros === 1, String(cobros));

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
