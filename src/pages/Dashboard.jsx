import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingDown, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import { format, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatInCompanyTime } from '../lib/dateHelpers';

const Dashboard = () => {
    const {
        fetchDashboardData,
        currentCompanyTimezone,
        activeCompanyId,
        activeRegisters
    } = useStore();

    // Separate state for different data needs
    const [todayUtility, setTodayUtility] = React.useState(0);        // ← NUEVO

    const [todayStats, setTodayStats] = React.useState(null);        // NUEVO
    const [monthlyStats, setMonthlyStats] = React.useState([]); // For Chart & Month Total
    const [recentSales, setRecentSales] = React.useState([]); // For Activity List
    const [lowStockProducts, setLowStockProducts] = React.useState([]);
    const [topProducts, setTopProducts] = React.useState([]);         // ← NUEVO

    React.useEffect(() => {
        const loadDashboardData = async () => {
            console.log('🔄 Loading dashboard data...');
            const data = await fetchDashboardData();

            if (data) {
                // Procesar ventas de hoy para cálculo de utilidad

                setTodayUtility(data.todayUtility);      // ← NUEVO
                setTodayStats(data.todayStats);       // NUEVO - Stats precalculados
                setMonthlyStats(data.monthlyStats);   // NUEVO - Stats por día
                setRecentSales(data.recentSales);
                setLowStockProducts(data.lowStockProducts);
                setTopProducts(data.topProducts);        // ← NUEVO

                console.log('✅ Dashboard data loaded');
            }
        };

        loadDashboardData();

        const interval = setInterval(() => {
            loadDashboardData();
        }, 60000); // Cada 60 segundos

        return () => clearInterval(interval);
    }, [fetchDashboardData, activeCompanyId]);

    // Calculate Real-time Stats
    const stats = useMemo(() => {
        const now = new Date();

        // 1. Stats del día (YA VIENEN CALCULADOS - SUPER RÁPIDO)
        const totalSalesToday = todayStats?.total_sales || 0;
        const ticketsToday = todayStats?.total_orders || 0;

        console.log('📊 Today stats:', { totalSalesToday, ticketsToday });

        // 2. Utilidad del día (YA VIENE CALCULADA)
        const utilityToday = todayUtility;

        // 3. Stats del mes (SUMAR monthlyStats - solo ~30 registros)
        const totalSalesMonth = monthlyStats.reduce((acc, day) => {
            return acc + (parseFloat(day.total_sales) || 0);
        }, 0);

        console.log('📊 Month total:', totalSalesMonth);

        // 4. Chart Data (usar monthlyStats directamente)
        const salesByDay = {};
        monthlyStats.forEach(day => {
            salesByDay[day.day] = parseFloat(day.total_sales) || 0;
        });

        // Generar días del MES ACTUAL para el gráfico
        const startOfMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const daysInMonth = [];
        let currentIterDate = new Date(startOfMonthDate);

        // Iterar desde el 1 del mes hasta hoy
        while (currentIterDate <= now) {
            daysInMonth.push(new Date(currentIterDate));
            currentIterDate.setDate(currentIterDate.getDate() + 1);
        }

        const chartData = daysInMonth.map(d => {
            const dayKey = formatInCompanyTime(d, currentCompanyTimezone, 'yyyy-MM-dd');
            const displayLabel = formatInCompanyTime(d, currentCompanyTimezone, 'dd MMM');

            return {
                name: displayLabel,
                sales: salesByDay[dayKey] || 0
            };
        });

        return {
            ticketsToday,
            totalSalesToday,
            utilityToday,
            totalSalesMonth,
            chartData
        };
    }, [todayStats, monthlyStats, currentCompanyTimezone]);



    return (
        <div className="space-y-6">
            {/* Subscription Banner */}
            {(() => {
                // Logic directly in render to use existing hooks/store
                // We need to fetch company info. But 'activeCompanyId' is available.
                // We might need to fetch detailed status if not in 'activeCompany' object.
                // However, let's assume we can check a store selector or we fetched it.
                // For simplicity, we can fetch it in useEffect or check availableCompanies which has data?
                // availableCompanies only has basic info.
                // Let's use a quick state for banner info.
                return null; // Will replace standard render with Component logic below
            })()}

            <SubscriptionBanner />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
                {/* Ventas Hoy */}
                <div className="glass-card p-4">
                    <h3 className="text-[var(--color-text-muted)] text-xs md:text-sm mb-1">Ventas Hoy</h3>
                    <p className="text-lg sm:text-2xl font-bold text-[var(--color-text)] neon-text truncate">
                        ${stats.totalSalesToday.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-[10px] md:text-xs text-[var(--color-primary)]">
                        {stats.ticketsToday} tickets procesados
                    </div>
                </div>

                {/* Ventas Mes */}
                <div className="glass-card p-4">
                    <h3 className="text-[var(--color-text-muted)] text-xs md:text-sm mb-1">Ventas del Mes</h3>
                    <p className="text-lg sm:text-2xl font-bold text-[var(--color-text)] neon-text truncate">
                        ${stats.totalSalesMonth.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-[10px] md:text-xs text-[var(--color-text-muted)]">Acumulado mensual</div>
                </div>

                {/* Utilidad Hoy */}
                <div className="glass-card p-4">
                    <h3 className="text-[var(--color-text-muted)] text-xs md:text-sm mb-1">Utilidad Hoy (Neta)</h3>
                    <p className="text-lg sm:text-2xl font-bold text-green-400 neon-text truncate">
                        ${stats.utilityToday.toLocaleString('es-CL')}
                    </p>
                    <div className="mt-2 text-[10px] md:text-xs text-[var(--color-text-muted)]">Post-impuestos y costo</div>
                </div>

                {/* Tickets Hoy (4th Card as requested) */}
                <div className="glass-card p-4">
                    <h3 className="text-[var(--color-text-muted)] text-xs md:text-sm mb-1">Tickets de Hoy</h3>
                    <p className="text-lg sm:text-2xl font-bold text-blue-400 neon-text truncate">{stats.ticketsToday}</p>
                    <div className="mt-2 text-[10px] md:text-xs text-[var(--color-text-muted)]">Transacciones completadas</div>
                </div>
            </div>

            {/* Charts Section (Moved to Middle) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="glass-card lg:col-span-2 h-[400px] flex flex-col">
                    <h3 className="text-lg font-semibold mb-4 text-[var(--color-text)]">Resumen de Ventas (Mes Actual)</h3>
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
                        {recentSales.map((sale) => ( // Using recentSales instead of broad 'sales'
                            <div key={sale.id} className="flex items-center gap-3 p-3 hover:bg-[var(--glass-bg)] rounded-lg transition-colors border border-transparent hover:border-[var(--glass-border)]">
                                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/20 flex flex-col items-center justify-center text-[var(--color-primary)] text-xs font-bold">
                                    <span>#{String(sale.id).slice(-4)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-[var(--color-text)] truncate font-medium">
                                        {sale.method === 'Mixto' ? 'Pago Mixto' : sale.method || 'Venta'}
                                    </p>
                                    <p className="text-xs text-[var(--color-text-muted)]">
                                        {formatInCompanyTime(sale.date, currentCompanyTimezone, "d MMM, HH:mm")}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-[var(--color-text)]">
                                        ${parseFloat(sale.total).toLocaleString('es-CL')}
                                    </p>
                                    <p className="text-[10px] text-[var(--color-text-muted)]">
                                        {(sale.items && sale.items.length) || 0} prod.
                                    </p>
                                </div>
                            </div>
                        ))}
                        {recentSales.length === 0 && (
                            <p className="text-[var(--color-text-muted)] text-center py-10">No hay ventas recientes.</p>
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
                            {topProducts.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
                                    No hay ventas hoy
                                </div>
                            ) : (
                                topProducts.map((p, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-black/20 border border-[var(--glass-border)]">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <span className="text-[var(--color-primary)] font-bold text-sm w-4">{idx + 1}</span>
                                            <div className="min-w-0">
                                                <p className="text-[var(--color-text)] text-xs font-bold truncate">{p.name}</p>
                                                <p className="text-[var(--color-text-muted)] text-[10px]">{p.category || 'General'}</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="block text-[var(--color-text)] font-bold text-xs">
                                                {p.total_quantity} {p.unit === 'Kg' ? 'kg' : 'und'}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 2. Sin Stock (Stock 0) */}
                    <div className="glass-card flex flex-col h-[300px] border-l-4 border-l-red-500 p-0 overflow-hidden">
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                            <h4 className="text-red-500 font-bold flex items-center gap-2 text-sm uppercase tracking-wider">
                                <AlertTriangle size={16} /> Sin Stock
                            </h4>
                            <span className="bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5 rounded-full border border-red-500/20 font-bold">
                                {lowStockProducts.length}
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                            {(() => {
                                if (lowStockProducts.length === 0) return <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">Todos los productos tienen stock</div>;

                                return lowStockProducts.map(p => (
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
                                                        Abierta: {formatInCompanyTime(reg.opening_time, currentCompanyTimezone, 'HH:mm')} hrs
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


const SubscriptionBanner = () => {
    const { activeCompanyId, checkSubscriptionStatus } = useStore();
    const [info, setInfo] = React.useState(null);

    React.useEffect(() => {
        if (activeCompanyId && checkSubscriptionStatus) {
            checkSubscriptionStatus(activeCompanyId).then(setInfo);
        }
    }, [activeCompanyId, checkSubscriptionStatus]);

    if (!info || info.status !== 'trial') return null;

    const trialEnd = new Date(info.trial_ends_at);
    const now = new Date();
    const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) return null;

    return (
        <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                    <Clock size={20} />
                </div>
                <div>
                    <h3 className="text-blue-400 font-bold text-sm">Periodo de Prueba Activo</h3>
                    <p className="text-blue-500/70 text-xs">
                        Te quedan <span className="text-white font-bold">{daysLeft} días</span> de prueba gratuita.
                    </p>
                </div>
            </div>
            <button
                onClick={() => window.location.href = '/select-plan'}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors"
            >
                Suscribirme Ahora
            </button>
        </div>
    );
};

export default Dashboard;
