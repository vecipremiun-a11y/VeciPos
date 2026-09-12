// Los kilos de un renglón ya cargado en la factura de pedido (11-sep-2026).
//
// EL CASO. Kevin: "al agregar el pedido del producto se puede poner los kg a
// los productos por kilo, ejemplo 5.6 kg, pero después una vez ir agregando
// para ir creando la factura de pedido luego no se puede editar en gramaje…
// solo puedo poner 1 y el punto, luego más de eso no me deja".
//
// LA CAUSA. Dos pantallas decidiendo por su cuenta sobre lo mismo:
//
//   · el formulario de arriba (agregar)  → min=0, step=0.001 → 5,6 entraba
//   · la lista de abajo (editar)         → min=1, step=1, filtro /^\d+$/ y
//                                          Math.floor() → SOLO enteros
//
// Escribir "5." no pasaba el filtro, así que el campo se trababa ahí: el punto
// se veía (el navegador lo muestra) pero el dígito siguiente ya no entraba.
// Para un producto por peso eso obligaba a borrar el renglón y cargarlo de nuevo.
//
// Y el renglón tampoco sabía su unidad: el item guardado no llevaba `unit`, así
// que la lista no tenía cómo distinguir un kilo de un paquete — decía "uds"
// para todo.
//
//   node scripts/optim/test-cantidad-pedido.mjs

import { readFileSync } from 'node:fs';
import {
    esFraccionable, etiquetaUnidad, aCantidad, cantidadValida, CANTIDAD_TECLEABLE,
} from '../../src/lib/unidades.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

console.log('1. Qué se compra por peso');
for (const u of ['kg', 'KG', 'Kilo', 'kilos', 'gr', 'g', 'lt', 'litro', 'ml']) {
    check(`"${u}" va por peso`, esFraccionable(u) === true);
}
for (const u of ['Und', 'und', 'UND', 'caja', '', null, undefined]) {
    check(`"${u}" va por unidad`, esFraccionable(u) === false);
}

console.log('\n2. Se puede TIPEAR el paso intermedio sin que se trabe');
// Era exactamente lo que fallaba: el filtro viejo (/^\d+$/) rechazaba "5." y
// el campo quedaba clavado ahí.
for (const t of ['', '5', '5.', '5,', '5.6', '5,6', '0.5', '10.417']) {
    check(`"${t}" se puede escribir`, CANTIDAD_TECLEABLE.test(t) === true);
}
for (const t of ['abc', '5.6.7', '-2', '5 6']) {
    check(`"${t}" no`, CANTIDAD_TECLEABLE.test(t) === false);
}

console.log('\n3. La coma vale lo mismo que el punto');
// El teclado numérico del teléfono en Chile ofrece las dos (se ve en la captura).
check('"5,6" son 5.6', aCantidad('5,6') === 5.6, String(aCantidad('5,6')));
check('"5.6" también', aCantidad('5.6') === 5.6, String(aCantidad('5.6')));
check('"10,417" son 10.417', aCantidad('10,417') === 10.417, String(aCantidad('10,417')));

console.log('\n4. La cantidad final, según la unidad');
check('5,6 kg quedan 5.6', cantidadValida('5,6', 'kg') === 5.6, String(cantidadValida('5,6', 'kg')));
check('0,5 kg es medio kilo', cantidadValida('0.5', 'kg') === 0.5, String(cantidadValida('0.5', 'kg')));
check('10,417 kg se guardan enteros', cantidadValida('10,417', 'Kg') === 10.417, String(cantidadValida('10,417', 'Kg')));
check('2,5 paquetes se redondean a 3', cantidadValida('2.5', 'Und') === 3, String(cantidadValida('2.5', 'Und')));
check('0,4 paquetes no bajan de 1', cantidadValida('0.4', 'Und') === 1, String(cantidadValida('0.4', 'Und')));
check('12 unidades siguen siendo 12', cantidadValida('12', 'Und') === 12, String(cantidadValida('12', 'Und')));
check('el campo vacío no vale', cantidadValida('', 'kg') === null);
check('cero no vale', cantidadValida('0', 'kg') === null);
check('texto no vale', cantidadValida('abc', 'kg') === null);

console.log('\n5. Cómo se nombra la unidad en pantalla');
check('Und se lee "unidad"', etiquetaUnidad('Und') === 'unidad');
check('Kg se lee "kg"', etiquetaUnidad('Kg') === 'kg');
check('sin unidad, "unidad"', etiquetaUnidad(null) === 'unidad');

console.log('\n6. Que la pantalla no vuelva a decidir por su cuenta');
const pantalla = readFileSync('src/pages/Orders.jsx', 'utf8');
check('el campo de la lista ya no fuerza step="1"',
    !/step="1"\s*\n?\s*value=\{orderItemQuantityDrafts/.test(pantalla));
check('step sale de la unidad del renglón',
    /step=\{esFraccionable\(unidadDelItem\(item\)\)/.test(pantalla));
check('min también',
    /min=\{esFraccionable\(unidadDelItem\(item\)\)/.test(pantalla));
check('ya no hay Math.floor sobre la cantidad del renglón',
    !/Math\.floor\(Number\(draftValue\)\)/.test(pantalla));
// Se busca el filtro APLICADO, no el texto suelto: el comentario que explica
// el arreglo menciona el viejo /^\d+$/ y hacía fallar la comprobación.
check('ya no filtra la cantidad con /^\\d+$/',
    !/\/\^\\d\+\$\/\s*\.test\(/.test(pantalla));
check('el cartelito ya no dice "uds" fijo',
    !/>uds</.test(pantalla));
check('el renglón guarda su unidad al agregarse',
    /unit: selectedProduct\.unit \|\| 'Und'/.test(pantalla));
check('las dos pantallas usan la MISMA definición',
    /from '\.\.\/lib\/unidades'/.test(pantalla));

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exitCode = fallas === 0 ? 0 : 1;
