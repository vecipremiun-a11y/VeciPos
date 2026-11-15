// Nombre de fantasía de la empresa (Kevin, 9-nov-2026; migración 0039): va
// arriba del menú en vez de POSVECI y distingue una empresa de otra en el
// selector (y en el traspaso entre sucursales que viene).
//
// Lo del servidor se prueba contra una base local con todas las migraciones.
// No toca ninguna base real.
//
//   node scripts/optim/test-nombre-fantasia.mjs

import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { limpiarNombreFantasia, nombreDeEmpresa, LARGO_NOMBRE_FANTASIA } from '../../src/lib/nombreFantasia.js';
import { companyActions } from '../../api/_lib/companyActions.js';
import { bootstrapActions } from '../../api/_lib/bootstrapActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

// ── 1. La limpieza ──────────────────────────────────────────────────────────
console.log('1. Limpieza del nombre');
check('espacios de más fuera', limpiarNombreFantasia('  Minimarket   Don  José ') === 'Minimarket Don José');
check('vacío = null', limpiarNombreFantasia('   ') === null && limpiarNombreFantasia('') === null && limpiarNombreFantasia(null) === null);
const largo = 'Panadería y Pastelería Santa Rosa de Lima';
const cortado = limpiarNombreFantasia(largo);
check(`se corta en ${LARGO_NOMBRE_FANTASIA} caracteres`, Array.from(cortado).length <= LARGO_NOMBRE_FANTASIA && largo.startsWith(cortado), cortado);
check('no queda con espacio al final después del corte', cortado === cortado.trim());
check('un emoji cuenta como un caracter', Array.from(limpiarNombreFantasia('🍞'.repeat(40))).length === LARGO_NOMBRE_FANTASIA);
check('selector: el de fantasía si tiene', nombreDeEmpresa({ id: 'a', name: 'Juan Pérez' }, { a: 'Don Juan' }) === 'Don Juan');
check('selector: el de siempre si no tiene', nombreDeEmpresa({ id: 'b', name: 'Sucursal Centro' }, { a: 'Don Juan' }) === 'Sucursal Centro');
check('selector: sin lista de nombres', nombreDeEmpresa({ id: 'b', name: 'Sucursal Centro' }, undefined) === 'Sucursal Centro');

// ── 2. Contra una base local ────────────────────────────────────────────────
const migraciones = readdirSync('migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
async function base(sin0039 = false) {
    const dir = mkdtempSync(join(tmpdir(), 'fantasia-'));
    const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
    // 0000 es una foto del esquema tomada después de varias migraciones, así que
    // algunas columnas ya vienen: se aplica sentencia por sentencia y se salta lo
    // que ya existe. La 0039 sí tiene que entrar limpia.
    for (const f of migraciones) {
        if (sin0039 && f.startsWith('0039')) continue;
        const sql = readFileSync(join('migrations', f), 'utf8').replace(/--[^\n]*/g, '');
        for (const sentencia of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
            try {
                await db.execute(sentencia);
            } catch (e) {
                if (f.startsWith('0039') || !/duplicate column|already exists/i.test(e.message)) throw e;
            }
        }
    }
    await db.executeMultiple(`
        INSERT INTO companies (id, name) VALUES ('acme', 'Juan Carlos Pérez González'), ('sucursal', 'Sucursal Centro'), ('otra', 'Otra'), ('suelta', 'Suelta');
        INSERT INTO user_companies (user_id, company_id, role) VALUES (7, 'acme', 'owner'), (7, 'sucursal', 'owner'), (8, 'otra', 'owner');
    `);
    return { db, dir };
}
const session = { uid: 7, username: 'jefe' };
const fantasia = async (db, id) => (await db.execute({ sql: 'SELECT fantasy_name FROM companies WHERE id = ?', args: [id] })).rows[0]?.fantasy_name;

console.log('\n2. Guardar desde Configuración → Empresa');
{
    const { db, dir } = await base();
    try {
        const cols = (await db.execute('PRAGMA table_info(companies)')).rows.map((r) => r.name);
        check('la migración 0039 agrega companies.fantasy_name', cols.includes('fantasy_name'));

        let r = await companyActions.companyFieldsUpdate(db, 'acme', session, { fields: { legal_name: 'Juan Carlos Pérez González', fantasy_name: '  Minimarket   Don José  ' } });
        check('guarda', r.success === true);
        check('limpio en la base', (await fantasia(db, 'acme')) === 'Minimarket Don José');
        check('el resto de los datos se guarda en la misma llamada', (await db.execute("SELECT legal_name FROM companies WHERE id = 'acme'")).rows[0].legal_name === 'Juan Carlos Pérez González');

        await companyActions.companyFieldsUpdate(db, 'sucursal', session, { fields: { fantasy_name: largo } });
        check(`uno largo queda en ${LARGO_NOMBRE_FANTASIA}`, (await fantasia(db, 'sucursal')) === cortado);

        await companyActions.companyFieldsUpdate(db, 'acme', session, { fields: { legal_name: 'Otro', city: 'Iquique' } });
        check('si no se manda, no se toca', (await fantasia(db, 'acme')) === 'Minimarket Don José');

        console.log('\n3. El arranque lo trae para el menú y el selector');
        const b = await bootstrapActions.bootstrap(db, 'acme', session);
        check('arranca bien', b.success === true);
        check('trae los de sus empresas', b.fantasyNames?.acme === 'Minimarket Don José' && b.fantasyNames?.sucursal === cortado, JSON.stringify(b.fantasyNames));
        await db.execute("UPDATE companies SET fantasy_name = 'De Otro' WHERE id = 'otra'");
        const b2 = await bootstrapActions.bootstrap(db, 'acme', session);
        check('no trae el de una empresa ajena', !('otra' in b2.fantasyNames));
        await db.execute("UPDATE companies SET fantasy_name = 'Suelta SpA' WHERE id = 'suelta'");
        const b3 = await bootstrapActions.bootstrap(db, 'suelta', { uid: 1, role: 'super_admin' });
        check('la empresa activa aunque no esté en sus empresas (super admin)', b3.fantasyNames?.suelta === 'Suelta SpA', JSON.stringify(b3.fantasyNames));

        await companyActions.companyFieldsUpdate(db, 'acme', session, { fields: { fantasy_name: '   ' } });
        check('borrarlo lo deja en NULL', (await fantasia(db, 'acme')) === null);
        const b4 = await bootstrapActions.bootstrap(db, 'acme', session);
        check('y ya no viene (el menú vuelve a POSVECI)', !('acme' in b4.fantasyNames) && b4.fantasyNames.sucursal === cortado);

        const otraCol = await companyActions.companyFieldsUpdate(db, 'acme', session, { fields: { plan: 'gratis', fantasy_name: 'X' } });
        check('la lista blanca sigue: plan no se escribe', otraCol.success && (await db.execute("SELECT plan FROM companies WHERE id = 'acme'")).rows[0].plan !== 'gratis');
    } finally {
        db.close();
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces lo retiene */ }
    }
}

console.log('\n4. Si el código llega antes que la migración');
{
    const { db, dir } = await base(true);
    try {
        const b = await bootstrapActions.bootstrap(db, 'acme', session);
        check('el arranque no se cae', b.success === true && Array.isArray(b.categories));
        check('viene sin nombres (null: el navegador se queda con lo último)', b.fantasyNames === null);
    } finally {
        db.close();
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces lo retiene */ }
    }
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
