// Complementos (Apps) del Marketplace — server-side (Fase C).
// appList / appActivate (prueba 30 días) / appCancel. El servidor es la fuente
// de verdad del precio y valida que la cuenta sea Profesional. El gating efectivo
// lo aplica hasApp() en el cliente (mismo modelo que hasModule/plan).

import { appChargeQuote as _appChargeQuote } from './billing.js';

const APP_TRIAL_DAYS = 30;

// Apps comprables (allowlist server-side; precio autoritativo aquí, no del cliente).
const AVAILABLE_APPS = {
    cocina: { scope: 'branch', priceClp: 5000, priceUsd: 5 },
    integracion: { scope: 'branch', priceClp: 10000, priceUsd: 10 },
    bascula: { scope: 'branch', priceClp: 10000, priceUsd: 10 },
    tienda_web: { scope: 'branch', priceClp: 15000, priceUsd: 15 },
    etiquetas: { scope: 'branch', priceClp: 5000, priceUsd: 5 },
    delivery: { scope: 'branch', priceClp: 10000, priceUsd: 10 },
};

async function isProfessional(turso, companyId) {
    const r = await turso.execute({ sql: 'SELECT plan FROM companies WHERE id = ?', args: [companyId] });
    const p = (r.rows[0]?.plan || '').toString().toLowerCase();
    return ['professional', 'medium', 'medio', 'pro'].includes(p);
}

async function appList(turso, companyId) {
    const r = await turso.execute({ sql: 'SELECT * FROM company_apps WHERE company_id = ?', args: [companyId] });
    return { success: true, apps: r.rows };
}

async function appActivate(turso, companyId, session, { appKey, currency = 'CLP' } = {}) {
    const def = AVAILABLE_APPS[appKey];
    if (!def) return { success: false, error: 'Complemento no disponible' };
    if (!(await isProfessional(turso, companyId))) {
        return { success: false, error: 'Necesitas el Plan Profesional para contratar complementos.' };
    }

    const now = new Date();
    const existing = (await turso.execute({
        sql: 'SELECT * FROM company_apps WHERE company_id = ? AND app_key = ?',
        args: [companyId, appKey],
    })).rows[0];

    // Ya activa o con prueba vigente → no reiniciar la prueba.
    const activeNow = existing && (existing.status === 'active'
        || (existing.status === 'trial' && existing.trial_ends_at && new Date(existing.trial_ends_at) >= now));
    if (activeNow) return { success: true, app: existing, already: true };

    // Regla 1: una sola prueba por sucursal. Si ya la usó, requiere pago (el cobro
    // y el prorrateo se resuelven en la Fase 3 vía /api/subscribe).
    if (existing && Number(existing.trial_used) === 1) {
        return { success: false, needsPayment: true, appKey, error: 'La prueba de este complemento ya fue usada. Actívalo con pago.' };
    }

    // Primera vez → prueba de 30 días; el reloj de la prueba corre independiente del plan.
    const trialEnds = new Date(now);
    trialEnds.setDate(trialEnds.getDate() + APP_TRIAL_DAYS);
    const price = currency === 'USD' ? def.priceUsd : def.priceClp;
    const iso = now.toISOString();
    const trialIso = trialEnds.toISOString();

    await turso.execute({
        sql: `INSERT INTO company_apps (company_id, app_key, scope, status, trial_ends_at, period_end, trial_used, will_renew, source, granted_free, activated_at, price, currency, created_at, updated_at)
              VALUES (?, ?, ?, 'trial', ?, ?, 1, 1, 'marketplace', 0, ?, ?, ?, ?, ?)
              ON CONFLICT(company_id, app_key) DO UPDATE SET
                status = 'trial', trial_ends_at = excluded.trial_ends_at, period_end = excluded.period_end,
                trial_used = 1, will_renew = 1, source = 'marketplace', granted_free = 0, cancelled_at = NULL,
                activated_at = excluded.activated_at, price = excluded.price, currency = excluded.currency, updated_at = excluded.updated_at`,
        args: [companyId, appKey, def.scope, trialIso, trialIso, iso, price, currency, iso, iso],
    });

    const app = (await turso.execute({
        sql: 'SELECT * FROM company_apps WHERE company_id = ? AND app_key = ?',
        args: [companyId, appKey],
    })).rows[0];
    return { success: true, app };
}

async function appCancel(turso, companyId, session, { appKey } = {}) {
    if (!appKey) return { success: false, error: 'Falta appKey' };
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = (await turso.execute({
        sql: 'SELECT * FROM company_apps WHERE company_id = ? AND app_key = ?',
        args: [companyId, appKey],
    })).rows[0];
    if (!existing) return { success: false, error: 'Complemento no encontrado' };

    const pend = existing.period_end ? new Date(existing.period_end) : null;
    if (pend && pend > now) {
        // Cancelar = NO cortar de inmediato: sigue activa hasta fin del período
        // pagado (corre pegada al plan) y no se renueva. Sin reembolso.
        await turso.execute({
            sql: "UPDATE company_apps SET will_renew = 0, cancelled_at = ?, updated_at = ? WHERE company_id = ? AND app_key = ?",
            args: [nowIso, nowIso, companyId, appKey],
        });
        return { success: true, activeUntil: existing.period_end };
    }
    // Sin período vigente (grandfather sin vencimiento o ya vencido) → baja inmediata.
    await turso.execute({
        sql: "UPDATE company_apps SET status = 'cancelled', will_renew = 0, cancelled_at = ?, updated_at = ? WHERE company_id = ? AND app_key = ?",
        args: [nowIso, nowIso, companyId, appKey],
    });
    return { success: true, activeUntil: null };
}

// Da de baja las Apps cuyo período venció: (a) canceladas que no renuevan y ya
// pasaron su fin de período, y (b) pruebas vencidas que no se pagaron. Las Apps
// con will_renew=1 cuyo period_end pasó NO se tocan: esperan la renovación del
// plan (y si el plan venció, el login bloquea la empresa entera). Idempotente.
async function appExpireDue(turso) {
    const now = new Date().toISOString();
    await turso.execute({
        sql: `UPDATE company_apps SET status = 'cancelled', updated_at = ?
               WHERE status = 'active' AND will_renew = 0
                 AND period_end IS NOT NULL AND period_end < ?`,
        args: [now, now],
    });
    await turso.execute({
        sql: `UPDATE company_apps SET status = 'cancelled', updated_at = ?
               WHERE status = 'trial'
                 AND coalesce(period_end, trial_ends_at) IS NOT NULL
                 AND coalesce(period_end, trial_ends_at) < ?`,
        args: [now, now],
    });
    return { success: true };
}

// Cotización del prorrateo para el modal de pago (el cobro real lo recalcula
// /api/subscribe). Firma homogénea (turso, companyId, session, body).
async function appChargeQuote(turso, companyId, session, { appKey } = {}) {
    return _appChargeQuote(turso, companyId, appKey);
}

export const appActions = { appList, appActivate, appCancel, appChargeQuote };
export { appExpireDue };
