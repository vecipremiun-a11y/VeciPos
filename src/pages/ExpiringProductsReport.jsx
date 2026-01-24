import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
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
    const { products, productLots, categories } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1); // Default 1 month ahead
        return d.toISOString().split('T')[0];
    });
    const [expandedProduct, setExpandedProduct] = useState(null);

    // Filter Lots Logic
    const stats = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        const start = new Date(startDate);
        const end = new Date(endDate);

        let validCount = 0;
        let validLots = 0;
        let nearExpiryCount = 0;
        let nearExpiryLots = 0;
        let expiredCount = 0;
        let expiredLots = 0;
        let totalItems = 0;
        let totalLots = 0;
        let expiryValueLost = 0;

        // Group lots by product
        const productMap = {};

        productLots.forEach(lot => {
            // Only count lots with quantity > 0
            if (lot.quantity <= 0) return;

            if (!productMap[lot.product_id]) {
                productMap[lot.product_id] = { ...products.find(p => p.id === lot.product_id), lots: [] };
            }

            const expiry = lot.expiry_date;
            let status = 'valid';

            if (expiry) {
                if (expiry < today) {
                    status = 'expired';
                    expiredLots++;
                    expiryValueLost += (lot.cost * lot.quantity);
                } else if (expiry >= startDate && expiry <= endDate) {
                    status = 'near_expiry';
                    nearExpiryLots++;
                } else {
                    validLots++;
                }
            } else {
                validLots++; // No expiry = Valid forever
            }

            productMap[lot.product_id].lots.push({ ...lot, status });
            totalLots++;
        });

        // Calculate counts
        Object.values(productMap).forEach(p => {
            const hasExpired = p.lots.some(l => l.status === 'expired');
            const hasNear = p.lots.some(l => l.status === 'near_expiry');

            if (hasExpired) expiredCount++;
            if (hasNear) nearExpiryCount++;
            if (!hasExpired && !hasNear) validCount++; // Loose definition

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
    }, [productLots, products, startDate, endDate]);

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
        <div className="p-6 bg-[var(--color-background)] min-h-screen font-sans">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
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

            {/* Filters Bar */}
            <div className="bg-[var(--color-surface)] dark:bg-[var(--glass-bg)] p-4 rounded-xl shadow-sm mb-6 flex flex-wrap gap-4 items-center">
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
                    <input
                        type="date"
                        className="border rounded-lg px-3 py-2 text-sm"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Fin</span>
                    <input
                        type="date"
                        className="border rounded-lg px-3 py-2 text-sm"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-green-600 text-[var(--color-text)] p-4 rounded-xl shadow-lg flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold">PRODUCTOS VIGENTES</h3>
                        <p className="text-3xl font-bold">{stats.validLots}</p>
                        <p className="text-green-100 text-sm">{stats.validCount} productos</p>
                    </div>
                    <CheckCircle size={40} className="text-green-200 opacity-80" />
                </div>
                <div className="bg-yellow-500 text-[var(--color-text)] p-4 rounded-xl shadow-lg flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold">PRÓXIMOS A VENCER</h3>
                        <p className="text-3xl font-bold">{stats.nearExpiryLots}</p>
                        <p className="text-yellow-100 text-sm">En rango seleccionado</p>
                    </div>
                    <AlertTriangle size={40} className="text-yellow-200 opacity-80" />
                </div>
                <div className="bg-red-600 text-[var(--color-text)] p-4 rounded-xl shadow-lg flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold">VENCIDOS</h3>
                        <p className="text-3xl font-bold">{stats.expiredLots}</p>
                        <p className="text-red-100 text-sm">Pérdida: {formatCurrency(stats.expiryValueLost)}</p>
                    </div>
                    <XCircle size={40} className="text-red-200 opacity-80" />
                </div>
                <div className="bg-blue-600 text-[var(--color-text)] p-4 rounded-xl shadow-lg flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold">TOTAL DE LOTES</h3>
                        <p className="text-3xl font-bold">{stats.totalLots}</p>
                        <p className="text-blue-100 text-sm">{stats.totalItems} productos</p>
                    </div>
                    <Box size={40} className="text-blue-200 opacity-80" />
                </div>
            </div>

            {/* Products List */}
            <div className="space-y-4">
                {filteredProducts.map((product) => (
                    <div key={product.id} className="bg-[var(--color-surface)] dark:bg-[var(--glass-bg)] rounded-xl shadow-sm border border-[var(--glass-border)] overflow-hidden">
                        {/* Product Row Header */}
                        <div
                            className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between cursor-pointer hover:bg-[var(--glass-bg)] transition"
                            onClick={() => toggleExpand(product.id)}
                        >
                            <div className="flex items-center gap-4 flex-1">
                                <div className="p-1 border rounded-lg bg-[var(--glass-bg)]">
                                    {product.image ? (
                                        <img src={product.image} alt={product.name} className="w-12 h-12 object-cover rounded" />
                                    ) : (
                                        <Box className="w-12 h-12 text-gray-300 p-2" />
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-bold text-[var(--color-text)] text-lg">{product.name}</h3>
                                    <div className="flex gap-4 text-sm text-[var(--color-text-muted)]">
                                        <p>SKU: {product.sku}</p>
                                        <p>Stock Total: {product.stock} {product.unit}</p>
                                    </div>
                                    <div className="flex gap-2 mt-1">
                                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded text-xs font-bold">
                                            {product.lots.length} lotes
                                        </span>
                                        {product.lots.some(l => l.status === 'expired') && (
                                            <span className="px-2 py-0.5 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 rounded text-xs font-bold flex items-center gap-1">
                                                <XCircle size={10} /> Tiene Vencidos
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-6 mt-4 md:mt-0">
                                <div className="text-right">
                                    <p className="text-sm text-[var(--color-text-muted)]">Precio Venta</p>
                                    <p className="font-bold text-[var(--color-text)] text-lg">{formatCurrency(product.price)}</p>
                                </div>
                                {expandedProduct === product.id ? <ChevronUp className="text-[var(--color-text-muted)]" /> : <ChevronDown className="text-[var(--color-text-muted)]" />}
                            </div>
                        </div>

                        {/* Expanded Lots Table */}
                        {expandedProduct === product.id && (
                            <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                                <div className="flex items-center gap-2 mb-3 text-[var(--color-text)] font-bold">
                                    <ShoppingCart size={18} />
                                    <h4>Historial de lotes</h4>
                                </div>
                                <div className="overflow-x-auto">
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
                                                <tr key={lot.id} className="border-b border-[var(--glass-border)] hover:bg-[var(--color-surface)] dark:bg-[var(--glass-bg)] transition">
                                                    <td className="px-4 py-3">
                                                        <p className="font-bold text-[var(--color-text)]">{lot.batch_number || 'Sin lote'}</p>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Reg: {new Date(lot.created_at).toLocaleDateString()}</p>
                                                    </td>
                                                    <td className="px-4 py-3 font-medium">
                                                        {lot.quantity} Unds
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {lot.expiry_date ? (
                                                            <div className={`px-3 py-1 rounded inline-flex font-bold text-xs ${lot.status === 'expired' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' :
                                                                lot.status === 'near_expiry' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' :
                                                                    'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                                                }`}>
                                                                {new Date(lot.expiry_date).toLocaleDateString()}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[var(--color-text-muted)] text-xs">No vence</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                                                        {lot.supplier_name || 'Sin proveedor'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <p className="text-[var(--color-text)]">Costo: {formatCurrency(lot.cost)}</p>
                                                        <p className="text-xs text-green-600">Utilidad: {(((product.price - lot.cost) / product.price) * 100).toFixed(1)}%</p>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {lot.status === 'expired' ? (
                                                            <span className="flex items-center gap-1 text-red-600 font-bold text-xs">
                                                                <XCircle size={14} /> Vencido
                                                            </span>
                                                        ) : lot.status === 'near_expiry' ? (
                                                            <span className="flex items-center gap-1 text-yellow-600 font-bold text-xs">
                                                                <AlertTriangle size={14} /> Por Vencer
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1 text-green-600 font-bold text-xs">
                                                                <CheckCircle size={14} /> Vigente
                                                            </span>
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
    );
};

export default ExpiringProductsReport;
