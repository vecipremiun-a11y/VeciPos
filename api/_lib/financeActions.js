const DEFAULT_CATEGORIES = [
    ['Arriendo', '#8b5cf6'],
    ['Electricidad', '#f59e0b'],
    ['Agua', '#06b6d4'],
    ['Internet y telefonía', '#3b82f6'],
    ['Remuneraciones', '#10b981'],
    ['Publicidad', '#ec4899'],
    ['Mantención', '#f97316'],
    ['Transporte', '#6366f1'],
    ['Contabilidad y software', '#14b8a6'],
    ['Impuestos', '#ef4444'],
    ['Otros', '#64748b'],
];

const nowIso = () => new Date().toISOString();
const asNumber = (value) => Math.max(0, Number(value) || 0);
const validStatus = (value) => ['pending', 'paid', 'cancelled'].includes(value) ? value : 'pending';

function dateOnly(value) {
    return String(value || '').slice(0, 10);
}

function parseDate(value) {
    const [year, month, day] = dateOnly(value).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date) {
    return date.toISOString().slice(0, 10);
}

function daysInclusive(start, end) {
    return Math.max(0, Math.floor((end - start) / 86400000) + 1);
}

function overlapDays(startA, endA, startB, endB) {
    const start = startA > startB ? startA : startB;
    const end = endA < endB ? endA : endB;
    return start <= end ? daysInclusive(start, end) : 0;
}

function monthBounds(periodKey) {
    const [year, month] = periodKey.split('-').map(Number);
    return {
        start: new Date(Date.UTC(year, month - 1, 1)),
        end: new Date(Date.UTC(year, month, 0)),
    };
}

function previousMonthRange(startDate) {
    const [year, month] = dateOnly(startDate).split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return { start: formatDate(start), end: formatDate(end) };
}

// Fecha de vencimiento de una plantilla recurrente en el mes: due_day acotado
// al último día real del mes (due_day 31 en meses de 30 días / febrero).
function clampDueDay(periodKey, dueDay) {
    const { end } = monthBounds(periodKey);
    const day = Math.min(Math.max(1, Number(dueDay) || 1), end.getUTCDate());
    return `${periodKey}-${String(day).padStart(2, '0')}`;
}

// '2026-11' + (-3) → '2026-08'
function shiftPeriod(periodKey, delta) {
    const [year, month] = periodKey.split('-').map(Number);
    return formatDate(new Date(Date.UTC(year, month - 1 + delta, 1))).slice(0, 7);
}

// Fecha escrita por el usuario (YYYY-MM-DD) o null.
const validDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);
// Mañana en UTC: la fecha del navegador puede ir hasta un día adelante del
// servidor (Chile de noche ya es mañana en UTC… y al revés en otros países).
const tomorrowUtc = () => formatDate(new Date(Date.now() + 86400000));

// Los fondos (migración 0041) pueden no existir todavía en una base: entre el
// push y migrate-all, o en desarrollo. Sin ellos, Administración sigue igual.
const missingFunds = (error) => /no such table|no such column/i.test(String(error?.message || ''));

async function loadFunds(turso, companyId) {
    try {
        const res = await turso.execute({
            sql: `SELECT f.id, f.name, f.active,
                         COALESCE((SELECT SUM(CASE WHEN m.kind = 'deposit' THEN m.amount ELSE -m.amount END)
                                   FROM finance_fund_movements m
                                   WHERE m.company_id = f.company_id AND m.fund_id = f.id), 0)
                       - COALESCE((SELECT SUM(e.amount) FROM business_expenses e
                                   WHERE e.company_id = f.company_id AND e.fund_id = f.id AND e.status = 'paid'), 0) AS balance
                  FROM finance_funds f
                  WHERE f.company_id = ?
                  ORDER BY f.active DESC, f.name`,
            args: [companyId],
        });
        return res.rows.map(row => ({
            id: row.id, name: row.name, active: Number(row.active) === 1, balance: Number(row.balance) || 0,
        }));
    } catch (error) {
        if (missingFunds(error)) return null;
        throw error;
    }
}

// Cuántos meses atrás se sigue mostrando un recurrente sin pagar en
// Vencimientos (Kevin, 14-nov-2026). Más atrás no: una empresa que nunca usó
// el botón Pagar vería un año entero de cuentas "vencidas".
const UNPAID_MONTHS_BACK = 3;

function periodKeysBetween(start, end) {
    const keys = [];
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= last) {
        keys.push(formatDate(cursor).slice(0, 7));
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return keys;
}

