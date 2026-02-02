import React, { useState } from 'react';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, ImageOff, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import PaymentModal from '../components/PaymentModal';
import CashOpeningModal from '../components/CashOpeningModal';
import CashStatusWidget from '../components/CashStatusWidget';
import SaleSuccessModal from '../components/SaleSuccessModal';
import ClientSearchWidget from '../components/ClientSearchWidget';
import OptimizedImage from '../components/OptimizedImage';
import SuspendedSalesModal from '../components/SuspendedSalesModal';

// Component for Kg quantity input that allows typing decimals with comma
const KgQuantityInput = ({ value, onChange, onCommit }) => {
    const [localValue, setLocalValue] = useState(String(value));
    const [isFocused, setIsFocused] = useState(false);

    // Sync external value when not focused
    React.useEffect(() => {
        if (!isFocused) {
            setLocalValue(String(value));
        }
    }, [value, isFocused]);

    const handleChange = (e) => {
        const raw = e.target.value;
        // Allow: empty, digits, one comma or dot
        if (/^[0-9]*[,.]?[0-9]*$/.test(raw)) {
            setLocalValue(raw);
            // Update parent with parsed value for real-time total calculation
            const parsed = parseFloat(raw.replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) {
                onChange(parsed);
            }
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        const parsed = parseFloat(localValue.replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) {
            onCommit(0);
        } else {
            onCommit(parsed);
        }
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            className="w-14 bg-transparent text-center text-[var(--color-text)] font-bold text-lg outline-none border-b border-transparent hover:border-[var(--glass-border)] focus:border-[var(--color-primary)] transition-colors appearance-none"
            value={isFocused ? localValue : value}
            onFocus={() => {
                setIsFocused(true);
                setLocalValue(String(value));
            }}
            onChange={handleChange}
            onBlur={handleBlur}
        />
    );
};

const POS = () => {
    const {
        products,
        categories: storedCategories,
        addToCart,
        removeFromCart,
        clearCart,
        updateCartItem,
        addSale,
        currentUser,
        cashRegister,
        checkRegisterStatus,
        inventoryAdjustmentMode,
        setPosSelectedClient,
        searchProducts,
        loadCategoryProducts,
        getProductByBarcode,
        activeCompanyId,
        suspendSale,
        suspendedSalesCount,
        updateSuspendedCount,
        // Multi-Cart
        carts,
        activeCartId,
        addCart,
        setActiveCart,
        removeCart
    } = useStore();

    // Derivar cart y client manualmente (fix para computed getters)
    // Key para forzar re-render cuando cambian items
    const cartKey = React.useMemo(() => {
        const activeCart = carts.find(c => c.id === activeCartId);
        // Usamos JSON.stringify para detectar cambios profundos en los items si es necesario, 
        // o simplemente confiamos en que carts cambia de referencia.
        // Agregamos timestamp para debug, pero lo importante es que esto se ejecute cuando carts cambie.
        return `${activeCartId}-${activeCart?.items?.length || 0}`;
    }, [carts, activeCartId]);

    const cart = React.useMemo(() => {
        const activeCart = carts.find(c => c.id === activeCartId);
        console.log('🔄 Cart recalculated:', {
            cartId: activeCartId,
            itemsCount: activeCart?.items?.length || 0,
            items: activeCart?.items?.map(i => i.name) || []
        });
        return activeCart?.items || [];
    }, [carts, activeCartId, cartKey]);

    const posSelectedClient = React.useMemo(() => {
        return carts.find(c => c.id === activeCartId)?.client || null;
    }, [carts, activeCartId]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('Todos');
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
    const [lastSaleDetails, setLastSaleDetails] = useState(null);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);
    const [showSuspendedModal, setShowSuspendedModal] = useState(false);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

    // Cargar contador de ventas suspendidas
    React.useEffect(() => {
        updateSuspendedCount();
    }, [updateSuspendedCount]);

    // NUEVO: Precargar productos al montar el componente
    React.useEffect(() => {
        console.log('🚀 POS montado - Precargando productos iniciales...');
        setIsLoadingProducts(true);
        console.time('⏱️ Carga inicial productos');

        loadCategoryProducts('Todos', 0).then(() => {
            console.timeEnd('⏱️ Carga inicial productos');
            setIsLoadingProducts(false);
            console.log('✅ Productos precargados');
        });
    }, []); // Array vacío = solo una vez al montar

    // Barcode Scanner Listener
    React.useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = (e) => {
            const currentTime = Date.now();

            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

            if (currentTime - lastKeyTime > 100) buffer = '';
            lastKeyTime = currentTime;

            if (e.key === 'Enter') {
                if (buffer.length > 0) {
                    // Direct Server-Side Lookup (User Request: "search from server not local")
                    getProductByBarcode(buffer).then(p => {
                        if (p) {
                            addToCart(p);
                        } else {
                            searchProducts(buffer);
                        }
                    });
                    buffer = '';
                }
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [products, addToCart, searchProducts]);

    // Use stored categories for the filter list. 
    const categoryList = ['Todos', ...storedCategories
        .filter(c => c.status === 'active' && c.showInPos !== false)
        .map(c => c.name)];

    // Products are now served pre-filtered
    const visibleProducts = products;

    const finalTotal = cart.reduce((total, item) => {
        const itemTotal = item.price * item.quantity;
        const discountAmount = itemTotal * ((item.discountPercent || 0) / 100);
        return total + (itemTotal - discountAmount);
    }, 0);

    const taxTotal = cart.reduce((total, item) => {
        const itemTotal = item.price * item.quantity;
        const discountAmount = itemTotal * ((item.discountPercent || 0) / 100);
        const taxableAmount = itemTotal - discountAmount;

        const itemTax = item.tax_rate ? (taxableAmount - (taxableAmount / (1 + item.tax_rate / 100))) : 0;
        return total + itemTax;
    }, 0);
    const subTotal = finalTotal - taxTotal;

    const handleCheckoutClick = () => {
        if (cart.length === 0) return;
        setIsPaymentModalOpen(true);
    };

    const handlePaymentConfirm = async (paymentData) => {
        const saleData = {
            items: cart,
            total: finalTotal,
            summary: `${cart.length} productos`,
            paymentMethod: paymentData.method,
            paymentDetails: paymentData,
            client: posSelectedClient
        };

        const result = await addSale(saleData);

        if (result.success) {
            // Prepare data for success modal
            setLastSaleDetails(saleData);
            setIsSuccessModalOpen(true);
            setPosSelectedClient(null);
            // Do NOT clear cart here, wait for "New Sale" or modal close
        } else {
            alert(result.error || "Error al procesar la venta");
        }
    };

    const handleNewSale = () => {
        clearCart();
        setIsSuccessModalOpen(false);
        setLastSaleDetails(null);
    };

    const handleCategoryChange = async (category) => {
        console.log('🔄 Changing category to:', category);
        setSelectedCategory(category);
        setIsLoadingProducts(true);
        setOffset(0); // Reset pagination

        const hasMoreResult = await loadCategoryProducts(category, 0);
        setHasMore(hasMoreResult); // Update hasMore based on result

        setIsLoadingProducts(false);
    };

    // Check register status on mount
    React.useEffect(() => {
        if (currentUser) {
            checkRegisterStatus(currentUser.id);
        }
    }, [currentUser, checkRegisterStatus]);

    // Pagination State
    const [offset, setOffset] = React.useState(0);
    const [hasMore, setHasMore] = React.useState(true);
    const [isLoadingMore, setIsLoadingMore] = React.useState(false);

    // Initial Load & Category Change
    React.useEffect(() => {
        const load = async () => {
            // If searching, we skip category load (or maybe we paginate search too? user asked for general scroll)
            // For now, let's assume search handles its own limit or we stick to category mainly.
            if (searchTerm) {
                // Search is currently handled by separate effect, let's keep it simple.
                return;
            }

            // Only run this on Mount or Company Change if needed
            // But we have a specific mount effect now. 
            // So this is mainly for ActiveCompanyId changes if distinct from mount (?)
            // Actually, let's just keep it for activeCompanyId, but NOT selectedCategory
            if (activeCompanyId) {
                setIsLoadingMore(true);
                setOffset(0);
                const hasMoreResult = await loadCategoryProducts(selectedCategory, 0);
                setHasMore(hasMoreResult);
                setIsLoadingMore(false);
            }
        };
        load();
    }, [searchTerm, activeCompanyId]); // Removed selectedCategory to avoid double-fetch with handler

    // Search Effect (existing logic modified to reset list)
    React.useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            if (searchTerm) {
                // If we want infinite scroll on search too, we need to update searchProducts signature.
                // For now, let's keep search simple (50 items) or user might get confused.
                // But user asked "bring first 30... then scroll".
                searchProducts(searchTerm);
                setHasMore(false); // Disable infinite scroll for search for now unless requested
            } else {
                // Should fall back to category load above
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm]);

    const handleScroll = async (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;

        // Check if we are near bottom (within 100px) and have more data
        if (scrollHeight - scrollTop <= clientHeight + 100 && hasMore && !isLoadingMore && !searchTerm) {
            setIsLoadingMore(true);
            const newOffset = offset + 30;
            const hasMoreResult = await loadCategoryProducts(selectedCategory, newOffset);

            setOffset(newOffset);
            setHasMore(hasMoreResult);
            setIsLoadingMore(false);
        }
    };

    // Shortcuts de teclado para cambiar carritos
    React.useEffect(() => {
        const handleKeyPress = (e) => {
            // Ctrl/Cmd + 1, 2, 3 para cambiar de carrito
            if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
                e.preventDefault();
                const cartIndex = parseInt(e.key) - 1;
                if (carts[cartIndex]) {
                    setActiveCart(carts[cartIndex].id);
                }
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [carts, setActiveCart]);

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-100px)]">
            <CashOpeningModal isOpen={!cashRegister && !!currentUser} />
            <SaleSuccessModal
                isOpen={isSuccessModalOpen}
                onClose={() => setIsSuccessModalOpen(false)}
                saleDetails={lastSaleDetails}
                onNewSale={handleNewSale}
                seller={currentUser}
            />

            {/* Left Side: Product Grid */}
            <div className="flex-1 flex flex-col gap-2 lg:gap-4 overflow-hidden min-h-0">
                {/* Search & Categories - Compact on Mobile */}
                <div className="glass-card p-2 lg:p-4 space-y-2 lg:space-y-4 shrink-0 relative z-10">
                    <div className="flex gap-2 lg:gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar productos..."
                                className="glass-input !pl-10 lg:!pl-12 w-full text-sm lg:text-base py-2 lg:py-2.5"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                        // Direct Server-Side Lookup (User Request)
                                        const productToAdd = await getProductByBarcode(searchTerm);

                                        if (productToAdd) {
                                            addToCart(productToAdd);
                                            setSearchTerm('');
                                        }
                                    }
                                }}
                            />
                        </div>
                        <CashStatusWidget />
                    </div>

                    {inventoryAdjustmentMode && (
                        <div className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 px-2 py-1 lg:px-3 lg:py-1.5 rounded-lg text-xs lg:text-sm font-bold flex items-center justify-center animate-pulse">
                            ⚠️ MODO AJUSTE DE INVENTARIO ACTIVO
                        </div>
                    )}

                    <div className="flex gap-1.5 lg:gap-2 overflow-x-auto pb-1 lg:pb-2 scrollbar-thin">
                        {categoryList.map(cat => (
                            <button
                                key={cat}
                                onClick={() => handleCategoryChange(cat)}
                                className={cn(
                                    "px-3 lg:px-4 py-1.5 lg:py-2 rounded-full text-xs lg:text-sm font-medium whitespace-nowrap transition-all",
                                    selectedCategory === cat
                                        ? "bg-[var(--color-primary)] text-black shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                                        : "glass text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)] hover:text-[var(--color-text)]"
                                )}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Grid */}
                <div
                    className="flex-1 overflow-y-auto pr-2 grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-[1801px]:grid-cols-7 min-[2201px]:grid-cols-8 gap-2 lg:gap-4 content-start pb-28 lg:pb-4 custom-scrollbar"
                    onScroll={handleScroll}
                >
                    {isLoadingProducts ? (
                        <div className="col-span-full flex items-center justify-center py-12">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
                                <p className="text-gray-400">Cargando productos...</p>
                            </div>
                        </div>
                    ) : visibleProducts.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-gray-400">
                            No hay productos disponibles
                        </div>
                    ) : (
                        visibleProducts.map((product) => (
                            <div
                                key={product.id}
                                onClick={() => addToCart(product)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        addToCart(product);
                                    }
                                }}
                                className={cn(
                                    "rounded-xl glass-card bg-card p-0 text-[var(--color-text)] shadow-sm cursor-pointer border hover:bg-[var(--color-surface-hover)] transition-all duration-150 flex flex-col h-auto hover:shadow-lg active:scale-95 touch-manipulation relative group",
                                    (product.is_offer === 1 || product.is_offer === true)
                                        ? "border-yellow-500/50 bg-yellow-500/5 hover:border-yellow-400 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                                        : "border-[var(--glass-border)] hover:border-[var(--color-primary)]"
                                )}
                            >
                                {(product.is_offer === 1 || product.is_offer === true) && (
                                    <div className="absolute top-2 left-2 z-20 bg-yellow-500 text-black text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse shadow-lg">
                                        OFERTA
                                    </div>
                                )}
                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity z-10">
                                    <span className={cn(
                                        "text-[var(--color-primary)] bg-black/50 rounded-full w-6 h-6 flex items-center justify-center text-sm",
                                        product.image ? "text-[var(--color-text)]" : "text-[var(--color-primary)]"
                                    )}>+</span>
                                </div>

                                {/* Image Container - Full Width */}
                                <div className="w-full aspect-square bg-[var(--glass-bg)] flex items-center justify-center overflow-hidden relative shrink-0 rounded-t-xl">
                                    <OptimizedImage
                                        src={product.image}
                                        alt={product.name}
                                        className="w-full h-full object-contain p-2 transition-transform duration-500 group-hover:scale-110"
                                        priority={false}
                                    />
                                </div>

                                {/* Content Wrapper - Compact on Mobile */}
                                <div className="flex flex-col flex-1 w-full justify-between p-2 lg:p-3">
                                    <div>
                                        <h3 className="text-[var(--color-text)] font-bold text-[11px] lg:text-sm line-clamp-2 leading-tight mb-1 group-hover:text-[var(--color-primary)] transition-colors">
                                            {product.name}
                                        </h3>

                                        <div className="mb-1 lg:mb-2">
                                            {(product.is_offer === 1 || product.is_offer === true) && product.offer_price > 0 ? (
                                                <div className="flex flex-col items-start leading-none gap-0.5">
                                                    <span className="text-[9px] lg:text-xs text-red-400 line-through decoration-red-400 opacity-70 font-semibold">
                                                        ${product.price ? product.price.toFixed(2) : '0.00'}
                                                    </span>
                                                    <span className="text-yellow-400 font-extrabold text-base lg:text-xl drop-shadow-sm">
                                                        ${Number(product.offer_price).toFixed(2)}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-green-400 font-bold text-sm lg:text-lg tracking-tight">
                                                    ${product.price ? product.price.toFixed(2) : '0.00'}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="w-full flex justify-between items-center pt-1 lg:pt-2 border-t border-[var(--glass-border)]">
                                        <span className={cn(
                                            "font-medium px-1.5 lg:px-2 py-0.5 rounded text-[9px] lg:text-[10px]",
                                            product.pending_adjustment
                                                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                                                : product.stock < 10
                                                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                                    : "bg-green-500/20 text-green-400 border border-green-500/30"
                                        )}>
                                            {product.pending_adjustment ? '⚠' : `${product.stock}${product.unit === 'Kg' ? 'kg' : 'und'}`}
                                        </span>
                                        <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)] font-medium truncate max-w-[40%] text-right">
                                            {product.category || 'General'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )))}
                </div>
            </div>

            {/* Right Side: Cart (Desktop Only) */}
            <div className="hidden lg:flex w-full lg:w-[449px] flex-col glass-card p-0 overflow-hidden">
                <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-3">
                    <div className="w-full">
                        <ClientSearchWidget />
                    </div>
                    {/* Tabs de carritos (Nuevo Diseño) */}
                    <div className="mb-4">
                        <div className="flex w-full gap-2">
                            {carts.map(cart => {
                                const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
                                const isActive = cart.id === activeCartId;

                                return (
                                    <div
                                        key={cart.id}
                                        onClick={() => setActiveCart(cart.id)}
                                        className={cn(
                                            "flex-1 relative p-3 rounded-xl border transition-all cursor-pointer group flex flex-col justify-between h-20 select-none overflow-hidden",
                                            isActive
                                                ? "bg-[rgba(6,182,212,0.15)] border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                                                : "bg-[#1a1b26] border-white/5 hover:bg-[#202230] hover:border-white/10 opacity-70 hover:opacity-100"
                                        )}
                                    >
                                        {/* Header: Icon + Title + Close */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <ShoppingCart size={14} className={isActive ? "text-cyan-400" : "text-gray-500"} />
                                                <span className={cn("text-xs font-bold tracking-wide", isActive ? "text-white" : "text-gray-400")}>
                                                    {cart.name}
                                                </span>
                                            </div>

                                            {/* Botón X - Solo si hay más de 1 */}
                                            {carts.length > 1 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeCart(cart.id);
                                                    }}
                                                    className={cn(
                                                        "p-1 rounded-md transition-colors z-10",
                                                        isActive
                                                            ? "text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-200"
                                                            : "text-gray-600 hover:bg-white/10 hover:text-gray-300"
                                                    )}
                                                >
                                                    <X size={12} strokeWidth={3} />
                                                </button>
                                            )}
                                        </div>

                                        {/* Divider (Visual only, invisible but space) */}

                                        {/* Content: Count & Client */}
                                        <div className="flex flex-col">
                                            <div className="flex items-baseline gap-1">
                                                <span className={cn("text-lg font-black leading-none", isActive ? "text-cyan-400" : "text-gray-500")}>
                                                    {itemCount}
                                                </span>
                                                <span className={cn("text-[10px] font-medium uppercase tracking-wider", isActive ? "text-cyan-400/70" : "text-gray-600")}>
                                                    {itemCount === 1 ? 'Artículo' : 'Artículos'}
                                                </span>
                                            </div>

                                            {cart.client && (
                                                <div className="text-[10px] text-gray-500 truncate mt-0.5 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500/50 inline-block"></span>
                                                    {cart.client.name.split(' ')[0]}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Slot para agregar (Si hay menos de 3) */}
                            {carts.length < 3 && (
                                <button
                                    onClick={addCart}
                                    className="flex-[0.4] min-w-[60px] max-w-[100px] h-20 rounded-xl border border-dashed border-gray-800 hover:border-gray-600 bg-transparent hover:bg-white/5 flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-gray-400 transition-all group"
                                    title="Agregar Ticket"
                                >
                                    <div className="w-8 h-8 rounded-full bg-gray-800 group-hover:bg-gray-700 flex items-center justify-center transition-colors">
                                        <Plus size={16} />
                                    </div>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)] gap-2">
                            <ShoppingCart size={48} className="opacity-20" />
                            <p>El carrito está vacío</p>
                        </div>
                    ) : (
                        cart.map((item) => {
                            const unitPrice = item.price;
                            const totalPrice = (unitPrice * item.quantity);
                            const discountPercent = item.discountPercent || 0;
                            const discountAmount = totalPrice * (discountPercent / 100);
                            const finalPrice = totalPrice - discountAmount;

                            const discountedUnitPrice = unitPrice * (1 - discountPercent / 100);

                            return (
                                <div key={item.id} className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] space-y-2">
                                    {/* Row 1: Name and Remove */}
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex flex-col">
                                            <h4 className="text-[var(--color-text)] font-medium text-sm line-clamp-2">{item.name}</h4>
                                            {item.scale_group_id && (
                                                <span className="text-[10px] text-purple-400 font-mono">Grupo: {item.scale_group_id}</span>
                                            )}
                                        </div>
                                        <button
                                            className="text-[var(--color-text-muted)] hover:text-red-400 transition-colors p-1"
                                            onClick={() => removeFromCart(item.id)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>

                                    {/* Row 2: Prices */}
                                    <div className="flex justify-between items-center text-xs text-[var(--color-text-muted)]">
                                        <div className="flex items-center gap-2">
                                            <span>{item.unit === 'Kg' ? 'Kg:' : 'Und:'}</span>
                                            <div className="flex items-center gap-1">
                                                <span className="text-[var(--color-text-muted)] text-sm">$</span>
                                                <input
                                                    type="number"
                                                    className="w-20 bg-transparent text-sm font-bold text-[var(--color-text)] outline-none border-b border-[var(--glass-border)] focus:border-[var(--color-primary)] transition-colors"
                                                    value={item.price}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value);
                                                        if (!isNaN(val) && val >= 0) {
                                                            updateCartItem(item.id, { price: val });
                                                        }
                                                    }}
                                                />
                                            </div>

                                            {discountPercent > 0 && (
                                                <span className="text-green-400 font-bold ml-1 text-xs">
                                                    (${discountedUnitPrice.toLocaleString('es-CL')})
                                                </span>
                                            )}
                                            {(!item.is_offer && item.price < (item.original_price || item.price) && item.price_ranges?.length > 0) && (
                                                <span className="ml-2 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                                                    Mayorista
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-[var(--color-primary)] font-bold text-base">
                                                Total: ${finalPrice.toLocaleString('es-CL')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Row 3: Controls */}
                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--glass-border)]">
                                        {/* Discount Input */}
                                        <div className="flex items-center gap-1 bg-[var(--glass-bg)] rounded-lg px-2 py-1.5 border border-[var(--glass-border)] w-24 group focus-within:border-[var(--color-primary)]/50 transition-colors">
                                            <span className="text-xs text-[var(--color-text-muted)] font-bold group-focus-within:text-[var(--color-primary)]">%</span>
                                            <input
                                                type="number"
                                                placeholder="0"
                                                min="0"
                                                max="100"
                                                className="w-full bg-transparent text-sm text-[var(--color-text)] outline-none text-right font-bold"
                                                value={item.discountPercent || ''}
                                                onChange={(e) => {
                                                    let val = parseFloat(e.target.value);
                                                    if (isNaN(val)) val = 0;
                                                    if (val < 0) val = 0;
                                                    if (val > 100) val = 100;

                                                    updateCartItem(item.id, { discountPercent: val });
                                                }}
                                            />
                                        </div>

                                        {/* Quantity Controls */}
                                        <div className="flex items-center gap-4 bg-[var(--glass-bg)] rounded-lg p-1.5 border border-[var(--glass-border)]">
                                            <button
                                                className="w-8 h-8 rounded-lg bg-[var(--glass-bg)] flex items-center justify-center text-[var(--color-text)] hover:bg-white/10 transition-colors"
                                                onClick={() => {
                                                    const isKg = item.unit === 'Kg';
                                                    const minVal = isKg ? 0.001 : 1;

                                                    if (item.quantity > minVal) {
                                                        const newVal = item.quantity - 1;
                                                        updateCartItem(item.id, {
                                                            quantity: newVal < minVal ? minVal : newVal
                                                        });
                                                    }
                                                }}
                                            >
                                                <Minus size={18} />
                                            </button>
                                            {item.unit === 'Kg' ? (
                                                <KgQuantityInput
                                                    value={item.quantity}
                                                    onChange={(val) => updateCartItem(item.id, { quantity: val, _skipRemoval: true })}
                                                    onCommit={(val) => {
                                                        if (val <= 0) {
                                                            updateCartItem(item.id, { quantity: 0.001 });
                                                        } else {
                                                            updateCartItem(item.id, { quantity: val });
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-[var(--color-text)] font-bold text-lg w-8 text-center">{item.quantity}</span>
                                            )}
                                            <button
                                                className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-black transition-colors"
                                                onClick={() => updateCartItem(item.id, { quantity: item.quantity + 1 })}
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-4">
                    <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                        <span>Subtotal (Neto)</span>
                        <span>${subTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                        <span>Impuestos Total</span>
                        <span>${taxTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[var(--color-text)] text-2xl font-bold pt-2 border-t border-[var(--glass-border)]">
                        <span>Total</span>
                        <span className="neon-text">${finalTotal.toFixed(2)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button disabled={cart.length === 0} onClick={handleCheckoutClick} className="btn-primary col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl">
                            <Banknote size={20} />
                            Cobrar
                        </button>

                        {/* Botón Suspender/Recuperar */}
                        <button
                            onClick={async () => {
                                if (cart.length > 0) {
                                    // Suspender venta actual
                                    const success = await suspendSale();
                                    if (success) {
                                        // Opcional: mostrar notificación
                                        console.log('✅ Venta suspendida');
                                    }
                                } else {
                                    // Abrir modal de recuperar
                                    setShowSuspendedModal(true);
                                }
                            }}
                            disabled={cart.length === 0 && suspendedSalesCount === 0}
                            className={`w-full py-3 col-span-2 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${cart.length > 0
                                ? 'bg-orange-500 hover:bg-orange-600 text-white'
                                : suspendedSalesCount > 0
                                    ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                        >
                            {cart.length > 0 ? (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                    Suspender Venta
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 3l3 9-3 9 19-9z"></path>
                                    </svg>
                                    Recuperar {suspendedSalesCount > 0 ? `(${suspendedSalesCount})` : ''}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            {/* Mobile Cart - Floating Button + Bottom Sheet */}
            <div className="lg:hidden">
                {/* Floating Button */}
                {!isMobileCartOpen && (
                    <button
                        onClick={() => setIsMobileCartOpen(true)}
                        className="fixed bottom-4 left-4 right-4 z-40 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-4 px-6 flex items-center justify-center gap-3 shadow-2xl shadow-blue-500/30 active:scale-95 transition-all"
                    >
                        <ShoppingCart size={24} />
                        <span className="font-bold text-lg">Abrir Carrito</span>
                        {cart.length > 0 && (
                            <>
                                <span className="text-blue-200">•</span>
                                <span className="text-sm">{cart.reduce((sum, item) => sum + item.quantity, 0)} Items</span>
                                <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-bold ml-auto">
                                    ${finalTotal.toLocaleString('es-CL')}
                                </span>
                            </>
                        )}
                    </button>
                )}

                {/* Bottom Sheet */}
                {isMobileCartOpen && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => setIsMobileCartOpen(false)}
                        />

                        {/* Sheet Content */}
                        <div className="relative bg-[#0f1016] w-full rounded-t-3xl shadow-2xl border-t border-white/10 flex flex-col max-h-[85vh] animate-slide-up">
                            {/* Handle */}
                            <div
                                className="w-full flex justify-center pt-3 pb-2 cursor-pointer"
                                onClick={() => setIsMobileCartOpen(false)}
                            >
                                <div className="w-12 h-1.5 bg-gray-600 rounded-full" />
                            </div>

                            {/* Header */}
                            <div className="px-4 pb-3 border-b border-white/10 flex items-center justify-between">
                                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                                    <ShoppingCart size={20} className="text-cyan-400" />
                                    Carrito
                                    {cart.length > 0 && (
                                        <span className="bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 rounded-full">
                                            {cart.reduce((sum, item) => sum + item.quantity, 0)} items
                                        </span>
                                    )}
                                </h2>
                                <button
                                    onClick={() => setIsMobileCartOpen(false)}
                                    className="p-2 text-gray-400 hover:text-white"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Cart Items */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {cart.length === 0 ? (
                                    <div className="h-48 flex flex-col items-center justify-center text-gray-500">
                                        <ShoppingCart size={48} className="opacity-20 mb-3" />
                                        <p>Tu carrito está vacío</p>
                                    </div>
                                ) : (
                                    cart.map((item) => {
                                        const unitPrice = item.price;
                                        const totalPrice = unitPrice * item.quantity;
                                        const discountPercent = item.discountPercent || 0;
                                        const discountAmount = totalPrice * (discountPercent / 100);
                                        const finalPrice = totalPrice - discountAmount;

                                        return (
                                            <div key={item.id} className="bg-[#1a1b26] rounded-xl p-3 border border-white/5">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="text-white text-sm font-medium line-clamp-2 flex-1 pr-2">
                                                        {item.name}
                                                    </span>
                                                    <button
                                                        onClick={() => removeFromCart(item.id)}
                                                        className="text-gray-500 hover:text-red-400 p-1"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <div className="flex items-center gap-2 bg-black/30 rounded-lg p-1">
                                                        <button
                                                            className="w-8 h-8 flex items-center justify-center bg-gray-700 rounded-lg text-white"
                                                            onClick={() => {
                                                                if (item.quantity > 1) {
                                                                    updateCartItem(item.id, { quantity: item.quantity - 1 });
                                                                }
                                                            }}
                                                        >
                                                            <Minus size={14} />
                                                        </button>
                                                        <span className="font-bold text-white w-8 text-center">{item.quantity}</span>
                                                        <button
                                                            className="w-8 h-8 flex items-center justify-center bg-emerald-500 rounded-lg text-black"
                                                            onClick={() => updateCartItem(item.id, { quantity: item.quantity + 1 })}
                                                        >
                                                            <Plus size={14} />
                                                        </button>
                                                    </div>
                                                    <span className="text-green-400 font-bold text-lg">
                                                        ${finalPrice.toLocaleString('es-CL')}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Footer with Total and Checkout */}
                            <div className="p-4 border-t border-white/10 bg-[#14141f] space-y-3 pb-8">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-400">Total a Pagar</span>
                                    <span className="text-2xl font-black text-green-400">
                                        ${finalTotal.toLocaleString('es-CL')}
                                    </span>
                                </div>
                                <button
                                    onClick={() => {
                                        setIsMobileCartOpen(false);
                                        handleCheckoutClick();
                                    }}
                                    disabled={cart.length === 0}
                                    className="w-full btn-primary py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <Banknote size={24} />
                                    Cobrar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            <SuspendedSalesModal
                isOpen={showSuspendedModal}
                onClose={() => setShowSuspendedModal(false)}
            />

            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                total={finalTotal}
                onConfirm={handlePaymentConfirm}
            />
        </div>
    );
};

export default POS;
