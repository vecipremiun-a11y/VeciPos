// Aplica el esquema base + la migración 0025 sobre un SQLite local para
// comprobar que la migración corre limpia ANTES de tocar cualquier base real.
//
//   node scripts/db/test-migration-0025.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mig-'));
const file = join(dir, 'test.db').replace(/\\/g, '/');
const db = createClient({ url: `file:${file}` });

let failures = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
    if (!ok) failures++;
};

const cols = async (table) => {
    const r = await db.execute(`PRAGMA table_info(${table})`);
    return r.rows.map(c => c.name);
};

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    console.log('Esquema base aplicado.\n');

    await db.executeMultiple(readFileSync('migrations/0025_asistencia_registro_legal.sql', 'utf8'));
    console.log('Migración 0025 aplicada sin errores.\n');

    const u = await cols('users');
    check('users.rut', u.includes('rut'));
    check('users.labor_weekly_hours', u.includes('labor_weekly_hours'));
    check('users.labor_exempt_art22', u.includes('labor_exempt_art22'));

    const a = await cols('attendance_records');
    for (const c of ['seq', 'hash', 'prev_hash', 'user_rut', 'user_name', 'device_id',
        'origin_ip', 'created_at', 'voided_at', 'voided_by', 'void_reason', 'replaced_by_record_id']) {
        check(`attendance_records.${c}`, a.includes(c));
    }

    const pc = await cols('personal_config');
    check('personal_config.legal_weekly_hours', pc.includes('legal_weekly_hours'));
    check('personal_config.legal_daily_max_hours', pc.includes('legal_daily_max_hours'));
    check('personal_config.legal_max_overtime_daily', pc.includes('legal_max_overtime_daily'));

    const idx = await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_attendance_company_seq'");
    check('índice único (company_id, seq)', idx.rows.length === 1);

    // attendance_records tiene FK a users: hay que crear los trabajadores primero.
    await db.executeMultiple(`
        INSERT INTO users (id, username, password, name, role, company_id, rut)
        VALUES (1, 'ana', 'x', 'Ana Soto', 'Caja', 'acme', '12345678-5');
        INSERT INTO users (id, username, password, name, role, company_id)
        VALUES (2, 'beto', 'x', 'Beto Díaz', 'Caja', 'acme');
    `);

    // Varias filas históricas con seq NULL deben poder convivir bajo el índice único.
    await db.executeMultiple(`
        INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date)
        VALUES ('acme', 1, 'entry', '2026-08-01T12:00:00Z', '2026-08-01');
        INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date)
        VALUES ('acme', 2, 'entry', '2026-08-01T12:05:00Z', '2026-08-01');
    `);
    const nulls = await db.execute("SELECT COUNT(*) n FROM attendance_records WHERE seq IS NULL");
    check('el índice único admite varias filas históricas con seq NULL', Number(nulls.rows[0].n) === 2);

    // Y el mismo seq no puede repetirse dentro de una empresa.
    await db.execute("INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, seq) VALUES ('acme', 1, 'entry', 'x', 'd', 1)");
    let rejected = false;
    try {
        await db.execute("INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, seq) VALUES ('acme', 2, 'exit', 'y', 'd', 1)");
    } catch { rejected = true; }
    check('rechaza dos marcas con el mismo folio en la misma empresa', rejected);

    await db.execute("INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, seq) VALUES ('otra', 1, 'entry', 'z', 'd', 1)");
    check('permite el mismo folio en OTRA empresa', true);

    // La migración es idempotente en lo que puede serlo: reaplicarla debe fallar
    // por columna duplicada, no dejar la base a medias. Se comprueba el mensaje.
    let secondRun = null;
    try {
        await db.executeMultiple(readFileSync('migrations/0025_asistencia_registro_legal.sql', 'utf8'));
    } catch (e) { secondRun = String(e.message || e); }
    check('reaplicarla falla con "duplicate column" (esperado, no se reaplica)',
        !!secondRun && /duplicate column/i.test(secondRun), secondRun ? secondRun.slice(0, 60) : 'no falló');
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows puede tener el archivo tomado */ }
}

console.log(failures === 0 ? '\nTODO OK\n' : `\n${failures} PRUEBAS FALLARON\n`);
process.exit(failures === 0 ? 0 : 1);