async function seedCategories(turso, companyId) {
    await turso.batch(DEFAULT_CATEGORIES.map(([name, color]) => ({
        sql: `INSERT OR IGNORE INTO expense_categories
              (company_id, name, color, active, created_at) VALUES (?, ?, ?, 1, ?)`,
        args: [companyId, name, color, nowIso()],
    })));
}

async function canManageFinance(turso, companyId, session) {
    if (session?.role === 'super_admin' || session?.role === 'owner') return true;
    const membership = await turso.execute({
        sql: 'SELECT role FROM user_companies WHERE user_id = ? AND company_id = ? LIMIT 1',
        args: [session?.uid, companyId],
    });
    const role = membership.rows[0]?.role;
    if (role === 'owner' || role === 'super_admin' || role === 'Administrador') return true;
    if (!role) return false;
    const permission = await turso.execute({
        sql: `SELECT granted FROM role_permissions
              WHERE company_id = ? AND role = ? AND permission = 'finance.manage' LIMIT 1`,
        args: [companyId, role],
    });
    return Number(permission.rows[0]?.granted) === 1;
}

async function requireManage(turso, companyId, session) {
    if (await canManageFinance(turso, companyId, session)) return null;
    return { success: false, error: 'No tienes permiso para gestionar gastos' };
}

