import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingDown, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import { format, isToday, isSameMonth, parseISO, subDays, startOfDay, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

const Dashboard = () => {
    const { products, sales, activeRegisters, fetchActiveRegisters } = useStore();

    React.useEffect(() => {
        // Initial fetch
        fetchActiveRegisters();

        // Polling every minute to keep balances fresh
        const interval = setInterval(() => {
            fetchActiveRegisters();
        }, 60000);

        return () => clearInterval(interval);
    }, [fetchActiveRegisters]);

    // Calculate Real-time Stats
    const stats = useMemo(() => {
        const today = new Date();
        const salesToday = sales.filter(s => isToday(parseISO(s.date)));
        const salesMonth = sales.filter(s => isSameMonth(parseISO(s.date), today));

        // 1. Total Sales Today
        const totalSalesToday = salesToday.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);

        // 2. Total Sales Month
        const totalSalesMonth = salesMonth.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);

        // 3. Tickets Today
        const ticketsToday = salesToday.length;

        // 4. Utility Today (Net Profit)
        // Utility = (Price / (1 + TaxRate)) - Cost
        const utilityToday = salesToday.reduce((acc, sale) => {
            const saleUtility = sale.items.reduce((itemAcc, item) => {
                const price = parseFloat(item.price) || 0;
                const cost = parseFloat(item.cost) || 0;
                const taxRate = parseFloat(item.tax_rate) || 0;
                const qty = item.quantity || 1;

                // Net Price (removing tax)
                const netPrice = price / (1 + (taxRate / 100)); // Assuming tax_rate is 19 for 19%

                // Profit per unit
                const profitPerUnit = netPrice - cost;

                return itemAcc + (profitPerUnit * qty);
            }, 0);
            return acc + saleUtility;
        }, 0);

        // Chart Data (Last 30 Days)
        const chartData = [];
        for (let i = 29; i >= 0; i--) {
            const d = subDays(today, i);
            const daySales = sales.filter(s => {
                const saleDate = parseISO(s.date);
                return format(saleDate, 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd');
            });
            const dayTotal = daySales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

            chartData.push({
                name: format(d, 'dd MMM', { locale: es }), // e.g. "21 Ene"
                sales: dayTotal
            });
        }

        return {
            totalSalesToday,
            totalSalesMonth,
            ticketsToday,
            utilityToday,
            chartData
        };
    }, [sales, products]); // Products dependency if we needed it, but sales usually has snapshot

    // Helper for stock (kept from before)
    const lowStockCount = products.filter(p => p.stock < 10).length;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Ventas Hoy */}
                <div className="glass-card">
                    <h3 className="text-[var(--color-text-muted)] text-sm mb-1">Ventas Hoy</h3>
                    <p className="text-2xl font-bold text-[var(--color-text)] neon-text">
                        ${stats.totalSalesToday.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-xs text-[var(--color-primary)]">
                        {stats.ticketsToday} tickets procesados
                    </div>
                </div>

                {/* Ventas Mes */}
                <div className="glass-card">
                    <h3 className="text-[var(--color-text-muted)] text-sm mb-1">Ventas del Mes</h3>
                    <p className="text-2xl font-bold text-[var(--color-text)] neon-text">
                        ${stats.totalSalesMonth.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)]">Acumulado mensual</div>
                </div>

                {/* Utilidad Hoy */}
                <div className="glass-card">
                    <h3 className="text-[var(--color-text-muted)] text-sm mb-1">Utilidad Hoy (Neta)</h3>
                    <p className="text-2xl font-bold text-green-400 neon-text">
                        ${stats.utilityToday.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)]">Post-impuestos y costo</div>
                </div>

                {/* Tickets Hoy (4th Card as requested) */}
                <div className="glass-card">
                    <h3 className="text-[var(--color-text-muted)] text-sm mb-1">Tickets de Hoy</h3>
                    <p className="text-2xl font-bold text-blue-400 neon-text">{stats.ticketsToday}</p>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)]">Transacciones completadas</div>
                </div>
            </div>

            {/* Charts Section (Moved to Middle) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="glass-card lg:col-span-2 h-[400px] flex flex-col">
                    <h3 className="text-lg font-semibold mb-4 text-[var(--color-text)]">Resumen de Ventas (30 Días)</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={stats.chartData}
                                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                            >
                                <defs>
                                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                                <XAxis dataKey="name" stroke="#888" tick={{ fill: '#888', fontSize: 12 }} />
                                <YAxis stroke="#888" tick={{ fill: '#888', fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                                    itemStyle={{ color: 'var(--color-primary)' }}
                                    formatter={(value) => [`$${value.toLocaleString('es-CL')}`, 'Ventas']}
                                />
                                <Area type="monotone" dataKey="sales" stroke="var(--color-primary)" fillOpacity={1} fill="url(#colorSales)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card h-[400px] overflow-hidden flex flex-col">
                    <h3 className="text-lg font-semibold mb-4 text-[var(--color-text)]">Actividad Reciente</h3>
                    <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                        {sales.length === 0 ? (
                            <p className="text-[var(--color-text-muted)] text-center py-10">No hay ventas registradas.</p>
                        ) : (
                            sales.slice(0, 20).map((sale) => (
                                <div key={sale.id} className="flex items-center gap-3 p-3 hover:bg-[var(--glass-bg)] rounded-lg transition-colors border border-transparent hover:border-[var(--glass-border)]">
                                    <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/20 flex flex-col items-center justify-center text-[var(--color-primary)] text-xs font-bold">
                                        <span>#{String(sale.id).slice(-4)}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-[var(--color-text)] truncate font-medium">
                                            {sale.method === 'Mixto' ? 'Pago Mixto' : sale.method || 'Venta'}
                                        </p>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            {format(parseISO(sale.date), "d MMM, HH:mm", { locale: es })}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-[var(--color-text)]">
                                            ${parseFloat(sale.total).toLocaleString('es-CL')}
                                        </p>
                                        <p className="text-[10px] text-[var(--color-text-muted)]">
                                            {sale.items.length} prod.
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Widgets Section (Bottom) */}
            <div className="space-y-3">
                <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2 px-1">
                    <AlertTriangle size={18} className="text-[var(--color-primary)]" />
                    Panel de Control en Tiempo Real
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* 1. Más Vendidos Hoy */}
                    <div className="glass-card flex flex-col h-[300px] border-l-4 border-l-[var(--color-primary)] p-0 overflow-hidden">
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                            <h4 className="text-[var(--color-primary)] font-bold flex items-center gap-2 text-sm uppercase tracking-wider">
                                <TrendingDown size={16} className="rotate-180" /> Más Vendidos (Hoy)
                            </h4>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                            {(() => {
                                const todaySales = sales.filter(s => isToday(parseISO(s.date)) && s.status !== 'cancelled');
                                const productStats = {};
                                todaySales.forEach(sale => {
                                    sale.items.forEach(item => {
                                        if (!productStats[item.id]) productStats[item.id] = { ...item, totalSold: 0 };
                                        productStats[item.id].totalSold += item.quantity;
                                    });
                                });
                                const sorted = Object.values(productStats).sort((a, b) => b.totalSold - a.totalSold).slice(0, 10);

                                if (sorted.length === 0) return <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">No hay ventas hoy</div>;

                                return sorted.map((p, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-black/20 border border-[var(--glass-border)]">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <span className="text-[var(--color-primary)] font-bold text-sm w-4">{idx + 1}</span>
                                            <div className="min-w-0">
                                                <p className="text-[var(--color-text)] text-xs font-bold truncate">{p.name}</p>
                                                <p className="text-[var(--color-text-muted)] text-[10px]">{p.category || 'General'}</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="block text-[var(--color-text)] font-bold text-xs">{p.totalSold} {p.unit === 'Kg' ? 'kg' : 'und'}</span>
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>

                    {/* 2. Sin Stock (Stock 0) */}
                    <div className="glass-card flex flex-col h-[300px] border-l-4 border-l-red-500 p-0 overflow-hidden">
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                            <h4 className="text-red-500 font-bold flex items-center gap-2 text-sm uppercase tracking-wider">
                                <AlertTriangle size={16} /> Sin Stock
                            </h4>
                            <span className="bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5 rounded-full border border-red-500/20 font-bold">
                                {products.filter(p => p.stock <= 0).length}
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                            {(() => {
                                const noStock = products.filter(p => p.stock <= 0).slice(0, 10);
                                if (noStock.length === 0) return <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">Todos los productos tienen stock</div>;

                                return noStock.map(p => (
                                    <div key={p.id} className="flex items-center justify-between p-2 rounded bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-colors">
                                        <div className="min-w-0">
                                            <p className="text-red-200 text-xs font-medium truncate">{p.name}</p>
                                            <p className="text-red-500/50 text-[10px]">SKU: {p.sku || 'N/A'}</p>
                                        </div>
                                        <span className="text-red-500 text-[10px] font-bold uppercase tracking-wider">Agotado</span>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>

                    {/* 3. Cajas Abiertas */}
                    <div className="glass-card flex flex-col h-[300px] border-l-4 border-l-orange-400 p-0 overflow-hidden">
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                            <h4 className="text-orange-400 font-bold flex items-center gap-2 text-sm uppercase tracking-wider">
                                <Clock size={16} /> Cajas Abiertas
                            </h4>
                            <span className="bg-orange-500/20 text-orange-400 text-[10px] px-2 py-0.5 rounded-full border border-orange-500/20 font-bold">
                                {activeRegisters?.length || 0}
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                            {(!activeRegisters || activeRegisters.length === 0) ? (
                                <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">No hay cajas abiertas</div>
                            ) : (
                                activeRegisters.map(reg => (
                                    <div key={reg.id} className="p-3 rounded bg-orange-500/5 border border-orange-500/10 flex flex-col gap-2">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-xs">
                                                    {reg.user_name ? reg.user_name.substring(0, 2).toUpperCase() : 'US'}
                                                </div>
                                                <div>
                                                    <p className="text-[var(--color-text)] text-xs font-bold">{reg.user_name || 'Usuario'}</p>
                                                    <p className="text-[var(--color-text-muted)] text-[10px]">
                                                        Abierta: {format(parseISO(reg.opening_time), 'HH:mm')} hrs
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded border border-green-500/20">
                                                Online
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-end border-t border-[var(--glass-border)] pt-2">
                                            <span className="text-[var(--color-text-muted)] text-[10px]">Saldo Actual</span>
                                            <span className="text-orange-400 font-bold text-sm">
                                                ${(reg.currentBalance || 0).toLocaleString('es-CL')}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div >
    );
};

export default Dashboard;
