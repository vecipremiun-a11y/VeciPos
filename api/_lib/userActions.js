// Usuarios de una empresa server-side (Fase 1 · Paso 31). Las validaciones de
// ROL ahora se enforcan en el servidor (antes solo en el cliente): crear/editar
// exige Administrador/owner/super_admin; eliminar exige owner/super_admin.
// La contraseña se hashea con bcrypt EN EL SERVIDOR (el navegador ya no la ve).

import { hashPassword } from './auth.js';
import { rutIsValid, normalizeRut } from './rut.js';

// libSQL no acepta `undefined` como valor de bind → coercionar a null.
const nn = (v) => (v === undefined ? null : v);

const USER_COLS = `id, name, username, role, company_id, rut, has_labor_profile, labor_position,
    labor_branch, labor_start_date, labor_status, labor_pin, labor_weekly_hours, labor_exempt_art22,
    pay_type, pay_method, pay_day,
    pay_base_amount, pay_fixed_bonus, pay_fixed_discount, pay_bank_name, pay_bank_account,
    pay_bank_account_type, pay_bank_owner`;

// El RUT identifica al trabajador en el registro de asistencia. Si viene, tiene
// que ser válido: guardarlo malo es peor que no tenerlo, porque da falsa certeza.
function checkRut(user) {
    const raw = user?.rut;
    if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
    if (!rutIsValid(raw)) return { ok: false, error: 'El RUT no es válido' };
    return { ok: true, value: normalizeRut(raw) };
}

// Rol del actor en la empresa (user_companies) + rol global (users)
async function actorRoles(turso, companyId, session) {
    const globalRole = session?.role || null;
    if (globalRole === 'super_admin') return { globalRole, companyRole: 'super_admin', isOwner: true, isAdmin: true };
    const r = await turso.execute({
        sql: 'SELECT role FROM user_companies WHERE user_id = ? AND company_id = ? LIMIT 1',
        args: [session?.uid ?? null, companyId],
    });
    const companyRole = r.rows[0]?.role || null;
    const isOwner = companyRole === 'owner';
    const isAdmin = isOwner || companyRole === 'Administrador' || globalRole === 'Administrador';
    return { globalRole, companyRole, isOwner, isAdmin };
}

async function userCreate(turso, companyId, session, { user }) {
    const { isAdmin } = await actorRoles(turso, companyId, session);
    if (!isAdmin) return { success: false, error: 'Acceso denegado. Solo administradores pueden crear usuarios.' };
    if (!user?.username) return { success: false, error: 'Falta username' };

    const rutCheck = checkRut(user);
    if (!rutCheck.ok) return { success: false, error: rutCheck.error };

    // Unicidad POR SUCURSAL (no global): el mismo nombre puede existir en otra
    // empresa, pero no dos veces en ESTA. Mensaje claro antes que el error de BD.
    const dup = await turso.execute({
        sql: 'SELECT id FROM users WHERE company_id = ? AND username = ? LIMIT 1',
        args: [companyId, user.username],
    });
    if (dup.rows.length > 0) return { success: false, error: 'Ya existe un usuario con ese nombre en esta sucursal.' };

    const hashedPw = await hashPassword(String(user.password || '123456'));
    const result = await turso.execute({
        sql: `INSERT INTO users (
                name, username, password, role, company_id,
                rut, has_labor_profile, labor_position, labor_branch, labor_start_date, labor_status, labor_pin,
                labor_weekly_hours, labor_exempt_art22,
                pay_type, pay_method, pay_day, pay_base_amount, pay_fixed_bonus, pay_fixed_discount,
                pay_bank_name, pay_bank_account, pay_bank_account_type, pay_bank_owner
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${USER_COLS}`,
        args: [
            nn(user.name), user.username, hashedPw, nn(user.role), companyId,
            rutCheck.value,
            user.has_labor_profile ? 1 : 0, nn(user.labor_position), nn(user.labor_branch), nn(user.labor_start_date), nn(user.labor_status), nn(user.labor_pin),
            user.labor_weekly_hours == null ? 42 : Number(user.labor_weekly_hours), user.labor_exempt_art22 ? 1 : 0,
            nn(user.pay_type), nn(user.pay_method), nn(user.pay_day), nn(user.pay_base_amount), nn(user.pay_fixed_bonus), nn(user.pay_fixed_discount),
            nn(user.pay_bank_name), nn(user.pay_bank_account), nn(user.pay_bank_account_type), nn(user.pay_bank_owner),
        ],
    });
    const newUser = result.rows[0];
    await turso.execute({
        sql: 'INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)',
        args: [newUser.id, companyId, user.role],
    });
    await turso.execute({
        sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'CREATE', 'USER', ?, ?)",
        args: [companyId, session?.uid ?? null, JSON.stringify({ username: user.username }), new Date().toISOString()],
    });
    return { success: true, user: newUser };
}

