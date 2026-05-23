import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { format } from 'date-fns';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Search, Download, DollarSign, TrendingUp, ShoppingBag, Truck } from 'lucide-react';
import { cn } from '../../lib/utils';
import * as XLSX from 'xlsx';
import { formatInCompanyTime, getNowInCompanyTime } from '../../lib/dateHelpers';
import { formatCurrency } from '../../utils/formatCurrency';

const PreorderReports = () => {
    const { getPreorderReports, currentCompanyTimezone, currentCurrency } = useStore();
    const [isLoading, setIsLoading] = useState(true);
    const [dateRange, setDateRange] = useState('month'); // today, yesterday, week, month, custom
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const [data, setData] = useState({
        summary: null,
        byStatus: [],
        byProduct: [],
        byClient: [],
        details: []
    });

    useEffect(() => {
        loadData();
    }, [dateRange, customStart, customEnd]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            let startDate, endDate;
            const nowInCompany = getNowInCompanyTime(currentCompanyTimezone);
            const todayStr = formatInCompanyTime(nowInCompany.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');

            if (dateRange === 'today') {
                startDate = todayStr;
                endDate = todayStr;
            } else if (dateRange === 'yesterday') {
                const yesterday = new Date(nowInCompany);
                yesterday.setDate(yesterday.getDate() - 1);
                startDate = formatInCompanyTime(yesterday.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
                endDate = startDate;
            } else if (dateRange === 'week') {
                const weekAgo = new Date(nowInCompany);
                weekAgo.setDate(weekAgo.getDate() - 7);
                startDate = formatInCompanyTime(weekAgo.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
                endDate = todayStr;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(nowInCompany);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                startDate = formatInCompanyTime(monthAgo.toISOString(), currentCompanyTimezone, 'yyyy-MM-dd');
                endDate = todayStr;
            } else if (dateRange === 'custom') {
                if (!customStart || !customEnd) {
                    setIsLoading(false);
                    return;
                }
                startDate = customStart;
                endDate = customEnd;
            }

            const result = await getPreorderReports(startDate, endDate);
            if (result.success) {
                setData({
                    summary: result.summary,
                    byStatus: result.byStatus,
                    byProduct: result.byProduct,
                    byClient: result.byClient,
                    details: result.details
                });
            }
        } catch (e) {
            console.error("Error loading preorder report:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const exportToExcel = () => {
        const ws = XLSX.utils.json_to_sheet(data.details.map(item => ({
            'Fecha': format(new Date(item.created_at), 'yyyy-MM-dd HH:mm'),
            'Cliente': item.client_name,
            'Estado': item.status,
            'Total': item.total_amount,
            'Abono': item.deposit_amount,
            'Saldo': item.total_amount - item.deposit_amount,
            'Items': item.items_summary
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Reporte de Encargos");
        XLSX.writeFile(wb, `reporte_encargos_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    // Ventas por día (a partir de los entregados ya filtrados por delivered_at).
    const dailyRevenue = (() => {
        const map = {};
        (data.details || []).forEach(d => {
            const day = (d.delivered_at || '').slice(0, 10);
            if (!day) return;
            map[day] = (map[day] || 0) + (Number(d.total_amount) || 0);
        });
        return Object.entries(map)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, total]) => ({ day: day.slice(5), total }));
    })();

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center bg-[var(--surface-light)] p-2 rounded-xl border border-[var(--glass-border)]">
                {['today', 'yesterday', 'week', 'month', 'custom'].map((range) => (
                    <button
                        key={range}
                        onClick={() => setDateRange(range)}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                            dateRange === range
                                ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/20"
                                : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                        )}
                    >
                        {range === 'today' ? 'Hoy' :
                            range === 'yesterday' ? 'Ayer' :
                                range === 'week' ? '7 Días' :
                                    range === 'month' ? '30 Días' : 'Personalizado'}
                    </button>
                ))}

                {dateRange === 'custom' && (
                    <div className="flex items-center gap-2 ml-2 animate-in slide-in-from-left-5">
                        <input
                            type="date"
                            value={customStart}
                            onChange={(e) => setCustomStart(e.target.value)}
                            className="input-field py-1"
                        />
                        <span className="text-[var(--text-muted)]">-</span>
                        <input
                            type="date"
                            value={customEnd}
                            onChange={(e) => setCustomEnd(e.target.value)}
                            className="input-field py-1"
                        />
                        <button onClick={loadData} className="btn-primary !py-1">
                            <Search size={16} />
                        </button>
                    </div>
                )}

                <div className="flex-1" />

                <button onClick={exportToExcel} className="btn-secondary !py-1 flex items-center gap-2">
                    <Download size={16} /> Exportar Excel
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Pedidos Entregados"
                    value={data.summary?.total_orders || 0}
                    color="text-purple-400"
                    icon={<Truck size={16} />}
                    isCurrency={false}
                />
                <StatCard
                    title="Total Vendido"
                    value={data.summary?.total_revenue || 0}
                    color="text-green-400"
                    icon={<DollarSign size={16} />}
                    currency={currentCurrency}
                />
                <StatCard
                    title="Abonos Recibidos"
                    value={data.summary?.total_deposits || 0}
                    color="text-yellow-400"
                    icon={<DollarSign size={16} />}
                    currency={currentCurrency}
                />
                <StatCard
                    title="Ticket Promedio"
                    value={data.summary?.avg_ticket || 0}
                    color="text-blue-400"
                    icon={<TrendingUp size={16} />}
                    currency={currentCurrency}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Ventas por día */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold mb-4 text-white">Ventas por Día (Entregados)</h3>
                    <div className="h-64 w-full">
                        {dailyRevenue.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
                                Sin ventas entregadas en el período
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dailyRevenue}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                    <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1a1a2e', borderColor: '#3b82f6', color: '#fff' }}
                                        formatter={(value) => [formatCurrency(value, currentCurrency), 'Vendido']}
                                    />
                                    <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Top Products */}
                <div className="glass-card p-0 overflow-hidden flex flex-col h-full">
                    <div className="p-4 border-b border-[var(--glass-border)]">
                        <h3 className="text-lg font-bold text-white">Top Productos Encargados</h3>
                    </div>
                    <div className="overflow-y-auto flex-1 max-h-[300px]">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs font-semibold sticky top-0 backdrop-blur-md">
                                <tr>
                                    <th className="px-4 py-2">Producto</th>
                                    <th className="px-4 py-2 text-right">Cant.</th>
                                    <th className="px-4 py-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {data.byProduct.slice(0, 10).map((p, idx) => (
                                    <tr key={idx} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="px-4 py-2 text-gray-300">{p.name}</td>
                                        <td className="px-4 py-2 text-right text-white font-bold">{p.quantity} {p.billing_unit === 'kg' ? 'kg' : 'un'}</td>
                                        <td className="px-4 py-2 text-right text-green-400">{formatCurrency(p.revenue, currentCurrency)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Top Clients */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="p-4 border-b border-[var(--glass-border)]">
                    <h3 className="text-lg font-bold text-white">Mejores Clientes (Encargos)</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-3">Cliente</th>
                                <th className="px-6 py-3 text-center">Teléfono</th>
                                <th className="px-6 py-3 text-center">Cant. Pedidos</th>
                                <th className="px-6 py-3 text-right">Total Gastado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {data.byClient.slice(0, 10).map((c, idx) => (
                                <tr key={idx} className="hover:bg-[var(--glass-bg)] transition-colors">
                                    <td className="px-6 py-3 font-medium text-white">{c.client_name || 'Cliente Casual'}</td>
                                    <td className="px-6 py-3 text-center text-gray-400">{c.phone || '-'}</td>
                                    <td className="px-6 py-3 text-center text-blue-300 font-bold">{c.orders_count}</td>
                                    <td className="px-6 py-3 text-right text-green-400 font-bold">{formatCurrency(c.total_spend, currentCurrency)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, color, icon, isCurrency = true, currency }) => (
    <div className="glass-card p-4 flex flex-col items-center justify-center text-center hover:scale-[1.02] transition-transform duration-200">
        <div className={cn("p-3 rounded-full bg-white/5 mb-3 shadow-[0_0_15px_rgba(0,0,0,0.3)]", color)}>{icon}</div>
        <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">{title}</p>
        <p className={cn("text-2xl font-bold font-mono mt-1 drop-shadow-sm", color)}>
            {isCurrency ? formatCurrency(value, currency) : value}
        </p>
    </div>
);

export default PreorderReports;
