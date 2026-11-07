// Otros impuestos del producto, además del IVA (Kevin, 4-nov-2026).
//
// Corre las cuentas de la ficha y el guardado REAL contra una base local.
// No toca ninguna base real.
//
//   node scripts/optim/test-impuestos-producto.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productCreate, productUpdate, syncCatalog } from '../../api/data/actions.js';
import { reportRun, PRODUCT_COLS_SIN_IMAGEN } from '../../api/_lib/reportActions.js';
import { purchaseActions } from '../../api/_lib/purchaseActions.js';
import {
    impuestosExtra, tasaExtra, costoBase, costoConImpuestos,
    precioDesdeMargen, margenDesdePrecio, utilidadPorUnidad,
} from '../../src/lib/impuestosProducto.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};
const cerca = (a, b) => Math.abs(a - b) < 0.005;

const CERDO = [{ name: 'Impuesto cerdo', rate: 5 }];

console.log('1. Las cuentas con el ejemplo de Kevin: costo 430,18 · utilidad 30% · IVA 19% · cerdo 5%');
check('costo + IVA = 511,91', cerca(costoConImpuestos(430.18, 19), 511.9142));
check('costo con todos los impuestos = 533,42 (lo que dice la factura)', cerca(costoConImpuestos(430.18, 19, CERDO), 533.4232));
check('costo base = 451,69', cerca(costoBase(430.18, CERDO), 451.689));
const precio = precioDesdeMargen(430.18, 30, 19, CERDO);
check('precio final = 698,76', cerca(precio, 698.7629), String(precio));
check('volver del precio a la utilidad da 30%', cerca(margenDesdePrecio(precio, 430.18, 19, CERDO), 30));
check('la ganancia por unidad es el 30% del costo base', cerca(utilidadPorUnidad(precio, 430.18, 19, CERDO), 451.689 * 0.3));
check('dos impuestos se suman, sin impuesto sobre impuesto',
    cerca(costoConImpuestos(100, 19, [...CERDO, { name: 'Otro', rate: 10 }]), 134));

console.log('\n2. Sin otros impuestos da EXACTAMENTE lo mismo que las fórmulas de antes');
let distintos = 0;
let casos = 0;
for (const cost of [0.5, 1, 99.99, 430.18, 1234.56, 99999]) {
    for (const margin of [-10, 0, 7.5, 30, 33.33, 200]) {
        for (const tax of [0, 10, 19, 20.5, 31.5]) {
            for (const extras of [undefined, null, '', '[]', []]) {
                casos++;
                const basico = cost * (1 + margin / 100);
                const viejoPrecio = basico * (1 + tax / 100);
                if (precioDesdeMargen(cost, margin, tax, extras) !== viejoPrecio) distintos++;
                const viejoNeto = viejoPrecio / (1 + tax / 100);
                const viejoMargen = ((viejoNeto - cost) / cost) * 100;
                if (margenDesdePrecio(viejoPrecio, cost, tax, extras) !== viejoMargen) distintos++;
                if (costoBase(cost, extras) !== cost) distintos++;
            }
        }
    }
}
check(`${casos} combinaciones sin ninguna diferencia`, distintos === 0, `${distintos} distintos`);

console.log('\n3. Lo que venga guardado se lee sin romper nada');
check('JSON de la base', impuestosExtra('[{"name":"Cerdo","rate":5}]').length === 1);
check('array del formulario', tasaExtra(CERDO) === 5);
for (const malo of [null, undefined, '', 'no es json', '{}', 7, [{ name: '', rate: 5 }], [{ name: 'x', rate: 0 }], [{ name: 'x', rate: -3 }], [null]]) {
    check(`${JSON.stringify(malo)} = sin impuestos`, impuestosExtra(malo).length === 0 && tasaExtra(malo) === 0);
}
check('sin costo no hay utilidad que calcular', margenDesdePrecio(1000, 0, 19, CERDO) === null);

// ── El guardado real ─────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'impuestos-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const session = { uid: 7, username: 'jefe' };
const fila = async (id) => (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];

