// Pruebas de la llave de supervisor para cerrar caja con ventas offline sin
// subir (3-sep-2026).
//
// Por qué existe: el POS no deja cerrar con ventas del cajero todavía en el
// equipo, porque esa plata ya está en el cajón. Pero hay ventas que no entran
// por causas ajenas al cajero —sin stock con el modo ajuste apagado, sin folios
// CAF— y el turno igual tiene que terminar.
//
// Lo que hay que demostrar:
//   1. Sin clave, el cierre normal sigue funcionando igual que antes.
//   2. La clave se verifica de verdad (bcrypt) y contra usuarios de ESTA empresa.
//   3. Un cajero NO puede autorizarse a sí mismo: hace falta rol de supervisor.
//   4. Queda constancia: auditoría + observaciones del cierre.
//
//   node scripts/optim/test-cierre-autorizado.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActions } from '../../api/_lib/registerActions.js';
import { hashPassword } from '../../api/_lib/auth.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'caja-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';
const OTRA = 'otra-empresa';
const sesionCajero = { uid: 7, username: 'caja1' };

const cerrar = (registerId, override) =>
    registerActions.registerClose(db, CO, sesionCajero, {
        registerId, finalAmount: 50000, observations: 'Turno tarde', difference: -1200, override,
    });

const abrirCaja = async (userId) => {
    const r = await db.execute({
        sql: "INSERT INTO cash_registers (user_id, opening_amount, opening_time, status, company_id) VALUES (?, 10000, ?, 'open', ?) RETURNING id",
        args: [userId, new Date().toISOString(), CO],
    });
    return Number(r.rows[0].id);
};
const cajaDe = async (id) => (await db.execute({ sql: 'SELECT * FROM cash_registers WHERE id = ?', args: [id] })).rows[0];
const cuantasAuditorias = async () =>
    Number((await db.execute("SELECT COUNT(*) n FROM audit_logs WHERE action = 'FORCED_CLOSE'")).rows[0].n);

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.execute({ sql: "INSERT INTO companies (id, name) VALUES (?, 'Acme')", args: [CO] });
    await db.execute({ sql: "INSERT INTO companies (id, name) VALUES (?, 'Otra')", args: [OTRA] });
    await db.execute({
        sql: "INSERT INTO users (id, username, password, name, role, company_id) VALUES (7, 'caja1', ?, 'Caja Uno', 'Caja', ?)",
        args: [await hashPassword('caja123'), CO],
    });
    await db.execute({
        sql: "INSERT INTO users (id, username, password, name, role, company_id) VALUES (2, 'jefe', ?, 'La Jefa', 'Administrador', ?)",
        args: [await hashPassword('secreto123'), CO],
    });
    await db.execute({
        sql: "INSERT INTO users (id, username, password, name, role, company_id) VALUES (3, 'jefeajeno', ?, 'Jefe de Otro Local', 'Administrador', ?)",
        args: [await hashPassword('otro123'), OTRA],
    });

    console.log('1. El cierre normal, sin autorización, sigue igual');
    let id = await abrirCaja(7);
    let r = await cerrar(id, null);
    check('cierra', r.success === true, r.error || '');
    check('no queda marcado como forzado', !r.forzado);
    let caja = await cajaDe(id);
    check('queda cerrada', caja.status === 'closed', caja.status);
    check('la observación es la del cajero, sin agregados', caja.observations === 'Turno tarde', String(caja.observations));
    check('no se auditó nada', (await cuantasAuditorias()) === 0);

    console.log('\n2. La clave se verifica de verdad');
    id = await abrirCaja(7);
    r = await cerrar(id, { username: 'jefe', password: 'equivocada', pendientes: 3 });
    check('con la contraseña mal NO cierra', r.success === false, String(r.success));
    check('avisa que es un problema de credenciales', r._authFailed === true);
    check('no revela si el usuario existe', /Usuario o contraseña incorrectos/.test(r.error), r.error);
    check('la caja sigue abierta', (await cajaDe(id)).status === 'open');

    r = await cerrar(id, { username: 'noexiste', password: 'secreto123', pendientes: 3 });
    check('usuario inexistente: mismo mensaje genérico', /Usuario o contraseña incorrectos/.test(r.error), r.error);

    console.log('\n3. Hace falta rol de supervisor: el cajero no se autoriza solo');
    r = await cerrar(id, { username: 'caja1', password: 'caja123', pendientes: 3 });
    check('el cajero NO puede autorizarse', r.success === false, String(r.success));
    check('el motivo lo dice claro', /no tiene permiso para autorizar/.test(r.error), r.error);
    check('la caja sigue abierta', (await cajaDe(id)).status === 'open');

    console.log('\n4. El supervisor de OTRA empresa tampoco sirve');
    r = await cerrar(id, { username: 'jefeajeno', password: 'otro123', pendientes: 3 });
    check('rechazado', r.success === false, String(r.success));
    check('tratado como credencial inválida', /Usuario o contraseña incorrectos/.test(r.error), r.error);

    console.log('\n5. Con la clave correcta cierra y deja constancia');
    r = await cerrar(id, { username: 'jefe', password: 'secreto123', reason: 'sin folios CAF, se sube mañana', pendientes: 3 });
    check('cierra', r.success === true, r.error || '');
    check('queda marcado como forzado', r.forzado === true);
    caja = await cajaDe(id);
    check('la caja queda cerrada', caja.status === 'closed', caja.status);
    check('la observación conserva la del cajero', /Turno tarde/.test(caja.observations), String(caja.observations));
    check('y agrega quién autorizó', /CIERRE AUTORIZADO por La Jefa/.test(caja.observations), String(caja.observations));
    check('con cuántas ventas quedaban afuera', /3 venta/.test(caja.observations));
    check('y el motivo', /sin folios CAF/.test(caja.observations));

    const audit = await db.execute("SELECT * FROM audit_logs WHERE action = 'FORCED_CLOSE'");
    check('quedó una entrada en la auditoría', audit.rows.length === 1, audit.rows.length + ' entradas');
    const det = JSON.parse(audit.rows[0].details);
    check('la auditoría dice quién cerró', det.cerradaPor === 7, String(det.cerradaPor));
    check('y quién autorizó', det.autorizadaPor === 2 && det.autorizadaPorNombre === 'La Jefa', String(det.autorizadaPorNombre));
    check('y cuántas ventas quedaban', det.ventasSinSubir === 3, String(det.ventasSinSubir));
    check('y el descuadre', det.difference === -1200, String(det.difference));

    console.log('\n6. Un motivo larguísimo se recorta, no rompe nada');
    id = await abrirCaja(7);
    r = await cerrar(id, { username: 'jefe', password: 'secreto123', reason: 'x'.repeat(1000), pendientes: 1 });
    check('cierra igual', r.success === true, r.error || '');
    const obs = (await cajaDe(id)).observations;
    check('el motivo quedó acotado', obs.length < 500, obs.length + ' caracteres');

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
