// Motor de facturación unificada (modelo B: un pago mensual = plan + Apps).
// Funciones PURAS de cálculo + billingSummary (lectura). NO cobra nada — el cobro
// real vive en /api/subscribe + webhook (Fase 3). El servidor es la fuente de
// verdad de los precios (nunca el cliente).

// Precios autoritativos. Espejo de api/subscribe.js (PLAN_PRICES) y
// api/_lib/appActions.js (AVAILABLE_APPS). Se unificará el import en la Fase 3.
export const PLAN_PRICES = {
    standard: { CLP: 15000, USD: 15 },
    professional: { CLP: 30000, USD: 30 },
};
const PLAN_ALIASES = { basico: 'standard', basic: 'standard', medium: 'professional', medio: 'professional', pro: 'professional' };

export const APP_PRICES = {
    cocina: { CLP: 5000, USD: 5 },
    integracion: { CLP: 10000, USD: 10 },
    bascula: { CLP: 10000, USD: 10 },
    tienda_web: { CLP: 15000, USD: 15 },
};

export function normalizePlan(p) {
    const k = (p || '').toString().toLowerCase();
    if (PLAN_PRICES[k]) return k;
    return PLAN_ALIASES[k] || 'standard';
}

export function displayCurrency(countryCode) {
    const cc = (countryCode || '').toString().trim().toUpperCase();
    return (cc === 'CL' || cc === 'CHILE' || cc === '') ? 'CLP' : 'USD';
}

// Redondeo por moneda: CLP entero, USD 2 decimales.
export function roundMoney(amount, currency) {
    const n = Number(amount) || 0;
    return currency === 'USD' ? Math.round(n * 100) / 100 : Math.round(n);
}

// Días entre dos fechas ISO (mínimo 1).
export function cycleDays(startIso, endIso) {
    const ms = new Date(endIso) - new Date(startIso);
    return Math.max(1, Math.round(ms / 86400000));
}

// Prorrateo: precio proporcional a los días restantes del ciclo del plan.
// Se cobra UNA sola vez al dar de alta una App a mitad de ciclo; luego la App
// queda alineada a la fecha del plan y se cobra completa en cada renovación.
export function prorate(price, daysRemaining, cycleDaysN, currency) {
    if (!cycleDaysN || cycleDaysN <= 0) return roundMoney(price, currency);
    const p = Number(price) * (Math.max(0, daysRemaining) / cycleDaysN);
    return roundMoney(p, currency);
}

// Próximo día-ancla mensual (para Apps sobre plan ANUAL): el día del mes en que
// se contrató el anual. Devuelve la próxima ocurrencia de ese día desde `from`.
export function nextMonthlyAnchor(anchorIso, from = new Date()) {
    if (!anchorIso) return null;
    const anchorDay = new Date(anchorIso).getUTCDate();
    const d = new Date(from);
    const mk = (yy, mm) => {
        const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
        return new Date(Date.UTC(yy, mm, Math.min(anchorDay, lastDay)));
    };
    let cand = mk(d.getUTCFullYear(), d.getUTCMonth());
    if (cand <= d) {
        const nm = d.getUTCMonth() + 1;
        cand = mk(nm > 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(), nm % 12);
    }
    return cand.toISOString();
}

// Cotización del cobro de un complemento a mitad de ciclo: el prorrateo por los
// días que faltan hasta la fecha del plan (o el día-ancla mensual en anual). Es
// solo cálculo; el cobro real lo hace /api/subscribe (que recalcula, autoritativo).
export async function appChargeQuote(turso, companyId, appKey) {
    const price = APP_PRICES[appKey];
    if (!price) return { success: false, error: 'Complemento no disponible' };
    const c = (await turso.execute({
        sql: 'SELECT plan, access_until, country_code FROM companies WHERE id = ? LIMIT 1',
        args: [companyId],
    })).rows[0];
    if (!c) return { success: false, error: 'Empresa no encontrada' };

    const currency = displayCurrency(c.country_code);
    const monthly = price[currency];

    // Ciclo del plan → hasta dónde alinear el prorrateo.
    const sub = (await turso.execute({
        sql: 'SELECT current_period_start, current_period_end FROM subscriptions WHERE company_id = ? ORDER BY created_at DESC LIMIT 1',
        args: [companyId],
    })).rows[0];
    const now = new Date();
    let periodEnd, planCycle = 'monthly';
    if (sub?.current_period_start && sub?.current_period_end
        && cycleDays(sub.current_period_start, sub.current_period_end) > 45) {
        planCycle = 'annual';
        periodEnd = nextMonthlyAnchor(sub.current_period_start, now);
    } else {
        periodEnd = c.access_until || null;
    }

    const CYCLE = 30; // base nominal del prorrateo (precio × días_restantes / 30)
    let daysRemaining = CYCLE;
    if (periodEnd) {
        daysRemaining = Math.ceil((new Date(periodEnd) - now) / 86400000);
        daysRemaining = Math.max(0, Math.min(CYCLE, daysRemaining));
    }
    const amount = prorate(monthly, daysRemaining, CYCLE, currency);
    return { success: true, appKey, currency, monthly, amount, daysRemaining, cycleDays: CYCLE, periodEnd, planCycle };
}

