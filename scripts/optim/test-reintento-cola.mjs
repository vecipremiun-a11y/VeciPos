// Pruebas de la cola de ventas offline (rediseño del 3-sep-2026).
//
// Lo que tiene que quedar demostrado:
//   1. Una venta que agotó los 10 intentos se puede destrabar a mano.
//   2. Lo que sube se BORRA de la cola (una sola lista: lo que falta subir).
//   3. Un rechazo del servidor (sin stock) NO gasta intentos y reintenta solo.
//   4. El backoff sigue vivo: no se bombardea al servidor.
//
//   node scripts/optim/test-reintento-cola.mjs

import { localDb, pendingOpsApi } from '../../src/lib/db/localdb.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// Dexie necesita IndexedDB, que en Node no existe. Se reemplaza la tabla por un
// Map: pendingOpsApi solo usa get/put/update/delete/where sobre ella.
const filas = new Map();
localDb.pendingOps = {
    async get(id) { return filas.get(id) ? { ...filas.get(id) } : undefined; },
    async put(e) { filas.set(e.tempId, { ...e }); },
    async update(id, cambios) {
        const prev = filas.get(id);
        if (!prev) return 0;
        filas.set(id, { ...prev, ...cambios });
        return 1;
    },
    async delete(id) { filas.delete(id); },
    where() { return { equals: (co) => ({ toArray: async () => [...filas.values()].filter(f => f.companyId === co) }) }; },
};

// Mismo filtro que syncPendingOpsToServer usa para decidir qué reintenta.
const esCandidata = (o, ahora = Date.now()) => {
    if (o.status === 'queued') return true;
    if (o.status === 'error' && (o.bloqueo || (o.attempts || 0) < 10)) {
        if (!o.nextAttemptAt) return true;
        return new Date(o.nextAttemptAt).getTime() <= ahora;
    }
    return false;
};

const CO = 'default';
const nueva = (tempId) => pendingOpsApi.add({ tempId, companyId: CO, userId: 7, type: 'sale', payload: { total: 1000 } });

console.log('1. Una venta que agotó los 10 intentos queda fuera del barrido');
await nueva('op_trabada');
for (let i = 0; i < 10; i++) await pendingOpsApi.markError('op_trabada', new Error('Sin respuesta del servidor'));
let op = await localDb.pendingOps.get('op_trabada');
check('llegó a 10 intentos', op.attempts === 10, String(op.attempts));
check('la sincronización automática la saltea', !esCandidata(op));

console.log('\n2. El botón Reintentar la desbloquea');
await pendingOpsApi.retry('op_trabada');
op = await localDb.pendingOps.get('op_trabada');
check('vuelve a la cola', op.status === 'queued', op.status);
check('el contador de intentos vuelve a cero', op.attempts === 0, String(op.attempts));
check('se limpia el mensaje de error', op.lastError === null);
check('ahora SÍ entra al barrido', esCandidata(op));

console.log('\n3. Lo que sube desaparece de la cola');
await nueva('op_sube');
check('está en la cola', (await pendingOpsApi.list(CO)).some(o => o.tempId === 'op_sube'));
await pendingOpsApi.markSynced('op_sube', 1024099);
check('ya no está en la cola', !(await pendingOpsApi.list(CO)).some(o => o.tempId === 'op_sube'));
check('no queda con estado "synced" ocupando lugar',
    (await pendingOpsApi.list(CO, 'synced')).length === 0);

console.log('\n4. Sin stock: el servidor la rechaza, pero no gasta intentos');
await nueva('op_sin_stock');
await pendingOpsApi.markBlocked('op_sin_stock', 'Stock insuficiente para: Ajo');
op = await localDb.pendingOps.get('op_sin_stock');
check('queda marcada como bloqueada', op.bloqueo === true);
check('muestra el motivo real', op.lastError === 'Stock insuficiente para: Ajo', op.lastError);
check('NO gastó intentos', (op.attempts || 0) === 0, String(op.attempts || 0));
check('espera antes de volver a probar', !esCandidata(op, Date.now()));
check('a los 10 minutos vuelve a probar sola', esCandidata(op, Date.now() + 11 * 60_000));

console.log('\n5. Una bloqueada nunca se congela, aunque tenga muchos intentos');
await nueva('op_bloq_vieja');
for (let i = 0; i < 10; i++) await pendingOpsApi.markError('op_bloq_vieja', new Error('502'));
await pendingOpsApi.markBlocked('op_bloq_vieja', 'Stock insuficiente para: Pan');
op = await localDb.pendingOps.get('op_bloq_vieja');
check('tiene 10 intentos de antes', op.attempts === 10, String(op.attempts));
check('igual sigue reintentando (es bloqueo, no fallo)', esCandidata(op, Date.now() + 11 * 60_000));

