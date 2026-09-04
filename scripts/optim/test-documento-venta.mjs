// Pruebas de "cada venta va con su documento" y del candado del cierre de caja
// (3-sep-2026).
//
// El agujero: la cola solo emitía el DTE si la venta traía un folio offline
// reservado. Cuando los folios se agotaban —justo lo que pasa en una caída
// larga— la venta subía SIN boleta y nadie se enteraba. Y una factura hecha
// offline nunca se podía emitir, porque los datos del receptor no viajaban.
//
//   node scripts/optim/test-documento-venta.mjs

import { localDb, pendingOpsApi } from '../../src/lib/db/localdb.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const filas = new Map();
localDb.pendingOps = {
    async get(id) { return filas.get(id) ? { ...filas.get(id) } : undefined; },
    async put(e) { filas.set(e.tempId, { ...e }); },
    async update(id, c) { const p = filas.get(id); if (!p) return 0; filas.set(id, { ...p, ...c }); return 1; },
    async delete(id) { filas.delete(id); },
    where() { return { equals: (co) => ({ toArray: async () => [...filas.values()].filter(f => f.companyId === co) }) }; },
};

const esCandidata = (o, ahora = Date.now()) => {
    if (o.status === 'queued') return true;
    if (o.status === 'error' && (o.bloqueo || (o.attempts || 0) < 10)) {
        if (!o.nextAttemptAt) return true;
        return new Date(o.nextAttemptAt).getTime() <= ahora;
    }
    return false;
};

const CO = 'default';
const nueva = (tempId, payload) => pendingOpsApi.add({ tempId, companyId: CO, userId: 7, type: 'sale', payload });

console.log('1. Una venta guardada sin su boleta NO se saca de la cola');
await nueva('op_boleta', { total: 1000, tipoDte: 39 });
await pendingOpsApi.markDocPendiente('op_boleta', 1024200, 'No se pudo emitir el documento: sin folios CAF disponibles');
let op = await localDb.pendingOps.get('op_boleta');
check('sigue en la cola', !!op);
check('marcada como documento pendiente', op.docPendiente === true);
check('guarda el número de venta ya creada', op.serverId === 1024200, String(op.serverId));
check('dice el motivo real', /sin folios CAF/.test(op.lastError), op.lastError);
check('NO gasta intentos', (op.attempts || 0) === 0, String(op.attempts || 0));
check('vuelve a intentar sola a los 2 minutos', esCandidata(op, Date.now() + 3 * 60_000));
check('no reintenta al toque', !esCandidata(op, Date.now()));

console.log('\n2. Al lograr el documento, recién ahí desaparece');
await pendingOpsApi.markSynced('op_boleta', 1024200);
check('ya no está en la cola', !(await localDb.pendingOps.get('op_boleta')));

console.log('\n3. Los estados no se pisan entre sí');
await nueva('op_mixta', { total: 500, tipoDte: 39 });
await pendingOpsApi.markDocPendiente('op_mixta', 99, 'falta doc');
await pendingOpsApi.markBlocked('op_mixta', 'Stock insuficiente para: Ajo');
op = await localDb.pendingOps.get('op_mixta');
check('un rechazo por stock limpia la marca de documento', op.docPendiente === false, String(op.docPendiente));
await pendingOpsApi.markDocPendiente('op_mixta', 99, 'falta doc');
await pendingOpsApi.markError('op_mixta', new Error('502'));
op = await localDb.pendingOps.get('op_mixta');
check('un fallo de envío también la limpia', op.docPendiente === false, String(op.docPendiente));
check('y ese sí gasta intento', op.attempts === 1, String(op.attempts));
await pendingOpsApi.markDocPendiente('op_mixta', 99, 'falta doc');
await pendingOpsApi.retry('op_mixta');
op = await localDb.pendingOps.get('op_mixta');
check('reintentar a mano deja todo limpio',
    op.docPendiente === false && op.bloqueo === false && op.attempts === 0 && op.status === 'queued');

console.log('\n4. Qué documento lleva cada venta');
const DTE_CON_DOCUMENTO = new Set([33, 34, 39]);
const llevaDoc = (t) => DTE_CON_DOCUMENTO.has(Number(t ?? 0));
check('Boleta (39) lleva documento', llevaDoc(39));
check('Factura (33) lleva documento', llevaDoc(33));
check('Factura exenta (34) lleva documento', llevaDoc(34));
check('Nota de Venta (0) NO lleva documento SII', !llevaDoc(0));
check('venta sin tipo se trata como Nota de Venta', !llevaDoc(null) && !llevaDoc(undefined));

console.log('\n5. El cierre de caja cuenta solo las ventas del cajero');
filas.clear();
await pendingOpsApi.add({ tempId: 'v_mia_1', companyId: CO, userId: 7, type: 'sale', payload: { total: 100 } });
await pendingOpsApi.add({ tempId: 'v_mia_2', companyId: CO, userId: 7, type: 'sale', payload: { total: 200 } });
await pendingOpsApi.add({ tempId: 'v_otra', companyId: CO, userId: 9, type: 'sale', payload: { total: 300 } });
await pendingOpsApi.add({ tempId: 'v_vieja', companyId: CO, userId: 7, type: 'sale', payload: { total: 400 } });
await pendingOpsApi.markSynced('v_vieja', 1);

// Mismo filtro que usa CashStatusWidget.
const misPendientes = async (uid) => (await pendingOpsApi.list(CO))
    .filter(o => o.status !== 'synced' && (o.userId == null || Number(o.userId) === Number(uid)));

check('el cajero 7 tiene 2 sin subir → NO puede cerrar', (await misPendientes(7)).length === 2,
    String((await misPendientes(7)).length));
check('el cajero 9 tiene 1 sin subir → NO puede cerrar', (await misPendientes(9)).length === 1,
    String((await misPendientes(9)).length));
check('la ya sincronizada no cuenta', !(await misPendientes(7)).some(o => o.tempId === 'v_vieja'));
for (const o of await misPendientes(7)) await pendingOpsApi.markSynced(o.tempId, 1);
check('subidas las suyas, el cajero 7 SÍ puede cerrar', (await misPendientes(7)).length === 0);
check('pero el cajero 9 sigue sin poder', (await misPendientes(9)).length === 1);

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
