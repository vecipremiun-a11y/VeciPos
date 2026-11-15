import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowDown, ArrowUp, Building2, CalendarDays, CheckCircle2, CircleDollarSign, Clock3, Download,
    Edit3, Gauge, Plus, Receipt, RefreshCw, Trash2, TrendingDown, TrendingUp, WalletCards, X
} from 'lucide-react';
import {
    Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import * as XLSX from 'xlsx';
import { useStore } from '../store/useStore';
import { dataApiCall } from '../lib/dataApi';
import { formatCurrency } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';
import { guardarExcel } from '../lib/descargas';
import InputMonto from '../components/InputMonto';

// Fecha de hoy en la hora del local (con toISOString, en Chile pasadas las
// 21:00 ya era mañana y a fin de mes, el mes siguiente).
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const currentMonth = () => today().slice(0, 7);
const monthRange = (month) => {
    const [year, value] = month.split('-').map(Number);
    return {
        start: `${month}-01`,
        end: new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10),
    };
};

const emptyExpense = () => ({
    description: '',
    supplier: '',
    category_id: '',
    recurring_expense_id: '',
    amount: '',
    expense_date: today(),
    due_date: '',
    status: 'paid',
    payment_method: '',
    notes: '',
});

const emptyRecurring = () => ({
    description: '',
    supplier: '',
    category_id: '',
    amount: '',
    start_date: `${currentMonth()}-01`,
    end_date: '',
    due_day: '1',
    payment_method: '',
    active: true,
    notes: '',
});

const money = (value, currency) => formatCurrency(Number(value) || 0, currency);

// 2026-11-09 → 09-11-2026
const fechaCorta = (iso) => {
    const [y, m, d] = String(iso || '').slice(0, 10).split('-');
    return y && m && d ? `${d}-${m}-${y}` : '';
};

// '2026-10' → 'octubre de 2026' / 'oct.'
const mesLargo = (periodKey) => {
    const [y, m] = String(periodKey || '').split('-').map(Number);
    return y && m ? new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }) : '';
};
const mesCorto = (periodKey) => {
    const [y, m] = String(periodKey || '').split('-').map(Number);
    return y && m ? new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'short' }) : '';
};

// Botón «Pagar»: medios de pago de un toque. Si la cuenta ya traía otro
// (p. ej. «PAC Banco»), se agrega como opción más.
const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Débito', 'Crédito'];
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const mediosPara = (actual) => (
    actual && !MEDIOS_PAGO.some((m) => sinTildes(m) === sinTildes(actual)) ? [...MEDIOS_PAGO, actual] : MEDIOS_PAGO
);
const medioCanonico = (actual) => MEDIOS_PAGO.find((m) => sinTildes(m) === sinTildes(actual)) || String(actual || '').trim();

// % de variación vs el mes anterior; null cuando no hay base de comparación
const deltaPct = (current, previous) => {
    const prev = Number(previous);
    if (!Number.isFinite(prev) || prev === 0) return null;
    return (Number(current || 0) - prev) / Math.abs(prev) * 100;
};

