// Usuarios de una empresa server-side (Fase 1 · Paso 31). Las validaciones de
// ROL ahora se enforcan en el servidor (antes solo en el cliente): crear/editar
// exige Administrador/owner/super_admin; eliminar exige owner/super_admin.
// La contraseña se hashea con bcrypt EN EL SERVIDOR (el navegador ya no la ve).

import { hashPassword } from './auth.js';
import { rutIsValid, normalizeRut } from './rut.js';

const nowIso = () => new Date().toISOString();

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

    // Sin membresía = ya no tiene acceso. Eso NO es un error.
    //
    // Antes devolvía "El usuario no pertenece a esta empresa", que además de
    // inútil sonaba a que el problema era de quien apretaba el botón. Y era
    // justo lo que pasaba con quienes ya se les había quitado el acceso antes:
    // el dueño intentaba asegurarse de que no pudieran entrar, y el sistema le
    // contestaba con un error en vez de confirmarle que ya estaban afuera.
    if (!tgt.rows[0]) {
        return { success: true, yaEstaba: true, mensaje: 'Este usuario ya no tenía acceso al sistema.' };
    }
    if (tgt.rows[0].role === 'owner') return { success: false, error: 'Al dueño del sistema no se le puede quitar el acceso.' };

    // Se borra SOLO la membresía. El usuario, sus ventas, sus cierres de caja,
    // su asistencia y sus pagos quedan intactos: es sacarle la llave, no
    // borrarle la historia.
    //
    // Con esto no entra desde ningún lado: el login exige una fila acá (ver
    // api/auth/login.js, "Este usuario no tiene empresas asignadas") y las
    // llamadas de una sesión ya abierta las corta el guard de la API.
    await turso.execute({
        sql: 'DELETE FROM user_companies WHERE user_id = ? AND company_id = ?',
        args: [id, companyId],
    });
    return { success: true };
}

/**
 * Da de baja a alguien que dejó de trabajar.
 *
 * Es lo que hay que usar cuando una persona se va: le quita el acceso, registra
 * cuándo terminó y por qué, y la saca de la lista de Usuarios. Su ficha se
 * queda en la base —es de donde el historial saca el nombre del vendedor en
 * ventas, cajas y asistencia— pero deja de ser un usuario: pasa a ser un legajo,
 * que se consulta en "Ex personal".
 *
 * Lo que NO hay que hacer nunca: renombrar el usuario de quien se fue para
 * reusarlo con la persona nueva. Pasó con "Katy" → "Chelo": las mismas 115
 * ventas del 1-ago-2026 figuran hoy con un nombre en el reporte por vendedor y
 * con otro en el historial, y las marcas de asistencia de una quedaron a nombre
 * de la otra —que es un registro del Art. 33—.
 */
async function userTerminate(turso, companyId, session, { id, endDate, reason }) {
    const { isOwner } = await actorRoles(turso, companyId, session);
    if (!isOwner) return { success: false, error: 'Solo el dueño del sistema puede dar de baja a alguien.' };
    if (!id) return { success: false, error: 'Falta id' };
    if (Number(id) === Number(session?.uid)) return { success: false, error: 'No podés darte de baja a vos mismo.' };

    const u = await turso.execute({
        sql: 'SELECT u.id, u.name, uc.role AS company_role FROM users u LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ? WHERE u.id = ? AND u.company_id = ?',
        args: [companyId, id, companyId],
    });
    const usuario = u.rows[0];
    if (!usuario) return { success: false, error: 'Ese usuario no existe en esta empresa.' };
    if (usuario.company_role === 'owner') return { success: false, error: 'Al dueño del sistema no se le puede dar de baja.' };

    // La fecha de salida la pone quien da de baja; si no viene, es hoy. Se
    // valida: una salida en el futuro o en 1970 ensucia el legajo y los
    // reportes de personal.
    const hoy = nowIso();
    let salida = typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(endDate) ? endDate.slice(0, 10) : hoy.slice(0, 10);
    if (salida > hoy.slice(0, 10)) salida = hoy.slice(0, 10);

    await turso.batch([
        // 1. Se le quita el acceso: no entra desde ningún equipo.
        { sql: 'DELETE FROM user_companies WHERE user_id = ? AND company_id = ?', args: [id, companyId] },
        // 2. Queda el legajo: cuándo terminó, por qué, quién lo registró.
        {
            sql: `UPDATE users SET labor_status = 'terminated', labor_end_date = ?, labor_end_reason = ?,
                    labor_end_by = ?, labor_end_at = ? WHERE id = ? AND company_id = ?`,
            args: [salida, String(reason || '').trim().slice(0, 300) || null, session?.uid ?? null, hoy, id, companyId],
        },
        {
            sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [companyId, session?.uid ?? null, 'TERMINATE', 'USER',
                JSON.stringify({ id, nombre: usuario.name, salida, motivo: reason || null }), hoy],
        },
    ]);

    return { success: true, nombre: usuario.name, salida };
}

