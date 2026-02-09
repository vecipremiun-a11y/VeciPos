import React, { useState, useEffect, useMemo } from 'react';
import { FileText, Calendar, Search, Eye, Download, CreditCard, Wallet, Clock, Check, X, Image, FileImage } from 'lucide-react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrency } from '../utils/formatCurrency';

const InvoicePaymentsReport = () => {
    const { activeCompanyId, suppliers, currentCurrency } = useStore();

    const [purchases, setPurchases] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [dateFrom, setDateFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [dateTo, setDateTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [supplierFilter, setSupplierFilter] = useState('');
    const [paymentTypeFilter, setPaymentTypeFilter] = useState('all'); // 'all' | 'cash' | 'credit'
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'paid' | 'partial' | 'pending'
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPurchase, setSelectedPurchase] = useState(null);
    const [showDocumentModal, setShowDocumentModal] = useState(false);

    useEffect(() => {
        loadPurchases();
    }, [activeCompanyId]);

    const loadPurchases = async () => {
        setIsLoading(true);
        try {
            const result = await turso.execute({
                sql: `SELECT * FROM purchases WHERE company_id = ? ORDER BY date DESC`,
                args: [activeCompanyId]
            });
            setPurchases(result.rows || []);
        } catch (e) {
            console.error('Error loading purchases:', e);
        }
        setIsLoading(false);
    };

    const filteredPurchases = useMemo(() => {
        return purchases.filter(p => {
            // Date filter
            if (dateFrom && p.date < dateFrom) return false;
            if (dateTo && p.date > dateTo) return false;

            // Supplier filter
            if (supplierFilter && p.supplier_id !== parseInt(supplierFilter)) return false;

            // Payment type filter
            if (paymentTypeFilter === 'cash' && p.is_credit) return false;
            if (paymentTypeFilter === 'credit' && !p.is_credit) return false;

            // Status filter
            if (statusFilter === 'paid' && p.status !== 'paid') return false;
            if (statusFilter === 'partial' && p.status !== 'partial') return false;
            if (statusFilter === 'pending' && (p.status === 'paid' || p.amount_paid > 0)) return false;

            // Search
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchInvoice = (p.invoice_number || '').toLowerCase().includes(q);
                const matchSupplier = (p.supplier_name || '').toLowerCase().includes(q);
                if (!matchInvoice && !matchSupplier) return false;
            }

            return true;
        });
    }, [purchases, dateFrom, dateTo, supplierFilter, paymentTypeFilter, statusFilter, searchQuery]);

    // Stats
    const stats = useMemo(() => {
        const total = filteredPurchases.reduce((sum, p) => sum + (p.total || 0), 0);
        const paid = filteredPurchases.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
        const pending = total - paid;
        const cashPurchases = filteredPurchases.filter(p => !p.is_credit);
        const creditPurchases = filteredPurchases.filter(p => p.is_credit);

        return { total, paid, pending, cashCount: cashPurchases.length, creditCount: creditPurchases.length };
    }, [filteredPurchases]);

    const getStatusBadge = (purchase) => {
        if (purchase.status === 'paid') {
            return <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-semibold">Pagado</span>;
        } else if (purchase.status === 'partial' || (purchase.amount_paid > 0 && purchase.amount_paid < purchase.total)) {
            return <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-semibold">Parcial</span>;
        } else if (purchase.is_credit) {
            return <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full text-xs font-semibold">Pendiente</span>;
        } else {
            return <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs font-semibold">Contado</span>;
        }
    };

    const openDetailModal = (purchase) => {
        setSelectedPurchase(purchase);
    };

    const closeDetailModal = () => {
        setSelectedPurchase(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-text)]">Pagos de Facturas</h1>
                    <p className="text-[var(--color-text-muted)] text-sm">Historial de pagos y compras de facturas</p>
                </div>
            </div>

            {/* Filters */}
            <div className="glass-card p-4">
                <div className="flex flex-col lg:flex-row gap-4">
                    {/* Date Range */}
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2">
                        <Calendar size={16} className="text-[var(--color-text-muted)]" />
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none"
                        />
                        <span className="text-[var(--color-text-muted)]">-</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none"
                        />
                    </div>

                    {/* Supplier Filter */}
                    <select
                        value={supplierFilter}
                        onChange={(e) => setSupplierFilter(e.target.value)}
                        className="bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-sm focus:outline-none"
                    >
                        <option value="">Todos los proveedores</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>

                    {/* Payment Type Filter */}
                    <div className="flex gap-2">
                        {['all', 'cash', 'credit'].map(type => (
                            <button
                                key={type}
                                onClick={() => setPaymentTypeFilter(type)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${paymentTypeFilter === type
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-white/10'
                                    }`}
                            >
                                {type === 'all' ? 'Todos' : type === 'cash' ? 'Contado' : 'Crédito'}
                            </button>
                        ))}
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-sm focus:outline-none"
                    >
                        <option value="all">Todos los estados</option>
                        <option value="paid">Pagados</option>
                        <option value="partial">Pago Parcial</option>
                        <option value="pending">Pendientes</option>
                    </select>

                    {/* Search */}
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2 flex-1 lg:max-w-xs">
                        <Search size={16} className="text-[var(--color-text-muted)]" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar factura..."
                            className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none flex-1"
                        />
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="glass-card p-4">
                    <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Total Facturas</p>
                    <p className="text-2xl font-bold text-[var(--color-text)]">{filteredPurchases.length}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Total Compras</p>
                    <p className="text-2xl font-bold text-[var(--color-primary)]">{formatCurrency(stats.total, currentCurrency)}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Pagado</p>
                    <p className="text-2xl font-bold text-green-400">{formatCurrency(stats.paid, currentCurrency)}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Pendiente</p>
                    <p className="text-2xl font-bold text-red-400">{formatCurrency(stats.pending, currentCurrency)}</p>
                </div>
                <div className="glass-card p-4">
                    <div className="flex justify-between">
                        <div>
                            <p className="text-xs text-[var(--color-text-muted)]">Contado</p>
                            <p className="text-lg font-bold text-blue-400">{stats.cashCount}</p>
                        </div>
                        <div>
                            <p className="text-xs text-[var(--color-text-muted)]">Crédito</p>
                            <p className="text-lg font-bold text-orange-400">{stats.creditCount}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-xs uppercase">
                            <tr>
                                <th className="px-4 py-3">N° Factura</th>
                                <th className="px-4 py-3">Proveedor</th>
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Tipo</th>
                                <th className="px-4 py-3 text-right">Total</th>
                                <th className="px-4 py-3 text-right">Pagado</th>
                                <th className="px-4 py-3 text-right">Saldo</th>
                                <th className="px-4 py-3 text-center">Estado</th>
                                <th className="px-4 py-3 text-center">Docs</th>
                                <th className="px-4 py-3 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-10 text-center text-[var(--color-text-muted)]">
                                        Cargando...
                                    </td>
                                </tr>
                            ) : filteredPurchases.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-10 text-center text-[var(--color-text-muted)]">
                                        No se encontraron facturas
                                    </td>
                                </tr>
                            ) : (
                                filteredPurchases.map(p => (
                                    <tr key={p.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-3">
                                            <span className="font-semibold text-[var(--color-text)]">#{p.invoice_number || 'S/N'}</span>
                                        </td>
                                        <td className="px-4 py-3 text-[var(--color-text)]">{p.supplier_name}</td>
                                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{p.date}</td>
                                        <td className="px-4 py-3">
                                            {p.is_credit ? (
                                                <span className="flex items-center gap-1 text-orange-400 text-sm">
                                                    <CreditCard size={14} /> Crédito
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-blue-400 text-sm">
                                                    <Wallet size={14} /> Contado
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-semibold text-[var(--color-text)]">
                                            {formatCurrency(p.total, currentCurrency)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-green-400">
                                            {formatCurrency(p.amount_paid || 0, currentCurrency)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-red-400">
                                            {formatCurrency((p.total || 0) - (p.amount_paid || 0), currentCurrency)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {getStatusBadge(p)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {(p.payment_observation || p.payment_document) ? (
                                                <span className="inline-flex items-center gap-1 text-green-400">
                                                    {p.payment_document && <FileImage size={14} />}
                                                    {p.payment_observation && <FileText size={14} />}
                                                </span>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => openDetailModal(p)}
                                                className="p-2 hover:bg-white/10 rounded-lg text-[var(--color-primary)] transition-colors"
                                                title="Ver detalles"
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Modal */}
            {selectedPurchase && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-3xl max-h-[90vh] border border-[var(--glass-border)] flex flex-col overflow-hidden">
                        {/* Modal Header */}
                        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between bg-[var(--glass-bg)] shrink-0">
                            <div>
                                <h2 className="text-xl font-bold text-[var(--color-text)]">
                                    Factura #{selectedPurchase.invoice_number || 'S/N'}
                                </h2>
                                <p className="text-sm text-[var(--color-text-muted)]">
                                    {selectedPurchase.supplier_name} | {selectedPurchase.date}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {getStatusBadge(selectedPurchase)}
                                <button onClick={closeDetailModal} className="p-2 hover:bg-white/10 rounded-full text-[var(--color-text)]">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-auto p-6 space-y-6">

                            {/* ===== COMPROBANTE DE PAGO (IMAGEN) - SECCIÓN PROMINENTE ===== */}
                            <div className="glass-card p-4 border-2 border-[var(--color-primary)]/30">
                                <h3 className="text-sm font-bold text-[var(--color-primary)] uppercase mb-4 flex items-center gap-2">
                                    <Image size={18} /> Comprobante de Pago
                                </h3>
                                {selectedPurchase.payment_document ? (
                                    <div className="space-y-3">
                                        {/* Check if it's an image (base64 or URL) */}
                                        {(selectedPurchase.payment_document.startsWith('data:image') ||
                                            selectedPurchase.payment_document.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? (
                                            <div
                                                className="relative cursor-pointer group"
                                                onClick={() => setShowDocumentModal(true)}
                                            >
                                                <img
                                                    src={selectedPurchase.payment_document}
                                                    alt="Comprobante de pago"
                                                    className="w-full h-auto max-h-96 object-contain rounded-xl border border-[var(--glass-border)] bg-black/20"
                                                />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                                                    <span className="text-white font-semibold flex items-center gap-2">
                                                        <Eye size={20} /> Click para ampliar
                                                    </span>
                                                </div>
                                            </div>
                                        ) : selectedPurchase.payment_document.startsWith('data:application/pdf') || selectedPurchase.payment_document.match(/\.pdf$/i) ? (
                                            <div className="bg-[var(--glass-bg)] p-6 rounded-xl text-center">
                                                <FileText size={48} className="mx-auto mb-3 text-red-400" />
                                                <p className="text-[var(--color-text)] font-semibold mb-3">Documento PDF adjunto</p>
                                                <a
                                                    href={selectedPurchase.payment_document}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    download
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
                                                >
                                                    <Download size={18} /> Ver / Descargar PDF
                                                </a>
                                            </div>
                                        ) : (
                                            <div className="bg-[var(--glass-bg)] p-6 rounded-xl text-center">
                                                <FileImage size={48} className="mx-auto mb-3 text-blue-400" />
                                                <p className="text-[var(--color-text)] font-semibold mb-3">Documento adjunto</p>
                                                <a
                                                    href={selectedPurchase.payment_document}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
                                                >
                                                    <Download size={18} /> Ver / Descargar
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-[var(--glass-bg)] p-8 rounded-xl text-center border border-dashed border-[var(--glass-border)]">
                                        <Image size={40} className="mx-auto mb-2 text-[var(--color-text-muted)] opacity-50" />
                                        <p className="text-[var(--color-text-muted)]">No hay comprobante adjunto para esta factura</p>
                                    </div>
                                )}
                            </div>

                            {/* ===== OBSERVACIÓN ===== */}
                            <div className="glass-card p-4">
                                <h3 className="text-sm font-bold text-[var(--color-text)] uppercase mb-3 flex items-center gap-2">
                                    <FileText size={16} /> Observación / Notas
                                </h3>
                                {selectedPurchase.payment_observation ? (
                                    <div className="bg-[var(--glass-bg)] p-4 rounded-lg">
                                        <p className="text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">
                                            {selectedPurchase.payment_observation}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-[var(--color-text-muted)] italic">Sin observaciones registradas</p>
                                )}
                            </div>

                            {/* ===== DETALLES DE PAGO ===== */}
                            <div className="glass-card p-4">
                                <h3 className="text-sm font-bold text-[var(--color-text)] uppercase mb-4 flex items-center gap-2">
                                    <Wallet size={16} /> Detalles de Pago
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-[var(--glass-bg)] p-3 rounded-lg">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Tipo de Pago</p>
                                        <p className="text-lg font-bold text-[var(--color-text)]">
                                            {selectedPurchase.is_credit ? (
                                                <span className="flex items-center gap-1 text-orange-400">
                                                    <CreditCard size={16} /> Crédito
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-blue-400">
                                                    <Wallet size={16} /> Contado
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="bg-[var(--glass-bg)] p-3 rounded-lg">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Total Factura</p>
                                        <p className="text-lg font-bold text-[var(--color-primary)]">
                                            {formatCurrency(selectedPurchase.total, currentCurrency)}
                                        </p>
                                    </div>
                                    <div className="bg-[var(--glass-bg)] p-3 rounded-lg">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Monto Pagado</p>
                                        <p className="text-lg font-bold text-green-400">
                                            {formatCurrency(selectedPurchase.amount_paid || 0, currentCurrency)}
                                        </p>
                                    </div>
                                    <div className="bg-[var(--glass-bg)] p-3 rounded-lg">
                                        <p className="text-xs text-[var(--color-text-muted)] uppercase mb-1">Saldo Pendiente</p>
                                        <p className="text-lg font-bold text-red-400">
                                            {formatCurrency((selectedPurchase.total || 0) - (selectedPurchase.amount_paid || 0), currentCurrency)}
                                        </p>
                                    </div>
                                </div>

                                {/* Credit Details if applicable */}
                                {selectedPurchase.is_credit && (
                                    <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <p className="text-xs text-[var(--color-text-muted)]">Días de Plazo</p>
                                                <p className="text-[var(--color-text)] font-semibold">{selectedPurchase.credit_days || 'N/A'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-[var(--color-text-muted)]">Fecha Vencimiento</p>
                                                <p className="text-[var(--color-text)] font-semibold">{selectedPurchase.expiry_date || 'N/A'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-[var(--color-text-muted)]">Método de Pago</p>
                                                <p className="text-[var(--color-text)] font-semibold">{selectedPurchase.payment_method || 'N/A'}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Payment Date if exists */}
                                {selectedPurchase.payment_date && (
                                    <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
                                        <p className="text-xs text-[var(--color-text-muted)]">Fecha de Pago</p>
                                        <p className="text-[var(--color-text)] font-semibold">{selectedPurchase.payment_date}</p>
                                    </div>
                                )}
                            </div>

                            {/* ===== PRODUCTOS ===== */}
                            {selectedPurchase.items && (
                                <div className="glass-card p-4">
                                    <h3 className="text-sm font-bold text-[var(--color-text)] uppercase mb-3">
                                        Productos de la Factura ({JSON.parse(selectedPurchase.items || '[]').length})
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead className="text-[var(--color-text-muted)] text-xs uppercase bg-[var(--glass-bg)]">
                                                <tr>
                                                    <th className="text-left py-2 px-3 rounded-l-lg">Producto</th>
                                                    <th className="text-right py-2 px-3">Cant.</th>
                                                    <th className="text-right py-2 px-3">Costo U.</th>
                                                    <th className="text-right py-2 px-3 rounded-r-lg">Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {JSON.parse(selectedPurchase.items || '[]').map((item, idx) => (
                                                    <tr key={idx}>
                                                        <td className="py-2 px-3 text-[var(--color-text)]">{item.name}</td>
                                                        <td className="py-2 px-3 text-right text-[var(--color-text-muted)]">{item.quantity}</td>
                                                        <td className="py-2 px-3 text-right text-[var(--color-text-muted)]">
                                                            {formatCurrency(item.cost, currentCurrency)}
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-semibold text-[var(--color-text)]">
                                                            {formatCurrency(item.quantity * item.cost, currentCurrency)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] shrink-0">
                            <button
                                onClick={closeDetailModal}
                                className="w-full py-3 bg-[var(--color-primary)] text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Full Screen Image Modal */}
            {showDocumentModal && selectedPurchase?.payment_document && (
                <div
                    className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
                    onClick={() => setShowDocumentModal(false)}
                >
                    <button
                        onClick={() => setShowDocumentModal(false)}
                        className="absolute top-4 right-4 p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                    <img
                        src={selectedPurchase.payment_document}
                        alt="Comprobante de pago - Vista completa"
                        className="max-w-full max-h-full object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};

export default InvoicePaymentsReport;
