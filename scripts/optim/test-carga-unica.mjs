// El catálogo del POS se pinta UNA vez, no dos (5-sep-2026).
//
// El problema: al entrar a Ventas se veían los productos, la pantalla se
// sacudía entera y las fotos se recargaban. La grilla pintaba PRIMERO lo
// guardado en el equipo y DESPUÉS repintaba con lo del servidor. La idea era
// que nunca apareciera vacía, pero el efecto era el contrario: dos cargas para
// mostrar lo mismo, y lo guardado encima puede tener stock y precios viejos.
//
// Ahora, con conexión, se va derecho al servidor. Lo guardado es la red de
// seguridad —sin conexión, o si el servidor no contesta—, no el primer paso.
//
//   node scripts/optim/test-carga-unica.mjs

import { readFileSync } from 'node:fs';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// Réplica de la decisión, con un contador de cuántas veces se pinta la grilla.
function cargar({ hayConexion, servidorContesta, hayGuardado }) {
    const pintadas = [];
    const pintar = (de) => pintadas.push(de);
    const desdeLoGuardado = () => { if (hayGuardado) { pintar('guardado'); return true; } return false; };

    if (!hayConexion) { desdeLoGuardado(); return pintadas; }
    if (servidorContesta) { pintar('servidor'); return pintadas; }
    desdeLoGuardado();
    return pintadas;
}

console.log('1. Con conexión: UNA pintada, y del servidor');
let p = cargar({ hayConexion: true, servidorContesta: true, hayGuardado: true });
check('se pinta una sola vez', p.length === 1, p.join(' → '));
check('y con lo del servidor', p[0] === 'servidor', p[0]);
check('NO se pinta lo guardado primero', !p.includes('guardado'));

console.log('\n2. Sin conexión: UNA pintada, y de lo guardado');
p = cargar({ hayConexion: false, servidorContesta: true, hayGuardado: true });
check('se pinta una sola vez', p.length === 1, p.join(' → '));
check('y con lo guardado', p[0] === 'guardado', p[0]);

console.log('\n3. Con conexión pero el servidor falla: cae a lo guardado');
p = cargar({ hayConexion: true, servidorContesta: false, hayGuardado: true });
check('se pinta una sola vez', p.length === 1, p.join(' → '));
check('con lo guardado, que es lo único que hay', p[0] === 'guardado');

console.log('\n4. Equipo recién instalado, sin nada guardado');
p = cargar({ hayConexion: false, servidorContesta: true, hayGuardado: false });
check('no pinta una lista vacía mentirosa', p.length === 0, p.join(' → '));
p = cargar({ hayConexion: true, servidorContesta: false, hayGuardado: false });
check('servidor caído y sin catálogo: tampoco inventa nada', p.length === 0);

console.log('\n5. Nunca se pinta dos veces, en ninguna combinación');
for (const conexion of [true, false]) {
    for (const servidor of [true, false]) {
        for (const guardado of [true, false]) {
            const r = cargar({ hayConexion: conexion, servidorContesta: servidor, hayGuardado: guardado });
            if (r.length > 1) {
                check(`conexión=${conexion} servidor=${servidor} guardado=${guardado}`, false, r.join(' → '));
            }
        }
    }
}
check('las ocho combinaciones pintan como mucho una vez', true);

console.log('\n6. El código real ya no pinta lo guardado antes de preguntar');
const store = readFileSync('src/store/useStore.js', 'utf8');
const desdeGrilla = store.indexOf('loadCategoryProducts: async');
const grilla = store.slice(desdeGrilla, store.indexOf('\n    },', desdeGrilla + 100));
const iGuardado = grilla.indexOf('if (sinInternet()) return desdeLoGuardado();');
const iServidor = grilla.indexOf("reportRows(activeCompanyId, 'categoryProducts'");
check('lo guardado queda detrás de "si no hay internet"', iGuardado > 0, String(iGuardado));
check('y el servidor es el camino normal', iServidor > iGuardado, `${iGuardado} → ${iServidor}`);

const busca = store.slice(store.indexOf('searchProducts: async'), store.indexOf('searchProducts: async') + 2600);
check('el buscador hace lo mismo', /if \(sinInternet\(\)\) \{ await desdeLoGuardado\(\); return; \}/.test(busca));

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
