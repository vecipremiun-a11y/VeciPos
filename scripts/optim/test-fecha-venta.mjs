// Prueba de que la venta se guarda con la hora del COBRO y no con la de la
// subida (3-sep-2026).
//
// El problema: `sales.date` se llenaba con la hora del servidor al recibir la
// venta. Ese día se cayó la base, la cola se vació de golpe a las 16:28 y 41
// ventas de toda la mañana quedaron estampadas dentro del mismo minuto. El
// historial quedó sin orden y el gráfico por horas mostró un pico falso.
//
//   node scripts/optim/test-fecha-venta.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saleCommit, fechaDelCobro } from '../../api/_lib/salesActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

console.log('1. Qué fecha se le cree al navegador y cuál no');
const AHORA = Date.parse('2026-09-03T20:00:00.000Z');
const srv = new Date(AHORA).toISOString();
const laDe = (v) => fechaDelCobro(v, AHORA);

check('una hora de hoy, cuatro horas atrás: se respeta',
    laDe('2026-09-03T16:00:00.000Z') === '2026-09-03T16:00:00.000Z', laDe('2026-09-03T16:00:00.000Z'));
check('una venta de ayer que recién sube: se respeta',
    laDe('2026-09-02T13:20:00.000Z') === '2026-09-02T13:20:00.000Z', laDe('2026-09-02T13:20:00.000Z'));
check('sin fecha (venta online normal): usa la del servidor', laDe(null) === srv, laDe(null));
check('basura: usa la del servidor', laDe('cualquier cosa') === srv, laDe('cualquier cosa'));
check('número en vez de texto: usa la del servidor', laDe(1788000000000) === srv);
check('reloj adelantado 2 horas: NO se le cree',
    laDe('2026-09-03T22:00:00.000Z') === srv, laDe('2026-09-03T22:00:00.000Z'));
check('adelantado 2 minutos: se tolera (desfase normal)',
    laDe('2026-09-03T20:02:00.000Z') === '2026-09-03T20:02:00.000Z');
check('reloj en 1970: NO se le cree', laDe('1970-01-01T00:00:00.000Z') === srv);
check('venta de hace 40 días: NO se le cree (ensuciaría cierres viejos)',
    laDe('2026-07-25T12:00:00.000Z') === srv, laDe('2026-07-25T12:00:00.000Z'));
check('venta de hace 20 días: se respeta',
    laDe('2026-08-14T12:00:00.000Z') === '2026-08-14T12:00:00.000Z');

console.log('\n2. Contra la base: la venta queda con la hora del cobro');
const dir = mkdtempSync(join(tmpdir(), 'fecha-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const session = { uid: 7, username: 'caja1' };

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    for (const m of ['0012_sales_register_id.sql', '0021_sales_client_sale_id.sql']) {
        try { await db.executeMultiple(readFileSync('migrations/' + m, 'utf8')); } catch { /* ya existe */ }
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name, inventory_adjustment_mode) VALUES ('acme', 'Acme', 0);
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'caja1', 'x', 'Caja Uno', 'Caja', 'acme');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (1, 'acme', 'Ajo', 'AJO', 1000, 600, 100, 19, 'Und', 'General');
    `);

    const item = { id: 1, name: 'Ajo', quantity: 1, price: 1000, cost: 600, tax_rate: 19, discountPercent: 0 };
    const venta = (clave, cobradaA) => ({
        items: [item], total: 1000, summary: 'test', paymentMethod: 'Efectivo',
        paymentDetails: {}, client: null, clientSaleId: clave, offlineCreatedAt: cobradaA,
    });
    const fechaDe = async (id) => (await db.execute({ sql: 'SELECT date FROM sales WHERE id = ?', args: [id] })).rows[0].date;

    // Tres ventas cobradas a horas distintas de la mañana, todas subidas AHORA.
    const horas = ['2026-09-03T11:05:00.000Z', '2026-09-03T13:40:00.000Z', '2026-09-03T15:12:00.000Z'];
    const ids = [];
    for (let i = 0; i < horas.length; i++) {
        const r = await saleCommit(db, CO, session, { sale: venta('cobro' + i, horas[i]) });
        check(`la venta ${i + 1} se registra`, r.success === true, r.error || '');
        ids.push(r.saleId);
    }
    for (let i = 0; i < horas.length; i++) {
        check(`la venta ${i + 1} conserva su hora de cobro`, (await fechaDe(ids[i])) === horas[i], await fechaDe(ids[i]));
    }

    const enOrden = await db.execute("SELECT id FROM sales WHERE company_id='acme' ORDER BY date");
    check('el historial queda en el orden en que se cobró',
        enOrden.rows.map(r => Number(r.id)).join(',') === ids.join(','),
        enOrden.rows.map(r => r.id).join(',') + ' vs ' + ids.join(','));

    const distintas = await db.execute("SELECT COUNT(DISTINCT date) n FROM sales WHERE company_id='acme'");
    check('NO quedan todas con la misma hora (el bug de hoy)', Number(distintas.rows[0].n) === 3, distintas.rows[0].n + ' horas distintas');

    console.log('\n3. Una venta online normal sigue usando la hora del servidor');
    const antes = Date.now();
    const rOnline = await saleCommit(db, CO, session, { sale: venta('online1', null) });
    const fOnline = Date.parse(await fechaDe(rOnline.saleId));
    check('se guarda con la hora de ahora', fOnline >= antes - 1000 && fOnline <= Date.now() + 1000, new Date(fOnline).toISOString());

    console.log('\n4. Un reloj roto no puede ensuciar la base');
    const rRoto = await saleCommit(db, CO, session, { sale: venta('roto1', '1999-01-01T00:00:00.000Z') });
    const fRoto = Date.parse(await fechaDe(rRoto.saleId));
    check('la venta con reloj en 1999 se guarda con la hora real', fRoto > Date.parse('2026-01-01'), new Date(fRoto).toISOString());

    console.log('\n5. El espejo sale_items usa la misma fecha');
    const mirror = await db.execute({ sql: 'SELECT sale_date FROM sale_items WHERE sale_id = ? LIMIT 1', args: [ids[0]] });
    if (mirror.rows.length) {
        check('sale_items coincide con la venta', mirror.rows[0].sale_date === horas[0], String(mirror.rows[0].sale_date));
    } else {
        console.log('  --   sale_items vacío en este esquema base, se omite');
    }

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
