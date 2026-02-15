
import React, { useState } from 'react';
import { Search, Plus, Edit, Trash2, Filter, Loader } from 'lucide-react';
import { useStore } from '../store/useStore';
import ProductModal from '../components/ProductModal';
import OptimizedImage from '../components/OptimizedImage';
import { formatCurrency } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';

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

    // --- EFFECTS ---

    // Load Products on Change
    React.useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            loadProducts(0, true);
        }, 300);
        return () => clearTimeout(delayDebounceFn);
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

    const visibleProducts = products.filter(product => {
        let matchesTax = true;
        if (filterTax !== 'Todos') {
            const tax = parseFloat(product.tax_rate) || 0;
            const targetTax = parseFloat(filterTax);
            // Handle floating point comparison loosely or exact? activeCompanyId is same.
            // Using abs difference < 0.01 just in case
            matchesTax = Math.abs(tax - targetTax) < 0.01;
        }

        let matchesStock = true;
        if (filterStock !== 'Todos') {
            const stock = parseFloat(product.stock) || 0;
            if (filterStock === 'Bajo') matchesStock = stock < 10 && stock > 0;
            if (filterStock === 'Sin') matchesStock = stock <= 0;
            if (filterStock === 'Con') matchesStock = stock > 0;
        }

        const matchesGroup = filterGroup === '' || (product.scale_group_id && product.scale_group_id.toLowerCase().includes(filterGroup.toLowerCase()));

        return matchesTax && matchesStock && matchesGroup;
    });

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
            alert('Error al guardar el producto: ' + (result?.error || 'Error desconocido'));
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
        <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
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
                <div className="glass-card p-3 lg:p-4 flex flex-col md:flex-row gap-3 lg:gap-4 items-center mb-3 lg:mb-4 shrink-0">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, SKU o categoría..."
                            className="glass-input pl-10 w-full text-sm lg:text-base"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`glass px-3 lg:px-4 py-2 lg:py-3 rounded-lg transition-colors flex items-center gap-2 text-sm ${showFilters ? 'bg-[var(--color-primary)] text-black' : 'hover:bg-[var(--color-surface-hover)]'}`}
                    >
                        <Filter size={18} className={showFilters ? "text-black" : "text-[var(--color-text-muted)]"} />
                        {showFilters && <span className="font-bold">Filtros</span>}
                    </button>
                </div>

                {/* Advanced Filters Panel */}
                {showFilters && (
                    <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2 fade-in duration-200 mb-4 shrink-0">
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
                                <option value="Bajo" className="bg-gray-900">Bajo Stock (&lt;10)</option>
                                <option value="Sin" className="bg-gray-900">Sin Stock</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1 uppercase font-bold">ID Grupo Escala</label>
                            <input
                                type="text"
                                placeholder="Ej: LIMPIADORES..."
                                value={filterGroup}
                                onChange={(e) => setFilterGroup(e.target.value)}
                                className="glass-input w-full p-2 text-sm"
                            />
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

                {/* Product List - Cards on Mobile, Table on Desktop */}
                <div className="glass-card overflow-hidden p-0 flex-1 flex flex-col">
                    {/* Mobile Card View */}
                    <div className="lg:hidden flex-1 overflow-y-auto pb-20" onScroll={handleScroll}>
                        {visibleProducts.map((product) => (
                            <div
                                key={product.id}
                                className={cn(
                                    "p-3 border-b border-[var(--glass-border)] flex items-center gap-3",
                                    (product.is_offer === 1 || product.is_offer === true) ? "bg-yellow-500/5" : ""
                                )}
                            >
                                {/* Image */}
                                <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center justify-center">
                                    <OptimizedImage
                                        src={product.image}
                                        alt={product.name}
                                        className="w-full h-full object-cover"
                                        priority={false}
                                        fallback={
                                            <span className="text-xs text-[var(--color-text-muted)] font-medium">Img</span>
                                        }
                                    />
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-2 mb-0.5">
                                        {(product.is_offer === 1 || product.is_offer === true) && (
                                            <span className="text-[8px] bg-yellow-500 text-black px-1.5 py-0.5 rounded-full font-bold">OFERTA</span>
                                        )}
                                        <h3 className="text-sm font-bold text-[var(--color-text)] line-clamp-1">{product.name}</h3>
                                    </div>
                                    <p className="text-xs text-[var(--color-text-muted)] font-mono mb-1">{product.sku}</p>
                                    <div className="flex items-center gap-3">
                                        <span className="text-base font-bold text-green-400">{formatCurrency(product.price, currentCurrency)}</span>
                                        <span className="text-xs text-[var(--color-text-muted)]">Costo: {formatCurrency(product.cost || 0, currentCurrency)}</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 shrink-0">
                                    {can('products.edit') && (
                                        <button
                                            onClick={() => handleEdit(product)}
                                            className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg text-blue-400 transition-colors"
                                        >
                                            <Edit size={18} />
                                        </button>
                                    )}
                                    {can('products.delete') && (
                                        <button
                                            onClick={() => handleDelete(product.id)}
                                            className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg text-red-400 transition-colors"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {visibleProducts.length === 0 && (
                            <div className="p-10 text-center text-[var(--color-text-muted)]">
                                No se encontraron productos
                            </div>
                        )}
                    </div>

                    {/* Desktop Table View */}
                    <div
                        className="hidden lg:block overflow-x-auto overflow-y-auto flex-1 custom-scrollbar"
                        onScroll={handleScroll}
                    >
                        <table className="w-full text-left">
                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-sm font-semibold sticky top-0 backdrop-blur-md z-10">
                                <tr>
                                    <th className="px-6 py-5">Producto</th>
                                    <th className="px-6 py-5">Imagen</th>
                                    <th className="px-6 py-5">Categoría</th>
                                    <th className="px-6 py-5">SKU</th>
                                    <th className="px-6 py-5">Precio</th>
                                    <th className="px-6 py-5">Costo</th>
                                    <th className="px-6 py-5">IVA</th>
                                    <th className="px-6 py-5">Margen</th>
                                    <th className="px-6 py-5">Stock</th>
                                    <th className="px-6 py-5 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {visibleProducts.map((product) => (
                                    <tr key={product.id} className={cn(
                                        "hover:bg-[var(--glass-bg)] transition-colors group",
                                        (product.is_offer === 1 || product.is_offer === true) ? "bg-yellow-500/5 hover:bg-yellow-500/10" : ""
                                    )}>
                                        <td className="px-6 py-5 font-medium text-[var(--color-text)] text-lg flex items-center gap-2">
                                            {(product.is_offer === 1 || product.is_offer === true) && (
                                                <span className="text-[10px] bg-yellow-500 text-black px-2 py-0.5 rounded-full font-bold animate-pulse">
                                                    OFERTA
                                                </span>
                                            )}
                                            {product.name}
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center justify-center">
                                                <OptimizedImage
                                                    src={product.image}
                                                    alt={product.name}
                                                    className="w-full h-full object-cover"
                                                    priority={false}
                                                    fallback={
                                                        <span className="text-xs text-[var(--color-text-muted)] font-medium">Img</span>
                                                    }
                                                />
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className="px-3 py-1.5 rounded-full text-sm font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                                                {product.category}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-[var(--color-text-muted)] font-mono text-base">{product.sku}</td>
                                        <td className="px-6 py-5 text-[var(--color-text)] font-bold text-xl">{formatCurrency(product.price, currentCurrency)}</td>
                                        <td className="px-6 py-5 text-[var(--color-text-muted)] text-lg">{formatCurrency(product.cost || 0, currentCurrency)}</td>
                                        <td className="px-6 py-5 text-[var(--color-text-muted)] text-sm">
                                            {product.tax_rate > 0 ? `IVA(${product.tax_rate} %)` : 'Exento (0%)'}
                                        </td>
                                        <td className="px-6 py-5">
                                            {(() => {
                                                const taxRate = parseFloat(product.tax_rate) || 0;
                                                const netPrice = parseFloat(product.price) / (1 + taxRate / 100);
                                                const cost = parseFloat(product.cost) || 0;
                                                if (cost <= 0) return <span className="text-[var(--color-text-muted)] text-lg">-</span>;

                                                const margin = ((netPrice - cost) / cost) * 100;
                                                const marginValue = netPrice - cost;

                                                return (
                                                    <div className="flex flex-col">
                                                        <span className={cn("font-bold text-base", margin > 0 ? "text-green-400" : "text-red-400")}>
                                                            {margin.toFixed(1)}%
                                                        </span>
                                                        <span className="text-sm text-[var(--color-text-muted)]">
                                                            {formatCurrency(marginValue, currentCurrency)}
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className={cn(
                                                "font-bold text-lg",
                                                product.stock < 10 ? "text-red-400" : "text-green-400"
                                            )}>
                                                {product.stock}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {can('products.edit') && (
                                                    <button
                                                        onClick={() => handleEdit(product)}
                                                        className="p-3 hover:bg-[var(--color-surface-hover)] rounded-lg text-blue-400 transition-colors"
                                                    >
                                                        <Edit size={24} />
                                                    </button>
                                                )}
                                                {can('products.delete') && (
                                                    <button
                                                        onClick={() => handleDelete(product.id)}
                                                        className="p-3 hover:bg-[var(--color-surface-hover)] rounded-lg text-red-400 transition-colors"
                                                    >
                                                        <Trash2 size={24} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {visibleProducts.length === 0 && (
                            <div className="p-10 text-center text-[var(--color-text-muted)]">
                                No se encontraron productos
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

// Simple utility for internal class merging if not imported from utils
function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}

export default Inventory;

