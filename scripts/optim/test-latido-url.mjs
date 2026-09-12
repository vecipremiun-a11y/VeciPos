// El latido pedía una ruta que en desarrollo no existe (10-sep-2026).
//
// EL SÍNTOMA. Kevin: "en local me pasa cada rato, se le va la conexión, tengo
// que estar actualizando para trabajar bien; en producción no pasa eso".
//
// LA CAUSA. El monitor le pega un `t=` a la URL del latido para saltear la
// caché. Cuando el latido dejó de pedir `?db=1` (commit fa47a9c) quedó pegando
// `&t=...` sobre una URL que ya no tenía `?`, así que pedía la ruta literal:
//
//     /api/ping&t=1788914912062
//
// Medido contra los dos entornos el 10-sep-2026:
//
//     local (Express)   /api/ping&t=123  ->  404
//     Vercel            /api/ping&t=123  ->  200   (lo salva el rewrite /api/(.*))
//
// O sea: en desarrollo el latido fallaba SIEMPRE. Dos fallos seguidos y el POS
// se declaraba sin conexión solo, cada vez que quedaba 15 segundos quieto.
// Recargar lo devolvía a online un rato —porque las llamadas reales confirman
// la conexión— y a los 15 segundos volvía a caerse. En producción no se notó
// nunca, y por eso sobrevivió.
//
//   node scripts/optim/test-latido-url.mjs
//
// La parte HTTP necesita los dos servidores de desarrollo levantados
// (npm run dev + npm run dev:api). Si no están, se saltea y avisa.

import { readFileSync } from 'node:fs';
import { conCorta } from '../../src/lib/conectividad.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

console.log('1. Cómo se arma la URL del latido');
const sinQuery = conCorta('/api/ping');
check('sin query usa "?"', /^\/api\/ping\?t=\d+$/.test(sinQuery), sinQuery);
const conQuery = conCorta('/api/ping?db=1');
check('con query usa "&"', /^\/api\/ping\?db=1&t=\d+$/.test(conQuery), conQuery);
check('nunca produce "ping&"', !sinQuery.includes('ping&') && !conQuery.includes('ping&'));

console.log('\n2. Que no vuelva a colarse en el código');
const fuente = readFileSync('src/lib/conectividad.js', 'utf8');
check('no queda ningún `${PING_URL}&`', !/\$\{PING_URL\}&/.test(fuente));

console.log('\n3. Contra el servidor de desarrollo');
const pedir = async (url) => {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return r.status;
    } catch { return null; }
};

const base = 'http://localhost:5173';
const vivo = await pedir(`${base}/api/ping?t=1`);
if (vivo === null) {
    console.log('  (saltado) el servidor de desarrollo no está levantado');
} else {
    check('la URL correcta contesta 200', vivo === 200, String(vivo));
    // La que armaba el código viejo: acá se ve por qué fallaba.
    const roto = await pedir(`${base}/api/ping&t=1`);
    check('la URL rota daba 404 en local (la causa)', roto === 404, String(roto));
    // Y la que arma el código de ahora tiene que andar.
    const ahora = await pedir(base + conCorta('/api/ping'));
    check('la que arma el latido HOY contesta 200', ahora === 200, String(ahora));
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
// `process.exitCode` y no `process.exit()`: cortar de golpe con los sockets de
// `fetch` todavía abiertos hace que Node tire un assert de libuv en Windows al
// salir, y parece un error de la prueba cuando no lo es.
process.exitCode = fallas === 0 ? 0 : 1;
