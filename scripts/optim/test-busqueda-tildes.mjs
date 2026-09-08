// El buscador y las tildes en MAYÚSCULA (8-sep-2026).
//
// Kevin: "mi app aún sigue con tilde evadiendo el producto, que por sola esa
// tilde no lo encuentra". No estaba con una versión vieja: el arreglo del
// 31-ago (2d9afc8) estaba puesto pero incompleto.
//
// LA CAUSA. `lower()` de SQLite solo baja el alfabeto inglés. Comprobado contra
// la base real:
//
//     lower('PIÑA')    → 'piÑa'
//     lower('CAFÉ')    → 'cafÉ'
//     lower('MARAÑÓN') → 'maraÑÓn'
//
// Los REPLACE que sacan las tildes solo buscaban la versión minúscula, así que
// esas letras pasaban de largo. En el catálogo de producción: "Carozzi Cabello
// Ángel Corto 400g" no aparecía al escribir "angel".
//
// Del lado del término escrito nunca hubo problema: JavaScript sí baja letras
// acentuadas. El desnivel estaba solo en la columna.
//
//   node scripts/optim/test-busqueda-tildes.mjs

import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportRun } from '../../api/_lib/reportActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'tildes-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
const CO = 'acme';

// Se llama al reporte real del servidor, el mismo que usa el buscador del POS.
const buscar = async (termino) => {
    const r = await reportRun(db, CO, null, { name: 'productsSearch', params: { term: termino, limit: 50 } });
    return (r?.rows?.[0] || []).map(p => p.name);
};

try {
    await db.executeMultiple(readFileSync('migrations/0000_base_schema.sql', 'utf8'));
    await db.execute("INSERT INTO companies (id, name) VALUES ('acme', 'Acme')");
    const productos = [
        'Carozzi Cabello Ángel Corto 400g',   // el caso real de producción
        'PIÑA EN CONSERVA 500g',              // todo en mayúscula, como una factura
        'Café Colombiano Molido',
        'CAFÉ INSTANTÁNEO 170g',
        'Pingüino Helado Vainilla',
        'PINGÜINO CHOCOLATE',
        'Ají Verde 1kg',
        'MARAÑÓN Tostado',
        'Leche Entera Soprole',               // sin tildes, de control
    ];
    for (let i = 0; i < productos.length; i++) {
        await db.execute({
            sql: `INSERT INTO products (id, company_id, name, sku, price, cost, stock, tax_rate, unit, category)
                  VALUES (?, 'acme', ?, ?, 1000, 600, 10, 19, 'Und', 'General')`,
            args: [i + 1, productos[i], `SKU${i + 1}`],
        });
    }

    console.log('1. SQLite no baja las mayúsculas acentuadas (la causa)');
    const l = (await db.execute("SELECT lower('PIÑA') a, lower('CAFÉ') b")).rows[0];
    check('lower(\'PIÑA\') deja la Ñ arriba', l.a === 'piÑa', `'${l.a}'`);
    check('lower(\'CAFÉ\') deja la É arriba', l.b === 'cafÉ', `'${l.b}'`);
    check('>>> por eso hace falta reemplazar también las mayúsculas', true);

    console.log('\n2. El caso que reportó Kevin');
    let r = await buscar('angel');
    check('"angel" encuentra "Cabello Ángel"', r.some(n => n.includes('Ángel')), r.join(' | ') || '(nada)');

    console.log('\n3. Producto escrito TODO en mayúscula');
    r = await buscar('pina');
    check('"pina" encuentra "PIÑA EN CONSERVA"', r.some(n => n.includes('PIÑA')), r.join(' | ') || '(nada)');
    r = await buscar('cafe');
    check('"cafe" encuentra los dos cafés', r.length === 2, r.join(' | '));
    r = await buscar('instantaneo');
    check('"instantaneo" encuentra "INSTANTÁNEO"', r.some(n => n.includes('INSTANTÁNEO')), r.join(' | ') || '(nada)');

    console.log('\n4. La diéresis, que ni siquiera estaba contemplada en un lado');
    r = await buscar('pinguino');
    check('"pinguino" encuentra los dos pingüinos', r.length === 2, r.join(' | '));

    console.log('\n5. Y la ñ y la ó juntas');
    r = await buscar('maranon');
    check('"maranon" encuentra "MARAÑÓN"', r.some(n => n.includes('MARAÑÓN')), r.join(' | ') || '(nada)');

    console.log('\n6. Al revés también: escribir CON tilde encuentra igual');
    r = await buscar('ÁNGEL');
    check('"ÁNGEL" en mayúscula lo encuentra', r.some(n => n.includes('Ángel')), r.join(' | ') || '(nada)');
    r = await buscar('piña');
    check('"piña" con tilde lo encuentra', r.some(n => n.includes('PIÑA')), r.join(' | ') || '(nada)');

    console.log('\n7. Lo que ya andaba sigue andando');
    r = await buscar('aji');
    check('"aji" encuentra "Ají Verde"', r.some(n => n.includes('Ají')), r.join(' | ') || '(nada)');
    r = await buscar('leche');
    check('un producto sin tildes no cambia', r.length === 1 && r[0] === 'Leche Entera Soprole', r.join(' | '));
    r = await buscar('entera leche');
    check('las palabras en desorden siguen funcionando', r.length === 1, r.join(' | '));
    r = await buscar('zzzz');
    check('lo que no existe sigue sin aparecer', r.length === 0, r.join(' | '));

} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
