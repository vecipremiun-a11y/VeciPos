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