export async function summarizeFinancials(turso, companyId, startDate, endDate) {
    const startText = dateOnly(startDate);
    const endText = dateOnly(endDate);
    if (!startText || !endText || startText > endText) throw new Error('Rango de fechas inválido');

    const rangeStart = parseDate(startText);
    const rangeEnd = parseDate(endText);
    const periodKeys = periodKeysBetween(rangeStart, rangeEnd);
    const firstPeriod = periodKeys[0];
    const lastPeriod = periodKeys[periodKeys.length - 1];

    const [profitRes, oneOffRes, recurringRes, linkedRes, payrollRes, staffRes, pendingRes] = await Promise.all([
        turso.execute({
            sql: `SELECT COALESCE(SUM(total_revenue), 0) total_revenue,
                         COALESCE(SUM(total_cost), 0) total_cost,
                         COALESCE(SUM(total_profit), 0) total_profit,
                         COALESCE(SUM(total_tax), 0) total_tax
                  FROM product_daily_profit
                  WHERE company_id = ? AND day BETWEEN ? AND ?`,
            args: [companyId, startText, endText],
        }),
        turso.execute({
            sql: `SELECT e.*, c.name category_name, c.color category_color
                  FROM business_expenses e
                  LEFT JOIN expense_categories c ON c.id = e.category_id
                  WHERE e.company_id = ? AND e.recurring_expense_id IS NULL
                    AND e.status != 'cancelled' AND e.expense_date BETWEEN ? AND ?`,
            args: [companyId, startText, endText],
        }),
        turso.execute({
            sql: `SELECT r.*, c.name category_name, c.color category_color
                  FROM recurring_expenses r
                  LEFT JOIN expense_categories c ON c.id = r.category_id
                  WHERE r.company_id = ? AND r.active = 1
                    AND r.start_date <= ? AND (r.end_date IS NULL OR r.end_date = '' OR r.end_date >= ?)`,
            args: [companyId, endText, startText],
        }),
        turso.execute({
            sql: `SELECT * FROM business_expenses
                  WHERE company_id = ? AND recurring_expense_id IS NOT NULL
                    AND status != 'cancelled' AND period_key BETWEEN ? AND ?`,
            args: [companyId, firstPeriod, lastPeriod],
        }),
        turso.execute({
            sql: `SELECT id, user_id, period_start, period_end, total_to_pay
                  FROM payroll_periods
                  WHERE company_id = ? AND is_closed = 1
                    AND period_start <= ? AND period_end >= ?`,
            args: [companyId, endText, startText],
        }),
        turso.execute({
            sql: `SELECT id, pay_base_amount, labor_start_date
                  FROM users
                  WHERE company_id = ? AND has_labor_profile = 1
                    AND COALESCE(labor_status, 'active') = 'active'`,
            args: [companyId],
        }),
        turso.execute({
            sql: `SELECT COALESCE(SUM(amount), 0) total
                  FROM business_expenses
                  WHERE company_id = ? AND status = 'pending'
                    AND COALESCE(due_date, expense_date) <= ?`,
            args: [companyId, endText],
        }),
    ]);

    const profit = profitRes.rows[0] || {};
    let oneOffExpenses = 0;
    const categoryTotals = new Map();
    for (const row of oneOffRes.rows) {
        const amount = asNumber(row.amount);
        oneOffExpenses += amount;
        const key = row.category_name || 'Otros';
        categoryTotals.set(key, (categoryTotals.get(key) || 0) + amount);
    }

    const linkedByTemplatePeriod = new Map();
    for (const row of linkedRes.rows) {
        linkedByTemplatePeriod.set(`${row.recurring_expense_id}:${row.period_key}`, row);
    }

    let recurringExpenses = 0;
    for (const template of recurringRes.rows) {
        const templateStart = parseDate(template.start_date);
        const templateEnd = template.end_date ? parseDate(template.end_date) : rangeEnd;
        for (const key of periodKeys) {
            const bounds = monthBounds(key);
            const activeStart = templateStart > bounds.start ? templateStart : bounds.start;
            const activeEnd = templateEnd < bounds.end ? templateEnd : bounds.end;
            if (activeStart > activeEnd) continue;
            const overlap = overlapDays(activeStart, activeEnd, rangeStart, rangeEnd);
            if (!overlap) continue;
            const actual = linkedByTemplatePeriod.get(`${template.id}:${key}`);
            const monthlyAmount = actual ? asNumber(actual.amount) : asNumber(template.amount);
            const daysInMonth = daysInclusive(bounds.start, bounds.end);
            const allocated = daysInMonth ? monthlyAmount * (overlap / daysInMonth) : 0;
            recurringExpenses += allocated;
            const category = template.category_name || 'Otros';
            categoryTotals.set(category, (categoryTotals.get(category) || 0) + allocated);
        }
    }

    let payrollExpense = 0;
    const closedIntervals = new Map();
    for (const row of payrollRes.rows) {
        const periodStart = parseDate(row.period_start);
        const periodEnd = parseDate(row.period_end);
        const overlap = overlapDays(periodStart, periodEnd, rangeStart, rangeEnd);
        const periodDays = daysInclusive(periodStart, periodEnd);
        payrollExpense += periodDays ? asNumber(row.total_to_pay) * overlap / periodDays : 0;
        const intervals = closedIntervals.get(String(row.user_id)) || [];
        intervals.push({ start: periodStart, end: periodEnd });
        closedIntervals.set(String(row.user_id), intervals);
    }

    for (const user of staffRes.rows) {
        const staffStart = user.labor_start_date ? parseDate(user.labor_start_date) : rangeStart;
        const covered = closedIntervals.get(String(user.id)) || [];
        for (const key of periodKeys) {
            const bounds = monthBounds(key);
            const activeStart = staffStart > bounds.start ? staffStart : bounds.start;
            if (activeStart > bounds.end) continue;
            const allocationStart = activeStart > rangeStart ? activeStart : rangeStart;
            const allocationEnd = bounds.end < rangeEnd ? bounds.end : rangeEnd;
            if (allocationStart > allocationEnd) continue;
            let uncoveredDays = 0;
            for (let cursor = new Date(allocationStart); cursor <= allocationEnd; cursor = new Date(cursor.getTime() + 86400000)) {
                if (!covered.some(interval => cursor >= interval.start && cursor <= interval.end)) uncoveredDays += 1;
            }
            const daysInMonth = daysInclusive(bounds.start, bounds.end);
            payrollExpense += daysInMonth ? asNumber(user.pay_base_amount) * uncoveredDays / daysInMonth : 0;
        }
    }

    if (payrollExpense) categoryTotals.set('Remuneraciones', (categoryTotals.get('Remuneraciones') || 0) + payrollExpense);
    const operatingExpenses = oneOffExpenses + recurringExpenses;
    const grossProfit = Number(profit.total_profit) || 0;
    const netOperatingProfit = grossProfit - operatingExpenses - payrollExpense;

    return {
        startDate: startText,
        endDate: endText,
        revenue: Number(profit.total_revenue) || 0,
        productCost: Number(profit.total_cost) || 0,
        taxes: Number(profit.total_tax) || 0,
        grossProfit,
        oneOffExpenses,
        recurringExpenses,
        payrollExpense,
        operatingExpenses,
        totalExpenses: operatingExpenses + payrollExpense,
        netOperatingProfit,
        pendingObligations: Number(pendingRes.rows[0]?.total) || 0,
        categories: [...categoryTotals.entries()]
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount),
    };
}

