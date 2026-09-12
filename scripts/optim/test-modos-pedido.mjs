// Las tres formas de cargar un renglón de pedido (11-sep-2026).
//
// Kevin pidió el tercero: "cuando compro un producto y solo tengo el precio, y
// luego me dicen el total, quiero que se calcule la cantidad comprada". Es el
// caso de la feria: el proveedor cobra por kilo y al final dice el monto, sin
// decir cuánto pesó. Antes había que hacer la división aparte, con la
// calculadora del teléfono, y escribir el resultado a mano.
//
// Son tres datos atados por una multiplicación —costo × cantidad = total— así
// que con dos cualquiera sale el tercero. Cada modo despeja uno:
//
//     POR UNIDAD   costo + cantidad → TOTAL
//     POR CAJA     total + cantidad → COSTO
//     POR PAGADO   costo + total    → CANTIDAD    ← el nuevo
//
// Se prueba la cuenta sola, sin levantar la pantalla: es plata, y una división
// mal redondeada se arrastra al costo del producto y de ahí al precio de venta.
//
//   node scripts/optim/test-modos-pedido.mjs

import {
    resolverLinea, dosDecimales, tresDecimales,
    MODO_UNIDAD, MODO_TOTAL, MODO_CANTIDAD,
} from '../../src/lib/calculoPedido.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

console.log('1. POR UNIDAD — costo y cantidad dan el total');
let r = resolverLinea({ modo: MODO_UNIDAD, bruto: '2000', cantidad: '12', tasa: 0, porPeso: true });
check('$2.000 el kilo × 12 kg = $24.000', r.campo === 'total' && r.total === 24000, String(r.total));
r = resolverLinea({ modo: MODO_UNIDAD, bruto: '456.14', cantidad: '1', tasa: 0, porPeso: true });
check('el caso de la captura: $456,14 × 1 = $456,14', r.total === 456.14, String(r.total));
r = resolverLinea({ modo: MODO_UNIDAD, bruto: '2000', cantidad: '', tasa: 0 });
check('sin cantidad no inventa un total', r.total === '', JSON.stringify(r.total));

console.log('\n2. POR CAJA — total y cantidad dan el costo');
r = resolverLinea({ modo: MODO_TOTAL, total: '25000', cantidad: '12', tasa: 0, porPeso: true });
check('$25.000 ÷ 12 kg = $2.083,33 el kilo', r.campo === 'costo' && r.bruto === 2083.33, String(r.bruto));
r = resolverLinea({ modo: MODO_TOTAL, total: '11900', cantidad: '10', tasa: 19 });
check('con IVA 19%: bruto $1.190 y neto $1.000', r.bruto === 1190 && r.neto === 1000, `${r.bruto} / ${r.neto}`);
r = resolverLinea({ modo: MODO_TOTAL, total: '25000', cantidad: '0', tasa: 0 });
check('cantidad cero no divide por cero', r.bruto === '', JSON.stringify(r.bruto));

console.log('\n3. POR PAGADO — costo y total dan la cantidad (lo nuevo)');
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '2000', total: '25000', tasa: 0, porPeso: true });
check('$2.000 el kilo, pagué $25.000 → 12,5 kg', r.campo === 'cantidad' && r.cantidad === 12.5, String(r.cantidad));
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '2000', total: '20834', tasa: 0, porPeso: true });
check('$20.834 → 10,417 kg (tres decimales)', r.cantidad === 10.417, String(r.cantidad));
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '456.14', total: '4561.4', tasa: 0, porPeso: true });
check('el producto de la captura: $4.561,40 → 10 kg', r.cantidad === 10, String(r.cantidad));

console.log('\n4. Lo que se compra por unidad no da fracciones');
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '2000', total: '25000', tasa: 0, porPeso: false });
check('12,5 paquetes se redondean a 13', r.cantidad === 13, String(r.cantidad));
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '2000', total: '24000', tasa: 0, porPeso: false });
check('12 paquetes justos siguen siendo 12', r.cantidad === 12, String(r.cantidad));
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '2000', total: '500', tasa: 0, porPeso: false });
check('menos de un paquete no baja de 1', r.cantidad === 1, String(r.cantidad));

console.log('\n5. El impuesto: se divide por el costo CON IVA, que es lo que se paga');
// Si se dividiera por el neto darían un 19% más de kilos de los que hubo.
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '1190', total: '11900', tasa: 19, porPeso: true });
check('$1.190 el kilo con IVA, pagué $11.900 → 10 kg', r.cantidad === 10, String(r.cantidad));
check('   (dividir por el neto de $1.000 habría dado 11,9)', r.cantidad !== 11.9);

console.log('\n6. Datos incompletos no inventan nada');
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '', total: '25000', tasa: 0 });
check('sin costo no hay cantidad', r.cantidad === '', JSON.stringify(r.cantidad));
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '2000', total: '', tasa: 0 });
check('sin total tampoco', r.cantidad === '', JSON.stringify(r.cantidad));
r = resolverLinea({ modo: MODO_CANTIDAD, bruto: '0', total: '25000', tasa: 0 });
check('costo cero no divide por cero', r.cantidad === '', JSON.stringify(r.cantidad));

console.log('\n7. Las tres cuentas cierran entre sí');
// Ida y vuelta: lo que da un modo tiene que poder deshacerse con otro.
const costo = 2000, kilos = 12.5;
const ida = resolverLinea({ modo: MODO_UNIDAD, bruto: String(costo), cantidad: String(kilos), tasa: 0, porPeso: true });
const vuelta = resolverLinea({ modo: MODO_CANTIDAD, bruto: String(costo), total: String(ida.total), tasa: 0, porPeso: true });
check('costo × cantidad → total → ÷ costo → la misma cantidad',
    vuelta.cantidad === kilos, `${kilos} → $${ida.total} → ${vuelta.cantidad}`);
const otra = resolverLinea({ modo: MODO_TOTAL, total: String(ida.total), cantidad: String(kilos), tasa: 0, porPeso: true });
check('y el total ÷ cantidad devuelve el costo', otra.bruto === costo, `$${otra.bruto}`);

console.log('\n8. Redondeos');
check('la plata va a dos decimales', dosDecimales(2083.3333) === 2083.33, String(dosDecimales(2083.3333)));
check('los kilos a tres', tresDecimales(10.41666) === 10.417, String(tresDecimales(10.41666)));

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exitCode = fallas === 0 ? 0 : 1;
