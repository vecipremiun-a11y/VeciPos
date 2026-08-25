// Cimiento de autenticación server-side (Fase 1).
// - Hash de contraseñas con bcrypt (reemplaza el texto plano).
// - Sesión firmada (JWT) para cookies httpOnly.
// Se usa desde los endpoints api/* (nunca desde el navegador con el token de BD).

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Lazy: las env se leen en tiempo de request. Los import ESM se hoistean antes
// de dotenv.config() en server.js, así que leerlo a nivel de módulo daría ''.
const getSecret = () => process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
const SESSION_DAYS = 7;

// ¿El valor guardado ya es un hash bcrypt? ($2a$/$2b$/$2y$)
export function isHashed(value) {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

export async function hashPassword(plain) {
    return bcrypt.hash(String(plain ?? ''), 10);
}

// Verifica la contraseña. Soporta legacy en texto plano (para migración al vuelo).
export async function verifyPassword(plain, stored) {
    if (stored === undefined || stored === null || stored === '') return false;
    if (isHashed(stored)) return bcrypt.compare(String(plain ?? ''), stored);
    return String(plain ?? '') === String(stored); // legacy texto plano
}

// Firma una sesión (JWT). Devuelve null si no hay JWT_SECRET configurado.
export function signSession(payload) {
    const secret = getSecret();
    if (!secret) return null;
    return jwt.sign(payload, secret, { expiresIn: `${SESSION_DAYS}d` });
}

export function verifySession(token) {
    const secret = getSecret();
    if (!secret || !token) return null;
    try { return jwt.verify(token, secret); } catch { return null; }
}

// Construye el header Set-Cookie de la sesión (httpOnly, SameSite=Lax, Secure en prod).
export function sessionCookie(token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const maxAge = SESSION_DAYS * 24 * 60 * 60;
    return `pv_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Lee la sesión desde la cookie pv_session del request (devuelve el payload o null).
export function getSession(req) {
    const cookie = req.headers?.cookie || '';
    const m = cookie.match(/(?:^|;\s*)pv_session=([^;]+)/);
    if (!m) return null;
    return verifySession(decodeURIComponent(m[1]));
}

// Cada cuántas horas se vuelve a firmar la sesión de quien está trabajando.
// Un día: suficiente para que un turno normal nunca gaste un Set-Cookie de más,
// y suficiente para que la sesión no se venza mientras se usa el sistema.
const RENOVAR_TRAS_HORAS = 24;

/**
 * Sesión deslizante: mientras se trabaje, la sesión se renueva sola.
 *
 * El token dura 7 días FIJOS desde el login. Sin esto, a una cajera que entra el
 * lunes se le vence el lunes siguiente en medio del turno, con el cliente
 * esperando — y hasta ahora el POS respondía a eso con un 401 mudo y pantallas
 * vacías. Ahora cada llamada al servidor empuja el vencimiento hacia adelante,
 * así que solo caduca de verdad tras 7 días SIN usar el sistema.
 *
 * Devuelve true si renovó (útil para pruebas).
 */
export function renovarSesionSiHaceFalta(session, res) {
    if (!session?.iat) return false;
    const horas = (Date.now() / 1000 - session.iat) / 3600;
    if (horas < RENOVAR_TRAS_HORAS) return false;

    const token = signSession({ uid: session.uid, username: session.username, role: session.role });
    if (!token) return false;

    // Se suma al Set-Cookie que ya hubiera, en vez de pisarlo: si algún día este
    // endpoint escribe otra cookie, borrarla acá sería un bug silencioso.
    const previo = res.getHeader?.('Set-Cookie');
    res.setHeader('Set-Cookie', previo ? [].concat(previo, sessionCookie(token)) : sessionCookie(token));
    return true;
}
