import React, { useState, useRef, useEffect as useEffectReact } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, ImageOff, X, ChevronDown, ChevronUp, Gift, FileText, Receipt, ScanBarcode, Package, Store } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../lib/utils';
import { formatCurrency, getCurrencySymbol } from '../utils/formatCurrency';
import PaymentModal from '../components/PaymentModal';
import CashOpeningModal from '../components/CashOpeningModal';
import CashStatusWidget from '../components/CashStatusWidget';
import SaleSuccessModal from '../components/SaleSuccessModal';
import ClientSearchWidget from '../components/ClientSearchWidget';
import OptimizedImage from '../components/OptimizedImage';
import SuspendedSalesModal from '../components/SuspendedSalesModal';
import InvoiceDataModal from '../components/InvoiceDataModal';
import PreventaSuccessModal from '../components/PreventaSuccessModal';
import PreventasListModal from '../components/PreventasListModal';
import ScaleReadButton from '../components/ScaleReadButton';
import { usePermissions } from '../hooks/usePermissions';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { dataApiCall, reportCall } from '../lib/dataApi';

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
    // PERF: selector shallow para evitar re-renders del POS por cambios en otras
    // partes del store (ej. polling de permisos, alertas, soporte, etc.)
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
        setCartTipoDte,
        searchProducts,
        loadCategoryProducts,
        getProductByBarcode,
        fetchCombosForPOS,
        activeCompanyId,
        suspendSale,
        suspendedSalesCount,
        updateSuspendedCount,
        createPreventa,
        fetchPreventaByCode,
        completePreventa,
        pendingPreventasCount,
        updatePreventasCount,
        carts,
        activeCartId,
        addCart,
        setActiveCart,
        removeCart,
        currentCurrency,
    } = useStore(
        useShallow((s) => ({
            products: s.products,
            categories: s.categories,
            addToCart: s.addToCart,
            removeFromCart: s.removeFromCart,
            clearCart: s.clearCart,
            updateCartItem: s.updateCartItem,
            addSale: s.addSale,
            currentUser: s.currentUser,
            cashRegister: s.cashRegister,
            checkRegisterStatus: s.checkRegisterStatus,
            inventoryAdjustmentMode: s.inventoryAdjustmentMode,
            setPosSelectedClient: s.setPosSelectedClient,
            setCartTipoDte: s.setCartTipoDte,
            searchProducts: s.searchProducts,
            loadCategoryProducts: s.loadCategoryProducts,
            getProductByBarcode: s.getProductByBarcode,
            fetchCombosForPOS: s.fetchCombosForPOS,
            activeCompanyId: s.activeCompanyId,
            suspendSale: s.suspendSale,
            suspendedSalesCount: s.suspendedSalesCount,
            updateSuspendedCount: s.updateSuspendedCount,
            createPreventa: s.createPreventa,
            fetchPreventaByCode: s.fetchPreventaByCode,
            completePreventa: s.completePreventa,
            pendingPreventasCount: s.pendingPreventasCount,
            updatePreventasCount: s.updatePreventasCount,
            carts: s.carts,
            activeCartId: s.activeCartId,
            addCart: s.addCart,
            setActiveCart: s.setActiveCart,
            removeCart: s.removeCart,
            currentCurrency: s.currentCurrency,
        }))
    );

    const navigate = useNavigate();

    // Módulo Pedidos/Encargos gateado por plan (Medium+)
    const canPreorders = useStore((s) => s.hasModule('preorders'));

    const cart = React.useMemo(() => {
        const activeCart = carts.find(c => c.id === activeCartId);
        return activeCart?.items || [];
    }, [carts, activeCartId]);

    const posSelectedClient = React.useMemo(() => {
        return carts.find(c => c.id === activeCartId)?.client || null;
    }, [carts, activeCartId]);

    const posTipoDte = React.useMemo(() => {
        const dte = carts.find(c => c.id === activeCartId)?.tipoDte;
        return dte != null ? dte : 39;
    }, [carts, activeCartId]);

    const [siiActive, setSiiActive] = React.useState(false);
    const [enabledDtes, setEnabledDtes] = React.useState([0]);
    const [defaultDte, setDefaultDte] = React.useState(0);

    React.useEffect(() => {
        if (!activeCompanyId) return;
        // Reset to safe defaults immediately on company change
        setSiiActive(false);
        setEnabledDtes([0]);
        setDefaultDte(0);
        setCartTipoDte(0);

        reportCall(activeCompanyId, 'siiConfigPos', {}).then(rows => {
            const r = { rows };
            if (r.rows.length > 0 && Number(r.rows[0].is_active) === 1) {
                setSiiActive(true);
                let dtes = [0];
                if (r.rows[0].enabled_dtes) {
                    try { dtes = JSON.parse(r.rows[0].enabled_dtes); } catch {}
                }
                setEnabledDtes(dtes);
                const def = r.rows[0].default_dte != null ? Number(r.rows[0].default_dte) : (dtes.includes(39) ? 39 : 0);
                setDefaultDte(def);
                setCartTipoDte(def);
            } else {
                // No SII: force nota de venta only
                setSiiActive(false);
                setEnabledDtes([0]);
                setDefaultDte(0);
                setCartTipoDte(0);
            }
        }).catch(() => {
            setSiiActive(false);
            setEnabledDtes([0]);
            setDefaultDte(0);
            setCartTipoDte(0);
        });
    }, [activeCompanyId]);

    // Auto-switch a Factura (33) si el cliente tiene RUT, otherwise use default
    React.useEffect(() => {
        if (!siiActive) return;
        if (posSelectedClient?.rut && enabledDtes.includes(33)) {
            setCartTipoDte(33);
        } else {
            setCartTipoDte(defaultDte);
        }
    }, [posSelectedClient, siiActive, enabledDtes, defaultDte]);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('Todos');
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [pendingInvoiceData, setPendingInvoiceData] = useState(null);
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
    const [lastSaleDetails, setLastSaleDetails] = useState(null);
    const [isProcessingSale, setIsProcessingSale] = useState(false);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);
    const [showSuspendedModal, setShowSuspendedModal] = useState(false);
    const [showPreventasListModal, setShowPreventasListModal] = useState(false);
    const [showPreventaSuccessModal, setShowPreventaSuccessModal] = useState(false);
    const [lastPreventaData, setLastPreventaData] = useState(null);

    // Detector de conexión para mostrar banner offline en el POS
    const { online } = useOnlineStatus();
    const [activePreventaCode, setActivePreventaCode] = useState(null);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
    const [showTotalsDetail, setShowTotalsDetail] = useState(false);
    const { can } = usePermissions();

    // Cargar contador de ventas suspendidas y preventas
    React.useEffect(() => {
        updateSuspendedCount();
        updatePreventasCount();
    }, [updateSuspendedCount, updatePreventasCount]);

    // PERF: la carga de productos se delega al efecto de [searchTerm, activeCompanyId]
    // (más abajo). Aquí solo pre-calentamos en background el caché de Encargos.
    React.useEffect(() => {
        const { getPreorderableProducts, hasModule } = useStore.getState();
        if (getPreorderableProducts && hasModule('preorders')) {
            getPreorderableProducts('', 'Todos').catch(() => {});
        }
    }, []);

    // Barcode Scanner Logic using custom hook
    // This hook is stable and won't detach on simple prop changes
    const handleBarcodeScan = React.useCallback(async (scannedCode) => {
        if (!scannedCode) return;

        console.log("🔍 Escaneado:", scannedCode);

        // Detect preventa codes (start with PV)
        if (scannedCode.toUpperCase().startsWith('PV')) {
            try {
                const preventa = await fetchPreventaByCode(scannedCode.toUpperCase());
                if (preventa) {
                    clearCart();
                    preventa.items.forEach(item => {
                        addToCart({
                            id: item.id, name: item.name, price: item.price,
                            cost: item.cost || 0, quantity: item.quantity,
                            tax_rate: item.tax_rate || 0, image: item.image || null,
                            sku: item.sku || '', stock: item.stock || 0
                        });
                    });
                    if (preventa.client_data) setPosSelectedClient(preventa.client_data);
                    // Store the preventa code so completePreventa is called on sale
                    // We'll use a ref since this is an async callback
                    setActivePreventaCode(preventa.code);
                    return;
                }
            } catch (e) {
                console.error('Error loading preventa:', e);
            }
        }

        // Direct Server-Side Lookup (User Request: "search from server not local")
        try {
            const product = await getProductByBarcode(scannedCode);
            if (product) {
                addToCart(product);
            } else {
                // If not found by exact barcode, try search
                searchProducts(scannedCode);

                // Also set search term to show user what was scanned
                setSearchTerm(scannedCode);
            }
        } catch (error) {
            console.error("Error scanning:", error);
        }
    }, [addToCart, searchProducts, getProductByBarcode, fetchPreventaByCode, clearCart, setPosSelectedClient]);

    useBarcodeScanner(handleBarcodeScan);

    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const scannerRef = useRef(null);
    const scannerContainerId = 'barcode-camera-reader';

    // Camera barcode scanner using html5-qrcode
    useEffectReact(() => {
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
                    async (decodedText) => {
                        // Found a barcode
                        html5QrCode.stop().catch(() => {});
                        scannerRef.current = null;
                        setShowCameraScanner(false);

                        const product = await getProductByBarcode(decodedText);
                        if (product) {
                            addToCart(product);
                        } else {
                            searchProducts(decodedText);
                            setSearchTerm(decodedText);
                        }
                    },
                    () => {} // ignore scan errors (no match yet)
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

    const categoryList = React.useMemo(
        () => [
            'Todos',
            ...storedCategories
                .filter((c) => c.status === 'active' && c.showInPos !== false)
                .map((c) => c.name),
            'Combos',
        ],
        [storedCategories]
    );

    const visibleProducts = products;

    const { finalTotal, taxTotal, subTotal } = React.useMemo(() => {
        let final = 0;
        let tax = 0;
        for (const item of cart) {
            const itemTotal = item.price * item.quantity;
            const discountAmount = itemTotal * ((item.discountPercent || 0) / 100);
            const taxable = itemTotal - discountAmount;
            final += taxable;
            if (item.tax_rate) {
                tax += taxable - taxable / (1 + item.tax_rate / 100);
            }
        }
        return { finalTotal: final, taxTotal: tax, subTotal: final - tax };
    }, [cart]);

    const handleCheckoutClick = () => {
        if (cart.length === 0) return;
        // Si es Factura (33 o 34), abrir modal de datos de facturación primero
        if (siiActive && (posTipoDte === 33 || posTipoDte === 34)) {
            setIsInvoiceModalOpen(true);
            return;
        }
        setIsPaymentModalOpen(true);
    };

    const handleInvoiceConfirm = (invoiceData) => {
        setPendingInvoiceData(invoiceData);
        // Actualizar tipoDte del carrito si cambió en el modal
        if (invoiceData.tipoDte !== posTipoDte) {
            setCartTipoDte(invoiceData.tipoDte);
        }
        setIsInvoiceModalOpen(false);
        setIsPaymentModalOpen(true);
    };

    const handlePaymentConfirm = async (paymentData) => {
        const saleData = {
            items: cart,
            total: finalTotal,
            summary: `${cart.length} productos`,
            paymentMethod: paymentData.method,
            paymentDetails: paymentData,
            client: posSelectedClient,
            tipoDte: pendingInvoiceData?.tipoDte || posTipoDte,
            invoiceData: pendingInvoiceData || null
        };

        // Capturar el código de preventa antes de limpiarlo
        const preventaCode = activePreventaCode;

        // Mostrar overlay breve de "procesando" (no bloquea, dura ~100-300ms típicamente).
        // Solo abrimos el modal de éxito DESPUÉS de que la transacción haya hecho commit
        // (o se haya encolado para reintento offline). Así no se pierde nunca una venta.
        setIsProcessingSale(true);

        try {
            const result = await addSale(saleData);

            if (!result?.success) {
                // Falla real (ej: stock insuficiente, cliente bloqueado, límite de crédito).
                // No se encoló — mostrar error al cajero, mantener el carrito.
                setIsProcessingSale(false);
                alert(`Error al procesar la venta: ${result?.error || 'desconocido'}`);
                return;
            }

            // ✅ Venta confirmada (commit en BD) o encolada (offline failsafe)
            // Incluir el id real de la venta → el ticket imprime T-<id> y ese
            // número es verificable (ej: sorteos). Offline encolado: aún sin id.
            setLastSaleDetails({ ...saleData, id: result.saleId || null, _queued: !!result.queued });
            setIsSuccessModalOpen(true);
            setPosSelectedClient(null);
            setPendingInvoiceData(null);
            if (preventaCode) {
                setActivePreventaCode(null);
                if (!result.queued) {
                    completePreventa(preventaCode, result.saleId);
                }
            }

            if (result.queued) {
                // Aviso suave: la venta se sincronizará apenas vuelva la conexión
                console.warn('🛟 Venta encolada (offline). Se sincronizará automáticamente.');
            }
        } catch (e) {
            console.error('Error inesperado en venta:', e);
            alert(`Error inesperado: ${e?.message || e}`);
        } finally {
            setIsProcessingSale(false);
        }
    };

    const handleNewSale = () => {
        clearCart();
        setIsSuccessModalOpen(false);
        setLastSaleDetails(null);
    };

    // ── Preventas ──

    const handleCreatePreventa = async () => {
        if (cart.length === 0) return;
        const result = await createPreventa(cart, posSelectedClient, finalTotal);
        if (result.success) {
            // Get company info for ticket (prefer preventa-specific config, fallback to receipt config)
            let companyInfo = { name: 'POSKEM', phone: '', address: '', headerMessage: '', footerMessage: '', format: '80mm' };
            try {
                const res = { rows: await reportCall(activeCompanyId, 'companyPreventaInfo', {}) };
                if (res.rows.length > 0) {
                    const r = res.rows[0];
                    companyInfo = {
                        name: r.preventa_business_name || r.receipt_business_name || r.name || 'POSKEM',
                        phone: (r.preventa_show_phone !== 0) ? (r.preventa_phone || r.receipt_phone || '') : '',
                        address: (r.preventa_show_address !== 0) ? (r.preventa_address || r.receipt_address || '') : '',
                        headerMessage: r.preventa_header_message || '',
                        footerMessage: r.preventa_footer_message || '',
                        format: r.preventa_format || '80mm'
                    };
                }
            } catch {}

            setLastPreventaData({
                code: result.code,
                items: [...cart],
                total: finalTotal,
                companyName: companyInfo.name,
                companyPhone: companyInfo.phone,
                companyAddress: companyInfo.address,
                headerMessage: companyInfo.headerMessage,
                footerMessage: companyInfo.footerMessage,
                format: companyInfo.format
            });
            setShowPreventaSuccessModal(true);
            clearCart();
        } else {
            alert('Error al crear preventa: ' + (result.error || 'desconocido'));
        }
    };

    const handleLoadPreventa = (preventa) => {
        clearCart();
        preventa.items.forEach(item => {
            addToCart({
                id: item.id,
                name: item.name,
                price: item.price,
                cost: item.cost || 0,
                quantity: item.quantity,
                tax_rate: item.tax_rate || 0,
                image: item.image || null,
                sku: item.sku || '',
                stock: item.stock || 0
            });
        });
        if (preventa.client_data) {
            setPosSelectedClient(preventa.client_data);
        }
        setActivePreventaCode(preventa.code);
    };

    const handleCategoryChange = async (category) => {
        console.log('🔄 Changing category to:', category);
        setSelectedCategory(category);
        setIsLoadingProducts(true);
        setOffset(0);

        if (category === 'Combos') {
            await fetchCombosForPOS();
            setHasMore(false);
        } else {
            const hasMoreResult = await loadCategoryProducts(category, 0);
            setHasMore(hasMoreResult);
        }

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

    // Carga inicial y al cambiar de empresa. Categoría se maneja en handleCategoryChange.
    React.useEffect(() => {
        if (searchTerm) return;
        if (!activeCompanyId) return;
        let cancelled = false;
        const load = async () => {
            setIsLoadingProducts(true);
            setIsLoadingMore(true);
            setOffset(0);
            const hasMoreResult = await loadCategoryProducts(selectedCategory, 0);
            if (cancelled) return;
            setHasMore(hasMoreResult);
            setIsLoadingMore(false);
            setIsLoadingProducts(false);
        };
        load();
        return () => { cancelled = true; };
    }, [searchTerm, activeCompanyId]);

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
            {/* Candado de caja: SIEMPRE que no haya caja abierta. El permiso solo
                decide si el usuario puede abrirla él mismo o debe pedirla. Antes
                el modal solo se montaba con can('pos.open_register'), así que un
                rol sin ese permiso (p. ej. Vendedor) entraba a vender sin caja. */}
            <CashOpeningModal
                isOpen={!cashRegister && !!currentUser}
                canOpen={can('pos.open_register')}
            />

            {/* Banner offline — visible cuando se cae internet */}
            {!online && (
                <div className="fixed top-0 left-0 right-0 z-[9998] bg-amber-500 text-black text-xs md:text-sm font-semibold px-3 py-1.5 flex items-center justify-center gap-2 shadow-md">
                    <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
                    Modo offline · Las ventas se guardarán localmente y se sincronizarán al volver internet
                </div>
            )}

            {/* Overlay breve de "procesando venta" — bloquea doble click pero dura solo el commit */}
            {isProcessingSale && (
                <div className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
                    <div className="bg-[var(--color-surface)] rounded-2xl px-8 py-6 flex items-center gap-4 border border-[var(--glass-border)] shadow-2xl">
                        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                        <span className="text-[var(--color-text)] font-semibold">Procesando venta…</span>
                    </div>
                </div>
            )}

            {/* Camera Barcode Scanner Modal */}
            {showCameraScanner && (
                <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setShowCameraScanner(false)}>
                    <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
                            <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2">
                                <ScanBarcode size={20} className="text-[var(--color-primary)]" />
                                Escanear Producto
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
            {/* SaleSuccessModal moved to bottom */}

            {/* Left Side: Product Grid */}
            <div className="flex-1 flex flex-col gap-2 lg:gap-4 overflow-hidden min-h-0">
                {/* Tabs: Venta / Encargos (Encargos solo con módulo Pedidos, Medium+) */}
                {canPreorders && (
                <div className="flex shrink-0">
                    <div className="inline-flex p-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                        <button
                            className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 bg-[var(--color-primary)] text-black"
                        >
                            <ShoppingCart size={14} />
                            Venta
                        </button>
                        <button
                            onClick={() => navigate('/preorders')}
                            className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        >
                            <Gift size={14} />
                            Encargos
                        </button>
                        <button
                            onClick={() => navigate('/store-orders')}
                            className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        >
                            <Store size={14} />
                            Tienda
                        </button>
                    </div>
                </div>
                )}

                {/* Search & Categories - Compact on Mobile */}
                <div className="glass-card p-2 lg:p-4 space-y-2 lg:space-y-4 shrink-0 relative z-0">
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
                        <button
                            onClick={() => setShowCameraScanner(true)}
                            className="lg:hidden w-10 h-10 shrink-0 rounded-xl bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 active:scale-95 transition-all"
                            title="Escanear código de barras"
                        >
                            <ScanBarcode size={20} />
                        </button>
                        <CashStatusWidget />
                    </div>

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

                {/* Grid - Responsive columns based on available space */}
                {/* Mobile: min 180px, Tablet: min 200px, Desktop: 4→5→6 columns progressively */}
                <div
                    className="pos-product-grid flex-1 overflow-y-auto pr-2 grid gap-2 lg:gap-4 content-start pb-28 lg:pb-4 custom-scrollbar grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] lg:grid-cols-2"
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
                                {product.is_combo && (
                                    <div className="absolute top-2 left-2 z-20 bg-[var(--color-primary)] text-black text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg">
                                        COMBO
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
                                                        {formatCurrency(product.price, currentCurrency)}
                                                    </span>
                                                    <span className="text-yellow-400 font-extrabold text-base lg:text-xl drop-shadow-sm">
                                                        {formatCurrency(product.offer_price, currentCurrency)}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-green-400 font-bold text-sm lg:text-lg tracking-tight">
                                                    {formatCurrency(product.price, currentCurrency)}
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
                                const rawCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
                                // Productos por kg dejan decimales con ruido de punto flotante
                                // (ej. 6.62 → 6.6199999999999). Para el badge mostramos un
                                // valor limpio: entero si es entero, o 2 decimales máximo.
                                const itemCount = Number.isInteger(rawCount)
                                    ? rawCount
                                    : Number(rawCount.toFixed(2));
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
                                                <span className="text-[var(--color-text-muted)] text-sm">{getCurrencySymbol(currentCurrency)}</span>
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
                                            {item.unit === 'Kg' && (
                                                <ScaleReadButton
                                                    onWeight={(kg) => updateCartItem(item.id, { quantity: kg })}
                                                    className="ml-1"
                                                />
                                            )}

                                            {discountPercent > 0 && (
                                                <span className="text-green-400 font-bold ml-1 text-xs">
                                                    ({formatCurrency(discountedUnitPrice, currentCurrency)})
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
                                                Total: {formatCurrency(finalPrice, currentCurrency)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Row 3: Controls */}
                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--glass-border)]">
                                        {/* Discount Input */}
                                        {can('pos.discount') && (
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
                                        )}

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

                <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-2">
                    {/* DTE Type Selector - always visible */}
                    <div className="mb-1">
                        <select
                            value={posTipoDte}
                            onChange={(e) => setCartTipoDte(Number(e.target.value))}
                            disabled={!siiActive}
                            className="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)] focus:outline-none focus:border-blue-500 appearance-none cursor-pointer disabled:opacity-60"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                        >
                            {!siiActive ? (
                                <option value={0}>📝 Nota de Venta (sin SII)</option>
                            ) : (
                                <>
                                    {enabledDtes.includes(0) && <option value={0}>📝 Nota de Venta (sin SII)</option>}
                                    {enabledDtes.includes(39) && <option value={39}>📄 Boleta Electrónica (39)</option>}
                                    {enabledDtes.includes(33) && <option value={33}>📋 Factura Electrónica (33)</option>}
                                    {enabledDtes.includes(34) && <option value={34}>📋 Factura Exenta (34)</option>}
                                </>
                            )}
                        </select>
                    </div>
                    {/* Total row - clickable to expand/collapse details */}
                    <div
                        className="flex justify-between items-center text-[var(--color-text)] text-2xl font-bold cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setShowTotalsDetail(!showTotalsDetail)}
                    >
                        <div className="flex items-center gap-2">
                            <span>Total</span>
                            {showTotalsDetail ? <ChevronUp size={20} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={20} className="text-[var(--color-text-muted)]" />}
                        </div>
                        <span className="neon-text">{formatCurrency(finalTotal, currentCurrency)}</span>
                    </div>

                    {/* Collapsible details */}
                    {showTotalsDetail && (
                        <div className="space-y-1 pt-2 border-t border-[var(--glass-border)] animate-in slide-in-from-top-2 duration-200">
                            <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                                <span>Subtotal (Neto)</span>
                                <span>{formatCurrency(subTotal, currentCurrency)}</span>
                            </div>
                            <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                                <span>Impuestos Total</span>
                                <span>{formatCurrency(taxTotal, currentCurrency)}</span>
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2">
                        {/* Botón Preventa: carrito lleno = crear, carrito vacío = recuperar */}
                        {can('pos.preventa') && (
                            <button
                                onClick={() => {
                                    if (cart.length > 0) {
                                        handleCreatePreventa();
                                    } else {
                                        setShowPreventasListModal(true);
                                    }
                                }}
                                disabled={cart.length === 0 && pendingPreventasCount === 0}
                                className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-1 transition-all text-sm relative ${cart.length > 0
                                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                    : pendingPreventasCount > 0
                                        ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                            >
                                {cart.length > 0 ? (
                                    <>
                                        <Package size={16} />
                                        Preventa
                                    </>
                                ) : (
                                    <>
                                        <Package size={16} />
                                        Recuperar {pendingPreventasCount > 0 ? `(${pendingPreventasCount})` : ''}
                                    </>
                                )}
                            </button>
                        )}

                        {can('pos.sell') && (
                            <button disabled={cart.length === 0} onClick={handleCheckoutClick} className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 rounded-xl">

                                <Banknote size={18} />
                                Cobrar
                            </button>
                        )}

                        {/* Botón Suspender/Recuperar */}
                        {(cart.length > 0 ? can('pos.suspend_sale') : can('pos.recover_sale')) && (
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
                                className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-1 transition-all text-sm ${cart.length > 0
                                    ? 'bg-orange-500 hover:bg-orange-600 text-white'
                                    : suspendedSalesCount > 0
                                        ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                    }`}
                            >
                                {cart.length > 0 ? (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                        </svg>
                                        Suspender
                                    </>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 3l3 9-3 9 19-9z"></path>
                                        </svg>
                                        Recuperar {suspendedSalesCount > 0 ? `(${suspendedSalesCount})` : ''}
                                    </>
                                )}
                            </button>
                        )}
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
                                <span className="text-sm">{(() => { const c = cart.reduce((s, i) => s + i.quantity, 0); return Number.isInteger(c) ? c : Number(c.toFixed(2)); })()} Items</span>
                                <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-bold ml-auto">
                                    {formatCurrency(finalTotal, currentCurrency)}
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
                                            {(() => { const c = cart.reduce((s, i) => s + i.quantity, 0); return Number.isInteger(c) ? c : Number(c.toFixed(2)); })()} items
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
                                                        {formatCurrency(finalPrice, currentCurrency)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Footer with Total and Checkout */}
                            <div className="p-4 border-t border-white/10 bg-[#14141f] space-y-3 pb-8">
                                {/* DTE Type Selector - Mobile - always visible */}
                                <div>
                                    <select
                                        value={posTipoDte}
                                        onChange={(e) => setCartTipoDte(Number(e.target.value))}
                                        disabled={!siiActive}
                                        className="w-full py-2 px-3 rounded-lg text-sm font-bold bg-white/5 text-white border border-white/10 focus:outline-none focus:border-blue-500 appearance-none cursor-pointer disabled:opacity-60"
                                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                                    >
                                        {!siiActive ? (
                                            <option value={0}>📝 Nota de Venta (sin SII)</option>
                                        ) : (
                                            <>
                                                {enabledDtes.includes(0) && <option value={0}>📝 Nota de Venta (sin SII)</option>}
                                                {enabledDtes.includes(39) && <option value={39}>📄 Boleta Electrónica (39)</option>}
                                                {enabledDtes.includes(33) && <option value={33}>📋 Factura Electrónica (33)</option>}
                                                {enabledDtes.includes(34) && <option value={34}>📋 Factura Exenta (34)</option>}
                                            </>
                                        )}
                                    </select>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-400">Total a Pagar</span>
                                    <span className="text-2xl font-black text-green-400">
                                        {formatCurrency(finalTotal, currentCurrency)}
                                    </span>
                                </div>
                                {can('pos.preventa') && (
                                    <button
                                        onClick={() => {
                                            setIsMobileCartOpen(false);
                                            if (cart.length > 0) {
                                                handleCreatePreventa();
                                            } else {
                                                setShowPreventasListModal(true);
                                            }
                                        }}
                                        disabled={cart.length === 0 && pendingPreventasCount === 0}
                                        className={`w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 ${cart.length > 0
                                            ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                            : pendingPreventasCount > 0
                                                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                        }`}
                                    >
                                        <Package size={24} />
                                        {cart.length > 0 ? 'Preventa' : `Recuperar ${pendingPreventasCount > 0 ? `(${pendingPreventasCount})` : ''}`}
                                    </button>
                                )}
                                {can('pos.sell') && (
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
                                )}
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

            <PreventasListModal
                isOpen={showPreventasListModal}
                onClose={() => setShowPreventasListModal(false)}
                onLoadPreventa={handleLoadPreventa}
            />

            <PreventaSuccessModal
                isOpen={showPreventaSuccessModal}
                onClose={() => { setShowPreventaSuccessModal(false); setLastPreventaData(null); }}
                preventaData={lastPreventaData}
            />

            <InvoiceDataModal
                isOpen={isInvoiceModalOpen}
                onClose={() => setIsInvoiceModalOpen(false)}
                onConfirm={handleInvoiceConfirm}
                initialTipoDte={posTipoDte}
            />

            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                total={finalTotal}
                onConfirm={handlePaymentConfirm}
            />

            <SaleSuccessModal
                isOpen={isSuccessModalOpen}
                onClose={() => setIsSuccessModalOpen(false)}
                saleDetails={lastSaleDetails}
                onNewSale={handleNewSale}
                seller={currentUser}
            />
        </div>
    );
};

export default POS;
