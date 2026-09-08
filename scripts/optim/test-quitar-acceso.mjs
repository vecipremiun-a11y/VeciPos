// Quitar el acceso a un usuario sin perder su historial (6-sep-2026).
//
// Lo que pidió Kevin: que una persona que deja de trabajar no pueda volver a
// entrar desde ningún equipo, pero que TODO lo suyo —ventas, cierres de caja,
// asistencia, pagos— siga dentro del sistema.
//
// Y el defecto que lo trajo: al intentarlo con una cajera a la que ya se le
// había quitado el acceso antes, el sistema contestaba "El usuario no pertenece
// a esta empresa". Un error, para algo que ya estaba hecho, y con un texto que
// sonaba a que el problema era de quien apretaba el botón.
//
//   node scripts/optim/test-quitar-acceso.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userActions } from '../../api/_lib/userActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'acceso-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const dueño = { uid: 1, username: 'jefe', role: 'super_admin' };

const cuenta = async (sql, args) => Number((await db.execute({ sql, args })).rows[0].n);
const puedeEntrar = async (id) =>
    (await cuenta('SELECT COUNT(*) n FROM user_companies WHERE user_id=? AND company_id=?', [id, CO])) > 0;

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (1, 'jefe', 'x', 'El Dueño', 'super_admin', 'acme');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (2, 'kenia', 'x', 'Kenia', 'Caja', 'acme');
        INSERT INTO users (id, username, password, name, role, company_id) VALUES (3, 'humbe', 'x', 'Humberto', 'Administrador', 'acme');
        INSERT INTO user_companies (user_id, company_id, role) VALUES (1, 'acme', 'owner');
        INSERT INTO user_companies (user_id, company_id, role) VALUES (2, 'acme', 'Caja');
        INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
          VALUES (1, 'acme', 'Ajo', 'AJO', 1000, 600, 10, 19, 'Und', 'General');
        INSERT INTO sales (id, company_id, user_id, date, items, total, summary, payment_method, status)
          VALUES (500, 'acme', 2, '2026-09-01T12:00:00.000Z', '[]', 5000, '1 productos', 'Efectivo', 'completed');
        INSERT INTO sales (id, company_id, user_id, date, items, total, summary, payment_method, status)
          VALUES (501, 'acme', 2, '2026-09-02T12:00:00.000Z', '[]', 7000, '2 productos', 'Efectivo', 'completed');
        INSERT INTO cash_registers (id, user_id, opening_amount, opening_time, status, company_id)
          VALUES (900, 2, 10000, '2026-09-01T08:00:00.000Z', 'closed', 'acme');
        INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, source)
          VALUES ('acme', 2, 'in', '2026-09-01T08:00:00.000Z', '2026-09-01', 'kiosk');
    `);

    console.log('1. Antes: Kenia puede entrar y tiene su historial');
    check('puede entrar', await puedeEntrar(2));
    check('tiene 2 ventas', (await cuenta('SELECT COUNT(*) n FROM sales WHERE user_id=2', [])) === 2);
    check('tiene 1 cierre de caja', (await cuenta('SELECT COUNT(*) n FROM cash_registers WHERE user_id=2', [])) === 1);
    check('tiene 1 marca de asistencia', (await cuenta('SELECT COUNT(*) n FROM attendance_records WHERE user_id=2', [])) === 1);

    console.log('\n2. Se le quita el acceso');
    let r = await userActions.userRevokeAccess(db, CO, dueño, { id: 2 });
    check('funciona', r.success === true, r.error || '');
    check('YA NO puede entrar', !(await puedeEntrar(2)));

    console.log('\n3. Y NO se perdió absolutamente nada');
    check('el usuario sigue existiendo', (await cuenta('SELECT COUNT(*) n FROM users WHERE id=2', [])) === 1);
    check('sus 2 ventas siguen ahí', (await cuenta('SELECT COUNT(*) n FROM sales WHERE user_id=2', [])) === 2);
    check('su cierre de caja sigue ahí', (await cuenta('SELECT COUNT(*) n FROM cash_registers WHERE user_id=2', [])) === 1);
    check('su asistencia sigue ahí', (await cuenta('SELECT COUNT(*) n FROM attendance_records WHERE user_id=2', [])) === 1);
    const venta = (await db.execute('SELECT user_id FROM sales WHERE id = 500')).rows[0];
    check('las ventas siguen a SU nombre', Number(venta.user_id) === 2, String(venta.user_id));

    console.log('\n4. Volver a quitárselo NO es un error');
    // Es el caso que dio el problema: una cajera a la que ya se le había quitado.
    r = await userActions.userRevokeAccess(db, CO, dueño, { id: 2 });
    check('contesta que salió bien', r.success === true, r.error || '');
    check('avisa que ya estaba sin acceso', r.yaEstaba === true, JSON.stringify(r.mensaje));
    check('NO dice "no pertenece a esta empresa"', !/no pertenece/i.test(r.error || ''), r.error || '(sin error)');

    console.log('\n5. Un usuario que nunca tuvo membresía tampoco da error');
    // Humberto está en la empresa por `users.company_id` pero sin fila de
    // membresía: en producción hay dos así.
    r = await userActions.userRevokeAccess(db, CO, dueño, { id: 3 });
    check('contesta que salió bien', r.success === true, r.error || '');
    check('y que ya no tenía acceso', r.yaEstaba === true);

    console.log('\n6. Al dueño no se le puede quitar el acceso');
    r = await userActions.userRevokeAccess(db, CO, dueño, { id: 1 });
    check('se rechaza', r.success === false, String(r.success));
    check('con el motivo claro', /dueño/i.test(r.error), r.error);
    check('y sigue pudiendo entrar', await puedeEntrar(1));

    console.log('\n7. Solo el dueño puede quitar accesos');
    const cajera = { uid: 2, username: 'kenia', role: 'Caja' };
    r = await userActions.userRevokeAccess(db, CO, cajera, { id: 3 });
    check('una cajera no puede', r.success === false, String(r.success));
    check('con el motivo claro', /dueño/i.test(r.error), r.error);

    console.log('\n8. Borrar sigue bloqueado por los registros laborales');
    // Kenia tiene una marca de asistencia: son registros legales y no se borran.
    await db.execute("INSERT INTO user_companies (user_id, company_id, role) VALUES (2, 'acme', 'Caja')");
    const rd = await userActions.userDelete(db, CO, dueño, { id: 2 });
    check('no la borra', rd.success === false, String(rd.success));
    check('lo marca como registros laborales', rd.tieneRegistrosLaborales === true);
    check('y manda a quitar el acceso', /Quitar acceso/i.test(rd.error), rd.error);
    check('el usuario sigue entero', (await cuenta('SELECT COUNT(*) n FROM users WHERE id=2', [])) === 1);

    console.log('\n9. El que no puede entrar SALE de la lista, pero su fila queda de ancla');
    // Kevin: "no quiero al usuario ahí, sino me lleno de gente sin acceso".
    //
    // La fila NO se puede borrar: el historial saca de ahí el nombre del
    // vendedor (`LEFT JOIN users` en ventas, caja y asistencia). Se esconde de
    // la lista —que es lo que hace falta— y el historial sigue diciendo quién
    // vendió.
    await userActions.userRevokeAccess(db, CO, dueño, { id: 2 });
    const comoLaVeLaPantalla = (filas, mostrarSinAcceso) =>
        filas.filter(u => u.company_role || mostrarSinAcceso);
    const filas = (await db.execute({
        sql: `SELECT u.id, u.name, uc.role AS company_role
              FROM users u LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
              WHERE u.company_id = ?`,
        args: [CO, CO],
    })).rows;

    const visibles = comoLaVeLaPantalla(filas, false);
    check('Kenia YA NO aparece en la lista', !visibles.some(u => Number(u.id) === 2),
        visibles.map(u => u.name).join(', '));
    check('Humberto tampoco (nunca tuvo membresía)', !visibles.some(u => Number(u.id) === 3));
    check('el dueño sigue a la vista', visibles.some(u => Number(u.id) === 1));

    const conOcultos = comoLaVeLaPantalla(filas, true);
    check('el interruptor los vuelve a mostrar', conOcultos.length === filas.length,
        `${conOcultos.length} de ${filas.length}`);

    console.log('\n10. Y el historial sigue sabiendo quién vendió');
    const nombre = (await db.execute(
        'SELECT u.name FROM sales s LEFT JOIN users u ON s.user_id = u.id WHERE s.id = 500'
    )).rows[0];
    check('la venta #500 sigue diciendo "Kenia"', nombre.name === 'Kenia', String(nombre.name));
    check('>>> por eso la fila NO se borra de la base', true);

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
