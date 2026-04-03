import React, { useState, useEffect, useMemo } from 'react';
import { FileText, Trash2, ArrowLeft, Loader, Search, Calendar, DollarSign, CreditCard, Wallet, TrendingUp, AlertTriangle, ChevronDown, ChevronRight, X, Check, Eye, Paperclip } from 'lucide-react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrency } from '../utils/formatCurrency';

const Invoices = () => {
    const { fetchPurchases, fetchPurchaseDetails, deletePurchase, activeCompanyId, suppliers, currentCurrency } = useStore();
    const INVOICES_PAGE_SIZE = 15;

    const [invoices, setInvoices] = useState([]);
    const [allInvoicesForMetrics, setAllInvoicesForMetrics] = useState([]);
    const [invoiceView, setInvoiceView] = useState('list');
    const [activeTab, setActiveTab] = useState('invoices'); // 'invoices' | 'payables'
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [offset, setOffset] = useState(0);
    const [hasMoreInvoices, setHasMoreInvoices] = useState(true);

    // Filtros
    const [dateFrom, setDateFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [dateTo, setDateTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [activeQuickFilter, setActiveQuickFilter] = useState(0);
    const [supplierFilter, setSupplierFilter] = useState('');
    const [paymentTypeFilter, setPaymentTypeFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Cuentas por pagar
    const [expandedSuppliers, setExpandedSuppliers] = useState({});
    const [paymentModal, setPaymentModal] = useState({ open: false, invoice: null, supplier: null });
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentType, setPaymentType] = useState('full'); // 'full' | 'partial' | 'total'
    const [paymentMethod, setPaymentMethod] = useState('efectivo');
    const [paymentObservation, setPaymentObservation] = useState('');
    const [paymentDocument, setPaymentDocument] = useState(null);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);

    useEffect(() => {
        loadInvoices(0, true);
        loadInvoicesForMetrics();
    }, [activeCompanyId]);

    const loadInvoicesForMetrics = async () => {
        try {
            const result = await turso.execute({
                sql: `SELECT id, supplier_id, supplier_name, invoice_number, date, total, is_credit, status, amount_paid
                      FROM purchases
                      WHERE company_id = ?
                      ORDER BY date DESC`,
                args: [activeCompanyId]
            });
            setAllInvoicesForMetrics(result.rows || []);
        } catch (error) {
            console.error('Error loading invoices for metrics:', error);
            setAllInvoicesForMetrics([]);
        }
    };

    const loadInvoices = async (currentOffset, reset = false) => {
        if (isLoadingInvoices) return;
        if (!reset && !hasMoreInvoices) return;

        setIsLoadingInvoices(true);
        const fetched = await fetchPurchases(currentOffset, INVOICES_PAGE_SIZE);

        if (reset) {
            setInvoices(fetched);
            setOffset(currentOffset + fetched.length);
            setHasMoreInvoices(fetched.length === INVOICES_PAGE_SIZE);
        } else {
            setInvoices(prev => [...prev, ...fetched]);
            setOffset(currentOffset + fetched.length);
            if (fetched.length < INVOICES_PAGE_SIZE) {
                setHasMoreInvoices(false);
            }
        }
        setIsLoadingInvoices(false);
    };

    const handleInvoicesScroll = (e) => {
        if (invoiceView !== 'list') return;
        if (isLoadingInvoices || !hasMoreInvoices) return;

        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        const reachedBottom = scrollTop + clientHeight >= scrollHeight - 80;

        if (reachedBottom) {
            loadInvoices(offset);
        }
    };

    const applyInvoiceFilters = (sourceInvoices) => {
        return sourceInvoices.filter(inv => {
            if (dateFrom && inv.date < dateFrom) return false;
            if (dateTo && inv.date > dateTo) return false;
            if (supplierFilter && inv.supplier_id !== parseInt(supplierFilter)) return false;
            if (paymentTypeFilter === 'cash' && inv.is_credit) return false;
            if (paymentTypeFilter === 'credit' && !inv.is_credit) return false;
            if (searchQuery) {
                const search = searchQuery.toLowerCase();
                if (!String(inv.invoice_number || '').toLowerCase().includes(search) && !inv.supplier_name?.toLowerCase().includes(search)) return false;
            }
            return true;
        });
    };

    // Filtrar facturas para métricas (dataset completo)
    const filteredInvoices = useMemo(() => {
        return applyInvoiceFilters(allInvoicesForMetrics);
    }, [allInvoicesForMetrics, dateFrom, dateTo, supplierFilter, paymentTypeFilter, searchQuery]);

    // Filtrar facturas visibles en tabla (dataset paginado)
    const visibleInvoices = useMemo(() => {
        return applyInvoiceFilters(invoices);
    }, [invoices, dateFrom, dateTo, supplierFilter, paymentTypeFilter, searchQuery]);

    // Calcular estadísticas
    const stats = useMemo(() => {
        const totalMes = filteredInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
        const totalCredito = filteredInvoices.filter(inv => inv.is_credit).reduce((sum, inv) => sum + (inv.total || 0), 0);
        const totalContado = filteredInvoices.filter(inv => !inv.is_credit).reduce((sum, inv) => sum + (inv.total || 0), 0);
        return { totalMes, totalCredito, totalContado, cantidadFacturas: filteredInvoices.length };
    }, [filteredInvoices]);

    // Estadísticas por mes
    const monthlyStats = useMemo(() => {
        const months = [];
        for (let i = 0; i < 6; i++) {
            const monthDate = subMonths(new Date(), i);
            const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd');
            const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd');
            const monthName = format(monthDate, 'MMM yyyy', { locale: es });
            const monthInvoices = allInvoicesForMetrics.filter(inv => inv.date >= monthStart && inv.date <= monthEnd);
            months.push({
                month: monthName,
                total: monthInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0),
                credit: monthInvoices.filter(inv => inv.is_credit).reduce((sum, inv) => sum + (inv.total || 0), 0),
                cash: monthInvoices.filter(inv => !inv.is_credit).reduce((sum, inv) => sum + (inv.total || 0), 0)
            });
        }
        return months.reverse();
    }, [allInvoicesForMetrics]);

    // Facturas pendientes por proveedor
    const pendingBySupplier = useMemo(() => {
        const pending = allInvoicesForMetrics.filter(inv => inv.is_credit && inv.status !== 'paid');
        const grouped = {};
        pending.forEach(inv => {
            const key = inv.supplier_id || 'unknown';
            if (!grouped[key]) {
                grouped[key] = { id: key, name: inv.supplier_name || 'Sin proveedor', invoices: [], total: 0, paid: 0 };
            }
            const balance = (inv.total || 0) - (inv.amount_paid || 0);
            grouped[key].invoices.push({ ...inv, balance });
            grouped[key].total += inv.total || 0;
            grouped[key].paid += inv.amount_paid || 0;
        });
        return Object.values(grouped).filter(s => s.total - s.paid > 0);
    }, [allInvoicesForMetrics]);

    const totalPendingAmount = useMemo(() => {
        return pendingBySupplier.reduce((sum, s) => sum + (s.total - s.paid), 0);
    }, [pendingBySupplier]);

    const handleInvoiceClick = async (invoiceId) => {
        setIsLoadingDetails(true);
        const details = await fetchPurchaseDetails(invoiceId);
        if (details) {
            setSelectedInvoice(details);
            setInvoiceView('detail');
        }
        setIsLoadingDetails(false);
    };

    const handleBackToInvoices = () => {
        setSelectedInvoice(null);
        setInvoiceView('list');
    };

    const handleDeleteInvoice = async (e, id) => {
        e.stopPropagation();
        if (window.confirm('¿Estás seguro de eliminar esta factura?')) {
            await deletePurchase(id);
            loadInvoices(0, true);
            loadInvoicesForMetrics();
            if (selectedInvoice?.id === id) handleBackToInvoices();
        }
    };

    const handleQuickFilter = (months) => {
        const now = new Date();
        setDateFrom(format(startOfMonth(months === 0 ? now : subMonths(now, months)), 'yyyy-MM-dd'));
        setDateTo(format(endOfMonth(now), 'yyyy-MM-dd'));
        setActiveQuickFilter(months);
    };

    const toggleSupplier = (id) => {
        setExpandedSuppliers(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const openPaymentModal = (invoice, supplier, type = 'full') => {
        setPaymentModal({ open: true, invoice, supplier });
        setPaymentType(type);
        setPaymentAmount(type === 'full' ? String(invoice?.balance || 0) : '');
        setPaymentMethod('efectivo');
        setPaymentObservation('');
        setPaymentDocument(null);
    };

    const closePaymentModal = () => {
        setPaymentModal({ open: false, invoice: null, supplier: null });
        setPaymentAmount('');
        setPaymentObservation('');
        setPaymentDocument(null);
    };

    const handlePayment = async () => {
        if (!paymentModal.invoice && paymentType !== 'total') return;
        setIsProcessingPayment(true);

        try {
            if (paymentType === 'total') {
                // Pagar todas las facturas del proveedor
                for (const inv of paymentModal.supplier.invoices) {
                    await turso.execute({
                        sql: `UPDATE purchases SET amount_paid = total, status = 'paid', payment_date = ? WHERE id = ?`,
                        args: [format(new Date(), 'yyyy-MM-dd'), inv.id]
                    });
                }
            } else {
                const amount = parseFloat(paymentAmount) || 0;
                const newPaid = (paymentModal.invoice.amount_paid || 0) + amount;
                const isPaidFull = newPaid >= paymentModal.invoice.total;

                await turso.execute({
                    sql: `UPDATE purchases SET amount_paid = ?, status = ?, payment_date = ? WHERE id = ?`,
                    args: [newPaid, isPaidFull ? 'paid' : 'partial', format(new Date(), 'yyyy-MM-dd'), paymentModal.invoice.id]
                });
            }

            await loadInvoices(0, true);
            await loadInvoicesForMetrics();
            closePaymentModal();
        } catch (error) {
            console.error('Error processing payment:', error);
            alert('Error al procesar el pago: ' + error.message);
        }

        setIsProcessingPayment(false);
    };

    // Render Invoices List View
    const renderInvoicesList = () => (
        <>
            {/* Filtros */}
            <div className="glass-card p-4 shrink-0">
                <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2">
                            <Calendar size={16} className="text-[var(--color-text-muted)]" />
                            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActiveQuickFilter(null); }} className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none" />
                            <span className="text-[var(--color-text-muted)]">-</span>
                            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActiveQuickFilter(null); }} className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none" />
                        </div>
                        <div className="flex gap-1">
                            {[{ l: 'Este mes', v: 0 }, { l: '3 meses', v: 2 }, { l: '6 meses', v: 5 }].map(b => (
                                <button key={b.l} onClick={() => handleQuickFilter(b.v)} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${activeQuickFilter === b.v ? 'bg-[var(--color-primary)] text-white' : 'bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)]'}`}>{b.l}</button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2">
                        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none min-w-[150px]">
                            <option value="">Todos los proveedores</option>
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-1">
                        {[{ l: 'Todos', v: 'all', c: '' }, { l: 'Contado', v: 'cash', c: 'green' }, { l: 'Crédito', v: 'credit', c: 'orange' }].map(b => (
                            <button key={b.v} onClick={() => setPaymentTypeFilter(b.v)} className={`px-3 py-1.5 text-xs rounded-md transition-colors ${paymentTypeFilter === b.v ? (b.c ? `bg-${b.c}-500/20 text-${b.c}-400` : 'bg-[var(--color-primary)] text-white') : 'text-[var(--color-text-muted)]'}`}>
                                {b.v === 'cash' && <Wallet size={14} className="inline mr-1" />}
                                {b.v === 'credit' && <CreditCard size={14} className="inline mr-1" />}
                                {b.l}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2 flex-1 lg:max-w-xs">
                        <Search size={16} className="text-[var(--color-text-muted)]" />
                        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar..." className="bg-transparent text-[var(--color-text)] text-sm focus:outline-none flex-1" />
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
                {[
                    { label: 'Compras Período', value: stats.totalMes, color: 'blue', icon: TrendingUp, sub: `${stats.cantidadFacturas} facturas` },
                    { label: 'Compras Contado', value: stats.totalContado, color: 'green', icon: Wallet, sub: `${filteredInvoices.filter(i => !i.is_credit).length} facturas` },
                    { label: 'Compras Crédito', value: stats.totalCredito, color: 'orange', icon: CreditCard, sub: `${filteredInvoices.filter(i => i.is_credit).length} facturas` },
                    { label: 'Promedio Mensual', value: monthlyStats.reduce((s, m) => s + m.total, 0) / 6, color: 'purple', icon: DollarSign, sub: 'Últimos 6 meses' }
                ].map((s, i) => (
                    <div key={i} className="glass-card p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`p-2 rounded-lg bg-${s.color}-500/20`}><s.icon size={20} className={`text-${s.color}-400`} /></div>
                            <div>
                                <p className="text-xs text-[var(--color-text-muted)] uppercase">{s.label}</p>
                                <p className={`text-xl font-bold text-${s.color}-400`}>{formatCurrency(s.value, currentCurrency)}</p>
                            </div>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">{s.sub}</p>
                    </div>
                ))}
            </div>

            {/* Monthly Summary */}
            <div className="glass-card p-4 shrink-0 overflow-x-auto">
                <h3 className="text-sm font-bold text-[var(--color-text)] mb-3">Resumen por Mes</h3>
                <div className="flex gap-4 min-w-max">
                    {monthlyStats.map((m, idx) => (
                        <div key={idx} className="bg-[var(--color-surface)] rounded-lg p-3 min-w-[140px]">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase mb-2">{m.month}</p>
                            <p className="text-lg font-bold text-[var(--color-text)]">{formatCurrency(m.total, currentCurrency)}</p>
                            <p className="text-[10px] text-green-400">Contado: {formatCurrency(m.cash, currentCurrency)}</p>
                            <p className="text-[10px] text-orange-400">Crédito: {formatCurrency(m.credit, currentCurrency)}</p>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );

    // Render Payables View
    const renderPayablesView = () => (
        <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-card p-4 border-l-4 border-red-500">
                    <p className="text-xs text-[var(--color-text-muted)]">Total por Pagar</p>
                    <p className="text-2xl font-bold text-red-400">{formatCurrency(totalPendingAmount, currentCurrency)}</p>
                </div>
                <div className="glass-card p-4 border-l-4 border-orange-500">
                    <p className="text-xs text-[var(--color-text-muted)]">Proveedores con Deuda</p>
                    <p className="text-2xl font-bold text-orange-400">{pendingBySupplier.length}</p>
                </div>
                <div className="glass-card p-4 border-l-4 border-yellow-500">
                    <p className="text-xs text-[var(--color-text-muted)]">Facturas Pendientes</p>
                    <p className="text-2xl font-bold text-yellow-400">{pendingBySupplier.reduce((s, p) => s + p.invoices.length, 0)}</p>
                </div>
            </div>

            {/* Suppliers List */}
            <div className="glass-card p-0 overflow-hidden">
                {pendingBySupplier.length === 0 ? (
                    <div className="p-10 text-center text-[var(--color-text-muted)]">
                        <Check size={48} className="mx-auto mb-4 text-green-400" />
                        <p>¡No tienes cuentas pendientes por pagar!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--glass-border)]">
                        {pendingBySupplier.map(supplier => (
                            <div key={supplier.id}>
                                {/* Supplier Header */}
                                <div onClick={() => toggleSupplier(supplier.id)} className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5">
                                    <div className="flex items-center gap-3">
                                        {expandedSuppliers[supplier.id] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                        <div>
                                            <h3 className="font-bold text-[var(--color-text)]">{supplier.name}</h3>
                                            <p className="text-xs text-[var(--color-text-muted)]">{supplier.invoices.length} facturas pendientes</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <p className="text-xs text-[var(--color-text-muted)]">Saldo pendiente</p>
                                            <p className="text-lg font-bold text-red-400">{formatCurrency(supplier.total - supplier.paid, currentCurrency)}</p>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); openPaymentModal(null, supplier, 'total'); }} className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm font-semibold hover:bg-green-500/30">
                                            Pagar Todo
                                        </button>
                                    </div>
                                </div>

                                {/* Invoices List */}
                                {expandedSuppliers[supplier.id] && (
                                    <div className="bg-[var(--color-surface)] border-t border-[var(--glass-border)]">
                                        <table className="w-full text-sm">
                                            <thead className="text-[var(--color-text-muted)] text-xs uppercase">
                                                <tr>
                                                    <th className="px-4 py-2 text-left">N° Factura</th>
                                                    <th className="px-4 py-2 text-left">Fecha</th>
                                                    <th className="px-4 py-2 text-left">Vencimiento</th>
                                                    <th className="px-4 py-2 text-right">Total</th>
                                                    <th className="px-4 py-2 text-right">Pagado</th>
                                                    <th className="px-4 py-2 text-right">Saldo</th>
                                                    <th className="px-4 py-2 text-right">Acciones</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {supplier.invoices.map(inv => (
                                                    <tr key={inv.id} onClick={() => handleInvoiceClick(inv.id)} className="hover:bg-white/5 cursor-pointer">
                                                        <td className="px-4 py-3 text-[var(--color-text)]">
                                                            <FileText size={14} className="inline mr-2 text-[var(--color-primary)]" />
                                                            {inv.invoice_number || 'S/N'}
                                                        </td>
                                                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{inv.date ? format(new Date(inv.date + 'T00:00:00'), 'dd/MM/yy') : '-'}</td>
                                                        <td className="px-4 py-3">
                                                            {inv.expiry_date ? (
                                                                <span className={new Date(inv.expiry_date) < new Date() ? 'text-red-400' : 'text-[var(--color-text-muted)]'}>
                                                                    {format(new Date(inv.expiry_date + 'T00:00:00'), 'dd/MM/yy')}
                                                                    {new Date(inv.expiry_date) < new Date() && <AlertTriangle size={12} className="inline ml-1" />}
                                                                </span>
                                                            ) : '-'}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-[var(--color-text)]">{formatCurrency(inv.total, currentCurrency)}</td>
                                                        <td className="px-4 py-3 text-right text-green-400">{formatCurrency(inv.amount_paid || 0, currentCurrency)}</td>
                                                        <td className="px-4 py-3 text-right font-bold text-red-400">{formatCurrency(inv.balance, currentCurrency)}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="flex gap-1 justify-end">
                                                                <button onClick={(e) => { e.stopPropagation(); handleInvoiceClick(inv.id); }} className="px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded text-xs hover:bg-cyan-500/30" title="Ver detalle">
                                                                    <Eye size={14} />
                                                                </button>
                                                                <button onClick={(e) => { e.stopPropagation(); openPaymentModal(inv, supplier, 'full'); }} className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30">Pagar</button>
                                                                <button onClick={(e) => { e.stopPropagation(); openPaymentModal(inv, supplier, 'partial'); }} className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs hover:bg-blue-500/30">Abono</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="space-y-6 min-h-[calc(100vh-6rem)] flex flex-col">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-text)]">Facturas</h1>
                    <p className="text-[var(--color-text-muted)] text-sm">Gestión de facturas y cuentas por pagar</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setActiveTab('invoices')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'invoices' ? 'bg-[var(--color-primary)] text-white' : 'bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'}`}>
                        <FileText size={16} className="inline mr-2" />Facturas
                    </button>
                    <button onClick={() => setActiveTab('payables')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${activeTab === 'payables' ? 'bg-red-500 text-white' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}>
                        <AlertTriangle size={16} />Cuentas por Pagar
                        {totalPendingAmount > 0 && <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs">{formatCurrency(totalPendingAmount, currentCurrency)}</span>}
                    </button>
                </div>
            </div>

            {activeTab === 'invoices' && invoiceView === 'list' && renderInvoicesList()}
            {activeTab === 'payables' && renderPayablesView()}

            {/* Invoice Table */}
            {activeTab === 'invoices' && (
                <div className="glass-card overflow-hidden p-0 flex flex-col relative h-[60vh] min-h-[360px] max-h-[70vh]">
                    {invoiceView === 'list' && (
                        <div className="flex-1 overflow-y-auto" onScroll={handleInvoicesScroll}>
                            {isLoadingInvoices && invoices.length === 0 ? (
                                <div className="flex items-center justify-center h-full"><Loader className="animate-spin text-[var(--color-primary)]" size={32} /></div>
                            ) : (
                                <>
                                    <table className="w-full text-left">
                                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-sm font-semibold sticky top-0 z-10">
                                            <tr>
                                                <th className="px-6 py-4">N° Factura</th>
                                                <th className="px-6 py-4">Proveedor</th>
                                                <th className="px-6 py-4">Fecha</th>
                                                <th className="px-6 py-4">Estado</th>
                                                <th className="px-6 py-4 text-right">Total</th>
                                                <th className="px-6 py-4 text-right">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--glass-border)]">
                                            {filteredInvoices.map(inv => (
                                                <tr key={inv.id} onClick={() => handleInvoiceClick(inv.id)} className="hover:bg-[var(--glass-bg)] cursor-pointer group">
                                                    <td className="px-6 py-4 text-[var(--color-text)] font-medium"><FileText size={16} className="inline mr-2 text-[var(--color-primary)]" />{inv.invoice_number || 'S/N'}</td>
                                                    <td className="px-6 py-4 text-[var(--color-text-muted)]">{inv.supplier_name || 'Desconocido'}</td>
                                                    <td className="px-6 py-4 text-[var(--color-text-muted)]">{inv.date ? format(new Date(inv.date + 'T00:00:00'), 'dd/MM/yyyy') : '-'}</td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2 py-1 rounded text-xs font-bold ${inv.is_credit ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
                                                            {inv.is_credit ? 'CRÉDITO' : 'PAGADO'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-[var(--color-text)] font-bold">{formatCurrency(inv.total, currentCurrency)}</td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button onClick={(e) => handleDeleteInvoice(e, inv.id)} className="p-2 hover:bg-[var(--color-surface-hover)] rounded text-red-400 opacity-0 group-hover:opacity-100"><Trash2 size={20} /></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {isLoadingInvoices && invoices.length > 0 && (
                                        <div className="py-4 flex items-center justify-center text-[var(--color-text-muted)] text-sm gap-2">
                                            <Loader size={16} className="animate-spin" />
                                            Cargando más facturas...
                                        </div>
                                    )}

                                    {!isLoadingInvoices && !hasMoreInvoices && filteredInvoices.length > 0 && (
                                        <div className="py-4 text-center text-[var(--color-text-muted)] text-sm border-t border-[var(--glass-border)]">
                                            No hay más facturas para mostrar
                                        </div>
                                    )}
                                </>
                            )}
                            {filteredInvoices.length === 0 && !isLoadingInvoices && <div className="p-10 text-center text-[var(--color-text-muted)]">No se encontraron facturas.</div>}
                        </div>
                    )}
                </div>
            )}

            {/* Invoice Detail Modal */}
            {invoiceView === 'detail' && selectedInvoice && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-3xl max-h-[90vh] border border-[var(--glass-border)] flex flex-col overflow-hidden">
                        {/* Modal Header */}
                        <div className="p-4 border-b border-[var(--glass-border)] flex items-center gap-4 bg-[var(--glass-bg)] shrink-0">
                            <button onClick={handleBackToInvoices} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
                            <div className="flex-1">
                                <h2 className="text-xl font-bold text-[var(--color-text)]">Factura #{selectedInvoice.invoice_number || 'S/N'}</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">{selectedInvoice.supplier_name} | {selectedInvoice.date}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-[var(--color-text-muted)]">Total</p>
                                <p className="text-2xl font-bold text-[var(--color-primary)]">{formatCurrency(selectedInvoice.total, currentCurrency)}</p>
                            </div>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-auto p-6">
                            <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">Productos</h3>
                            <div className="glass-card p-0 overflow-hidden">
                                <table className="w-full">
                                    <thead className="text-[var(--color-text-muted)] text-sm uppercase bg-[var(--glass-bg)]">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Producto</th>
                                            <th className="px-4 py-3 text-right">Cant.</th>
                                            <th className="px-4 py-3 text-right">Costo</th>
                                            <th className="px-4 py-3 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedInvoice.items?.map((item, idx) => (
                                            <tr key={idx} className="border-t border-[var(--glass-border)]">
                                                <td className="px-4 py-3 text-[var(--color-text)]">{item.name}</td>
                                                <td className="px-4 py-3 text-right text-[var(--color-text)]">{item.quantity}</td>
                                                <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">{formatCurrency(item.cost, currentCurrency)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-[var(--color-text)]">{formatCurrency(item.quantity * item.cost, currentCurrency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Payment Info */}
                            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="glass-card p-4">
                                    <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">Pago</h4>
                                    <p className="text-[var(--color-text)]">Método: {selectedInvoice.payment_method || 'N/A'}</p>
                                    <p className="text-[var(--color-text)]">Tipo: {selectedInvoice.is_credit ? 'Crédito' : 'Contado'}</p>
                                </div>
                                {selectedInvoice.is_credit && (
                                    <div className="glass-card p-4">
                                        <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">Crédito</h4>
                                        <p className="text-[var(--color-text)]">Días plazo: {selectedInvoice.credit_days || 'N/A'}</p>
                                        <p className="text-[var(--color-text)]">Vencimiento: {selectedInvoice.expiry_date || 'N/A'}</p>
                                        <p className="text-[var(--color-text)]">Pagado: {formatCurrency(selectedInvoice.amount_paid || 0, currentCurrency)}</p>
                                    </div>
                                )}
                                <div className="glass-card p-4">
                                    <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">Registro</h4>
                                    <p className="text-[var(--color-text-muted)]">ID: {selectedInvoice.id}</p>
                                    <p className="text-[var(--color-text-muted)]">Estado: {selectedInvoice.status || 'N/A'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] shrink-0">
                            {selectedInvoice.is_credit && selectedInvoice.status !== 'paid' ? (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => {
                                            const supplier = suppliers.find(s => s.id === selectedInvoice.supplier_id) || { id: selectedInvoice.supplier_id, name: selectedInvoice.supplier_name };
                                            const invoiceWithBalance = { ...selectedInvoice, balance: (selectedInvoice.total || 0) - (selectedInvoice.amount_paid || 0) };
                                            handleBackToInvoices();
                                            openPaymentModal(invoiceWithBalance, supplier, 'partial');
                                        }}
                                        className="flex-1 py-3 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg font-semibold hover:bg-blue-500/30 transition-colors"
                                    >
                                        Abonar
                                    </button>
                                    <button
                                        onClick={() => {
                                            const supplier = suppliers.find(s => s.id === selectedInvoice.supplier_id) || { id: selectedInvoice.supplier_id, name: selectedInvoice.supplier_name };
                                            const invoiceWithBalance = { ...selectedInvoice, balance: (selectedInvoice.total || 0) - (selectedInvoice.amount_paid || 0) };
                                            handleBackToInvoices();
                                            openPaymentModal(invoiceWithBalance, supplier, 'full');
                                        }}
                                        className="flex-1 py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-colors"
                                    >
                                        Pagar Todo
                                    </button>
                                </div>
                            ) : (
                                <button onClick={handleBackToInvoices} className="w-full py-3 bg-[var(--color-primary)] text-white rounded-lg font-semibold hover:opacity-90 transition-opacity">
                                    Cerrar
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Payment Modal */}
            {paymentModal.open && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md border border-[var(--glass-border)]">
                        <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center">
                            <h2 className="text-lg font-bold">Registrar Pago</h2>
                            <button onClick={closePaymentModal} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="glass-card p-4">
                                <p className="text-sm text-[var(--color-text-muted)]">Proveedor</p>
                                <p className="font-bold text-[var(--color-text)]">{paymentModal.supplier?.name}</p>
                                {paymentModal.invoice && (
                                    <>
                                        <p className="text-sm text-[var(--color-text-muted)] mt-2">Factura #{paymentModal.invoice.invoice_number || 'S/N'}</p>
                                        <p className="text-lg font-bold text-red-400">Saldo: {formatCurrency(paymentModal.invoice.balance, currentCurrency)}</p>
                                    </>
                                )}
                                {paymentType === 'total' && (
                                    <p className="text-lg font-bold text-red-400 mt-2">Total a pagar: {formatCurrency(paymentModal.supplier.total - paymentModal.supplier.paid, currentCurrency)}</p>
                                )}
                            </div>

                            {paymentType !== 'total' && (
                                <div>
                                    <label className="text-sm text-[var(--color-text-muted)]">Monto a pagar</label>
                                    <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full mt-1 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-4 py-3 text-xl font-bold text-[var(--color-text)]" />
                                    {paymentType === 'partial' && (
                                        <div className="flex gap-2 mt-2">
                                            {[25, 50, 75, 100].map(p => (
                                                <button key={p} onClick={() => setPaymentAmount(String((paymentModal.invoice.balance * p) / 100))} className="px-3 py-1 bg-white/5 rounded text-xs hover:bg-white/10">{p}%</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="text-sm text-[var(--color-text-muted)]">Método de pago</label>
                                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full mt-1 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-4 py-3 text-[var(--color-text)]">
                                    <option value="efectivo">Efectivo</option>
                                    <option value="transferencia">Transferencia</option>
                                    <option value="cheque">Cheque</option>
                                    <option value="tarjeta">Tarjeta</option>
                                </select>
                            </div>

                            {/* Observación */}
                            <div>
                                <label className="text-sm text-[var(--color-text-muted)]">Observación (opcional)</label>
                                <textarea
                                    value={paymentObservation}
                                    onChange={(e) => setPaymentObservation(e.target.value)}
                                    placeholder="Notas adicionales sobre el pago..."
                                    className="w-full mt-1 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-4 py-3 text-[var(--color-text)] resize-none h-20"
                                />
                            </div>

                            {/* Documento de respaldo */}
                            <div>
                                <label className="text-sm text-[var(--color-text-muted)]">Comprobante (opcional)</label>
                                <div className="mt-1">
                                    <label className="flex items-center gap-3 justify-center w-full py-3 bg-[var(--color-surface)] border border-dashed border-[var(--glass-border)] rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                                        <Paperclip size={18} className="text-[var(--color-text-muted)]" />
                                        <span className="text-sm text-[var(--color-text-muted)]">
                                            {paymentDocument ? paymentDocument.name : 'Adjuntar imagen o documento'}
                                        </span>
                                        <input
                                            type="file"
                                            accept="image/*,.pdf"
                                            onChange={(e) => setPaymentDocument(e.target.files?.[0] || null)}
                                            className="hidden"
                                        />
                                    </label>
                                    {paymentDocument && (
                                        <div className="flex items-center justify-between mt-2 p-2 bg-green-500/10 rounded-lg">
                                            <span className="text-xs text-green-400 truncate flex-1">{paymentDocument.name}</span>
                                            <button onClick={() => setPaymentDocument(null)} className="p-1 hover:bg-white/10 rounded">
                                                <X size={14} className="text-red-400" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button onClick={handlePayment} disabled={isProcessingPayment} className="w-full py-3 bg-green-500 text-white rounded-lg font-bold hover:bg-green-600 disabled:opacity-50">
                                {isProcessingPayment ? 'Procesando...' : 'Confirmar Pago'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Invoices;