async function userUpdate(turso, companyId, session, { id, user }) {
    const { isAdmin } = await actorRoles(turso, companyId, session);
    if (!isAdmin) return { success: false, error: 'Acceso denegado. Solo administradores pueden modificar usuarios.' };
    if (!id || !user) return { success: false, error: 'Faltan datos' };

    const rutCheck = checkRut(user);
    if (!rutCheck.ok) return { success: false, error: rutCheck.error };

    // Al renombrar: no chocar con otro usuario de ESTA sucursal.
    if (user.username) {
        const dup = await turso.execute({
            sql: 'SELECT id FROM users WHERE company_id = ? AND username = ? AND id != ? LIMIT 1',
            args: [companyId, user.username, id],
        });
        if (dup.rows.length > 0) return { success: false, error: 'Ya existe otro usuario con ese nombre en esta sucursal.' };
    }

    await turso.execute({
        sql: `UPDATE users SET name = ?, username = ?, role = ?, rut = ?,
                has_labor_profile = ?, labor_position = ?, labor_branch = ?, labor_start_date = ?, labor_status = ?, labor_pin = ?,
                labor_weekly_hours = ?, labor_exempt_art22 = ?,
                pay_type = ?, pay_method = ?, pay_day = ?, pay_base_amount = ?, pay_fixed_bonus = ?, pay_fixed_discount = ?,
                pay_bank_name = ?, pay_bank_account = ?, pay_bank_account_type = ?, pay_bank_owner = ?
              WHERE id = ? AND company_id = ?`,
        args: [
            nn(user.name), user.username, nn(user.role), rutCheck.value,
            user.has_labor_profile ? 1 : 0, nn(user.labor_position), nn(user.labor_branch), nn(user.labor_start_date), nn(user.labor_status), nn(user.labor_pin),
            user.labor_weekly_hours == null ? 42 : Number(user.labor_weekly_hours), user.labor_exempt_art22 ? 1 : 0,
            nn(user.pay_type), nn(user.pay_method), nn(user.pay_day), nn(user.pay_base_amount), nn(user.pay_fixed_bonus), nn(user.pay_fixed_discount),
            nn(user.pay_bank_name), nn(user.pay_bank_account), nn(user.pay_bank_account_type), nn(user.pay_bank_owner),
            id, companyId,
        ],
    });
    if (user.password) {
        const hashedPw = await hashPassword(String(user.password));
        await turso.execute({
            sql: 'UPDATE users SET password = ? WHERE id = ? AND company_id = ?',
            args: [hashedPw, id, companyId],
        });
    }
    // Sincronizar rol en user_companies (nunca degradar 'owner')
    await turso.execute({
        sql: "UPDATE user_companies SET role = ? WHERE user_id = ? AND company_id = ? AND role != 'owner'",
        args: [user.role, id, companyId],
    });
    return { success: true };
}

