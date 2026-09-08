// Baja de personal: que quien deja de trabajar salga de Usuarios sin perder
// nada de lo suyo (7-sep-2026).
//
// Lo que pidió Kevin: "que el usuario que ya trabajó conmigo y fue sacado, yo
// quedarme con todo su historial de él en el sistema... y que no me quede
// registro del usuario", con las fechas desde y hasta cuándo trabajó.
//
// Por qué la ficha NO se borra: el historial saca de ahí el nombre del vendedor
// (`LEFT JOIN users` en ventas, cajas y asistencia). Borrarla dejaría las 20.033
// ventas de Kenia sin nombre, para siempre. Se cierra el legajo y sale de la
// lista: para el dueño ya no es un usuario, es un ex empleado.
//
//   node scripts/optim/test-baja-personal.mjs

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

const dir = mkdtempSync(join(tmpdir(), 'baja-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const dueño = { uid: 1, username: 'jefe', role: 'super_admin' };
const hoy = new Date().toISOString().slice(0, 10);

const cuenta = async (sql, args = []) => Number((await db.execute({ sql, args })).rows[0].n);
const ficha = async (id) => (await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] })).rows[0];
const puedeEntrar = async (id) =>
    (await cuenta('SELECT COUNT(*) n FROM user_companies WHERE user_id=? AND company_id=?', [id, CO])) > 0;

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    for (const m of ['0025_asistencia_registro_legal.sql', '0027_personal_dado_de_baja.sql']) {
        try { await db.executeMultiple(readFileSync('migrations/' + m, 'utf8')); } catch (e) { console.log('  (migración ' + m + ': ' + e.message + ')'); }
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Acme');
        INSERT INTO users (id, username, password, name, role, company_id, labor_start_date) VALUES (1, 'jefe', 'x', 'El Dueño', 'super_admin', 'acme', NULL);
        INSERT INTO users (id, username, password, name, role, company_id, labor_start_date) VALUES (2, 'katy', 'x', 'Katy', 'Caja', 'acme', '2026-01-15');
        INSERT INTO users (id, username, password, name, role, company_id, labor_start_date) VALUES (3, 'nuevo', 'x', 'Persona Nueva', 'Caja', 'acme', NULL);
        INSERT INTO user_companies (user_id, company_id, role) VALUES (1, 'acme', 'owner');
        INSERT INTO user_companies (user_id, company_id, role) VALUES (2, 'acme', 'Caja');
        INSERT INTO user_companies (user_id, company_id, role) VALUES (3, 'acme', 'Caja');
        INSERT INTO sales (id, company_id, user_id, date, items, total, summary, payment_method, status)
          VALUES (500, 'acme', 2, '2026-02-01T12:00:00.000Z', '[]', 5000, '1 productos', 'Efectivo', 'completed');
        INSERT INTO sales (id, company_id, user_id, date, items, total, summary, payment_method, status)
          VALUES (501, 'acme', 2, '2026-08-20T12:00:00.000Z', '[]', 7000, '2 productos', 'Efectivo', 'completed');
        INSERT INTO cash_registers (id, user_id, opening_amount, opening_time, status, company_id)
          VALUES (900, 2, 10000, '2026-02-01T08:00:00.000Z', 'closed', 'acme');
        INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, source)
          VALUES ('acme', 2, 'in', '2026-02-01T08:00:00.000Z', '2026-02-01', 'kiosk');
    `);

    console.log('1. Se da de baja con fecha y motivo');
    let r = await userActions.userTerminate(db, CO, dueño, { id: 2, endDate: '2026-08-31', reason: 'Renuncia: avisó con 15 días' });
    check('funciona', r.success === true, r.error || '');
    check('devuelve el nombre y la fecha', r.nombre === 'Katy' && r.salida === '2026-08-31', `${r.nombre} / ${r.salida}`);

    console.log('\n2. Ya no puede entrar, desde ningún equipo');
    check('sin membresía', !(await puedeEntrar(2)));

    console.log('\n3. Queda el legajo');
    let f = await ficha(2);
    check('marcada como dada de baja', f.labor_status === 'terminated', String(f.labor_status));
    check('con la fecha de salida', f.labor_end_date === '2026-08-31', String(f.labor_end_date));
    check('con el motivo', /Renuncia/.test(f.labor_end_reason), String(f.labor_end_reason));
    check('con quién la dio de baja', Number(f.labor_end_by) === 1, String(f.labor_end_by));
    check('y cuándo se registró', String(f.labor_end_at).startsWith(hoy), String(f.labor_end_at));

    console.log('\n4. NO se perdió nada de lo suyo');
    check('la ficha sigue existiendo', (await cuenta('SELECT COUNT(*) n FROM users WHERE id=2')) === 1);
    check('sus 2 ventas siguen ahí', (await cuenta('SELECT COUNT(*) n FROM sales WHERE user_id=2')) === 2);
    check('su cierre de caja sigue ahí', (await cuenta('SELECT COUNT(*) n FROM cash_registers WHERE user_id=2')) === 1);
    check('su asistencia sigue ahí', (await cuenta('SELECT COUNT(*) n FROM attendance_records WHERE user_id=2')) === 1);
    const nombre = (await db.execute('SELECT u.name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = 500')).rows[0];
    check('el historial sigue diciendo "Katy"', nombre.name === 'Katy', String(nombre.name));

    console.log('\n5. El ex personal, con sus fechas calculadas');
    const lista = await userActions.personalDadoDeBaja(db, CO);
    check('aparece en la lista', lista.personal.length === 1, String(lista.personal.length));
    const p = lista.personal[0];
    check('con su nombre', p.name === 'Katy', p.name);
    check('desde: la fecha de alta laboral', String(p.desde).startsWith('2026-01-15'), String(p.desde));
    check('hasta: la fecha de baja cargada', p.hasta === '2026-08-31', String(p.hasta));
    check('con sus 2 ventas contadas', Number(p.ventas) === 2, String(p.ventas));
    check('su caja contada', Number(p.cajas) === 1, String(p.cajas));
    check('su asistencia contada', Number(p.marcas) === 1, String(p.marcas));
    check('y quién la dio de baja', p.dado_de_baja_por === 'El Dueño', String(p.dado_de_baja_por));

    console.log('\n6. Sin fecha de alta, las fechas salen igual de los movimientos');
    await db.execute("UPDATE users SET labor_start_date = NULL WHERE id = 2");
    const l2 = await userActions.personalDadoDeBaja(db, CO);
    check('desde: su primera venta/caja', String(l2.personal[0].desde).startsWith('2026-02-01'), String(l2.personal[0].desde));

    console.log('\n7. Sin fecha de baja cargada, se usa el último movimiento');
    await db.execute("UPDATE users SET labor_end_date = NULL WHERE id = 2");
    const l3 = await userActions.personalDadoDeBaja(db, CO);
    check('hasta: su última venta', String(l3.personal[0].hasta).startsWith('2026-08-20'), String(l3.personal[0].hasta));

    console.log('\n8. Se puede reincorporar');
    r = await userActions.userReinstate(db, CO, dueño, { id: 2, role: 'Caja' });
    check('funciona', r.success === true, r.error || '');
    check('vuelve a poder entrar', await puedeEntrar(2));
    f = await ficha(2);
    check('la baja se limpia', f.labor_status === 'active' && f.labor_end_date === null, `${f.labor_status} / ${f.labor_end_date}`);
    check('ya no figura como ex personal', (await userActions.personalDadoDeBaja(db, CO)).personal.length === 0);
    // Reincorporar dos veces no puede reventar por la clave repetida.
    r = await userActions.userReinstate(db, CO, dueño, { id: 2, role: 'Caja' });
    check('reincorporar dos veces no falla', r.success === true, r.error || '');

    console.log('\n9. Los candados');
    r = await userActions.userTerminate(db, CO, dueño, { id: 1 });
    check('al dueño no se le puede dar de baja', r.success === false, String(r.success));
    r = await userActions.userTerminate(db, CO, dueño, { id: 1, endDate: hoy });
    check('ni con fecha', r.success === false);
    r = await userActions.userTerminate(db, CO, { uid: 3, role: 'Caja' }, { id: 2 });
    check('una cajera no puede dar de baja a nadie', r.success === false, r.error);
    r = await userActions.userTerminate(db, CO, { uid: 1, role: 'super_admin' }, { id: 1 });
    check('nadie se da de baja a sí mismo', r.success === false, r.error);

    console.log('\n10. Una fecha de salida en el futuro se acota a hoy');
    r = await userActions.userTerminate(db, CO, dueño, { id: 2, endDate: '2099-01-01', reason: 'Despido' });
    check('se registra', r.success === true, r.error || '');
    check('la salida queda en hoy, no en 2099', r.salida === hoy, r.salida);

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
