import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { formatInCompanyTime } from '../lib/dateHelpers';
import {
    AlertTriangle,
    CheckCircle,
    XCircle,
    Box,
    Search,
    Calendar,
    Download,
    ChevronDown,
    ChevronUp,
    ShoppingCart,
    Clock
} from 'lucide-react';

const ExpiringProductsReport = () => {
    // Removed reliance on global products/productLots
    const { fetchProductLotsReport, currentCompanyTimezone } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [reportData, setReportData] = useState([]); // This will hold the fetched lots with product info

    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().split('T')[0];
    });
    const [expandedProduct, setExpandedProduct] = useState(null);

    // Fetch Data on Mount
    React.useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            const data = await fetchProductLotsReport();
            setReportData(data);
            setIsLoading(false);
        };
        load();
    }, [fetchProductLotsReport]);

    // Filter Logic
    const stats = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        // ... dates ...

        let validCount = 0;
        let validLots = 0;
        let nearExpiryCount = 0;
        let nearExpiryLots = 0;
        let expiredCount = 0;
        let expiredLots = 0;
        let totalItems = 0;
        let totalLots = 0;
        let expiryValueLost = 0;

        const productMap = {};

        // Iterate over the FETCHED report data, not the global store
        reportData.forEach(row => {
            // Row contains mixed lot and product info

            if (!productMap[row.product_id]) {
                // Reconstruct product object from flat row
                productMap[row.product_id] = {
                    id: row.product_id,
                    name: row.product_name,
                    sku: row.product_sku,
                    image: row.product_image,
                    stock: row.product_stock,
                    unit: row.product_unit,
                    price: row.product_price,
                    lots: []
                };
            }

            const expiry = row.expiry_date;
            let status = 'valid';

            if (expiry) {
                if (expiry < today) {
                    status = 'expired';
                    expiredLots++;
                    expiryValueLost += (row.cost * row.quantity);
                } else if (expiry >= startDate && expiry <= endDate) {
                    status = 'near_expiry';
                    nearExpiryLots++;
                } else {
                    validLots++;
                }
            } else {
                validLots++;
            }

            productMap[row.product_id].lots.push({
                ...row, // row has all lot fields (batch_number, etc) + product fields (ignored here)
                status
            });
            totalLots++;
        });

        // Calculate counts
        Object.values(productMap).forEach(p => {
            const hasExpired = p.lots.some(l => l.status === 'expired');
            const hasNear = p.lots.some(l => l.status === 'near_expiry');

            if (hasExpired) expiredCount++;
            if (hasNear) nearExpiryCount++;
            // Only count as valid if it has NO expired and NO near-expiry (strict view for this card?)
            // Or loose definition: distinct products that are valid?
            // Original logic: if (!hasExpired && !hasNear) validCount++; 
            if (!hasExpired && !hasNear) validCount++;

            totalItems++;
        });

        return {
            validCount, validLots,
            nearExpiryCount, nearExpiryLots,
            expiredCount, expiredLots,
            totalItems, totalLots,
            expiryValueLost,
            groupedProducts: Object.values(productMap)
        };
    }, [reportData, startDate, endDate]);

    const filteredProducts = useMemo(() => {
        return stats.groupedProducts.filter(p => {
            const matchesSearch = p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.sku?.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        });
    }, [stats.groupedProducts, searchTerm]);

    const toggleExpand = (id) => {
        setExpandedProduct(expandedProduct === id ? null : id);
    };

    const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(val);

    return (
        <div className="flex flex-col h-full bg-[var(--color-background)] min-h-screen font-sans">
            {/* Mobile Header */}
            <div className="lg:hidden sticky top-0 z-30 bg-[var(--color-surface)] border-b border-[var(--glass-border)] p-4">
                <h1 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                    <Clock size={20} className="text-blue-500" />
                    Reporte de productos por vencer
                </h1>
            </div>

            {/* Desktop Header */}
            <div className="hidden lg:flex justify-between items-center p-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Clock size={28} className="text-blue-600" />
                        Reporte de productos por vencer
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)]">Panel reporte de productos por vencer</p>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-lg hover:bg-[var(--glass-bg)] transition">
                        <Search size={18} /> Buscar
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-lg hover:bg-[var(--glass-bg)] transition">
                        <Download size={18} /> Descargar
                    </button>
                </div>
            </div>

            {/* Main Content - Scrollable */}
            <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4 lg:space-y-6 pb-24 lg:pb-6">
                {/* Mobile Search Bar */}
                <div className="lg:hidden relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o código..."
                        className="w-full pl-10 pr-4 py-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Desktop Filters Bar */}
                <div className="hidden lg:flex bg-[var(--color-surface)] p-4 rounded-xl shadow-sm gap-4 items-center">
                    <div className="flex-1 min-w-[300px] relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o código..."
                            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Inicio</span>
                        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Fin</span>
                        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                </div>

                {/* Stats Cards - 2x2 Grid on Mobile, 4 cols on Desktop */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                    <div className="bg-green-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">PRODUCTOS VIGENTES</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{stats.validLots}</p>
                            <p className="text-green-100 text-[10px] lg:text-sm">{stats.validCount} productos</p>
                        </div>
                        <CheckCircle size={32} className="text-green-200 opacity-80 hidden lg:block" />
                        <CheckCircle size={24} className="text-green-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-yellow-500 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">PRÓXIMOS A VENCER</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{stats.nearExpiryLots}</p>
                            <p className="text-yellow-100 text-[10px] lg:text-sm">En rango seleccionado</p>
                        </div>
                        <AlertTriangle size={32} className="text-yellow-200 opacity-80 hidden lg:block" />
                        <AlertTriangle size={24} className="text-yellow-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-red-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">VENCIDOS</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{stats.expiredLots}</p>
                            <p className="text-red-100 text-[10px] lg:text-sm">Pérdida: {formatCurrency(stats.expiryValueLost)}</p>
                        </div>
                        <XCircle size={32} className="text-red-200 opacity-80 hidden lg:block" />
                        <XCircle size={24} className="text-red-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-blue-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">TOTAL DE LOTES</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{stats.totalLots}</p>
                            <p className="text-blue-100 text-[10px] lg:text-sm">{stats.totalItems} productos</p>
                        </div>
                        <Box size={32} className="text-blue-200 opacity-80 hidden lg:block" />
                        <Box size={24} className="text-blue-200 opacity-80 lg:hidden" />
                    </div>
                </div>

                {/* Products List */}
                <div className="space-y-3 lg:space-y-4">
                    {filteredProducts.map((product) => (
                        <div key={product.id} className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--glass-border)] overflow-hidden">
                            {/* Product Row - Mobile Optimized */}
                            <div
                                className="p-3 lg:p-4 flex items-center gap-3 lg:gap-4 cursor-pointer hover:bg-[var(--glass-bg)] transition"
                                onClick={() => toggleExpand(product.id)}
                            >
                                {/* Image */}
                                <div className="p-1 border rounded-lg bg-[var(--glass-bg)] shrink-0">
                                    {product.image ? (
                                        <img src={product.image} alt={product.name} className="w-10 h-10 lg:w-12 lg:h-12 object-cover rounded" />
                                    ) : (
                                        <Box className="w-10 h-10 lg:w-12 lg:h-12 text-gray-300 p-2" />
                                    )}
                                </div>

                                {/* Product Info */}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-[var(--color-text)] text-sm lg:text-lg truncate">{product.name}</h3>
                                    <p className="text-[10px] lg:text-sm text-[var(--color-text-muted)] truncate">
                                        SKU: {product.sku} - Stock Total: {product.stock} {product.unit}
                                    </p>
                                    <div className="flex gap-1 mt-1">
                                        <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] lg:text-xs font-bold">
                                            {product.lots.length} Lote{product.lots.length !== 1 ? 's' : ''}
                                        </span>
                                        {product.lots.some(l => l.status === 'expired') && (
                                            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] lg:text-xs font-bold">
                                                Vencido
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Price & Chevron */}
                                <div className="text-right shrink-0 flex items-center gap-2">
                                    <div>
                                        <p className="text-[10px] lg:text-sm text-[var(--color-text-muted)]">Precio Venta</p>
                                        <p className="font-bold text-[var(--color-text)] text-sm lg:text-lg">{formatCurrency(product.price)}</p>
                                    </div>
                                    {expandedProduct === product.id ? <ChevronUp className="text-[var(--color-text-muted)]" size={20} /> : <ChevronDown className="text-[var(--color-text-muted)]" size={20} />}
                                </div>
                            </div>

                            {/* Expanded Lots - Mobile Cards / Desktop Table */}
                            {expandedProduct === product.id && (
                                <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 lg:p-4">
                                    <div className="flex items-center gap-2 mb-3 text-[var(--color-text)] font-bold text-sm">
                                        <ShoppingCart size={16} />
                                        <h4>Historial de lotes</h4>
                                    </div>

                                    {/* Mobile: Cards */}
                                    <div className="lg:hidden space-y-2">
                                        {product.lots.map((lot) => (
                                            <div key={lot.id} className="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--glass-border)]">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <p className="font-bold text-[var(--color-text)] text-sm">{lot.batch_number || 'Sin lote'}</p>
                                                        <p className="text-[10px] text-[var(--color-text-muted)]">Reg: {formatInCompanyTime(lot.created_at, currentCompanyTimezone, 'dd/MM/yyyy')}</p>
                                                    </div>
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${lot.status === 'expired' ? 'bg-red-500/20 text-red-400' :
                                                        lot.status === 'near_expiry' ? 'bg-yellow-500/20 text-yellow-400' :
                                                            'bg-green-500/20 text-green-400'
                                                        }`}>
                                                        {lot.status === 'expired' ? 'Vencido' : lot.status === 'near_expiry' ? 'Por Vencer' : 'Vigente'}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                                    <div>
                                                        <span className="text-[var(--color-text-muted)]">Cantidad:</span>
                                                        <span className="text-[var(--color-text)] font-bold ml-1">{lot.quantity} Unds</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-[var(--color-text-muted)]">Vence:</span>
                                                        <span className="text-[var(--color-text)] font-bold ml-1">
                                                            {lot.expiry_date ? formatInCompanyTime(lot.expiry_date, currentCompanyTimezone, 'dd/MM/yyyy') : 'No vence'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className="text-[var(--color-text-muted)]">Costo:</span>
                                                        <span className="text-[var(--color-text)] font-bold ml-1">{formatCurrency(lot.cost)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-[var(--color-text-muted)]">Proveedor:</span>
                                                        <span className="text-[var(--color-text)] font-bold ml-1">{lot.supplier_name || 'N/A'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Desktop: Table */}
                                    <div className="hidden lg:block overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs text-[var(--color-text-muted)] uppercase bg-[var(--color-background)]">
                                                <tr>
                                                    <th className="px-4 py-3 rounded-l-lg">Lote / Registro</th>
                                                    <th className="px-4 py-3">Cantidad</th>
                                                    <th className="px-4 py-3">Vencimiento</th>
                                                    <th className="px-4 py-3">Proveedor</th>
                                                    <th className="px-4 py-3">Costos</th>
                                                    <th className="px-4 py-3 rounded-r-lg">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {product.lots.map((lot) => (
                                                    <tr key={lot.id} className="border-b border-[var(--glass-border)] hover:bg-[var(--color-surface)] transition">
                                                        <td className="px-4 py-3">
                                                            <p className="font-bold text-[var(--color-text)]">{lot.batch_number || 'Sin lote'}</p>
                                                            <p className="text-xs text-[var(--color-text-muted)]">Reg: {formatInCompanyTime(lot.created_at, currentCompanyTimezone, 'dd/MM/yyyy')}</p>
                                                        </td>
                                                        <td className="px-4 py-3 font-medium">{lot.quantity} Unds</td>
                                                        <td className="px-4 py-3">
                                                            {lot.expiry_date ? (
                                                                <div className={`px-3 py-1 rounded inline-flex font-bold text-xs ${lot.status === 'expired' ? 'bg-red-500/20 text-red-400' :
                                                                    lot.status === 'near_expiry' ? 'bg-yellow-500/20 text-yellow-400' :
                                                                        'bg-green-500/20 text-green-400'
                                                                    }`}>
                                                                    {formatInCompanyTime(lot.expiry_date, currentCompanyTimezone, 'dd/MM/yyyy')}
                                                                </div>
                                                            ) : (
                                                                <span className="text-[var(--color-text-muted)] text-xs">No vence</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{lot.supplier_name || 'Sin proveedor'}</td>
                                                        <td className="px-4 py-3">
                                                            <p className="text-[var(--color-text)]">Costo: {formatCurrency(lot.cost)}</p>
                                                            <p className="text-xs text-green-500">Utilidad: {(((product.price - lot.cost) / product.price) * 100).toFixed(1)}%</p>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {lot.status === 'expired' ? (
                                                                <span className="flex items-center gap-1 text-red-400 font-bold text-xs"><XCircle size={14} /> Vencido</span>
                                                            ) : lot.status === 'near_expiry' ? (
                                                                <span className="flex items-center gap-1 text-yellow-400 font-bold text-xs"><AlertTriangle size={14} /> Por Vencer</span>
                                                            ) : (
                                                                <span className="flex items-center gap-1 text-green-400 font-bold text-xs"><CheckCircle size={14} /> Vigente</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {filteredProducts.length === 0 && (
                        <div className="text-center py-12 text-[var(--color-text-muted)]">
                            <Box size={48} className="mx-auto mb-3 opacity-50" />
                            <p>No hay productos que coincidan con los filtros.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Footer Actions */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--glass-border)] p-4 flex gap-3 z-40">
                <button className="flex-1 flex items-center justify-center gap-2 py-3 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-xl font-bold">
                    <Search size={18} /> Buscar
                </button>
                <button className="flex-1 flex items-center justify-center gap-2 py-3 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-xl font-bold">
                    <Download size={18} /> Descargar
                </button>
            </div>
        </div>
    );
};

export default ExpiringProductsReport;