async function userDelete(turso, companyId, session, { id }) {
    const { isOwner } = await actorRoles(turso, companyId, session);
    if (!isOwner) return { success: false, error: 'Solo el dueño del sistema puede eliminar usuarios.' };
    if (!id) return { success: false, error: 'Falta id' };

    // El dueño no se puede eliminar, solo modificar
    const tgt = await turso.execute({
        sql: 'SELECT role FROM user_companies WHERE user_id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (tgt.rows[0]?.role === 'owner') return { success: false, error: 'El dueño del sistema no se puede eliminar, solo modificar.' };

    // Ocho tablas del módulo Personal apuntan a `users` con ON DELETE NO ACTION:
    // si el usuario tiene asistencia, ausencias, anticipos, nómina o vacaciones,
    // la base rechaza el DELETE y el error de SQLite llegaba crudo a la pantalla
    // ("FOREIGN KEY constraint failed"), sin decir qué lo bloquea ni qué hacer.
    //
    // Y está bien que lo bloquee: son registros laborales, no se borran porque
    // alguien deje de trabajar. Lo que corresponde es quitarle el acceso.
    const bloqueos = await contarRegistrosLaborales(turso, id);
    if (bloqueos.total > 0) {
        return {
            success: false,
            error: `No se puede eliminar: tiene ${bloqueos.detalle} en el módulo Personal. `
                + 'Son registros laborales y no se borran. Usá "Quitar acceso" para que no pueda '
                + 'volver a entrar, conservando su historial.',
            tieneRegistrosLaborales: true,
            registros: bloqueos.conteos,
        };
    }

    await turso.batch([
        { sql: 'DELETE FROM user_companies WHERE user_id = ? AND company_id = ?', args: [id, companyId] },
        { sql: 'DELETE FROM users WHERE id = ? AND company_id = ?', args: [id, companyId] },
    ]);
    return { success: true };
}

// Tablas del módulo Personal que impiden borrar un usuario, con el nombre que
// el usuario ve en pantalla.
const TABLAS_LABORALES = [
    ['attendance_records', 'marcas de asistencia'],
    ['attendance_corrections', 'correcciones de asistencia'],
    ['labor_absences', 'ausencias'],
    ['salary_advances', 'anticipos de sueldo'],
    ['payroll_periods', 'períodos de nómina'],
    ['payroll_payments', 'pagos de sueldo'],
    ['vacation_balances', 'saldos de vacaciones'],
    ['vacation_requests', 'solicitudes de vacaciones'],
];

async function contarRegistrosLaborales(turso, userId) {
    const res = await turso.batch(
        TABLAS_LABORALES.map(([tabla]) => ({
            sql: `SELECT COUNT(*) AS n FROM ${tabla} WHERE user_id = ?`,
            args: [userId],
        })),
        'read'
    );
    const conteos = {};
    const partes = [];
    let total = 0;
    res.forEach((r, i) => {
        const n = Number(r.rows[0]?.n) || 0;
        if (!n) return;
        const [tabla, etiqueta] = TABLAS_LABORALES[i];
        conteos[tabla] = n;
        partes.push(`${n} ${etiqueta}`);
        total += n;
    });
    return { total, conteos, detalle: partes.join(', ') };
}

// Quita el acceso de un usuario a la empresa sin borrar su historial laboral.
// Es lo que corresponde cuando alguien deja de trabajar: pierde el ingreso al
// sistema, pero sus marcas, ausencias y sueldos siguen existiendo.
async function userRevokeAccess(turso, companyId, session, { id }) {
    const { isOwner } = await actorRoles(turso, companyId, session);
    if (!isOwner) return { success: false, error: 'Solo el dueño del sistema puede quitar accesos.' };
    if (!id) return { success: false, error: 'Falta id' };

    const tgt = await turso.execute({
        sql: 'SELECT role FROM user_companies WHERE user_id = ? AND company_id = ?',
        args: [id, companyId],
    });
    if (!tgt.rows[0]) return { success: false, error: 'El usuario no pertenece a esta empresa.' };
    if (tgt.rows[0].role === 'owner') return { success: false, error: 'Al dueño del sistema no se le puede quitar el acceso.' };

    await turso.execute({
        sql: 'DELETE FROM user_companies WHERE user_id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

export const userActions = { userCreate, userUpdate, userDelete, userRevokeAccess };
