// Prueba de extremo a extremo del flujo de asistencia contra un SQLite local.
//
// Ejercita las acciones reales de api/_lib/personalActions.js (las mismas que
// llama el navegador) sobre una base desechable: marcar, marcar manual,
// corregir y verificar. No toca Turso.
//
//   node scripts/db/test-attendance-flow.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { personalActions } from '../../api/_lib/personalActions.js';

const dir = mkdtempSync(join(tmpdir(), 'flow-'));
const db = createClient({ url: `file:${join(dir, 'test.db').replace(/\\/g, '/')}` });

const CO = 'acme';
const session = { uid: 99, username: 'jefe', role: 'Administrador', ip: '190.0.0.1' };

let failures = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
    if (!ok) failures++;
};
const call = (name, body) => personalActions[name](db, CO, session, body);

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.executeMultiple(readFileSync('migrations/0025_asistencia_registro_legal.sql', 'utf8'));
    await db.executeMultiple(`
        INSERT INTO users (id, username, password, name, role, company_id, rut,
                           has_labor_profile, labor_pin, labor_status, labor_weekly_hours)
        VALUES (1, 'ana', 'x', 'Ana Soto', 'Caja', 'acme', '12345678-5', 1, '1234', 'active', 42);
        INSERT INTO users (id, username, password, name, role, company_id, has_labor_profile, labor_pin, labor_status)
        VALUES (99, 'jefe', 'x', 'Jefe', 'Administrador', 'acme', 0, NULL, 'active');
    `);

    console.log('\n1. Buscar trabajador por PIN');
    const byPin = await call('laborProfileByPin', { pin: '1234' });
    check('encuentra a Ana por su PIN', byPin.user?.name === 'Ana Soto');
    check('el perfil trae el RUT', byPin.user?.rut === '12345678-5', String(byPin.user?.rut));

    console.log('\n2. Marcar entrada y salida desde el kiosco');
    const e1 = await call('attendanceMark', {
        userId: 1, type: 'auto', deviceLabel: 'Kiosco', branch: 'Central',
        date: '2026-09-01', deviceId: 'dev-abc',
    });
    check('primera marca del día = entrada', e1.type === 'entry', e1.type);
    check('devuelve comprobante con folio 1', e1.receipt?.folio === 1, String(e1.receipt?.folio));
    check('el comprobante trae nombre y RUT', e1.receipt?.name === 'Ana Soto' && e1.receipt?.rut === '12345678-5');
    check('el comprobante trae hash', /^[0-9a-f]{64}$/.test(e1.receipt?.hash || ''));

    const e2 = await call('attendanceMark', {
        userId: 1, type: 'auto', deviceLabel: 'Kiosco', branch: 'Central',
        date: '2026-09-01', deviceId: 'dev-abc',
    });
    check('segunda marca = salida', e2.type === 'exit', e2.type);
    check('folio correlativo 2', e2.receipt?.folio === 2, String(e2.receipt?.folio));

    const guardada = await db.execute("SELECT * FROM attendance_records WHERE seq = 1");
    check('guarda el dispositivo', guardada.rows[0].device_id === 'dev-abc');
    check('guarda la IP de origen', guardada.rows[0].origin_ip === '190.0.0.1', String(guardada.rows[0].origin_ip));
    check('guarda la identidad congelada', guardada.rows[0].user_rut === '12345678-5' && guardada.rows[0].user_name === 'Ana Soto');

    console.log('\n3. Estado del trabajador');
    const st = await call('attendanceStatus', { userId: 1, today: '2026-09-01' });
    check('tras la salida queda "outside"', st.status === 'outside', st.status);

    console.log('\n4. Marca manual: exige motivo escrito');
    const sinMotivo = await call('attendanceManual', {
        userId: 1, type: 'entry', datetime: '2026-09-02T09:00:00.000Z', date: '2026-09-02', notes: '   ',
    });
    check('rechaza la marca manual sin motivo', sinMotivo.success === false, sinMotivo.error);

    const conMotivo = await call('attendanceManual', {
        userId: 1, type: 'entry', datetime: '2026-09-02T09:00:00.000Z', date: '2026-09-02',
        notes: 'Olvidó marcar, confirmado por el supervisor', recordedBy: 99,
    });
    check('acepta la marca manual con motivo', conMotivo.success === true);
    check('la manual también entra en la cadena (folio 3)', conMotivo.folio === 3, String(conMotivo.folio));

    console.log('\n5. Corrección aprobada: anula sin borrar y encadena la nueva');
    await call('correctionRequest', {
        data: {
            user_id: 1, original_record_id: 1, correction_type: 'edit_time',
            original_at: '2026-09-01T12:00:00.000Z', requested_at: '2026-09-01T08:30:00.000Z',
            requested_date: '2026-09-01', reason: 'Marqué tarde, entré a las 8:30',
        },
    });
    const pend = await call('correctionsPending', {});
    check('la solicitud queda pendiente', pend.rows.length === 1);

    const apr = await call('correctionApprove', { correctionId: pend.rows[0].id, reviewerNotes: 'Verificado', reviewedBy: 99 });
    check('aprueba la corrección', apr.success === true, apr.error);

    const orig = (await db.execute('SELECT * FROM attendance_records WHERE seq = 1')).rows[0];
    check('la marca original NO se borra', !!orig);
    check('queda marcada como anulada', Number(orig.is_corrected) === 1);
    check('la anulación deja motivo', /Corrección/.test(String(orig.void_reason || '')), String(orig.void_reason));
    check('la anulación deja revisor y hora', Number(orig.voided_by) === 99 && !!orig.voided_at);
    check('apunta al registro que la reemplaza', orig.replaced_by_record_id != null, String(orig.replaced_by_record_id));

    const nueva = (await db.execute('SELECT * FROM attendance_records WHERE seq = 4')).rows[0];
    check('la corrección crea una marca nueva encadenada', !!nueva && nueva.source === 'correction', nueva?.source);
    check('con la hora solicitada', nueva?.recorded_at === '2026-09-01T08:30:00.000Z', String(nueva?.recorded_at));

    const doble = await call('correctionApprove', { correctionId: pend.rows[0].id, reviewedBy: 99 });
    check('no deja aprobar dos veces la misma corrección', doble.success === false, doble.error);

    console.log('\n6. Verificación de integridad');
    const v = await call('attendanceVerify', {});
    check('la cadena queda íntegra tras todo el flujo', v.intact === true, JSON.stringify(v.problems));
    check('revisó las 4 marcas', v.checked === 4, String(v.checked));

    console.log('\n7. Consulta de rango para el libro');
    const rango = await call('attendanceRange', { startDate: '2026-09-01', endDate: '2026-09-30' });
    check('devuelve las marcas del período', rango.rows.length === 4, String(rango.rows.length));
    check('viene ordenado ascendente', rango.rows[0].recorded_at <= rango.rows[1].recorded_at);
    check('incluye RUT y jornada pactada', rango.rows[0].rut === '12345678-5' && Number(rango.rows[0].labor_weekly_hours) === 42);

    console.log('\n8. Comprobante por folio');
    const rec = await call('attendanceReceipt', { folio: 2 });
    check('recupera el comprobante por folio', rec.success && rec.record.seq === 2);
    const noExiste = await call('attendanceReceipt', { folio: 999 });
    check('folio inexistente devuelve error', noExiste.success === false);

    console.log('\n9. RUT inválido en la ficha laboral');
    const malRut = await call('laborProfileUpdate', { userId: 1, data: { rut: '12345678-4' } });
    check('rechaza un RUT con DV incorrecto', malRut.success === false, malRut.error);
    const buenRut = await call('laborProfileUpdate', { userId: 1, data: { rut: '9.999.999-3' } });
    check('acepta y normaliza un RUT válido', buenRut.success === true);
    const guardado = (await db.execute('SELECT rut FROM users WHERE id = 1')).rows[0].rut;
    check('lo guarda sin puntos', guardado === '9999999-3', String(guardado));
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows puede tener el archivo tomado */ }
}

console.log(failures === 0 ? '\nTODO OK\n' : `\n${failures} PRUEBAS FALLARON\n`);
process.exit(failures === 0 ? 0 : 1);
