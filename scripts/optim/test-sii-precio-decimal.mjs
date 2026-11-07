// Boleta y factura con el precio unitario exacto (Kevin, 6-nov-2026).
//
// Una caja de 12 a $18.500 viaja a la venta como 12 unidades a $1.541,666…
// La boleta redondeaba ese precio ANTES de multiplicar: $1.542 × 12 = $18.504.
// El formato del SII admite 6 decimales en el precio unitario (Formato Boletas
// v4.2 y Formato DTE v2.5), así que la boleta puede decir $18.500 exacto.
//
// Arma las boletas y facturas con el código real de api/sii/_sii.js, sin
// timbrar con un CAF real ni mandar nada al SII, y compara lo que dice el
// documento con lo que cobró el POS (precio × cantidad, sin redondear).
//
//   node scripts/optim/test-sii-precio-decimal.mjs

import { buildBoleta, buildFactura, buildFacturaExenta } from '../../api/sii/_sii.js';

// El timbre necesita un CAF de verdad; acá solo importan el detalle y los totales.
const caf = { getCafXml: () => '<CAF/>', sign: () => 'FIRMA' };
const config = { rut_emisor: '76000000-0', razon_social: 'Prueba', giro: 'Comercio' };

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const boleta = (items) => buildBoleta({ items }, config, 1, caf);
const factura = (items) => buildFactura({ items, rut_receptor: '11111111-1' }, config, 1, caf);
const exenta = (items) => buildFacturaExenta({ items, rut_receptor: '11111111-1' }, config, 1, caf);
// Lo que cobra el POS por un renglón (POS.jsx: price × quantity − descuento).
const cobrado = (i) => i.price * i.quantity * (1 - (i.discountPercent || 0) / 100);

console.log('1. La caja de la captura: 12 und a $18.500');
const caja = { name: 'Caja 12', quantity: 12, price: 18500 / 12, tax_rate: 19 };
const b = boleta([caja]);
const det = b.dte.datos.Detalle[0];
check('la boleta suma $18.500, lo mismo que se cobró', b.montoTotal === 18500, `boleta $${b.montoTotal}, PrcItem ${det.PrcItem}`);
check('precio unitario con 6 decimales como máximo', /^\d+(\.\d{1,6})?$/.test(String(det.PrcItem)), String(det.PrcItem));
const xml = b.dte.getXMLSinFirma();
check('el XML lleva <PrcItem>1541.666667</PrcItem> y <MontoItem>18500</MontoItem>',
    xml.includes('<PrcItem>1541.666667</PrcItem>') && xml.includes('<MontoItem>18500</MontoItem>'),
    (xml.match(/<PrcItem>[^<]*<\/PrcItem>|<MontoItem>[^<]*<\/MontoItem>/g) || []).join(' '));
check('IVA y neto suman el total', b.montoNeto + b.montoIva === 18500, `${b.montoNeto} + ${b.montoIva}`);
const f = factura([caja]);
check('factura de la misma caja: total $18.500', f.montoTotal === 18500, `factura $${f.montoTotal}`);

console.log('\n2. Cajas con precio redondo: ¿la boleta dice lo cobrado?');
let cajas = 0, cajasMal = 0;
for (const u of [2, 3, 6, 7, 10, 12, 15, 24, 30, 48]) {
    for (let precio = 1000; precio <= 60000; precio += 100) {
        cajas++;
        if (boleta([{ name: 'C', quantity: u, price: precio / u, tax_rate: 19 }]).montoTotal !== precio) cajasMal++;
    }
}
check(`${cajas} cajas (2 a 48 und, $1.000 a $60.000 de a $100): todas cuadran`, cajasMal === 0, `${cajasMal} no cuadran`);
// Varias cajas en un renglón: 3 cajas de 12 a $18.500 = 36 und.
check('3 cajas en un renglón: $55.500', boleta([{ ...caja, quantity: 36 }]).montoTotal === 55500);
check('100 cajas en un renglón: $1.850.000', boleta([{ ...caja, quantity: 1200 }]).montoTotal === 1850000);

