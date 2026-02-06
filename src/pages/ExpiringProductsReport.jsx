import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { formatInCompanyTime } from '../lib/dateHelpers';
import {
    AlertTriangle,
    CheckCircle,
    XCircle,
    Box,
    Search,
    Clock,
    Download,
    ChevronDown,
    ChevronUp,
    ShoppingCart
} from 'lucide-react';

const ExpiringProductsReport = () => {
    const { fetchProductLotsReport, fetchProductLotsGlobalStats, currentCompanyTimezone } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Pagination state
    const [reportData, setReportData] = useState([]); // Accumulates rows
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const LIMIT = 30;

    // Global Stats State (for the cards)
    const [globalStats, setGlobalStats] = useState({
        validLots: 0,
        nearExpiryLots: 0,
        expiredLots: 0,
        totalLots: 0,
        totalItems: 0,
        expiryValueLost: 0
    });

    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().split('T')[0];
    });
    const [expandedProduct, setExpandedProduct] = useState(null);

    // Observer for infinite scroll
    const observer = useRef();
    const lastElementRef = useCallback(node => {
        if (isLoading || isLoadingMore) return;
        if (observer.current) observer.current.disconnect();

        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                loadMore();
            }
        });

        if (node) observer.current.observe(node);
    }, [isLoading, isLoadingMore, hasMore]);

    // Initial Load
    React.useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            // 1. Load Global Stats
            if (fetchProductLotsGlobalStats) {
                const stats = await fetchProductLotsGlobalStats();
                if (stats) setGlobalStats(stats);
            }

            // 2. Load First Page
            const data = await fetchProductLotsReport(LIMIT, 0);
            setReportData(data);
            setOffset(LIMIT);
            setHasMore(data.length === LIMIT);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const loadMore = async () => {
        if (!hasMore || isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            console.log(`Fetching more items... Offset: ${offset}`);
            const data = await fetchProductLotsReport(LIMIT, offset);

            if (data.length > 0) {
                setReportData(prev => [...prev, ...data]);
                setOffset(prev => prev + LIMIT);
                if (data.length < LIMIT) setHasMore(false);
            } else {
                setHasMore(false);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Filter Logic to group loaded rows into products
    const groupedProducts = useMemo(() => {
        const productMap = {};
        const today = new Date().toISOString().split('T')[0];

        reportData.forEach(row => {
            if (!productMap[row.product_id]) {
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
                } else if (expiry >= startDate && expiry <= endDate) {
                    status = 'near_expiry';
                }
            }

            productMap[row.product_id].lots.push({
                ...row,
                status
            });
        });

        // Search Filter
        return Object.values(productMap).filter(p => {
            return p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.sku?.toLowerCase().includes(searchTerm.toLowerCase());
        });
    }, [reportData, startDate, endDate, searchTerm]);

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
                {/* Stats Cards - Using Global Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                    <div className="bg-green-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">PRODUCTOS VIGENTES</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.validLots}</p>
                            <p className="text-green-100 text-[10px] lg:text-sm">Lotes vigentes</p>
                        </div>
                        <CheckCircle size={32} className="text-green-200 opacity-80 hidden lg:block" />
                        <CheckCircle size={24} className="text-green-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-yellow-500 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">PRÓXIMOS A VENCER</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.nearExpiryLots}</p>
                            <p className="text-yellow-100 text-[10px] lg:text-sm">Próximos 30 días</p>
                        </div>
                        <AlertTriangle size={32} className="text-yellow-200 opacity-80 hidden lg:block" />
                        <AlertTriangle size={24} className="text-yellow-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-red-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">VENCIDOS</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.expiredLots}</p>
                            <p className="text-red-100 text-[10px] lg:text-sm">Pérdida: {formatCurrency(globalStats.expiryValueLost)}</p>
                        </div>
                        <XCircle size={32} className="text-red-200 opacity-80 hidden lg:block" />
                        <XCircle size={24} className="text-red-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-blue-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">TOTAL DE LOTES</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.totalLots}</p>
                            <p className="text-blue-100 text-[10px] lg:text-sm">{globalStats.totalItems} productos</p>
                        </div>
                        <Box size={32} className="text-blue-200 opacity-80 hidden lg:block" />
                        <Box size={24} className="text-blue-200 opacity-80 lg:hidden" />
                    </div>
                </div>

                {/* Filters */}
                <div className="lg:flex bg-[var(--color-surface)] p-4 rounded-xl shadow-sm gap-4 items-center hidden">
                    <div className="flex-1 min-w-[300px] relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o código (en items cargados)..."
                            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* Date filters technically affect "near expiry" status logic, kept for visual consistency, though global stats use fixed 30 days */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Inicio</span>
                        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Fin</span>
                        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                </div>

                {/* Products List */}
                <div className="space-y-3 lg:space-y-4">
                    {/* Mobile Search */}
                    <div className="lg:hidden relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="w-full pl-10 pr-4 py-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {groupedProducts.map((product, index) => {
                        // Check if this is the last element to attach ref
                        const isLast = index === groupedProducts.length - 1;
                        return (
                            <div
                                key={product.id}
                                ref={isLast ? lastElementRef : null}
                                className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--glass-border)] overflow-hidden"
                            >
                                {/* Product Row Content (Same as before) */}
                                <div
                                    className="p-3 lg:p-4 flex items-center gap-3 lg:gap-4 cursor-pointer hover:bg-[var(--glass-bg)] transition"
                                    onClick={() => toggleExpand(product.id)}
                                >
                                    <div className="p-1 border rounded-lg bg-[var(--glass-bg)] shrink-0">
                                        {product.image ? (
                                            <img src={product.image} alt={product.name} className="w-10 h-10 lg:w-12 lg:h-12 object-cover rounded" />
                                        ) : (
                                            <Box className="w-10 h-10 lg:w-12 lg:h-12 text-gray-300 p-2" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-[var(--color-text)] text-sm lg:text-lg truncate">{product.name}</h3>
                                        <p className="text-[10px] lg:text-sm text-[var(--color-text-muted)] truncate">
                                            SKU: {product.sku} - Stock: {product.stock} {product.unit}
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
                                    <div className="text-right shrink-0">
                                        <p className="font-bold text-[var(--color-text)] text-sm lg:text-lg">{formatCurrency(product.price)}</p>
                                        {expandedProduct === product.id ? <ChevronUp className="ml-auto text-gray-400" size={20} /> : <ChevronDown className="ml-auto text-gray-400" size={20} />}
                                    </div>
                                </div>

                                {/* Expanded Content (Lots) */}
                                {expandedProduct === product.id && (
                                    <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 lg:p-4 animate-in slide-in-from-top-2">
                                        <div className="lg:hidden space-y-2">
                                            {product.lots.map((lot) => (
                                                <div key={lot.id} className="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--glass-border)]">
                                                    <div className="flex justify-between mb-2">
                                                        <span className="font-bold text-sm text-[var(--color-text)]">{lot.batch_number || 'S/L'}</span>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${lot.status === 'expired' ? 'bg-red-500/20 text-red-400' : lot.status === 'near_expiry' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
                                                            {lot.status === 'expired' ? 'Vencido' : lot.status === 'near_expiry' ? 'Por Vencer' : 'Vigente'}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] space-y-1 text-[var(--color-text-muted)]">
                                                        <div className="flex justify-between"><span>Vence:</span> <span className="text-[var(--color-text)]">{lot.expiry_date || 'N/A'}</span></div>
                                                        <div className="flex justify-between"><span>Cant:</span> <span className="text-[var(--color-text)]">{lot.quantity}</span></div>
                                                        <div className="flex justify-between"><span>Costo:</span> <span className="text-[var(--color-text)]">{formatCurrency(lot.cost)}</span></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="hidden lg:block overflow-x-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="text-xs text-[var(--color-text-muted)] uppercase bg-[var(--color-background)]">
                                                    <tr>
                                                        <th className="px-4 py-2">Lote</th>
                                                        <th className="px-4 py-2">Vencimiento</th>
                                                        <th className="px-4 py-2">Cantidad</th>
                                                        <th className="px-4 py-2">Costo</th>
                                                        <th className="px-4 py-2">Estado</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {product.lots.map(lot => (
                                                        <tr key={lot.id} className="border-b border-[var(--glass-border)]">
                                                            <td className="px-4 py-2 font-medium">{lot.batch_number || 'S/L'}</td>
                                                            <td className="px-4 py-2">{lot.expiry_date || 'N/A'}</td>
                                                            <td className="px-4 py-2">{lot.quantity}</td>
                                                            <td className="px-4 py-2">{formatCurrency(lot.cost)}</td>
                                                            <td className="px-4 py-2">
                                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${lot.status === 'expired' ? 'text-red-400' : lot.status === 'near_expiry' ? 'text-yellow-400' : 'text-green-400'}`}>
                                                                    {lot.status === 'expired' ? 'Vencido' : lot.status === 'near_expiry' ? 'Por Vencer' : 'Vigente'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {isLoadingMore && (
                        <div className="text-center py-4 text-[var(--color-text-muted)] animate-pulse">
                            Cargando más productos...
                        </div>
                    )}

                    {!hasMore && groupedProducts.length > 0 && (
                        <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                            Has llegado al final de la lista.
                        </div>
                    )}

                    {!isLoading && groupedProducts.length === 0 && (
                        <div className="text-center py-12 text-[var(--color-text-muted)]">
                            <Box size={48} className="mx-auto mb-3 opacity-50" />
                            <p>No se encontraron productos.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Footer Actions (Same as before) */}
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
