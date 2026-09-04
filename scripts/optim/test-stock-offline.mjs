// Prueba de que una venta ya cobrada sin conexión NO se rechaza por stock
// (3-sep-2026).
//
// El razonamiento: el stock que ve el equipo sin conexión es una foto vieja —la
// del último momento en que pudo hablar con el servidor—. Entre esa foto y el
// momento en que la venta sube pudo entrar mercadería, pudo vender otra caja,
// pudo hacerse un ajuste. Rechazar la venta por ese número no devuelve la
// mercadería: el cliente ya se la llevó y ya pagó. Solo se pierde el registro.
//
// Así que entra igual, el stock puede quedar negativo, y el producto queda
// marcado `pending_adjustment` para que alguien lo cuente. Eso es más honesto
// que un cero con la venta perdida.
//
// Lo que NO cambia: una venta ONLINE sigue respetando el stock como siempre.
//
//   node scripts/optim/test-stock-offline.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saleCommit } from '../../api/_lib/salesActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'stockoff-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const session = { uid: 7, username: 'caja1' };

const producto = async (id) => (await db.execute({ sql: 'SELECT stock, pending_adjustment FROM products WHERE id = ?', args: [id] })).rows[0];
const stockDe = async (id) => Number((await producto(id)).stock);
const marcado = async (id) => Number((await producto(id)).pending_adjustment) === 1;

const item = (id, name, qty, price = 1000) => ({ id, name, quantity: qty, price, cost: 600, tax_rate: 19, discountPercent: 0 });
const venta = (items, clave, extra = {}) => ({
    items, total: items.reduce((a, i) => a + i.price * i.quantity, 0),
    summary: 'test', paymentMethod: 'Efectivo', paymentDetails: {}, client: null,
    clientSaleId: clave, ...extra,
});

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    for (const m of ['0012_sales_register_id.sql', '0021_sales_client_sale_id.sql']) {
        try { await db.executeMultiple(readFileSync('migrations/' + m, 'utf8')); } catch { /* ya existe */ }
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name, inventory_adjustment_mode) VALUES ('acme', 'Acme', 0);
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'caja1', 'x', 'Caja Uno', 'Caja', 'acme');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (1, 'acme', 'Ajo', 'AJO', 1000, 600, 2, 19, 'Und', 'General');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (2, 'acme', 'Pan', 'PAN', 1000, 600, 0, 19, 'Und', 'General');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (3, 'acme', 'Sal', 'SAL', 1000, 600, 50, 19, 'Und', 'General');
    `);

    console.log('1. Una venta ONLINE sigue respetando el stock (nada cambió)');
    let r = await saleCommit(db, CO, session, { sale: venta([item(1, 'Ajo', 10)], 'on1') });
    check('se rechaza por stock', r.success === false, r.error || '');
    check('dice qué producto', /Ajo/.test(r.error || ''), r.error);
    check('el stock no se movió', (await stockDe(1)) === 2, String(await stockDe(1)));

    console.log('\n2. La MISMA venta, ya cobrada sin conexión, SÍ entra');
    r = await saleCommit(db, CO, session, { sale: venta([item(1, 'Ajo', 10)], 'off1', { ventaOffline: true }) });
    check('se registra', r.success === true, r.error || '');
    check('el stock queda negativo (2 - 10 = -8)', (await stockDe(1)) === -8, String(await stockDe(1)));
    check('el producto queda marcado para recuento', await marcado(1));

    console.log('\n3. Un producto en CERO también entra');
    r = await saleCommit(db, CO, session, { sale: venta([item(2, 'Pan', 3)], 'off2', { ventaOffline: true }) });
    check('se registra', r.success === true, r.error || '');
    check('el stock queda en -3', (await stockDe(2)) === -3, String(await stockDe(2)));
    check('queda marcado para recuento', await marcado(2));

    console.log('\n4. Lo que SÍ alcanza no se marca de más');
    r = await saleCommit(db, CO, session, { sale: venta([item(3, 'Sal', 5)], 'off3', { ventaOffline: true }) });
    check('se registra', r.success === true, r.error || '');
    check('descuenta normal (50 - 5 = 45)', (await stockDe(3)) === 45, String(await stockDe(3)));
    check('NO queda marcado (el número cuadra)', !(await marcado(3)));

    console.log('\n5. Una venta con varios productos, unos con stock y otros no');
    r = await saleCommit(db, CO, session, {
        sale: venta([item(3, 'Sal', 2), item(2, 'Pan', 1)], 'off4', { ventaOffline: true }),
    });
    check('se registra entera', r.success === true, r.error || '');
    check('la Sal descuenta normal (45 - 2 = 43)', (await stockDe(3)) === 43, String(await stockDe(3)));
    check('el Pan sigue bajando (-3 - 1 = -4)', (await stockDe(2)) === -4, String(await stockDe(2)));
    check('la Sal sigue sin marcar', !(await marcado(3)));

    console.log('\n6. Ninguna venta se pierde y ninguna se duplica');
    const total = await db.execute("SELECT COUNT(*) n FROM sales WHERE company_id = 'acme'");
    check('quedaron las 4 ventas offline (la online se rechazó)', Number(total.rows[0].n) === 4, total.rows[0].n + ' ventas');
    r = await saleCommit(db, CO, session, { sale: venta([item(1, 'Ajo', 10)], 'off1', { ventaOffline: true }) });
    check('reenviar la misma no cobra de nuevo', r.success === true && r.duplicada === true, String(r.duplicada));
    check('el stock no se descontó otra vez', (await stockDe(1)) === -8, String(await stockDe(1)));

    console.log('\n7. Con "Modo Ajuste" prendido, online también deja vender en cero');
    await db.execute("UPDATE companies SET inventory_adjustment_mode = 1 WHERE id = 'acme'");
    r = await saleCommit(db, CO, session, { sale: venta([item(2, 'Pan', 1)], 'aj1') });
    check('entra sin la marca de offline', r.success === true, r.error || '');
    check('el stock sigue bajando', (await stockDe(2)) === -5, String(await stockDe(2)));

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