// Resumen de facturación de una sucursal: plan + Apps activas + total mensual +
// próximo cobro. Solo LECTURA/cálculo.
export async function billingSummary(turso, companyId) {
    const c = (await turso.execute({
        sql: 'SELECT id, plan, status, access_until, country_code FROM companies WHERE id = ? LIMIT 1',
        args: [companyId],
    })).rows[0];
    if (!c) return { success: false, error: 'Empresa no encontrada' };

    const currency = displayCurrency(c.country_code);
    const planKey = normalizePlan(c.plan);
    const planPrice = PLAN_PRICES[planKey]?.[currency] ?? 0;

    // Ciclo del plan (mensual/anual) desde la última suscripción pagada (si existe).
    const sub = (await turso.execute({
        sql: 'SELECT current_period_start, current_period_end FROM subscriptions WHERE company_id = ? ORDER BY created_at DESC LIMIT 1',
        args: [companyId],
    })).rows[0];
    let planCycle = 'monthly';
    let anchorStart = null;
    if (sub?.current_period_start && sub?.current_period_end) {
        planCycle = cycleDays(sub.current_period_start, sub.current_period_end) > 45 ? 'annual' : 'monthly';
        anchorStart = sub.current_period_start;
    }

    // Apps vigentes que suman al mensual (activas/prueba, no vencidas, no gratis).
    const now = new Date();
    const rows = (await turso.execute({
        sql: 'SELECT app_key, status, price, currency, period_end, trial_ends_at, will_renew, granted_free, source FROM company_apps WHERE company_id = ?',
        args: [companyId],
    })).rows;

    const apps = [];
    let appsMonthlyTotal = 0;
    for (const r of rows) {
        const periodEnd = r.period_end || r.trial_ends_at || null;
        const activeNow = ['active', 'trial'].includes(r.status) && (!periodEnd || new Date(periodEnd) >= now);
        if (!activeNow) continue;
        const free = Number(r.granted_free) === 1;
        const willRenew = Number(r.will_renew) !== 0;
        const isTrial = r.status === 'trial';
        // Precio mensual autoritativo por catálogo en la moneda de la empresa.
        const monthly = free ? 0 : (APP_PRICES[r.app_key]?.[currency] ?? Number(r.price) ?? 0);
        // Suma al PRÓXIMO cobro solo lo que efectivamente se cobrará: pagadas (active),
        // que renuevan y no son gratis. Las pruebas ($0 hasta convertir) y las
        // canceladas (no renuevan) se muestran pero no suman.
        if (!free && !isTrial && willRenew) appsMonthlyTotal += monthly;
        apps.push({
            app_key: r.app_key,
            status: r.status,
            trial: isTrial,
            price: monthly,
            period_end: periodEnd,
            granted_free: free,
            will_renew: willRenew,
        });
    }
    appsMonthlyTotal = roundMoney(appsMonthlyTotal, currency);

    // Total mensual + próximo cobro.
    let monthlyTotal, nextChargeDate;
    if (planCycle === 'annual') {
        // Plan prepago por el año; solo las Apps se cobran mensualmente.
        monthlyTotal = appsMonthlyTotal;
        nextChargeDate = appsMonthlyTotal > 0
            ? nextMonthlyAnchor(anchorStart || c.access_until, now)
            : null;
    } else {
        monthlyTotal = roundMoney(planPrice + appsMonthlyTotal, currency);
        nextChargeDate = c.access_until || null;
    }

    return {
        success: true,
        planKey, planPrice, planCycle, currency,
        accessUntil: c.access_until || null,
        apps, appsMonthlyTotal, monthlyTotal, nextChargeDate,
    };
}
