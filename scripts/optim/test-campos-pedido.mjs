// Campos que la pantalla lee y la consulta nunca devuelve (11-sep-2026).
//
// EL CASO. Kevin: "ninguna imagen me carga en la app cuando estoy realizando
// pedido". La versión móvil del detalle de producto leía `image_url`, un campo
// que NO EXISTE: la columna se llama `image`. Caía siempre al ícono gris, con
// foto o sin foto, con internet o sin internet. La versión de escritorio del
// MISMO modal usaba `image`, y por eso en la web se veía y en la app no.
//
// Buscando alrededor aparecieron dos más del mismo tipo, y estas fallaban en
// los dos lados. Comprobado contra la base real con los productos de sus
// capturas:
//
//     Ajo (107102) → proveedor "Terminal Agropecuario", categoría "Verduras y Frutas"
//     Peregil      → proveedor "Terminal Agropecuario", categoría "Verdura Fresca"
//
// y la pantalla decía "Sin proveedor" y "Sin categoría" para los dos, porque
// buscaba por `supplier_id` / `category_id` — ids que esa consulta no devuelve.
//
// Esta prueba compara lo que la pantalla LEE contra lo que la consulta DEVUELVE.
// Es estática: no necesita base ni red.
//
//   node scripts/optim/test-campos-pedido.mjs

import { readFileSync } from 'node:fs';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const pantalla = readFileSync('src/pages/Orders.jsx', 'utf8');
const reportes = readFileSync('api/_lib/reportActions.js', 'utf8');

// ── Lo que devuelve productsForOrder ─────────────────────────────────────
console.log('1. Columnas que devuelve la consulta');
const bloque = reportes.slice(reportes.indexOf('productsForOrder:'));
const select = bloque.slice(bloque.indexOf('SELECT'), bloque.indexOf('FROM products'));
const columnas = new Set(
    select
        .replace(/SELECT/, '')
        .replace(/CASE[\s\S]*?AS\s+(\w+)/gi, '$1')   // el CASE ... AS has_image
        .split(',')
        .map(c => c.trim().split(/\s+/).pop().replace(/[^a-z_]/gi, ''))
        .filter(Boolean)
);
check('la consulta devuelve algo', columnas.size > 5, [...columnas].join(', '));
check('devuelve `image`? NO (es la foto, pesa megas y va aparte)', !columnas.has('image'));
check('devuelve `has_image` para saber cuáles pedir', columnas.has('has_image'));

// ── Lo que lee la pantalla ───────────────────────────────────────────────
console.log('\n2. Campos que la pantalla lee del producto elegido');
const leidos = [...new Set(
    [...pantalla.matchAll(/selectedProduct\.([a-z_]+)/g)].map(m => m[1])
)].sort();
console.log(`   ${leidos.join(', ')}`);

// Campos que se completan DESPUÉS de la consulta y por eso no están en el
// SELECT. Cada uno con quién lo pone: si mañana alguien saca ese código, este
// listado queda mintiendo y conviene que se note acá.
const AGREGADOS_DESPUES = {
    image: 'lo mezcla traerFotos() tras pedir productImages',
};
// Campos que la pantalla mira sabiendo que pueden no venir (render condicional
// o valor por defecto). No son errores, pero tampoco muestran datos reales.
const OPCIONALES = {
    barcode: 'no existe la columna; la fila no se dibuja (el código de barras es el sku)',
    min_stock: 'no existe la columna; siempre muestra el valor por defecto 5',
    category_id: 'solo como respaldo en nombreCategoria()',
    supplier_id: 'solo como respaldo en nombreProveedor()',
};

console.log('\n3. ¿Lee algo que nadie le da?');
for (const campo of leidos) {
    if (columnas.has(campo)) { check(`${campo}`, true, 'viene en la consulta'); continue; }
    if (AGREGADOS_DESPUES[campo]) { check(`${campo}`, true, AGREGADOS_DESPUES[campo]); continue; }
    if (OPCIONALES[campo]) { check(`${campo}`, true, 'opcional: ' + OPCIONALES[campo]); continue; }
    check(`${campo}`, false, 'NADIE se lo da: siempre va a salir vacío');
}

// ── Lo concreto que se rompió ────────────────────────────────────────────
console.log('\n4. Los tres que estaban mal');
check('ya no se lee `image_url` (no existe en un producto)',
    !/selectedProduct\.image_url/.test(pantalla));
check('la tarjeta del teléfono usa `selectedProduct.image`',
    /selectedProduct\.image \?/.test(pantalla));
check('el proveedor sale del nombre, no de un id inexistente',
    !/getSupplierName\(selectedProduct\.supplier_id\)/.test(pantalla));
check('la categoría también',
    !/getCategoryName\(selectedProduct\.category_id\)/.test(pantalla));

console.log('\n5. Que escritorio y teléfono lean lo MISMO');
// El origen del problema: dos copias del mismo modal, una por tamaño de
// pantalla, que se fueron separando. Lo que importa es que no queden campos
// que solo uno de los dos sabe leer.
const usosImagen = [...pantalla.matchAll(/selectedProduct\.image\b/g)].length;
check('las dos versiones leen la foto del mismo campo', usosImagen >= 2, `${usosImagen} usos`);

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exitCode = fallas === 0 ? 0 : 1;
