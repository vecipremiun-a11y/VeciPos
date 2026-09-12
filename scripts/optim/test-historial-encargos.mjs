// Quién canceló un encargo, cuándo y por qué (8-sep-2026).
//
// EL CASO. El encargo #690 (Maritza, Pan Hamburguesa x15, $4.125) se creó a las
// 12:08:52 y apareció cancelado. Kevin preguntó quién lo había cancelado y a
// qué hora, y el sistema no tenía la respuesta: los cambios de estado de un
// encargo no dejaban ningún rastro. La hora se pudo reconstruir de rebote, por
// el aviso saliente a miniveci en `integration_sync_logs`; el usuario nunca.
//
// Y cancelar era una X que actuaba al toque: sin confirmación, sin motivo.
//
// Esta prueba cubre las dos mitades del arreglo:
//   · cada cambio de estado deja fila con usuario, hora, motivo y pantalla;
//   · cancelar sin motivo lo rechaza el SERVIDOR, no solo la pantalla.
//
//   node scripts/optim/test-historial-encargos.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preorderActions } from '../../api/_lib/preorderActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'histenc-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';

// Chelo creó el #690; la sesión es la de quien hace la acción.
const CHELO = { uid: 7, username: 'Chelo', role: 'Caja' };
const MAYRA = { uid: 11, username: 'Mayra', role: 'Caja' };

