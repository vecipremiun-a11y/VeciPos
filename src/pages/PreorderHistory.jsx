import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import {
    ShoppingBag, DollarSign, TrendingUp, TrendingDown, Truck, XCircle, Clock,
    CheckCircle, Percent, CreditCard, Banknote, ArrowLeftRight, Calendar
} from 'lucide-react';
import { cn } from '../lib/utils';
import { formatInCompanyTime, getNowInCompanyTime } from '../lib/dateHelpers';
import { formatCurrency } from '../utils/formatCurrency';

const STATUS_META = {
    delivered: { label: 'Entregados', color: '#10b981' },
    ready: { label: 'Listos', color: '#3b82f6' },
    preparing: { label: 'En preparación', color: '#06b6d4' },
    confirmed: { label: 'Confirmados', color: '#8b5cf6' },
    pending: { label: 'Pendientes', color: '#f59e0b' },
    canceled: { label: 'Cancelados', color: '#ef4444' },
};

const PAYMENT_META = {
    Efectivo: { label: 'Efectivo', color: '#10b981', icon: <Banknote size={14} /> },
    Tarjeta: { label: 'Tarjeta', color: '#3b82f6', icon: <CreditCard size={14} /> },
    Transferencia: { label: 'Transferencia', color: '#8b5cf6', icon: <ArrowLeftRight size={14} /> },
};

