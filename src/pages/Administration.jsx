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

const today = () => new Date().toISOString().slice(0, 10);
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

function Modal({ title, onClose, children }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
            <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-[var(--color-background)] shadow-2xl">
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
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [expenseForm, setExpenseForm] = useState(null);
    const [recurringForm, setRecurringForm] = useState(null);
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
            'Recurrente': item.recurring_expense_id ? 'Sí' : 'No',
            'Notas': item.notes || '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
        XLSX.writeFile(wb, `Gastos_${month}.xlsx`);
    };

    const openRecurringPayment = (item) => {
        const expenseDate = month === currentMonth() ? today() : `${month}-01`;
        setExpenseForm({
            ...emptyExpense(),
            recurring_expense_id: String(item.id),
            category_id: item.category_id ? String(item.category_id) : '',
            description: item.description,
            supplier: item.supplier || '',
            amount: item.amount,
            expense_date: expenseDate,
            due_date: expenseDate,
            period_key: month,
            payment_method: item.payment_method || '',
        });
    };

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
                    ['expenses', 'Gastos reales'],
                    ['recurring', 'Gastos recurrentes'],
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
                                            Sin costos fijos registrados. Agrega gastos recurrentes o personal para calcular tu meta diaria.
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
                                                        <span className="text-[var(--color-text-muted)]">Costos fijos del mes (recurrentes + personal)</span>
                                                        <span className="text-[var(--color-text)]">{money(breakEven.monthlyFixed, currentCurrency)}</span>
                                                    </div>
                                                    <div className="flex justify-between text-[11px]">
                                                        <span className="text-[var(--color-text-muted)] pl-3">Recurrentes {money(data.fixedCosts?.recurring, currentCurrency)} · Personal {money(data.fixedCosts?.payroll, currentCurrency)}</span>
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
                                            ['Gastos registrados', -summary.oneOffExpenses, 'text-orange-400'],
                                            ['Servicios recurrentes asignados', -summary.recurringExpenses, 'text-purple-400'],
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
                                            <p className="text-xs text-[var(--color-text-muted)]">Cuentas pendientes y servicios recurrentes sin registrar este mes.</p>
                                        </div>
                                    </div>
                                    <span className="font-bold text-amber-400">{money(obligationsTotal, currentCurrency)}</span>
                                </div>
                                <div className="divide-y divide-[var(--glass-border)]">
                                    {data.obligations.map(item => {
                                        const overdue = item.dueDate < today();
                                        const template = item.kind === 'recurring'
                                            ? data.recurring.find(r => String(r.id) === String(item.templateId))
                                            : null;
                                        return (
                                            <div key={`${item.kind}-${item.id || item.templateId}`} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div className="flex items-start gap-3 min-w-0">
                                                    <CalendarDays size={18} className={`mt-1 shrink-0 ${overdue ? 'text-red-400' : 'text-amber-400'}`} />
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-[var(--color-text)] truncate">{item.description}</p>
                                                        <p className="text-xs text-[var(--color-text-muted)]">
                                                            Vence {item.dueDate} · {item.categoryName || 'Sin categoría'} {item.supplier ? `· ${item.supplier}` : ''}
                                                            {item.kind === 'recurring' ? ' · recurrente sin registrar' : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between sm:justify-end gap-3">
                                                    <span className={`text-xs px-2 py-1 rounded-full ${overdue ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                        {overdue ? 'Vencido' : 'Por vencer'}
                                                    </span>
                                                    <strong className="text-[var(--color-text)]">{money(item.amount, currentCurrency)}</strong>
                                                    {canManage && template && (
                                                        <button
                                                            onClick={() => openRecurringPayment(template)}
                                                            className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold flex items-center gap-1"
                                                        >
                                                            <CheckCircle2 size={13} /> Registrar
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
                            <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center">
                                <div>
                                    <h2 className="font-semibold text-[var(--color-text)]">Gastos de {month}</h2>
                                    <p className="text-xs text-[var(--color-text-muted)]">{selectedMonthExpenses.length} registros</p>
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
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between sm:justify-end gap-3">
                                            <span className={`text-xs px-2 py-1 rounded-full ${item.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                {item.status === 'paid' ? 'Pagado' : 'Pendiente'}
                                            </span>
                                            <strong className="text-[var(--color-text)]">{money(item.amount, currentCurrency)}</strong>
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
                            <div className="flex justify-end">
                                {canManage && <button onClick={() => setRecurringForm(emptyRecurring())} className="px-4 py-2 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] flex items-center gap-2"><Plus size={16} /> Nuevo recurrente</button>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {data.recurring.map(item => (
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
                                            {canManage && Number(item.active) === 1 && <button onClick={() => openRecurringPayment(item)} className="flex-1 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold flex justify-center items-center gap-1"><CheckCircle2 size={14} /> Registrar cuenta</button>}
                                            {canManage && <button onClick={() => setRecurringForm({ ...item, category_id: String(item.category_id || ''), active: Number(item.active) === 1 })} className="p-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)]"><Edit3 size={15} /></button>}
                                            {canManage && Number(item.active) === 1 && <button onClick={() => window.confirm('¿Desactivar este gasto recurrente?') && mutate('recurringDelete', { id: item.id })} className="p-2 rounded-lg border border-[var(--glass-border)] text-red-400"><Trash2 size={15} /></button>}
                                        </div>
                                    </div>
                                ))}
                            </div>
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
                <Modal title={expenseForm.id ? 'Editar gasto' : expenseForm.recurring_expense_id ? 'Registrar cuenta recurrente' : 'Registrar gasto'} onClose={() => setExpenseForm(null)}>
                    <form className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={event => {
                        event.preventDefault();
                        mutate('expenseSave', { data: expenseForm }, () => setExpenseForm(null));
                    }}>
                        <Field label="Descripción *"><input required value={expenseForm.description} onChange={event => setExpenseForm({ ...expenseForm, description: event.target.value })} className={inputClass} /></Field>
                        <Field label="Categoría">
                            <select value={expenseForm.category_id || ''} onChange={event => setExpenseForm({ ...expenseForm, category_id: event.target.value })} className={inputClass}>
                                <option value="">Sin categoría</option>
                                {data.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </Field>
                        <Field label="Monto *"><input required min="1" step="0.01" type="number" value={expenseForm.amount} onChange={event => setExpenseForm({ ...expenseForm, amount: event.target.value })} className={inputClass} /></Field>
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

            {recurringForm && (
                <Modal title={recurringForm.id ? 'Editar gasto recurrente' : 'Nuevo gasto recurrente'} onClose={() => setRecurringForm(null)}>
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
                        <Field label="Monto mensual *"><input required min="1" step="0.01" type="number" value={recurringForm.amount} onChange={event => setRecurringForm({ ...recurringForm, amount: event.target.value })} className={inputClass} /></Field>
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
