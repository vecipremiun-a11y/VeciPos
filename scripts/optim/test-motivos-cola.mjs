// Prueba de los motivos que muestra la cola de ventas offline (3-sep-2026).
//
// El servidor contesta con códigos y frases sueltas —"CREDIT_LIMIT_EXCEEDED",
// "Stock insuficiente para: Ajo", "SERVER_ERROR: HTTP 502"— que en una lista de
// treinta ventas no dicen ni qué falló ni qué hacer. Acá se comprueba que cada
// una se traduzca a un titular claro y a una salida concreta.
//
//   node scripts/optim/test-motivos-cola.mjs

import { readFileSync } from 'node:fs';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// `explicarProblema` vive dentro de un .jsx que Node no sabe compilar. Se
// extrae del archivo real —no una copia— para que la prueba se rompa si alguien
// cambia la función y se olvida de mirar esto.
const fuente = readFileSync('src/pages/OfflineSync.jsx', 'utf8');
const corte = (desde, hasta) => {
    const i = fuente.indexOf(desde);
    const j = fuente.indexOf(hasta, i);
    if (i < 0 || j < 0) throw new Error(`No se encontró el bloque ${desde}`);
    return fuente.slice(i, j);
};
const codigo = corte('const nombreDocumento =', 'export default function OfflineSync');
const { explicarProblema } = await import(
    'data:text/javascript,' + encodeURIComponent(codigo + '\nexport { explicarProblema };')
);

const venta = (tipoDte = 0) => ({ tipoDte, total: 1000 });
const op = (extra = {}) => ({ status: 'error', attempts: 1, ...extra });

console.log('1. Una venta esperando su turno no tiene problema que contar');
check('en cola → sin motivo', explicarProblema({ status: 'queued' }, venta()) === null);
check('sincronizada → sin motivo', explicarProblema({ status: 'synced' }, venta()) === null);

console.log('\n2. Falta stock');
let p = explicarProblema(op({ bloqueo: true, lastError: 'Stock insuficiente para: Ajo' }), venta());
check('titular claro', p.titulo === 'Falta stock de un producto', p.titulo);
check('conserva el detalle del servidor (qué producto)', /Ajo/.test(p.detalle), p.detalle);
check('dice la salida: modo ajuste', /Modo Ajuste de Inventario/.test(p.queHacer));

p = explicarProblema(op({ bloqueo: true, lastError: 'Stock insuficiente (otra caja vendió primero): Pan' }), venta());
check('la carrera con otra caja también cae en stock', p.titulo === 'Falta stock de un producto', p.titulo);

console.log('\n3. Fiado que supera el límite');
p = explicarProblema(op({ bloqueo: true, lastError: 'Límite de crédito excedido. Límite: $50.000, Deuda actual: $48.500' }), venta());
check('titular claro', p.titulo === 'El fiado supera el límite del cliente', p.titulo);
check('muestra límite y deuda', /50\.000/.test(p.detalle) && /48\.500/.test(p.detalle), p.detalle);
check('explica por qué se dejó fiar offline', /Offline no se puede sumar la deuda/.test(p.queHacer));
check('dice la salida', /Subile el límite|abone algo/.test(p.queHacer));

p = explicarProblema(op({ bloqueo: true, lastError: 'CREDIT_LIMIT_EXCEEDED' }), venta());
check('el código pelado también se entiende', p.titulo === 'El fiado supera el límite del cliente', p.titulo);

console.log('\n4. Cliente sin fiado habilitado, y cliente bloqueado');
p = explicarProblema(op({ bloqueo: true, lastError: 'Este cliente no tiene habilitado el crédito.' }), venta());
check('titular claro', p.titulo === 'El cliente no tiene fiado habilitado', p.titulo);
check('dice la salida', /Habilitale el crédito|cambiá el medio de pago/.test(p.queHacer));

p = explicarProblema(op({ bloqueo: true, lastError: 'Este cliente está bloqueado y no puede realizar compras.' }), venta());
check('titular claro', p.titulo === 'El cliente está bloqueado', p.titulo);

console.log('\n5. Falta el documento');
p = explicarProblema(op({ bloqueo: true, docPendiente: true, serverId: 1024200, lastError: 'No se pudo emitir el documento: sin folios CAF' }), venta(39));
check('nombra el documento que falta', p.titulo === 'Falta emitir la boleta', p.titulo);
check('dice que la venta YA está guardada', /ya está guardada/.test(p.queHacer), p.queHacer);
check('da el número de venta', /1024200/.test(p.queHacer));
check('manda a mirar los folios', /folios CAF/.test(p.queHacer));

p = explicarProblema(op({ bloqueo: true, docPendiente: true, lastError: 'x' }), venta(33));
check('con factura dice factura', p.titulo === 'Falta emitir la factura', p.titulo);
p = explicarProblema(op({ bloqueo: true, docPendiente: true, lastError: 'x' }), venta(0));
check('con nota de venta no inventa un DTE', p.titulo === 'Falta emitir el documento', p.titulo);

console.log('\n6. Problemas de envío, que son otra cosa');
p = explicarProblema(op({ attempts: 3, lastError: 'SERVER_ERROR: Server returned HTTP status 502' }), venta());
check('titular claro', p.titulo === 'No pudo llegar al servidor', p.titulo);
check('aclara que no es culpa de la venta', /no de la venta/.test(p.queHacer), p.queHacer);
check('dice que reintenta sola', /Reintenta sola/.test(p.queHacer));

p = explicarProblema(op({ attempts: 10, lastError: 'Sin respuesta del servidor' }), venta());
check('a los 10 intentos avisa que se rindió', p.titulo === 'Se rindió después de 10 intentos', p.titulo);
check('y que hay que tocar Reintentar', /Reintentar/.test(p.queHacer), p.queHacer);

console.log('\n7. Nunca se queda sin explicación');
for (const err of ['', null, undefined, 'algo rarísimo que nadie previó', '{"json":"suelto"}']) {
    p = explicarProblema(op({ lastError: err }), venta());
    check(`siempre da titular y salida (${JSON.stringify(err)})`, !!p?.titulo && !!p?.queHacer, p?.titulo);
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