async function financeBootstrap(turso, companyId, session, { startDate, endDate }) {
    await seedCategories(turso, companyId);
    const startText = dateOnly(startDate);
    const endText = dateOnly(endDate);
    const periodKey = startText.slice(0, 7);
    const firstOpenPeriod = shiftPeriod(periodKey, -UNPAID_MONTHS_BACK);
    const prev = previousMonthRange(startText);

    const [categories, expenses, recurring, summary, previousSummary, dailyProfit, dailyOneOff, pendingExpenses, linkedPayments, funds] = await Promise.all([
        turso.execute({
            sql: 'SELECT * FROM expense_categories WHERE company_id = ? AND active = 1 ORDER BY name',
            args: [companyId],
        }),
        turso.execute({
            sql: `SELECT e.*, c.name category_name, r.description recurring_description
                  FROM business_expenses e
                  LEFT JOIN expense_categories c ON c.id = e.category_id
                  LEFT JOIN recurring_expenses r ON r.id = e.recurring_expense_id
                  WHERE e.company_id = ? ORDER BY e.expense_date DESC, e.id DESC LIMIT 300`,
            args: [companyId],
        }),
        turso.execute({
            sql: `SELECT r.*, c.name category_name
                  FROM recurring_expenses r LEFT JOIN expense_categories c ON c.id = r.category_id
                  WHERE r.company_id = ? ORDER BY r.active DESC, r.description`,
            args: [companyId],
        }),
        summarizeFinancials(turso, companyId, startText, endText),
        summarizeFinancials(turso, companyId, prev.start, prev.end),
        // Serie diaria de ventas/costo/utilidad (mismo patrón que salesSummaryByRange)
        turso.execute({
            sql: `SELECT day, SUM(total_revenue) revenue, SUM(total_cost) cost, SUM(total_profit) profit
                  FROM product_daily_profit
                  WHERE company_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day ASC`,
            args: [companyId, startText, endText],
        }),
        // Gastos puntuales por día (los recurrentes van en la línea de costo fijo)
        turso.execute({
            sql: `SELECT expense_date day, SUM(amount) amount
                  FROM business_expenses
                  WHERE company_id = ? AND recurring_expense_id IS NULL AND status != 'cancelled'
                    AND expense_date BETWEEN ? AND ? GROUP BY expense_date`,
            args: [companyId, startText, endText],
        }),
        // Obligaciones: todo gasto pendiente, ordenado por vencimiento
        turso.execute({
            sql: `SELECT e.id, e.description, e.supplier, e.amount, e.recurring_expense_id,
                         c.name category_name, COALESCE(e.due_date, e.expense_date) due_date
                  FROM business_expenses e
                  LEFT JOIN expense_categories c ON c.id = e.category_id
                  WHERE e.company_id = ? AND e.status = 'pending'
                  ORDER BY due_date ASC LIMIT 100`,
            args: [companyId],
        }),
        // Pagos recurrentes ya vinculados al mes y a los anteriores que todavía
        // se muestran (para detectar plantillas sin pagar)
        turso.execute({
            sql: `SELECT recurring_expense_id, period_key FROM business_expenses
                  WHERE company_id = ? AND recurring_expense_id IS NOT NULL
                    AND status != 'cancelled' AND period_key BETWEEN ? AND ?`,
            args: [companyId, firstOpenPeriod, periodKey],
        }),
        loadFunds(turso, companyId),
    ]);

    const oneOffByDay = new Map(dailyOneOff.rows.map(row => [row.day, asNumber(row.amount)]));
    const dailySeries = dailyProfit.rows.map(row => ({
        day: row.day,
        revenue: asNumber(row.revenue),
        cost: asNumber(row.cost),
        grossProfit: Number(row.profit) || 0,
        oneOffExpense: oneOffByDay.get(row.day) || 0,
    }));
    for (const [day, amount] of oneOffByDay) {
        if (!dailySeries.some(item => item.day === day)) {
            dailySeries.push({ day, revenue: 0, cost: 0, grossProfit: 0, oneOffExpense: amount });
        }
    }
    dailySeries.sort((a, b) => a.day.localeCompare(b.day));

    const linked = new Set(linkedPayments.rows.map(row => `${row.recurring_expense_id}:${row.period_key}`));
    const obligations = pendingExpenses.rows.map(row => ({
        kind: 'expense',
        id: row.id,
        description: row.description,
        supplier: row.supplier,
        amount: asNumber(row.amount),
        categoryName: row.category_name,
        dueDate: dateOnly(row.due_date),
        recurringExpenseId: row.recurring_expense_id,
    }));
    for (const template of recurring.rows) {
        if (Number(template.active) !== 1) continue;
        // Un recurrente sin pagar sigue en Vencimientos hasta 3 meses atrás.
        // Nunca desde antes de que empiece ni de que se anotara en el sistema:
        // esos meses se pagaron por fuera.
        const from = [firstOpenPeriod, dateOnly(template.start_date).slice(0, 7), dateOnly(template.created_at).slice(0, 7)]
            .filter(key => /^\d{4}-\d{2}$/.test(key))
            .sort()
            .at(-1);
        for (let key = from; key <= periodKey; key = shiftPeriod(key, 1)) {
            if (template.end_date && dateOnly(template.end_date) < `${key}-01`) break;
            if (linked.has(`${template.id}:${key}`)) continue;
            obligations.push({
                kind: 'recurring',
                templateId: template.id,
                description: template.description,
                supplier: template.supplier,
                amount: asNumber(template.amount),
                categoryName: template.category_name,
                dueDate: clampDueDay(key, template.due_day),
                periodKey: key,
            });
        }
    }
    obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
        success: true,
        categories: categories.rows,
        expenses: expenses.rows,
        recurring: recurring.rows,
        summary,
        previousSummary,
        dailySeries,
        obligations,
        // null = la base todavía no tiene fondos (migración 0041).
        funds,
        fixedCosts: {
            monthlyFixed: summary.recurringExpenses + summary.payrollExpense,
            recurring: summary.recurringExpenses,
            payroll: summary.payrollExpense,
        },
    };
}

