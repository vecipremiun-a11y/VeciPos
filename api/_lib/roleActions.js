// Roles y permisos server-side (Fase 1 · Paso 27). Reutiliza las plantillas
// de permissions.js. company_id forzado en toda query. Roles de sistema
// protegidos (no se borran).

import { DEFAULT_PERMS, ALL_PERMS } from './permissions.js';

const SYSTEM_ROLES = [
    { role_name: 'Caja', is_system: 1, color: '#10b981', description: 'Caja registradora - cobros y pagos' },
    { role_name: 'Vendedor', is_system: 1, color: '#8b5cf6', description: 'Vendedor - crea preventas' },
    { role_name: 'Bodeguero', is_system: 1, color: '#f59e0b', description: 'Gestión de inventario' },
    { role_name: 'Supervisor', is_system: 1, color: '#3b82f6', description: 'Acceso a reportes y supervisión' },
    { role_name: 'Repartidor', is_system: 1, color: '#06b6d4', description: 'Solo entregas: ve sus pedidos, sin acceso al POS ni a caja' },
];

/**
 * Siembra los permisos por defecto de UN rol si todavía no los tiene. Necesario
 * para roles agregados después: permissionsSeedDefaults() sale temprano cuando la
 * empresa ya tiene permisos, así que un rol nuevo se quedaría sin ninguno.
 * Idempotente.
 */
async function ensureRoleSeeded(turso, companyId, role) {
    const has = await turso.execute({
        sql: 'SELECT COUNT(*) AS c FROM role_permissions WHERE company_id = ? AND role = ?',
        args: [companyId, role],
    });
    if (Number(has.rows[0]?.c) > 0) return;
    const allowed = DEFAULT_PERMS[role] || [];
    const queries = ALL_PERMS.map(p => ({
        sql: 'INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
        args: [companyId, role, p, allowed.includes(p) ? 1 : 0],
    }));
    for (let i = 0; i < queries.length; i += 50) await turso.batch(queries.slice(i, i + 50));
}

async function rolePermissionsList(turso, companyId) {
    const res = await turso.execute({
        sql: 'SELECT * FROM role_permissions WHERE company_id = ?',
        args: [companyId],
    });
    return { success: true, rows: res.rows };
}

async function companyRolesList(turso, companyId) {
    await turso.execute(`CREATE TABLE IF NOT EXISTS custom_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, role_name TEXT NOT NULL,
        description TEXT, color TEXT DEFAULT '#6366f1', is_system INTEGER DEFAULT 0, created_at TEXT,
        UNIQUE(company_id, role_name))`).catch(() => {});
    const res = await turso.execute({
        sql: 'SELECT * FROM custom_roles WHERE company_id = ?',
        args: [companyId],
    });
    // Roles agregados después del alta de la empresa (p. ej. Repartidor) pueden
    // no tener permisos sembrados: se aseguran aquí.
    await ensureRoleSeeded(turso, companyId, 'Repartidor').catch(() => { /* no bloquea el listado */ });

    const merged = [...res.rows];
    for (const sys of SYSTEM_ROLES) {
        if (!merged.find(r => r.role_name === sys.role_name)) merged.push(sys);
    }
    return { success: true, roles: merged };
}

async function rolePermissionUpdate(turso, companyId, session, { role, permission, granted }) {
    // Deduplicar + índice único (self-healing) y re-insertar el valor
    await turso.execute({
        sql: 'DELETE FROM role_permissions WHERE company_id = ? AND role = ? AND permission = ?',
        args: [companyId, role, permission],
    });
    try {
        await turso.execute(`DELETE FROM role_permissions WHERE rowid NOT IN (
            SELECT MAX(rowid) FROM role_permissions GROUP BY company_id, role, permission)`);
        await turso.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique ON role_permissions(company_id, role, permission)');
    } catch { /* índice/dedup best-effort */ }
    await turso.execute({
        sql: 'INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
        args: [companyId, role, permission, granted ? 1 : 0],
    });
    return { success: true };
}