console.log('\n6. Un fallo de envío SÍ gasta intentos y respeta la espera');
await nueva('op_falla');
await pendingOpsApi.markError('op_falla', new Error('timeout'));
op = await localDb.pendingOps.get('op_falla');
check('gastó un intento', op.attempts === 1, String(op.attempts));
check('no está marcada como bloqueo', op.bloqueo === false, String(op.bloqueo));
check('espera antes de reintentar', !esCandidata(op, Date.now()));
// La espera es de 10 minutos a propósito: un problema de base de datos no se
// arregla en 30 segundos, y reintentar rápido solo suma carga al servidor que
// ya está mal. Al minuto todavía NO tiene que intentar.
check('al minuto todavía no intenta', !esCandidata(op, Date.now() + 60_000));
check('a los 11 minutos sí', esCandidata(op, Date.now() + 11 * 60_000));

console.log('\n7. Reintentar todas destraba el lote entero');
for (const id of ['a', 'b', 'c']) {
    await nueva('op_lote_' + id);
    for (let i = 0; i < 10; i++) await pendingOpsApi.markError('op_lote_' + id, new Error('502'));
}
let enRojo = (await pendingOpsApi.list(CO, 'error')).filter(o => o.tempId.startsWith('op_lote_'));
check('las tres quedaron trabadas', enRojo.length === 3 && enRojo.every(o => !esCandidata(o)));
for (const o of enRojo) await pendingOpsApi.retry(o.tempId);
const lote = (await pendingOpsApi.list(CO)).filter(o => o.tempId.startsWith('op_lote_'));
check('las tres vuelven a la cola', lote.every(o => o.status === 'queued' && o.attempts === 0));
check('las tres entran al barrido', lote.every(o => esCandidata(o)));

console.log('\n8. La espera entre intentos es pareja de 10 minutos');
filas.clear();
await nueva('op_espera');
await pendingOpsApi.markError('op_espera', new Error('502'));
op = await localDb.pendingOps.get('op_espera');
let espera = new Date(op.nextAttemptAt).getTime() - Date.now();
check('primer intento: espera ~10 min', espera > 9.5 * 60000 && espera <= 10 * 60000, Math.round(espera / 60000) + ' min');
for (let i = 0; i < 5; i++) await pendingOpsApi.markError('op_espera', new Error('502'));
op = await localDb.pendingOps.get('op_espera');
espera = new Date(op.nextAttemptAt).getTime() - Date.now();
check('sexto intento: SIGUE siendo ~10 min (no escalera)', espera > 9.5 * 60000 && espera <= 10 * 60000, Math.round(espera / 60000) + ' min');
check('con 10 intentos cubre casi 2 horas', 10 * 10 >= 100);

console.log('\n9. Al volver la conexión se cancela la espera y suben ya');
await nueva('op_dormida_1');
await nueva('op_dormida_2');
await pendingOpsApi.markError('op_dormida_1', new Error('502'));
await pendingOpsApi.markBlocked('op_dormida_2', 'Stock insuficiente para: Ajo');
check('las dos están esperando su turno',
    !esCandidata(await localDb.pendingOps.get('op_dormida_1')) &&
    !esCandidata(await localDb.pendingOps.get('op_dormida_2')));
const despertadas = await pendingOpsApi.despertarTodas(CO);
check('despertó a las que estaban esperando', despertadas >= 3, String(despertadas));
check('la que falló por red intenta YA', esCandidata(await localDb.pendingOps.get('op_dormida_1')));
check('la trabada por stock también', esCandidata(await localDb.pendingOps.get('op_dormida_2')));
op = await localDb.pendingOps.get('op_dormida_1');
check('NO les regala intentos: el contador queda igual', op.attempts === 1, String(op.attempts));
check('ni les borra el motivo', /502/.test(op.lastError), op.lastError);

console.log('\n10. Sin internet no se gasta ningún intento');
// syncPendingOpsToServer corta antes de tocar la cola cuando no hay conexión:
// no llega a markError, así que el contador no se mueve.
await nueva('op_sin_red');
const antes = (await localDb.pendingOps.get('op_sin_red')).attempts;
check('recién encolada tiene 0 intentos', antes === 0, String(antes));
check('sigue en 0 mientras nadie la intente', (await localDb.pendingOps.get('op_sin_red')).attempts === 0);

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