/** Vuelve a dar de alta a alguien: le devuelve el acceso y limpia la baja. */
async function userReinstate(turso, companyId, session, { id, role }) {
    const { isOwner } = await actorRoles(turso, companyId, session);
    if (!isOwner) return { success: false, error: 'Solo el dueño del sistema puede reincorporar a alguien.' };
    if (!id) return { success: false, error: 'Falta id' };

    const u = await turso.execute({
        sql: 'SELECT id, name, role FROM users WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    const usuario = u.rows[0];
    if (!usuario) return { success: false, error: 'Ese usuario no existe en esta empresa.' };

    const rol = String(role || usuario.role || 'Caja');
    await turso.batch([
        // El rol vuelve a existir; `INSERT OR REPLACE` para que reincorporar dos
        // veces no reviente por la clave repetida.
        { sql: 'INSERT OR REPLACE INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)', args: [id, companyId, rol] },
        {
            sql: `UPDATE users SET labor_status = 'active', labor_end_date = NULL, labor_end_reason = NULL,
                    labor_end_by = NULL, labor_end_at = NULL WHERE id = ? AND company_id = ?`,
            args: [id, companyId],
        },
        {
            sql: 'INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [companyId, session?.uid ?? null, 'REINSTATE', 'USER',
                JSON.stringify({ id, nombre: usuario.name, rol }), nowIso()],
        },
    ]);
    return { success: true, nombre: usuario.name };
}

/**
 * El ex personal, con lo que dejó cada uno.
 *
 * Las fechas trabajadas no hacen falta pedirlas: salen de sus movimientos. Se
 * usa la más temprana entre el alta laboral, su primera venta y su primera
 * caja; y la más tardía entre su última venta y su última caja. Así el legajo
 * queda completo aunque a la ficha nunca se le haya cargado la fecha de inicio.
 */
async function personalDadoDeBaja(turso, companyId) {
    const r = await turso.execute({
        sql: `SELECT u.id, u.name, u.username, u.role, u.rut,
                     u.labor_start_date, u.labor_end_date, u.labor_end_reason, u.labor_end_at,
                     b.name AS dado_de_baja_por,
                     (SELECT COUNT(*) FROM sales s WHERE s.user_id = u.id AND s.company_id = u.company_id) AS ventas,
                     (SELECT MIN(s.date) FROM sales s WHERE s.user_id = u.id AND s.company_id = u.company_id) AS primera_venta,
                     (SELECT MAX(s.date) FROM sales s WHERE s.user_id = u.id AND s.company_id = u.company_id) AS ultima_venta,
                     (SELECT COUNT(*) FROM cash_registers c WHERE c.user_id = u.id AND c.company_id = u.company_id) AS cajas,
                     (SELECT MIN(c.opening_time) FROM cash_registers c WHERE c.user_id = u.id AND c.company_id = u.company_id) AS primera_caja,
                     (SELECT MAX(c.opening_time) FROM cash_registers c WHERE c.user_id = u.id AND c.company_id = u.company_id) AS ultima_caja,
                     (SELECT COUNT(*) FROM attendance_records a WHERE a.user_id = u.id AND a.company_id = u.company_id) AS marcas
              FROM users u
              LEFT JOIN users b ON b.id = u.labor_end_by
              LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
              WHERE u.company_id = ? AND uc.user_id IS NULL
              ORDER BY COALESCE(u.labor_end_date, '9999') DESC, u.name`,
        args: [companyId, companyId],
    });

    const menor = (...v) => v.filter(Boolean).sort()[0] || null;
    const mayor = (...v) => v.filter(Boolean).sort().pop() || null;

    return {
        success: true,
        personal: r.rows.map(u => ({
            ...u,
            desde: menor(u.labor_start_date, u.primera_venta, u.primera_caja),
            hasta: u.labor_end_date || mayor(u.ultima_venta, u.ultima_caja),
        })),
    };
}

export const userActions = {
    userCreate, userUpdate, userDelete, userRevokeAccess,
    userTerminate, userReinstate, personalDadoDeBaja,
};
