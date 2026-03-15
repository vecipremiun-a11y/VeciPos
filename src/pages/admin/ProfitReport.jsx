import React, { useState, useEffect } from 'react';
import {
    TrendingUp, TrendingDown, DollarSign, Package, Users,
    Calendar, Filter, Download, ArrowUp, ArrowDown
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const ProfitReport = () => {
    const {
        activeCompanyId,
        currentCurrency,
        getSalesSummaryByRange,
        getTopProducts,
        getBestMarginProducts,
        getVendorRanking,
        compareSalesWithPreviousPeriod
    } = useStore();

    const [dateRange, setDateRange] = useState('month');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Datos
    const [metrics, setMetrics] = useState({
        totalRevenue: 0,
        totalCost: 0,
        totalTax: 0,
        totalProfit: 0,
        profitMargin: 0,
        previousProfit: 0,
        profitChange: 0
    });
    const [dailyData, setDailyData] = useState([]);
    const [topProducts, setTopProducts] = useState([]);
    const [topVendors, setTopVendors] = useState([]);
    const [marginProducts, setMarginProducts] = useState([]);

    useEffect(() => {
        setDefaultDates();
    }, [dateRange]);

    useEffect(() => {
        if (startDate && endDate) {
            loadReportData();
        }
    }, [startDate, endDate]);

    const setDefaultDates = () => {
        const today = new Date();
        const end = today.toLocaleDateString('en-CA');
        let start;

        switch (dateRange) {
            case 'today':
                start = end;
                break;
            case 'week':
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                start = weekAgo.toLocaleDateString('en-CA');
                break;
            case 'month':
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                start = monthAgo.toLocaleDateString('en-CA');
                break;
            case 'year':
                const yearAgo = new Date(today);
                yearAgo.setFullYear(yearAgo.getFullYear() - 1);
                start = yearAgo.toLocaleDateString('en-CA');
                break;
            default:
                start = end;
        }

        setStartDate(start);
        setEndDate(end);
    };

    const loadReportData = async () => {
        setIsLoading(true);

        try {
            // 1. Obtener resumen del periodo
            const summaryResult = await getSalesSummaryByRange(startDate, endDate, activeCompanyId);

            if (summaryResult.success) {
                const totals = summaryResult.totals;
                const margin = totals.totalAmount > 0
                    ? (totals.totalProfit / totals.totalAmount) * 100
                    : 0;

                // 2. Comparar con periodo anterior
                const comparisonResult = await compareSalesWithPreviousPeriod(startDate, endDate, activeCompanyId);

                setMetrics({
                    totalRevenue: totals.totalAmount,
                    totalCost: totals.totalCost || 0,
                    totalTax: totals.totalTax || 0,
                    totalProfit: totals.totalProfit,
                    profitMargin: margin,
                    previousProfit: comparisonResult.success ? comparisonResult.comparison.previous.totalProfit : 0,
                    profitChange: comparisonResult.success ? comparisonResult.comparison.changes.profitChange : 0
                });

                // 3. Formatear datos diarios para gráfico
                const chartData = summaryResult.daily.map(day => ({
                    date: formatDateShort(day.date),
                    utilidad: day.total_profit,
                    ventas: day.total_amount,
                    margen: day.total_amount > 0 ? (day.total_profit / day.total_amount) * 100 : 0
                }));
                setDailyData(chartData);
            }

            // 4. Top productos por ganancia
            const productsResult = await getTopProducts(startDate, endDate, 10, activeCompanyId);
            if (productsResult.success) {
                setTopProducts(productsResult.products);
            }

            // 5. Top productos por margen
            const marginResult = await getBestMarginProducts(startDate, endDate, 10, activeCompanyId);
            if (marginResult.success) {
                setMarginProducts(marginResult.products);
            }

            // 6. Ranking de vendedores por utilidad
            const vendorsResult = await getVendorRanking(startDate, endDate, activeCompanyId);
            if (vendorsResult.success) {
                setTopVendors(vendorsResult.ranking);
            }

        } catch (error) {
            console.error('Error loading profit report:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatDateShort = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
    };

    const exportToExcel = () => {
        // TODO: Implementar exportación a Excel
        alert('Exportando a Excel...');
    };

    // Colores para gráficos
    const COLORS = ['#00C49F', '#0088FE', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D'];

    return (
        <div className="min-h-screen bg-[#0a0a1a] p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] mb-2">
                        Reporte de Utilidad
                    </h1>
                    <p className="text-[var(--color-text-muted)]">
                        Análisis completo de ganancias y rentabilidad
                    </p>
                </div>

                <button
                    onClick={exportToExcel}
                    className="btn-secondary flex items-center gap-2"
                >
                    <Download size={18} />
                    Exportar Excel
                </button>
            </div>

            {/* Filtros */}
            <div className="glass-card mb-6 p-4">
                <div className="flex flex-wrap gap-4 items-end">
                    {/* Selector de periodo rápido */}
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-2">
                            Periodo
                        </label>
                        <div className="flex gap-2">
                            {['today', 'week', 'month', 'year', 'custom'].map(period => (
                                <button
                                    key={period}
                                    onClick={() => setDateRange(period)}
                                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${dateRange === period
                                            ? 'bg-[var(--color-primary)] text-white'
                                            : 'bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'
                                        }`}
                                >
                                    {period === 'today' && 'Hoy'}
                                    {period === 'week' && '7 días'}
                                    {period === 'month' && '30 días'}
                                    {period === 'year' && '1 año'}
                                    {period === 'custom' && 'Personalizado'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Fechas personalizadas */}
                    {dateRange === 'custom' && (
                        <>
                            <div>
                                <label className="block text-sm text-[var(--color-text-muted)] mb-2">
                                    Fecha Inicio
                                </label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="glass-input"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-[var(--color-text-muted)] mb-2">
                                    Fecha Fin
                                </label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="glass-input"
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="text-[var(--color-text-muted)]">Cargando datos...</div>
                </div>
            ) : (
                <>
                    {/* Métricas Principales */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                        {/* Ventas Totales */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-[var(--color-text-muted)]">Ventas Totales</span>
                                <DollarSign className="text-blue-400" size={20} />
                            </div>
                            <div className="text-2xl font-bold text-[var(--color-text)] mb-1">
                                {formatCurrency(metrics.totalRevenue, currentCurrency)}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                                Ingresos del periodo
                            </div>
                        </div>

                        {/* Costo Total */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-[var(--color-text-muted)]">Costo Total</span>
                                <Package className="text-orange-400" size={20} />
                            </div>
                            <div className="text-2xl font-bold text-[var(--color-text)] mb-1">
                                {formatCurrency(metrics.totalCost, currentCurrency)}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                                Costo de productos vendidos
                            </div>
                        </div>

                        {/* Impuestos */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-[var(--color-text-muted)]">Impuestos</span>
                                <DollarSign className="text-yellow-400" size={20} />
                            </div>
                            <div className="text-2xl font-bold text-yellow-400 mb-1">
                                {formatCurrency(metrics.totalTax, currentCurrency)}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                                Total impuestos del periodo
                            </div>
                        </div>

                        {/* Utilidad Total */}
                        <div className="glass-card p-6 border-2 border-green-500/30">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-[var(--color-text-muted)]">Utilidad Total</span>
                                <TrendingUp className="text-green-400" size={20} />
                            </div>
                            <div className="text-2xl font-bold text-green-400 mb-1">
                                {formatCurrency(metrics.totalProfit, currentCurrency)}
                            </div>
                            <div className={`text-xs flex items-center gap-1 ${metrics.profitChange >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                {metrics.profitChange >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                {Math.abs(metrics.profitChange).toFixed(1)}% vs periodo anterior
                            </div>
                        </div>

                        {/* Margen de Utilidad */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-[var(--color-text-muted)]">Margen</span>
                                <TrendingUp className="text-purple-400" size={20} />
                            </div>
                            <div className="text-2xl font-bold text-[var(--color-text)] mb-1">
                                {metrics.profitMargin.toFixed(1)}%
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                                Rentabilidad promedio
                            </div>
                        </div>
                    </div>

                    {/* Gráficos */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {/* Gráfico de Utilidad por Día */}
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">
                                Evolución de Utilidad
                            </h3>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={dailyData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                    <XAxis
                                        dataKey="date"
                                        stroke="#888"
                                        style={{ fontSize: '12px' }}
                                    />
                                    <YAxis
                                        stroke="#888"
                                        style={{ fontSize: '12px' }}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#1a1a2e',
                                            border: '1px solid #333',
                                            borderRadius: '8px'
                                        }}
                                        formatter={(value) => formatCurrency(value, currentCurrency)}
                                    />
                                    <Legend />
                                    <Line
                                        type="monotone"
                                        dataKey="utilidad"
                                        stroke="#00C49F"
                                        strokeWidth={3}
                                        name="Utilidad"
                                        dot={{ fill: '#00C49F' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="ventas"
                                        stroke="#0088FE"
                                        strokeWidth={2}
                                        name="Ventas"
                                        strokeDasharray="5 5"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Gráfico de Margen por Día */}
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">
                                Margen de Rentabilidad
                            </h3>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={dailyData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                    <XAxis
                                        dataKey="date"
                                        stroke="#888"
                                        style={{ fontSize: '12px' }}
                                    />
                                    <YAxis
                                        stroke="#888"
                                        style={{ fontSize: '12px' }}
                                        label={{ value: '%', angle: -90, position: 'insideLeft' }}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#1a1a2e',
                                            border: '1px solid #333',
                                            borderRadius: '8px'
                                        }}
                                        formatter={(value) => `${value.toFixed(1)}%`}
                                    />
                                    <Bar
                                        dataKey="margen"
                                        fill="#8884D8"
                                        name="Margen %"
                                        radius={[8, 8, 0, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Tablas */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {/* Top Productos por Ganancia */}
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                                <TrendingUp className="text-green-400" size={20} />
                                Top 10 Productos por Ganancia
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-[var(--glass-border)]">
                                            <th className="text-left py-2 text-xs text-[var(--color-text-muted)]">#</th>
                                            <th className="text-left py-2 text-xs text-[var(--color-text-muted)]">Producto</th>
                                            <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Vendidos</th>
                                            <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Utilidad</th>
                                            <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Margen</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topProducts.map((product, index) => (
                                            <tr
                                                key={product.product_id}
                                                className="border-b border-[var(--glass-border)] hover:bg-white/5 transition-colors"
                                            >
                                                <td className="py-3 text-sm text-[var(--color-text-muted)]">
                                                    {index + 1}
                                                </td>
                                                <td className="py-3 text-sm text-[var(--color-text)] font-medium">
                                                    {product.product_name}
                                                </td>
                                                <td className="py-3 text-sm text-[var(--color-text)] text-right">
                                                    {product.total_sold}
                                                </td>
                                                <td className="py-3 text-sm text-green-400 font-semibold text-right">
                                                    {formatCurrency(product.total_profit, currentCurrency)}
                                                </td>
                                                <td className="py-3 text-sm text-[var(--color-text)] text-right">
                                                    {product.avg_margin?.toFixed(1) || 0}%
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Top Productos por Margen */}
                        <div className="glass-card p-6">
                            <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                                <Package className="text-purple-400" size={20} />
                                Productos con Mejor Margen
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-[var(--glass-border)]">
                                            <th className="text-left py-2 text-xs text-[var(--color-text-muted)]">#</th>
                                            <th className="text-left py-2 text-xs text-[var(--color-text-muted)]">Producto</th>
                                            <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Margen</th>
                                            <th className="text-right py-2 text-xs text-[var(--color-text-muted)]">Utilidad</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {marginProducts.map((product, index) => (
                                            <tr
                                                key={product.product_id}
                                                className="border-b border-[var(--glass-border)] hover:bg-white/5 transition-colors"
                                            >
                                                <td className="py-3 text-sm text-[var(--color-text-muted)]">
                                                    {index + 1}
                                                </td>
                                                <td className="py-3 text-sm text-[var(--color-text)] font-medium">
                                                    {product.product_name}
                                                </td>
                                                <td className="py-3 text-sm text-right">
                                                    <span className={`px-2 py-1 rounded ${product.avg_margin > 50
                                                            ? 'bg-green-500/20 text-green-400'
                                                            : product.avg_margin > 30
                                                                ? 'bg-blue-500/20 text-blue-400'
                                                                : 'bg-yellow-500/20 text-yellow-400'
                                                        }`}>
                                                        {product.avg_margin?.toFixed(1) || 0}%
                                                    </span>
                                                </td>
                                                <td className="py-3 text-sm text-green-400 font-semibold text-right">
                                                    {formatCurrency(product.total_profit, currentCurrency)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Ranking de Vendedores */}
                    <div className="glass-card p-6">
                        <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                            <Users className="text-blue-400" size={20} />
                            Ranking de Vendedores por Utilidad Generada
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {topVendors.slice(0, 6).map((vendor, index) => (
                                <div
                                    key={vendor.user_id}
                                    className="bg-white/5 rounded-lg p-4 border border-[var(--glass-border)] hover:border-[var(--color-primary)] transition-all"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                                                    index === 1 ? 'bg-gray-400/20 text-gray-400' :
                                                        index === 2 ? 'bg-orange-500/20 text-orange-400' :
                                                            'bg-blue-500/20 text-blue-400'
                                                }`}>
                                                {index + 1}
                                            </div>
                                            <span className="font-semibold text-[var(--color-text)]">
                                                {vendor.user_name}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--color-text-muted)]">Ventas:</span>
                                            <span className="text-[var(--color-text)] font-semibold">
                                                {vendor.total_sales}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--color-text-muted)]">Total:</span>
                                            <span className="text-[var(--color-text)] font-semibold">
                                                {formatCurrency(vendor.total_amount, currentCurrency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm pt-2 border-t border-[var(--glass-border)]">
                                            <span className="text-[var(--color-text-muted)]">Utilidad:</span>
                                            <span className="text-green-400 font-bold">
                                                {formatCurrency(vendor.total_profit, currentCurrency)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-[var(--color-text-muted)]">Ticket Prom:</span>
                                            <span className="text-[var(--color-text)]">
                                                {formatCurrency(vendor.avg_ticket, currentCurrency)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Distribución de Utilidad por Top 5 Productos (Gráfico de Dona) */}
                    <div className="glass-card p-6 mt-6">
                        <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">
                            Distribución de Utilidad (Top 5 Productos)
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={topProducts.slice(0, 5).map(p => ({
                                        name: p.product_name,
                                        value: p.total_profit
                                    }))}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {topProducts.slice(0, 5).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: '#1a1a2e',
                                        border: '1px solid #333',
                                        borderRadius: '8px'
                                    }}
                                    formatter={(value) => formatCurrency(value, currentCurrency)}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </div>
    );
};

export default ProfitReport;
