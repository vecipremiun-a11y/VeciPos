
import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, Edit, Trash2, Filter, Loader, ScanBarcode, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import ProductModal from '../components/ProductModal';
import OptimizedImage from '../components/OptimizedImage';
import { formatCurrency } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';
import InventoryProductList from '../components/inventory/InventoryProductList';

const Inventory = () => {
    const {
        products,
        addProduct,
        updateProduct,
        deleteProduct,
        categories,
        fetchInventoryProducts,
        activeCompanyId,
        currentCurrency,
        taxRates
    } = useStore();
    const { can } = usePermissions();

    // --- PRODUCTS STATE ---
    const [searchTerm, setSearchTerm] = useState('');
    const [localSearchTerm, setLocalSearchTerm] = useState('');
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const scannerRef = useRef(null);
    const scannerContainerId = 'inventory-barcode-reader';
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);

    const [view, setView] = useState('list'); // 'list' | 'form'

    // Server-Side Pagination State
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    // Advanced Filters State
    const [showFilters, setShowFilters] = useState(false);
    const [filterCategory, setFilterCategory] = useState('Todos');
    const [filterTax, setFilterTax] = useState('Todos');
    const [filterStock, setFilterStock] = useState('Todos');
    const [filterGroup, setFilterGroup] = useState('');
    const [scaleGroups, setScaleGroups] = useState([]);

    // --- EFFECTS ---

    // Cargar lista de IDs de Grupo Escala distintos (una sola vez por empresa)
    useEffect(() => {
        if (!activeCompanyId) { setScaleGroups([]); return; }
        let cancelled = false;
        (async () => {
            try {
                const res = await turso.execute({
                    sql: `SELECT DISTINCT scale_group_id FROM products
                          WHERE company_id = ? AND scale_group_id IS NOT NULL AND scale_group_id != ''
                          ORDER BY scale_group_id ASC`,
                    args: [activeCompanyId]
                });
                if (cancelled) return;
                setScaleGroups(res.rows.map(r => r.scale_group_id).filter(Boolean));
            } catch (e) {
                console.warn('No se pudieron cargar grupos escala:', e?.message);
            }
        })();
        return () => { cancelled = true; };
    }, [activeCompanyId]);

    // Load Products on Change
    // Debounce local input to search term (1s delay)
    React.useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            setSearchTerm(localSearchTerm);
        }, 1000);
        return () => clearTimeout(delayDebounceFn);
    }, [localSearchTerm]);

    // Camera barcode scanner
    useEffect(() => {
        if (!showCameraScanner) return;
        let html5QrCode = null;

        const startScanner = async () => {
            const { Html5Qrcode } = await import('html5-qrcode');
            html5QrCode = new Html5Qrcode(scannerContainerId);
            scannerRef.current = html5QrCode;

            try {
                await html5QrCode.start(
                    { facingMode: 'environment' },
                    { fps: 10, qrbox: { width: 280, height: 150 }, aspectRatio: 1.0 },
                    (decodedText) => {
                        html5QrCode.stop().catch(() => {});
                        scannerRef.current = null;
                        setShowCameraScanner(false);
                        setLocalSearchTerm(decodedText);
                        setSearchTerm(decodedText);
                    },
                    () => {}
                );
            } catch (err) {
                console.error('Error starting camera scanner:', err);
                setShowCameraScanner(false);
            }
        };

        startScanner();

        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
                scannerRef.current = null;
            }
        };
    }, [showCameraScanner]);

    // Load Products when search/filters change
    React.useEffect(() => {
        loadProducts(0, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm, filterCategory, activeCompanyId]);


    // --- PRODUCT LOGIC ---

    const loadProducts = async (currentOffset, reset = false) => {
        setIsLoading(true);
        if (reset) {
            setOffset(0);
            setHasMore(true);
        }

        const count = await fetchInventoryProducts(
            reset ? 0 : currentOffset,
            searchTerm,
            filterCategory
        );

        setHasMore(count === 50);
        setIsLoading(false);
    };

    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 100 && hasMore && !isLoading) {
            const newOffset = offset + 50;
            setOffset(newOffset);
            loadProducts(newOffset, false);
        }
    };

    const visibleProducts = React.useMemo(() => {
        const filtered = products.filter(product => {
            let matchesTax = true;
            if (filterTax !== 'Todos') {
                const tax = parseFloat(product.tax_rate) || 0;
                const targetTax = parseFloat(filterTax);
                matchesTax = Math.abs(tax - targetTax) < 0.01;
            }

            let matchesStock = true;
            const stock = parseFloat(product.stock) || 0;
            if (filterStock !== 'Todos') {
                if (filterStock === 'Bajo') matchesStock = stock <= 10;
                if (filterStock === 'Sin') matchesStock = stock <= 0;
                if (filterStock === 'Con') matchesStock = stock > 0;
            }

            const matchesGroup = filterGroup === '' || (product.scale_group_id && product.scale_group_id.toLowerCase().includes(filterGroup.toLowerCase()));

            return matchesTax && matchesStock && matchesGroup;
        });

        if (filterStock === 'Con') {
            return [...filtered].sort((a, b) => (parseFloat(b.stock) || 0) - (parseFloat(a.stock) || 0));
        }

        if (filterStock === 'Bajo') {
            return [...filtered]
                .filter(product => (parseFloat(product.stock) || 0) <= 10)
                .sort((a, b) => (parseFloat(b.stock) || 0) - (parseFloat(a.stock) || 0));
        }

        if (filterStock === 'Sin') {
            return [...filtered].sort((a, b) => (parseFloat(a.stock) || 0) - (parseFloat(b.stock) || 0));
        }

        return filtered;
    }, [products, filterTax, filterStock, filterGroup]);

    const handleEdit = (product) => {
        setEditingProduct(product);
        setView('form');
        setIsModalOpen(true);
    };

    const handleDelete = (id) => {
        if (window.confirm('¿Estás seguro de eliminar este producto?')) {
            deleteProduct(id);
        }
    };

    const handleSaveProduct = async (productData) => {
        let result;
        if (editingProduct) {
            result = await updateProduct(editingProduct.id, productData);
        } else {
            result = await addProduct(productData);
        }

        if (result && result.success) {
            setEditingProduct(null);
            setView('list');
        } else {
            const friendlyMsg = result?.message || result?.error || 'Error desconocido';
            alert('Error al guardar el producto: ' + friendlyMsg);
            // Si el SKU ya existe, ofrecemos navegar a la edición del existente
            if (result?.error === 'SKU_DUPLICATE' && result.existingProductId) {
                const existing = products.find(p => p.id === result.existingProductId);
                if (existing && window.confirm('¿Quieres abrir el producto existente para editarlo?')) {
                    setEditingProduct(existing);
                    setView('form');
                }
            }
        }
    };

    const handleNewProduct = () => {
        setEditingProduct(null);
        setView('form');
    };

    const handleBack = () => {
        setEditingProduct(null);
        setView('list');
    };

    if (view === 'form') {
        return (
            <div className="space-y-6">
                <ProductModal
                    isOpen={true}
                    onClose={handleBack}
                    onSave={handleSaveProduct}
                    productToEdit={editingProduct}
                    isInline={true}
                />
            </div>
        );
    }

    return (
        <div className="space-y-6 min-h-[calc(100vh-6rem)] flex flex-col">
            {/* Camera Barcode Scanner Modal */}
            {showCameraScanner && (
                <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setShowCameraScanner(false)}>
                    <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
                            <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2">
                                <ScanBarcode size={20} className="text-[var(--color-primary)]" />
                                Buscar Producto
                            </h3>
                            <button onClick={() => setShowCameraScanner(false)} className="p-1 rounded-lg hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4">
                            <div id={scannerContainerId} className="w-full rounded-xl overflow-hidden" />
                            <p className="text-center text-xs text-[var(--color-text-muted)] mt-3">Apunta la cámara al código de barras del producto</p>
                        </div>
                    </div>
                </div>
            )}
            {/* Header - Compact on Mobile */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4 shrink-0">
                <div>
                    <h1 className="text-xl lg:text-3xl font-bold text-[var(--color-text)] neon-text">Inventario</h1>
                    <p className="text-xs lg:text-base text-[var(--color-text-muted)]">Gestión de productos y existencias</p>
                </div>

                {can('products.create') && (
                    <button onClick={handleNewProduct} className="btn-primary flex items-center gap-2 text-sm lg:text-base px-3 lg:px-4 py-2">
                        <Plus size={18} /> Nuevo Producto
                    </button>
                )}
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0 flex flex-col">

                {/* Filters & Search - Compact on Mobile */}
                <div className="glass-card p-3 lg:p-4 flex flex-col md:flex-row gap-3 lg:gap-4 items-stretch md:items-center mb-3 lg:mb-4 shrink-0">
                    <div className="relative w-full md:flex-1 lg:flex-none lg:w-72 flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, SKU o categoría..."
                                className="glass-input !pl-10 w-full text-sm lg:text-base"
                                value={localSearchTerm}
                                onChange={(e) => setLocalSearchTerm(e.target.value)}
                            />
                        </div>
                        <button
                            onClick={() => setShowCameraScanner(true)}
                            className="lg:hidden w-10 h-10 shrink-0 rounded-xl bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 active:scale-95 transition-all"
                            title="Escanear código de barras"
                        >
                            <ScanBarcode size={20} />
                        </button>
                    </div>

                    {/* Inline filters — visible solo en lg+ (escritorio) */}
                    <div className="hidden lg:flex flex-1 items-center gap-2">
                        <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="glass-input flex-1 min-w-0 p-2 text-sm"
                            title="Categoría"
                        >
                            <option value="Todos" className="bg-gray-900">Todas las categorías</option>
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.name} className="bg-gray-900">{cat.name}</option>
                            ))}
                        </select>
                        <select
                            value={filterTax}
                            onChange={(e) => setFilterTax(e.target.value)}
                            className="glass-input flex-1 min-w-0 p-2 text-sm"
                            title="Impuestos"
                        >
                            <option value="Todos" className="bg-gray-900">Todos los impuestos</option>
                            {taxRates && taxRates.length > 0 ? (
                                taxRates.map(tax => (
                                    <option key={tax.id} value={tax.rate} className="bg-gray-900">
                                        {tax.name} ({tax.rate}%)
                                    </option>
                                ))
                            ) : (
                                <>
                                    <option value="19" className="bg-gray-900">IVA (19%)</option>
                                    <option value="0" className="bg-gray-900">Exento (0%)</option>
                                </>
                            )}
                        </select>
                        <select
                            value={filterStock}
                            onChange={(e) => setFilterStock(e.target.value)}
                            className="glass-input flex-1 min-w-0 p-2 text-sm"
                            title="Estado de stock"
                        >
                            <option value="Todos" className="bg-gray-900">Todo el stock</option>
                            <option value="Con" className="bg-gray-900">Con Stock</option>
                            <option value="Bajo" className="bg-gray-900">Bajo Stock (&lt;=10)</option>
                            <option value="Sin" className="bg-gray-900">Sin Stock</option>
                        </select>
                        <select
                            value={filterGroup}
                            onChange={(e) => setFilterGroup(e.target.value)}
                            className="glass-input flex-1 min-w-0 p-2 text-sm"
                            title="ID Grupo Escala"
                        >
                            <option value="" className="bg-gray-900">Todos los grupos</option>
                            {scaleGroups.map(g => (
                                <option key={g} value={g} className="bg-gray-900">{g}</option>
                            ))}
                        </select>
                        {(filterCategory !== 'Todos' || filterTax !== 'Todos' || filterStock !== 'Todos' || filterGroup) && (
                            <button
                                onClick={() => {
                                    setFilterCategory('Todos');
                                    setFilterTax('Todos');
                                    setFilterStock('Todos');
                                    setFilterGroup('');
                                }}
                                className="text-xs text-[var(--color-primary)] hover:underline whitespace-nowrap px-2"
                                title="Limpiar filtros"
                            >
                                Limpiar
                            </button>
                        )}
                    </div>

                    {/* Botón Filtros — solo móvil/tablet */}
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`lg:hidden glass px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm ${showFilters ? 'bg-[var(--color-primary)] text-black' : 'hover:bg-[var(--color-surface-hover)]'}`}
                    >
                        <Filter size={18} className={showFilters ? "text-black" : "text-[var(--color-text-muted)]"} />
                        <span className="font-bold">Filtros</span>
                    </button>
                </div>

                {/* Advanced Filters Panel — solo móvil/tablet */}
                {showFilters && (
                    <div className="lg:hidden glass-card p-4 grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2 fade-in duration-200 mb-4 shrink-0">
                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1 uppercase font-bold">Categoría</label>
                            <select
                                value={filterCategory}
                                onChange={(e) => setFilterCategory(e.target.value)}
                                className="glass-input w-full p-2 text-sm"
                            >
                                <option value="Todos" className="bg-gray-900">Todas</option>
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.name} className="bg-gray-900">{cat.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1 uppercase font-bold">Impuestos</label>
                            <select
                                value={filterTax}
                                onChange={(e) => setFilterTax(e.target.value)}
                                className="glass-input w-full p-2 text-sm"
                            >
                                <option value="Todos" className="bg-gray-900">Todos</option>
                                {taxRates && taxRates.length > 0 ? (
                                    taxRates.map(tax => (
                                        <option key={tax.id} value={tax.rate} className="bg-gray-900">
                                            {tax.name} ({tax.rate}%)
                                        </option>
                                    ))
                                ) : (
                                    <>
                                        <option value="19" className="bg-gray-900">IVA (19%)</option>
                                        <option value="0" className="bg-gray-900">Exento (0%)</option>
                                    </>
                                )}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1 uppercase font-bold">Estado Stock</label>
                            <select
                                value={filterStock}
                                onChange={(e) => setFilterStock(e.target.value)}
                                className="glass-input w-full p-2 text-sm"
                            >
                                <option value="Todos" className="bg-gray-900">Todos</option>
                                <option value="Con" className="bg-gray-900">Con Stock</option>
                                <option value="Bajo" className="bg-gray-900">Bajo Stock (&lt;=10)</option>
                                <option value="Sin" className="bg-gray-900">Sin Stock</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1 uppercase font-bold">ID Grupo Escala</label>
                            <select
                                value={filterGroup}
                                onChange={(e) => setFilterGroup(e.target.value)}
                                className="glass-input w-full p-2 text-sm"
                            >
                                <option value="" className="bg-gray-900">Todos</option>
                                {scaleGroups.map(g => (
                                    <option key={g} value={g} className="bg-gray-900">{g}</option>
                                ))}
                            </select>
                        </div>

                        <div className="md:col-span-4 flex justify-end">
                            <button
                                onClick={() => {
                                    setFilterCategory('Todos');
                                    setFilterTax('Todos');
                                    setFilterStock('Todos');
                                    setFilterGroup('');
                                }}
                                className="text-xs text-[var(--color-primary)] hover:underline"
                            >
                                Limpiar Filtros
                            </button>
                        </div>
                    </div>
                )}

                {/* Product List - Extracted & Memoized */}
                <InventoryProductList
                    products={visibleProducts}
                    formatCurrency={formatCurrency}
                    currentCurrency={currentCurrency}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    can={can}
                    handleScroll={handleScroll}
                    isLoading={isLoading}
                    hasMore={hasMore}
                />

            </div>
        </div>
    );
};

// Simple utility for internal class merging if not imported from utils
function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}

export default Inventory;

