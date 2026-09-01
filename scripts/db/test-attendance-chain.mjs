// Prueba de la cadena de integridad de asistencia contra un SQLite local.
//
// No toca Turso ni ninguna base real: crea un archivo temporal, aplica el
// esquema mínimo + la migración 0025, marca asistencia, y después ROMPE la
// base a propósito para comprobar que la verificación lo detecta.
//
//   node scripts/db/test-attendance-chain.mjs

import { createClient } from '@libsql/client';
import { appendAttendanceRecord, verifyChain } from '../../api/_lib/attendanceChain.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chain-'));
const file = join(dir, 'test.db');
const db = createClient({ url: `file:${file.replace(/\\/g, '/')}` });

let failures = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${label}${extra ? ' -> ' + extra : ''}`);
    if (!ok) failures++;
};

try {
    await db.executeMultiple(`
        CREATE TABLE attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL, user_id INTEGER NOT NULL, type TEXT NOT NULL,
            recorded_at TEXT NOT NULL, date TEXT NOT NULL, source TEXT DEFAULT 'kiosk',
            device_label TEXT, branch TEXT, recorded_by INTEGER, notes TEXT,
            is_corrected INTEGER DEFAULT 0,
            seq INTEGER, hash TEXT, prev_hash TEXT, user_rut TEXT, user_name TEXT,
            device_id TEXT, origin_ip TEXT, created_at TEXT,
            voided_at TEXT, voided_by INTEGER, void_reason TEXT, replaced_by_record_id INTEGER
        );
        CREATE UNIQUE INDEX idx_attendance_company_seq ON attendance_records(company_id, seq);
    `);

    // Marcas históricas anteriores a la migración: seq NULL, fuera de la cadena.
    await db.execute({
        sql: `INSERT INTO attendance_records (company_id, user_id, type, recorded_at, date, source)
              VALUES ('acme', 1, 'entry', '2026-08-01T12:00:00.000Z', '2026-08-01', 'kiosk')`,
        args: [],
    });

    console.log('\n1. Marcas encadenadas');
    const marks = [];
    for (let i = 0; i < 6; i++) {
        marks.push(await appendAttendanceRecord(db, 'acme', {
            userId: 1 + (i % 2),
            type: i % 2 === 0 ? 'entry' : 'exit',
            recordedAt: `2026-09-01T1${i}:00:00.000Z`,
            date: '2026-09-01',
            source: 'kiosk',
            deviceId: 'dev-1',
            userName: 'Trabajador Uno',
            userRut: '12345678-5',
            createdAt: `2026-09-01T1${i}:00:00.000Z`,
        }));
    }
    check('folios correlativos desde 1', marks.map(m => m.seq).join(',') === '1,2,3,4,5,6', marks.map(m => m.seq).join(','));
    check('cada marca tiene hash de 64 hex', marks.every(m => /^[0-9a-f]{64}$/.test(m.hash)));

    // Otra empresa lleva su propio correlativo.
    const otra = await appendAttendanceRecord(db, 'otra', {
        userId: 9, type: 'entry', recordedAt: '2026-09-01T09:00:00.000Z',
        date: '2026-09-01', source: 'kiosk', userName: 'X', userRut: null,
        createdAt: '2026-09-01T09:00:00.000Z',
    });
    check('el correlativo es por empresa (otra empresa parte en 1)', otra.seq === 1, `seq=${otra.seq}`);

    console.log('\n2. Verificación con la base intacta');
    let v = await verifyChain(db, 'acme');
    check('6 marcas revisadas', v.checked === 6, `checked=${v.checked}`);
    check('sin problemas', v.problems.length === 0, JSON.stringify(v.problems));

    console.log('\n3. Anular una marca NO debe romper la cadena');
    await db.execute({
        sql: `UPDATE attendance_records SET is_corrected = 1, voided_at = ?, void_reason = ?
              WHERE company_id = 'acme' AND seq = 3`,
        args: ['2026-09-02T10:00:00.000Z', 'Corrección aprobada'],
    });
    v = await verifyChain(db, 'acme');
    check('la cadena sigue íntegra tras anular', v.problems.length === 0, JSON.stringify(v.problems));

    console.log('\n4. Alterar la hora de una marca SÍ debe detectarse');
    await db.execute({
        sql: `UPDATE attendance_records SET recorded_at = '2026-09-01T08:00:00.000Z'
              WHERE company_id = 'acme' AND seq = 2`,
        args: [],
    });
    v = await verifyChain(db, 'acme');
    const tampered = v.problems.find(p => p.kind === 'tampered' && p.seq === 2);
    check('detecta la marca modificada', !!tampered, JSON.stringify(v.problems));

    console.log('\n5. Borrar una marca debe dejar un hueco visible');
    await db.execute({ sql: `DELETE FROM attendance_records WHERE company_id = 'acme' AND seq = 5`, args: [] });
    v = await verifyChain(db, 'acme');
    const gap = v.problems.find(p => p.kind === 'gap');
    check('detecta el folio faltante', !!gap, gap ? gap.detail : JSON.stringify(v.problems));

    console.log('\n6. Marcas simultáneas no pueden repetir folio');
    const db2 = createClient({ url: `file:${file.replace(/\\/g, '/')}` });
    const concurrent = await Promise.all(
        Array.from({ length: 5 }, (_, i) => appendAttendanceRecord(db2, 'paralelo', {
            userId: 100 + i, type: 'entry', recordedAt: `2026-09-01T2${i}:00:00.000Z`,
            date: '2026-09-01', source: 'kiosk', userName: `U${i}`, userRut: null,
            createdAt: `2026-09-01T2${i}:00:00.000Z`,
        })),
    );
    const seqs = concurrent.map(c => c.seq).sort((a, b) => a - b);
    check('5 marcas simultáneas -> folios 1..5 sin repetir', seqs.join(',') === '1,2,3,4,5', seqs.join(','));
    const vp = await verifyChain(db2, 'paralelo');
    check('la cadena paralela queda íntegra', vp.problems.length === 0, JSON.stringify(vp.problems));
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* el archivo puede quedar tomado en Windows */ }
}

console.log(failures === 0 ? '\nTODO OK\n' : `\n${failures} PRUEBAS FALLARON\n`);
process.exit(failures === 0 ? 0 : 1);
