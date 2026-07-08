// Ciclo de vida de la empresa basado en una fecha única de caducidad (access_until).
// Fuente de verdad compartida por el panel admin (cálculo en vivo) y el login.
// El cron (api/cron/expire-companies.js) replica esta lógica en SQL.
//
// Estados:
//   trial      → en prueba (con acceso)
//   active     → al día (con acceso)
//   past_due   → VENCIDA: se pasó la fecha, pero sigue con acceso durante la gracia (solo planes pagados)
//   blocked    → BLOQUEADA: sin acceso, automático (prueba vencida o gracia terminada). Se reactiva SOLA al pagar.
//   suspended  → bloqueo MANUAL del admin (se reactiva solo manualmente)
//   cancelled  → baja definitiva (manual)

export const GRACE_DAYS = 3; // días de gracia tras el vencimiento de un plan PAGADO

const toDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

// Estado efectivo (lo que se MUESTRA), calculado de las fechas y los overrides manuales.
// company: { status, trial_ends_at, access_until }
export function effectiveCompanyStatus(company, now = new Date()) {
    const status = company?.status;
    // Overrides/estados terminales: se respetan tal cual.
    if (status === 'suspended' || status === 'cancelled' || status === 'blocked') return status;

    const accessUntil = toDate(company?.access_until);
    // Sin fecha (legacy): asumimos vigente para no romper acceso existente.
    if (!accessUntil) return status === 'trial' ? 'trial' : 'active';

    // Dentro de la fecha → vigente.
    if (now <= accessUntil) return status === 'trial' ? 'trial' : 'active';

    // Pasó la fecha:
    if (status === 'trial') return 'blocked'; // la prueba NO tiene gracia → bloqueada
    const graceEnd = new Date(accessUntil);
    graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);
    return now <= graceEnd ? 'past_due' : 'blocked'; // en gracia → Vencida; pasada la gracia → Bloqueada
}

// ¿Puede iniciar sesión ahora? Incluye los días de gracia para planes PAGADOS.
export function canAccess(company, now = new Date()) {
    const status = company?.status;
    if (status === 'suspended' || status === 'cancelled' || status === 'blocked') return false;

    const accessUntil = toDate(company?.access_until);
    if (!accessUntil) return true; // legacy sin fecha
    if (now <= accessUntil) return true;
    if (status === 'trial') return false; // prueba vencida = bloqueo inmediato

    const graceEnd = new Date(accessUntil);
    graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);
    return now <= graceEnd;
}
