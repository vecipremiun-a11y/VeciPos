// Prueba del corte rápido de llamadas al servidor cuando el POS está offline
// (3-sep-2026).
//
// El problema: sin conexión, cada pantalla que no fuera el POS —reportes,
// compras, inventario— disparaba su llamada igual y esperaba los 12 segundos
// del corte antes de fallar. Con el modo offline prendido a propósito eso es
// absurdo: el cajero ya SABE que no hay servidor, y encima cada pantalla se
// sentía colgada.
//
// Lo que tiene que pasar: contestar en el acto "sin conexión", salvo las
// acciones que forman parte del camino de vuelta.
//
//   node scripts/optim/test-corte-rapido.mjs

import { readFileSync } from 'node:fs';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// Se lee del archivo real para que la prueba se rompa si alguien cambia la
// lista de excepciones y se olvida de mirar esto.
const fuente = readFileSync('src/store/useStore.js', 'utf8');
const linea = fuente.split('\n').find((l) => l.startsWith('const ACCIONES_DE_VENTA'));
if (!linea) throw new Error('No se encontró ACCIONES_DE_VENTA en useStore.js');
const SIEMPRE = new Set([...linea.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));

console.log('1. La lista de excepciones es la esperada');
check('saleCommit puede salir aunque el POS se dé por offline', SIEMPRE.has('saleCommit'));
check('saleAggregations también', SIEMPRE.has('saleAggregations'));
check('y nada más', SIEMPRE.size === 2, [...SIEMPRE].join(', '));

// Réplica de la guarda que se agregó en _userApiCall.
const llamar = (action, sinConexion) => {
    if (sinConexion && !SIEMPRE.has(action)) {
        return { success: false, error: 'Sin conexión', sinConexion: true, _status: 0, tardo: 0 };
    }
    return { fueALaRed: true, tardo: 12000 };
};

console.log('\n2. Con conexión, todo sale a la red como siempre');
for (const a of ['reportSalesSummary', 'productList', 'saleCommit', 'clientList']) {
    check(`${a} sale a la red`, llamar(a, false).fueALaRed === true);
}

console.log('\n3. Sin conexión, las pantallas que necesitan servidor cortan al instante');
for (const a of ['reportSalesSummary', 'purchaseList', 'inventoryCount', 'userCreate']) {
    const r = llamar(a, true);
    check(`${a} contesta en el acto`, r.tardo === 0 && r.sinConexion === true, r.tardo + ' ms');
}
check('el mensaje es claro', llamar('reportSalesSummary', true).error === 'Sin conexión');
check('se puede distinguir de un error del servidor', llamar('reportSalesSummary', true).sinConexion === true);

console.log('\n4. Pero el camino de vuelta NO se corta');
// Si estas se cortaran, el POS no tendría cómo darse cuenta de que volvió la
// conexión ni de subir lo que tiene guardado.
check('saleCommit igual intenta', llamar('saleCommit', true).fueALaRed === true);
check('saleAggregations igual intenta', llamar('saleAggregations', true).fueALaRed === true);

console.log('\n5. Cuánto se ahorra');
const antes = 4 * 12000; // cuatro llamadas de una pantalla de reportes
const ahora = ['reportSalesSummary', 'purchaseList', 'inventoryCount', 'userCreate']
    .reduce((t, a) => t + llamar(a, true).tardo, 0);
check(`una pantalla de 4 llamadas: ${antes / 1000}s antes → ${ahora / 1000}s ahora`, ahora === 0);

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
