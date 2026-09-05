// Prueba del cambio de saleCommit a `tx.batch` (un solo viaje) contra SQLite
// local. No toca Turso.
//
// Lo que hay que demostrar, porque es lo que estaba en juego:
//   1. La venta se registra bien y descuenta el stock.
//   2. La guarda de concurrencia SIGUE funcionando: si otra caja vendió primero,
//      la venta se rechaza y NO queda nada a medias.
//   3. Con el "Modo Ajuste de Inventario" prendido, sí deja vender en cero.
//   4. La clave anti-duplicado sigue evitando cobrar dos veces.
//
//   node scripts/optim/test-venta-batch.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saleCommit } from '../../api/_lib/salesActions.js';

const dir = mkdtempSync(join(tmpdir(), 'venta-'));
const db = createClient({ url: `file:${join(dir, 't.db').replace(/\\/g, '/')}` });

const CO = 'acme';
const session = { uid: 7, username: 'caja1' };
let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};
const stockDe = async (id) => Number((await db.execute({ sql: 'SELECT stock FROM products WHERE id = ?', args: [id] })).rows[0].stock);

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    // El esquema base es un snapshot viejo: faltan columnas que agregaron
    // migraciones posteriores y que saleCommit usa.
    for (const m of ['0012_sales_register_id.sql', '0021_sales_client_sale_id.sql']) {
        try { await db.executeMultiple(readFileSync('migrations/' + m, 'utf8')); } catch { /* ya existe */ }
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name, inventory_adjustment_mode) VALUES ('acme', 'Acme', 0);
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'caja1', 'x', 'Caja Uno', 'Caja', 'acme');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (1, 'acme', 'Ajo', 'AJO', 1000, 600, 10, 19, 'Und', 'General');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (2, 'acme', 'Pan', 'PAN', 2000, 1200, 0, 19, 'Und', 'General');
    `);

    const venta = (items, clave) => ({
        items, total: items.reduce((a, i) => a + i.price * i.quantity, 0),
        summary: 'test', paymentMethod: 'Efectivo', paymentDetails: {}, client: null,
        clientSaleId: clave,
    });
    const item = (id, name, qty, price) => ({ id, name, quantity: qty, price, cost: price * 0.6, tax_rate: 19, discountPercent: 0 });

    console.log('1. Venta normal');
    const r1 = await saleCommit(db, CO, session, { sale: venta([item(1, 'Ajo', 3, 1000)], 'v1') });
    check('la venta se registra', r1.success === true, r1.error || '');
    check('devuelve id de venta', !!r1.saleId, String(r1.saleId));
    check('descuenta el stock (10 - 3 = 7)', (await stockDe(1)) === 7, String(await stockDe(1)));

    console.log('\n2. La guarda de concurrencia sigue viva');
    // Se pide más de lo que hay: 7 disponibles, se venden 50.
    const r2 = await saleCommit(db, CO, session, { sale: venta([item(1, 'Ajo', 50, 1000)], 'v2') });
    check('rechaza la venta por stock', r2.success === false, r2.error || '');
    check('el stock NO se movió (sigue en 7)', (await stockDe(1)) === 7, String(await stockDe(1)));
    const ventasTrasFallo = await db.execute("SELECT COUNT(*) n FROM sales WHERE company_id='acme'");
    check('no quedó ninguna venta a medias', Number(ventasTrasFallo.rows[0].n) === 1, ventasTrasFallo.rows[0].n + ' ventas');

    console.log('\n3. Producto en CERO, con el modo ajuste APAGADO');
    const r3 = await saleCommit(db, CO, session, { sale: venta([item(2, 'Pan', 1, 2000)], 'v3') });
    check('no deja vender en cero', r3.success === false, r3.error || '');

    console.log('\n4. Producto en CERO, con el modo ajuste PRENDIDO');
    await db.execute("UPDATE companies SET inventory_adjustment_mode = 1 WHERE id = 'acme'");
    const r4 = await saleCommit(db, CO, session, { sale: venta([item(2, 'Pan', 1, 2000)], 'v4') });
    check('ahora sí deja vender en cero', r4.success === true, r4.error || '');
    check('el stock queda negativo (0 - 1 = -1)', (await stockDe(2)) === -1, String(await stockDe(2)));

    console.log('\n5. La clave anti-duplicado sigue protegiendo');
    const r5 = await saleCommit(db, CO, session, { sale: venta([item(1, 'Ajo', 1, 1000)], 'v1') });
    check('reenviar la misma clave no cobra de nuevo', r5.success === true && r5.duplicated === true || r5.saleId === r1.saleId,
        'saleId=' + r5.saleId + ' (original ' + r1.saleId + ')');
    check('el stock no se descontó otra vez', (await stockDe(1)) === 7, String(await stockDe(1)));

    console.log('\n6. El registro de auditoría se sigue escribiendo');
    const audit = await db.execute("SELECT COUNT(*) n FROM audit_logs WHERE company_id='acme' AND entity='SALE'");
    check('hay auditoría de las ventas exitosas', Number(audit.rows[0].n) >= 2, audit.rows[0].n + ' registros');

    console.log('\n7. La venta ya estaba guardada y el reintento choca (lo que trababa la cola)');
    // La carrera real no se puede reproducir con un archivo SQLite local: dos
    // conexiones al mismo archivo se bloquean entre sí, cosa que en Turso no
    // pasa. Así que se reproduce el ESTADO en el que deja esa carrera: el
    // control anti-duplicado no la encuentra (por eso el wrapper miente en esa
    // primera consulta) pero la venta SÍ existe, así que el INSERT choca contra
    // el índice único. Antes eso devolvía 500 y el POS la dejaba encolada para
    // siempre; ahora tiene que reconocerla y devolverla como éxito.
    //
    // Wrapper de objeto plano, nunca Proxy: los campos privados del cliente
    // libsql se rompen al pasar por un Proxy.
    await db.execute(`INSERT INTO sales (company_id, user_id, date, items, total, summary, payment_method, status, client_sale_id)
                      VALUES ('acme', 7, '2026-09-03T12:00:00.000Z', '[]', 5000, 'previa', 'Efectivo', 'completed', 'ya-existe')`);
    const idReal = Number((await db.execute("SELECT id FROM sales WHERE client_sale_id='ya-existe'")).rows[0].id);

    let primeraConsulta = true;
    const dbQueMiente = {
        execute: (arg) => {
            const sql = typeof arg === 'string' ? arg : arg.sql;
            if (primeraConsulta && /FROM sales WHERE company_id = \? AND client_sale_id/.test(sql)) {
                primeraConsulta = false;               // solo miente una vez
                return Promise.resolve({ rows: [] }); // "no existe" → sigue de largo
            }
            return db.execute(arg);
        },
        batch: (...a) => db.batch(...a),
        transaction: (...a) => db.transaction(...a),
        executeMultiple: (...a) => db.executeMultiple(...a),
    };

    const stockPrevio = await stockDe(1);
    const r7 = await saleCommit(dbQueMiente, CO, session, { sale: venta([item(1, 'Ajo', 1, 1000)], 'ya-existe') })
        .catch(e => ({ success: false, error: 'EXCEPCION: ' + e.message }));

    check('no revienta con excepción', !String(r7.error || '').startsWith('EXCEPCION'), r7.error || 'ok');
    check('responde éxito (el POS la saca de la cola)', r7.success === true, String(r7.success));
    check('devuelve la venta que ya existía', r7.saleId === idReal, r7.saleId + ' vs ' + idReal);
    const cuantas = await db.execute("SELECT COUNT(*) n FROM sales WHERE company_id='acme' AND client_sale_id='ya-existe'");
    check('sigue habiendo UNA sola venta', Number(cuantas.rows[0].n) === 1, cuantas.rows[0].n + ' filas');
    check('no descontó stock de nuevo', (await stockDe(1)) === stockPrevio, `${await stockDe(1)} vs ${stockPrevio}`);

    console.log('\n8. Una venta SIN clave anti-duplicado también entra');
    // El control anti-duplicado ahora viaja en el mismo lote que los flags de la
    // empresa, para ahorrarle un viaje a la caja. Cuando la venta no trae clave,
    // esa consulta tiene que devolver cero filas sin romper el lote — si no,
    // ninguna venta sin clave se podría registrar.
    const stockAntes = await stockDe(1);
    const rSinClave = await saleCommit(db, CO, session, {
        sale: {
            items: [item(1, 'Ajo', 1, 1000)], total: 1000, summary: 'sin clave',
            paymentMethod: 'Efectivo', paymentDetails: {}, client: null,
        },
    });
    check('se registra igual', rSinClave.success === true, rSinClave.error || '');
    check('descuenta el stock', (await stockDe(1)) === stockAntes - 1, (await stockDe(1)) + ' vs ' + (stockAntes - 1));
    const filaSinClave = await db.execute({ sql: 'SELECT client_sale_id FROM sales WHERE id = ?', args: [rSinClave.saleId] });
    check('queda sin clave en la base', filaSinClave.rows[0].client_sale_id === null, String(filaSinClave.rows[0].client_sale_id));

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