try {
    // El snapshot base más lo que estas pantallas necesitan, y la columna nueva.
    for (const f of ['0000_base_schema.sql', '0020_products_created_at.sql', '0024_categorias_jerarquia.sql', '0033_offer_rules.sql', '0037_product_extra_taxes.sql']) {
        await db.executeMultiple(readFileSync(join('migrations', f), 'utf8'));
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme'), ('otra', 'Otra');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'jefe', 'x', 'Jefe', 'Administrador', 'acme');
        INSERT INTO suppliers (id, company_id, name) VALUES (1, 'acme', 'Carnes Sur');
        INSERT INTO categories (company_id, name) VALUES ('acme', 'Carnes');
    `);

    console.log('\n4. Crear');
    const base = { name: 'Costillar', price: 699, stock: 3, category: 'Carnes', sku: 'CER-1', cost: 430.18, tax_rate: 19 };
    let r = await productCreate(db, CO, session, { ...base, extra_taxes: CERDO });
    check('se crea con sus otros impuestos', r.success === true, r.error || '');
    const idA = r.product?.id ?? r.id ?? (await db.execute("SELECT id FROM products WHERE sku = 'CER-1'")).rows[0].id;
    let p = await fila(idA);
    check('queda el JSON en la base', p.extra_taxes === JSON.stringify(CERDO), String(p.extra_taxes));
    check('el IVA sigue siendo solo el IVA', Number(p.tax_rate) === 19);

    r = await productCreate(db, CO, session, { ...base, name: 'Arroz', sku: 'ARR-1' });
    const idB = (await db.execute("SELECT id FROM products WHERE sku = 'ARR-1'")).rows[0].id;
    check('un producto sin otros impuestos queda en NULL', r.success === true && (await fila(idB)).extra_taxes === null);

    console.log('\n5. Editar');
    const parcial = (id, c, co = CO) => productUpdate(db, co, session, id, { ...c, _parcial: true });
    await parcial(idA, { price: 720 });
    check('cambiar otra cosa no los toca', (await fila(idA)).extra_taxes === JSON.stringify(CERDO));

    await parcial(idB, { extra_taxes: [{ name: 'ILA', rate: 20.5 }, { name: 'Otro', rate: 2 }] });
    check('se pueden poner varios', impuestosExtra((await fila(idB)).extra_taxes).length === 2);
    await parcial(idB, { extra_taxes: [] });
    check('quitarlos todos deja NULL', (await fila(idB)).extra_taxes === null);

    await parcial(idB, { extra_taxes: [{ name: '  Cerdo  ', rate: '5' }, { name: '', rate: 5 }, { name: 'x', rate: 500 }, { name: 'y', rate: -1 }, null, 'basura'] });
    check('lo inválido no se guarda', (await fila(idB)).extra_taxes === JSON.stringify([{ name: 'Cerdo', rate: 5 }]), String((await fila(idB)).extra_taxes));
    await parcial(idB, { extra_taxes: 'no es json' });
    check('basura = NULL, sin error', (await fila(idB)).extra_taxes === null);

    await productUpdate(db, CO, session, idA, { ...base, price: 725 });
    p = await fila(idA);
    check('el guardado completo de las pantallas viejas no los borra', p.extra_taxes === JSON.stringify(CERDO) && Number(p.price) === 725, String(p.extra_taxes));

    await parcial(idA, { extra_taxes: [] }, 'otra');
    check('otra empresa no los puede tocar', (await fila(idA)).extra_taxes === JSON.stringify(CERDO));

    console.log('\n6. Una compra no los pisa');
    r = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: {
            supplierId: 1, supplierName: 'Carnes Sur', invoiceNumber: 'F-9', date: '2026-11-04T12:00:00.000Z', total: 5000,
            paymentMethod: 'Efectivo',
            items: [{ id: idA, name: 'Costillar', sku: 'CER-1', quantity: 2, cost: 500, price: 800, tax: 19, total: 1000 }],
        },
    });
    p = await fila(idA);
    check('la compra se registra y actualiza el costo', r.success === true && Number(p.cost) === 500, r.error || '');
    check('los otros impuestos siguen ahí', p.extra_taxes === JSON.stringify(CERDO));

    console.log('\n7. Llegan a las pantallas');
    const inv = await reportRun(db, CO, session, { name: 'inventoryProducts', params: { limit: 50 } });
    check('lista del inventario', inv.rows[0].find(x => x.id === idA)?.extra_taxes === JSON.stringify(CERDO));
    const bus = await reportRun(db, CO, session, { name: 'productsSearch', params: { term: 'Costillar' } });
    check('búsqueda (perfil del producto)', bus.rows[0][0]?.extra_taxes === JSON.stringify(CERDO));
    const cat = await syncCatalog(db, CO, {});
    const enCat = (cat.products || cat.data?.products || []).find(x => x.id === idA);
    check('catálogo offline del POS', enCat?.extra_taxes === JSON.stringify(CERDO));

    console.log('\n8. La venta no se entera');
    check('la lista de columnas que usa la venta no pide la columna nueva', !PRODUCT_COLS_SIN_IMAGEN.includes('extra_taxes'));
} catch (e) {
    check('el test terminó sin excepciones', false, e.stack || e.message);
} finally {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces lo retiene */ }
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
