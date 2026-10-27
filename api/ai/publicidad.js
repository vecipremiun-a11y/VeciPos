// Publicidad con IA: fondos generados por IA + productos reales del inventario.
// La lógica vive en api/_lib/publicidadActions.js; acá van la sesión y los
// candados, en el orden de siempre: barato primero (ritmo), después la base.
//
// Va aparte de /api/data/actions porque generar una imagen tarda (10 a 20 s
// medidos el 23-oct-2026). La función tiene el tope de todas (60 s, vercel.json):
// la IA se corta a los 50 s para contestar a tiempo, y un fondo que no llegó no
// cuenta para el cupo.
import { createClient } from '@libsql/client';
import OpenAI from 'openai';
import { getSession, isCompanyMember } from '../_lib/guard.js';
import {
    generarFondo, guardarDiseno, listarDisenos, obtenerDiseno, duplicarDiseno, eliminarDiseno,
    imagenDeLaEmpresa, estadoPublicidad, puedeUsarPublicidad, tieneAppPublicidad, cupoPublicidad,
    ritmoPublicidadExcedido, ofertasParaPublicidad, CUPO_IMAGENES_MES,
} from '../_lib/publicidadActions.js';

let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Faltan variables Turso');
    _turso = createClient({ url, authToken });
    return _turso;
}

let _openai = null;
function getOpenAI() {
    if (_openai) return _openai;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY');
    // Un fondo tarda 10-20 s. Se corta a los 50 s, antes del tope de 60 s de la
    // función, para poder avisar; sin reintentos automáticos (cada uno cobra).
    _openai = new OpenAI({ apiKey, timeout: 50_000, maxRetries: 0 });
    return _openai;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const session = getSession(req);
    if (!session) return res.status(401).json({ success: false, error: 'No autenticado' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { action, companyId } = body;
        if (!companyId) return res.status(400).json({ success: false, error: 'Falta companyId' });
        const turso = getTurso();
        if (!(await isCompanyMember(turso, session.uid, companyId))) {
            return res.status(403).json({ success: false, error: 'Sin acceso a esta empresa' });
        }

        if (action === 'estado') return res.status(200).json(await estadoPublicidad(turso, companyId, session));

        if (!(await puedeUsarPublicidad(turso, session.uid, companyId))) {
            return res.status(403).json({ success: false, error: 'SIN_ROL', message: 'No tenés habilitada la Publicidad. El dueño puede activarla desde Roles.' });
        }
        // Solo lee productos: sirve igual que el buscador, con o sin la App (el
        // fondo de color y la descarga no la necesitan).
        if (action === 'ofertas') return res.status(200).json(await ofertasParaPublicidad(turso, companyId));
        if (!(await tieneAppPublicidad(turso, companyId))) {
            return res.status(403).json({ success: false, error: 'SIN_APP', message: 'Publicidad IA es una App del Marketplace. Activala para usarla.' });
        }

        switch (action) {
            case 'generarFondo': {
                // Lo único que gasta: ritmo y cupo antes de llamar a la IA.
                if (await ritmoPublicidadExcedido(turso, companyId)) {
                    return res.status(429).json({ success: false, error: 'RITMO', message: 'Muchos fondos seguidos. Esperá un minuto.' });
                }
                const cupo = await cupoPublicidad(turso, companyId);
                if (cupo.agotado) {
                    return res.status(200).json({ success: false, error: 'CUPO', message: `Llegaste a las ${CUPO_IMAGENES_MES} imágenes del mes. Se renueva el 1°.` });
                }
                return res.status(200).json(await generarFondo(turso, getOpenAI(), companyId, session, body));
            }
            case 'guardar': return res.status(200).json(await guardarDiseno(turso, companyId, session, body));
            case 'listar': return res.status(200).json(await listarDisenos(turso, companyId, body));
            case 'obtener': return res.status(200).json(await obtenerDiseno(turso, companyId, body));
            case 'duplicar': return res.status(200).json(await duplicarDiseno(turso, companyId, session, body));
            case 'eliminar': return res.status(200).json(await eliminarDiseno(turso, companyId, body));
            case 'imagen': return res.status(200).json(await imagenDeLaEmpresa(turso, companyId, body));
            default: return res.status(400).json({ success: false, error: 'Acción no válida' });
        }
    } catch (e) {
        // Código desplegado antes que la migración 0036: que la pantalla lo diga.
        if (/no such table: ad_/i.test(String(e?.message))) {
            return res.status(503).json({ success: false, error: 'SIN_TABLAS', message: 'Falta aplicar la migración de Publicidad (0036) en esta base.' });
        }
        // Sin el detalle: puede traer datos de la configuración.
        console.error('❌ /api/ai/publicidad:', e?.message);
        return res.status(500).json({ success: false, error: 'Error interno' });
    }
}
