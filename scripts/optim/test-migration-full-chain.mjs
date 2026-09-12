// Aplica el esquema base y TODAS las migraciones posteriores en orden sobre un
// SQLite local, que es la secuencia real que corre en las dos bases de
// producción. No se replaya 0001-0024: esas ya están incorporadas en el
// snapshot 0000, y reaplicarlas encima del mismo snapshot choca por diseño
// (0000 se re-snapshotea cada tanto).
//
// La lista sale de leer la carpeta, no está escrita a mano: cuando la 0026 se
// dejó de lado, este archivo quedó pidiendo un .sql que ya no existía y la
// prueba fallaba por eso, no por un problema real. Ahora se adapta sola a lo
// que haya en `migrations/`.
//
//   node scripts/optim/test-migration-full-chain.mjs

import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fullchain-'));
const db = createClient({ url: `file:${join(dir, 'test.db').replace(/\\/g, '/')}` });

// El snapshot base más todo lo que vino después del corte (0025 en adelante).
const CORTE = 25;
const todas = readdirSync('migrations').filter(f => f.endsWith('.sql')).sort();
const secuencia = [
    '0000_base_schema.sql',
    ...todas.filter(f => {
        const n = parseInt(f.slice(0, 4), 10);
        return Number.isFinite(n) && n >= CORTE;
    }),
];

console.log(`Aplicando la secuencia real de producción:\n  ${secuencia.join('\n  ')}\n`);

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

try {
    for (const f of secuencia) {
        try {
            await db.executeMultiple(readFileSync(join('migrations', f), 'utf8'));
            check(f, true);
        } catch (e) {
            check(f, false, e.message);
            process.exit(1);
        }
    }

    console.log('\nLo que cada migración tenía que dejar:');

    // 0025 — asistencia (registro legal, Art. 33).
    const att = await db.execute('PRAGMA table_info(attendance_records)');
    check('0025: attendance_records con su columna seq', att.rows.some(c => c.name === 'seq'));

    // 0027 — baja de personal.
    const us = (await db.execute('PRAGMA table_info(users)')).rows.map(c => c.name);
    check('0027: users con labor_end_date / labor_end_reason',
        us.includes('labor_end_date') && us.includes('labor_end_reason'));

    // 0028 — historial de estados de un encargo.
    const hist = (await db.execute('PRAGMA table_info(preorder_status_history)')).rows.map(c => c.name);
    check('0028: preorder_status_history existe', hist.length > 0);
    for (const col of ['preorder_id', 'from_status', 'to_status', 'reason', 'user_id', 'user_name', 'source']) {
        check(`0028: tiene la columna ${col}`, hist.includes(col));
    }
    const idx = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_preorder_history%'",
    );
    check('0028: sus dos índices', idx.rows.length === 2, idx.rows.map(r => r.name).join(', '));

    // Que las migraciones no se pisen entre ellas.
    const pre = (await db.execute('PRAGMA table_info(preorders)')).rows.map(c => c.name);
    check('preorders sigue entera', pre.includes('status') && pre.includes('due_date'));
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows puede tener el archivo tomado */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
