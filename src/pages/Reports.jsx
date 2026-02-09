import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { format, isToday, isYesterday, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Search, Calendar, Download, DollarSign, TrendingUp, Percent, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { formatInCompanyTime, getNowInCompanyTime } from '../lib/dateHelpers';
import { formatCurrency } from '../utils/formatCurrency';

const Reports = () => {
    const { fetchProductProfitReport, currentCompanyTimezone, currentCurrency } = useStore();
    const [isLoading, setIsLoading] = useState(true);
    const [dateRange, setDateRange] = useState('today'); // today, yesterday, custom
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [items, setItems] = useState([]);
    const [stats, setStats] = useState({
        totalCost: 0,
        totalSales: 0,
        totalProfit: 0,
        profitMargin: 0
    });

    useEffect(() => {
        loadData();
    }, [dateRange, customStart, customEnd]);

    // Removed manual handler

    const loadData = async () => {
        setIsLoading(true);
        try {
            // Determine start and end dates in company timezone
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
            } else if (dateRange === 'custom') {
                if (!customStart || !customEnd) {
                    setIsLoading(false);
                    return;
                }
                startDate = customStart;
                endDate = customEnd;
            }

            const reportData = await fetchProductProfitReport(startDate, endDate);

            // Calculate totals from aggregated data
            const totalCost = reportData.reduce((acc, item) => acc + (item.totalCost || 0), 0);
            const totalSales = reportData.reduce((acc, item) => acc + (item.totalSale || 0), 0);
            const totalProfit = reportData.reduce((acc, item) => acc + (item.totalProfit || 0), 0);
            const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

            setStats({
                totalCost,
                totalSales,
                totalProfit,
                profitMargin
            });

            setItems(reportData);
        } catch (e) {
            console.error("Error loading sales report:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const exportToExcel = () => {
        const ws = XLSX.utils.json_to_sheet(items.map(item => ({
            'Fecha': item.day,
            'Producto': item.productName,
            'Codigo': item.barcode,
            'Cantidad': item.quantity,
            'Costo Prom. Unit': item.unitCost,
            'Precio Prom. Unit': item.unitPrice,
            'Total Venta': item.totalSale,
            'Total Costo': item.totalCost,
            'Ganancia': item.totalProfit
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Reporte de Utilidad");
        XLSX.writeFile(wb, `reporte_utilidad_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    const chartData = [
        { name: 'Costos', value: stats.totalCost, fill: '#ef4444' }, // Red
        { name: 'Ventas', value: stats.totalSales, fill: '#3b82f6' }, // Blue
        { name: 'Utilidad', value: stats.totalProfit, fill: '#10b981' }, // Green
    ];

    return (
        <div className="p-4 space-y-6 pb-20 md:pb-4 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] bg-clip-text text-transparent">
                        Reporte de Utilidad por Producto
                    </h1>
                    <p className="text-[var(--text-secondary)] text-sm">
                        Análisis detallado de rentabilidad y margen por item
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center bg-[var(--surface-light)] p-2 rounded-xl border border-[var(--glass-border)]">
                <button
                    onClick={() => setDateRange('today')}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        dateRange === 'today'
                            ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    )}
                >
                    Hoy
                </button>
                <button
                    onClick={() => setDateRange('yesterday')}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        dateRange === 'yesterday'
                            ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    )}
                >
                    Ayer
                </button>
                <button
                    onClick={() => setDateRange('custom')}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        dateRange === 'custom'
                            ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    )}
                >
                    Personalizado
                </button>

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

                {/* Recalculate button removed as requested */}

                <button onClick={exportToExcel} className="btn-secondary !py-1 flex items-center gap-2">
                    <Download size={16} /> Exportar Excel
                </button>
            </div>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <StatCard title="Total Costos" value={stats.totalCost} color="text-red-400" icon={<TrendingUp size={16} />} currency={currentCurrency} />
                {/* Removed Discounts/Tax columns as they are not in daily profit table yet, or need calculation */}
                <StatCard title="Total Ventas" value={stats.totalSales} color="text-blue-400" icon={<DollarSign size={16} />} currency={currentCurrency} />
                <StatCard title="Total Utilidad" value={stats.totalProfit} color="text-green-400" icon={<DollarSign size={16} />} currency={currentCurrency} />
                <StatCard title="% Utilidad" value={`${stats.profitMargin.toFixed(2)}%`} isCurrency={false} color="text-purple-400" icon={<Percent size={16} />} currency={currentCurrency} />
            </div>

            {/* Chart */}
            <div className="glass-card p-4 h-80 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis type="number" stroke="#9ca3af" />
                        <YAxis dataKey="name" type="category" stroke="#9ca3af" width={80} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1a1a2e', borderColor: '#3b82f6', color: '#fff' }}
                            formatter={(value) => formatCurrency(value, currentCurrency)}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={40} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Detailed Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="p-4 border-b border-[var(--glass-border)]">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileText size={18} className="text-[var(--color-primary)]" /> Detalle de Productos (Resumen Diario)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-3">Fecha</th>
                                <th className="px-6 py-3">Producto</th>
                                <th className="px-6 py-3">Cód. Barra</th>
                                <th className="px-6 py-3 text-right">Cant.</th>
                                <th className="px-6 py-3 text-right">Costo Prom.</th>
                                <th className="px-6 py-3 text-right">Precio Prom.</th>
                                <th className="px-6 py-3 text-right">Total Venta</th>
                                <th className="px-6 py-3 text-right">Utilidad</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {isLoading ? (
                                <tr><td colSpan="8" className="text-center py-8">Cargando datos...</td></tr>
                            ) : items.length === 0 ? (
                                <tr><td colSpan="8" className="text-center py-8 text-gray-500">No hay ventas registradas.</td></tr>
                            ) : (
                                items.map((item, idx) => (
                                    <tr key={`${item.day}-${item.productId}-${idx}`} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="px-6 py-3 text-gray-400">{item.day}</td>
                                        <td className="px-6 py-3 font-medium text-white">{item.productName}</td>
                                        <td className="px-6 py-3 text-gray-500">{item.barcode}</td>
                                        <td className="px-6 py-3 text-right text-white font-bold">{item.quantity}</td>
                                        <td className="px-6 py-3 text-right text-gray-400">{formatCurrency(item.unitCost, currentCurrency)}</td>
                                        <td className="px-6 py-3 text-right text-blue-300">{formatCurrency(item.unitPrice, currentCurrency)}</td>
                                        <td className="px-6 py-3 text-right text-blue-300 font-bold">{formatCurrency(item.totalSale, currentCurrency)}</td>
                                        <td className={cn(
                                            "px-6 py-3 text-right font-bold font-mono",
                                            item.totalProfit >= 0 ? "text-green-400" : "text-red-400"
                                        )}>
                                            {formatCurrency(item.totalProfit, currentCurrency)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, color, icon, isCurrency = true, currency }) => (
    <div className="glass-card p-4 flex flex-col items-center justify-center text-center">
        <div className={cn("p-2 rounded-full bg-white/5 mb-2", color)}>{icon}</div>
        <p className="text-xs text-gray-400 uppercase tracking-wider">{title}</p>
        <p className={cn("text-xl font-bold font-mono mt-1", color)}>
            {isCurrency ? formatCurrency(value, currency) : value}
        </p>
    </div>
);

export default Reports;
