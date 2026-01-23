import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Search, Calendar, CreditCard, User, Download, Send, Trash2, Printer, AlertTriangle, FileText, X } from 'lucide-react';
import { formatMoney, generateReceiptPDF, generateWhatsAppLink } from '../utils/receipt';

const SalesHistory = () => {
    const { sales, users, cancelSale, currentUser } = useStore();
    const [selectedSale, setSelectedSale] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [sellerFilter, setSellerFilter] = useState('all');

    const dateFromRef = useRef(null);
    const dateToRef = useRef(null);

    // WhatsApp Phone State
    const [showPhoneInput, setShowPhoneInput] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancellationReason, setCancellationReason] = useState('');

    const filteredSales = useMemo(() => {
        return sales.filter(sale => {
            const matchesSearch = sale.id.toString().includes(searchTerm) ||
                sale.summary?.toLowerCase().includes(searchTerm.toLowerCase());

            let matchesDate = true;
            // Extract YYYY-MM-DD from the sale ISO string (first 10 chars)
            // Note: If sale.date is full ISO, we might want to check if it's stored in UTC.
            // Assuming sale.date is "2024-01-22T..." 
            // Better to use a reliable parsing or simple string check if input is YYYY-MM-DD

            const saleDateObj = new Date(sale.date);
            // Get local YYYY-MM-DD string from the sale date
            // This ensures we match what the user sees in "toLocaleDateString"
            const saleDateStr = saleDateObj.toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD format

            if (dateFrom) {
                matchesDate = matchesDate && saleDateStr >= dateFrom;
            }
            if (dateTo) {
                matchesDate = matchesDate && saleDateStr <= dateTo;
            }

            const matchesPayment = paymentFilter === 'all' || sale.paymentMethod === paymentFilter;

            // For seller, we might need to check user_id. 
            // Assuming sale has user_id or we need to find it. The store addSale saves user_id.
            // If sale.user_id exists, we match it.
            const matchesSeller = sellerFilter === 'all' || (sale.user_id && String(sale.user_id) === sellerFilter);

            return matchesSearch && matchesDate && matchesPayment && matchesSeller;
        });
    }, [sales, searchTerm, dateFrom, dateTo, paymentFilter, sellerFilter]);

    const handleDownloadPDF = () => {
        if (!selectedSale) return;
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

    // Calculate daily stats based on filtered view or total? 
    // Usually header stats act on the current view.
    const totalSales = filteredSales.reduce((acc, curr) => acc + (curr.status === 'cancelled' ? 0 : curr.total), 0);
    const totalCount = filteredSales.filter(s => s.status !== 'cancelled').length;

    return (
        <div className="h-full flex flex-col gap-4">
            {/* Top Stats / Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Historial de Ventas</h1>
                    <p className="text-gray-400 text-sm">Gestiona y revisa todas las transacciones</p>
                </div>
                <div className="flex gap-4 bg-white/5 p-3 rounded-xl border border-white/10">
                    <div className="text-right">
                        <p className="text-xs text-gray-400">Total Ventas</p>
                        <p className="text-xl font-bold text-[var(--color-primary)]">{formatMoney(totalSales)}</p>
                    </div>
                    <div className="w-px bg-white/10"></div>
                    <div className="text-right">
                        <p className="text-xs text-gray-400">Transacciones</p>
                        <p className="text-xl font-bold text-white">{totalCount}</p>
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="glass p-4 rounded-xl flex flex-wrap gap-4 items-center">
                <div className="flex-1 min-w-[200px] relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por # Boleta o monto..."
                        className="w-full bg-black/20 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-[var(--color-primary)]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* 3D Date Buttons */}
                <div className="flex gap-2">
                    <div
                        className="relative group active:translate-y-1 transition-all"
                        onClick={() => dateFromRef.current?.showPicker()}
                    >
                        <div className="flex items-center gap-2 bg-[#2a2a40] text-white px-4 py-2 rounded-xl border-b-4 border-black/50 group-active:border-b-0 cursor-pointer shadow-lg hover:bg-[#32324a] transition-colors min-w-[140px]">
                            <Calendar size={16} className="text-[var(--color-primary)] mb-0.5" />
                            <span className="text-sm font-bold truncate">
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

                    <div
                        className="relative group active:translate-y-1 transition-all"
                        onClick={() => dateToRef.current?.showPicker()}
                    >
                        <div className="flex items-center gap-2 bg-[#2a2a40] text-white px-4 py-2 rounded-xl border-b-4 border-black/50 group-active:border-b-0 cursor-pointer shadow-lg hover:bg-[#32324a] transition-colors min-w-[140px]">
                            <Calendar size={16} className="text-[var(--color-primary)] mb-0.5" />
                            <span className="text-sm font-bold truncate">
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
                </div>

                <div className="relative group active:translate-y-1 transition-all">
                    <div className="flex items-center gap-2 bg-[#2a2a40] text-white px-4 py-2 rounded-xl border-b-4 border-black/50 group-active:border-b-0 cursor-pointer shadow-lg hover:bg-[#32324a] transition-colors min-w-[180px]">
                        <CreditCard size={16} className="text-[var(--color-primary)] mb-0.5" />
                        <span className="text-sm font-bold truncate flex-1">
                            {paymentFilter === 'all' ? 'Todos los pagos' : paymentFilter}
                        </span>
                    </div>
                    <select
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        value={paymentFilter}
                        onChange={(e) => setPaymentFilter(e.target.value)}
                    >
                        <option value="all" className="bg-[#1a1a2e] text-white">Todos los pagos</option>
                        <option value="Efectivo" className="bg-[#1a1a2e] text-white">Efectivo</option>
                        <option value="Tarjeta" className="bg-[#1a1a2e] text-white">Tarjeta</option>
                        <option value="Transferencia" className="bg-[#1a1a2e] text-white">Transferencia</option>
                        <option value="Mixto" className="bg-[#1a1a2e] text-white">Mixto</option>
                    </select>
                </div>

                <div className="relative group active:translate-y-1 transition-all">
                    <div className="flex items-center gap-2 bg-[#2a2a40] text-white px-4 py-2 rounded-xl border-b-4 border-black/50 group-active:border-b-0 cursor-pointer shadow-lg hover:bg-[#32324a] transition-colors min-w-[180px]">
                        <User size={16} className="text-[var(--color-primary)] mb-0.5" />
                        <span className="text-sm font-bold truncate flex-1">
                            {sellerFilter === 'all' ? 'Todos los vendedores' : users.find(u => String(u.id) === sellerFilter)?.name || 'Desconocido'}
                        </span>
                    </div>
                    <select
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        value={sellerFilter}
                        onChange={(e) => setSellerFilter(e.target.value)}
                    >
                        <option value="all" className="bg-[#1a1a2e] text-white">Todos los vendedores</option>
                        {users.map(user => (
                            <option key={user.id} value={user.id} className="bg-[#1a1a2e] text-white">{user.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Split View */}
            <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
                {/* Left: List */}
                <div className="w-1/3 glass rounded-xl flex flex-col overflow-hidden border border-white/5">
                    <div className="p-3 border-b border-white/5 bg-white/5 font-semibold text-gray-300">
                        Resultados ({filteredSales.length})
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {filteredSales.map(sale => (
                            <div
                                key={sale.id}
                                onClick={() => setSelectedSale(sale)}
                                className={`p-4 border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${selectedSale?.id === sale.id ? 'bg-[var(--color-primary)]/10 border-l-4 border-l-[var(--color-primary)]' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-mono text-sm text-gray-400">#{sale.id}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${sale.status === 'cancelled' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                        }`}>
                                        {sale.status === 'cancelled' ? 'ANULADA' : 'COMPLETADA'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="font-bold text-white">{formatMoney(sale.total)}</p>
                                        <p className="text-xs text-gray-400">{new Date(sale.date).toLocaleDateString()} {new Date(sale.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                                            <User size={10} />
                                            {getSellerName(sale.user_id)}
                                        </div>
                                    </div>
                                    <div className="text-xs px-2 py-1 rounded bg-white/10 text-gray-300">
                                        {sale.paymentMethod}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {filteredSales.length === 0 && (
                            <div className="p-8 text-center text-gray-500">
                                No se encontraron ventas
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Details */}
                <div className="w-2/3 glass rounded-xl flex flex-col overflow-hidden border border-white/5 relative">
                    {selectedSale ? (
                        <>
                            {/* Header details */}
                            <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-start">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-1">
                                        Venta #{selectedSale.id}
                                    </h2>
                                    <div className="text-sm text-gray-400 flex gap-4">
                                        <span>{new Date(selectedSale.date).toLocaleString()}</span>
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
                            <div className="p-3 border-b border-white/5 flex gap-2">
                                <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-200 transition-colors">
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
                                        <tr className="border-b border-white/10 text-gray-500 text-sm">
                                            <th className="py-2">Producto</th>
                                            <th className="py-2 text-right">Cantidad</th>
                                            <th className="py-2 text-right">Precio Unit.</th>
                                            <th className="py-2 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedSale.items?.map((item, idx) => (
                                            <tr key={idx} className="border-b border-white/5 text-gray-300 text-sm">
                                                <td className="py-3">
                                                    <div className="font-medium text-white">{item.name}</div>
                                                    {item.sku && <div className="text-xs text-gray-500">{item.sku}</div>}
                                                </td>
                                                <td className="py-3 text-right text-white bg-white/5 rounded w-16 text-center mx-auto" style={{ display: 'table-cell' }}>
                                                    <span className="px-2 py-1 rounded bg-white/5">{item.quantity}</span>
                                                </td>
                                                <td className="py-3 text-right">{formatMoney(item.price)}</td>
                                                <td className="py-3 text-right font-bold text-white">{formatMoney(item.price * item.quantity)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {/* Totals Summary */}
                                <div className="mt-8 flex justify-end">
                                    <div className="w-64 space-y-2">
                                        <div className="flex justify-between text-gray-400 text-sm">
                                            <span>Subtotal</span>
                                            <span>{formatMoney(selectedSale.total)}</span>
                                        </div>
                                        <div className="flex justify-between text-gray-400 text-sm">
                                            <span>Impuestos</span>
                                            <span>$0</span>
                                        </div>
                                        <div className="border-t border-white/10 pt-2 flex justify-between text-white font-bold text-lg">
                                            <span>Total</span>
                                            <span className="text-[var(--color-primary)]">{formatMoney(selectedSale.total)}</span>
                                        </div>

                                        <div className="mt-6 p-4 bg-white/5 rounded-lg border border-white/10">
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-2">Información de Pago</p>
                                            <div className="flex justify-between text-sm text-gray-300 mb-1">
                                                <span>Método</span>
                                                <span className="capitalize">{selectedSale.paymentMethod}</span>
                                            </div>
                                            {selectedSale.paymentMethod === 'Efectivo' && selectedSale.paymentDetails && (
                                                <>
                                                    <div className="flex justify-between text-sm text-gray-300 mb-1">
                                                        <span>Pagado</span>
                                                        <span>{formatMoney(selectedSale.paymentDetails.amount || selectedSale.total)}</span>
                                                    </div>
                                                    <div className="flex justify-between text-sm text-gray-300">
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
                                    <div className="bg-[#0f0f2d] border border-white/20 p-6 rounded-2xl w-80 shadow-2xl animate-[float_0.3s_ease-out]">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-white font-bold">Enviar por WhatsApp</h3>
                                            <button onClick={() => setShowPhoneInput(false)} className="text-gray-400 hover:text-white">
                                                <X size={18} />
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-400 mb-3">Ingrese el número de teléfono del cliente:</p>
                                        <div className="flex gap-2 mb-4">
                                            <div className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-gray-400 text-sm flex items-center">
                                                +56 9
                                            </div>
                                            <input
                                                type="tel"
                                                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[var(--color-primary)] focus:outline-none"
                                                placeholder="12345678"
                                                value={phoneNumber}
                                                onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').substring(0, 8))}
                                                autoFocus
                                            />
                                        </div>
                                        <button
                                            onClick={confirmWhatsAppShare}
                                            disabled={phoneNumber.length < 8}
                                            className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                                    <div className="bg-[#0f0f2d] border border-red-500/20 p-6 rounded-2xl w-full max-w-md shadow-2xl animate-[float_0.3s_ease-out]">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                                <AlertTriangle className="text-red-500" size={24} />
                                                Anular Venta
                                            </h3>
                                            <button
                                                onClick={() => {
                                                    setShowCancelModal(false);
                                                    setCancellationReason('');
                                                }}
                                                className="text-gray-400 hover:text-white"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>

                                        <div className="mb-6">
                                            <p className="text-gray-300 text-sm mb-4">
                                                ¿Está seguro de que desea anular esta venta? Esta acción restaurará el stock de los productos.
                                            </p>

                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                                                Motivo de Anulación (Requerido)
                                            </label>
                                            <textarea
                                                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white text-sm focus:border-red-500/50 focus:outline-none resize-none h-24"
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
                                                className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-sm font-bold transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={confirmCancellation}
                                                disabled={!cancellationReason.trim()}
                                                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                <Trash2 size={16} />
                                                Confirmar Anulación
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8">
                            <FileText size={64} className="mb-4 opacity-20" />
                            <h3 className="text-xl font-bold text-gray-400 mb-2">Seleccione una venta</h3>
                            <p className="text-sm max-w-xs text-center">Haga clic en una transacción de la izquierda para ver su detalle, reimprimir o anular.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SalesHistory;
