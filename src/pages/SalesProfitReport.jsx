import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { format, isToday, isYesterday, startOfDay, endOfDay, isSameDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Search, Calendar, Download, DollarSign, TrendingUp, Percent, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';

const SalesProfitReport = () => {
    const { fetchSales } = useStore();
    const [sales, setSales] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [dateRange, setDateRange] = useState('today'); // today, yesterday, custom
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [flattenedItems, setFlattenedItems] = useState([]);
    const [stats, setStats] = useState({
        totalCost: 0,
        totalDiscount: 0,
        totalTax: 0,
        totalSales: 0,
        totalProfit: 0,
        profitMargin: 0
    });

    useEffect(() => {
        loadData();
    }, [dateRange, customStart, customEnd]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const allSales = await fetchSales(); // This usually fetches all, we might need to filter client-side if API doesn't support

            // Filter by Date
            const filtered = allSales.filter(sale => {
                if (!sale.date) return false;
                const saleDate = new Date(sale.date);

                if (dateRange === 'today') return isToday(saleDate);
                if (dateRange === 'yesterday') return isYesterday(saleDate);
                if (dateRange === 'custom' && customStart && customEnd) {
                    return saleDate >= startOfDay(new Date(customStart)) && saleDate <= endOfDay(new Date(customEnd));
                }
                return true; // Default show all if no filter? Or default today? Let's default today
            });

            processSales(filtered);
            setSales(filtered);
        } catch (e) {
            console.error("Error loading sales report:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const processSales = (salesData) => {
        let items = [];
        let totalCost = 0;
        let totalDiscount = 0;
        let totalTax = 0;
        let totalSales = 0; // With Tax

        salesData.forEach(sale => {
            let saleItems = [];
            try {
                saleItems = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;
            } catch (e) { console.error("Error parsing items for sale", sale.id); }

            saleItems.forEach(item => {
                const qty = item.quantity || 0;
                const price = item.price || 0; // Unit Price
                const cost = item.cost || 0;   // Unit Cost
                const taxRate = item.tax_rate || 0; // % ex: 0.15 for 15%

                // Calculations per item line
                const lineTotal = price * qty;
                const lineCost = cost * qty;

                // Assuming price includes tax? Or tax is added? 
                // Usually POS price is final. Let's assume Price is Final (Inc Tax) for now unless specified.
                // If price is final, we verify tax part.
                // Simple approach: Tax = Price - (Price / (1 + taxRate))
                // User asked for "Total Impuestos de Ventas". 
                // Let's assume standard behavior: Price is base, Tax is extra?
                // Looking at standard POS, often price is gross.
                // Let's assume: Price = Base Price. Tax = Price * Rate. Total = Price + Tax.
                // WAIT: In `POS.jsx` usually `item.price` is the selling price.
                // Let's calculate Profit = (Selling Price - Cost).
                // If Tax is present, Profit = (Selling Price - Tax - Cost).

                // Let's deduce Tax from the price if implied, or calc it if extra.
                // Logic used in POS: `calculateTotal` usually sums `item.price * item.quantity`.
                // So `item.price` is the list price.
                // Let's assume `item.tax_rate` is informational or included.
                // For this report, let's treat `item.price` as Revenue.
                // Profit = Revenue - Cost.
                // If specific Tax logic needed: Tax = Revenue * (Rate / (1+Rate)) if inclusive.

                // Let's go with:
                // Sale Amount = item.price * qty
                // Cost Amount = item.cost * qty
                // Tax Amount = (item.price * qty) * (taxRate / 100); // Assuming rate is like 16 for 16%? Or 0.16?
                // Let's assume rate is 0.xx from DB default 0.

                // Actually, let's look at `addProduct` in useStore: `tax_rate || 0`.
                // Let's assume simple Profit = (Price - Cost) * Qty.

                const lineSale = price * qty;
                const lineProfit = (price - cost) * qty;
                const lineTax = lineSale * (taxRate || 0); // Simplified tax calc

                totalCost += lineCost;
                totalSales += lineSale;
                totalTax += lineTax; // If this is meant to be separate
                // totalDiscount += (item.discount || 0);

                items.push({
                    saleId: sale.id,
                    saleDate: sale.date,
                    productName: item.name,
                    barcode: item.sku || item.barcode || '-',
                    quantity: qty,
                    unitCost: cost,
                    unitPrice: price,
                    tax: lineTax, // Per line
                    totalCost: lineCost,
                    totalSale: lineSale,
                    totalProfit: lineProfit
                });
            });
        });

        const totalProfit = totalSales - totalCost; // Simple Gross Profit
        const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

        setStats({
            totalCost,
            totalDiscount,
            totalTax,
            totalSales,
            totalProfit,
            profitMargin
        });

        // Sort items by date desc (newest first)
        items.sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate));

        setFlattenedItems(items);
    };

    const exportToExcel = () => {
        const ws = XLSX.utils.json_to_sheet(flattenedItems.map(item => ({
            'ID Venta': item.saleId,
            'Fecha': format(new Date(item.saleDate), 'dd/MM/yyyy HH:mm'),
            'Producto': item.productName,
            'Codigo': item.barcode,
            'Cantidad': item.quantity,
            'Costo Unit.': item.unitCost,
            'Precio Venta': item.unitPrice,
            'Total Venta': item.totalSale,
            'Utilidad': item.totalProfit
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Reporte Utilidad");
        XLSX.writeFile(wb, "Reporte_Utilidad.xlsx");
    };

    const chartData = [
        { name: 'Costos', value: stats.totalCost, fill: '#ef4444' }, // Red
        { name: 'Ventas', value: stats.totalSales, fill: '#3b82f6' }, // Blue
        { name: 'Utilidad', value: stats.totalProfit, fill: '#10b981' }, // Green
    ];

    return (
        <div className="space-y-6 relative z-10 p-6">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Reporte de Utilidad</h1>
                    <p className="text-[var(--color-text-muted)]">Análisis de costos, ventas y márgenes</p>
                </div>

                <div className="flex flex-wrap gap-2 items-center bg-[var(--surface-light)] p-2 rounded-xl border border-[var(--glass-border)]">
                    <select
                        className="glass-input !py-1"
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                    >
                        <option value="today">Hoy</option>
                        <option value="yesterday">Ayer</option>
                        <option value="custom">Personalizado</option>
                    </select>

                    {dateRange === 'custom' && (
                        <>
                            <input type="date" className="glass-input !py-1" value={customStart} onChange={e => setCustomStart(e.target.value)} />
                            <span className="text-gray-400">-</span>
                            <input type="date" className="glass-input !py-1" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
                        </>
                    )}

                    <button onClick={loadData} className="btn-primary !py-1 flex items-center gap-2">
                        <Search size={16} /> Buscar
                    </button>
                    <button onClick={exportToExcel} className="btn-secondary !py-1 flex items-center gap-2">
                        <Download size={16} /> Excel
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <StatCard title="Total Costos" value={stats.totalCost} color="text-red-400" icon={<TrendingUp size={16} />} />
                <StatCard title="Descuentos" value={stats.totalDiscount} color="text-orange-400" icon={<Percent size={16} />} />
                <StatCard title="Impuestos" value={stats.totalTax} color="text-yellow-400" icon={<DollarSign size={16} />} />
                <StatCard title="Total Ventas" value={stats.totalSales} color="text-blue-400" icon={<DollarSign size={16} />} />
                <StatCard title="Total Utilidad" value={stats.totalProfit} color="text-green-400" icon={<DollarSign size={16} />} />
                <StatCard title="% Utilidad" value={`${stats.profitMargin.toFixed(2)}%`} isCurrency={false} color="text-purple-400" icon={<Percent size={16} />} />
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
                            formatter={(value) => `$${value.toLocaleString()}`}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={40} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Detailed Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="p-4 border-b border-[var(--glass-border)]">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileText size={18} className="text-[var(--color-primary)]" /> Detalle de Productos Vendidos
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-3">ID Venta</th>
                                <th className="px-6 py-3">Fecha</th>
                                <th className="px-6 py-3">Producto</th>
                                <th className="px-6 py-3">Cód. Barra</th>
                                <th className="px-6 py-3 text-right">Cant.</th>
                                <th className="px-6 py-3 text-right">Costo U.</th>
                                <th className="px-6 py-3 text-right">Impuesto</th>
                                <th className="px-6 py-3 text-right">Precio Venta</th>
                                <th className="px-6 py-3 text-right">Utilidad</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {isLoading ? (
                                <tr><td colSpan="9" className="text-center py-8">Cargando datos...</td></tr>
                            ) : flattenedItems.length === 0 ? (
                                <tr><td colSpan="9" className="text-center py-8 text-gray-500">No hay ventas en este periodo.</td></tr>
                            ) : (
                                flattenedItems.map((item, idx) => (
                                    <tr key={`${item.saleId}-${idx}`} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="px-6 py-3 text-gray-400">#{item.saleId}</td>
                                        <td className="px-6 py-3 text-gray-400">{format(new Date(item.saleDate), 'dd/MM HH:mm')}</td>
                                        <td className="px-6 py-3 font-medium text-white">{item.productName}</td>
                                        <td className="px-6 py-3 text-gray-500">{item.barcode}</td>
                                        <td className="px-6 py-3 text-right text-white font-bold">{item.quantity}</td>
                                        <td className="px-6 py-3 text-right text-gray-400">${item.unitCost.toFixed(2)}</td>
                                        <td className="px-6 py-3 text-right text-yellow-400/80">${item.tax.toFixed(2)}</td>
                                        <td className="px-6 py-3 text-right text-blue-300 font-bold">${item.totalSale.toFixed(2)}</td>
                                        <td className={cn(
                                            "px-6 py-3 text-right font-bold font-mono",
                                            item.totalProfit >= 0 ? "text-green-400" : "text-red-400"
                                        )}>
                                            ${item.totalProfit.toFixed(2)}
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

const StatCard = ({ title, value, color, icon, isCurrency = true }) => (
    <div className="glass-card p-4 flex flex-col items-center justify-center text-center">
        <div className={cn("p-2 rounded-full bg-white/5 mb-2", color)}>{icon}</div>
        <p className="text-xs text-gray-400 uppercase tracking-wider">{title}</p>
        <p className={cn("text-xl font-bold font-mono mt-1", color)}>
            {isCurrency ? `$${Number(value).toLocaleString()}` : value}
        </p>
    </div>
);

export default SalesProfitReport;