async function customRoleCreate(turso, companyId, session, { roleName, description, color, copyFromRole }) {
    if (!roleName) return { success: false, error: 'Falta nombre de rol' };
    // Bloquear pisar un rol de sistema
    if (SYSTEM_ROLES.some(r => r.role_name === roleName)) {
        return { success: false, error: 'No se puede crear un rol con nombre reservado' };
    }
    await turso.execute({
        sql: 'INSERT INTO custom_roles (company_id, role_name, description, color, is_system, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        args: [companyId, roleName, description ?? null, color ?? '#6366f1', new Date().toISOString()],
    });
    if (copyFromRole) {
        await turso.execute({
            sql: `INSERT INTO role_permissions (company_id, role, permission, granted)
                  SELECT company_id, ?, permission, granted FROM role_permissions WHERE company_id = ? AND role = ?`,
            args: [roleName, companyId, copyFromRole],
        });
    }
    return { success: true };
}

async function customRoleDelete(turso, companyId, session, { roleName }) {
    if (SYSTEM_ROLES.some(r => r.role_name === roleName)) {
        return { success: false, error: 'No se puede eliminar un rol de sistema' };
    }
    await turso.batch([
        { sql: "UPDATE user_companies SET role = 'Caja' WHERE company_id = ? AND role = ?", args: [companyId, roleName] },
        { sql: 'DELETE FROM role_permissions WHERE company_id = ? AND role = ?', args: [companyId, roleName] },
        { sql: 'DELETE FROM custom_roles WHERE company_id = ? AND role_name = ? AND is_system = 0', args: [companyId, roleName] },
    ]);
    return { success: true };
}

async function customRoleRename(turso, companyId, session, { oldName, newName }) {
    if (!newName) return { success: false, error: 'Falta nuevo nombre' };
    if (SYSTEM_ROLES.some(r => r.role_name === oldName)) {
        return { success: false, error: 'No se puede renombrar un rol de sistema' };
    }
    await turso.batch([
        { sql: 'UPDATE custom_roles SET role_name = ? WHERE company_id = ? AND role_name = ?', args: [newName, companyId, oldName] },
        { sql: 'UPDATE role_permissions SET role = ? WHERE company_id = ? AND role = ?', args: [newName, companyId, oldName] },
        { sql: 'UPDATE user_companies SET role = ? WHERE company_id = ? AND role = ?', args: [newName, companyId, oldName] },
    ]);
    return { success: true };
}

async function roleResetDefaults(turso, companyId, session, { role }) {
    const allowed = DEFAULT_PERMS[role];
    if (!allowed) return { success: false, error: 'Role not found in defaults' };
    await turso.execute({
        sql: 'DELETE FROM role_permissions WHERE company_id = ? AND role = ?',
        args: [companyId, role],
    });
    const queries = allowed.map(p => ({
        sql: 'INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, 1)',
        args: [companyId, role, p],
    }));
    for (let i = 0; i < queries.length; i += 50) await turso.batch(queries.slice(i, i + 50));
    return { success: true };
}

async function permissionsSeedDefaults(turso, companyId) {
    const check = await turso.execute({
        sql: 'SELECT COUNT(*) as count FROM role_permissions WHERE company_id = ?',
        args: [companyId],
    });
    if (Number(check.rows[0].count) > 0) return { success: true, skipped: true };

    const queries = [];
    for (const role of ['Caja', 'Vendedor', 'Bodeguero', 'Supervisor', 'Repartidor']) {
        const allowed = DEFAULT_PERMS[role] || [];
        for (const p of ALL_PERMS) {
            queries.push({
                sql: 'INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
                args: [companyId, role, p, allowed.includes(p) ? 1 : 0],
            });
        }
    }
    for (const p of ALL_PERMS) {
        queries.push({
            sql: 'INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, 1)',
            args: [companyId, 'Administrador', p],
        });
    }
    for (let i = 0; i < queries.length; i += 50) await turso.batch(queries.slice(i, i + 50));
    return { success: true };
}

export const roleActions = {
    rolePermissionsList, companyRolesList, rolePermissionUpdate,
    customRoleCreate, customRoleDelete, customRoleRename,
    roleResetDefaults, permissionsSeedDefaults,
};
