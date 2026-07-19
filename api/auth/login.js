import { createClient } from '@libsql/client';
import { verifyPassword, isHashed, hashPassword, signSession, sessionCookie } from '../_lib/auth.js';

let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Faltan variables Turso');
    _turso = createClient({ url, authToken });
    return _turso;
}

// Rate limiting best-effort (memoria por instancia serverless): N intentos
// fallidos por IP+usuario en la ventana → 429. No reemplaza un WAF, pero
// frena fuerza bruta simple contra el login.
const ATTEMPTS = new Map(); // key → { count, resetAt }
const RL_WINDOW_MS = 10 * 60_000;
const RL_MAX_FAILS = 8;

function rateKey(req, username) {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || '?';
    return `${ip}|${username.toLowerCase()}`;
}
function tooManyAttempts(key) {
    const e = ATTEMPTS.get(key);
    return !!e && Date.now() <= e.resetAt && e.count >= RL_MAX_FAILS;
}
function registerFail(key) {
    const now = Date.now();
    const e = ATTEMPTS.get(key);
    if (!e || now > e.resetAt) {
        if (ATTEMPTS.size > 5000) ATTEMPTS.clear(); // tope de memoria
        ATTEMPTS.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    } else {
        e.count += 1;
    }
}

// Autenticación server-side: verifica credenciales con bcrypt (soporta legacy en
// texto plano y lo re-hashea al vuelo) y emite una cookie de sesión firmada.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Faltan credenciales' });
        }

        const rlKey = rateKey(req, username);
        if (tooManyAttempts(rlKey)) {
            return res.status(429).json({ success: false, error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' });
        }

        const turso = getTurso();
        const r = await turso.execute({
            sql: 'SELECT * FROM users WHERE username = ? LIMIT 1',
            args: [username],
        });
        const user = r.rows[0];

        // Respuesta genérica (no revela si el usuario existe)
        if (!user || !(await verifyPassword(password, user.password))) {
            registerFail(rlKey);
            return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
        }
        ATTEMPTS.delete(rlKey);

        // Migración al vuelo: si estaba en texto plano, guardarla hasheada.
        if (!isHashed(user.password)) {
            try {
                const hash = await hashPassword(password);
                await turso.execute({ sql: 'UPDATE users SET password = ? WHERE id = ?', args: [hash, user.id] });
            } catch (e) {
                console.warn('No se pudo re-hashear la contraseña:', e.message);
            }
        }

        // Cookie de sesión (si hay JWT_SECRET configurado)
        const token = signSession({ uid: user.id, username: user.username, role: user.role });
        if (token) res.setHeader('Set-Cookie', sessionCookie(token));

        // Nunca devolver el hash de la contraseña
        const { password: _pw, ...safeUser } = user;

        // 2) Empresas del usuario (server-side). Antes lo hacía el navegador con el token.
        const companiesRes = await turso.execute({
            sql: `SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, uc.role,
                         c.status, c.trial_ends_at, c.subscription_id, c.access_until
                  FROM user_companies uc
                  JOIN companies c ON uc.company_id = c.id
                  WHERE uc.user_id = ? AND c.status IN ('active', 'trial', 'past_due', 'blocked')
                  ORDER BY c.id`,
            args: [user.id],
        });
        const companies = companiesRes.rows;
        if (companies.length === 0) {
            return res.status(200).json({ success: false, error: 'Este usuario no tiene empresas asignadas. Contacte al administrador.' });
        }

        // 3) Resolver empresa activa: home (users.company_id) → preferida (cliente) → primera.
        const preferredCompanyId = body.preferredCompanyId ? String(body.preferredCompanyId) : null;
        let activeCompanyId;
        if (user.company_id && companies.some(c => c.id === user.company_id)) {
            activeCompanyId = user.company_id;
        } else if (preferredCompanyId && companies.some(c => c.id === preferredCompanyId)) {
            activeCompanyId = preferredCompanyId;
        } else {
            activeCompanyId = companies[0].id;
        }
        const activeCompany = companies.find(c => c.id === activeCompanyId);

        // Sync user_companies.role si difiere de users.role (arregla desync de un bug viejo).
        // 'owner' en user_companies = dueñidad de la cuenta, jamás se pisa con users.role.
        if (activeCompany.role !== user.role && user.role !== 'super_admin' && user.role !== 'owner' && activeCompany.role !== 'owner') {
            await turso.execute({
                sql: 'UPDATE user_companies SET role = ? WHERE user_id = ? AND company_id = ?',
                args: [user.role, user.id, activeCompanyId],
            });
            activeCompany.role = user.role;
        }

        // 4) Ciclo de vida de suscripción (basado en access_until). Server-side para que
        //    NO se pueda evadir el bloqueo no ejecutando el código en el navegador.
        if (user.role !== 'super_admin') {
            const now = new Date();
            if (['suspended', 'cancelled'].includes(activeCompany.status)) {
                return res.status(200).json({ success: false, error: `La cuenta de la empresa está ${activeCompany.status === 'suspended' ? 'suspendida' : 'cancelada'}. Contacte a soporte.` });
            }
            const accessUntil = activeCompany.access_until ? new Date(activeCompany.access_until) : null;
            if (accessUntil && now > accessUntil) {
                if (activeCompany.status === 'trial') {
                    await turso.execute({ sql: "UPDATE companies SET status = 'blocked' WHERE id = ?", args: [activeCompanyId] });
                    return res.status(200).json({ success: false, needsRenewal: true, error: 'Tu período de prueba ha finalizado. Contrata un plan para continuar.' });
                }
                const graceEnd = new Date(accessUntil);
                graceEnd.setDate(graceEnd.getDate() + 3);
                if (now > graceEnd) {
                    await turso.execute({ sql: "UPDATE companies SET status = 'blocked' WHERE id = ?", args: [activeCompanyId] });
                    return res.status(200).json({ success: false, needsRenewal: true, error: 'Tu suscripción venció. Regulariza tu pago para reactivar tu cuenta.' });
                } else if (activeCompany.status !== 'past_due') {
                    await turso.execute({ sql: "UPDATE companies SET status = 'past_due' WHERE id = ?", args: [activeCompanyId] });
                    activeCompany.status = 'past_due';
                }
            } else if (activeCompany.status === 'blocked' && accessUntil && now <= accessUntil) {
                await turso.execute({ sql: "UPDATE companies SET status = 'active' WHERE id = ?", args: [activeCompanyId] });
                activeCompany.status = 'active';
            }
        }

        return res.status(200).json({ success: true, user: safeUser, companies, activeCompanyId });
    } catch (e) {
        console.error('❌ /api/auth/login error:', e);
        return res.status(500).json({ success: false, error: 'Error de servidor' });
    }
}
