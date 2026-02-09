import React, { useState, useEffect } from 'react';

import { Search, Package, ArrowDownCircle, ArrowUpCircle, RefreshCw, Truck, ShoppingCart, RotateCcw, Globe, Smartphone, FileText, User, Calendar, Hash, Eye } from 'lucide-react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import { formatCurrency } from '../utils/formatCurrency';
import { cn } from '../lib/utils';
import OptimizedImage from '../components/OptimizedImage';
import { format, subDays, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

const ProductProfile = () => {
    const { activeCompanyId, currentCurrency, searchProductsForDropdown, users } = useStore();
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
        await loadProductMovements(product.id, product);
    };

    // Load product movements (purchases and sales)
    const loadProductMovements = async (productId, product = null) => {
        const currentProduct = product || selectedProduct;
        setIsLoadingData(true);

        // === 1. Load tab data (purchases, sales, movements) ===
        // Use LIKE to pre-filter at SQL level — only rows containing this product ID
        const productIdStr = String(productId);
        try {
            // Purchases Query - filtered by product ID in items JSON
            const purchasesResult = await turso.execute({
                sql: `SELECT p.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone
                      FROM purchases p
                      LEFT JOIN suppliers s ON p.supplier_id = s.id
                      WHERE p.company_id = ? AND date(p.date) BETWEEN date(?) AND date(?)
                      AND p.items LIKE ?
                      ORDER BY p.date DESC
                      LIMIT 100`,
                args: [activeCompanyId, dateRange.from, dateRange.to, `%${productIdStr}%`]
            });

            // Process purchases (much fewer rows now)
            const productPurchases = [];
            for (const purchase of purchasesResult.rows) {
                try {
                    const items = JSON.parse(purchase.items || '[]');
                    const productItem = items.find(item => String(item.id) === productIdStr || String(item.productId) === productIdStr);
                    if (productItem) {
                        productPurchases.push({
                            ...purchase,
                            productItem: productItem,
                            formattedDate: format(parseISO(purchase.date), 'dd/MM/yyyy HH:mm'),
                            quantity: productItem.quantity,
                            cost: productItem.cost || productItem.price
                        });
                    }
                } catch (e) {
                    console.error('Error parsing purchase items:', e);
                }
            }
            setPurchases(productPurchases);

            // Sales Query - filtered by product ID in items JSON
            const salesResult = await turso.execute({
                sql: `SELECT s.*, u.name as user_name FROM sales s
                      LEFT JOIN users u ON s.user_id = u.id
                      WHERE s.company_id = ? AND date(s.date) BETWEEN date(?) AND date(?)
                      AND s.items LIKE ?
                      ORDER BY s.date DESC
                      LIMIT 200`,
                args: [activeCompanyId, dateRange.from, dateRange.to, `%${productIdStr}%`]
            });

            // Process sales (much fewer rows now)
            const productSales = [];
            for (const sale of salesResult.rows) {
                try {
                    const items = JSON.parse(sale.items || '[]');
                    const productItem = items.find(item => String(item.id) === productIdStr || String(item.productId) === productIdStr);
                    if (productItem) {
                        productSales.push({
                            ...sale,
                            productItem: productItem,
                            formattedDate: format(parseISO(sale.date), 'dd/MM/yyyy HH:mm'),
                            quantity: productItem.quantity,
                            price: productItem.price,
                            subtotal: productItem.quantity * productItem.price
                        });
                    }
                } catch (e) {
                    console.error('Error parsing sale items:', e);
                }
            }
            setSales(productSales);

            // Combine for Movements
            const allMovements = [
                ...productPurchases.map(p => ({
                    type: 'entrada',
                    date: p.date,
                    reference: `Factura #${p.invoice_number}`,
                    quantity: p.quantity,
                    price: p.cost,
                    user: 'Sistema',
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
                }))
            ].sort((a, b) => new Date(b.date) - new Date(a.date));

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

    // Movement type tabs
    const tabs = [
        { id: 'purchases', label: 'Compras', icon: Truck, count: purchases.length },
        { id: 'sales', label: 'Ventas', icon: ShoppingCart, count: sales.length },
        { id: 'returns', label: 'Devoluciones', icon: RotateCcw, count: 0 },
        { id: 'movements', label: 'Movimientos', icon: RefreshCw, count: movements.length }
    ];



    return (
        <div className="h-full flex flex-col gap-4 p-4 lg:p-0 animate-in fade-in duration-300">
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
                    <div className="p-0 min-h-[400px]">
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
                                                    <th className="p-4 font-semibold">Fecha</th>
                                                    <th className="p-4 font-semibold">N° Factura</th>
                                                    <th className="p-4 font-semibold">Proveedor</th>
                                                    <th className="p-4 font-semibold text-center">Cant.</th>
                                                    <th className="p-4 font-semibold text-right">Costo Unit.</th>
                                                    <th className="p-4 font-semibold text-right">Subtotal</th>
                                                    <th className="p-4 font-semibold text-center">Estado</th>
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
                                                    <th className="p-4 font-semibold">Fecha</th>
                                                    <th className="p-4 font-semibold">N° Boleta</th>
                                                    <th className="p-4 font-semibold">Vendedor</th>
                                                    <th className="p-4 font-semibold">Cliente</th>
                                                    <th className="p-4 font-semibold text-center">Cant.</th>
                                                    <th className="p-4 font-semibold text-right">Precio Unit.</th>
                                                    <th className="p-4 font-semibold text-right">Subtotal</th>
                                                    <th className="p-4 font-semibold text-center">Método</th>
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
                                                        <td colSpan="8" className="p-8 text-center text-[var(--color-text-muted)]">
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
                                        </div>

                                        <table className="w-full">
                                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-xs uppercase">
                                                <tr>
                                                    <th className="text-left p-3">#</th>
                                                    <th className="text-left p-3">Tipo</th>
                                                    <th className="text-left p-3">Referencia</th>
                                                    <th className="text-right p-3">Cantidad</th>
                                                    <th className="text-right p-3">Precio/Costo</th>
                                                    <th className="text-left p-3">Fecha</th>
                                                    <th className="text-left p-3">Usuario</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {movements.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="7" className="p-8 text-center text-[var(--color-text-muted)]">
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
                                                                        mov.type === 'entrada' ? "bg-green-500/20" : "bg-red-500/20"
                                                                    )}>
                                                                        {mov.type === 'entrada' ? (
                                                                            <ArrowDownCircle size={14} className="text-green-400" />
                                                                        ) : (
                                                                            <ArrowUpCircle size={14} className="text-red-400" />
                                                                        )}
                                                                    </div>
                                                                    <span className={cn(
                                                                        "font-medium",
                                                                        mov.type === 'entrada' ? "text-green-400" : "text-red-400"
                                                                    )}>
                                                                        {mov.type === 'entrada' ? 'Entrada' : 'Salida'}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="p-3 text-[var(--color-text)]">{mov.reference}</td>
                                                            <td className="p-3 text-right">
                                                                <span className={cn(
                                                                    "font-bold",
                                                                    mov.type === 'entrada' ? "text-green-400" : "text-red-400"
                                                                )}>
                                                                    {mov.type === 'entrada' ? '+' : '-'}{mov.quantity}
                                                                </span>
                                                            </td>
                                                            <td className="p-3 text-right text-[var(--color-text)]">
                                                                {formatCurrency(mov.price, currentCurrency)}
                                                            </td>
                                                            <td className="p-3 text-[var(--color-text-muted)]">
                                                                {new Date(mov.date).toLocaleDateString('es-CL')}
                                                            </td>
                                                            <td className="p-3 text-blue-400">{mov.user}</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                        {movements.length > 0 && (
                                            <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
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
