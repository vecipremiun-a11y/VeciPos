// Cajas con cualquier precio (Kevin, 6-nov-2026): una caja de 12 a $18.500 ya
// no exige $18.492 o $18.504, porque la boleta lleva el precio unitario con
// decimales (ver test-sii-precio-decimal.mjs).
//
// Guarda de verdad contra una base local; no toca ninguna base real.
//
//   node scripts/optim/test-caja-precio-libre.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { presentationActions } from '../../api/_lib/presentationActions.js';
import { purchaseActions } from '../../api/_lib/purchaseActions.js';
import { buildBoleta } from '../../api/sii/_sii.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'caja-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const session = { uid: 7, username: 'jefe' };
const caja = async (id) => (await db.execute({ sql: 'SELECT * FROM product_presentations WHERE id = ?', args: [id] })).rows[0];

try {
    for (const f of ['0000_base_schema.sql', '0020_products_created_at.sql', '0024_categorias_jerarquia.sql',
        '0030_product_presentations.sql', '0033_offer_rules.sql', '0037_product_extra_taxes.sql']) {
        await db.executeMultiple(readFileSync(join('migrations', f), 'utf8'));
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'jefe', 'x', 'Jefe', 'Administrador', 'acme');
        INSERT INTO suppliers (id, company_id, name) VALUES (1, 'acme', 'Bebidas Sur');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, unit, category, tax_rate)
            VALUES (1, 'acme', 'Bebida 1,5 L', 'BEB-1', 1600, 1200, 48, 'Und', 'Bebidas', 19);
    `);

    console.log('1. La ventana de la caja');
    const guardar = (presentation) => presentationActions.presentationSave(db, CO, session, { presentation, sinTienda: true });
    let r = await guardar({ product_id: 1, name: 'Caja', units: 12, barcode: 'CAJA-12', price: 18500 });
    check('una caja de 12 a $18.500 se guarda', r.success === true, r.error || '');
    const id = r.presentation?.id;
    check('queda con $18.500, sin cambiarlo', Number((await caja(id))?.price) === 18500, String((await caja(id))?.price));
    r = await guardar({ id, product_id: 1, name: 'Caja', units: 12, barcode: 'CAJA-12', price: 17400 });
    check('y se puede editar a otro precio redondo ($17.400)', r.success === true && Number((await caja(id)).price) === 17400, r.error || '');

    console.log('\n2. Lo que se seguía cuidando, se sigue cuidando');
    r = await guardar({ product_id: 1, name: 'Pack', units: 6, price: 0 });
    check('sin precio no se guarda', r.success === false, r.error || '');
    r = await guardar({ product_id: 1, name: 'Pack', units: 6.5, price: 9000 });
    check('unidades con decimales no se guardan', r.success === false, r.error || '');
    r = await guardar({ product_id: 1, name: 'Pack', units: 1, price: 9000 });
    check('una "caja" de 1 unidad no se guarda', r.success === false, r.error || '');

    console.log('\n3. Desde una compra');
    r = await purchaseActions.purchaseCreate(db, CO, session, {
        purchase: {
            supplierId: 1, supplierName: 'Bebidas Sur', invoiceNumber: 'F-1', date: '2026-11-06T12:00:00.000Z', total: 14400,
            paymentMethod: 'Efectivo',
            items: [{
                id: 1, name: 'Bebida 1,5 L', sku: 'BEB-1', quantity: 12, cost: 1200, price: 1600, tax: 19, total: 14400,
                cambiosPrecios: { presentaciones: [{ id, price: 18500 }], nuevas: [{ name: 'Display', units: 7, barcode: 'DISP-7', price: 10000 }] },
            }],
        },
    });
    check('la compra se guarda', r.success === true, r.error || '');
    check('ninguna caja quedó sin aplicar', !(r.preciosNoAplicados || []).length, JSON.stringify(r.preciosNoAplicados || []));
    check('la caja de 12 pasa a $18.500', Number((await caja(id)).price) === 18500, String((await caja(id)).price));
    const display = (await db.execute("SELECT * FROM product_presentations WHERE barcode = 'DISP-7'")).rows[0];
    check('un display nuevo de 7 a $10.000 se crea', Number(display?.price) === 10000, JSON.stringify(display || null));

    console.log('\n4. Y su boleta dice lo cobrado');
    // El carrito manda la caja como unidades: 12 × (18.500 ÷ 12). Ver setCartItemPresentation.
    for (const [nombre, unidades, precio, cajas] of [['Caja', 12, 18500, 1], ['Caja', 12, 18500, 3], ['Display', 7, 10000, 2]]) {
        const b = buildBoleta({ items: [{ name: nombre, quantity: unidades * cajas, price: precio / unidades, tax_rate: 19 }] },
            { rut_emisor: '76000000-0', razon_social: 'Acme', giro: 'Comercio' }, 1, { getCafXml: () => '<CAF/>', sign: () => 'F' });
        check(`${cajas} ${nombre.toLowerCase()}(s) de ${unidades} a $${precio}: boleta $${precio * cajas}`, b.montoTotal === precio * cajas, `boleta $${b.montoTotal}`);
    }
} catch (e) {
    check('el test terminó sin excepciones', false, e.stack || e.message);
} finally {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces lo retiene */ }
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
