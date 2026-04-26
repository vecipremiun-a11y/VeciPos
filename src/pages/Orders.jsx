import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Search, Package, Truck, Box, AlertTriangle, TrendingDown, DollarSign, Barcode, Tag, Info, ChevronDown, Trash2, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import { turso } from '../lib/turso';

const Orders = () => {
    const {
        products,
        suppliers,
        categories,
        activeCompanyId,
        addProduct,
        updateProduct,
        deleteProduct,
        createSupplierOrder,
        currentCurrency
    } = useStore();
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedSupplierId, setSelectedSupplierId] = useState('');
    const [filterLowStock, setFilterLowStock] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [supplierProducts, setSupplierProducts] = useState([]);
    const [productStats, setProductStats] = useState(null);
    const [loadingStats, setLoadingStats] = useState(false);
    const supplierCacheRef = useRef({});
    const searchTimerRef = useRef(null);

    // Order form states
    const [orderCost, setOrderCost] = useState('');
    const [orderCostGross, setOrderCostGross] = useState('');
    const [orderQuantity, setOrderQuantity] = useState('');

    // Order cart states
    const [orderItems, setOrderItems] = useState([]);
    const [showOrderModal, setShowOrderModal] = useState(false);
    const [orderItemQuantityDrafts, setOrderItemQuantityDrafts] = useState({});

    // Add product to order cart
    const addToOrder = () => {
        if (!selectedProduct || !orderCost || !orderQuantity || Number(orderQuantity) <= 0) return false;

        const costWithTax = orderCostGross ? Number(orderCostGross) : Number(orderCost) * (1 + (selectedProduct.tax_rate || 0) / 100);
        const newItem = {
            id: selectedProduct.id,
            name: selectedProduct.name,
            sku: selectedProduct.sku,
            cost: Number(orderCost),
            costWithTax,
            quantity: Number(orderQuantity),
            taxRate: selectedProduct.tax_rate || 0,
            total: costWithTax * Number(orderQuantity)
        };

        // Check if product already in cart
        const existingIndex = orderItems.findIndex(item => item.id === selectedProduct.id);
        if (existingIndex >= 0) {
            // Update existing
            const updated = [...orderItems];
            updated[existingIndex] = {
                ...updated[existingIndex],
                cost: newItem.cost,
                costWithTax: newItem.costWithTax,
                quantity: updated[existingIndex].quantity + newItem.quantity,
                total: newItem.costWithTax * (updated[existingIndex].quantity + newItem.quantity)
            };
            setOrderItems(updated);
        } else {
            setOrderItems([...orderItems, newItem]);
        }

        // Reset form
        setOrderQuantity('1');
        return true;
    };

    // Independent state for the supplier shown in the invoice modal
    const [invoiceSupplierId, setInvoiceSupplierId] = useState(null);
    const [arrivalDate, setArrivalDate] = useState('');

    // Sync invoice supplier with selected supplier when modal opens
    useEffect(() => {
        if (showOrderModal) {
            setInvoiceSupplierId(selectedSupplierId ? Number(selectedSupplierId) : '');
            setArrivalDate(''); // Reset date
        }
    }, [showOrderModal, selectedSupplierId]);

    // Derived supplier for the invoice modal
    const invoiceSupplier = suppliers.find(s => s.id === Number(invoiceSupplierId));


    // Remove item from order
    const removeFromOrder = (productId) => {
        setOrderItems(orderItems.filter(item => item.id !== productId));
    };

    const updateOrderItemQuantity = (productId, quantityValue) => {
        if (quantityValue === '') {
            setOrderItemQuantityDrafts(prev => ({ ...prev, [productId]: '' }));
            return;
        }

        if (!/^\d+$/.test(quantityValue)) return;

        setOrderItemQuantityDrafts(prev => ({ ...prev, [productId]: quantityValue }));

        const parsedQuantity = Number(quantityValue);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) return;

        const safeQuantity = Math.floor(parsedQuantity);
        setOrderItems(prevItems => prevItems.map(item =>
            item.id === productId
                ? {
                    ...item,
                    quantity: safeQuantity,
                    total: item.costWithTax * safeQuantity
                }
                : item
        ));
    };

    const commitOrderItemQuantity = (productId) => {
        const draftValue = orderItemQuantityDrafts[productId];
        if (draftValue === undefined) return;

        if (draftValue === '' || Number(draftValue) < 1) {
            setOrderItemQuantityDrafts(prev => {
                const { [productId]: _, ...rest } = prev;
                return rest;
            });
            return;
        }

        const safeQuantity = Math.floor(Number(draftValue));
        setOrderItems(prevItems => prevItems.map(item =>
            item.id === productId
                ? {
                    ...item,
                    quantity: safeQuantity,
                    total: item.costWithTax * safeQuantity
                }
                : item
        ));

        setOrderItemQuantityDrafts(prev => {
            const { [productId]: _, ...rest } = prev;
            return rest;
        });
    };

    const handleConfirmOrder = async () => {
        if (!invoiceSupplier || orderItems.length === 0) return;

        const orderData = {
            supplier_id: invoiceSupplier.id,
            supplier_name: invoiceSupplier.name,
            seller_name: invoiceSupplier.seller_name,
            total_amount: orderTotal,
            items: orderItems,
            expected_delivery_date: arrivalDate
        };

        const result = await createSupplierOrder(orderData);
        if (result.success) {
            // Success feedback could be improved (toast)
            alert('Pedido creado exitosamente');
            setOrderItems([]);
            setShowOrderModal(false);
        } else {
            alert('Error al crear pedido: ' + result.error);
        }
    };

    // Calculate order total
    const orderTotal = orderItems.reduce((sum, item) => sum + item.total, 0);

    // Load product sales statistics
    const loadProductStats = async (product) => {
        if (!product) {
            setProductStats(null);
            return;
        }

        setLoadingStats(true);
        try {
            // Use pre-calculated tables for fast stats (same as ProductProfile)
            const today = new Date().toISOString().split('T')[0];
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

            const [profitResult, statsResult, purchaseResult] = await Promise.all([
                turso.execute({
                    sql: `SELECT COALESCE(SUM(total_quantity), 0) as total_sold,
                                 COUNT(DISTINCT day) as days_with_sales
                          FROM product_daily_profit
                          WHERE company_id = ? AND product_id = ? AND day >= ? AND day <= ?`,
                    args: [activeCompanyId, product.id, thirtyDaysAgoStr, today]
                }),
                turso.execute({
                    sql: `SELECT last_sale_date FROM product_movement_stats
                          WHERE company_id = ? AND product_id = ?`,
                    args: [activeCompanyId, product.id]
                }),
                // Get last two purchases to compare costs
                turso.execute({
                    sql: `SELECT 
                        json_extract(item.value, '$.cost') as item_cost,
                        json_extract(item.value, '$.supplier_code') as supplier_code,
                        p.date
                    FROM purchases p, json_each(p.items) as item
                    WHERE p.company_id = ? 
                        AND CAST(json_extract(item.value, '$.id') AS INTEGER) = ?
                    ORDER BY p.date DESC
                    LIMIT 2`,
                    args: [activeCompanyId, product.id]
                })
            ]);

            const totalSold30d = parseFloat(profitResult.rows[0]?.total_sold) || 0;

            // Calculate averages
            const avgDailySales = totalSold30d / 30;
            const avgWeeklySales = avgDailySales * 7;
            const daysOfStock = avgDailySales > 0 ? Math.round(product.stock / avgDailySales) : 999;

            // Determine velocity (slow/normal/fast)
            let velocity = 'normal';
            if (avgDailySales < 0.5) velocity = 'lento';
            else if (avgDailySales > 3) velocity = 'rápido';

            // Purchase data
            const lastPurchase = purchaseResult.rows[0];
            const previousPurchase = purchaseResult.rows[1];
            const lastPurchaseCost = lastPurchase ? Number(lastPurchase.item_cost) : null;
            const previousCost = previousPurchase ? Number(previousPurchase.item_cost) : null;
            const supplierCode = lastPurchase?.supplier_code || null;

            // Calculate price variation
            let priceVariation = null;
            if (lastPurchaseCost && previousCost && previousCost > 0) {
                const diff = lastPurchaseCost - previousCost;
                const percentChange = ((diff / previousCost) * 100).toFixed(1);
                priceVariation = {
                    diff,
                    percent: percentChange,
                    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same'
                };
            }

            setProductStats({
                avgDailySales: avgDailySales.toFixed(1),
                avgWeeklySales: avgWeeklySales.toFixed(1),
                daysOfStock,
                lastSaleDate: statsResult.rows[0]?.last_sale_date || 'Sin ventas',
                velocity,
                // Purchase data
                lastPurchaseCost,
                supplierCode,
                priceVariation
            });
        } catch (e) {
            console.error("Error loading product stats:", e);
            setProductStats(null);
        } finally {
            setLoadingStats(false);
        }
    };

    // Handle product selection
    const handleProductSelect = (product) => {
        setSelectedProduct(product);
        const cost = product.cost?.toString() || '';
        setOrderCost(cost);

        // Calculate initial gross cost
        if (cost) {
            const taxRate = product.tax_rate || 0;
            const gross = Number(cost) * (1 + taxRate / 100);
            setOrderCostGross(gross.toFixed(1)); // Initial value can be formatted
        } else {
            setOrderCostGross('');
        }

        setOrderQuantity('1');
        loadProductStats(product);
    };

    // Debounce search
    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 300);
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, [searchTerm]);

    // Search products in Turso (with supplier filter if selected)
    useEffect(() => {
        if (!activeCompanyId) return;
        if (!debouncedSearch && !selectedSupplierId) {
            setSupplierProducts([]);
            return;
        }

        const cacheKey = `${selectedSupplierId || 'all'}:${debouncedSearch || ''}:${filterLowStock}`;
        if (supplierCacheRef.current[cacheKey]) {
            setSupplierProducts(supplierCacheRef.current[cacheKey]);
            return;
        }

        let cancelled = false;
        const search = async () => {
            setIsLoading(true);
            try {
                const conditions = ['company_id = ?'];
                const args = [activeCompanyId];

                if (selectedSupplierId) {
                    const sup = suppliers.find(s => s.id === Number(selectedSupplierId));
                    if (sup) {
                        conditions.push('supplier = ?');
                        args.push(sup.name);
                    }
                }
                if (debouncedSearch) {
                    conditions.push("(LOWER(COALESCE(name,'')) LIKE ? OR LOWER(COALESCE(sku,'')) LIKE ?)");
                    const like = `%${debouncedSearch.toLowerCase()}%`;
                    args.push(like, like);
                }
                if (filterLowStock) {
                    conditions.push('stock <= 5');
                }

                const result = await turso.execute({
                    sql: `SELECT id, name, sku, price, cost, stock, tax_rate, unit, image, category, supplier, price_ranges
                          FROM products WHERE ${conditions.join(' AND ')} ORDER BY stock ASC LIMIT 100`,
                    args
                });
                if (!cancelled) {
                    const rows = result.rows || [];
                    supplierCacheRef.current[cacheKey] = rows;
                    setSupplierProducts(rows);
                }
            } catch (e) {
                console.error('Error searching products:', e);
                if (!cancelled) setSupplierProducts([]);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        search();
        return () => { cancelled = true; };
    }, [debouncedSearch, selectedSupplierId, filterLowStock, activeCompanyId]);

    // Handle supplier selection (filter, not load)
    const handleSupplierChange = (supplierId) => {
        setSelectedSupplierId(supplierId);
        setSelectedProduct(null);
    };

    // Count totals
    const totalProducts = supplierProducts.length;
    const totalSuppliers = suppliers.length;
    const lowStockCount = supplierProducts.filter(p => p.stock <= 5).length;

    // Get selected supplier info
    const selectedSupplier = suppliers.find(s => s.id === Number(selectedSupplierId));

    const getCategoryName = (categoryId) => {
        const category = categories.find(c => c.id === categoryId);
        return category?.name || 'Sin categoría';
    };

    const getSupplierName = (supplierId) => {
        const supplier = suppliers.find(s => s.id === supplierId);
        return supplier?.name || 'Sin proveedor';
    };



    return (
        <div className="h-full flex flex-col gap-1 lg:gap-4 pt-0 px-3 pb-2 lg:p-0">
            {/* Header */}
            <div className="shrink-0">
                <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)]">Pedidos a Proveedores</h1>
                <p className="text-[var(--color-text-muted)] text-xs lg:text-sm hidden lg:block">Selecciona un proveedor para ver sus productos.</p>
            </div>

            {/* Stats Cards */}
            {/* Stats Cards */}
            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-1 lg:gap-3 shrink-0 items-start">
                <div className="glass-card py-0.5 px-1 lg:p-4 flex flex-col lg:flex-row items-center lg:items-center justify-center lg:justify-start gap-0.5 lg:gap-3 text-center lg:text-left min-h-0">
                    <div className="p-1 rounded-md lg:rounded-xl bg-[var(--color-primary)]/20 flex items-center justify-center">
                        <Truck size={18} className="text-[var(--color-primary)] lg:hidden" />
                        <Truck size={20} className="text-[var(--color-primary)] hidden lg:block" />
                    </div>
                    <div className="leading-none lg:leading-normal">
                        <p className="text-xl lg:text-2xl font-bold text-[var(--color-text)] leading-none lg:leading-normal">{totalSuppliers}</p>
                        <p className="text-[9px] lg:text-xs text-[var(--color-text-muted)] uppercase lg:normal-case tracking-tight lg:tracking-normal leading-none">Proveedores</p>
                    </div>
                </div>
                <div className="glass-card py-0.5 px-1 lg:p-4 flex flex-col lg:flex-row items-center lg:items-center justify-center lg:justify-start gap-0.5 lg:gap-3 text-center lg:text-left min-h-0">
                    <div className="p-1 rounded-md lg:rounded-xl bg-blue-500/20 flex items-center justify-center">
                        <Box size={18} className="text-blue-400 lg:hidden" />
                        <Box size={20} className="text-blue-400 hidden lg:block" />
                    </div>
                    <div className="leading-none lg:leading-normal">
                        <p className="text-xl lg:text-2xl font-bold text-[var(--color-text)] leading-none lg:leading-normal">{totalProducts}</p>
                        <p className="text-[9px] lg:text-xs text-[var(--color-text-muted)] uppercase lg:normal-case tracking-tight lg:tracking-normal leading-none">Productos</p>
                    </div>
                </div>
                <div
                    className={cn(
                        "glass-card py-0.5 px-1 lg:p-4 flex flex-col lg:flex-row items-center lg:items-center justify-center lg:justify-start gap-0.5 lg:gap-3 text-center lg:text-left cursor-pointer transition-all min-h-0",
                        filterLowStock && "ring-2 ring-red-500/50 bg-red-500/10"
                    )}
                    onClick={() => setFilterLowStock(!filterLowStock)}
                >
                    <div className="p-1 rounded-md lg:rounded-xl bg-red-500/20 flex items-center justify-center">
                        <AlertTriangle size={18} className="text-red-400 lg:hidden" />
                        <AlertTriangle size={20} className="text-red-400 hidden lg:block" />
                    </div>
                    <div className="leading-none lg:leading-normal">
                        <p className="text-xl lg:text-2xl font-bold text-red-400 leading-none lg:leading-normal">{lowStockCount}</p>
                        <p className="text-[9px] lg:text-xs text-[var(--color-text-muted)] uppercase lg:normal-case tracking-tight lg:tracking-normal leading-none">Stock Bajo</p>
                    </div>
                </div>
            </div>

            {/* Main Content - Split View */}
            <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
                {/* Left: Supplier Selection + Products List */}
                <div className={cn(
                    "w-full lg:w-1/3 glass rounded-xl flex flex-col overflow-hidden border border-[var(--glass-border)]",
                    selectedProduct ? "hidden lg:flex" : "flex"
                )}>
                    {/* Supplier Selector */}
                    <div className="p-3 lg:p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-3">
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] uppercase font-bold">
                            <Truck size={14} className="text-[var(--color-primary)]" />
                            Seleccionar Proveedor
                        </div>
                        <div className="relative">
                            <select
                                value={selectedSupplierId}
                                onChange={(e) => handleSupplierChange(e.target.value)}
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl px-4 py-3 text-[var(--color-text)] text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                            >
                                <option value="">-- Seleccione un proveedor --</option>
                                {suppliers.map(supplier => (
                                    <option key={supplier.id} value={supplier.id} className="bg-[var(--color-surface)]">
                                        {supplier.name}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                        </div>

                        {/* Search products (always visible) */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                            <input
                                type="text"
                                placeholder="Buscar productos por nombre o SKU..."
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg pl-9 pr-3 py-2 text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Products List Header */}
                    <div className="p-2 lg:p-3 border-b border-[var(--glass-border)] bg-black/20 font-semibold text-[var(--color-text-muted)] text-xs lg:text-sm flex justify-between items-center">
                        <span>Productos {selectedSupplier ? `de ${selectedSupplier.name}` : ''}</span>
                        <span className="text-[var(--color-primary)]">{supplierProducts.length} productos</span>
                    </div>

                    {/* Products List */}
                    <div className="flex-1 overflow-y-auto pb-20 lg:pb-0">
                        {isLoading ? (
                            <div className="p-8 text-center text-[var(--color-text-muted)]">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)] mx-auto mb-3"></div>
                                <p className="text-sm">Buscando productos...</p>
                            </div>
                        ) : !debouncedSearch && !selectedSupplierId ? (
                            <div className="p-8 text-center text-[var(--color-text-muted)]">
                                <Search size={48} className="mx-auto mb-3 opacity-20" />
                                <p className="text-sm">Escriba para buscar productos o seleccione un proveedor</p>
                            </div>
                        ) : supplierProducts.length === 0 ? (
                            <div className="p-8 text-center text-[var(--color-text-muted)]">
                                <Package size={48} className="mx-auto mb-3 opacity-20" />
                                <p className="text-sm">No se encontraron productos</p>
                            </div>
                        ) : (
                            <>
                            {supplierProducts.map(product => {
                                const isLowStock = product.stock <= (product.min_stock || 5);
                                const isSelected = selectedProduct?.id === product.id;

                                return (
                                    <div
                                        key={product.id}
                                        onClick={() => handleProductSelect(product)}
                                        className={cn(
                                            "p-3 lg:p-4 border-b border-[var(--glass-border)]/50 cursor-pointer transition-colors hover:bg-[var(--glass-bg)]",
                                            isSelected && "bg-[var(--color-primary)]/10 border-l-4 border-l-[var(--color-primary)]"
                                        )}
                                    >
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/20 shrink-0 flex items-center justify-center">
                                                {product.image ? (
                                                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <Package size={18} className="text-[var(--color-text-muted)] opacity-40" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-[var(--color-text)] text-sm truncate">{product.name}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">{product.sku || 'Sin SKU'}</p>
                                                {product.barcode && (
                                                    <p className="text-[10px] text-[var(--color-text-muted)] font-mono">{product.barcode}</p>
                                                )}
                                            </div>
                                            <div className="text-right shrink-0 ml-2">
                                                <p className={cn(
                                                    "font-bold text-sm",
                                                    isLowStock ? "text-red-400" : "text-green-400"
                                                )}>
                                                    {product.stock || 0}
                                                </p>
                                                <p className="text-[10px] text-[var(--color-text-muted)]">stock</p>
                                                {isLowStock && (
                                                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[8px] font-bold">
                                                        BAJO
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            </>
                        )}
                    </div>

                    {/* Order Cart Button */}
                    <div className="p-3 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                        <button
                            onClick={() => setShowOrderModal(true)}
                            className="w-full py-3 px-4 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-bold rounded-lg transition-all hover:opacity-90 flex items-center justify-center gap-3 shadow-lg shadow-[var(--color-primary)]/20"
                        >
                            <Box size={20} />
                            <span>Ver Factura</span>
                            {orderItems.length > 0 && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">
                                    {orderItems.length} items • {formatCurrency(orderTotal, currentCurrency)}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Right: Product Details */}
                <div className={cn(
                    "glass rounded-xl flex-col overflow-hidden border border-[var(--glass-border)] relative",
                    selectedProduct ? "flex w-full lg:w-2/3" : "hidden lg:flex w-full lg:w-2/3"
                )}>
                    {selectedProduct && (
                        <div className="lg:hidden p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] sticky top-0 z-10 flex items-center gap-2">
                            <button
                                onClick={() => setSelectedProduct(null)}
                                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-[var(--color-text)]"
                            >
                                <ArrowLeft size={20} />
                            </button>
                            <span className="font-bold text-[var(--color-text)]">Detalle del Producto</span>
                        </div>
                    )}
                    {selectedProduct ? (
                        <>
                            {/* Product Header */}
                            <div className="p-6 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">
                                            {selectedProduct.name}
                                        </h2>
                                        <div className="flex gap-4 text-sm text-[var(--color-text-muted)]">
                                            <span className="flex items-center gap-1">
                                                <Barcode size={14} />
                                                {selectedProduct.sku || 'Sin SKU'}
                                            </span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1">
                                                <Tag size={14} />
                                                {getCategoryName(selectedProduct.category_id)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={cn(
                                            "text-3xl font-bold",
                                            selectedProduct.stock <= (selectedProduct.min_stock || 5) ? "text-red-400" : "text-green-400"
                                        )}>
                                            {selectedProduct.stock || 0}
                                        </div>
                                        <div className="text-xs text-[var(--color-text-muted)]">unidades en stock</div>
                                    </div>
                                </div>
                            </div>

                            {/* Product Details Grid */}
                            <div className="flex-1 overflow-y-auto p-6">
                                {/* NEW: Image and Sales Stats Row */}
                                <div className="grid grid-cols-2 gap-6 mb-6">
                                    {/* Product Image */}
                                    <div className="glass-card p-5 flex items-center justify-center">
                                        {selectedProduct.image ? (
                                            <img
                                                src={selectedProduct.image}
                                                alt={selectedProduct.name}
                                                className="max-h-48 max-w-full object-contain rounded-lg"
                                            />
                                        ) : (
                                            <div className="h-48 w-full flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                                                <Package size={64} className="opacity-30 mb-2" />
                                                <span className="text-sm">Sin imagen</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Sales Statistics */}
                                    <div className="glass-card p-5">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-3 flex items-center gap-2">
                                            <TrendingDown size={14} className="text-blue-400" />
                                            Estadísticas de Ventas
                                        </p>
                                        {loadingStats ? (
                                            <div className="flex items-center justify-center h-32">
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-primary)]"></div>
                                            </div>
                                        ) : productStats ? (
                                            <div className="space-y-2">
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Venta promedio diaria</span>
                                                    <span className="font-bold text-[var(--color-text)]">{productStats.avgDailySales} uds</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Venta promedio semanal</span>
                                                    <span className="font-bold text-[var(--color-text)]">{productStats.avgWeeklySales} uds</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Días que dura el stock</span>
                                                    <span className={cn(
                                                        "font-bold",
                                                        productStats.daysOfStock <= 7 ? "text-red-400" :
                                                            productStats.daysOfStock <= 14 ? "text-yellow-400" : "text-green-400"
                                                    )}>
                                                        {productStats.daysOfStock > 365 ? '+365' : productStats.daysOfStock} días
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Última venta</span>
                                                    <span className="font-bold text-[var(--color-text)]">{productStats.lastSaleDate}</span>
                                                </div>
                                                <div className="pt-2 border-t border-[var(--glass-border)] flex justify-between items-center">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Velocidad</span>
                                                    <span className={cn(
                                                        "px-3 py-1 rounded-full text-xs font-bold uppercase",
                                                        productStats.velocity === 'lento' ? "bg-red-500/20 text-red-400" :
                                                            productStats.velocity === 'rápido' ? "bg-green-500/20 text-green-400" :
                                                                "bg-yellow-500/20 text-yellow-400"
                                                    )}>
                                                        {productStats.velocity}
                                                    </span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center h-32 text-[var(--color-text-muted)]">
                                                <span className="text-sm">Sin datos de ventas</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Existing Grid */}
                                <div className="grid grid-cols-2 gap-6">
                                    {/* Supplier Info */}
                                    <div className="glass-card p-5">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-3 flex items-center gap-2">
                                            <Truck size={14} className="text-[var(--color-primary)]" />
                                            Proveedor
                                        </p>
                                        <p className="text-lg font-bold text-[var(--color-text)]">
                                            {selectedProduct.supplier || 'Sin proveedor'}
                                        </p>

                                        {/* Supplier code if different from SKU */}
                                        {productStats?.supplierCode && productStats.supplierCode !== selectedProduct.sku && (
                                            <div className="flex justify-between text-sm mt-2">
                                                <span className="text-[var(--color-text-muted)]">Código proveedor</span>
                                                <span className="font-mono text-[var(--color-text)]">{productStats.supplierCode}</span>
                                            </div>
                                        )}

                                        {/* Last purchase cost */}
                                        {productStats?.lastPurchaseCost && (
                                            <div className="border-t border-[var(--glass-border)] mt-3 pt-3 space-y-2">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-[var(--color-text-muted)]">Costo última compra</span>
                                                    <span className="font-bold text-[var(--color-text)]">{formatCurrency(productStats.lastPurchaseCost, currentCurrency)}</span>
                                                </div>

                                                {/* Price variation */}
                                                {productStats.priceVariation && (
                                                    <div className="flex justify-between items-center text-sm">
                                                        <span className="text-[var(--color-text-muted)]">Variación precio</span>
                                                        <span className={cn(
                                                            "font-bold flex items-center gap-1",
                                                            productStats.priceVariation.direction === 'up' ? "text-red-400" :
                                                                productStats.priceVariation.direction === 'down' ? "text-green-400" :
                                                                    "text-[var(--color-text-muted)]"
                                                        )}>
                                                            {productStats.priceVariation.direction === 'up' && '↑'}
                                                            {productStats.priceVariation.direction === 'down' && '↓'}
                                                            {productStats.priceVariation.direction === 'same' && '→'}
                                                            {productStats.priceVariation.percent}%
                                                            <span className="text-xs text-[var(--color-text-muted)]">
                                                                ({formatCurrency(Math.abs(productStats.priceVariation.diff), currentCurrency)})
                                                            </span>
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Stock Info */}
                                    <div className="glass-card p-5">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-3 flex items-center gap-2">
                                            <TrendingDown size={14} className="text-red-400" />
                                            Nivel de Stock
                                        </p>
                                        <div className="flex items-end gap-4 mb-3">
                                            <div>
                                                <p className="text-sm text-[var(--color-text-muted)]">Actual</p>
                                                <p className={cn(
                                                    "text-2xl font-bold",
                                                    selectedProduct.stock <= (selectedProduct.min_stock || 5) ? "text-red-400" : "text-[var(--color-text)]"
                                                )}>
                                                    {selectedProduct.stock || 0}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-[var(--color-text-muted)]">Mínimo</p>
                                                <p className="text-2xl font-bold text-[var(--color-text-muted)]">
                                                    {selectedProduct.min_stock || 5}
                                                </p>
                                            </div>
                                        </div>

                                        {selectedProduct.stock <= (selectedProduct.min_stock || 5) && (
                                            <div className="mt-3 p-2 bg-red-500/10 rounded-lg border border-red-500/20 flex items-center gap-2">
                                                <AlertTriangle size={14} className="text-red-400" />
                                                <span className="text-xs text-red-400 font-bold">Stock bajo - Requiere pedido</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Pricing */}
                                    <div className="glass-card p-5">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-3 flex items-center gap-2">
                                            <DollarSign size={14} className="text-green-400" />
                                            Precios
                                        </p>
                                        <div className="space-y-3">
                                            {/* Costo */}
                                            <div className="flex justify-between">
                                                <span className="text-sm text-[var(--color-text-muted)]">Costo</span>
                                                <span className="font-bold text-[var(--color-text)]">{formatCurrency(selectedProduct.cost, currentCurrency)}</span>
                                            </div>

                                            {/* Costo con IVA - solo si tiene impuesto */}
                                            {selectedProduct.tax_rate > 0 && (
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Costo + IVA ({selectedProduct.tax_rate}%)</span>
                                                    <span className="font-bold text-[var(--color-text)]">
                                                        {formatCurrency(selectedProduct.cost * (1 + selectedProduct.tax_rate / 100), currentCurrency)}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Precio Venta */}
                                            <div className="flex justify-between">
                                                <span className="text-sm text-[var(--color-text-muted)]">Precio Venta</span>
                                                <span className="font-bold text-green-400">{formatCurrency(selectedProduct.price, currentCurrency)}</span>
                                            </div>

                                            <div className="border-t border-[var(--glass-border)] pt-3 space-y-2">
                                                {/* Margen de Utilidad (Neto) */}
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Margen de Utilidad</span>
                                                    <span className="font-bold text-[var(--color-primary)]">
                                                        {(() => {
                                                            if (!selectedProduct.cost || selectedProduct.cost <= 0) return 'N/A';
                                                            const taxRate = selectedProduct.tax_rate || 0;
                                                            const netPrice = selectedProduct.price / (1 + taxRate / 100);
                                                            const netCost = selectedProduct.cost;
                                                            const utility = netPrice - netCost;
                                                            const margin = (utility / netCost) * 100;
                                                            return `${margin.toFixed(1)}%`;
                                                        })()}
                                                    </span>
                                                </div>

                                                {/* Monto de Utilidad (Neto) */}
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Utilidad por Unidad</span>
                                                    <span className="font-bold text-green-400">
                                                        {(() => {
                                                            const taxRate = selectedProduct.tax_rate || 0;
                                                            const netPrice = selectedProduct.price / (1 + taxRate / 100);
                                                            const netCost = selectedProduct.cost || 0;
                                                            return formatCurrency(netPrice - netCost, currentCurrency);
                                                        })()}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Additional Info */}
                                    <div className="glass-card p-5">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-3 flex items-center gap-2">
                                            <Info size={14} className="text-blue-400" />
                                            Información Adicional
                                        </p>
                                        <div className="space-y-2">
                                            {selectedProduct.barcode && (
                                                <div className="flex justify-between">
                                                    <span className="text-sm text-[var(--color-text-muted)]">Código de Barras</span>
                                                    <span className="font-mono text-sm text-[var(--color-text)]">{selectedProduct.barcode}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between">
                                                <span className="text-sm text-[var(--color-text-muted)]">Categoría</span>
                                                <span className="text-sm text-[var(--color-text)]">{getCategoryName(selectedProduct.category_id)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-sm text-[var(--color-text-muted)]">Valor en Inventario</span>
                                                <span className="font-bold text-[var(--color-text)]">
                                                    {formatCurrency((selectedProduct.cost || 0) * (selectedProduct.stock || 0), currentCurrency)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Order Form Section */}
                                <div className="mt-6 glass-card p-5 border-2 border-[var(--color-primary)]/30">
                                    <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-4 flex items-center gap-2">
                                        <Box size={14} className="text-[var(--color-primary)]" />
                                        Realizar Pedido
                                    </p>

                                    <div className="grid grid-cols-4 gap-4 mb-4">
                                        {/* Costo */}
                                        <div>
                                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Costo Unitario</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
                                                <input
                                                    type="number"
                                                    value={orderCost}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setOrderCost(val);

                                                        // Update Gross based on Net
                                                        if (val === '') {
                                                            setOrderCostGross('');
                                                            return;
                                                        }
                                                        const numVal = parseFloat(val);
                                                        if (!isNaN(numVal)) {
                                                            const taxRate = selectedProduct.tax_rate || 0;
                                                            const newGross = numVal * (1 + taxRate / 100);
                                                            // Keep full precision or 1 decimal for better UX
                                                            setOrderCostGross(Number.isInteger(newGross) ? newGross.toString() : newGross.toFixed(1));
                                                        }
                                                    }}
                                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 pl-7 text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>

                                        {/* Costo con IVA */}
                                        <div>
                                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                                                Costo + IVA ({selectedProduct.tax_rate || 0}%)
                                            </label>
                                            <input
                                                type="number"
                                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                                                placeholder="0"
                                                value={orderCostGross}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setOrderCostGross(val);

                                                    // Update Net based on Gross
                                                    if (val === '') {
                                                        setOrderCost('');
                                                        return;
                                                    }
                                                    const numVal = parseFloat(val);
                                                    if (!isNaN(numVal)) {
                                                        const taxRate = selectedProduct.tax_rate || 0;
                                                        const newNet = numVal / (1 + taxRate / 100);
                                                        setOrderCost(newNet.toFixed(1));
                                                    }
                                                }}
                                            />
                                        </div>

                                        {/* Precio Sugerido +30% */}
                                        <div>
                                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                                                Sugerido (30%)
                                            </label>
                                            <div className="w-full bg-[var(--color-primary)]/20 border border-[var(--color-primary)] rounded-lg px-3 py-2 text-[var(--color-primary)] font-bold text-sm shadow-[0_0_10px_rgba(var(--color-primary-rgb),0.2)]">
                                                {(() => {
                                                    if (!orderCost) return '$0';
                                                    const netCost = parseFloat(orderCost);
                                                    if (isNaN(netCost)) return '$0';
                                                    const taxRate = selectedProduct.tax_rate || 0;
                                                    // Net Price for 30% margin = Net Cost * 1.30
                                                    const targetNetPrice = netCost * 1.30;
                                                    // Gross Price = Target Net Price * (1 + Tax Rate)
                                                    const targetGrossPrice = targetNetPrice * (1 + taxRate / 100);
                                                    return formatCurrency(targetGrossPrice, currentCurrency);
                                                })()}
                                            </div>
                                        </div>

                                        {/* Cantidad */}
                                        <div>
                                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad</label>
                                            <input
                                                type="number"
                                                value={orderQuantity}
                                                onChange={(e) => setOrderQuantity(e.target.value)}
                                                min="1"
                                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                                                placeholder="1"
                                            />
                                        </div>
                                    </div>

                                    {/* Total */}
                                    <div className="flex justify-between items-center p-3 bg-[var(--glass-bg)] rounded-lg mb-4">
                                        <span className="text-sm text-[var(--color-text-muted)]">Total del Pedido:</span>
                                        <span className="text-xl font-bold text-[var(--color-primary)]">
                                            {formatCurrency(
                                                Number(orderCostGross || 0) * Number(orderQuantity || 0),
                                                currentCurrency
                                            )}
                                        </span>
                                    </div>

                                    {/* Order Button */}
                                    <button
                                        onClick={addToOrder}
                                        disabled={!orderCost || !orderQuantity || Number(orderQuantity) <= 0}
                                        className="w-full py-3 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-bold rounded-lg transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[var(--color-primary)]/20"
                                    >
                                        <Truck size={20} />
                                        Agregar al Pedido
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)] p-8">
                            <Package size={64} className="mb-4 opacity-20" />
                            <h3 className="text-xl font-bold text-[var(--color-text-muted)] mb-2">Seleccione un producto</h3>
                            <p className="text-sm max-w-xs text-center">
                                {selectedSupplierId
                                    ? "Haga clic en un producto de la lista para ver su información detallada."
                                    : "Primero seleccione un proveedor, luego elija un producto de la lista."}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Product Detail Modal */}
            {selectedProduct && (
                <div className="lg:hidden fixed inset-0 z-[9999] bg-[var(--color-background)] flex flex-col">
                    {/* Mobile Header */}
                    <div className="p-4 bg-[var(--glass-bg)] border-b border-[var(--glass-border)] flex justify-between items-start">
                        <div>
                            <h2 className="text-xl font-bold text-[var(--color-text)] leading-tight">{selectedProduct.name}</h2>
                            <div className="flex gap-2 text-xs text-[var(--color-text-muted)] mt-1">
                                <span>{selectedProduct.sku || 'Sin SKU'}</span>
                                <span>•</span>
                                <span>{getSupplierName(selectedProduct.supplier_id)}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className={cn(
                                "text-2xl font-bold leading-none",
                                selectedProduct.stock <= (selectedProduct.min_stock || 5) ? "text-red-400" : "text-green-400"
                            )}>
                                {selectedProduct.stock || 0}
                            </div>
                            <span className="text-[10px] text-[var(--color-text-muted)]">unidades en stock</span>
                        </div>
                    </div>

                    {/* Mobile Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">

                        {/* Top Grid: Image & Stats */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Image Card */}
                            <div className="glass-card p-4 flex items-center justify-center bg-white aspect-square rounded-xl">
                                {selectedProduct.image_url ? (
                                    <img src={selectedProduct.image_url} alt={selectedProduct.name} className="max-w-full max-h-full object-contain" />
                                ) : (
                                    <Package size={48} className="text-gray-300" />
                                )}
                            </div>

                            {/* Sales Stats (Placeholder) */}
                            <div className="glass-card p-3 flex flex-col relative overflow-hidden">
                                <div className="absolute top-2 left-2 flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] font-bold uppercase">
                                    <TrendingDown size={10} className="text-blue-400" />
                                    Estadísticas de Ventas
                                </div>
                                <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)] text-center mt-4">
                                    {productStats ? (
                                        <div>
                                            <p className="font-bold text-[var(--color-text)]">{productStats.avgWeeklySales} /sem</p>
                                            <p className="text-[10px]">Ventas Promedio</p>
                                        </div>
                                    ) : (
                                        "Sin datos de ventas"
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Middle Grid: Supplier & Stock */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="glass-card p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <Truck size={12} className="text-blue-400" />
                                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Proveedor</span>
                                </div>
                                <p className="font-bold text-sm text-[var(--color-text)] truncate">{getSupplierName(selectedProduct.supplier_id)}</p>
                            </div>

                            <div className="glass-card p-3 relative overflow-hidden">
                                <div className="flex items-center gap-2 mb-2">
                                    <Box size={12} className="text-red-400" />
                                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Nivel de Stock</span>
                                </div>
                                <div className="flex items-end justify-between">
                                    <div>
                                        <div className="text-[10px] text-[var(--color-text-muted)]">Actual</div>
                                        <div className={cn("text-lg font-bold leading-none", selectedProduct.stock < 0 ? "text-red-400" : "text-[var(--color-text)]")}>{selectedProduct.stock}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] text-[var(--color-text-muted)]">Mínimo</div>
                                        <div className="text-lg font-bold text-[var(--color-text-muted)] leading-none">{selectedProduct.min_stock || 5}</div>
                                    </div>
                                </div>
                                {selectedProduct.stock <= (selectedProduct.min_stock || 5) && (
                                    <div className="mt-2 text-[10px] text-red-300 bg-red-500/10 px-2 py-1 rounded border border-red-500/20 flex items-center gap-1">
                                        <AlertTriangle size={10} /> Stock bajo - Requiere pedido
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Lower Grid: Prices & Info */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="glass-card p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <DollarSign size={12} className="text-cyan-400" />
                                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Precios</span>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-[var(--color-text-muted)]">Costo</span>
                                        <span className="font-bold text-[var(--color-text)]">{formatCurrency(selectedProduct.cost, currentCurrency)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-[var(--color-text-muted)]">Costo+IVA</span>
                                        <span className="font-bold text-[var(--color-text)]">{formatCurrency(selectedProduct.costWithTax || (selectedProduct.cost * (1 + (selectedProduct.tax_rate || 0) / 100)), currentCurrency)}</span>
                                    </div>
                                    <div className="flex justify-between pt-1 border-t border-[var(--glass-border)]">
                                        <span className="text-[var(--color-text-muted)]">Venta</span>
                                        <span className="font-bold text-green-400">{formatCurrency(selectedProduct.price, currentCurrency)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-[var(--color-text-muted)]">Margen</span>
                                        <span className="font-bold text-cyan-400">
                                            {selectedProduct.cost > 0
                                                ? `${((((selectedProduct.price / (1 + (selectedProduct.tax_rate || 0) / 100)) - selectedProduct.cost) / selectedProduct.cost) * 100).toFixed(1)}%`
                                                : '0%'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="glass-card p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <Info size={12} className="text-blue-400" />
                                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">Información</span>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div>
                                        <div className="text-[var(--color-text-muted)] text-[10px]">Categoría</div>
                                        <div className="font-medium text-[var(--color-text)] truncate">{getCategoryName(selectedProduct.category_id)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[var(--color-text-muted)] text-[10px]">Valor Inventario</div>
                                        <div className="font-bold text-[var(--color-text)]">{formatCurrency((selectedProduct.cost || 0) * (selectedProduct.stock || 0), currentCurrency)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Order Form (Mobile Compact) */}
                        <div className="glass-card p-4 border border-[var(--color-primary)]/30 shadow-lg shadow-[var(--color-primary)]/5">
                            <div className="flex items-center gap-2 mb-3 text-[var(--color-primary)] font-bold text-xs uppercase">
                                <Box size={14} />
                                Realizar Pedido
                            </div>

                            <div className="grid grid-cols-3 gap-2 mb-3">
                                {/* Costo Unitario */}
                                <div>
                                    <label className="text-[10px] text-[var(--color-text-muted)] block mb-1">Costo Unit</label>
                                    <div className="relative">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] text-xs">$</span>
                                        <input
                                            type="number"
                                            value={orderCost}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setOrderCost(val);
                                                if (val === '') { setOrderCostGross(''); return; }
                                                const numVal = parseFloat(val);
                                                if (!isNaN(numVal)) {
                                                    const taxRate = selectedProduct.tax_rate || 0;
                                                    const newGross = numVal * (1 + taxRate / 100);
                                                    setOrderCostGross(Number.isInteger(newGross) ? newGross.toString() : newGross.toFixed(1));
                                                }
                                            }}
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg py-1.5 pl-5 pr-1 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                {/* Costo + IVA */}
                                <div>
                                    <label className="text-[10px] text-[var(--color-text-muted)] block mb-1">Costo+IVA</label>
                                    <input
                                        type="number"
                                        value={orderCostGross}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setOrderCostGross(val);
                                            if (val === '') { setOrderCost(''); return; }
                                            const numVal = parseFloat(val);
                                            if (!isNaN(numVal)) {
                                                const taxRate = selectedProduct.tax_rate || 0;
                                                const newNet = numVal / (1 + taxRate / 100);
                                                setOrderCost(newNet.toFixed(1));
                                            }
                                        }}
                                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg py-1.5 px-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        placeholder="0"
                                    />
                                </div>

                                {/* Sugerido */}
                                <div>
                                    <label className="text-[10px] text-[var(--color-text-muted)] block mb-1">Sugerido (30%)</label>
                                    <div className="w-full bg-[var(--color-primary)]/20 border border-[var(--color-primary)] rounded-lg py-1.5 px-1 text-[var(--color-primary)] font-bold text-xs text-center truncate">
                                        {(() => {
                                            if (!orderCost) return '$0';
                                            const netCost = parseFloat(orderCost);
                                            if (isNaN(netCost)) return '$0';
                                            const taxRate = selectedProduct.tax_rate || 0;
                                            return formatCurrency((netCost * 1.30) * (1 + taxRate / 100), currentCurrency);
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* Quantity Row */}
                            <div className="mb-3">
                                <label className="text-[10px] text-[var(--color-text-muted)] block mb-1">Cantidad</label>
                                <input
                                    type="number"
                                    value={orderQuantity}
                                    onChange={(e) => setOrderQuantity(e.target.value)}
                                    min="1"
                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg py-2 px-3 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                    placeholder="1"
                                />
                            </div>

                            <div className="flex items-center justify-between gap-3 bg-[var(--glass-bg)] p-2 rounded-lg mb-3">
                                <div className="text-[var(--color-text-muted)] text-xs">Total del Pedido:</div>
                                <div className="text-lg font-bold text-[var(--color-primary)]">
                                    {formatCurrency(Number(orderCostGross || 0) * (Number(orderQuantity) || 1), currentCurrency)}
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    if (addToOrder()) {
                                        setSelectedProduct(null);
                                    }
                                }}
                                className="w-full py-3 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-bold rounded-xl shadow-lg shadow-[var(--color-primary)]/20 active:scale-95 transition-transform"
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Package size={18} />
                                    <span>Agregar al Pedido</span>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Mobile Footer/Close */}
                    <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                        <button
                            onClick={() => setSelectedProduct(null)}
                            className="w-full py-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] font-bold hover:bg-[var(--glass-border)] transition-colors"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            )}

            {/* Order Modal */}
            {showOrderModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="glass rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-[var(--glass-border)]">
                        {/* Modal Header */}
                        <div className="p-4 lg:p-6 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-[var(--color-text)]">Factura de Pedido</h2>
                                <select
                                    value={invoiceSupplierId || ''}
                                    onChange={(e) => setInvoiceSupplierId(Number(e.target.value))}
                                    className="mt-1 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-1 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] transition-colors min-w-[200px]"
                                >
                                    <option value="">Seleccionar proveedor</option>
                                    {suppliers.map(supplier => (
                                        <option key={supplier.id} value={supplier.id}>
                                            {supplier.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                onClick={() => setShowOrderModal(false)}
                                className="p-2 hover:bg-[var(--glass-bg)] rounded-lg transition-colors"
                            >
                                <span className="text-2xl text-[var(--color-text-muted)]">×</span>
                            </button>
                        </div>

                        {/* Supplier Details Info (New) */}
                        {invoiceSupplier && (
                            <div className="px-4 lg:px-6 py-3 bg-[var(--glass-bg)] border-b border-[var(--glass-border)] grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                                <div>
                                    <span className="text-[var(--color-text-muted)] text-xs block mb-1">Vendedor</span>
                                    <span className="font-medium text-[var(--color-text)]">{invoiceSupplier.seller_name || '-'}</span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)] text-xs block mb-1">Celular</span>
                                    <span className="font-medium text-[var(--color-text)]">{invoiceSupplier.phone || '-'}</span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)] text-xs block mb-1">Días Pedido</span>
                                    <span className="font-medium text-[var(--color-text)]">{invoiceSupplier.order_days || '-'}</span>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-muted)] text-xs block mb-1">Días Entrega</span>
                                    <span className="font-medium text-[var(--color-text)]">{invoiceSupplier.delivery_days || '-'}</span>
                                </div>
                            </div>
                        )
                        }

                        {/* Modal Content */}
                        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
                            {orderItems.length === 0 ? (
                                <div className="text-center py-12 text-[var(--color-text-muted)]">
                                    <Box size={48} className="mx-auto mb-4 opacity-30" />
                                    <p className="text-lg font-medium">No hay productos en el pedido</p>
                                    <p className="text-sm">Seleccione productos y haga clic en "Agregar al Pedido"</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {orderItems.map((item, idx) => (
                                        <div
                                            key={item.id}
                                            className="glass-card p-4 flex items-center gap-4"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-[var(--color-text)] truncate">{item.name}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">{item.sku}</p>
                                                <div className="flex gap-3 mt-1 text-xs text-[var(--color-text-muted)]">
                                                    <span>Costo: {formatCurrency(item.cost, currentCurrency)}</span>
                                                    {item.taxRate > 0 && <span>+IVA: {formatCurrency(item.costWithTax, currentCurrency)}</span>}
                                                </div>
                                            </div>
                                            <div className="text-center px-4 min-w-[90px]">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={orderItemQuantityDrafts[item.id] ?? String(item.quantity)}
                                                    onChange={(e) => updateOrderItemQuantity(item.id, e.target.value)}
                                                    onBlur={() => commitOrderItemQuantity(item.id)}
                                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg py-1 px-2 text-center text-lg font-bold text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                                />
                                                <p className="text-xs text-[var(--color-text-muted)] mt-1">uds</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-lg font-bold text-[var(--color-primary)]">{formatCurrency(item.total, currentCurrency)}</p>
                                            </div>
                                            <button
                                                onClick={() => removeFromOrder(item.id)}
                                                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 lg:p-6 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-4">
                            {/* Totals */}
                            <div className="flex justify-between items-center text-lg">
                                <span className="text-[var(--color-text-muted)]">Total ({orderItems.length} productos)</span>
                                <span className="text-2xl font-bold text-[var(--color-primary)]">{formatCurrency(orderTotal, currentCurrency)}</span>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-3 items-end">
                                    <div className="flex-1">
                                        <label className="text-xs text-[var(--color-text-muted)] block mb-1">Fecha Llegada (Opcional)</label>
                                        <input
                                            type="date"
                                            value={arrivalDate}
                                            onChange={(e) => setArrivalDate(e.target.value)}
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)]"
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowOrderModal(false)}
                                        className="flex-1 py-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg font-bold text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
                                    >
                                        Seguir Agregando
                                    </button>
                                    <button
                                        onClick={handleConfirmOrder}
                                        disabled={orderItems.length === 0}
                                        className="flex-1 py-3 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-bold rounded-lg transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Truck size={20} />
                                        Confirmar Pedido
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Orders;
