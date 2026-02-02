import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Search, Calendar, CreditCard, User, Download, Send, Trash2, Printer, AlertTriangle, FileText, X } from 'lucide-react';
import { formatMoney, generateReceiptPDF, generateWhatsAppLink } from '../utils/receipt';
import { formatInCompanyTime } from '../lib/dateHelpers';

const SalesHistory = () => {
    const { sales, users, cancelSale, currentUser, currentCompanyTimezone, fetchSales, fetchSaleDetails } = useStore();
    const [selectedSale, setSelectedSale] = useState(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    // Default to today (YYYY-MM-DD)
    const todayStr = new Date().toLocaleDateString('en-CA');
    const [dateFrom, setDateFrom] = useState(todayStr);
    const [dateTo, setDateTo] = useState(todayStr);
    const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
    const [sellerFilter, setSellerFilter] = useState('');
    const [saleIdFilter, setSaleIdFilter] = useState('');

    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Refs
    const listContainerRef = useRef(null);
    const dateFromRef = useRef(null);
    const dateToRef = useRef(null);

    // WhatsApp Phone State
    const [showPhoneInput, setShowPhoneInput] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancellationReason, setCancellationReason] = useState('');

    // Fetch Initial Data on Date Change
    React.useEffect(() => {
        const loadInitial = async () => {
            setOffset(0);
            setHasMore(true);
            // Pass all filters: dateFrom, dateTo, offset, limit, paymentMethod, sellerId, saleId
            const count = await fetchSales(dateFrom, dateTo, 0, 30, paymentMethodFilter, sellerFilter, saleIdFilter);
            if (count < 30) setHasMore(false);
        };
        loadInitial();
    }, [dateFrom, dateTo, paymentMethodFilter, sellerFilter, saleIdFilter]);

    // Infinite Scroll Handler
    const handleScroll = async (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 50 && hasMore && !isLoadingMore) {
            setIsLoadingMore(true);
            const nextOffset = offset + 30;
            const count = await fetchSales(dateFrom, dateTo, nextOffset, 30, paymentMethodFilter, sellerFilter, saleIdFilter);
            setOffset(nextOffset);
            if (count < 30) setHasMore(false);
            setIsLoadingMore(false);
        }
    };

    const handleSelectSale = async (sale) => {
        if (!sale) return;

        // Optimistic selection (show what we have)
        setSelectedSale(sale);

        // Check if we have details
        if (!sale.items) {
            setIsLoadingDetails(true);
            const fullDetails = await fetchSaleDetails(sale.id);
            if (fullDetails) {
                setSelectedSale(fullDetails);
            }
            setIsLoadingDetails(false);
        }
    };

    // Calculate totals from CURRENTLY LOADED sales (Note: this is only what's viewed, not DB total)
    // For proper totals, we might need a separate endpoint, but for now summing loaded is okay-ish 
    const totalSales = sales.reduce((acc, curr) => acc + (curr.status === 'cancelled' ? 0 : curr.total), 0);
    const totalCount = sales.filter(s => s.status !== 'cancelled').length;

    const handleDownloadPDF = () => {
        if (!selectedSale || !selectedSale.items) return; // Guard against missing details
        const seller = users.find(u => u.id === selectedSale.user_id);
        const pdfBlob = generateReceiptPDF(selectedSale, seller);
        const url = window.URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `boleta_${selectedSale.id}.pdf`;
        link.click();
        window.URL.revokeObjectURL(url);
    };

    const handleWhatsAppClick = () => {
        setShowPhoneInput(true);
    };

    const confirmWhatsAppShare = () => {
        if (!selectedSale || phoneNumber.length < 8) return;
        const seller = users.find(u => u.id === selectedSale.user_id);
        const link = generateWhatsAppLink(phoneNumber, selectedSale, seller);
        window.open(link, '_blank');
        setShowPhoneInput(false);
        setPhoneNumber('');
    };

    const handleCancelSale = () => {
        if (!selectedSale || selectedSale.status === 'cancelled') return;
        setShowCancelModal(true);
    };

    const confirmCancellation = async () => {
        if (!selectedSale || !cancellationReason.trim()) return;

        const success = await cancelSale(selectedSale.id, cancellationReason);
        if (success) {
            setSelectedSale(prev => ({ ...prev, status: 'cancelled', observation: cancellationReason }));
            setShowCancelModal(false);
            setCancellationReason('');
        } else {
            alert('Error al anular la venta');
        }
    };

    const getSellerName = (userId) => {
        const user = users.find(u => u.id === userId);
        return user ? user.name : 'Desconocido';
    };

    return (
        <div className="h-full flex flex-col gap-3 lg:gap-4 p-4 lg:p-0">
            {/* Top Stats / Header - Compact on Mobile */}
            <div className="shrink-0">
                <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)]">Historial de Ventas</h1>
                <p className="text-[var(--color-text-muted)] text-xs lg:text-sm">Gestiona y revisa todas tus transacciones.</p>
            </div>

            {/* Filters Bar - Horizontal Scroll on Mobile */}
            <div className="glass p-3 lg:p-4 rounded-xl overflow-x-auto shrink-0">
                <div className="flex gap-2 lg:gap-4 items-center min-w-max">
                    {/* Date From */}
                    <div
                        className="relative group active:translate-y-0.5 transition-all"
                        onClick={() => dateFromRef.current?.showPicker()}
                    >
                        <div className="flex items-center gap-1.5 bg-[var(--glass-bg)] text-[var(--color-text)] px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl border-b-2 lg:border-b-4 border-black/50 cursor-pointer shadow-lg text-xs lg:text-sm font-bold">
                            <Calendar size={14} className="text-[var(--color-primary)]" />
                            <span className="truncate">
                                {dateFrom ? new Date(dateFrom + 'T00:00').toLocaleDateString('es-CL') : 'Desde'}
                            </span>
                        </div>
                        <input
                            ref={dateFromRef}
                            type="date"
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer pointer-events-none"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                        />
                    </div>

                    <span className="text-[var(--color-text-muted)] text-xs">-</span>

                    {/* Date To */}
                    <div
                        className="relative group active:translate-y-0.5 transition-all"
                        onClick={() => dateToRef.current?.showPicker()}
                    >
                        <div className="flex items-center gap-1.5 bg-[var(--glass-bg)] text-[var(--color-text)] px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl border-b-2 lg:border-b-4 border-black/50 cursor-pointer shadow-lg text-xs lg:text-sm font-bold">
                            <Calendar size={14} className="text-[var(--color-primary)]" />
                            <span className="truncate">
                                {dateTo ? new Date(dateTo + 'T00:00').toLocaleDateString('es-CL') : 'Hasta'}
                            </span>
                        </div>
                        <input
                            ref={dateToRef}
                            type="date"
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer pointer-events-none"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                        />
                    </div>

                    {/* Seller Filter */}
                    <div className="flex items-center gap-1.5 bg-[var(--glass-bg)] text-[var(--color-text)] px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl border-b-2 lg:border-b-4 border-black/50 cursor-pointer shadow-lg text-xs lg:text-sm font-bold">
                        <User size={14} className="text-[var(--color-primary)]" />
                        <select
                            className="bg-transparent border-none outline-none cursor-pointer appearance-none text-xs lg:text-sm font-bold"
                            value={sellerFilter}
                            onChange={(e) => setSellerFilter(e.target.value)}
                        >
                            <option value="" className="bg-[var(--color-surface)]">Todos los Vendedores</option>
                            {users.map(user => (
                                <option key={user.id} value={user.id} className="bg-[var(--color-surface)]">
                                    {user.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Payment Method Filter */}
                    <div className="flex items-center gap-1.5 bg-[var(--glass-bg)] text-[var(--color-text)] px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl border-b-2 lg:border-b-4 border-black/50 cursor-pointer shadow-lg text-xs lg:text-sm font-bold">
                        <CreditCard size={14} className="text-[var(--color-primary)]" />
                        <select
                            className="bg-transparent border-none outline-none cursor-pointer appearance-none text-xs lg:text-sm font-bold"
                            value={paymentMethodFilter}
                            onChange={(e) => setPaymentMethodFilter(e.target.value)}
                        >
                            <option value="" className="bg-[var(--color-surface)]">Venta</option>
                            <option value="Efectivo" className="bg-[var(--color-surface)]">Efectivo</option>
                            <option value="Tarjeta" className="bg-[var(--color-surface)]">Tarjeta</option>
                            <option value="Transferencia" className="bg-[var(--color-surface)]">Transferencia</option>
                            <option value="Crédito" className="bg-[var(--color-surface)]">Crédito</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Sales List - Full width on Mobile, Split on Desktop */}
            <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
                {/* Sales List */}
                <div className="w-full lg:w-1/3 glass rounded-xl flex flex-col overflow-hidden border border-[var(--glass-border)]">
                    <div className="p-2 lg:p-3 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] font-semibold text-[var(--color-text-muted)] text-xs lg:text-sm">
                        Resultados ({sales.length})
                    </div>
                    <div
                        className="flex-1 overflow-y-auto pb-20 lg:pb-0"
                        onScroll={handleScroll}
                        ref={listContainerRef}
                    >
                        {sales.map(sale => (
                            <div
                                key={sale.id}
                                onClick={() => handleSelectSale(sale)}
                                className={`p-3 lg:p-4 border-b border-[var(--glass-border)] cursor-pointer transition-colors hover:bg-[var(--glass-bg)] ${selectedSale?.id === sale.id ? 'bg-[var(--color-primary)]/10 border-l-4 border-l-[var(--color-primary)]' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-mono text-sm text-[var(--color-text)]">#{sale.id}</span>
                                    <span className={`text-[10px] lg:text-xs px-2 py-0.5 rounded-full ${sale.status === 'cancelled' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                        }`}>
                                        {sale.status === 'cancelled' ? 'ANULADA' : 'COMPLETADA'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="font-bold text-green-400 text-base lg:text-lg">{formatMoney(sale.total)}</p>
                                        <p className="text-[10px] lg:text-xs text-[var(--color-text-muted)]">
                                            {formatInCompanyTime(sale.date, currentCompanyTimezone, 'dd-MM-yyyy HH:mm')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {isLoadingMore && (
                            <div className="p-4 text-center text-[var(--color-text-muted)] text-xs animate-pulse">
                                Cargando más ventas...
                            </div>
                        )}

                        {sales.length === 0 && !isLoadingMore && (
                            <div className="p-8 text-center text-[var(--color-text-muted)]">
                                No se encontraron ventas
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Details - Hidden on Mobile, becomes Modal */}
                <div className="hidden lg:flex w-2/3 glass rounded-xl flex-col overflow-hidden border border-[var(--glass-border)] relative">
                    {selectedSale ? (
                        isLoadingDetails && !selectedSale.items ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                                <span className="loading loading-spinner loading-lg text-[var(--color-primary)]"></span>
                                <p className="mt-4 text-sm">Cargando detalles...</p>
                            </div>
                        ) : (
                            <>
                                {/* Header details */}
                                <div className="p-6 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-start">
                                    <div>
                                        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-1">
                                            Venta #{selectedSale.id}
                                        </h2>
                                        <div className="text-sm text-[var(--color-text-muted)] flex gap-4">
                                            <span>{formatInCompanyTime(selectedSale.date, currentCompanyTimezone, 'dd/MM/yyyy HH:mm')}</span>
                                            <span>•</span>
                                            <span>Vendedor: {getSellerName(selectedSale.user_id)}</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-3xl font-bold text-[var(--color-primary)]">
                                            {formatMoney(selectedSale.total)}
                                        </div>
                                        <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold mt-2 ${selectedSale.status === 'cancelled' ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'
                                            }`}>
                                            {selectedSale.status === 'cancelled' ? 'ANULADA' : 'PAGADO'}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions Toolbar */}
                                <div className="p-3 border-b border-[var(--glass-border)] flex gap-2">
                                    <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] rounded-lg text-sm text-gray-200 transition-colors">
                                        <Download size={16} />
                                        Descargar PDF
                                    </button>
                                    <button onClick={handleWhatsAppClick} className="flex items-center gap-2 px-4 py-2 bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] rounded-lg text-sm transition-colors">
                                        <Send size={16} />
                                        Compartir WhatsApp
                                    </button>
                                    <div className="flex-1"></div>
                                    {selectedSale.status !== 'cancelled' && (
                                        <button onClick={handleCancelSale} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm transition-colors border border-red-500/20">
                                            <Trash2 size={16} />
                                            Anular Venta
                                        </button>
                                    )}
                                </div>

                                {/* Items Table */}
                                <div className="flex-1 overflow-y-auto p-6">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-[var(--glass-border)] text-[var(--color-text-muted)] text-sm">
                                                <th className="py-2">Producto</th>
                                                <th className="py-2 text-right">Cantidad</th>
                                                <th className="py-2 text-right">Precio Unit.</th>
                                                <th className="py-2 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedSale.items?.map((item, idx) => (
                                                <tr key={idx} className="border-b border-[var(--glass-border)] text-[var(--color-text-muted)] text-sm">
                                                    <td className="py-3">
                                                        <div className="font-medium text-[var(--color-text)]">{item.name}</div>
                                                        {item.sku && <div className="text-xs text-[var(--color-text-muted)]">{item.sku}</div>}
                                                    </td>
                                                    <td className="py-3 text-right text-[var(--color-text)] bg-[var(--glass-bg)] rounded w-16 text-center mx-auto" style={{ display: 'table-cell' }}>
                                                        <span className="px-2 py-1 rounded bg-[var(--glass-bg)]">{item.quantity}</span>
                                                    </td>
                                                    <td className="py-3 text-right">{formatMoney(item.price)}</td>
                                                    <td className="py-3 text-right font-bold text-[var(--color-text)]">{formatMoney(item.price * item.quantity)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {/* Totals Summary */}
                                    <div className="mt-8 flex justify-end">
                                        <div className="w-64 space-y-2">
                                            <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                                                <span>Subtotal</span>
                                                <span>{formatMoney(selectedSale.total)}</span>
                                            </div>
                                            <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                                                <span>Impuestos</span>
                                                <span>$0</span>
                                            </div>
                                            <div className="border-t border-[var(--glass-border)] pt-2 flex justify-between text-[var(--color-text)] font-bold text-lg">
                                                <span>Total</span>
                                                <span className="text-[var(--color-primary)]">{formatMoney(selectedSale.total)}</span>
                                            </div>

                                            <div className="mt-6 p-4 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                                                <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-2">Información de Pago</p>
                                                <div className="flex justify-between text-sm text-[var(--color-text-muted)] mb-1">
                                                    <span>Método</span>
                                                    <span className="capitalize">{selectedSale.paymentMethod}</span>
                                                </div>
                                                {selectedSale.paymentMethod === 'Efectivo' && selectedSale.paymentDetails && (
                                                    <>
                                                        <div className="flex justify-between text-sm text-[var(--color-text-muted)] mb-1">
                                                            <span>Pagado</span>
                                                            <span>{formatMoney(selectedSale.paymentDetails.amount || selectedSale.total)}</span>
                                                        </div>
                                                        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                                            <span>Vuelto</span>
                                                            <span>{formatMoney(selectedSale.paymentDetails.change || 0)}</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            {selectedSale.status === 'cancelled' && (
                                                <div className="mt-4 p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                                                    <p className="text-xs text-red-400 uppercase font-bold mb-2 flex items-center gap-2">
                                                        <AlertTriangle size={12} />
                                                        Motivo de Anulación
                                                    </p>
                                                    <p className="text-sm text-red-200 italic">
                                                        "{selectedSale.observation || 'Sin observación'}"
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* WhatsApp Phone Input Overlay */}
                                {showPhoneInput && (
                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                                        <div className="bg-[var(--color-surface)] dark:bg-[#0f0f2d] border border-white/20 p-6 rounded-2xl w-80 shadow-2xl animate-[float_0.3s_ease-out]">
                                            <div className="flex justify-between items-center mb-4">
                                                <h3 className="text-[var(--color-text)] font-bold">Enviar por WhatsApp</h3>
                                                <button onClick={() => setShowPhoneInput(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                                                    <X size={18} />
                                                </button>
                                            </div>
                                            <p className="text-xs text-[var(--color-text-muted)] mb-3">Ingrese el número de teléfono del cliente:</p>
                                            <div className="flex gap-2 mb-4">
                                                <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-[var(--color-text-muted)] text-sm flex items-center">
                                                    +56 9
                                                </div>
                                                <input
                                                    type="tel"
                                                    className="flex-1 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-[var(--color-text)] text-sm focus:border-[var(--color-primary)] focus:outline-none"
                                                    placeholder="12345678"
                                                    value={phoneNumber}
                                                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').substring(0, 8))}
                                                    autoFocus
                                                />
                                            </div>
                                            <button
                                                onClick={confirmWhatsAppShare}
                                                disabled={phoneNumber.length < 8}
                                                className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-[var(--color-text)] font-bold py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                <Send size={16} />
                                                Enviar Mensaje
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Cancellation Modal Overlay */}
                                {showCancelModal && (
                                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-20 flex items-center justify-center p-4">
                                        <div className="bg-[var(--color-surface)] dark:bg-[#0f0f2d] border border-red-500/20 p-6 rounded-2xl w-full max-w-md shadow-2xl animate-[float_0.3s_ease-out]">
                                            <div className="flex justify-between items-center mb-6">
                                                <h3 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                                                    <AlertTriangle className="text-red-500" size={24} />
                                                    Anular Venta
                                                </h3>
                                                <button
                                                    onClick={() => {
                                                        setShowCancelModal(false);
                                                        setCancellationReason('');
                                                    }}
                                                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                                >
                                                    <X size={20} />
                                                </button>
                                            </div>

                                            <div className="mb-6">
                                                <p className="text-[var(--color-text-muted)] text-sm mb-4">
                                                    ¿Está seguro de que desea anular esta venta? Esta acción restaurará el stock de los productos.
                                                </p>

                                                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">
                                                    Motivo de Anulación (Requerido)
                                                </label>
                                                <textarea
                                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-3 text-[var(--color-text)] text-sm focus:border-red-500/50 focus:outline-none resize-none h-24"
                                                    placeholder="Especifique la razón de la anulación..."
                                                    value={cancellationReason}
                                                    onChange={(e) => setCancellationReason(e.target.value)}
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => {
                                                        setShowCancelModal(false);
                                                        setCancellationReason('');
                                                    }}
                                                    className="flex-1 px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] rounded-lg text-sm font-bold transition-colors"
                                                >
                                                    Cancelar
                                                </button>
                                                <button
                                                    onClick={confirmCancellation}
                                                    disabled={!cancellationReason.trim()}
                                                    className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-[var(--color-text)] rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    <Trash2 size={16} />
                                                    Confirmar Anulación
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                            </>
                        )) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)] p-8">
                            <FileText size={64} className="mb-4 opacity-20" />
                            <h3 className="text-xl font-bold text-[var(--color-text-muted)] mb-2">Seleccione una venta</h3>
                            <p className="text-sm max-w-xs text-center">Haga clic en una transacción de la izquierda para ver su detalle, reimprimir o anular.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Sale Detail Modal - Only shown on mobile when sale is selected */}
            {selectedSale && (
                <div className="lg:hidden fixed inset-0 z-[9999] bg-[var(--color-background)] flex flex-col">
                    {/* Mobile Modal Header */}
                    <div className="p-4 bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                        <div className="flex justify-between items-start">
                            <div>
                                <h2 className="text-xl font-bold text-[var(--color-text)]">
                                    Venta #{selectedSale.id}
                                </h2>
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    {formatInCompanyTime(selectedSale.date, currentCompanyTimezone, 'dd/MM/yyyy HH:mm')} • Vendedor: {getSellerName(selectedSale.user_id)}
                                </p>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-bold text-[var(--color-primary)]">
                                    {formatMoney(selectedSale.total)}
                                </div>
                                <div className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 ${selectedSale.status === 'cancelled' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                                    {selectedSale.status === 'cancelled' ? 'ANULADA' : 'PAGADO'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Mobile Action Buttons */}
                    <div className="p-3 border-b border-[var(--glass-border)] flex gap-2 overflow-x-auto">
                        <button onClick={handleDownloadPDF} className="flex items-center gap-1.5 px-3 py-2 bg-[var(--glass-bg)] rounded-lg text-xs text-[var(--color-text)] border border-[var(--glass-border)] whitespace-nowrap">
                            <Download size={14} />
                            Descargar PDF
                        </button>
                        <button onClick={handleWhatsAppClick} className="flex items-center gap-1.5 px-3 py-2 bg-[#25D366]/20 text-[#25D366] rounded-lg text-xs whitespace-nowrap">
                            <Send size={14} />
                            Compartir WhatsApp
                        </button>
                        {selectedSale.status !== 'cancelled' && (
                            <button onClick={handleCancelSale} className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-400 rounded-lg text-xs border border-red-500/20 whitespace-nowrap">
                                <Trash2 size={14} />
                                Anular Venta
                            </button>
                        )}
                    </div>

                    {/* Mobile Products List */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {isLoadingDetails && !selectedSale.items ? (
                            <div className="flex items-center justify-center py-12">
                                <span className="text-[var(--color-text-muted)]">Cargando...</span>
                            </div>
                        ) : (
                            <>
                                {/* Products Table */}
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-[var(--glass-border)] text-[var(--color-text-muted)] text-xs">
                                            <th className="py-2">Producto</th>
                                            <th className="py-2 text-center">Cantidad</th>
                                            <th className="py-2 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedSale.items?.map((item, idx) => (
                                            <tr key={idx} className="border-b border-[var(--glass-border)]">
                                                <td className="py-3">
                                                    <div className="font-medium text-[var(--color-text)] text-sm">{item.name}</div>
                                                    {item.sku && <div className="text-[10px] text-[var(--color-text-muted)]">{item.sku}</div>}
                                                </td>
                                                <td className="py-3 text-center">
                                                    <span className="px-2 py-1 bg-[var(--glass-bg)] rounded text-[var(--color-text)] text-sm">{item.quantity}</span>
                                                </td>
                                                <td className="py-3 text-right font-bold text-[var(--color-text)] text-sm">{formatMoney(item.price * item.quantity)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {/* Totals */}
                                <div className="mt-6 space-y-2">
                                    <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                        <span>Subtotal</span>
                                        <span>{formatMoney(selectedSale.total)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                        <span>Impuestos</span>
                                        <span>$0</span>
                                    </div>
                                    <div className="border-t border-[var(--glass-border)] pt-2 flex justify-between font-bold text-[var(--color-text)]">
                                        <span>Total</span>
                                        <span className="text-[var(--color-primary)] text-lg">{formatMoney(selectedSale.total)}</span>
                                    </div>
                                </div>

                                {/* Payment Info */}
                                <div className="mt-6 p-4 bg-[var(--glass-bg)] rounded-xl border border-[var(--glass-border)]">
                                    <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-2">INFORMACIÓN DE PAGO</p>
                                    <div className="flex justify-between text-sm text-[var(--color-text-muted)] mb-1">
                                        <span>Metodo</span>
                                        <span>{selectedSale.paymentMethod}</span>
                                    </div>
                                    {selectedSale.paymentMethod === 'Efectivo' && selectedSale.paymentDetails && (
                                        <>
                                            <div className="flex justify-between text-sm text-[var(--color-text-muted)] mb-1">
                                                <span>Pagado</span>
                                                <span>{formatMoney(selectedSale.paymentDetails.amount || selectedSale.total)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                                <span>Vuelto</span>
                                                <span>{formatMoney(selectedSale.paymentDetails.change || 0)}</span>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Cancellation reason if cancelled */}
                                {selectedSale.status === 'cancelled' && (
                                    <div className="mt-4 p-4 bg-red-500/10 rounded-xl border border-red-500/20">
                                        <p className="text-xs text-red-400 uppercase font-bold mb-1 flex items-center gap-1">
                                            <AlertTriangle size={12} />
                                            Motivo de Anulación
                                        </p>
                                        <p className="text-sm text-red-200 italic">
                                            "{selectedSale.observation || 'Sin observación'}"
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Mobile Close Button */}
                    <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                        <button
                            onClick={() => setSelectedSale(null)}
                            className="w-full py-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] font-bold"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            )}
        </div >
    );
};

export default SalesHistory;
