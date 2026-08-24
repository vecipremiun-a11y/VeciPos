// Latido de conectividad: ¿se puede TRABAJAR ahora mismo?
//
// `navigator.onLine` solo dice si el equipo está conectado a una red. Con el
// WiFi del local encendido y el internet caído responde "sí", así que el POS
// creía estar online y las ventas se quedaban esperando en vez de pasar a modo
// offline. Este endpoint es lo que el navegador consulta cada pocos segundos
// para saberlo de verdad.
//
// El 23-ago-2026 apareció un caso peor que el del WiFi: había internet, el
// servidor respondía, pero Turso tardaba entre 9 y 24 segundos en contestar un
// `SELECT 1`. Como este latido no tocaba la base, el POS se creía online y se
// colgaba en cada operación: las cajeras no podían vender NI entrar en modo
// offline, porque para el sistema no había ninguna caída. Peor: al no cargar los
// permisos, les aparecía "Acceso Denegado".
//
// Por eso ahora, con `?db=1`, el latido comprueba también la base — con un corte
// corto, porque lo que importa no es si la base existe sino si contesta a tiempo
// para atender a un cliente parado en la caja.
//
// Sigue sin validar sesión y sin leer ninguna tabla: `SELECT 1` no lee filas, así
// que no consume la cuota de lecturas del plan.

import { createClient } from '@libsql/client';

// Más que esto, en una caja, es lo mismo que no tener base.
const CORTE_MS = 3000;

let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) return null;
    _turso = createClient({ url, authToken });
    return _turso;
}

// La consulta puede quedar colgada; la promesa que devolvemos, no. Un latido que
// no termina es exactamente el problema que vinimos a resolver.
function conCorte(promesa, ms) {
    return Promise.race([
        promesa.then(() => true).catch(() => false),
        new Promise((resolver) => setTimeout(() => resolver(false), ms)),
    ]);
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    // Sin ?db=1 se comporta como antes: "el servidor está vivo", barato y al toque.
    if (!req.query?.db) {
        return res.status(200).json({ ok: true, t: Date.now() });
    }

    const turso = getTurso();
    if (!turso) {
        return res.status(200).json({ ok: true, db: false, motivo: 'sin configuración', t: Date.now() });
    }

    const t0 = Date.now();
    const viva = await conCorte(turso.execute('SELECT 1'), CORTE_MS);
    return res.status(200).json({ ok: true, db: viva, ms: Date.now() - t0, t: Date.now() });
}
