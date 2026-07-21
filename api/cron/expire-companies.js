import { createClient } from '@libsql/client';
import { appExpireDue } from '../_lib/appActions.js';

// Turso lazy (las env se leen en tiempo de request).
let _turso = null;
function getTurso() {
    if (_turso) return _turso;
    const url = process.env.VITE_TURSO_DATABASE_URL;
    const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
        throw new Error('Faltan variables Turso: VITE_TURSO_DATABASE_URL o VITE_TURSO_AUTH_TOKEN');
    }
    _turso = createClient({ url, authToken });
    return _turso;
}

const GRACE_DAYS = 3; // gracia para planes pagados (debe coincidir con src/lib/companyAccess.js)

// Cron diario (Vercel): actualiza el ciclo de vida según access_until.
//   - Prueba vencida → 'blocked' (Bloqueada, sin gracia)
//   - Plan pagado pasada la gracia → 'blocked' (Bloqueada)
//   - Plan pagado recién vencido (dentro de la gracia) → 'past_due' (Vencida, aún con acceso)
// Respeta overrides manuales (suspended/cancelled) y los ya 'blocked'.
export default async function handler(req, res) {
    // Seguridad: si hay CRON_SECRET configurado, exigirlo (Vercel lo envía como Bearer).
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const auth = req.headers['authorization'] || '';
        if (auth !== `Bearer ${secret}`) {
            return res.status(401).json({ ok: false, error: 'unauthorized' });
        }
    } else {
        console.warn('⚠️ CRON_SECRET no configurado — endpoint del cron abierto. Configúralo en Vercel para protegerlo.');
    }

    try {
        const turso = getTurso();
        const now = new Date();
        const nowIso = now.toISOString();
        const graceCutoff = new Date(now);
        graceCutoff.setDate(graceCutoff.getDate() - GRACE_DAYS);
        const graceCutoffIso = graceCutoff.toISOString();

        // 1) Prueba vencida (sin gracia) → Bloqueada
        const trials = await turso.execute({
            sql: `UPDATE companies SET status = 'blocked'
                  WHERE status = 'trial' AND access_until IS NOT NULL AND access_until < ?`,
            args: [nowIso],
        });

        // 2) Plan pagado pasada la gracia (access_until < ahora - 3 días) → Bloqueada
        const blocked = await turso.execute({
            sql: `UPDATE companies SET status = 'blocked'
                  WHERE status IN ('active', 'past_due') AND access_until IS NOT NULL AND access_until < ?`,
            args: [graceCutoffIso],
        });

        // 3) Plan pagado recién vencido (dentro de la gracia) → Vencida (aún con acceso)
        const grace = await turso.execute({
            sql: `UPDATE companies SET status = 'past_due'
                  WHERE status = 'active' AND access_until IS NOT NULL AND access_until < ? AND access_until >= ?`,
            args: [nowIso, graceCutoffIso],
        });

        // 4) Complementos (Apps): dar de baja pruebas vencidas y cancelaciones cuyo
        //    período ya pasó (no toca las que esperan renovación del plan).
        await appExpireDue(turso);

        const result = {
            ok: true,
            ranAt: nowIso,
            trialsBlocked: trials.rowsAffected ?? 0,
            paidBlocked: blocked.rowsAffected ?? 0,
            movedToGrace: grace.rowsAffected ?? 0,
        };
        console.log('[cron expire-companies]', result);
        return res.status(200).json(result);
    } catch (e) {
        console.error('[cron expire-companies] error:', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
}
