import React, { useState, useEffect } from 'react';

import { Search, Package, ArrowDownCircle, ArrowUpCircle, RefreshCw, Truck, ShoppingCart, RotateCcw, Globe, Smartphone, FileText, User, Calendar, Hash, Eye, AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import { formatCurrency } from '../utils/formatCurrency';
import { cn } from '../lib/utils';
import OptimizedImage from '../components/OptimizedImage';
import { formatInCompanyTime } from '../lib/dateHelpers';
import { format, subDays, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
// FASE 5 · Queries analíticas migradas a tablas normalizadas (sale_items /
// purchase_items). Cada función tiene fallback automático al JSON legacy.
import {
    productSalesHistoryNormalized,
    productSalesHistoryViaJson,
    productPurchasesHistoryNormalized,
    productPurchasesHistoryViaJson,
} from '../lib/analyticsQueries';
// FASE 5.5 · Telemetría de fallbacks — cuántas veces la versión normalizada
// falla y debe usarse la JSON. Si supera ~1%, es señal de problema sistémico.
import { logAnalyticsEvent } from '../lib/analyticsTelemetry';

const ProductProfile = () => {
    const { activeCompanyId, currentCurrency, searchProductsForDropdown, users, currentCompanyTimezone } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [activeTab, setActiveTab] = useState('purchases');
    const [skipNextSearch, setSkipNextSearch] = useState(false);

    // View Controls
    const [dateRange, setDateRange] = useState({
        from: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        to: format(endOfMonth(new Date()), 'yyyy-MM-dd')
    });

    // Data states for each tab
    const [purchases, setPurchases] = useState([]);
    const [sales, setSales] = useState([]);
    const [movements, setMovements] = useState([]);

    // Sales stats (pre-calculated from DB)
    const [salesStats, setSalesStats] = useState(null);
    const [isLoadingStats, setIsLoadingStats] = useState(false);

    // FEFO lots
    const [lots, setLots] = useState([]);


    // Search products using store function
    const handleSearch = async (term) => {
        const searchValue = term || searchTerm;
        if (!searchValue.trim() || searchValue.length < 2) {
            setSearchResults([]);
            return;
        }

        setIsLoading(true);
        try {
            const results = await searchProductsForDropdown(searchValue);
            setSearchResults(results || []);
        } catch (error) {
            console.error('Error searching products:', error);
            setSearchResults([]);
        }
        setIsLoading(false);
    };

    // Auto-search as user types with debounce
    useEffect(() => {
        if (skipNextSearch) {
            setSkipNextSearch(false);
            return;
        }

        if (!searchTerm.trim()) {
            setSearchResults([]);
            return;
        }

        if (selectedProduct && searchTerm === selectedProduct.name) {
            return;
        }

        const timer = setTimeout(() => {
            if (searchTerm.length >= 2) handleSearch(searchTerm);
            else setSearchResults([]);
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Select product and load all data
    const handleSelectProduct = async (product) => {
        setSkipNextSearch(true);
        setSearchResults([]);
        setSelectedProduct(product);
        setSearchTerm(product.name);
        loadSalesStats(product.id, product.stock);
        loadProductLots(product.id);
        await loadProductMovements(product.id, product);
    };

    // Load pre-calculated sales stats from DB (fast)
    const loadSalesStats = async (productId, currentStock) => {
        setIsLoadingStats(true);
        try {
            const today = format(new Date(), 'yyyy-MM-dd');
            const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

            const [profitRes, statsRes] = await Promise.all([
                turso.execute({
                    sql: `SELECT COALESCE(SUM(total_quantity), 0) as total_sold,
                                 COUNT(DISTINCT day) as days_with_sales
                          FROM product_daily_profit
                          WHERE company_id = ? AND product_id = ? AND day >= ? AND day <= ?`,
                    args: [activeCompanyId, productId, thirtyDaysAgo, today]
                }),
                turso.execute({
                    sql: `SELECT last_sale_date FROM product_movement_stats
                          WHERE company_id = ? AND product_id = ?`,
                    args: [activeCompanyId, productId]
                })
            ]);

            const totalSold30d = parseFloat(profitRes.rows[0]?.total_sold) || 0;
            const avgDaily = totalSold30d / 30;
            const avgWeekly = avgDaily * 7;
            const daysOfStock = avgDaily > 0 ? Math.round(currentStock / avgDaily) : null;
            const lastSaleDate = statsRes.rows[0]?.last_sale_date || null;

            let velocity = 'NORMAL';
            let velocityColor = 'yellow';
            if (avgDaily < 0.5) { velocity = 'LENTO'; velocityColor = 'red'; }
            else if (avgDaily > 3) { velocity = 'RÁPIDO'; velocityColor = 'green'; }

            setSalesStats({ avgDaily, avgWeekly, daysOfStock, lastSaleDate, velocity, velocityColor });
        } catch (e) {
            console.error('Error loading sales stats:', e);
            setSalesStats(null);
        }
        setIsLoadingStats(false);
    };

    // Load FEFO lots for product
    const loadProductLots = async (productId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT * FROM product_lots WHERE product_id = ? AND company_id = ? ORDER BY expiry_date DESC`,
                args: [productId, activeCompanyId]
            });
            setLots(result.rows || []);
        } catch (e) {
            console.error('Error loading lots:', e);
            setLots([]);
        }
    };

    // Load product movements (purchases and sales)
    const loadProductMovements = async (productId, product = null) => {
        const currentProduct = product || selectedProduct;
        setIsLoadingData(true);

        // === 1. Load tab data (purchases, sales, movements) ===
        //
        // FASE 5 · Estrategia híbrida con fallback seguro:
        //   1) Intenta tablas normalizadas (sale_items / purchase_items) → rápido (≈25×)
        //   2) Si falla cualquier paso, cae a la versión legacy con LIKE en items JSON
        // Forma de salida IDÉNTICA — la UI no nota la diferencia.
        const ctxNorm = {
            turso,
            companyId: activeCompanyId,
            productId,
            dateFrom: dateRange.from,
            dateTo: dateRange.to,
        };
        try {
            // ─── PURCHASES ──────────────────────────────────────────────
            let productPurchases = [];
            let purchasesViaNormalized = false;
            const tPurchStart = Date.now();
            try {
                const rows = await productPurchasesHistoryNormalized({ ...ctxNorm, limit: 100 });
                purchasesViaNormalized = true;
                productPurchases = rows.map(r => {
                    const productItem = {
                        id: productId,
                        name: r.name,
                        sku: r.sku,
                        quantity: r.quantity,
                        cost: r.cost,
                        price: r.price,
                        batchNumber: r.batch_number,
                        expiryDate: r.expiry_date,
                    };
                    return {
                        id: r.purchase_id,
                        date: r.full_date || r.purchase_date,
                        invoice_number: r.invoice_number,
                        supplier_id: r.supplier_id,
                        supplier_name: r.supplier_name,
                        supplier_email: r.supplier_email,
                        supplier_phone: r.supplier_phone,
                        purchase_user_name: r.purchase_user_name,
                        user_id: r.user_id,
                        productItem,
                        formattedDate: currentCompanyTimezone
                            ? formatInCompanyTime((r.full_date || r.purchase_date).length === 10 ? `${r.full_date || r.purchase_date}T12:00:00` : (r.full_date || r.purchase_date), currentCompanyTimezone, 'dd/MM/yyyy HH:mm')
                            : (r.full_date || r.purchase_date).length === 10
                                ? (r.full_date || r.purchase_date).split('-').reverse().join('/')
                                : format(parseISO(r.full_date || r.purchase_date), 'dd/MM/yyyy HH:mm'),
                        quantity: r.quantity,
                        cost: r.cost || r.price,
                    };
                });
            } catch (e) {
                console.warn('[fase5] purchases normalized falló, cae a JSON:', e?.message || e);
                logAnalyticsEvent({
                    event_type: 'fallback',
                    query_name: 'productPurchasesHistory',
                    error_msg: e?.message || String(e),
                    duration_ms: Date.now() - tPurchStart,
                    company_id: activeCompanyId,
                });
            }

            if (!purchasesViaNormalized) {
                const rows = await productPurchasesHistoryViaJson({ ...ctxNorm, limit: 100 });
                productPurchases = rows.map(r => {
                    const productItem = {
                        id: productId,
                        name: r.name,
                        sku: r.sku,
                        quantity: r.quantity,
                        cost: r.cost,
                        price: r.price,
                        batchNumber: r.batch_number,
                        expiryDate: r.expiry_date,
                    };
                    return {
                        id: r.purchase_id,
                        date: r.full_date || r.purchase_date,
                        invoice_number: r.invoice_number,
                        supplier_id: r.supplier_id,
                        supplier_name: r.supplier_name,
                        supplier_email: r.supplier_email,
                        supplier_phone: r.supplier_phone,
                        purchase_user_name: r.purchase_user_name,
                        user_id: r.user_id,
                        productItem,
                        formattedDate: currentCompanyTimezone
                            ? formatInCompanyTime((r.full_date || r.purchase_date).length === 10 ? `${r.full_date || r.purchase_date}T12:00:00` : (r.full_date || r.purchase_date), currentCompanyTimezone, 'dd/MM/yyyy HH:mm')
                            : (r.full_date || r.purchase_date).length === 10
                                ? (r.full_date || r.purchase_date).split('-').reverse().join('/')
                                : format(parseISO(r.full_date || r.purchase_date), 'dd/MM/yyyy HH:mm'),
                        quantity: r.quantity,
                        cost: r.cost || r.price,
                    };
                });
            }
            setPurchases(productPurchases);

            // ─── SALES ──────────────────────────────────────────────────
            let productSales = [];
            let salesViaNormalized = false;
            const tSalesStart = Date.now();
            try {
                const rows = await productSalesHistoryNormalized({ ...ctxNorm, limit: 200 });
                salesViaNormalized = true;
                productSales = rows.map(r => {
                    const productItem = {
                        id: productId,
                        name: r.name,
                        sku: r.sku,
                        quantity: r.quantity,
                        price: r.price,
                        cost: r.cost,
                        discountPercent: r.discount_pct,
                    };
                    return {
                        id: r.sale_id,
                        date: r.full_date || r.sale_date,
                        user_id: r.user_id,
                        user_name: r.user_name,
                        status: r.status,
                        payment_method: r.payment_method,
                        client_name: r.client_name,
                        productItem,
                        formattedDate: currentCompanyTimezone
                            ? formatInCompanyTime(r.full_date || r.sale_date, currentCompanyTimezone, 'dd/MM/yyyy HH:mm')
                            : format(parseISO(r.full_date || r.sale_date), 'dd/MM/yyyy HH:mm'),
                        quantity: r.quantity,
                        price: r.price,
                        subtotal: (Number(r.quantity) || 0) * (Number(r.price) || 0),
                    };
                });
            } catch (e) {
                console.warn('[fase5] sales normalized falló, cae a JSON:', e?.message || e);
                logAnalyticsEvent({
                    event_type: 'fallback',
                    query_name: 'productSalesHistory',
                    error_msg: e?.message || String(e),
                    duration_ms: Date.now() - tSalesStart,
                    company_id: activeCompanyId,
                });
            }

            if (!salesViaNormalized) {
                const rows = await productSalesHistoryViaJson({ ...ctxNorm, limit: 200 });
                productSales = rows.map(r => {
                    const productItem = {
                        id: productId,
                        name: r.name,
                        sku: r.sku,
                        quantity: r.quantity,
                        price: r.price,
                        cost: r.cost,
                        discountPercent: r.discount_pct,
                    };
                    return {
                        id: r.sale_id,
                        date: r.full_date || r.sale_date,
                        user_id: r.user_id,
                        user_name: r.user_name,
                        status: r.status,
                        payment_method: r.payment_method,
                        client_name: r.client_name,
                        productItem,
                        formattedDate: currentCompanyTimezone
                            ? formatInCompanyTime(r.full_date || r.sale_date, currentCompanyTimezone, 'dd/MM/yyyy HH:mm')
                            : format(parseISO(r.full_date || r.sale_date), 'dd/MM/yyyy HH:mm'),
                        quantity: r.quantity,
                        price: r.price,
                        subtotal: (Number(r.quantity) || 0) * (Number(r.price) || 0),
                    };
                });
            }
            setSales(productSales);

            // Stock Adjustments Query
            const adjustmentsResult = await turso.execute({
                sql: `SELECT * FROM stock_adjustments
                      WHERE company_id = ? AND product_id = ? AND date(created_at) BETWEEN date(?) AND date(?)
                      ORDER BY created_at DESC
                      LIMIT 100`,
                args: [activeCompanyId, productId, dateRange.from, dateRange.to]
            }).catch(() => ({ rows: [] }));

            const reasonLabels = { manual: 'Ajuste Manual', reconciliacion: 'Reconciliación', control_inventario: 'Control Inventario' };

            // Combine for Movements
            const allMovements = [
                ...productPurchases.map(p => ({
                    type: 'entrada',
                    date: p.date,
                    reference: `Factura #${p.invoice_number}`,
                    quantity: p.quantity,
                    price: p.cost,
                    user: p.purchase_user_name || 'Desconocido',
                    color: 'text-green-400',
                    icon: ArrowDownCircle
                })),
                ...productSales.map(s => ({
                    type: 'salida',
                    date: s.date,
                    reference: `Boleta #${s.id}`,
                    quantity: s.quantity,
                    price: s.price,
                    user: s.user_name || 'Desconocido',
                    color: 'text-red-400',
                    icon: ArrowUpCircle
                })),
                ...adjustmentsResult.rows.map(a => ({
                    type: 'ajuste',
                    date: a.created_at,
                    reference: reasonLabels[a.reason] || 'Ajuste',
                    quantity: Math.abs(a.difference),
                    adjustmentDiff: a.difference,
                    oldStock: a.old_stock,
                    newStock: a.new_stock,
                    price: null,
                    user: a.user_name || 'Desconocido',
                    color: 'text-yellow-400',
                    icon: RefreshCw
                }))
            ].sort((a, b) => new Date(b.date) - new Date(a.date));

            // Calculate running stock balance (from newest to oldest)
            let runningStock = currentProduct.stock || 0;
            for (let i = 0; i < allMovements.length; i++) {
                allMovements[i].stockAfter = runningStock;
                // Undo this movement to get the stock before it
                if (allMovements[i].type === 'ajuste') {
                    // For adjustments, we know the exact old/new stock
                    runningStock = allMovements[i].oldStock;
                } else if (allMovements[i].type === 'entrada') {
                    runningStock -= allMovements[i].quantity;
                } else {
                    runningStock += allMovements[i].quantity;
                }
            }

            setMovements(allMovements);
        } catch (error) {
            console.error('Error loading product movements:', error);
            setPurchases([]);
            setSales([]);
            setMovements([]);
        }



        setIsLoadingData(false);
    };

    // Reload data when date range changes
    useEffect(() => {
        if (selectedProduct) {
            loadProductMovements(selectedProduct.id, selectedProduct);
        }
    }, [dateRange]);

    // Get user name by id
    const getUserName = (userId) => {
        const user = users.find(u => u.id === userId);
        return user ? user.name : 'Usuario';
    };

    const today = format(new Date(), 'yyyy-MM-dd');
    const soon = format(subDays(new Date(), -30), 'yyyy-MM-dd');
    const expiredLots = lots.filter(l => l.expiry_date && l.expiry_date < today);
    const soonLots = lots.filter(l => l.expiry_date && l.expiry_date >= today && l.expiry_date <= soon);

    // Movement type tabs
    const tabs = [
        { id: 'purchases', label: 'Compras', icon: Truck, count: purchases.length },
        { id: 'sales', label: 'Ventas', icon: ShoppingCart, count: sales.length },
        { id: 'returns', label: 'Devoluciones', icon: RotateCcw, count: 0 },
        { id: 'movements', label: 'Movimientos', icon: RefreshCw, count: movements.length },
        { id: 'fefo', label: 'FEFO', icon: AlertTriangle, count: lots.length }
    ];



    return (
        <div className="min-h-full flex flex-col gap-4 p-4 lg:p-0 pb-8 animate-in fade-in duration-300">
            {/* Header Product Search */}
            <div className="glass-card p-4 relative z-[50]">
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar producto..."
                            className="w-full pl-10 pr-4 py-3 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSearch(searchTerm);
                                }
                            }}
                        />
                        {/* Dropdown Results */}
                        {searchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1a1f] dark:bg-[#0f0f1a] border border-[var(--glass-border)] rounded-xl shadow-2xl max-h-80 overflow-y-auto z-[9999]">
                                {searchResults.map((product) => (
                                    <div
                                        key={product.id}
                                        onClick={() => handleSelectProduct(product)}
                                        className="p-3 hover:bg-[var(--color-primary)]/10 cursor-pointer border-b border-[var(--glass-border)] last:border-0 transition-colors flex items-center gap-3"
                                    >
                                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--color-surface)] shrink-0">
                                            <OptimizedImage
                                                src={product.image}
                                                alt={product.name}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                        <div>
                                            <div className="font-bold text-[var(--color-text)]">{product.name}</div>
                                            <div className="text-xs text-[var(--color-text-muted)] flex gap-2">
                                                <span>Stock: {product.stock}</span>
                                                <span>•</span>
                                                <span className="text-[var(--color-primary)]">{formatCurrency(product.price, currentCurrency)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => handleSearch(searchTerm)}
                        className="px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-bold rounded-xl transition-all shadow-lg shadow-[var(--color-primary)]/20 flex items-center gap-2"
                    >
                        {isLoading ? <RefreshCw className="animate-spin" size={20} /> : <Search size={20} />}
                        <span className="hidden md:inline">Buscar</span>
                    </button>
                </div>
            </div>

            {/* Product Details */}
            {selectedProduct && (
                <div className="glass-card p-6">
                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* Product Image */}
                        <div className="w-full lg:w-32 h-32 rounded-xl overflow-hidden bg-[var(--glass-bg)] shrink-0">
                            <OptimizedImage
                                src={selectedProduct.image}
                                alt={selectedProduct.name}
                                className="w-full h-full object-contain p-2"
                            />
                        </div>

                        {/* Product Info Grid */}
                        <div className="flex-1">
                            <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">{selectedProduct.name}</h2>

                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Código:</p>
                                    <p className="text-[var(--color-text)] font-medium">{selectedProduct.id}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Impuesto (IVA):</p>
                                    <p className="text-[var(--color-text)] font-medium">
                                        {selectedProduct.tax_rate > 0 ? `${selectedProduct.tax_rate}%` : 'Exento'}
                                    </p>
                                </div>

                                {/* Tax Amount */}
                                {selectedProduct.tax_rate > 0 && (
                                    <div>
                                        <p className="text-xs text-[var(--color-text-muted)]">Monto Impuesto:</p>
                                        <p className="text-orange-400 font-medium">
                                            {formatCurrency(
                                                selectedProduct.price - (selectedProduct.price / (1 + (selectedProduct.tax_rate / 100))),
                                                currentCurrency
                                            )}
                                        </p>
                                    </div>
                                )}

                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Costo Neto:</p>
                                    <p className="text-[var(--color-text)] font-medium">{formatCurrency(selectedProduct.cost || 0, currentCurrency)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Precio Venta (Bruto):</p>
                                    <p className="text-[var(--color-text)] font-medium">{formatCurrency(selectedProduct.price, currentCurrency)}</p>
                                </div>

                                {/* Net Profit */}
                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Utilidad Neta:</p>
                                    <p className="text-green-400 font-bold text-lg">
                                        {formatCurrency(
                                            (selectedProduct.price / (1 + ((selectedProduct.tax_rate || 0) / 100))) - (selectedProduct.cost || 0),
                                            currentCurrency
                                        )}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Stock:</p>
                                    <p className="text-[var(--color-text)] font-bold text-lg">{selectedProduct.stock} {selectedProduct.unit === 'Kg' ? 'kg' : 'und'}</p>
                                </div>

                                <div>
                                    <p className="text-xs text-[var(--color-text-muted)]">Categoría:</p>
                                    <p className="text-[var(--color-text)] font-medium">{selectedProduct.category || 'Sin categoría'}</p>
                                </div>

                                {/* Last Supplier */}
                                <div className="col-span-2 md:col-span-1">
                                    <p className="text-xs text-[var(--color-text-muted)]">Último Proveedor:</p>
                                    <p className="text-blue-400 font-medium truncate">
                                        {purchases.length > 0 ? purchases[0].supplier_name : 'Sin registro de compra'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Sales Stats Cards */}
            {selectedProduct && salesStats && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div className="glass-card p-4">
                        <p className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">Venta promedio diaria</p>
                        <p className="text-lg font-bold text-[var(--color-text)]">{salesStats.avgDaily.toFixed(1)} <span className="text-xs font-normal text-[var(--color-text-muted)]">uds</span></p>
                    </div>
                    <div className="glass-card p-4">
                        <p className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">Venta promedio semanal</p>
                        <p className="text-lg font-bold text-[var(--color-text)]">{salesStats.avgWeekly.toFixed(1)} <span className="text-xs font-normal text-[var(--color-text-muted)]">uds</span></p>
                    </div>
                    <div className="glass-card p-4">
                        <p className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">Días que dura el stock</p>
                        <p className={`text-lg font-bold ${salesStats.daysOfStock !== null && salesStats.daysOfStock <= 7 ? 'text-red-400' : salesStats.daysOfStock !== null && salesStats.daysOfStock <= 15 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {salesStats.daysOfStock !== null ? `${salesStats.daysOfStock} días` : 'Sin ventas'}
                        </p>
                    </div>
                    <div className="glass-card p-4">
                        <p className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">Última venta</p>
                        <p className="text-lg font-bold text-[var(--color-text)]">{salesStats.lastSaleDate ? format(parseISO(salesStats.lastSaleDate), 'dd/MM/yyyy') : 'Sin ventas'}</p>
                    </div>
                    <div className="glass-card p-4 col-span-2 md:col-span-1">
                        <p className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">Velocidad</p>
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold
                            ${salesStats.velocityColor === 'green' ? 'bg-green-500/20 text-green-400' : 
                              salesStats.velocityColor === 'red' ? 'bg-red-500/20 text-red-400' : 
                              'bg-yellow-500/20 text-yellow-400'}`}>
                            {salesStats.velocity}
                        </span>
                    </div>
                </div>
            )}
            {selectedProduct && isLoadingStats && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="glass-card p-4 animate-pulse">
                            <div className="h-3 w-24 bg-white/10 rounded mb-2" />
                            <div className="h-5 w-16 bg-white/10 rounded" />
                        </div>
                    ))}
                </div>
            )}



            {/* Data Sections */}
            {selectedProduct && (
                <div className="glass-card overflow-hidden">
                    {/* Controls Bar */}
                    <div className="p-4 border-b border-[var(--glass-border)] flex flex-wrap gap-4 justify-end items-center bg-[var(--glass-bg)]">
                        <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2 border border-[var(--glass-border)]">
                            <Calendar size={16} className="text-[var(--color-primary)]" />
                            <input
                                type="date"
                                value={dateRange.from}
                                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                                className="bg-transparent border-none outline-none text-xs text-[var(--color-text)] w-24"
                            />
                            <span className="text-[var(--color-text-muted)]">-</span>
                            <input
                                type="date"
                                value={dateRange.to}
                                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                                className="bg-transparent border-none outline-none text-xs text-[var(--color-text)] w-24"
                            />
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 overflow-x-auto p-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
                                    ${activeTab === tab.id
                                            ? 'bg-[var(--color-primary)] text-white shadow-lg'
                                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                                        }`}
                                >
                                    <Icon size={16} />
                                    {tab.label}
                                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-black/20 text-white/80`}>
                                        {tab.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Content */}
                    <div className="p-0 min-h-[500px] max-h-[60vh] overflow-y-auto">
                        {isLoadingData ? (
                            <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-muted)]">
                                <RefreshCw className="animate-spin mb-4" size={32} />
                                <p>Cargando datos...</p>
                            </div>
                        ) : (
                            <>
                                {/* Purchases Tab */}
                                {activeTab === 'purchases' && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-[var(--glass-border)] text-[var(--color-text-muted)] text-xs uppercase bg-[var(--glass-bg)]">
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">Fecha</th>
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">N° Factura</th>
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">Proveedor</th>
                                                    <th className="p-4 font-semibold text-center sticky top-0 bg-[var(--glass-bg)] z-10">Cant.</th>
                                                    <th className="p-4 font-semibold text-right sticky top-0 bg-[var(--glass-bg)] z-10">Costo Unit.</th>
                                                    <th className="p-4 font-semibold text-right sticky top-0 bg-[var(--glass-bg)] z-10">Subtotal</th>
                                                    <th className="p-4 font-semibold text-center sticky top-0 bg-[var(--glass-bg)] z-10">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {purchases.map(purchase => (
                                                    <tr key={purchase.id} className="border-b border-[var(--glass-border)] text-sm hover:bg-[var(--glass-bg)] transition-colors">
                                                        <td className="p-4 text-[var(--color-text-muted)] whitespace-nowrap">
                                                            {purchase.formattedDate}
                                                        </td>
                                                        <td className="p-4 text-[var(--color-text)] font-medium">
                                                            {purchase.invoice_number || '-'}
                                                        </td>
                                                        <td className="p-4 text-[var(--color-text)]">
                                                            {purchase.supplier_name || 'Desconocido'}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className="bg-green-500/10 text-green-400 px-2 py-1 rounded-md font-bold">
                                                                +{purchase.quantity}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-right text-[var(--color-text)]">
                                                            {formatCurrency(purchase.cost, currentCurrency)}
                                                        </td>
                                                        <td className="p-4 text-right font-bold text-[var(--color-text)]">
                                                            {formatCurrency(purchase.cost * purchase.quantity, currentCurrency)}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${purchase.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                                                                purchase.status === 'partially_paid' ? 'bg-yellow-500/20 text-yellow-400' :
                                                                    'bg-red-500/20 text-red-400'
                                                                }`}>
                                                                {purchase.status === 'paid' ? 'PAGADO' : purchase.status === 'partially_paid' ? 'PARCIAL' : 'PENDIENTE'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {purchases.length === 0 && (
                                                    <tr>
                                                        <td colSpan="7" className="p-8 text-center text-[var(--color-text-muted)]">
                                                            No hay compras registradas en este periodo
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Sales Tab */}
                                {activeTab === 'sales' && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-[var(--glass-border)] text-[var(--color-text-muted)] text-xs uppercase bg-[var(--glass-bg)]">
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">Fecha</th>
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">N° Boleta</th>
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">Vendedor</th>
                                                    <th className="p-4 font-semibold sticky top-0 bg-[var(--glass-bg)] z-10">Cliente</th>
                                                    <th className="p-4 font-semibold text-center sticky top-0 bg-[var(--glass-bg)] z-10">Cant.</th>
                                                    <th className="p-4 font-semibold text-right sticky top-0 bg-[var(--glass-bg)] z-10">Precio Unit.</th>
                                                    <th className="p-4 font-semibold text-right sticky top-0 bg-[var(--glass-bg)] z-10">Subtotal</th>
                                                    <th className="p-4 font-semibold text-center sticky top-0 bg-[var(--glass-bg)] z-10">Método</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sales.map(sale => (
                                                    <tr key={sale.id} className="border-b border-[var(--glass-border)] text-sm hover:bg-[var(--glass-bg)] transition-colors">
                                                        <td className="p-4 text-[var(--color-text-muted)] whitespace-nowrap">
                                                            {sale.formattedDate}
                                                        </td>
                                                        <td className="p-4 text-[var(--color-text)] font-medium">
                                                            #{sale.id}
                                                        </td>
                                                        <td className="p-4 text-[var(--color-text)]">
                                                            {sale.user_name || 'Desconocido'}
                                                        </td>
                                                        <td className="p-4 text-[var(--color-text)]">
                                                            {sale.client_name || 'General'}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded-md font-bold">
                                                                -{sale.quantity}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-right text-[var(--color-text)]">
                                                            {formatCurrency(sale.price, currentCurrency)}
                                                        </td>
                                                        <td className="p-4 text-right font-bold text-[var(--color-text)]">
                                                            {formatCurrency(sale.subtotal, currentCurrency)}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className="capitalize px-2 py-1 bg-[var(--glass-bg)] rounded text-xs">
                                                                {sale.payment_method || 'Efectivo'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {sales.length === 0 && (
                                                    <tr>
                                                        <td colSpan="7" className="p-8 text-center text-[var(--color-text-muted)]">
                                                            No hay ventas registradas en este periodo
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Returns Tab */}
                                {activeTab === 'returns' && (
                                    <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-muted)]">
                                        <RotateCcw className="mb-4 opacity-50" size={48} />
                                        <p className="text-lg font-medium">Sección de Devoluciones (Próximamente)</p>
                                        <p className="text-sm">Aquí podrás gestionar las devoluciones de clientes.</p>
                                    </div>
                                )}

                                {/* FEFO Tab */}
                                {activeTab === 'fefo' && (
                                    <div className="overflow-x-auto">
                                        {/* Summary */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                            <div className="bg-[var(--color-surface)] rounded-lg p-3 text-center">
                                                <p className="text-[10px] uppercase text-[var(--color-text-muted)]">Total Lotes</p>
                                                <p className="text-lg font-bold text-[var(--color-text)]">{lots.length}</p>
                                            </div>
                                            <div className="bg-[var(--color-surface)] rounded-lg p-3 text-center">
                                                <p className="text-[10px] uppercase text-[var(--color-text-muted)]">Stock en Lotes</p>
                                                <p className="text-lg font-bold text-[var(--color-primary)]">{lots.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)}</p>
                                            </div>
                                            <div className="bg-[var(--color-surface)] rounded-lg p-3 text-center">
                                                <p className="text-[10px] uppercase text-red-400">Vencidos</p>
                                                <p className="text-lg font-bold text-red-400">{expiredLots.length}</p>
                                            </div>
                                            <div className="bg-[var(--color-surface)] rounded-lg p-3 text-center">
                                                <p className="text-[10px] uppercase text-yellow-400">Por Vencer (30d)</p>
                                                <p className="text-lg font-bold text-yellow-400">{soonLots.length}</p>
                                            </div>
                                        </div>

                                        <table className="w-full">
                                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-xs uppercase">
                                                <tr>
                                                    <th className="text-left p-3">Lote</th>
                                                    <th className="text-left p-3">Vencimiento</th>
                                                    <th className="text-right p-3">Cantidad</th>
                                                    <th className="text-right p-3">Costo</th>
                                                    <th className="text-left p-3">Proveedor</th>
                                                    <th className="text-center p-3">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {lots.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="6" className="p-8 text-center text-[var(--color-text-muted)]">
                                                            No hay lotes registrados para este producto
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    lots.map((lot) => {
                                                        const isExpired = lot.expiry_date && lot.expiry_date < today;
                                                        const isSoon = lot.expiry_date && !isExpired && lot.expiry_date <= soon;
                                                        const isEmpty = (parseFloat(lot.quantity) || 0) <= 0;
                                                        return (
                                                            <tr key={lot.id} className={`hover:bg-[var(--glass-bg)] transition-colors ${isExpired ? 'opacity-60' : ''}`}>
                                                                <td className="p-3 text-[var(--color-text)] font-medium">{lot.batch_number || '-'}</td>
                                                                <td className="p-3">
                                                                    {lot.expiry_date ? (
                                                                        <span className={`font-medium ${isExpired ? 'text-red-400' : isSoon ? 'text-yellow-400' : 'text-green-400'}`}>
                                                                            {format(parseISO(lot.expiry_date), 'dd/MM/yyyy')}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-[var(--color-text-muted)]">Sin fecha</span>
                                                                    )}
                                                                </td>
                                                                <td className={`p-3 text-right font-bold ${isEmpty ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                                                                    {parseFloat(lot.quantity) || 0}
                                                                </td>
                                                                <td className="p-3 text-right text-[var(--color-text)]">
                                                                    {formatCurrency(parseFloat(lot.cost) || 0, currentCurrency)}
                                                                </td>
                                                                <td className="p-3 text-blue-400">{lot.supplier_name || '-'}</td>
                                                                <td className="p-3 text-center">
                                                                    {isExpired ? (
                                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">VENCIDO</span>
                                                                    ) : isSoon ? (
                                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/20 text-yellow-400">POR VENCER</span>
                                                                    ) : isEmpty ? (
                                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/20 text-gray-400">AGOTADO</span>
                                                                    ) : (
                                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/20 text-green-400">VIGENTE</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Movements Tab */}
                                {activeTab === 'movements' && (
                                    <div className="overflow-x-auto">
                                        {/* Legend */}
                                        <div className="flex gap-4 mb-4 text-xs">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                                <span className="text-[var(--color-text-muted)]">Entrada (Compra)</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                                <span className="text-[var(--color-text-muted)]">Salida (Venta)</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                                <span className="text-[var(--color-text-muted)]">Ajuste de Stock</span>
                                            </div>
                                        </div>

                                        <table className="w-full">
                                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-xs uppercase">
                                                <tr>
                                                    <th className="text-left p-3 sticky top-0 bg-[var(--glass-bg)] z-10">#</th>
                                                    <th className="text-left p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Tipo</th>
                                                    <th className="text-left p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Referencia</th>
                                                    <th className="text-right p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Cantidad</th>
                                                    <th className="text-right p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Precio/Costo</th>
                                                    <th className="text-left p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Fecha</th>
                                                    <th className="text-right p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Stock</th>
                                                    <th className="text-left p-3 sticky top-0 bg-[var(--glass-bg)] z-10">Usuario</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {movements.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="8" className="p-8 text-center text-[var(--color-text-muted)]">
                                                            No hay movimientos registrados para este producto
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    movements.map((mov, idx) => (
                                                        <tr key={idx} className="hover:bg-[var(--glass-bg)] transition-colors">
                                                            <td className="p-3 text-[var(--color-text-muted)]">{idx + 1}</td>
                                                            <td className="p-3">
                                                                <div className="flex items-center gap-2">
                                                                    <div className={cn(
                                                                        "p-1 rounded",
                                                                        mov.type === 'entrada' ? "bg-green-500/20" : mov.type === 'ajuste' ? "bg-yellow-500/20" : "bg-red-500/20"
                                                                    )}>
                                                                        {mov.type === 'entrada' ? (
                                                                            <ArrowDownCircle size={14} className="text-green-400" />
                                                                        ) : mov.type === 'ajuste' ? (
                                                                            <RefreshCw size={14} className="text-yellow-400" />
                                                                        ) : (
                                                                            <ArrowUpCircle size={14} className="text-red-400" />
                                                                        )}
                                                                    </div>
                                                                    <span className={cn(
                                                                        "font-medium",
                                                                        mov.type === 'entrada' ? "text-green-400" : mov.type === 'ajuste' ? "text-yellow-400" : "text-red-400"
                                                                    )}>
                                                                        {mov.type === 'entrada' ? 'Entrada' : mov.type === 'ajuste' ? 'Ajuste' : 'Salida'}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="p-3 text-[var(--color-text)]">{mov.reference}</td>
                                                            <td className="p-3 text-right">
                                                                <span className={cn(
                                                                    "font-bold",
                                                                    mov.type === 'entrada' ? "text-green-400" : mov.type === 'ajuste' ? "text-yellow-400" : "text-red-400"
                                                                )}>
                                                                    {mov.type === 'ajuste'
                                                                        ? `${mov.oldStock} → ${mov.newStock}`
                                                                        : `${mov.type === 'entrada' ? '+' : '-'}${mov.quantity}`
                                                                    }
                                                                </span>
                                                            </td>
                                                            <td className="p-3 text-right text-[var(--color-text)]">
                                                                {mov.price != null ? formatCurrency(mov.price, currentCurrency) : '-'}
                                                            </td>
                                                            <td className="p-3 text-[var(--color-text-muted)]">
                                                                {(() => {
                                                                    try {
                                                                        if (currentCompanyTimezone) {
                                                                            return formatInCompanyTime(mov.date, currentCompanyTimezone, 'dd/MM/yyyy');
                                                                        }
                                                                        // Fallback: parse date-only strings without UTC conversion
                                                                        const d = mov.date;
                                                                        if (d && d.length === 10) {
                                                                            const [y, m, day] = d.split('-');
                                                                            return `${day}/${m}/${y}`;
                                                                        }
                                                                        return format(parseISO(d), 'dd/MM/yyyy');
                                                                    } catch {
                                                                        return mov.date;
                                                                    }
                                                                })()}
                                                            </td>
                                                            <td className="p-3 text-right">
                                                                <span className="font-bold text-[var(--color-text)]">{mov.stockAfter}</span>
                                                            </td>
                                                            <td className="p-3 text-blue-400">{mov.user}</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                        {movements.length > 0 && (
                                            <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                                                    <div>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Entradas</p>
                                                        <p className="text-xl font-bold text-green-400">
                                                            +{movements.filter(m => m.type === 'entrada').reduce((sum, m) => sum + m.quantity, 0)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Salidas</p>
                                                        <p className="text-xl font-bold text-red-400">
                                                            -{movements.filter(m => m.type === 'salida').reduce((sum, m) => sum + m.quantity, 0)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Ajustes</p>
                                                        <p className="text-xl font-bold text-yellow-400">
                                                            {movements.filter(m => m.type === 'ajuste').length}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Balance</p>
                                                        <p className="text-xl font-bold text-[var(--color-primary)]">
                                                            {movements.filter(m => m.type === 'entrada').reduce((sum, m) => sum + m.quantity, 0) -
                                                                movements.filter(m => m.type === 'salida').reduce((sum, m) => sum + m.quantity, 0)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs text-[var(--color-text-muted)]">Stock Actual</p>
                                                        <p className="text-xl font-bold text-[var(--color-text)]">
                                                            {selectedProduct?.stock || 0}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div >
            )}

            {/* Empty State */}
            {
                !selectedProduct && (
                    <div className="glass-card p-12 text-center">
                        <Package size={64} className="mx-auto text-[var(--color-text-muted)] opacity-30 mb-4" />
                        <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">Busca un producto</h3>
                        <p className="text-[var(--color-text-muted)]">Ingresa el nombre o código del producto para ver su perfil completo</p>
                    </div>
                )
            }
        </div >
    );
};

export default ProductProfile;