async function categoryCreate(turso, companyId, session, { data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    const name = String(data?.name || '').trim();
    if (!name) return { success: false, error: 'Ingresa el nombre de la categoría' };
    await turso.execute({
        sql: `INSERT INTO expense_categories (company_id, name, color, active, created_at)
              VALUES (?, ?, ?, 1, ?)`,
        args: [companyId, name, data?.color || '#64748b', nowIso()],
    });
    return { success: true };
}

async function expenseSave(turso, companyId, session, { data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    if (!String(data?.description || '').trim()) return { success: false, error: 'Ingresa una descripción' };
    if (asNumber(data?.amount) <= 0) return { success: false, error: 'El monto debe ser mayor que cero' };
    if (!dateOnly(data?.expense_date)) return { success: false, error: 'Ingresa la fecha del gasto' };
    const timestamp = nowIso();
    const status = validStatus(data.status);
    const recurringId = data.recurring_expense_id || null;
    const periodKey = recurringId ? (data.period_key || dateOnly(data.expense_date).slice(0, 7)) : null;
    const paidAt = status === 'paid' ? (data.paid_at || dateOnly(data.expense_date)) : null;

    // De qué fondo sale (caja chica, capital…). Solo se toca si viene en el
    // pedido: sin la migración 0041 la columna no existe y lo demás sigue igual.
    // Un fondo de otra empresa queda en NULL.
    const withFund = data.fund_id !== undefined;
    const fundStatement = (where, args) => ({
        sql: `UPDATE business_expenses
              SET fund_id = (SELECT id FROM finance_funds WHERE id = ? AND company_id = ?)
              WHERE company_id = ? AND ${where}`,
        args: [data.fund_id || null, companyId, companyId, ...args],
    });
    const run = async (main, fund) => {
        if (withFund) await turso.batch([main, fund], 'write');
        else await turso.execute(main);
    };

    if (data.id) {
        await run({
            sql: `UPDATE business_expenses SET recurring_expense_id = ?, category_id = ?, period_key = ?,
                  description = ?, supplier = ?, amount = ?, expense_date = ?, due_date = ?, paid_at = ?,
                  status = ?, payment_method = ?, notes = ?, updated_at = ?
                  WHERE id = ? AND company_id = ?`,
            args: [recurringId, data.category_id || null, periodKey, String(data.description).trim(),
                data.supplier || null, asNumber(data.amount), dateOnly(data.expense_date),
                dateOnly(data.due_date) || null, paidAt, status, data.payment_method || null,
                data.notes || null, timestamp, data.id, companyId],
        }, fundStatement('id = ?', [data.id]));
    } else if (recurringId) {
        await run({
            sql: `INSERT INTO business_expenses
                  (company_id, recurring_expense_id, category_id, period_key, description, supplier,
                   amount, expense_date, due_date, paid_at, status, payment_method, notes,
                   created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(company_id, recurring_expense_id, period_key) DO UPDATE SET
                    category_id = excluded.category_id, description = excluded.description,
                    supplier = excluded.supplier, amount = excluded.amount,
                    expense_date = excluded.expense_date, due_date = excluded.due_date,
                    paid_at = excluded.paid_at, status = excluded.status,
                    payment_method = excluded.payment_method, notes = excluded.notes,
                    updated_at = excluded.updated_at`,
            args: [companyId, recurringId, data.category_id || null, periodKey,
                String(data.description).trim(), data.supplier || null, asNumber(data.amount),
                dateOnly(data.expense_date), dateOnly(data.due_date) || null, paidAt, status,
                data.payment_method || null, data.notes || null, session?.uid || null, timestamp, timestamp],
        }, fundStatement('recurring_expense_id = ? AND period_key = ?', [recurringId, periodKey]));
    } else {
        await run({
            sql: `INSERT INTO business_expenses
                  (company_id, recurring_expense_id, category_id, period_key, description, supplier,
                   amount, expense_date, due_date, paid_at, status, payment_method, notes,
                   created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [companyId, recurringId, data.category_id || null, periodKey,
                String(data.description).trim(), data.supplier || null, asNumber(data.amount),
                dateOnly(data.expense_date), dateOnly(data.due_date) || null, paidAt, status,
                data.payment_method || null, data.notes || null, session?.uid || null, timestamp, timestamp],
        // Mismo batch = misma conexión: last_insert_rowid() es el gasto recién creado.
        }, fundStatement('id = last_insert_rowid()', []));
    }
    return { success: true };
}

// Botón «Pagar» de Vencimientos: el acceso rápido para pagar una cuenta del
// local. Solo se cambia el monto (el del recurrente es un estimado; el real
// llega con la boleta del mes) y el medio de pago. La fecha de pago es la del
// día en que se paga, aparte del vencimiento: pagar antes o después no cambia
// a qué mes pertenece la cuenta (period_key). Kevin, 14-nov-2026.
//   - { id }: un gasto ya anotado como pendiente → queda pagado.
//   - { recurring_expense_id, period_key }: el recurrente de ese mes → se
//     anota el gasto real del mes, ya pagado.
async function expensePay(turso, companyId, session, { data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    const amount = asNumber(data?.amount);
    if (amount <= 0) return { success: false, error: 'El monto debe ser mayor que cero' };
    // La fecha la manda el navegador: «hoy» en el país del local (el servidor
    // está en UTC y de noche ya sería mañana), o el día real en que se pagó si
    // se anota después (Kevin: «pagué ayer y no alcancé a registrarlo»).
    const paidAt = validDate(data?.paid_at) || formatDate(new Date());
    if (paidAt > tomorrowUtc()) return { success: false, error: 'La fecha de pago no puede ser futura' };
    const method = String(data?.payment_method || '').trim() || null;
    const timestamp = nowIso();
    // Fondo del que sale la plata (caja chica, capital…), si se eligió.
    const withFund = data?.fund_id !== undefined;

    const marcarPagado = async (id) => {
        const res = await turso.execute({
            sql: `UPDATE business_expenses SET amount = ?, status = 'paid', paid_at = ?,
                  payment_method = COALESCE(?, payment_method), updated_at = ?
                  ${withFund ? ', fund_id = (SELECT id FROM finance_funds WHERE id = ? AND company_id = ?)' : ''}
                  WHERE id = ? AND company_id = ? AND status = 'pending'`,
            args: [amount, paidAt, method, timestamp, ...(withFund ? [data.fund_id || null, companyId] : []), id, companyId],
        });
        return Number(res.rowsAffected) > 0
            ? { success: true }
            : { success: false, error: 'Esta cuenta ya no está pendiente. Actualiza la página.' };
    };

    if (data?.id) return marcarPagado(data.id);

    const periodKey = String(data?.period_key || '');
    if (!data?.recurring_expense_id || !/^\d{4}-\d{2}$/.test(periodKey)) {
        return { success: false, error: 'Falta indicar qué cuenta se paga' };
    }
    const [templateRes, existingRes] = await Promise.all([
        turso.execute({
            sql: 'SELECT * FROM recurring_expenses WHERE id = ? AND company_id = ?',
            args: [data.recurring_expense_id, companyId],
        }),
        turso.execute({
            sql: `SELECT id, status FROM business_expenses
                  WHERE company_id = ? AND recurring_expense_id = ? AND period_key = ? AND status != 'cancelled'
                  LIMIT 1`,
            args: [companyId, data.recurring_expense_id, periodKey],
        }),
    ]);
    const template = templateRes.rows[0];
    if (!template) return { success: false, error: 'Cuenta mensual no encontrada' };
    const existing = existingRes.rows[0];
    // Dos pestañas abiertas o un doble clic: no se paga dos veces el mismo mes.
    if (existing?.status === 'paid') return { success: false, error: 'Esta cuenta ya está pagada este mes' };
    if (existing) return marcarPagado(existing.id);

    const dueDate = clampDueDay(periodKey, template.due_day);
    return expenseSave(turso, companyId, session, {
        data: {
            recurring_expense_id: template.id,
            category_id: template.category_id,
            period_key: periodKey,
            description: template.description,
            supplier: template.supplier,
            amount,
            // En la lista de gastos sale en el mes de la cuenta: si se paga en
            // otro mes (adelantado o atrasado), con la fecha de vencimiento.
            expense_date: paidAt.startsWith(periodKey) ? paidAt : dueDate,
            due_date: dueDate,
            paid_at: paidAt,
            status: 'paid',
            payment_method: method || template.payment_method,
            notes: null,
            ...(withFund ? { fund_id: data.fund_id } : {}),
        },
    });
}

// ── Fondos: caja chica, capital… (migración 0041) ──
// La plata apartada para pagar los gastos del local, aparte de la caja de
// ventas (Kevin, 14-nov-2026). El saldo se calcula: aportes − retiros − gastos
// pagados con el fondo (ver loadFunds).

async function fundSave(turso, companyId, session, { data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    const name = String(data?.name || '').trim().slice(0, 60);
    if (!name) return { success: false, error: 'Ingresa el nombre del fondo' };
    const timestamp = nowIso();
    if (data.id) {
        await turso.execute({
            sql: 'UPDATE finance_funds SET name = ?, active = ?, updated_at = ? WHERE id = ? AND company_id = ?',
            args: [name, data.active === false || Number(data.active) === 0 ? 0 : 1, timestamp, data.id, companyId],
        });
        return { success: true };
    }
    const insertFund = {
        sql: `INSERT INTO finance_funds (company_id, name, active, created_by, created_at, updated_at)
              VALUES (?, ?, 1, ?, ?, ?)`,
        args: [companyId, name, session?.uid || null, timestamp, timestamp],
    };
    const initial = asNumber(data.initial_amount);
    if (initial <= 0) {
        await turso.execute(insertFund);
        return { success: true };
    }
    const date = validDate(data.movement_date) || formatDate(new Date());
    if (date > tomorrowUtc()) return { success: false, error: 'La fecha no puede ser futura' };
    // Mismo batch = misma conexión: last_insert_rowid() es el fondo recién creado.
    await turso.batch([insertFund, {
        sql: `INSERT INTO finance_fund_movements
              (company_id, fund_id, kind, amount, movement_date, description, created_by, created_at)
              VALUES (?, last_insert_rowid(), 'deposit', ?, ?, 'Saldo inicial', ?, ?)`,
        args: [companyId, initial, date, session?.uid || null, timestamp],
    }], 'write');
    return { success: true };
}

async function fundMovementAdd(turso, companyId, session, { data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    const kind = ['deposit', 'withdrawal'].includes(data?.kind) ? data.kind : null;
    if (!kind) return { success: false, error: 'Movimiento no válido' };
    const amount = asNumber(data?.amount);
    if (amount <= 0) return { success: false, error: 'El monto debe ser mayor que cero' };
    const date = validDate(data?.movement_date) || formatDate(new Date());
    if (date > tomorrowUtc()) return { success: false, error: 'La fecha no puede ser futura' };
    const fund = await turso.execute({
        sql: 'SELECT id FROM finance_funds WHERE id = ? AND company_id = ? AND active = 1',
        args: [data?.fund_id, companyId],
    });
    if (!fund.rows[0]) return { success: false, error: 'Fondo no encontrado' };
    await turso.execute({
        sql: `INSERT INTO finance_fund_movements
              (company_id, fund_id, kind, amount, movement_date, description, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [companyId, fund.rows[0].id, kind, amount, date,
            String(data?.description || '').trim().slice(0, 200) || null, session?.uid || null, nowIso()],
    });
    return { success: true };
}

async function fundMovementDelete(turso, companyId, session, { id }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    await turso.execute({ sql: 'DELETE FROM finance_fund_movements WHERE id = ? AND company_id = ?', args: [id, companyId] });
    return { success: true };
}

// Historial de un fondo: aportes y retiros, y los gastos pagados con él.
async function fundMovements(turso, companyId, session, { fundId }) {
    const res = await turso.execute({
        sql: `SELECT 'movement' source, id, kind, amount, movement_date date, description, created_at
              FROM finance_fund_movements WHERE company_id = ? AND fund_id = ?
              UNION ALL
              SELECT 'expense' source, id, 'expense' kind, amount, COALESCE(paid_at, expense_date) date, description, created_at
              FROM business_expenses WHERE company_id = ? AND fund_id = ? AND status = 'paid'
              ORDER BY date DESC, created_at DESC
              LIMIT 200`,
        args: [companyId, fundId, companyId, fundId],
    });
    return {
        success: true,
        movements: res.rows.map(row => ({
            source: row.source, id: row.id, kind: row.kind, amount: asNumber(row.amount),
            date: dateOnly(row.date), description: row.description || '',
        })),
    };
}

async function expenseDelete(turso, companyId, session, { id }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    await turso.execute({ sql: 'DELETE FROM business_expenses WHERE id = ? AND company_id = ?', args: [id, companyId] });
    return { success: true };
}

async function recurringSave(turso, companyId, session, { data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    if (!String(data?.description || '').trim()) return { success: false, error: 'Ingresa una descripción' };
    if (asNumber(data?.amount) <= 0) return { success: false, error: 'El monto debe ser mayor que cero' };
    if (!dateOnly(data?.start_date)) return { success: false, error: 'Ingresa la fecha de inicio' };
    const timestamp = nowIso();
    if (data.id) {
        await turso.execute({
            sql: `UPDATE recurring_expenses SET category_id = ?, description = ?, supplier = ?, amount = ?,
                  start_date = ?, end_date = ?, due_day = ?, payment_method = ?, active = ?, notes = ?, updated_at = ?
                  WHERE id = ? AND company_id = ?`,
            args: [data.category_id || null, String(data.description).trim(), data.supplier || null,
                asNumber(data.amount), dateOnly(data.start_date), dateOnly(data.end_date) || null,
                Math.min(31, Math.max(1, Number(data.due_day) || 1)), data.payment_method || null,
                data.active === false || Number(data.active) === 0 ? 0 : 1, data.notes || null,
                timestamp, data.id, companyId],
        });
    } else {
        await turso.execute({
            sql: `INSERT INTO recurring_expenses
                  (company_id, category_id, description, supplier, amount, frequency, start_date,
                   end_date, due_day, payment_method, active, notes, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            args: [companyId, data.category_id || null, String(data.description).trim(),
                data.supplier || null, asNumber(data.amount), dateOnly(data.start_date),
                dateOnly(data.end_date) || null, Math.min(31, Math.max(1, Number(data.due_day) || 1)),
                data.payment_method || null, data.notes || null, session?.uid || null, timestamp, timestamp],
        });
    }
    return { success: true };
}

async function recurringDelete(turso, companyId, session, { id }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    await turso.execute({
        sql: 'UPDATE recurring_expenses SET active = 0, updated_at = ? WHERE id = ? AND company_id = ?',
        args: [nowIso(), id, companyId],
    });
    return { success: true };
}

async function recurringRegisterPeriod(turso, companyId, session, { id, data }) {
    const denied = await requireManage(turso, companyId, session);
    if (denied) return denied;
    const templateRes = await turso.execute({
        sql: 'SELECT * FROM recurring_expenses WHERE id = ? AND company_id = ?',
        args: [id, companyId],
    });
    const template = templateRes.rows[0];
    if (!template) return { success: false, error: 'Cuenta mensual no encontrada' };
    return expenseSave(turso, companyId, session, {
        data: {
            recurring_expense_id: template.id,
            category_id: template.category_id,
            period_key: data.period_key,
            description: template.description,
            supplier: template.supplier,
            amount: data.amount ?? template.amount,
            expense_date: data.expense_date,
            due_date: data.due_date,
            status: data.status || 'paid',
            payment_method: data.payment_method || template.payment_method,
            notes: data.notes,
        },
    });
}

export const financeActions = {
    financeBootstrap,
    categoryCreate,
    expenseSave,
    expensePay,
    expenseDelete,
    recurringSave,
    recurringDelete,
    recurringRegisterPeriod,
    fundSave,
    fundMovementAdd,
    fundMovementDelete,
    fundMovements,
};