console.log('\n3. Los productos de siempre (precio entero, sin descuento) salen IGUAL que antes');
// Antes: PrcItem = Math.round(precio) y MontoItem = Math.round(PrcItem × cantidad).
const antes = (precio, qty) => Math.round(Math.round(precio) * qty);
let comunes = 0, distintos = 0, xmlDistinto = 0;
for (const precio of [1, 10, 99, 350, 990, 1000, 1290, 2490, 5990, 12990, 99990, 1234567]) {
    for (const qty of [1, 2, 3, 7, 12, 100, 0.25, 0.265, 0.5, 1.5, 2.375, 0.001]) {
        comunes++;
        const r = boleta([{ name: 'P', quantity: qty, price: precio, tax_rate: 19 }]);
        if (r.montoTotal !== antes(precio, qty)) distintos++;
        if (String(r.dte.datos.Detalle[0].PrcItem) !== String(precio)) xmlDistinto++;
    }
}
check(`${comunes} combinaciones (unidades y por peso): mismo total`, distintos === 0, `${distintos} distintos`);
check('y el mismo precio unitario en el XML (sin decimales agregados)', xmlDistinto === 0, `${xmlDistinto} distintos`);
const exe = exenta([{ name: 'P', quantity: 3, price: 1990, tax_rate: 0 }]);
check('factura exenta de siempre igual: $5.970', exe.montoTotal === 5970);

console.log('\n4. Con descuento: la boleta se acerca a lo cobrado');
let desc = 0, descMalAntes = 0, descMalAhora = 0;
for (const precio of [990, 1290, 1999, 2490, 5990]) {
    for (const qty of [1, 2, 3, 6, 12]) {
        for (const d of [5, 10, 15, 33]) {
            desc++;
            const item = { name: 'P', quantity: qty, price: precio, tax_rate: 19, discountPercent: d };
            const pos = Math.round(cobrado(item));
            if (Math.round(precio * (1 - d / 100)) * qty !== pos) descMalAntes++;
            if (boleta([item]).montoTotal !== pos) descMalAhora++;
        }
    }
}
check(`${desc} renglones con descuento: la boleta dice lo cobrado`, descMalAhora === 0, `antes no cuadraban ${descMalAntes}, ahora ${descMalAhora}`);

console.log('\n5. Factura (precios netos): el total se acerca a lo cobrado');
let fac = 0, facMalAntes = 0, facMalAhora = 0, facLejos = 0;
for (const precio of [990, 1000, 1290, 2490, 5990, 18500 / 12]) {
    for (const qty of [1, 2, 3, 6, 12, 24]) {
        fac++;
        const pos = Math.round(precio * qty);
        // Antes: neto unitario redondeado a peso × cantidad.
        const netoAntes = Math.round(Math.round(precio / 1.19) * qty);
        if (netoAntes + Math.round(netoAntes * 0.19) !== pos) facMalAntes++;
        const t = factura([{ name: 'P', quantity: qty, price: precio, tax_rate: 19 }]).montoTotal;
        if (t !== pos) facMalAhora++;
        if (Math.abs(t - pos) > 1) facLejos++;
    }
}
check(`${fac} facturas: ninguna se aleja más de $1 de lo cobrado`, facLejos === 0,
    `no cuadraban exacto: antes ${facMalAntes}, ahora ${facMalAhora} (neto + IVA redondeado, propio de la factura)`);

console.log('\n6. Lo que el XSD del SII no acepta, no sale');
const raros = boleta([
    { name: 'A', quantity: 1, price: 0, tax_rate: 19 },
    { name: 'B', quantity: 3, price: 1 / 3, tax_rate: 19 },
    { name: 'C', quantity: 10, price: 1.15, tax_rate: 19 },
]).dte.datos.Detalle;
check('MontoItem siempre entero', raros.every(d => Number.isInteger(d.MontoItem)), raros.map(d => d.MontoItem).join(', '));
check('PrcItem con 6 decimales como máximo', raros.every(d => /^\d+(\.\d{1,6})?$/.test(String(d.PrcItem))), raros.map(d => d.PrcItem).join(', '));
// 1,15 × 10 en coma flotante da 11,4999…; el SII calcula 11,5 y redondea a 12.
check('1,15 × 10 = 12 (sin el error de la coma flotante)', raros[2].MontoItem === 12, String(raros[2].MontoItem));

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
