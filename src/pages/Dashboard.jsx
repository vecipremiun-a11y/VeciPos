import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStore } from '../store/useStore';
import { format, isToday, isSameMonth, parseISO, subDays, startOfDay, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

const Dashboard = () => {
    const { products, sales } = useStore();

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
                    <h3 className="text-gray-400 text-sm mb-1">Ventas Hoy</h3>
                    <p className="text-2xl font-bold text-white neon-text">
                        ${stats.totalSalesToday.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-xs text-[var(--color-primary)]">
                        {stats.ticketsToday} tickets procesados
                    </div>
                </div>

                {/* Ventas Mes */}
                <div className="glass-card">
                    <h3 className="text-gray-400 text-sm mb-1">Ventas del Mes</h3>
                    <p className="text-2xl font-bold text-white neon-text">
                        ${stats.totalSalesMonth.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-xs text-gray-500">Acumulado mensual</div>
                </div>

                {/* Utilidad Hoy */}
                <div className="glass-card">
                    <h3 className="text-gray-400 text-sm mb-1">Utilidad Hoy (Neta)</h3>
                    <p className="text-2xl font-bold text-green-400 neon-text">
                        ${stats.utilityToday.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-xs text-gray-500">Post-impuestos y costo</div>
                </div>

                {/* Tickets Hoy (4th Card as requested) */}
                <div className="glass-card">
                    <h3 className="text-gray-400 text-sm mb-1">Tickets de Hoy</h3>
                    <p className="text-2xl font-bold text-blue-400 neon-text">{stats.ticketsToday}</p>
                    <div className="mt-2 text-xs text-gray-500">Transacciones completadas</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="glass-card lg:col-span-2 h-[400px] flex flex-col">
                    <h3 className="text-lg font-semibold mb-4 text-white">Resumen de Ventas (30 Días)</h3>
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
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
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
                    <h3 className="text-lg font-semibold mb-4 text-white">Actividad Reciente</h3>
                    <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                        {sales.length === 0 ? (
                            <p className="text-gray-500 text-center py-10">No hay ventas registradas.</p>
                        ) : (
                            sales.slice(0, 20).map((sale) => (
                                <div key={sale.id} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-white/5">
                                    <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/20 flex flex-col items-center justify-center text-[var(--color-primary)] text-xs font-bold">
                                        <span>#{String(sale.id).slice(-4)}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white truncate font-medium">
                                            {sale.method === 'Mixto' ? 'Pago Mixto' : sale.method || 'Venta'}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {format(parseISO(sale.date), "d MMM, HH:mm", { locale: es })}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-white">
                                            ${parseFloat(sale.total).toLocaleString('es-CL')}
                                        </p>
                                        <p className="text-[10px] text-gray-400">
                                            {sale.items.length} prod.
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
