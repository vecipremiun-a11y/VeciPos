// Complementos (Apps) del Marketplace — server-side (Fase C).
// appList / appActivate (prueba 30 días) / appCancel. El servidor es la fuente
// de verdad del precio y valida que la cuenta sea Profesional. El gating efectivo
// lo aplica hasApp() en el cliente (mismo modelo que hasModule/plan).

const APP_TRIAL_DAYS = 30;

// Apps comprables (allowlist server-side; precio autoritativo aquí, no del cliente).
const AVAILABLE_APPS = {
    cocina: { scope: 'branch', priceClp: 10000, priceUsd: 10 },
    integracion: { scope: 'branch', priceClp: 10000, priceUsd: 10 },
    bascula: { scope: 'branch', priceClp: 10000, priceUsd: 10 },
    tienda_web: { scope: 'branch', priceClp: 15000, priceUsd: 15 },
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

    // Ya activo o con prueba vigente → no reiniciar la prueba.
    if (existing && (existing.status === 'active'
        || (existing.status === 'trial' && existing.trial_ends_at && new Date(existing.trial_ends_at) >= now))) {
        return { success: true, app: existing, already: true };
    }

    const trialEnds = new Date(now);
    trialEnds.setDate(trialEnds.getDate() + APP_TRIAL_DAYS);
    const price = currency === 'USD' ? def.priceUsd : def.priceClp;

    await turso.execute({
        sql: `INSERT INTO company_apps (company_id, app_key, scope, status, trial_ends_at, activated_at, price, currency, created_at, updated_at)
              VALUES (?, ?, ?, 'trial', ?, ?, ?, ?, ?, ?)
              ON CONFLICT(company_id, app_key) DO UPDATE SET
                status = 'trial', trial_ends_at = excluded.trial_ends_at, activated_at = excluded.activated_at,
                cancelled_at = NULL, price = excluded.price, currency = excluded.currency, updated_at = excluded.updated_at`,
        args: [companyId, appKey, def.scope, trialEnds.toISOString(), now.toISOString(), price, currency, now.toISOString(), now.toISOString()],
    });

    const app = (await turso.execute({
        sql: 'SELECT * FROM company_apps WHERE company_id = ? AND app_key = ?',
        args: [companyId, appKey],
    })).rows[0];
    return { success: true, app };
}

async function appCancel(turso, companyId, session, { appKey } = {}) {
    if (!appKey) return { success: false, error: 'Falta appKey' };
    const now = new Date().toISOString();
    await turso.execute({
        sql: "UPDATE company_apps SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE company_id = ? AND app_key = ?",
        args: [now, now, companyId, appKey],
    });
    return { success: true };
}

export const appActions = { appList, appActivate, appCancel };
