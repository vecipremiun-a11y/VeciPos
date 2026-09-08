// ¿La compra suma el stock al producto? (6-sep-2026)
//
// Reportado por Kevin: al subir una factura de compra, el stock comprado no
// llega al inventario del producto —y sospecha que el precio y el IVA tampoco—.
//
// Esto corre el purchaseCreate REAL contra una base local, sin suposiciones.
//
//   node scripts/optim/test-compra-stock.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { purchaseActions } from '../../api/_lib/purchaseActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'compra-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const session = { uid: 7, username: 'jefe' };

const prod = async (id) => (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];
const lotesDe = async (id) => (await db.execute({ sql: 'SELECT * FROM product_lots WHERE product_id = ?', args: [id] })).rows;

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'jefe', 'x', 'Jefe', 'Administrador', 'acme');
        INSERT INTO suppliers (id, company_id, name) VALUES (1, 'acme', 'Distribuidora Sur');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (100, 'acme', 'Aceite 1L', 'ACE-1L', 2000, 1200, 5, 19, 'Und', 'Abarrotes');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (101, 'acme', 'Arroz 1kg', 'ARR-1K', 1500, 900, 0, 19, 'Und', 'Abarrotes');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (102, 'acme', 'Fideo 400g', 'FID-400', 900, 500, -8, 19, 'Und', 'Abarrotes');
    `);

    const compra = (items, extra = {}) => ({
        supplierId: 1, supplierName: 'Distribuidora Sur', invoiceNumber: 'F-001',
        date: '2026-09-06T12:00:00.000Z', total: 100000, paymentMethod: 'Efectivo', ...extra, items,
    });

    console.log('1. El stock sube con lo comprado');
    const antes = Number((await prod(100)).stock);
    let r = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ id: 100, name: 'Aceite 1L', sku: 'ACE-1L', quantity: 12, cost: 1300, price: 2200, tax: 19, total: 15600 }]),
    });
    check('la compra se registra', r.success === true, r.error || '');
    check(`el stock pasa de ${antes} a ${antes + 12}`, Number((await prod(100)).stock) === antes + 12, String((await prod(100)).stock));

    console.log('\n2. El costo, el precio, el SKU y el IVA también se actualizan');
    const p = await prod(100);
    check('costo actualizado', Number(p.cost) === 1300, String(p.cost));
    check('precio actualizado', Number(p.price) === 2200, String(p.price));
    check('SKU actualizado', p.sku === 'ACE-1L', String(p.sku));
    check('IVA actualizado', Number(p.tax_rate) === 19, String(p.tax_rate));
    check('proveedor anotado', p.supplier === 'Distribuidora Sur', String(p.supplier));

    console.log('\n3. Se crea el lote, y coincide con lo comprado');
    const l = await lotesDe(100);
    check('un lote', l.length === 1, l.length + ' lotes');
    check('con la cantidad comprada', Number(l[0].quantity) === 12, String(l[0].quantity));
    check('enlazado a la compra', Number(l[0].purchase_id) === Number(r.purchaseId), String(l[0].purchase_id));

    console.log('\n4. El stock del producto NUNCA queda por debajo de sus lotes');
    // Es la regla que usa la venta: legacyStock = max(0, stock - sumaLotes).
    // Si el stock queda por debajo, el sistema se contradice a sí mismo.
    const enLotes = (await lotesDe(100)).reduce((s, x) => s + Number(x.quantity), 0);
    check('stock >= lo que dicen los lotes', Number((await prod(100)).stock) >= enLotes, `${(await prod(100)).stock} vs ${enLotes}`);

    console.log('\n5. Producto que estaba en cero');
    r = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ id: 101, name: 'Arroz 1kg', sku: 'ARR-1K', quantity: 30, cost: 950, price: 1600, tax: 19, total: 28500 }], { invoiceNumber: 'F-002' }),
    });
    check('queda en 30', Number((await prod(101)).stock) === 30, String((await prod(101)).stock));

    console.log('\n6. Producto que estaba NEGATIVO (se vendió sin stock)');
    r = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ id: 102, name: 'Fideo 400g', sku: 'FID-400', quantity: 20, cost: 520, price: 950, tax: 19, total: 10400 }], { invoiceNumber: 'F-003' }),
    });
    check('de -8 pasa a 12, no a 20', Number((await prod(102)).stock) === 12, String((await prod(102)).stock));
    const l102 = await lotesDe(102);
    check('pero el lote dice 20', Number(l102[0].quantity) === 20, String(l102[0].quantity));
    check('>>> ACÁ el stock QUEDA por debajo del lote', Number((await prod(102)).stock) < Number(l102[0].quantity),
        `stock ${(await prod(102)).stock} < lote ${l102[0].quantity}`);

    console.log('\n7. Una compra de varios items los actualiza a todos');
    const s100 = Number((await prod(100)).stock), s101 = Number((await prod(101)).stock);
    r = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([
            { id: 100, name: 'Aceite 1L', sku: 'ACE-1L', quantity: 6, cost: 1350, price: 2300, tax: 19, total: 8100 },
            { id: 101, name: 'Arroz 1kg', sku: 'ARR-1K', quantity: 10, cost: 960, price: 1650, tax: 19, total: 9600 },
        ], { invoiceNumber: 'F-004' }),
    });
    check('el primero sube', Number((await prod(100)).stock) === s100 + 6, String((await prod(100)).stock));
    check('el segundo también', Number((await prod(101)).stock) === s101 + 10, String((await prod(101)).stock));

    console.log('\n8. Un item cuyo producto NO existe: tiene que avisar');
    // Antes: la compra decía "listo", creaba un lote colgado de un producto
    // inexistente y esa mercadería no llegaba a ningún inventario, sin un solo
    // aviso. Por acá se perdía mercadería en silencio.
    const r8 = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ id: 99999, name: 'Fantasma', sku: 'X', quantity: 5, cost: 100, price: 200, tax: 19, total: 500 }], { invoiceNumber: 'F-005' }),
    });
    check('la factura igual queda registrada', r8.success === true, String(r8.success));
    const lotesHuerfanos = (await db.execute({ sql: 'SELECT COUNT(*) n FROM product_lots WHERE product_id = 99999', args: [] })).rows[0].n;
    check('YA NO crea el lote huérfano', Number(lotesHuerfanos) === 0, lotesHuerfanos + ' lotes huérfanos');
    check('avisa qué renglón no entró', r8.itemsSinAplicar?.length === 1, JSON.stringify(r8.itemsSinAplicar));
    check('con el nombre, para poder buscarlo', r8.itemsSinAplicar[0].name === 'Fantasma', r8.itemsSinAplicar[0].name);
    check('con la cantidad que no entró', Number(r8.itemsSinAplicar[0].quantity) === 5, String(r8.itemsSinAplicar[0].quantity));
    check('y el motivo en castellano', /ya no existe/.test(r8.itemsSinAplicar[0].motivo), r8.itemsSinAplicar[0].motivo);

    console.log('\n8b. Un renglón sin producto asociado');
    const r8b = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ name: 'Renglón suelto de la factura', quantity: 3, cost: 100, price: 200, tax: 19, total: 300 }], { invoiceNumber: 'F-005b' }),
    });
    check('también avisa', r8b.itemsSinAplicar?.length === 1, JSON.stringify(r8b.itemsSinAplicar));
    check('con su propio motivo', /no quedó asociado/.test(r8b.itemsSinAplicar[0].motivo), r8b.itemsSinAplicar[0].motivo);

    console.log('\n8c. Factura mezclada: lo bueno entra igual');
    const sBueno = Number((await prod(100)).stock);
    const r8c = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([
            { id: 100, name: 'Aceite 1L', sku: 'ACE-1L', quantity: 4, cost: 1400, price: 2400, tax: 19, total: 5600 },
            { id: 88888, name: 'Otro fantasma', sku: 'Y', quantity: 9, cost: 100, price: 200, tax: 19, total: 900 },
        ], { invoiceNumber: 'F-005c' }),
    });
    check('el producto que sí existe entra', Number((await prod(100)).stock) === sBueno + 4, String((await prod(100)).stock));
    check('y avisa solo del otro', r8c.itemsSinAplicar?.length === 1 && r8c.itemsSinAplicar[0].id === 88888,
        JSON.stringify(r8c.itemsSinAplicar));
    check('no se cuela un lote del fantasma',
        Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM product_lots WHERE product_id = 88888', args: [] })).rows[0].n) === 0);

    console.log('\n8d. Cuando entra todo, el aviso viene vacío (no ausente)');
    const r8d = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ id: 100, name: 'Aceite 1L', sku: 'ACE-1L', quantity: 1, cost: 1400, price: 2400, tax: 19, total: 1400 }], { invoiceNumber: 'F-005d' }),
    });
    check('el campo existe siempre', Array.isArray(r8d.itemsSinAplicar), typeof r8d.itemsSinAplicar);
    check('y viene vacío', r8d.itemsSinAplicar.length === 0, String(r8d.itemsSinAplicar.length));

    console.log('\n9. Cantidad como texto (lo que manda un formulario)');
    const s = Number((await prod(101)).stock);
    await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: compra([{ id: 101, name: 'Arroz 1kg', sku: 'ARR-1K', quantity: '7', cost: 960, price: 1650, tax: 19, total: 6720 }], { invoiceNumber: 'F-006' }),
    });
    check('suma igual con la cantidad en texto', Number((await prod(101)).stock) === s + 7, String((await prod(101)).stock));

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
