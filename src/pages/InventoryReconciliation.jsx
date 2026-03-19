import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import {
    AlertTriangle, CheckCircle, Box, Search, RefreshCw, ChevronDown, ChevronUp,
    ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Package, Loader
} from 'lucide-react';

const PAGE_SIZE = 30;

const InventoryReconciliation = () => {
    const {
        fetchReconciliationData, fetchProductLotsForReconciliation,
        reconcileProduct, reconcileAllProducts
    } = useStore();

    const [products, setProducts] = useState([]);
    const [stats, setStats] = useState({ total: 0, stockGreater: 0, lotsGreater: 0, negativeStock: 0 });
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [searchQuery, setSearchQuery] = useState(''); // debounced value sent to DB
    const searchTimerRef = useRef(null);
    const offsetRef = useRef(0);
    const hasMoreRef = useRef(false);
    const searchQueryRef = useRef('');

    const [expandedProduct, setExpandedProduct] = useState(null);
    const [productLots, setProductLots] = useState([]);
    const [loadingLots, setLoadingLots] = useState(false);

    // Action modal
    const [actionModal, setActionModal] = useState(null);
    const [actionNotes, setActionNotes] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // Bulk action
    const [bulkModal, setBulkModal] = useState(null);
    const [bulkNotes, setBulkNotes] = useState('');

    // Infinite scroll observer
    const observerRef = useRef(null);
    const loadMoreRef = useRef(null);

    const lastProductRef = useCallback(node => {
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMoreRef.current) {
                loadMoreRef.current?.();
            }
        });
        if (node) observerRef.current.observe(node);
    }, []);

    // Initial load + when searchQuery changes
    const loadData = async (search = searchQuery) => {
        setIsLoading(true);
        setOffset(0);
        offsetRef.current = 0;
        searchQueryRef.current = search;
        setExpandedProduct(null);
        const result = await fetchReconciliationData({ limit: PAGE_SIZE, offset: 0, search });
        setProducts(result.products);
        setHasMore(result.hasMore);
        hasMoreRef.current = result.hasMore;
        setOffset(result.products.length);
        offsetRef.current = result.products.length;
        if (result.stats) setStats(result.stats);
        setIsLoading(false);
    };

    const loadMore = async () => {
        if (isLoadingMore || !hasMoreRef.current) return;
        setIsLoadingMore(true);
        const result = await fetchReconciliationData({ limit: PAGE_SIZE, offset: offsetRef.current, search: searchQueryRef.current });
        setProducts(prev => [...prev, ...result.products]);
        setHasMore(result.hasMore);
        hasMoreRef.current = result.hasMore;
        setOffset(prev => prev + result.products.length);
        offsetRef.current += result.products.length;
        setIsLoadingMore(false);
    };

    loadMoreRef.current = loadMore;

    useEffect(() => {
        loadData('');
    }, []);

    // Debounce search: wait 400ms after typing, then query DB
    const handleSearchChange = (e) => {
        const val = e.target.value;
        setSearchTerm(val);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setSearchQuery(val);
            loadData(val);
        }, 400);
    };

    const handleReload = () => {
        setSearchTerm('');
        setSearchQuery('');
        loadData('');
    };

    const handleExpand = async (productId) => {
        if (expandedProduct === productId) {
            setExpandedProduct(null);
            return;
        }
        setExpandedProduct(productId);
        setLoadingLots(true);
        const lots = await fetchProductLotsForReconciliation(productId);
        setProductLots(lots);
        setLoadingLots(false);
    };

    const handleAction = async () => {
        if (!actionModal) return;
        setIsProcessing(true);
        const result = await reconcileProduct(actionModal.product.id, actionModal.action, actionNotes);
        setIsProcessing(false);
        if (result.success) {
            setActionModal(null);
            setActionNotes('');
            loadData(searchQuery);
        } else {
            alert('Error: ' + result.error);
        }
    };

    const handleBulkAction = async () => {
        if (!bulkModal) return;
        setIsProcessing(true);
        const result = await reconcileAllProducts(products, bulkModal, bulkNotes);
        setIsProcessing(false);
        if (result.success) {
            setBulkModal(null);
            setBulkNotes('');
            loadData(searchQuery);
        }
    };

    const formatCurrency = (val) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(val || 0);

    return (
        <div className="p-4 lg:p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-text)] flex items-center gap-3">
                    <ShieldCheck size={28} className="text-blue-400" />
                    Conciliación de Inventario
                </h1>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                    Detecta y corrige descuadres entre el stock de productos y sus lotes
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
                <div className="bg-red-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                    <h3 className="text-[10px] lg:text-xs font-bold uppercase">Descuadrados</h3>
                    <p className="text-xl lg:text-2xl font-bold">{stats.total}</p>
                    <p className="text-red-200 text-[10px]">Productos con diferencias</p>
                </div>
                <div className="bg-orange-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                    <h3 className="text-[10px] lg:text-xs font-bold uppercase">Stock {'>'} Lotes</h3>
                    <p className="text-xl lg:text-2xl font-bold">{stats.stockGreater}</p>
                    <p className="text-orange-200 text-[10px]">Stock mayor a lotes</p>
                </div>
                <div className="bg-purple-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                    <h3 className="text-[10px] lg:text-xs font-bold uppercase">Lotes {'>'} Stock</h3>
                    <p className="text-xl lg:text-2xl font-bold">{stats.lotsGreater}</p>
                    <p className="text-purple-200 text-[10px]">Lotes suman más que stock</p>
                </div>
                <div className="bg-gray-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                    <h3 className="text-[10px] lg:text-xs font-bold uppercase">Stock Negativo</h3>
                    <p className="text-xl lg:text-2xl font-bold">{stats.negativeStock}</p>
                    <p className="text-gray-300 text-[10px]">Productos con stock {'<'} 0</p>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex-1 min-w-[200px] relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-[var(--glass-bg)] text-[var(--color-text)] border-[var(--glass-border)]"
                        value={searchTerm}
                        onChange={handleSearchChange}
                    />
                </div>
                <button
                    onClick={handleReload}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold text-sm"
                >
                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} /> Recargar
                </button>
                {products.length > 0 && (
                    <button
                        onClick={() => setBulkModal('adjust_lots')}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-bold text-sm"
                    >
                        <ArrowDownToLine size={16} /> Conciliar Todos (Ajustar Lotes)
                    </button>
                )}
            </div>

            {/* Info banner */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-4 text-sm text-blue-300">
                <p className="font-bold mb-1 flex items-center gap-2"><AlertTriangle size={16} /> ¿Qué es la conciliación?</p>
                <p className="text-[var(--color-text-muted)]">
                    Cuando el stock de un producto no coincide con la suma de sus lotes, hay un descuadre.
                    Tienes dos opciones para cada producto:
                </p>
                <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                    <li><strong className="text-blue-400">Ajustar Stock →</strong> Cambia el stock del producto para igualar la suma de lotes (si confías en los lotes)</li>
                    <li><strong className="text-purple-400">Ajustar Lotes →</strong> Redistribuye las cantidades de lotes para igualar el stock (si confías en el stock, ej: stock=0 → lotes pasan a 0)</li>
                </ul>
            </div>

            {/* Product list */}
            {isLoading ? (
                <div className="text-center py-12 text-[var(--color-text-muted)] animate-pulse flex items-center justify-center gap-2">
                    <Loader className="animate-spin" size={20} /> Analizando inventario...
                </div>
            ) : products.length === 0 ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                    <CheckCircle size={48} className="mx-auto mb-3 text-green-400 opacity-50" />
                    <p className="text-lg font-bold text-green-400">
                        {searchQuery ? 'Sin resultados' : '¡Inventario cuadrado!'}
                    </p>
                    <p>{searchQuery ? 'No se encontraron productos con ese nombre.' : 'No se encontraron descuadres entre stock y lotes.'}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {products.map((product, index) => {
                        const isLast = index === products.length - 1;
                        return (
                        <div key={product.id} ref={isLast ? lastProductRef : null} className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--glass-border)] overflow-hidden">
                            {/* Product Row */}
                            <div
                                className="p-3 lg:p-4 flex items-center gap-3 cursor-pointer hover:bg-[var(--glass-bg)] transition"
                                onClick={() => handleExpand(product.id)}
                            >
                                <div className="p-1 border rounded-lg bg-[var(--glass-bg)] shrink-0">
                                    {product.image ? (
                                        <img src={product.image} alt={product.name} className="w-10 h-10 lg:w-12 lg:h-12 object-cover rounded" />
                                    ) : (
                                        <Box className="w-10 h-10 lg:w-12 lg:h-12 text-gray-300 p-2" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-[var(--color-text)] text-sm lg:text-base truncate">{product.name}</h3>
                                    <p className="text-[10px] lg:text-xs text-[var(--color-text-muted)]">
                                        SKU: {product.sku || 'N/A'} · {product.lots_count} lote{product.lots_count !== 1 ? 's' : ''} activo{product.lots_count !== 1 ? 's' : ''}
                                    </p>
                                </div>

                                {/* Difference indicator */}
                                <div className="text-right shrink-0">
                                    <div className="flex items-center gap-4 text-xs lg:text-sm">
                                        <div className="text-center">
                                            <p className="text-[10px] text-[var(--color-text-muted)]">Stock</p>
                                            <p className={`font-bold ${product.stock < 0 ? 'text-red-400' : 'text-[var(--color-text)]'}`}>{product.stock}</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[10px] text-[var(--color-text-muted)]">Lotes</p>
                                            <p className="font-bold text-[var(--color-text)]">{product.lots_total}</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[10px] text-[var(--color-text-muted)]">Diferencia</p>
                                            <p className={`font-bold ${product.difference > 0 ? 'text-orange-400' : 'text-purple-400'}`}>
                                                {product.difference > 0 ? '+' : ''}{product.difference}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {expandedProduct === product.id ? <ChevronUp size={20} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={20} className="text-[var(--color-text-muted)]" />}
                            </div>

                            {/* Expanded: lots detail + actions */}
                            {expandedProduct === product.id && (
                                <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                                    {loadingLots ? (
                                        <p className="text-center text-[var(--color-text-muted)] animate-pulse py-4">Cargando lotes...</p>
                                    ) : (
                                        <>
                                            {/* Lots table */}
                                            <div className="overflow-x-auto mb-4">
                                                <table className="w-full text-xs lg:text-sm">
                                                    <thead className="text-[10px] lg:text-xs text-[var(--color-text-muted)] uppercase bg-[var(--color-background)]">
                                                        <tr>
                                                            <th className="px-3 py-2 text-left">Lote</th>
                                                            <th className="px-3 py-2 text-left">Vencimiento</th>
                                                            <th className="px-3 py-2 text-right">Cantidad</th>
                                                            <th className="px-3 py-2 text-left">Factura</th>
                                                            <th className="px-3 py-2 text-left">Proveedor</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {productLots.map(lot => (
                                                            <tr key={lot.id} className={`border-b border-[var(--glass-border)] ${lot.quantity <= 0 ? 'opacity-40' : ''}`}>
                                                                <td className="px-3 py-2">{lot.batch_number || 'S/L'}</td>
                                                                <td className="px-3 py-2">{lot.expiry_date || 'N/A'}</td>
                                                                <td className="px-3 py-2 text-right font-bold">{lot.quantity}</td>
                                                                <td className="px-3 py-2">{lot.invoice_number || 'N/A'}</td>
                                                                <td className="px-3 py-2">{lot.supplier_name || 'N/A'}</td>
                                                            </tr>
                                                        ))}
                                                        <tr className="font-bold bg-[var(--color-background)]">
                                                            <td className="px-3 py-2" colSpan={2}>TOTAL LOTES</td>
                                                            <td className="px-3 py-2 text-right">{productLots.reduce((s, l) => s + (l.quantity || 0), 0)}</td>
                                                            <td colSpan={2}></td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Summary */}
                                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
                                                <div className="bg-[var(--color-background)] p-3 rounded-lg text-center">
                                                    <p className="text-[10px] text-[var(--color-text-muted)]">Stock Producto</p>
                                                    <p className={`text-lg font-bold ${product.stock < 0 ? 'text-red-400' : 'text-[var(--color-text)]'}`}>{product.stock} {product.unit}</p>
                                                </div>
                                                <div className="bg-[var(--color-background)] p-3 rounded-lg text-center">
                                                    <p className="text-[10px] text-[var(--color-text-muted)]">Suma de Lotes</p>
                                                    <p className="text-lg font-bold text-[var(--color-text)]">{product.lots_total} {product.unit}</p>
                                                </div>
                                                <div className={`p-3 rounded-lg text-center ${product.difference > 0 ? 'bg-orange-500/10' : 'bg-purple-500/10'}`}>
                                                    <p className="text-[10px] text-[var(--color-text-muted)]">Diferencia</p>
                                                    <p className={`text-lg font-bold ${product.difference > 0 ? 'text-orange-400' : 'text-purple-400'}`}>
                                                        {product.difference > 0 ? '+' : ''}{product.difference} {product.unit}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Action buttons */}
                                            <div className="flex flex-wrap gap-3">
                                                <button
                                                    onClick={() => { setActionModal({ product, action: 'adjust_stock' }); setActionNotes(''); }}
                                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold text-sm"
                                                >
                                                    <ArrowUpFromLine size={16} /> Ajustar Stock → {product.lots_total}
                                                </button>
                                                <button
                                                    onClick={() => { setActionModal({ product, action: 'adjust_lots' }); setActionNotes(''); }}
                                                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-bold text-sm"
                                                >
                                                    <ArrowDownToLine size={16} /> Ajustar Lotes → {product.stock}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        );
                    })}

                    {/* Loading more indicator */}
                    {isLoadingMore && (
                        <div className="text-center py-4 text-[var(--color-text-muted)] animate-pulse flex items-center justify-center gap-2">
                            <Loader className="animate-spin" size={16} /> Cargando más productos...
                        </div>
                    )}
                </div>
            )}

            {/* Action Confirmation Modal */}
            {actionModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--glass-border)]">
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`p-2 rounded-full ${actionModal.action === 'adjust_stock' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                                {actionModal.action === 'adjust_stock'
                                    ? <ArrowUpFromLine size={24} className="text-blue-400" />
                                    : <ArrowDownToLine size={24} className="text-purple-400" />
                                }
                            </div>
                            <h3 className="text-lg font-bold text-[var(--color-text)]">
                                {actionModal.action === 'adjust_stock' ? 'Ajustar Stock' : 'Ajustar Lotes'}
                            </h3>
                        </div>

                        <div className="mb-4 text-sm text-[var(--color-text-muted)]">
                            <p className="font-bold text-[var(--color-text)] mb-2">{actionModal.product.name}</p>
                            {actionModal.action === 'adjust_stock' ? (
                                <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                                    <p>El stock del producto pasará de <strong className="text-red-400">{actionModal.product.stock}</strong> a <strong className="text-green-400">{actionModal.product.lots_total}</strong> para igualar la suma de lotes.</p>
                                </div>
                            ) : (
                                <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                                    <p>Los lotes se redistribuirán para sumar <strong className="text-green-400">{actionModal.product.stock}</strong> (stock actual). Los lotes sobrantes quedarán en 0.</p>
                                    {actionModal.product.stock <= 0 && (
                                        <p className="mt-2 text-red-400 font-bold text-xs">⚠️ Stock es {actionModal.product.stock}, todos los lotes pasarán a 0.</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mb-4">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Notas del ajuste</label>
                            <textarea
                                value={actionNotes}
                                onChange={(e) => setActionNotes(e.target.value)}
                                placeholder="Ej: Conciliación por descuadre de sistema"
                                className="w-full px-3 py-2 border rounded-lg text-sm bg-[var(--color-background)] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-blue-500 border-[var(--glass-border)]"
                                rows={2}
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setActionModal(null)}
                                disabled={isProcessing}
                                className="flex-1 py-2.5 px-4 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-lg font-bold hover:opacity-80 transition"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAction}
                                disabled={isProcessing}
                                className={`flex-1 py-2.5 px-4 text-white rounded-lg font-bold transition flex items-center justify-center gap-2 ${actionModal.action === 'adjust_stock' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                            >
                                {isProcessing ? 'Procesando...' : 'Confirmar Ajuste'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Action Modal */}
            {bulkModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--glass-border)]">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-red-500/20 rounded-full">
                                <AlertTriangle size={24} className="text-red-400" />
                            </div>
                            <h3 className="text-lg font-bold text-[var(--color-text)]">Conciliación Masiva</h3>
                        </div>

                        <div className="mb-4 text-sm text-[var(--color-text-muted)]">
                            <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                                <p>Se ajustarán los lotes de <strong className="text-red-400">{products.length} productos</strong> para igualar su stock actual.</p>
                                <p className="mt-2 text-xs">Productos con stock 0 tendrán todos sus lotes en 0. Esta acción no se puede deshacer.</p>
                            </div>
                        </div>

                        <div className="mb-4">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Notas del ajuste masivo</label>
                            <textarea
                                value={bulkNotes}
                                onChange={(e) => setBulkNotes(e.target.value)}
                                placeholder="Ej: Conciliación masiva por migración de sistema"
                                className="w-full px-3 py-2 border rounded-lg text-sm bg-[var(--color-background)] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-red-500 border-[var(--glass-border)]"
                                rows={2}
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setBulkModal(null)}
                                disabled={isProcessing}
                                className="flex-1 py-2.5 px-4 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-lg font-bold hover:opacity-80 transition"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleBulkAction}
                                disabled={isProcessing}
                                className="flex-1 py-2.5 px-4 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition flex items-center justify-center gap-2"
                            >
                                {isProcessing ? 'Procesando...' : 'Confirmar Conciliación Masiva'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InventoryReconciliation;