function MetricCard({ title, value, icon, tone = 'text-[var(--color-text)]', subtitle, delta }) {
    return (
        <div className="glass-card p-4 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">{title}</span>
                {React.createElement(icon, { size: 17, className: tone })}
            </div>
            <p className={`text-xl font-bold ${tone}`}>{value}</p>
            {delta !== null && delta !== undefined && (
                <p className={`text-[11px] flex items-center gap-1 ${delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {delta >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                    {Math.abs(delta).toFixed(1)}% vs mes anterior
                </p>
            )}
            {subtitle && <p className="text-[11px] text-[var(--color-text-muted)]">{subtitle}</p>}
        </div>
    );
}

function Field({ label, children }) {
    return (
        <label className="space-y-1.5 text-sm text-[var(--color-text)]">
            <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
            {children}
        </label>
    );
}

const inputClass = 'w-full px-3 py-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]';

function Modal({ title, onClose, children, angosto = false }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
            <div className={`w-full ${angosto ? 'max-w-md' : 'max-w-2xl'} max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-[var(--color-background)] shadow-2xl`}>
                <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-[var(--glass-border)] bg-[var(--color-background)]">
                    <h2 className="font-bold text-lg text-[var(--color-text)]">{title}</h2>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]"><X size={18} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

export default function Administration() {
    const activeCompanyId = useStore(state => state.activeCompanyId);
    const currentCurrency = useStore(state => state.currentCurrency);
    const { can } = usePermissions();
    const canManage = can('finance.manage');
    const [month, setMonth] = useState(currentMonth());
    const [tab, setTab] = useState('summary');
    const [data, setData] = useState({
        categories: [], expenses: [], recurring: [], summary: null,
        previousSummary: null, dailySeries: [], obligations: [], fixedCosts: null,
        // null = la base todavía no tiene fondos (migración 0041): no se muestran.
        funds: null,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [expenseForm, setExpenseForm] = useState(null);
    const [recurringForm, setRecurringForm] = useState(null);
    const [pago, setPago] = useState(null);
    const [fundForm, setFundForm] = useState(null);
    const [movForm, setMovForm] = useState(null);
    const [fondoAbierto, setFondoAbierto] = useState(null);
    const [movimientos, setMovimientos] = useState(null);
    const [categoryName, setCategoryName] = useState('');

    const load = useCallback(async () => {
        if (!activeCompanyId) return;
        setLoading(true);
        setError('');
        const range = monthRange(month);
        const result = await dataApiCall('finance.financeBootstrap', {
            companyId: activeCompanyId,
            startDate: range.start,
            endDate: range.end,
        });
        if (result?.success) {
            setData({
                categories: result.categories || [],
                expenses: result.expenses || [],
                recurring: result.recurring || [],
                summary: result.summary || null,
                previousSummary: result.previousSummary || null,
                dailySeries: result.dailySeries || [],
                obligations: result.obligations || [],
                fixedCosts: result.fixedCosts || null,
                funds: Array.isArray(result.funds) ? result.funds : null,
            });
        } else {
            setError(result?.error || 'No se pudo cargar la administración financiera');
        }
        setLoading(false);
    }, [activeCompanyId, month]);

    useEffect(() => { load(); }, [load]);

    const mutate = async (action, payload, onSuccess) => {
        setSaving(true);
        setError('');
        const result = await dataApiCall(`finance.${action}`, { companyId: activeCompanyId, ...payload });
        if (result?.success) {
            onSuccess?.();
            await load();
        } else {
            setError(result?.error || 'No se pudo guardar');
        }
        setSaving(false);
    };

    const selectedMonthExpenses = useMemo(
        () => data.expenses.filter(item => String(item.expense_date || '').startsWith(month)),
        [data.expenses, month]
    );

    // Punto de equilibrio: cuánto vender/ganar por día para cubrir los costos fijos
    const breakEven = useMemo(() => {
        const summary = data.summary;
        const monthlyFixed = data.fixedCosts?.monthlyFixed || 0;
        if (!summary) return null;
        const [year, value] = month.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(year, value, 0)).getUTCDate();
        const nowMonth = currentMonth();
        const elapsedDays = month === nowMonth
            ? Number(today().slice(8, 10))
            : month < nowMonth ? daysInMonth : 0;

        const dailyFixedCost = monthlyFixed / daysInMonth;
        const currentMargin = summary.revenue > 0 ? summary.grossProfit / summary.revenue : null;
        const previousMargin = data.previousSummary?.revenue > 0
            ? data.previousSummary.grossProfit / data.previousSummary.revenue
            : null;
        const marginRatio = currentMargin ?? previousMargin;
        const requiredDailySales = marginRatio > 0 ? dailyFixedCost / marginRatio : null;
        const avgDailySales = elapsedDays > 0 ? summary.revenue / elapsedDays : 0;
        const avgDailyGross = elapsedDays > 0 ? summary.grossProfit / elapsedDays : 0;
        const coveragePct = monthlyFixed > 0 && elapsedDays > 0
            ? summary.grossProfit / (dailyFixedCost * elapsedDays) * 100
            : null;

        return {
            daysInMonth, elapsedDays, monthlyFixed, dailyFixedCost,
            marginRatio, requiredDailySales, avgDailySales, avgDailyGross, coveragePct,
        };
    }, [data.summary, data.previousSummary, data.fixedCosts, month]);

    // Serie del gráfico: días 1..fin de mes, utilidad bruta acumulada vs costo fijo acumulado
    const chartData = useMemo(() => {
        if (!breakEven) return [];
        const byDay = new Map(data.dailySeries.map(item => [item.day, item]));
        const rows = [];
        let cumGross = 0;
        for (let dayNum = 1; dayNum <= breakEven.daysInMonth; dayNum += 1) {
            const key = `${month}-${String(dayNum).padStart(2, '0')}`;
            const item = byDay.get(key);
            cumGross += item?.grossProfit || 0;
            rows.push({
                name: String(dayNum),
                ventas: Math.round(item?.revenue || 0),
                utilidadAcum: Math.round(cumGross),
                fijoAcum: Math.round(breakEven.dailyFixedCost * dayNum),
            });
        }
        return rows;
    }, [data.dailySeries, breakEven, month]);

    const obligationsTotal = useMemo(
        () => data.obligations.reduce((acc, item) => acc + (Number(item.amount) || 0), 0),
        [data.obligations]
    );

    const exportExpenses = () => {
        const rows = selectedMonthExpenses.map(item => ({
            'Fecha': item.expense_date,
            'Descripción': item.description,
            'Categoría': item.category_name || 'Sin categoría',
            'Proveedor': item.supplier || '',
            'Monto': Number(item.amount) || 0,
            'Estado': item.status === 'paid' ? 'Pagado' : 'Pendiente',
            'Vencimiento': item.due_date || '',
            'Medio de pago': item.payment_method || '',
            'Cuenta mensual': item.recurring_expense_id ? 'Sí' : 'No',
            'Notas': item.notes || '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
        guardarExcel(XLSX, wb, `Gastos_${month}.xlsx`);
    };

    // Fondos (caja chica, capital…) en uso. null = la base todavía no los tiene.
    const fondosOn = data.funds !== null;
    const fondosActivos = useMemo(() => (data.funds || []).filter(f => f.active), [data.funds]);
    const nombreFondo = (id) => (data.funds || []).find(f => String(f.id) === String(id))?.name;

    // «Pagar»: acceso rápido para pagar una cuenta del local (Kevin,
    // 14-nov-2026). Se cambia el monto (el del recurrente es un estimado), el
    // medio de pago, de qué fondo sale y, si se anota después, la fecha real
    // del pago (por defecto hoy). El vencimiento no se toca.
    // `item` es una fila de Vencimientos: un recurrente de un mes o un gasto
    // anotado como pendiente.
    const abrirPago = (item) => {
        const origen = item.kind === 'recurring'
            ? data.recurring.find(r => String(r.id) === String(item.templateId))
            : data.expenses.find(e => String(e.id) === String(item.id));
        // Fondo: el del último pago de esta cuenta (o el del pendiente); si no,
        // el único que haya.
        const previo = item.kind === 'recurring'
            ? data.expenses.find(e => String(e.recurring_expense_id) === String(item.templateId) && e.fund_id)
            : origen;
        const fondo = fondosActivos.some(f => String(f.id) === String(previo?.fund_id))
            ? previo.fund_id
            : fondosActivos.length === 1 ? fondosActivos[0].id : null;
        setError('');
        setPago({
            ...item, monto: item.amount, metodo: medioCanonico(origen?.payment_method),
            fecha: today(), cambiarFecha: false, fondo,
        });
    };

    // La fila de Vencimientos de un recurrente: la del mes, o un pago suyo que
    // quedó anotado como pendiente.
    const vencimientoDe = (templateId) => (
        data.obligations.find(o => o.kind === 'recurring' && String(o.templateId) === String(templateId))
        || data.obligations.find(o => o.kind === 'expense' && String(o.recurringExpenseId) === String(templateId))
    );

    const pagar = (event) => {
        event.preventDefault();
        if (!(Number(pago.monto) > 0)) return;
        mutate('expensePay', {
            data: {
                ...(pago.kind === 'recurring'
                    ? { recurring_expense_id: pago.templateId, period_key: pago.periodKey }
                    : { id: pago.id }),
                amount: pago.monto,
                payment_method: pago.metodo,
                paid_at: pago.fecha || today(),
                ...(fondosOn ? { fund_id: pago.fondo ?? null } : {}),
            },
        }, () => setPago(null));
    };

    // Registrar / editar gasto: el fondo solo viaja si la base ya tiene fondos.
    const guardarGasto = (event) => {
        event.preventDefault();
        const { fund_id: fondo, ...resto } = expenseForm;
        mutate('expenseSave', { data: fondosOn ? { ...resto, fund_id: fondo || null } : resto }, () => setExpenseForm(null));
    };

    // Historial del fondo abierto; se vuelve a pedir tras cada cambio (cuando
    // cambian los saldos).
    useEffect(() => {
        if (!fondoAbierto) { setMovimientos(null); return; }
        let vigente = true;
        dataApiCall('finance.fundMovements', { companyId: activeCompanyId, fundId: fondoAbierto }).then((r) => {
            if (vigente) setMovimientos(r?.success ? r.movements : []);
        });
        return () => { vigente = false; };
    }, [fondoAbierto, data.funds, activeCompanyId]);

    const summary = data.summary;

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Building2 className="text-[var(--color-primary)]" /> Administración
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        Gastos, compromisos y utilidad operacional de la empresa activa.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <input type="month" value={month} onChange={event => setMonth(event.target.value)} className={inputClass} />
                    {canManage && <button onClick={() => setExpenseForm(emptyExpense())} className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-black font-bold flex items-center gap-2">
                        <Plus size={17} /> Registrar gasto
                    </button>}
                </div>
            </div>

            {error && <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>}

            <div className="flex gap-1 overflow-x-auto border-b border-[var(--glass-border)]">
                {[
                    ['summary', 'Resumen'],
                    ['expenses', 'Gastos'],
                    ['recurring', 'Cuentas mensuales'],
                    ...(fondosOn ? [['funds', 'Fondos']] : []),
                    ['categories', 'Categorías'],
                ].map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 whitespace-nowrap border-b-2 text-sm ${tab === id ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)]'}`}>
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="py-20 flex justify-center text-[var(--color-text-muted)]"><RefreshCw className="animate-spin" /></div>
            ) : (
                <>
                    {tab === 'summary' && summary && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                                <MetricCard title="Ventas del período" value={money(summary.revenue, currentCurrency)} icon={WalletCards} delta={deltaPct(summary.revenue, data.previousSummary?.revenue)} />
                                <MetricCard title="Costo de productos" value={money(summary.productCost, currentCurrency)} icon={TrendingDown} tone="text-orange-400" delta={deltaPct(summary.productCost, data.previousSummary?.productCost)} />
                                <MetricCard title="Utilidad bruta" value={money(summary.grossProfit, currentCurrency)} icon={TrendingUp} tone="text-cyan-400" subtitle="Antes de gastos operacionales" delta={deltaPct(summary.grossProfit, data.previousSummary?.grossProfit)} />
                                <MetricCard title="Utilidad operacional" value={money(summary.netOperatingProfit, currentCurrency)} icon={CircleDollarSign} tone={summary.netOperatingProfit >= 0 ? 'text-green-400' : 'text-red-400'} subtitle="Después de personal y otros gastos" delta={deltaPct(summary.netOperatingProfit, data.previousSummary?.netOperatingProfit)} />
                            </div>

                            {breakEven && (
                                <div className="glass-card p-5">
                                    <h2 className="font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                                        <Gauge size={18} className="text-[var(--color-primary)]" /> Pulso del mes
                                    </h2>
                                    {breakEven.monthlyFixed <= 0 ? (
                                        <p className="text-sm text-[var(--color-text-muted)]">
                                            Sin costos fijos registrados. Agrega cuentas mensuales o personal para calcular tu meta diaria.
                                        </p>
                                    ) : (
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            <div className="space-y-3">
                                                {breakEven.requiredDailySales !== null ? (
                                                    <div>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Meta de venta diaria para cubrir costos fijos</p>
                                                        <p className="text-3xl font-bold text-[var(--color-primary)]">{money(breakEven.requiredDailySales, currentCurrency)}</p>
                                                        <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                                                            Con tu margen bruto actual de {(breakEven.marginRatio * 100).toFixed(1)}%
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-amber-400">
                                                        Sin margen suficiente para estimar la venta necesaria. Meta expresada en utilidad bruta.
                                                    </p>
                                                )}
                                                <div className="text-sm space-y-1.5 pt-2 border-t border-[var(--glass-border)]">
                                                    <div className="flex justify-between">
                                                        <span className="text-[var(--color-text-muted)]">Meta de utilidad bruta diaria</span>
                                                        <span className="text-[var(--color-text)] font-medium">{money(breakEven.dailyFixedCost, currentCurrency)}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-[var(--color-text-muted)]">Costos fijos del mes (cuentas mensuales + personal)</span>
                                                        <span className="text-[var(--color-text)]">{money(breakEven.monthlyFixed, currentCurrency)}</span>
                                                    </div>
                                                    <div className="flex justify-between text-[11px]">
                                                        <span className="text-[var(--color-text-muted)] pl-3">Cuentas mensuales {money(data.fixedCosts?.recurring, currentCurrency)} · Personal {money(data.fixedCosts?.payroll, currentCurrency)}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-[var(--color-text-muted)]">Gastos variables del mes</span>
                                                        <span className="text-orange-400">{money(summary.oneOffExpenses, currentCurrency)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-3">
                                                {breakEven.elapsedDays > 0 ? (
                                                    <>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <p className="text-xs text-[var(--color-text-muted)]">Venta promedio diaria real</p>
                                                                <p className="text-xl font-bold text-[var(--color-text)]">{money(breakEven.avgDailySales, currentCurrency)}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs text-[var(--color-text-muted)]">Utilidad bruta promedio diaria</p>
                                                                <p className="text-xl font-bold text-cyan-400">{money(breakEven.avgDailyGross, currentCurrency)}</p>
                                                            </div>
                                                        </div>
                                                        {breakEven.coveragePct !== null && (
                                                            <div className="space-y-1.5">
                                                                <div className="flex justify-between text-xs">
                                                                    <span className="text-[var(--color-text-muted)]">Cobertura de costos fijos ({breakEven.elapsedDays} de {breakEven.daysInMonth} días)</span>
                                                                    <span className={`font-bold ${breakEven.coveragePct >= 100 ? 'text-green-400' : breakEven.coveragePct >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                                                                        {breakEven.coveragePct.toFixed(0)}% cubierto
                                                                    </span>
                                                                </div>
                                                                <div className="h-2 bg-black/20 rounded-full overflow-hidden">
                                                                    <div
                                                                        className={`h-full rounded-full ${breakEven.coveragePct >= 100 ? 'bg-green-400' : breakEven.coveragePct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                                                                        style={{ width: `${Math.max(0, Math.min(100, breakEven.coveragePct))}%` }}
                                                                    />
                                                                </div>
                                                                <span className={`inline-block text-[11px] px-2 py-1 rounded-full ${breakEven.coveragePct >= 100 ? 'bg-green-500/10 text-green-400' : summary.netOperatingProfit < 0 ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                                    {breakEven.coveragePct >= 100 ? 'Cubriendo costos fijos' : summary.netOperatingProfit < 0 ? 'En pérdida operacional' : 'Bajo la meta'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <p className="text-sm text-[var(--color-text-muted)]">Mes futuro: se muestran solo las metas.</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {chartData.length > 0 && breakEven?.monthlyFixed > 0 && (
                                <div className="glass-card p-5">
                                    <h2 className="font-semibold text-[var(--color-text)] mb-1">Evolución diaria</h2>
                                    <p className="text-xs text-[var(--color-text-muted)] mb-4">
                                        Donde la utilidad bruta acumulada cruza la línea de costos fijos, ya cubriste el mes.
                                    </p>
                                    <div className="h-[320px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                                                <XAxis dataKey="name" stroke="#888" tick={{ fill: '#888', fontSize: 11 }} />
                                                <YAxis stroke="#888" tick={{ fill: '#888', fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                                                    formatter={(value, name) => [money(value, currentCurrency), name]}
                                                    labelFormatter={label => `Día ${label}`}
                                                />
                                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                                <Bar dataKey="ventas" name="Ventas del día" fill="var(--color-primary)" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                                                <Line type="monotone" dataKey="utilidadAcum" name="Utilidad bruta acumulada" stroke="#22d3ee" strokeWidth={3} dot={false} />
                                                <Line type="monotone" dataKey="fijoAcum" name="Costos fijos acumulados" stroke="#f87171" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                <div className="glass-card p-5 lg:col-span-2">
                                    <h2 className="font-semibold text-[var(--color-text)] mb-4">Composición del resultado</h2>
                                    <div className="space-y-3 text-sm">
                                        {[
                                            ['Utilidad bruta', summary.grossProfit, 'text-cyan-400'],
                                            ['Otros gastos', -summary.oneOffExpenses, 'text-orange-400'],
                                            ['Cuentas mensuales', -summary.recurringExpenses, 'text-purple-400'],
                                            ['Costo de personal asignado', -summary.payrollExpense, 'text-emerald-400'],
                                            ['Utilidad operacional', summary.netOperatingProfit, summary.netOperatingProfit >= 0 ? 'text-green-400' : 'text-red-400'],
                                        ].map(([label, value, tone], index) => (
                                            <div key={label} className={`flex justify-between py-2 ${index === 4 ? 'border-t border-[var(--glass-border)] font-bold pt-4' : ''}`}>
                                                <span className="text-[var(--color-text-muted)]">{label}</span>
                                                <span className={tone}>{money(value, currentCurrency)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="glass-card p-5">
                                    <h2 className="font-semibold text-[var(--color-text)] mb-4">Gastos por categoría</h2>
                                    <div className="space-y-3">
                                        {(summary.categories || []).map(item => {
                                            const width = summary.totalExpenses > 0 ? Math.min(100, item.amount / summary.totalExpenses * 100) : 0;
                                            return (
                                                <div key={item.name}>
                                                    <div className="flex justify-between text-xs mb-1">
                                                        <span className="text-[var(--color-text-muted)]">{item.name}</span>
                                                        <span className="text-[var(--color-text)]">{money(item.amount, currentCurrency)}</span>
                                                    </div>
                                                    <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
                                                        <div className="h-full bg-[var(--color-primary)] rounded-full" style={{ width: `${width}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {!summary.categories?.length && <p className="text-sm text-[var(--color-text-muted)]">No hay gastos en este período.</p>}
                                    </div>
                                </div>
                            </div>

                            <div className="glass-card overflow-hidden">
                                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <Clock3 className="text-amber-400" />
                                        <div>
                                            <p className="font-medium text-[var(--color-text)]">Vencimientos</p>
                                            <p className="text-xs text-[var(--color-text-muted)]">Cuentas mensuales y gastos pendientes por pagar.</p>
                                        </div>
                                    </div>
                                    <span className="font-bold text-amber-400">{money(obligationsTotal, currentCurrency)}</span>
                                </div>
                                <div className="divide-y divide-[var(--glass-border)]">
                                    {data.obligations.map(item => {
                                        const overdue = item.dueDate < today();
                                        return (
                                            <div key={`${item.kind}-${item.id || item.templateId}-${item.periodKey || ''}`} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div className="flex items-start gap-3 min-w-0">
                                                    <CalendarDays size={18} className={`mt-1 shrink-0 ${overdue ? 'text-red-400' : 'text-amber-400'}`} />
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-[var(--color-text)] truncate">{item.description}</p>
                                                        <p className="text-xs text-[var(--color-text-muted)]">
                                                            Vence {item.dueDate} · {item.categoryName || 'Sin categoría'} {item.supplier ? `· ${item.supplier}` : ''}
                                                            {item.kind === 'recurring' ? ' · cuenta mensual, monto estimado' : ''}
                                                            {/* Un recurrente de un mes anterior que quedó sin pagar. */}
                                                            {item.kind === 'recurring' && item.periodKey !== month ? ` · cuenta de ${mesLargo(item.periodKey)}` : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between sm:justify-end gap-3">
                                                    <span className={`text-xs px-2 py-1 rounded-full ${overdue ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                        {overdue ? 'Vencido' : 'Por vencer'}
                                                    </span>
                                                    <strong className="text-[var(--color-text)]">{money(item.amount, currentCurrency)}</strong>
                                                    {canManage && (
                                                        <button
                                                            data-prueba="pagar"
                                                            onClick={() => abrirPago(item)}
                                                            className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold flex items-center gap-1"
                                                        >
                                                            <CircleDollarSign size={13} /> Pagar
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {!data.obligations.length && (
                                        <p className="p-8 text-center text-sm text-[var(--color-text-muted)]">Sin vencimientos pendientes. Todo al día.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === 'expenses' && (
                        <div className="glass-card overflow-hidden">
                            <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center gap-3">
                                <div className="min-w-0">
                                    <h2 className="font-semibold text-[var(--color-text)]">Gastos de {mesLargo(month)}</h2>
                                    <p className="text-xs text-[var(--color-text-muted)]">Lo que pagaste o tienes por pagar este mes. Las cuentas mensuales aparecen aquí cuando las pagas.</p>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{selectedMonthExpenses.length} {selectedMonthExpenses.length === 1 ? 'registro' : 'registros'}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={exportExpenses}
                                        disabled={!selectedMonthExpenses.length}
                                        title="Exportar a Excel"
                                        className="p-2 rounded-lg text-green-400 hover:bg-[var(--glass-bg)] disabled:opacity-30"
                                    >
                                        <Download size={20} />
                                    </button>
                                    {canManage && <button onClick={() => setExpenseForm(emptyExpense())} className="p-2 rounded-lg text-[var(--color-primary)] hover:bg-[var(--glass-bg)]"><Plus /></button>}
                                </div>
                            </div>
                            <div className="divide-y divide-[var(--glass-border)]">
                                {selectedMonthExpenses.map(item => (
                                    <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <Receipt size={18} className="text-[var(--color-primary)] mt-1 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="font-medium text-[var(--color-text)] truncate">{item.description}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">
                                                    {item.expense_date} · {item.category_name || 'Sin categoría'} {item.supplier ? `· ${item.supplier}` : ''}
                                                    {/* Pagada antes o después del día de la cuenta. */}
                                                    {item.status === 'paid' && item.paid_at && String(item.paid_at).slice(0, 10) !== String(item.expense_date).slice(0, 10) ? ` · pagado el ${fechaCorta(item.paid_at)}` : ''}
                                                    {item.fund_id && nombreFondo(item.fund_id) ? ` · de ${nombreFondo(item.fund_id)}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between sm:justify-end gap-3">
                                            <span className={`text-xs px-2 py-1 rounded-full ${item.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                {item.status === 'paid' ? 'Pagado' : 'Pendiente'}
                                            </span>
                                            <strong className="text-[var(--color-text)]">{money(item.amount, currentCurrency)}</strong>
                                            {canManage && item.status === 'pending' && (
                                                <button
                                                    onClick={() => abrirPago({
                                                        kind: 'expense', id: item.id, description: item.description, supplier: item.supplier,
                                                        amount: Number(item.amount) || 0, categoryName: item.category_name,
                                                        dueDate: String(item.due_date || item.expense_date || '').slice(0, 10),
                                                    })}
                                                    className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold flex items-center gap-1"
                                                >
                                                    <CircleDollarSign size={13} /> Pagar
                                                </button>
                                            )}
                                            {canManage && <button onClick={() => setExpenseForm({ ...item, category_id: String(item.category_id || ''), recurring_expense_id: String(item.recurring_expense_id || '') })} className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"><Edit3 size={16} /></button>}
                                            {canManage && <button onClick={() => window.confirm('¿Eliminar este gasto?') && mutate('expenseDelete', { id: item.id })} className="text-[var(--color-text-muted)] hover:text-red-400"><Trash2 size={16} /></button>}
                                        </div>
                                    </div>
                                ))}
                                {!selectedMonthExpenses.length && <p className="p-10 text-center text-sm text-[var(--color-text-muted)]">No hay gastos registrados para este mes.</p>}
                            </div>
                        </div>
                    )}

                    {tab === 'recurring' && (
                        <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <p className="text-sm text-[var(--color-text-muted)]">Cuentas que se repiten todos los meses, como arriendo, luz o internet. El monto es estimado; el real lo pones al pagar.</p>
                                {canManage && <button onClick={() => setRecurringForm(emptyRecurring())} className="shrink-0 px-4 py-2 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] flex items-center justify-center gap-2"><Plus size={16} /> Nueva cuenta mensual</button>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {data.recurring.map(item => {
                                    // Del mes elegido arriba: por pagar (botón), ya pagado, o
                                    // nada si el recurrente no corre ese mes.
                                    const porPagar = Number(item.active) === 1 ? vencimientoDe(item.id) : null;
                                    const pagado = !porPagar && data.expenses.find(e =>
                                        String(e.recurring_expense_id) === String(item.id) && e.period_key === month && e.status === 'paid');
                                    return (
                                    <div key={item.id} className={`glass-card p-5 space-y-4 ${Number(item.active) ? '' : 'opacity-50'}`}>
                                        <div className="flex justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-[var(--color-text)]">{item.description}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">{item.category_name || 'Sin categoría'} · vence día {item.due_day || 1}</p>
                                            </div>
                                            <CalendarDays className="text-purple-400 shrink-0" size={20} />
                                        </div>
                                        <p className="text-2xl font-bold text-[var(--color-text)]">{money(item.amount, currentCurrency)}<span className="text-xs font-normal text-[var(--color-text-muted)]"> / mes</span></p>
                                        <div className="flex gap-2">
                                            {/* Si quedó uno sin pagar de un mes anterior, se paga primero ese. */}
                                            {canManage && porPagar && <button onClick={() => abrirPago(porPagar)} className="flex-1 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold flex justify-center items-center gap-1"><CircleDollarSign size={14} /> Pagar{porPagar.periodKey && porPagar.periodKey !== month ? ` ${mesCorto(porPagar.periodKey)}` : ''}</button>}
                                            {pagado && <span className="flex-1 px-3 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] text-xs flex justify-center items-center gap-1"><CheckCircle2 size={14} className="text-green-400" /> Pagado {money(pagado.amount, currentCurrency)}{pagado.paid_at ? ` el ${fechaCorta(pagado.paid_at)}` : ''}</span>}
                                            {canManage && <button onClick={() => setRecurringForm({ ...item, category_id: String(item.category_id || ''), active: Number(item.active) === 1 })} className="p-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)]"><Edit3 size={15} /></button>}
                                            {canManage && Number(item.active) === 1 && <button onClick={() => window.confirm('¿Desactivar esta cuenta mensual?') && mutate('recurringDelete', { id: item.id })} className="p-2 rounded-lg border border-[var(--glass-border)] text-red-400"><Trash2 size={15} /></button>}
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Fondos: caja chica, capital… plata apartada para pagar los gastos
                        del local, aparte de la caja de ventas (Kevin, 14-nov-2026). */}
                    {tab === 'funds' && fondosOn && (
                        <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <p className="text-sm text-[var(--color-text-muted)]">
                                    Plata apartada para pagar los gastos del local. No se mezcla con la caja de ventas.
                                </p>
                                {canManage && (
                                    <button onClick={() => setFundForm({ name: '', initial_amount: 0, movement_date: today() })} className="px-4 py-2 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] flex items-center justify-center gap-2 shrink-0">
                                        <Plus size={16} /> Nuevo fondo
                                    </button>
                                )}
                            </div>
                            {!data.funds.length && (
                                <div className="glass-card p-8 text-center text-sm text-[var(--color-text-muted)]">
                                    Sin fondos todavía. Ej: «Caja chica» con la plata que tienes apartada para las cuentas.
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {data.funds.map(f => (
                                    <div key={f.id} data-prueba="fondo" className={`glass-card p-5 space-y-4 ${f.active ? '' : 'opacity-50'} ${String(fondoAbierto) === String(f.id) ? 'ring-1 ring-[var(--color-primary)]' : ''}`}>
                                        <div className="flex justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-semibold text-[var(--color-text)] truncate">{f.name}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">{f.active ? 'Saldo disponible' : 'Archivado'}</p>
                                            </div>
                                            <WalletCards className="text-[var(--color-primary)] shrink-0" size={20} />
                                        </div>
                                        <p data-prueba="saldo-fondo" className={`text-2xl font-bold ${f.balance < 0 ? 'text-red-400' : 'text-[var(--color-text)]'}`}>{money(f.balance, currentCurrency)}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {canManage && f.active && (
                                                <>
                                                    <button onClick={() => setMovForm({ fund: f, kind: 'deposit', amount: 0, movement_date: today(), description: '' })} className="flex-1 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold flex justify-center items-center gap-1">
                                                        <ArrowDown size={14} /> Agregar plata
                                                    </button>
                                                    <button onClick={() => setMovForm({ fund: f, kind: 'withdrawal', amount: 0, movement_date: today(), description: '' })} className="flex-1 px-3 py-2 rounded-lg bg-orange-500/10 text-orange-400 text-xs font-bold flex justify-center items-center gap-1">
                                                        <ArrowUp size={14} /> Sacar plata
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => setFondoAbierto(String(fondoAbierto) === String(f.id) ? null : f.id)} className="flex-1 px-3 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] text-xs flex justify-center items-center gap-1">
                                                <Receipt size={14} /> {String(fondoAbierto) === String(f.id) ? 'Ocultar movimientos' : 'Ver movimientos'}
                                            </button>
                                            {canManage && <button onClick={() => setFundForm({ id: f.id, name: f.name, active: f.active })} className="p-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)]"><Edit3 size={15} /></button>}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {fondoAbierto && (
                                <div className="glass-card overflow-hidden" data-prueba="movimientos">
                                    <div className="p-4 border-b border-[var(--glass-border)]">
                                        <h2 className="font-semibold text-[var(--color-text)]">Movimientos de {nombreFondo(fondoAbierto)}</h2>
                                    </div>
                                    {movimientos === null ? (
                                        <div className="py-8 flex justify-center text-[var(--color-text-muted)]"><RefreshCw className="animate-spin" size={18} /></div>
                                    ) : !movimientos.length ? (
                                        <p className="p-8 text-center text-sm text-[var(--color-text-muted)]">Sin movimientos.</p>
                                    ) : (
                                        <div className="divide-y divide-[var(--glass-border)]">
                                            {movimientos.map(m => {
                                                const entra = m.kind === 'deposit';
                                                const titulo = m.kind === 'expense' ? `Pago: ${m.description}` : m.description || (entra ? 'Plata agregada' : 'Plata sacada');
                                                return (
                                                    <div key={`${m.source}-${m.id}`} className="p-4 flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-sm text-[var(--color-text)] truncate">{titulo}</p>
                                                            <p className="text-xs text-[var(--color-text-muted)]">{fechaCorta(m.date)}</p>
                                                        </div>
                                                        <div className="flex items-center gap-3 shrink-0">
                                                            <strong className={entra ? 'text-green-400' : 'text-[var(--color-text)]'}>
                                                                {entra ? '+' : '−'}{money(m.amount, currentCurrency)}
                                                            </strong>
                                                            {/* Los pagos se corrigen en Gastos; aquí solo lo agregado o sacado a mano. */}
                                                            {canManage && m.source === 'movement' && (
                                                                <button onClick={() => window.confirm('¿Eliminar este movimiento?') && mutate('fundMovementDelete', { id: m.id })} className="text-[var(--color-text-muted)] hover:text-red-400"><Trash2 size={15} /></button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'categories' && (
                        <div className="glass-card p-5 max-w-2xl space-y-5">
                            <div>
                                <h2 className="font-semibold text-[var(--color-text)]">Categorías de gastos</h2>
                                <p className="text-xs text-[var(--color-text-muted)]">Agrega categorías propias para clasificar los egresos.</p>
                            </div>
                            {canManage && <div className="flex gap-2">
                                <input value={categoryName} onChange={event => setCategoryName(event.target.value)} placeholder="Ej: Seguridad" className={inputClass} />
                                <button disabled={!categoryName.trim() || saving} onClick={() => mutate('categoryCreate', { data: { name: categoryName } }, () => setCategoryName(''))} className="px-4 rounded-lg bg-[var(--color-primary)] text-black font-bold disabled:opacity-40">Agregar</button>
                            </div>}
                            <div className="flex flex-wrap gap-2">
                                {data.categories.map(category => (
                                    <span key={category.id} className="px-3 py-2 rounded-full border border-[var(--glass-border)] text-sm text-[var(--color-text)] flex items-center gap-2">
                                        <i className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: category.color }} /> {category.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {expenseForm && (
                <Modal title={expenseForm.id ? 'Editar gasto' : 'Registrar gasto'} onClose={() => setExpenseForm(null)}>
                    <form className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={guardarGasto}>
                        <Field label="Descripción *"><input required value={expenseForm.description} onChange={event => setExpenseForm({ ...expenseForm, description: event.target.value })} className={inputClass} /></Field>
                        <Field label="Categoría">
                            <select value={expenseForm.category_id || ''} onChange={event => setExpenseForm({ ...expenseForm, category_id: event.target.value })} className={inputClass}>
                                <option value="">Sin categoría</option>
                                {data.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </Field>
                        <Field label="Monto *"><InputMonto required value={expenseForm.amount} onChange={n => setExpenseForm({ ...expenseForm, amount: n })} className={inputClass} /></Field>
                        <Field label="Proveedor"><input value={expenseForm.supplier || ''} onChange={event => setExpenseForm({ ...expenseForm, supplier: event.target.value })} className={inputClass} /></Field>
                        <Field label="Fecha del gasto *"><input required type="date" value={expenseForm.expense_date} onChange={event => setExpenseForm({ ...expenseForm, expense_date: event.target.value, period_key: event.target.value.slice(0, 7) })} className={inputClass} /></Field>
                        <Field label="Vencimiento"><input type="date" value={expenseForm.due_date || ''} onChange={event => setExpenseForm({ ...expenseForm, due_date: event.target.value })} className={inputClass} /></Field>
                        <Field label="Estado">
                            <select value={expenseForm.status} onChange={event => setExpenseForm({ ...expenseForm, status: event.target.value })} className={inputClass}>
                                <option value="paid">Pagado</option>
                                <option value="pending">Pendiente</option>
                            </select>
                        </Field>
                        <Field label="Medio de pago"><input placeholder="Efectivo, transferencia…" value={expenseForm.payment_method || ''} onChange={event => setExpenseForm({ ...expenseForm, payment_method: event.target.value })} className={inputClass} /></Field>
                        {fondosOn && (fondosActivos.length > 0 || expenseForm.fund_id) && (
                            <Field label="Sale de">
                                <select data-prueba="fondo-gasto" value={expenseForm.fund_id || ''} onChange={event => setExpenseForm({ ...expenseForm, fund_id: event.target.value })} className={inputClass}>
                                    <option value="">Ningún fondo</option>
                                    {(data.funds || []).filter(f => f.active || String(f.id) === String(expenseForm.fund_id)).map(f => (
                                        <option key={f.id} value={f.id}>{f.name} · {money(f.balance, currentCurrency)}</option>
                                    ))}
                                </select>
                            </Field>
                        )}
                        <div className="sm:col-span-2">
                            <Field label="Notas"><textarea rows="3" value={expenseForm.notes || ''} onChange={event => setExpenseForm({ ...expenseForm, notes: event.target.value })} className={inputClass} /></Field>
                        </div>
                        <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                            <button type="button" onClick={() => setExpenseForm(null)} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)]">Cancelar</button>
                            <button disabled={saving} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {pago && (
                <Modal angosto title="Pagar cuenta" onClose={() => setPago(null)}>
                    <form className="p-5 space-y-5" onSubmit={pagar}>
                        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] p-4 space-y-1">
                            <p className="font-semibold text-[var(--color-text)]">{pago.description}</p>
                            {(pago.categoryName || pago.supplier) && (
                                <p className="text-xs text-[var(--color-text-muted)]">{[pago.categoryName, pago.supplier].filter(Boolean).join(' · ')}</p>
                            )}
                            {pago.dueDate && (
                                <p className={`text-xs ${pago.dueDate < today() ? 'text-red-400' : 'text-[var(--color-text-muted)]'}`}>
                                    Vence el {fechaCorta(pago.dueDate)}{pago.dueDate < today() ? ' · vencida' : ''}
                                </p>
                            )}
                            {pago.kind === 'recurring' && (
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    Cuenta de {mesLargo(pago.periodKey)} · monto estimado: {money(pago.amount, currentCurrency)}
                                </p>
                            )}
                        </div>

                        <div>
                            <Field label="Monto a pagar *">
                                <InputMonto data-prueba="monto-pago" required autoFocus value={pago.monto}
                                    onChange={n => setPago({ ...pago, monto: n })} className={`${inputClass} text-lg font-bold`} />
                            </Field>
                        </div>

                        <div className="space-y-1.5">
                            <span className="text-xs text-[var(--color-text-muted)]">Medio de pago</span>
                            <div className="grid grid-cols-2 gap-2">
                                {mediosPara(pago.metodo).map(m => (
                                    <button
                                        key={m}
                                        type="button"
                                        data-prueba="medio-pago"
                                        aria-pressed={sinTildes(pago.metodo) === sinTildes(m)}
                                        onClick={() => setPago({ ...pago, metodo: m })}
                                        className={`px-3 py-2.5 rounded-lg border text-sm transition-colors ${sinTildes(pago.metodo) === sinTildes(m)
                                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-bold'
                                            : 'border-[var(--glass-border)] text-[var(--color-text)]'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* De qué fondo sale la plata (caja chica, capital…). No es la caja de ventas. */}
                        {fondosOn && fondosActivos.length > 0 && (() => {
                            const elegido = fondosActivos.find(f => String(f.id) === String(pago.fondo));
                            const queda = elegido ? elegido.balance - (Number(pago.monto) || 0) : null;
                            return (
                                <div className="space-y-1.5">
                                    <span className="text-xs text-[var(--color-text-muted)]">Sale de</span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {[...fondosActivos.map(f => ({ id: f.id, nombre: f.name, saldo: f.balance })), { id: null, nombre: 'Ningún fondo' }].map(op => {
                                            const activo = String(op.id ?? '') === String(pago.fondo ?? '');
                                            return (
                                                <button
                                                    key={op.id ?? 'ninguno'}
                                                    type="button"
                                                    data-prueba="fondo-pago"
                                                    aria-pressed={activo}
                                                    onClick={() => setPago({ ...pago, fondo: op.id })}
                                                    className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${activo
                                                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-bold'
                                                        : 'border-[var(--glass-border)] text-[var(--color-text)]'}`}
                                                >
                                                    <span className="block truncate">{op.nombre}</span>
                                                    {op.saldo !== undefined && (
                                                        <span className={`block text-[11px] font-normal ${op.saldo < 0 ? 'text-red-400' : 'text-[var(--color-text-muted)]'}`}>
                                                            Saldo {money(op.saldo, currentCurrency)}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {elegido && queda < 0 && (
                                        <p data-prueba="aviso-saldo" className="text-xs text-amber-400">
                                            {elegido.name} queda en {money(queda, currentCurrency)}.
                                        </p>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Hoy por defecto; si se pagó antes y se anota después, el día real. */}
                        {pago.cambiarFecha ? (
                            <div>
                                <Field label="Fecha de pago">
                                    <input data-prueba="fecha-pago" type="date" required max={today()} value={pago.fecha}
                                        onChange={event => setPago({ ...pago, fecha: event.target.value })} className={inputClass} />
                                </Field>
                            </div>
                        ) : (
                            <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-2">
                                Fecha de pago: hoy, {fechaCorta(today())}.
                                <button type="button" data-prueba="cambiar-fecha" onClick={() => setPago({ ...pago, cambiarFecha: true })}
                                    className="text-[var(--color-primary)] font-medium underline-offset-2 hover:underline">
                                    Cambiar
                                </button>
                            </p>
                        )}

                        {/* El error de la página queda detrás del modal: se repite acá. */}
                        {error && <p data-prueba="error-pago" className="text-sm text-red-400">{error}</p>}

                        <div className="flex justify-end gap-2 pt-1">
                            <button type="button" onClick={() => setPago(null)} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)]">Cancelar</button>
                            <button data-prueba="confirmar-pago" disabled={saving || !(Number(pago.monto) > 0)} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold disabled:opacity-50">
                                {saving ? 'Pagando…' : `Pagar ${money(pago.monto, currentCurrency)}`}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {fundForm && (
                <Modal angosto title={fundForm.id ? 'Editar fondo' : 'Nuevo fondo'} onClose={() => setFundForm(null)}>
                    <form className="p-5 space-y-4" onSubmit={event => {
                        event.preventDefault();
                        mutate('fundSave', { data: fundForm }, () => setFundForm(null));
                    }}>
                        <div>
                            <Field label="Nombre *">
                                <input data-prueba="nombre-fondo" required maxLength={60} autoFocus placeholder="Ej: Caja chica" value={fundForm.name}
                                    onChange={event => setFundForm({ ...fundForm, name: event.target.value })} className={inputClass} />
                            </Field>
                        </div>
                        {!fundForm.id && (
                            <div>
                                <Field label="Plata con la que parte">
                                    <InputMonto data-prueba="inicial-fondo" value={fundForm.initial_amount}
                                        onChange={n => setFundForm({ ...fundForm, initial_amount: n })} className={inputClass} placeholder="Ej: 500.000" />
                                </Field>
                            </div>
                        )}
                        {fundForm.id && (
                            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                                <input type="checkbox" checked={Boolean(fundForm.active)} onChange={event => setFundForm({ ...fundForm, active: event.target.checked })} /> Activo
                            </label>
                        )}
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        <div className="flex justify-end gap-2 pt-1">
                            <button type="button" onClick={() => setFundForm(null)} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)]">Cancelar</button>
                            <button disabled={saving} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {movForm && (
                <Modal angosto title={movForm.kind === 'deposit' ? `Agregar plata a ${movForm.fund.name}` : `Sacar plata de ${movForm.fund.name}`} onClose={() => setMovForm(null)}>
                    <form className="p-5 space-y-4" onSubmit={event => {
                        event.preventDefault();
                        if (!(Number(movForm.amount) > 0)) return;
                        mutate('fundMovementAdd', {
                            data: {
                                fund_id: movForm.fund.id, kind: movForm.kind, amount: movForm.amount,
                                movement_date: movForm.movement_date, description: movForm.description,
                            },
                        }, () => setMovForm(null));
                    }}>
                        <p className="text-xs text-[var(--color-text-muted)]">Saldo actual: {money(movForm.fund.balance, currentCurrency)}</p>
                        <div>
                            <Field label="Monto *">
                                <InputMonto data-prueba="monto-mov" required autoFocus value={movForm.amount}
                                    onChange={n => setMovForm({ ...movForm, amount: n })} className={`${inputClass} text-lg font-bold`} />
                            </Field>
                        </div>
                        <div>
                            <Field label="Fecha *">
                                <input type="date" required max={today()} value={movForm.movement_date}
                                    onChange={event => setMovForm({ ...movForm, movement_date: event.target.value })} className={inputClass} />
                            </Field>
                        </div>
                        <div>
                            <Field label="Detalle">
                                <input data-prueba="detalle-mov" maxLength={200} value={movForm.description}
                                    placeholder={movForm.kind === 'deposit' ? 'Ej: Aporte del dueño' : 'Ej: Compra de mercadería'}
                                    onChange={event => setMovForm({ ...movForm, description: event.target.value })} className={inputClass} />
                            </Field>
                        </div>
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        <div className="flex justify-end gap-2 pt-1">
                            <button type="button" onClick={() => setMovForm(null)} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)]">Cancelar</button>
                            <button data-prueba="guardar-mov" disabled={saving || !(Number(movForm.amount) > 0)} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold disabled:opacity-50">
                                {saving ? 'Guardando…' : movForm.kind === 'deposit' ? 'Agregar' : 'Sacar'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {recurringForm && (
                <Modal title={recurringForm.id ? 'Editar cuenta mensual' : 'Nueva cuenta mensual'} onClose={() => setRecurringForm(null)}>
                    <form className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={event => {
                        event.preventDefault();
                        mutate('recurringSave', { data: recurringForm }, () => setRecurringForm(null));
                    }}>
                        <Field label="Descripción *"><input required value={recurringForm.description} onChange={event => setRecurringForm({ ...recurringForm, description: event.target.value })} className={inputClass} /></Field>
                        <Field label="Categoría">
                            <select value={recurringForm.category_id || ''} onChange={event => setRecurringForm({ ...recurringForm, category_id: event.target.value })} className={inputClass}>
                                <option value="">Sin categoría</option>
                                {data.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </Field>
                        <Field label="Monto mensual estimado *"><InputMonto required value={recurringForm.amount} onChange={n => setRecurringForm({ ...recurringForm, amount: n })} className={inputClass} /></Field>
                        <Field label="Día de vencimiento"><input min="1" max="31" type="number" value={recurringForm.due_day} onChange={event => setRecurringForm({ ...recurringForm, due_day: event.target.value })} className={inputClass} /></Field>
                        <Field label="Fecha de inicio *"><input required type="date" value={recurringForm.start_date} onChange={event => setRecurringForm({ ...recurringForm, start_date: event.target.value })} className={inputClass} /></Field>
                        <Field label="Fecha de término"><input type="date" value={recurringForm.end_date || ''} onChange={event => setRecurringForm({ ...recurringForm, end_date: event.target.value })} className={inputClass} /></Field>
                        <Field label="Proveedor"><input value={recurringForm.supplier || ''} onChange={event => setRecurringForm({ ...recurringForm, supplier: event.target.value })} className={inputClass} /></Field>
                        <Field label="Medio de pago"><input value={recurringForm.payment_method || ''} onChange={event => setRecurringForm({ ...recurringForm, payment_method: event.target.value })} className={inputClass} /></Field>
                        <div className="sm:col-span-2">
                            <Field label="Notas"><textarea rows="3" value={recurringForm.notes || ''} onChange={event => setRecurringForm({ ...recurringForm, notes: event.target.value })} className={inputClass} /></Field>
                        </div>
                        {recurringForm.id && <label className="sm:col-span-2 flex items-center gap-2 text-sm text-[var(--color-text)]"><input type="checkbox" checked={Boolean(recurringForm.active)} onChange={event => setRecurringForm({ ...recurringForm, active: event.target.checked })} /> Activo</label>}
                        <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                            <button type="button" onClick={() => setRecurringForm(null)} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)]">Cancelar</button>
                            <button disabled={saving} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
