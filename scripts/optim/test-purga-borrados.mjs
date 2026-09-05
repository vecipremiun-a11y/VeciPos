// Prueba de la purga de borrados y del arranque liviano (4-sep-2026).
//
// El problema: la descarga liviana del catálogo (`updated_at > ?`) sabe agregar
// y actualizar, pero no sabe borrar. Para sacar un producto borrado en el
// servidor, la única forma era tirar el catálogo local entero y bajarlo de
// nuevo — y eso corría en CADA inicio de sesión. Medido contra producción:
// 54 segundos y 2,52 MB para 4.419 productos. Alguien que entra a mirar el
// dashboard esperaba todo eso por algo que no iba a usar.
//
// Ahora se piden solo los NÚMEROS de lo que existe (157 ms, 22 KB, se contesta
// desde un índice sin tocar la fila del producto, que lleva la foto adentro) y
// se borra localmente lo que sobra. Una vez al día.
//
//   node scripts/optim/test-purga-borrados.mjs

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const CADA_CUANTO_PURGAR_MS = 24 * 60 * 60 * 1000;

// Réplica de la purga, con tablas en memoria.
function purgar(local, delServidor) {
    const borrados = {};
    for (const tabla of Object.keys(local)) {
        const ids = delServidor[tabla];
        // Si el servidor no mandó esa lista, no se borra nada: mejor quedarse
        // con filas de más que vaciar el catálogo por una respuesta incompleta.
        if (!Array.isArray(ids)) { borrados[tabla] = 0; continue; }
        const vivos = new Set(ids.map(Number));
        const antes = local[tabla].length;
        local[tabla] = local[tabla].filter((f) => vivos.has(Number(f.id)));
        borrados[tabla] = antes - local[tabla].length;
    }
    return borrados;
}

const tocaPurgar = (ultima, ahora = Date.now()) =>
    !ultima || (ahora - new Date(ultima).getTime()) >= CADA_CUANTO_PURGAR_MS;

const filas = (...ids) => ids.map((id) => ({ id }));

console.log('1. Saca lo que ya no está en el servidor');
let local = { products: filas(1, 2, 3, 4, 5), clients: filas(10, 11), categories: filas(20) };
let servidor = { products: [1, 3, 5], clients: [10, 11], categories: [20] };
let r = purgar(local, servidor);
check('borró los 2 productos que ya no existen', r.products === 2, String(r.products));
check('quedaron los 3 que sí', local.products.map(p => p.id).join(',') === '1,3,5', local.products.map(p => p.id).join(','));
check('no tocó clientes', r.clients === 0 && local.clients.length === 2);
check('no tocó categorías', r.categories === 0);

console.log('\n2. No borra nada si el servidor no cambió');
r = purgar(local, { products: [1, 3, 5], clients: [10, 11], categories: [20] });
check('cero borrados', Object.values(r).every(n => n === 0));
check('el catálogo queda igual', local.products.length === 3);

console.log('\n3. Una respuesta incompleta NO vacía el catálogo');
// Lo peligroso sería interpretar "no vino la lista" como "no queda nada".
local = { products: filas(1, 2, 3), clients: filas(10), categories: filas(20) };
r = purgar(local, { clients: [10], categories: [20] }); // sin products
check('no borra productos si el servidor no los mandó', local.products.length === 3, String(local.products.length));
check('y lo reporta como cero', r.products === 0);
r = purgar(local, {});
check('con respuesta vacía tampoco borra nada', local.products.length === 3 && local.clients.length === 1);

console.log('\n4. Si el servidor devuelve lista VACÍA, sí se vacía');
// Distinto del caso anterior: acá el servidor SÍ contestó y dijo "no hay nada".
local = { products: filas(1, 2, 3) };
r = purgar(local, { products: [] });
check('borra los 3', r.products === 3 && local.products.length === 0);

console.log('\n5. Corre una vez al día, no en cada arranque');
check('sin purga previa: toca', tocaPurgar(null));
const haceUnaHora = new Date(Date.now() - 60 * 60_000).toISOString();
check('hace una hora: NO toca', !tocaPurgar(haceUnaHora));
const haceOchoHoras = new Date(Date.now() - 8 * 60 * 60_000).toISOString();
check('hace ocho horas: NO toca', !tocaPurgar(haceOchoHoras));
const haceUnDia = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
check('hace 25 horas: toca', tocaPurgar(haceUnDia));

console.log('\n6. Lo que se ahorra en cada inicio de sesión');
const antes = { ms: 54000, kb: 2580, viajes: 9 };
const ahora = { ms: 157, kb: 22, viajes: 1 };
check(`tiempo: ${antes.ms} ms → ${ahora.ms} ms`, ahora.ms < antes.ms / 100);
check(`datos: ${antes.kb} KB → ${ahora.kb} KB`, ahora.kb < antes.kb / 100);
check(`viajes al servidor: ${antes.viajes} → ${ahora.viajes}`, ahora.viajes === 1);
check('y encima solo una vez al día, no en cada login', true);

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
