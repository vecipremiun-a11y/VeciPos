// Qué cuenta como "sin internet" y qué NO (4-sep-2026).
//
// El problema: el sistema metía tres cosas distintas en la misma bolsa —no hay
// internet, el servidor está lento, la base no contesta— y ante cualquiera de
// las tres se declaraba "sin conexión". Resultado: el POS mandaba ventas a la
// cola con el internet andando perfecto y mostraba un cartel que mentía.
//
// Entre el 23-ago y el 4-sep el latido pedía `?db=1` y exigía que la base
// contestara en 3 segundos. Se puso por una caída real (Turso tardando 9-24 s),
// pero metió a la base dentro de la definición de "hay internet", que son cosas
// distintas. Para eso está el botón de modo offline: ahí decide la persona que
// mira la caja, que es la única que puede distinguir "va lento" de "no anda".
//
//   node scripts/optim/test-que-es-sin-internet.mjs

import { readFileSync } from 'node:fs';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const fuente = readFileSync('src/lib/conectividad.js', 'utf8');
// Se ignoran los comentarios: explican la historia y nombran cosas que ya no se usan.
const codigo = fuente
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
    .join('\n');

console.log('1. El latido ya NO le pregunta a la base');
check('no pide ?db=1', !/PING_URL\s*=\s*'[^']*db=1/.test(codigo), (codigo.match(/const PING_URL = '[^']*'/) || [])[0]);
check('no mira `db === false` para declarar la caída', !/\.db\s*===\s*false/.test(codigo));
check('pregunta solo por el servidor', /const PING_URL = '\/api\/ping'/.test(codigo));

console.log('\n2. Un servidor lento no es un servidor caído');
const corte = Number((codigo.match(/const TIMEOUT_MS = (\d+)/) || [])[1]);
check('el latido tolera al menos 8 segundos', corte >= 8000, corte + ' ms');

console.log('\n3. Hacen falta dos fallos seguidos, no uno');
const fallos = Number((codigo.match(/const FALLOS_PARA_CAER = (\d+)/) || [])[1]);
check('un microcorte no saca al POS de línea', fallos >= 2, String(fallos));

console.log('\n4. La decisión, caso por caso');
// Réplica de lo que decide hoy el sistema.
const declaraOffline = (situacion) => {
    if (situacion.redDelEquipoCaida) return true;      // el navegador lo dice
    if (situacion.servidorNoContesta) return true;     // dos latidos sin respuesta
    return false;                                      // todo lo demás: NO
};

check('se cayó la red del equipo → offline', declaraOffline({ redDelEquipoCaida: true }));
check('el servidor no contesta nada → offline', declaraOffline({ servidorNoContesta: true }));
check('WiFi prendido pero sin internet → offline', declaraOffline({ servidorNoContesta: true }));

check('la BASE tarda 20 s pero el servidor contesta → NO offline',
    declaraOffline({ baseLenta: true }) === false);
check('una consulta mal indexada tarda 49 s → NO offline',
    declaraOffline({ consultaLenta: true }) === false);
check('el sistema se siente colgado → NO offline',
    declaraOffline({ sistemaColgado: true }) === false);
check('la venta tardó más de la cuenta → NO offline',
    declaraOffline({ ventaLenta: true }) === false);

console.log('\n5. Para esos casos está el botón, y el cartel lo dice');
const aviso = readFileSync('src/components/AvisoSinConexion.jsx', 'utf8');
check('el cartel distingue quién lo decidió', /porDecision/.test(aviso));
check('si lo puso la persona, no dice "sin conexión"', /Modo offline puesto por vos/.test(aviso));
check('si se cayó de verdad, sí lo dice', /Sin conexión · Podés seguir vendiendo/.test(aviso));

console.log('\n6. Y la venta ya no le pregunta al latido');
const store = readFileSync('src/store/useStore.js', 'utf8');
const decision = store.slice(store.indexOf('const irDirectoALaCola'), store.indexOf('const irDirectoALaCola') + 260);
check('mira el modo manual', /esOfflineManual\(\)/.test(decision), decision.split('\n')[1]?.trim());
check('y la red del equipo', /navigator\.onLine === false/.test(decision));
check('NO consulta el latido', !/hayConexion\(\)/.test(decision) && !/sinInternet\(\)/.test(decision));

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
