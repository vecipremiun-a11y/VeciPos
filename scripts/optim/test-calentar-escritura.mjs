// Prueba del calentado del camino de escritura (4-sep-2026).
//
// Qué se midió contra producción: las LECTURAS contestan en ~130 ms siempre.
// Las ESCRITURAS cuestan ~260 ms con el nodo primario despierto, pero la
// PRIMERA después de un rato sin escribir costó 10.582 ms. Diez segundos y
// medio. La venta que caiga justo ahí se pasa del límite de 12 s del navegador
// y termina en la cola offline: no se pierde, pero la cajera espera y la venta
// no queda registrada al toque.
//
// Verificado que es de la BASE y no de la conexión: apenas despierta, una
// conexión recién creada escribe en 258 ms.
//
//   node scripts/optim/test-calentar-escritura.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calentarEscritura } from '../../api/_lib/salesActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'calentar-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.execute("INSERT INTO companies (id, name) VALUES ('acme', 'Acme')");
    const cuantas = async () => Number((await db.execute('SELECT COUNT(*) n FROM companies')).rows[0].n);

    console.log('1. Calienta sin dejar rastro');
    const antes = await cuantas();
    const r = await calentarEscritura(db);
    check('funciona', r.success === true, r.error || '');
    check('informa cuánto tardó', typeof r.ms === 'number', String(r.ms) + ' ms');
    check('NO cambió ningún dato', (await cuantas()) === antes, `${await cuantas()} vs ${antes}`);

    console.log('\n2. Se puede llamar muchas veces seguidas');
    for (let i = 0; i < 5; i++) {
        const x = await calentarEscritura(db);
        if (!x.success) { check(`llamada ${i + 1}`, false, x.error); break; }
    }
    check('cinco llamadas seguidas, sin problema', true);
    check('los datos siguen intactos', (await cuantas()) === antes);

    console.log('\n3. No deja la transacción abierta (si no, la próxima venta se traba)');
    // Si el rollback no se hubiera hecho, esta escritura quedaría esperando.
    const a = Date.now();
    await db.execute("INSERT INTO companies (id, name) VALUES ('otra', 'Otra')");
    check('una escritura normal entra enseguida', Date.now() - a < 3000, (Date.now() - a) + ' ms');

    console.log('\n4. Si la base falla, NO rompe nada');
    const baseRota = {
        transaction: async () => { throw new Error('SERVER_ERROR: base caída'); },
    };
    const r2 = await calentarEscritura(baseRota);
    check('no lanza excepción', r2 && typeof r2 === 'object');
    check('informa el fallo sin dramatizar', r2.success === false, r2.error);
    check('igual dice cuánto tardó', typeof r2.ms === 'number');

    console.log('\n5. Si falla a mitad, tampoco deja la transacción colgada');
    const aMedias = {
        transaction: async () => ({
            execute: async () => { throw new Error('se cortó'); },
            rollback: async () => { aMedias.deshizo = true; },
        }),
    };
    const r3 = await calentarEscritura(aMedias);
    check('devuelve fallo', r3.success === false);
    check('deshizo la transacción', aMedias.deshizo === true);

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