const historial = async (id) => (await db.execute({
    sql: 'SELECT * FROM preorder_status_history WHERE preorder_id = ? ORDER BY id',
    args: [id],
})).rows;

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.execute("INSERT INTO companies (id, name) VALUES ('acme', 'Acme')");
    await db.execute("INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'Chelo', 'x', 'Chelo', 'Caja', 'acme')");
    await db.execute("INSERT INTO users (id, username, password, name, role, company_id) VALUES (11, 'Mayra', 'x', 'Mayra', 'Caja', 'acme')");

    console.log('1. Antes de la migración 0028 nada se rompe');
    // La tabla todavía no existe: crear y ver el detalle tiene que funcionar
    // igual, solo que sin línea de tiempo. Es lo que va a pasar en una base que
    // aún no migró.
    let r = await preorderActions.preorderCreate(db, CO, CHELO, {
        preorderData: {
            client_name: 'Cliente Previo', due_date: '2026-09-08', due_time: '17:00',
            total_amount: 1000, deposit_amount: 0,
            items: [{ product_id: 1, product_name: 'Pan', qty: 2, unit_price: 500, line_total: 1000 }],
        },
    });
    check('se puede crear un encargo sin la tabla', r.success === true, JSON.stringify(r).slice(0, 80));
    const previo = r.preorderId;
    let d = await preorderActions.preorderDetails(db, CO, CHELO, { preorderId: previo });
    check('el detalle sigue trayendo los items', d.success === true && d.items.length === 1);
    check('y devuelve historial vacío, no un error', Array.isArray(d.history) && d.history.length === 0);

    // Ahora sí, la migración.
    await db.executeMultiple(readFileSync('migrations/0028_preorder_status_history.sql', 'utf8'));

    console.log('\n2. El alta queda registrada con su autor');
    r = await preorderActions.preorderCreate(db, CO, CHELO, {
        preorderData: {
            client_name: 'Maritza selmira Moreno lara', client_phone: '967378400',
            due_date: '2026-09-08', due_time: '17:45',
            total_amount: 4125, deposit_amount: 0,
            items: [{ product_id: 2, product_name: 'Pan Hamburguesa', qty: 15, unit_price: 275, line_total: 4125 }],
        },
    });
    const id = r.preorderId;
    check('encargo creado', r.success === true, `#${id}`);
    let h = await historial(id);
    check('deja una línea', h.length === 1, `${h.length}`);
    check('dice que lo creó Chelo', h[0].user_name === 'Chelo', h[0].user_name);
    check('guarda el id del usuario, no solo el nombre', h[0].user_id === 7, String(h[0].user_id));
    check('de NULL a pending', h[0].from_status === null && h[0].to_status === 'pending');

    console.log('\n3. Cancelar SIN motivo lo rechaza el servidor');
    // Es la parte que importa: la validación no puede vivir solo en la pantalla,
    // porque la pantalla se puede saltear.
    r = await preorderActions.preorderStatusUpdate(db, CO, MAYRA, { preorderId: id, newStatus: 'canceled' });
    check('no deja cancelar sin motivo', r.success === false, r.error || '');
    r = await preorderActions.preorderStatusUpdate(db, CO, MAYRA, { preorderId: id, newStatus: 'canceled', reason: '   ' });
    check('un motivo en blanco tampoco cuenta', r.success === false, r.error || '');
    let estado = (await db.execute({ sql: 'SELECT status FROM preorders WHERE id = ?', args: [id] })).rows[0].status;
    check('el encargo sigue vivo', estado === 'pending', estado);
    check('y no se ensució el historial', (await historial(id)).length === 1);

    console.log('\n4. Cancelar CON motivo: queda todo');
    r = await preorderActions.preorderStatusUpdate(db, CO, MAYRA, {
        preorderId: id, newStatus: 'canceled',
        reason: 'Error al cargar el pedido', source: 'produccion',
    });
    check('cancela', r.success === true, r.error || '');
    h = await historial(id);
    check('segunda línea en el historial', h.length === 2, `${h.length}`);
    const c = h[1];
    check('QUIÉN: Mayra, no el que lo creó', c.user_name === 'Mayra' && c.user_id === 11, `${c.user_name}/${c.user_id}`);
    check('POR QUÉ: el motivo escrito', c.reason === 'Error al cargar el pedido', c.reason);
    check('DE DÓNDE: la pantalla de producción', c.source === 'produccion', c.source);
    check('DESDE QUÉ ESTADO venía', c.from_status === 'pending' && c.to_status === 'canceled');
    check('CUÁNDO: hora en UTC con marca de zona', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(c.created_at), c.created_at);

    console.log('\n5. El motivo también se ve en las notas del encargo');
    const notas = (await db.execute({ sql: 'SELECT notes FROM preorders WHERE id = ?', args: [id] })).rows[0].notes;
    check('dice "Cancelado", no "Rechazo"', /Cancelado: Error al cargar el pedido/.test(notas), notas);

    console.log('\n6. El detalle del encargo lo devuelve para la pantalla');
    d = await preorderActions.preorderDetails(db, CO, CHELO, { preorderId: id });
    check('trae el historial completo', d.history.length === 2, `${d.history.length}`);
    check('en orden: primero el alta', !d.history[0].from_status);
    check('y después la cancelación', d.history[1].to_status === 'canceled');

    console.log('\n7. Lo que ya andaba sigue andando');
    r = await preorderActions.preorderCreate(db, CO, CHELO, {
        preorderData: {
            client_name: 'Sr Jose', due_date: '2026-09-08', due_time: '16:00',
            total_amount: 6440, deposit_amount: 0,
            items: [{ product_id: 3, product_name: 'Torta', qty: 1, unit_price: 6440, line_total: 6440 }],
        },
    });
    const id2 = r.preorderId;
    r = await preorderActions.preorderStatusUpdate(db, CO, CHELO, { preorderId: id2, newStatus: 'confirmed' });
    check('confirmar no pide motivo', r.success === true, r.error || '');
    r = await preorderActions.preorderStatusUpdate(db, CO, CHELO, { preorderId: id2, newStatus: 'preparing' });
    check('preparar tampoco', r.success === true, r.error || '');
    h = await historial(id2);
    check('el avance normal también queda anotado', h.length === 3, `${h.length}`);
    check('con la cadena de estados completa',
        h.map(x => x.to_status).join('>') === 'pending>confirmed>preparing',
        h.map(x => x.to_status).join('>'));

    console.log('\n8. Un encargo de otra empresa no se toca ni se ve');
    await db.execute("INSERT INTO companies (id, name) VALUES ('otra', 'Otra')");
    r = await preorderActions.preorderStatusUpdate(db, 'otra', MAYRA, {
        preorderId: id2, newStatus: 'canceled', reason: 'intento cruzado',
    });
    check('no deja cancelar de otra empresa', r.success === false, r.error || '');
    d = await preorderActions.preorderDetails(db, 'otra', MAYRA, { preorderId: id2 });
    check('ni ver su historial', d.preorder === null && d.history.length === 0);

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
