// Guards de autorización para los endpoints del app normal (Fase 1 · Paso 4).
// La sesión (cookie firmada) da el usuario; la MEMBRESÍA valida que ese usuario
// pertenece a la empresa sobre la que actúa (aislamiento multi-empresa, server-side).

import { getSession } from './auth.js';

export { getSession };

// ¿El usuario (userId) es miembro de la empresa (companyId)?  (tabla user_companies)
export async function isCompanyMember(turso, userId, companyId) {
    if (!userId || !companyId) return false;
    const r = await turso.execute({
        sql: 'SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ? LIMIT 1',
        args: [userId, companyId],
    });
    return r.rows.length > 0;
}

// Guard para endpoints que reciben la empresa por header 'x-company-id' (SII, etc.).
// Exige sesión firmada + membresía. Devuelve el companyId validado, o null
// (en cuyo caso YA respondió 401/400/403 — el handler debe hacer `return`).
// El super_admin pasa sin membresía (gestiona todas las empresas).
export async function requireCompanySession(turso, req, res) {
    const session = getSession(req);
    if (!session) {
        res.status(401).json({ error: 'No autenticado' });
        return null;
    }
    const companyId = req.headers['x-company-id'];
    if (!companyId) {
        res.status(400).json({ error: 'x-company-id header requerido' });
        return null;
    }
    if (session.role === 'super_admin') return companyId;
    if (!(await isCompanyMember(turso, session.uid, companyId))) {
        res.status(403).json({ error: 'No perteneces a esta empresa' });
        return null;
    }
    return companyId;
}
