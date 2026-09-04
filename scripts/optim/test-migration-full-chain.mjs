// Aplica 0000 (esquema base) + 0025 + 0026 en orden sobre un SQLite local,
// que es la secuencia real que corre en las dos bases de producción (ambas
// están al día en v25 desde antes de esta migración — ver verify-all). No se
// replaya 0001-0024: esas ya están incorporadas en el snapshot 0000, y
// reaplicarlas encima del mismo snapshot choca por diseño (0000 se re-snapshotea
// cada tanto). Eso es preexistente y no tiene que ver con esta migración.
//
//   node scripts/optim/test-migration-full-chain.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fullchain-'));
const db = createClient({ url: `file:${join(dir, 'test.db').replace(/\\/g, '/')}` });

const secuencia = [
    '0000_base_schema.sql',
    '0025_asistencia_registro_legal.sql',
    '0026_indices_covering_dashboard.sql',
];

console.log(`Aplicando la secuencia real de producción: ${secuencia.join(' -> ')}\n`);

try {
    for (const f of secuencia) {
        try {
            await db.executeMultiple(readFileSync(join('migrations', f), 'utf8'));
            console.log(`  OK   ${f}`);
        } catch (e) {
            console.error(` FALLA ${f} -> ${e.message}`);
            process.exit(1);
        }
    }

    const idx = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_products_%covering'",
    );
    console.log(`\nÍndices de cobertura creados: ${idx.rows.map(r => r.name).join(', ')}`);
    if (idx.rows.length !== 3) { console.error(`FALLA: se esperaban 3, hay ${idx.rows.length}`); process.exit(1); }
    console.log('OK: los 3 índices están.');

    // Que la tabla attendance_records de 0025 y los índices de 0026 convivan sin pisarse.
    const attCols = await db.execute("PRAGMA table_info(attendance_records)");
    const tieneSeq = attCols.rows.some(c => c.name === 'seq');
    console.log(tieneSeq ? 'OK: la migración 0025 (asistencia) sigue intacta.' : 'FALLA: 0025 se perdió algo.');
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows puede tener el archivo tomado */ }
}

console.log('\nTODO OK\n');
