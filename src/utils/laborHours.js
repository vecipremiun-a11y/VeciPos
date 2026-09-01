// Cálculo de jornada para el informe de horas (Fase 1 del plan legal).
//
// Funciones puras: reciben marcas y devuelven horas y alertas. Nada de aquí
// toca la base ni el estado global, para que el mismo cálculo sirva en el
// libro, en el informe semanal y en una prueba.
//
// Referencia legal: la Ley 21.561 rebaja la jornada ordinaria máxima por etapas
// (45h, luego 44h el 26-abr-2024, 42h el 26-abr-2026 y 40h el 26-abr-2028) y el
// Art. 31 del Código del Trabajo limita las horas extraordinarias a 2 por día.
// Los máximos son configurables por empresa porque cambian con el calendario.

export const LEGAL_DEFAULTS = {
    weeklyHours: 42,
    dailyMaxHours: 10,
    maxOvertimeDaily: 2,
    minRestBetweenShiftsHours: 11,
};

const H = 3600000;

// Empareja las marcas de un día en tramos entrada -> salida.
export function pairDay(records) {
    // Solo marcas vigentes: una anulada por corrección aprobada no cuenta.
    const live = records
        .filter(r => !Number(r.is_corrected))
        .sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));

    const segments = [];
    let open = null;

    for (const r of live) {
        if (r.type === 'entry') {
            // Dos entradas seguidas: la primera quedó sin cerrar. Se deja
            // registrada como incompleta en vez de inventarle una salida.
            if (open) segments.push({ in: open, out: null });
            open = r;
        } else if (r.type === 'exit') {
            if (open) { segments.push({ in: open, out: r }); open = null; }
            else segments.push({ in: null, out: r }); // salida huérfana
        }
    }
    if (open) segments.push({ in: open, out: null });

    return segments;
}

// Horas efectivamente trabajadas en un día, sumando todos los tramos cerrados.
export function hoursWorked(segments) {
    let ms = 0;
    for (const s of segments) {
        if (s.in && s.out) ms += new Date(s.out.recorded_at) - new Date(s.in.recorded_at);
    }
    return ms / H;
}

export function hasIncomplete(segments) {
    return segments.some(s => !s.in || !s.out);
}

// Resumen de un día: tramos, horas y si quedó abierto.
// `records` son las marcas crudas de ESE día y ESE trabajador.
export function summarizeDay(date, records) {
    const segments = pairDay(records);
    return {
        date,
        segments,
        worked: hoursWorked(segments),
        incomplete: hasIncomplete(segments),
        firstIn: segments.find(s => s.in)?.in?.recorded_at ?? null,
        lastOut: [...segments].reverse().find(s => s.out)?.out?.recorded_at ?? null,
        marks: segments.length,
    };
}

// Lunes de la semana de una fecha yyyy-MM-dd, devuelto como yyyy-MM-dd.
export function weekStartOf(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    const dow = (d.getDay() + 6) % 7; // 0 = lunes
    d.setDate(d.getDate() - dow);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function groupByWeek(days) {
    const out = {};
    for (const d of days) {
        const k = weekStartOf(d.date);
        (out[k] ||= []).push(d);
    }
    return out;
}

// Alertas legales de un trabajador en un período.
//
// `days` = salida de summarizeDay por día. `weeklyPacted` = horas del contrato.
// Cada hallazgo es algo que un fiscalizador preguntaría, y por eso lleva la
// fecha y el dato que lo gatilló.
export function buildAlerts(days, { weeklyPacted, limits = LEGAL_DEFAULTS, exemptArt22 = false } = {}) {
    if (exemptArt22) return [];
    const alerts = [];
    const max = { ...LEGAL_DEFAULTS, ...limits };

    for (const d of days) {
        if (d.incomplete) {
            alerts.push({
                date: d.date, level: 'error', kind: 'incomplete',
                message: 'Jornada sin cerrar: falta la marca de entrada o de salida.',
            });
        }
        if (d.worked > max.dailyMaxHours) {
            alerts.push({
                date: d.date, level: 'error', kind: 'daily_max',
                message: `${d.worked.toFixed(2)} h en el día superan el máximo de ${max.dailyMaxHours} h.`,
            });
        }
    }

    // Descanso entre jornadas: salida de un día contra entrada del siguiente.
    const ordered = [...days].filter(d => d.lastOut).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < ordered.length; i++) {
        const prevOut = new Date(ordered[i - 1].lastOut);
        const nextIn = ordered[i].firstIn ? new Date(ordered[i].firstIn) : null;
        if (!nextIn) continue;
        const rest = (nextIn - prevOut) / H;
        if (rest > 0 && rest < max.minRestBetweenShiftsHours) {
            alerts.push({
                date: ordered[i].date, level: 'warn', kind: 'short_rest',
                message: `Solo ${rest.toFixed(1)} h de descanso desde la salida anterior.`,
            });
        }
    }

    // Semanal: lunes a domingo, contra lo PACTADO en el contrato.
    for (const [weekKey, group] of Object.entries(groupByWeek(days))) {
        const worked = group.reduce((a, d) => a + d.worked, 0);
        if (weeklyPacted && worked > weeklyPacted) {
            const extra = worked - weeklyPacted;
            alerts.push({
                date: weekKey, level: extra > 12 ? 'error' : 'warn', kind: 'weekly_over',
                message: `Semana del ${weekKey}: ${worked.toFixed(2)} h trabajadas contra ${weeklyPacted} h pactadas (mas ${extra.toFixed(2)} h).`,
            });
        }
    }

    return alerts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Informe semanal: horas pactadas, trabajadas, extraordinarias y déficit.
// Es el resumen que se le entrega al trabajador.
export function weeklyReport(days, { weeklyPacted, exemptArt22 = false } = {}) {
    return Object.entries(groupByWeek(days))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, group]) => {
            const worked = group.reduce((a, d) => a + d.worked, 0);
            const pacted = exemptArt22 ? 0 : (weeklyPacted || 0);
            return {
                weekStart,
                days: group.length,
                pacted,
                worked,
                overtime: pacted && worked > pacted ? worked - pacted : 0,
                deficit: pacted && worked < pacted ? pacted - worked : 0,
                incompleteDays: group.filter(d => d.incomplete).length,
            };
        });
}