const PreorderHistory = () => {
    const { getPreorderAnalytics, currentCompanyTimezone, currentCurrency } = useStore();
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('month');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [data, setData] = useState(null);

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRange, customStart, customEnd]);

    const loadData = async () => {
        setLoading(true);
        try {
            const nowInCompany = getNowInCompanyTime(currentCompanyTimezone);
            const todayStr = formatInCompanyTime(nowInCompany.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
            let startDate = todayStr, endDate = todayStr;

            if (dateRange === 'yesterday') {
                const y = new Date(nowInCompany); y.setDate(y.getDate() - 1);
                startDate = endDate = formatInCompanyTime(y.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
            } else if (dateRange === 'week') {
                const w = new Date(nowInCompany); w.setDate(w.getDate() - 7);
                startDate = formatInCompanyTime(w.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
            } else if (dateRange === 'month') {
                const m = new Date(nowInCompany); m.setDate(m.getDate() - 30);
                startDate = formatInCompanyTime(m.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
            } else if (dateRange === 'custom') {
                if (!customStart || !customEnd) { setLoading(false); return; }
                startDate = customStart; endDate = customEnd;
            }

            const res = await getPreorderAnalytics(startDate, endDate);
            if (res.success) setData(res);
        } catch (e) {
            console.error('Error loading preorder analytics:', e);
        } finally {
            setLoading(false);
        }
    };

    const s = data?.summary;
    const pieData = (data?.byStatus || [])
        .filter(x => x.count > 0)
        .map(x => ({ name: STATUS_META[x.status]?.label || x.status, value: x.count, color: STATUS_META[x.status]?.color || '#64748b' }));
    const totalForPie = pieData.reduce((a, b) => a + b.value, 0);

    const daily = (data?.daily || []).map(d => ({ ...d, label: d.day.slice(5) }));
    const maxOrders = Math.max(0, ...daily.map(d => d.orders));

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header + filtros */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <TrendingUp className="text-[var(--primary)]" /> Historial de Encargos
                    </h1>
                    <p className="text-sm text-[var(--text-muted)]">Inteligencia y crecimiento · encargos por fecha de entrega</p>
                </div>
                <div className="flex flex-wrap gap-2 items-center bg-[var(--surface-light)] p-2 rounded-xl border border-[var(--glass-border)]">
                    {['today', 'yesterday', 'week', 'month', 'custom'].map(r => (
                        <button key={r} onClick={() => setDateRange(r)}
                            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                                dateRange === r ? "bg-[var(--primary)] text-white" : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]")}>
                            {r === 'today' ? 'Hoy' : r === 'yesterday' ? 'Ayer' : r === 'week' ? '7 días' : r === 'month' ? '30 días' : 'Personalizado'}
                        </button>
                    ))}
                    {dateRange === 'custom' && (
                        <div className="flex items-center gap-2">
                            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="input-field py-1" />
                            <span className="text-[var(--text-muted)]">-</span>
                            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="input-field py-1" />
                        </div>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex items-center justify-center text-[var(--text-muted)]">Cargando…</div>
            ) : !data ? (
                <div className="h-64 flex items-center justify-center text-[var(--text-muted)]">Sin datos en el período</div>
            ) : (
                <>
                    {/* Banner de crecimiento */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <GrowthCard
                            title="Ventas vs período anterior"
                            current={formatCurrency(s.revenue, currentCurrency)}
                            change={data.growth.revenueChange}
                            sub={`Antes: ${formatCurrency(data.growth.prevRevenue, currentCurrency)}`}
                        />
                        <GrowthCard
                            title="Encargos del período vs anterior"
                            current={`${s.totalOrders} encargos`}
                            change={data.growth.ordersChange}
                            sub={`Antes: ${data.growth.prevOrders} encargos`}
                        />
                    </div>

                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <Kpi title="Total Encargos" value={s.totalOrders} icon={<ShoppingBag size={16} />} color="text-blue-400" />
                        <Kpi title="Entregados" value={s.deliveredCount} icon={<Truck size={16} />} color="text-green-400" />
                        <Kpi title="Cancelados" value={s.canceledCount} icon={<XCircle size={16} />} color="text-red-400" />
                        <Kpi title="En proceso" value={s.inprocessCount} icon={<Clock size={16} />} color="text-amber-400" />
                        <Kpi title="Total Vendido" value={formatCurrency(s.revenue, currentCurrency)} icon={<DollarSign size={16} />} color="text-green-400" raw />
                        <Kpi title="Ticket Promedio" value={formatCurrency(s.avgTicket, currentCurrency)} icon={<TrendingUp size={16} />} color="text-cyan-400" raw />
                        <Kpi title="Tasa Cumplimiento" value={`${s.fulfillmentRate.toFixed(0)}%`} icon={<CheckCircle size={16} />} color="text-emerald-400" raw />
                        <Kpi title="Tasa Cancelación" value={`${s.cancellationRate.toFixed(0)}%`} icon={<Percent size={16} />} color="text-rose-400" raw />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Distribución por estado (círculo de %) */}
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-bold mb-4 text-white">Distribución por Estado</h3>
                            <div className="h-72 w-full">
                                {pieData.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">Sin encargos</div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                                                paddingAngle={2} dataKey="value"
                                                label={({ value }) => `${((value / totalForPie) * 100).toFixed(0)}%`}
                                                labelLine={false}>
                                                {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', borderColor: '#3b82f6', color: '#fff' }}
                                                formatter={(v, n) => [`${v} encargos`, n]} />
                                            <Legend verticalAlign="bottom" height={36} iconType="circle"
                                                formatter={(val) => <span style={{ color: '#cbd5e1', fontSize: 12 }}>{val}</span>} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* Encargos por día */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-white">Encargos por Día de Entrega</h3>
                                {data.peakDay && (
                                    <span className="text-xs px-2 py-1 rounded-lg bg-[var(--primary)]/15 text-[var(--primary)] flex items-center gap-1">
                                        <Calendar size={12} /> Pico: {data.peakDay.day.slice(5)} ({data.peakDay.orders})
                                    </span>
                                )}
                            </div>
                            <div className="h-72 w-full">
                                {daily.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">Sin encargos</div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={daily}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                            <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', borderColor: '#3b82f6', color: '#fff' }}
                                                formatter={(v, n) => [n === 'orders' ? `${v} encargos` : formatCurrency(v, currentCurrency), n === 'orders' ? 'Recibidos' : 'Vendido']} />
                                            <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                                                {daily.map((d, i) => <Cell key={i} fill={d.orders === maxOrders && maxOrders > 0 ? '#10b981' : '#3b82f6'} />)}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Medios de pago */}
                    <div className="glass-card p-6">
                        <h3 className="text-lg font-bold mb-4 text-white">Medios de Pago (entregados)</h3>
                        {(!data.byPaymentMethod || data.byPaymentMethod.length === 0) ? (
                            <p className="text-sm text-[var(--text-muted)]">Sin pagos registrados</p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {data.byPaymentMethod.map((p, i) => {
                                    const meta = PAYMENT_META[p.method] || { label: p.method, color: '#64748b', icon: <DollarSign size={14} /> };
                                    return (
                                        <div key={i} className="rounded-xl border border-[var(--glass-border)] p-4 bg-[var(--surface)]">
                                            <div className="flex items-center gap-2 mb-2" style={{ color: meta.color }}>
                                                {meta.icon}<span className="text-sm font-semibold">{meta.label}</span>
                                            </div>
                                            <p className="text-xl font-bold text-white font-mono">{formatCurrency(p.total, currentCurrency)}</p>
                                            <p className="text-xs text-[var(--text-muted)]">{p.orders} encargo(s)</p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Top productos + Top clientes */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="glass-card p-0 overflow-hidden">
                            <div className="p-4 border-b border-[var(--glass-border)]">
                                <h3 className="text-lg font-bold text-white">Productos Más Encargados</h3>
                            </div>
                            <div className="overflow-y-auto max-h-[360px]">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs sticky top-0 backdrop-blur-md">
                                        <tr>
                                            <th className="px-4 py-2">Producto</th>
                                            <th className="px-4 py-2 text-right">Cant.</th>
                                            <th className="px-4 py-2 text-right">Pedidos</th>
                                            <th className="px-4 py-2 text-right">Vendido</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--glass-border)]">
                                        {data.byProduct.length === 0 ? (
                                            <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">Sin datos</td></tr>
                                        ) : data.byProduct.map((p, i) => (
                                            <tr key={i} className="hover:bg-[var(--glass-bg)]">
                                                <td className="px-4 py-2 text-gray-300">{p.name}</td>
                                                <td className="px-4 py-2 text-right text-white font-bold">{Number(p.quantity).toLocaleString()} {p.billing_unit === 'kg' ? 'kg' : 'un'}</td>
                                                <td className="px-4 py-2 text-right text-blue-300">{p.orders}</td>
                                                <td className="px-4 py-2 text-right text-green-400">{formatCurrency(p.revenue, currentCurrency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="glass-card p-0 overflow-hidden">
                            <div className="p-4 border-b border-[var(--glass-border)]">
                                <h3 className="text-lg font-bold text-white">Mejores Clientes</h3>
                            </div>
                            <div className="overflow-y-auto max-h-[360px]">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs sticky top-0 backdrop-blur-md">
                                        <tr>
                                            <th className="px-4 py-2">Cliente</th>
                                            <th className="px-4 py-2 text-center">Entreg.</th>
                                            <th className="px-4 py-2 text-center">Cancel.</th>
                                            <th className="px-4 py-2 text-right">Gastado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--glass-border)]">
                                        {data.byClient.length === 0 ? (
                                            <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">Sin datos</td></tr>
                                        ) : data.byClient.map((c, i) => (
                                            <tr key={i} className="hover:bg-[var(--glass-bg)]">
                                                <td className="px-4 py-2 font-medium text-white">{c.client_name || 'Cliente Casual'}</td>
                                                <td className="px-4 py-2 text-center text-green-400">{c.delivered_count}</td>
                                                <td className="px-4 py-2 text-center text-red-400">{c.canceled_count}</td>
                                                <td className="px-4 py-2 text-right text-green-400 font-bold">{formatCurrency(c.total_spend, currentCurrency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

const Kpi = ({ title, value, icon, color, raw = false }) => (
    <div className="glass-card p-4 flex flex-col items-center justify-center text-center">
        <div className={cn("p-2.5 rounded-full bg-white/5 mb-2", color)}>{icon}</div>
        <p className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold">{title}</p>
        <p className={cn("font-bold font-mono mt-1", color, raw ? "text-lg" : "text-2xl")}>{value}</p>
    </div>
);

const GrowthCard = ({ title, current, change, sub }) => {
    const up = change >= 0;
    return (
        <div className="glass-card p-5 flex items-center justify-between">
            <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">{title}</p>
                <p className="text-2xl font-bold text-white font-mono mt-1">{current}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>
            </div>
            <div className={cn("flex flex-col items-center px-4 py-3 rounded-xl", up ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                {up ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
                <span className="text-lg font-bold font-mono mt-1">{up ? '+' : ''}{change.toFixed(0)}%</span>
            </div>
        </div>
    );
};

export default PreorderHistory;
