// Usuario recién creado = Activo (Kevin, 13-nov-2026).
//
// La pantalla Usuarios separa Activos / Eliminados por `company_role` (la
// membresía en user_companies). userCreate devolvía la fila de `users` sin ese
// dato, y el usuario nuevo aparecía en Eliminados hasta refrescar la página.
//
// Se prueba contra una base local con todas las migraciones. No toca ninguna
// base real.
//
//   node scripts/optim/test-usuario-nuevo-activo.mjs

import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userActions } from '../../api/_lib/userActions.js';

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const dir = mkdtempSync(join(tmpdir(), 'usuario-'));
const db = createClient({ url: `file:${join(dir, 't.db').split(String.fromCharCode(92)).join('/')}` });
try {
    // Igual que test-boleta-mostrar: 0000 es una foto del esquema, así que se
    // aplica sentencia por sentencia y se salta lo que ya existe.
    for (const f of readdirSync('migrations').filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
        const sql = readFileSync(join('migrations', f), 'utf8').replace(/--[^\n]*/g, '');
        for (const s of sql.split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean)) {
            try { await db.execute(s); } catch (e) {
                if (!/duplicate column|already exists/i.test(e.message)) throw e;
            }
        }
    }
    await db.execute("INSERT INTO companies (id, name) VALUES ('acme', 'Acme')");
    const session = { uid: 1, username: 'kevin', role: 'super_admin' };

    const r = await userActions.userCreate(db, 'acme', session, {
        user: { name: 'Pedro', username: 'pedro', password: '1234', role: 'Caja', labor_status: 'active' },
    });
    check('crea el usuario', r.success === true, r.error);
    check('vuelve con su membresía (company_role)', r.user?.company_role === 'Caja', JSON.stringify(r.user?.company_role));
    // Lo que viaja al navegador es JSON: el dato tiene que sobrevivir la serialización.
    const json = JSON.parse(JSON.stringify(r));
    check('company_role llega al navegador', json.user.company_role === 'Caja');
    check('y el resto de la ficha también', json.user.id > 0 && json.user.name === 'Pedro' && json.user.username === 'pedro' && json.user.role === 'Caja');
    check('sin la contraseña', !('password' in json.user));

    const m = (await db.execute({ sql: 'SELECT role FROM user_companies WHERE user_id = ? AND company_id = ?', args: [json.user.id, 'acme'] })).rows[0];
    check('la membresía quedó en la base con el mismo rol', m?.role === 'Caja');

    // Lo mismo que carga la app al refrescar (bootstrap): tiene que coincidir.
    const b = (await db.execute({
        sql: 'SELECT u.*, uc.role AS company_role FROM users u LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ? WHERE u.company_id = ? AND u.id = ?',
        args: ['acme', 'acme', json.user.id],
    })).rows[0];
    check('igual que al refrescar la página', b?.company_role === json.user.company_role);
} finally {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
