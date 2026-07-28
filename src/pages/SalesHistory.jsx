import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { reportCall } from '../lib/dataApi';
import { Search, Calendar, CreditCard, User, Download, Send, Trash2, Printer, AlertTriangle, FileText, X, RotateCcw, Receipt, CheckCircle2, Clock, Stamp } from 'lucide-react';
import { generateReceiptPDF, generateWhatsAppLink } from '../utils/receipt';
import bwipjs from 'bwip-js';
import { formatCurrency } from '../utils/formatCurrency';
import { formatInCompanyTime } from '../lib/dateHelpers';
import { usePermissions } from '../hooks/usePermissions';
import ReturnModal from '../components/ReturnModal';
import { printSaleReceipt } from '../lib/saleReceipt';

const SalesHistory = () => {
    const { sales, users, cancelSale, fetchSaleReturns, currentUser, currentCompanyTimezone, fetchSales, fetchSaleDetails, activeCompanyId, currentCurrency } = useStore();
    const [selectedSale, setSelectedSale] = useState(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const { can } = usePermissions();

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
    const [showReturnModal, setShowReturnModal] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [saleReturns, setSaleReturns] = useState([]);
    const [returnSuccess, setReturnSuccess] = useState(null);
    const [dteMap, setDteMap] = useState({});
    const [selectedDteInfo, setSelectedDteInfo] = useState(null);

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

    // Load DTE info for visible sales
    React.useEffect(() => {
        const loadDteMap = async () => {
            if (!activeCompanyId || sales.length === 0) return;
            try {
                const saleIds = sales.map(s => s.id);
                const result = { rows: await reportCall(activeCompanyId, 'dteMapBySales', { saleIds }) };
                const map = {};
                result.rows.forEach(r => { map[r.sale_id] = r; });
                setDteMap(map);
            } catch(e) {
                // SII tables may not exist
            }
        };
        loadDteMap();
    }, [sales, activeCompanyId]);

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
        setSaleReturns([]);
        setSelectedDteInfo(null);

        // Check if we have details
        if (!sale.items) {
            setIsLoadingDetails(true);
            const fullDetails = await fetchSaleDetails(sale.id);
            if (fullDetails) {
                setSelectedSale(fullDetails);
            }
            setIsLoadingDetails(false);
        }

        // Load DTE info for this sale
        if (activeCompanyId) {
            try {
                const dteResult = { rows: await reportCall(activeCompanyId, 'dteForSale', { saleId: sale.id }) };
                if (dteResult.rows.length > 0) {
                    setSelectedDteInfo(dteResult.rows[0]);
                }
            } catch(e) { /* SII tables may not exist */ }
        }

        // Load returns for this sale
        const returns = await fetchSaleReturns(sale.id);
        setSaleReturns(returns);
    };

    const handleReturnSuccess = async (returnTotal) => {
        setShowReturnModal(false);
        setReturnSuccess(returnTotal);
        // Reload returns
        const returns = await fetchSaleReturns(selectedSale.id);
        setSaleReturns(returns);
        setTimeout(() => setReturnSuccess(null), 4000);
    };

    // Calculate totals from CURRENTLY LOADED sales (Note: this is only what's viewed, not DB total)
    // For proper totals, we might need a separate endpoint, but for now summing loaded is okay-ish 
    const totalSales = sales.reduce((acc, curr) => acc + (curr.status === 'cancelled' ? 0 : curr.total), 0);
    const totalCount = sales.filter(s => s.status !== 'cancelled').length;

    // Build per-product returned quantities map from saleReturns
    const returnedMap = useMemo(() => {
        const map = {};
        for (const ret of saleReturns) {
            for (const item of ret.items) {
                map[item.id] = (map[item.id] || 0) + item.quantity;
            }
        }
        return map;
    }, [saleReturns]);

    const totalReturned = useMemo(() => saleReturns.reduce((sum, r) => sum + r.total, 0), [saleReturns]);

    const handleDownloadPDF = async () => {
        if (!selectedSale || !selectedSale.items) return;
        const seller = users.find(u => u.id === selectedSale.user_id);

        try {
            const configResult = { rows: await reportCall(activeCompanyId, 'receiptConfig', {}) };

            const receiptConfig = configResult.rows.length > 0 ? {
                ...configResult.rows[0],
                show_tax_id: configResult.rows[0].show_tax_id === 1,
                show_phone: configResult.rows[0].show_phone === 1,
                show_email: configResult.rows[0].show_email === 1
            } : null;

            // Generar timbre PDF417 si hay DTE
            let timbreImg = null;
            if (activeCompanyId && selectedSale.id) {
                try {
                    const dteResult = { rows: await reportCall(activeCompanyId, 'dteForSale', { saleId: selectedSale.id }) };
                    if (dteResult.rows.length > 0 && dteResult.rows[0].xml_firmado) {
                        const xmlFirmado = dteResult.rows[0].xml_firmado;
                        const tedMatch = xmlFirmado.match(/<TED[\s\S]*?<\/TED>/);
                        if (tedMatch) {
                            const canvas = document.createElement('canvas');
                            bwipjs.toCanvas(canvas, {
                                bcid: 'pdf417',
                                text: tedMatch[0],
                                scale: 2,
                                columns: 7,
                                rowmult: 2,
                                eclevel: 5,
                            });
                            timbreImg = canvas.toDataURL('image/png');
                        }
                    }
                } catch (e) {
                    console.error('Error generating timbre for PDF:', e);
                }
            }

            const pdfBlob = await generateReceiptPDF(selectedSale, seller, receiptConfig, currentCurrency, timbreImg);
            const url = window.URL.createObjectURL(pdfBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `boleta_${selectedSale.id}.pdf`;
            link.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Error generating PDF:", error);
            alert("Error al generar el PDF");
        }
    };

    const handleWhatsAppClick = () => {
        setShowPhoneInput(true);
    };

    const confirmWhatsAppShare = async () => {
        if (!selectedSale || phoneNumber.length < 8) return;
        const seller = users.find(u => u.id === selectedSale.user_id);

        try {
            const configResult = { rows: await reportCall(activeCompanyId, 'receiptConfig', {}) };

            const receiptConfig = configResult.rows.length > 0 ? {
                ...configResult.rows[0],
                show_tax_id: configResult.rows[0].show_tax_id === 1,
                show_phone: configResult.rows[0].show_phone === 1,
                show_email: configResult.rows[0].show_email === 1
            } : null;

            const link = generateWhatsAppLink(phoneNumber, selectedSale, seller, receiptConfig, currentCurrency);
            window.open(link, '_blank');
            setShowPhoneInput(false);
            setPhoneNumber('');
        } catch (error) {
            console.error("Error sharing WhatsApp:", error);
            alert("Error al compartir por WhatsApp");
        }
    };

    const handleCancelSale = () => {
        if (!selectedSale || selectedSale.status === 'cancelled') return;
        setShowCancelModal(true);
    };

    const confirmCancellation = async () => {
        if (!selectedSale || !cancellationReason.trim()) return;

        const result = await cancelSale(selectedSale.id, cancellationReason);
        if (result === true || result?.success) {
            setSelectedSale(prev => ({ ...prev, status: 'cancelled', observation: cancellationReason }));
            setShowCancelModal(false);
            setCancellationReason('');
        } else {
            const errorMsg = result?.error || 'Error desconocido';
            alert(`Error al anular la venta: ${errorMsg}`);
        }
    };

    const getSellerName = (userId) => {
        const user = users.find(u => u.id === userId);
        return user ? user.name : 'Desconocido';
    };

    // Reimprimir la boleta: en la app va a la térmica Bluetooth; en el navegador
    // abre la ventana de impresión de siempre. Mismo formato que la venta nueva.
    const handlePrintReceipt = async () => {
        if (!selectedSale || isPrinting) return;
        setIsPrinting(true);
        try {
            const configResult = { rows: await reportCall(activeCompanyId, 'receiptConfig', {}) };
            const receiptConfig = configResult.rows.length > 0 ? {
                ...configResult.rows[0],
                show_tax_id: configResult.rows[0].show_tax_id === 1,
                show_phone: configResult.rows[0].show_phone === 1,
                show_email: configResult.rows[0].show_email === 1,
            } : {};
            const dteInfo = dteMap[selectedSale.id] || selectedDteInfo || null;
            // Timbre SII: traer el XML firmado del DTE (si la venta es boleta/factura).
            let tedXml = null;
            try {
                const dteResult = { rows: await reportCall(activeCompanyId, 'dteForSale', { saleId: selectedSale.id }) };
                if (dteResult.rows.length > 0 && dteResult.rows[0].xml_firmado) tedXml = dteResult.rows[0].xml_firmado;
            } catch { /* venta sin DTE: sin timbre */ }
            const r = await printSaleReceipt(selectedSale, {
                sellerName: getSellerName(selectedSale.user_id),
                receiptConfig,
                currency: currentCurrency,
                dteInfo,
                tedXml,
            });
            if (!r.ok) {
                if (r.error === 'NO_PRINTER') alert('Configura tu impresora en Configuración → General → Impresora térmica.');
                else if (r.error === 'POPUP_BLOCKED') alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.');
                else alert('No se pudo imprimir: ' + (r.error || ''));
            }
        } catch (e) {
            alert('No se pudo imprimir: ' + (e?.message || e));
        } finally {
            setIsPrinting(false);
        }
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

                    {/* Sale ID Search */}
                    <div className="flex items-center gap-1.5 bg-[var(--glass-bg)] text-[var(--color-text)] px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl border-b-2 lg:border-b-4 border-black/50 shadow-lg text-xs lg:text-sm font-bold">
                        <Search size={14} className="text-[var(--color-primary)]" />
                        <input
                            type="text"
                            placeholder="N° Boleta"
                            className="bg-transparent border-none outline-none text-xs lg:text-sm font-bold w-20 lg:w-24 placeholder:text-[var(--color-text-muted)]"
                            value={saleIdFilter}
                            onChange={(e) => setSaleIdFilter(e.target.value.replace(/\D/g, ''))}
                        />
                        {saleIdFilter && (
                            <button
                                onClick={() => setSaleIdFilter('')}
                                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-1"
                            >
                                <X size={12} />
                            </button>
                        )}
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
                                        <p className="font-bold text-green-400 text-base lg:text-lg">{formatCurrency(sale.total, currentCurrency)}</p>
                                        <p className="text-[10px] lg:text-xs text-[var(--color-text-muted)]">
                                            {formatInCompanyTime(sale.date, currentCompanyTimezone, 'dd-MM-yyyy HH:mm')}
                                        </p>
                                    </div>
                                    {dteMap[sale.id] && (
                                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                            Number(dteMap[sale.id].tipo) === 33
                                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                                : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                        }`}>
                                            {Number(dteMap[sale.id].tipo) === 33 ? <FileText size={10} /> : <Receipt size={10} />}
                                            {Number(dteMap[sale.id].tipo) === 33 ? 'F' : 'B'}-{dteMap[sale.id].folio}
                                            {dteMap[sale.id].status === 'accepted' && <CheckCircle2 size={10} className="text-green-400" />}
                                        </span>
                                    )}
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
                                            {formatCurrency(selectedSale.total, currentCurrency)}
                                        </div>
                                        <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold mt-2 ${selectedSale.status === 'cancelled' ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'
                                            }`}>
                                            {selectedSale.status === 'cancelled' ? 'ANULADA' : 'PAGADO'}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions Toolbar */}
                                <div className="p-3 border-b border-[var(--glass-border)] flex gap-2 flex-wrap">
                                    <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] rounded-lg text-sm text-gray-200 transition-colors">
                                        <Download size={16} />
                                        Descargar PDF
                                    </button>
                                    <button onClick={handleWhatsAppClick} className="flex items-center gap-2 px-4 py-2 bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] rounded-lg text-sm transition-colors">
                                        <Send size={16} />
                                        Compartir WhatsApp
                                    </button>
                                    <button onClick={handlePrintReceipt} disabled={isPrinting} className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded-lg text-sm transition-colors border border-[var(--color-primary)]/20 disabled:opacity-50">
                                        <Printer size={16} />
                                        {isPrinting ? 'Imprimiendo…' : 'Imprimir'}
                                    </button>
                                    <div className="flex-1"></div>
                                    {selectedSale.status !== 'cancelled' && can('sales.return') && (
                                        <button onClick={() => setShowReturnModal(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-sm transition-colors border border-orange-500/20">
                                            <RotateCcw size={16} />
                                            Devolución
                                        </button>
                                    )}
                                    {selectedSale.status !== 'cancelled' && can('sales.cancel') && (
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
                                            {(!selectedSale.items || selectedSale.items.length === 0) ? (
                                                <tr>
                                                    <td colSpan="4" className="py-8 text-center text-[var(--color-text-muted)]">
                                                        No hay detalles de productos disponibles para esta venta.
                                                    </td>
                                                </tr>
                                            ) : (
                                                selectedSale.items.map((item, idx) => {
                                                    const retQty = returnedMap[item.id] || 0;
                                                    const effectiveQty = item.quantity - retQty;
                                                    const isFullReturn = retQty >= item.quantity;
                                                    return (
                                                    <tr key={idx} className={`border-b border-[var(--glass-border)] text-[var(--color-text-muted)] text-sm hover:bg-[var(--glass-bg)]/30 transition-colors ${isFullReturn ? 'opacity-50' : ''}`}>
                                                        <td className="py-3 pl-2">
                                                            <div className={`font-medium ${isFullReturn ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>{item.name}</div>
                                                            {item.sku && <div className="text-xs text-[var(--color-text-muted)] opacity-70">{item.sku}</div>}
                                                            {retQty > 0 && (
                                                                <div className="flex items-center gap-1.5 mt-1">
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 text-[10px] font-bold">
                                                                        <RotateCcw size={9} />
                                                                        {isFullReturn ? 'DEVUELTO' : `Dev: ${retQty} ${item.unit || 'Und'}`}
                                                                    </span>
                                                                    {!isFullReturn && (
                                                                        <span className="text-[10px] text-[var(--color-text-muted)]">Queda: {effectiveQty} {item.unit || 'Und'}</span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="py-3 text-center">
                                                            <span className="px-2 py-1 rounded bg-[var(--glass-bg)] text-[var(--color-text)] font-medium text-xs border border-[var(--glass-border)]">
                                                                {item.quantity} {item.unit || 'Und'}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 text-right text-[var(--color-text)]">
                                                            {formatCurrency(item.price, currentCurrency)}
                                                        </td>
                                                        <td className="py-3 text-right pr-2">
                                                            <div className={`font-bold ${isFullReturn ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}`}>
                                                                {formatCurrency((item.price * item.quantity), currentCurrency)}
                                                            </div>
                                                            {retQty > 0 && !isFullReturn && (
                                                                <div className="text-[10px] text-orange-400 font-medium">
                                                                    Neto: {formatCurrency(item.price * effectiveQty, currentCurrency)}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>

                                    {/* Totals Summary */}
                                    <div className="mt-8 flex justify-end">
                                        <div className="w-64 space-y-2">
                                            <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                                                <span>Subtotal</span>
                                                <span>{formatCurrency(selectedSale.total, currentCurrency)}</span>
                                            </div>
                                            {totalReturned > 0 && (
                                                <div className="flex justify-between text-orange-400 text-sm">
                                                    <span>Devoluciones</span>
                                                    <span>-{formatCurrency(totalReturned, currentCurrency)}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between text-[var(--color-text-muted)] text-sm">
                                                <span>Impuestos</span>
                                                <span>{formatCurrency(0, currentCurrency)}</span>
                                            </div>
                                            <div className="border-t border-[var(--glass-border)] pt-2 flex justify-between text-[var(--color-text)] font-bold text-lg">
                                                <span>Total</span>
                                                <span className="text-[var(--color-primary)]">{formatCurrency(selectedSale.total - totalReturned, currentCurrency)}</span>
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
                                                            <span>{formatCurrency(selectedSale.paymentDetails.amount || selectedSale.total, currentCurrency)}</span>
                                                        </div>
                                                        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                                            <span>Vuelto</span>
                                                            <span>{formatCurrency(selectedSale.paymentDetails.change || 0, currentCurrency)}</span>
                                                        </div>
                                                    </>
                                                )}
                                                {selectedSale.paymentMethod === 'Crédito' && (
                                                    <div className="flex justify-between text-sm text-[var(--color-text-muted)] mt-2 pt-2 border-t border-[var(--glass-border)]">
                                                        <span className="flex items-center gap-1">
                                                            <User size={14} className="text-orange-400" />
                                                            Cliente Fiado
                                                        </span>
                                                        <span className="text-orange-400 font-semibold">
                                                            {selectedSale.clientName || selectedSale.client_name || 'No especificado'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* DTE Info */}
                                            {selectedDteInfo && (
                                                <div className="mt-4 p-4 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                                                    <p className="text-xs text-indigo-400 uppercase font-bold mb-2 flex items-center gap-2">
                                                        <Stamp size={12} />
                                                        Documento Tributario Electrónico
                                                    </p>
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-[var(--color-text-muted)]">Tipo</span>
                                                            <span className={`font-bold ${Number(selectedDteInfo.tipo) === 33 ? 'text-purple-400' : 'text-blue-400'}`}>
                                                                {Number(selectedDteInfo.tipo) === 33 ? 'Factura Electrónica' : 'Boleta Electrónica'}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-[var(--color-text-muted)]">Folio</span>
                                                            <span className="text-[var(--color-text)] font-bold">N° {selectedDteInfo.folio}</span>
                                                        </div>
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-[var(--color-text-muted)]">Estado</span>
                                                            <span className={`inline-flex items-center gap-1 font-bold ${
                                                                selectedDteInfo.status === 'accepted' ? 'text-green-400' :
                                                                selectedDteInfo.status === 'rejected' ? 'text-red-400' :
                                                                'text-yellow-400'
                                                            }`}>
                                                                {selectedDteInfo.status === 'accepted' ? <><CheckCircle2 size={14} /> Aceptado</> :
                                                                 selectedDteInfo.status === 'rejected' ? 'Rechazado' :
                                                                 <><Clock size={14} /> Pendiente</>}
                                                            </span>
                                                        </div>
                                                        {selectedDteInfo.track_id && (
                                                            <div className="flex justify-between text-sm">
                                                                <span className="text-[var(--color-text-muted)]">Track ID</span>
                                                                <span className="text-[var(--color-text)] font-mono text-xs">{selectedDteInfo.track_id}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

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

                                            {/* Returns History */}
                                            {saleReturns.length > 0 && (
                                                <div className="mt-4 p-4 bg-orange-500/10 rounded-lg border border-orange-500/20">
                                                    <p className="text-xs text-orange-400 uppercase font-bold mb-3 flex items-center gap-2">
                                                        <RotateCcw size={12} />
                                                        Devoluciones ({saleReturns.length})
                                                    </p>
                                                    <div className="space-y-3">
                                                        {saleReturns.map((ret, idx) => (
                                                            <div key={ret.id} className="p-3 bg-black/20 rounded-lg">
                                                                <div className="flex justify-between items-start mb-2">
                                                                    <span className="text-xs text-[var(--color-text-muted)]">
                                                                        {formatInCompanyTime(ret.created_at, currentCompanyTimezone, 'dd/MM/yyyy HH:mm')}
                                                                    </span>
                                                                    <span className="text-sm font-bold text-orange-400">
                                                                        -{formatCurrency(ret.total, currentCurrency)}
                                                                    </span>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    {ret.items.map((item, i) => (
                                                                        <div key={i} className="flex justify-between text-xs text-[var(--color-text-muted)]">
                                                                            <span>{item.name}</span>
                                                                            <span>x{item.quantity}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <p className="text-xs text-orange-300/70 italic mt-2">"{ret.reason}"</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="mt-3 pt-3 border-t border-orange-500/20 flex justify-between text-sm">
                                                        <span className="text-orange-400 font-bold">Total Devuelto</span>
                                                        <span className="text-orange-400 font-bold">
                                                            -{formatCurrency(saleReturns.reduce((sum, r) => sum + r.total, 0), currentCurrency)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Return Success Toast */}
                                {returnSuccess && (
                                    <div className="absolute top-4 right-4 z-30 bg-green-500/90 text-white px-4 py-3 rounded-xl shadow-lg animate-[float_0.3s_ease-out] flex items-center gap-2">
                                        <RotateCcw size={16} />
                                        <span className="text-sm font-bold">Devolución procesada: {formatCurrency(returnSuccess, currentCurrency)}</span>
                                    </div>
                                )}

                                {/* Return Modal */}
                                {showReturnModal && selectedSale && (
                                    <ReturnModal
                                        sale={selectedSale}
                                        onClose={() => setShowReturnModal(false)}
                                        onSuccess={handleReturnSuccess}
                                    />
                                )}

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
                                    {formatCurrency(selectedSale.total, currentCurrency)}
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
                        <button onClick={handlePrintReceipt} disabled={isPrinting} className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg text-xs border border-[var(--color-primary)]/20 whitespace-nowrap disabled:opacity-50">
                            <Printer size={14} />
                            {isPrinting ? 'Imprimiendo…' : 'Imprimir'}
                        </button>
                        {selectedSale.status !== 'cancelled' && can('sales.return') && (
                            <button onClick={() => setShowReturnModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-orange-500/10 text-orange-400 rounded-lg text-xs border border-orange-500/20 whitespace-nowrap">
                                <RotateCcw size={14} />
                                Devolución
                            </button>
                        )}
                        {selectedSale.status !== 'cancelled' && can('sales.cancel') && (
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
                                        {(!selectedSale.items || selectedSale.items.length === 0) ? (
                                            <tr>
                                                <td colSpan="3" className="py-8 text-center text-[var(--color-text-muted)] text-sm">
                                                    No hay detalles disponibles.
                                                </td>
                                            </tr>
                                        ) : (
                                            selectedSale.items.map((item, idx) => {
                                                const retQty = returnedMap[item.id] || 0;
                                                const effectiveQty = item.quantity - retQty;
                                                const isFullReturn = retQty >= item.quantity;
                                                return (
                                                <tr key={idx} className={`border-b border-[var(--glass-border)] ${isFullReturn ? 'opacity-50' : ''}`}>
                                                    <td className="py-3 pr-2">
                                                        <div className={`font-medium text-sm ${isFullReturn ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>{item.name}</div>
                                                        {item.sku && <div className="text-[10px] text-[var(--color-text-muted)] opacity-70">{item.sku}</div>}
                                                        {retQty > 0 && (
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 text-[9px] font-bold">
                                                                    <RotateCcw size={8} />
                                                                    {isFullReturn ? 'DEVUELTO' : `Dev: ${retQty}`}
                                                                </span>
                                                                {!isFullReturn && (
                                                                    <span className="text-[9px] text-[var(--color-text-muted)]">Queda: {effectiveQty}</span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3 text-center">
                                                        <span className="px-2 py-1 bg-[var(--glass-bg)] rounded text-[var(--color-text)] text-xs font-bold border border-[var(--glass-border)]">
                                                            {item.quantity}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 text-right">
                                                        <div className={`font-bold text-sm ${isFullReturn ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                                                            {formatCurrency(item.price * item.quantity, currentCurrency)}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--color-text-muted)]">
                                                            {item.quantity} x {formatCurrency(item.price, currentCurrency)}
                                                        </div>
                                                        {retQty > 0 && !isFullReturn && (
                                                            <div className="text-[9px] text-orange-400 font-medium">
                                                                Neto: {formatCurrency(item.price * effectiveQty, currentCurrency)}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>

                                {/* Totals */}
                                <div className="mt-6 space-y-2">
                                    <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(selectedSale.total, currentCurrency)}</span>
                                    </div>
                                    {totalReturned > 0 && (
                                        <div className="flex justify-between text-sm text-orange-400">
                                            <span>Devoluciones</span>
                                            <span>-{formatCurrency(totalReturned, currentCurrency)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                        <span>Impuestos</span>
                                        <span>{formatCurrency(0, currentCurrency)}</span>
                                    </div>
                                    <div className="border-t border-[var(--glass-border)] pt-2 flex justify-between font-bold text-[var(--color-text)]">
                                        <span>Total</span>
                                        <span className="text-[var(--color-primary)] text-lg">{formatCurrency(selectedSale.total - totalReturned, currentCurrency)}</span>
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
                                                <span>{formatCurrency(selectedSale.paymentDetails.amount || selectedSale.total, currentCurrency)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
                                                <span>Vuelto</span>
                                                <span>{formatCurrency(selectedSale.paymentDetails.change || 0, currentCurrency)}</span>
                                            </div>
                                        </>
                                    )}
                                    {selectedSale.paymentMethod === 'Crédito' && (
                                        <div className="flex justify-between text-sm text-[var(--color-text-muted)] mt-2 pt-2 border-t border-[var(--glass-border)]">
                                            <span className="flex items-center gap-1">
                                                <User size={14} className="text-orange-400" />
                                                Cliente Fiado
                                            </span>
                                            <span className="text-orange-400 font-semibold">
                                                {selectedSale.clientName || selectedSale.client_name || 'No especificado'}
                                            </span>
                                        </div>
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

                                {/* Returns History (Mobile) */}
                                {saleReturns.length > 0 && (
                                    <div className="mt-4 p-4 bg-orange-500/10 rounded-xl border border-orange-500/20">
                                        <p className="text-xs text-orange-400 uppercase font-bold mb-3 flex items-center gap-2">
                                            <RotateCcw size={12} />
                                            Devoluciones ({saleReturns.length})
                                        </p>
                                        <div className="space-y-3">
                                            {saleReturns.map((ret) => (
                                                <div key={ret.id} className="p-3 bg-black/20 rounded-lg">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="text-xs text-[var(--color-text-muted)]">
                                                            {formatInCompanyTime(ret.created_at, currentCompanyTimezone, 'dd/MM/yyyy HH:mm')}
                                                        </span>
                                                        <span className="text-sm font-bold text-orange-400">
                                                            -{formatCurrency(ret.total, currentCurrency)}
                                                        </span>
                                                    </div>
                                                    <div className="space-y-1">
                                                        {ret.items.map((item, i) => (
                                                            <div key={i} className="flex justify-between text-xs text-[var(--color-text-muted)]">
                                                                <span>{item.name}</span>
                                                                <span>x{item.quantity}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <p className="text-xs text-orange-300/70 italic mt-2">"{ret.reason}"</p>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-orange-500/20 flex justify-between text-sm">
                                            <span className="text-orange-400 font-bold">Total Devuelto</span>
                                            <span className="text-orange-400 font-bold">
                                                -{formatCurrency(saleReturns.reduce((sum, r) => sum + r.total, 0), currentCurrency)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Mobile Return Modal */}
                    {showReturnModal && selectedSale && (
                        <div className="fixed inset-0 z-[99999]">
                            <ReturnModal
                                sale={selectedSale}
                                onClose={() => setShowReturnModal(false)}
                                onSuccess={handleReturnSuccess}
                            />
                        </div>
                    )}

                    {/* Mobile Cancellation Modal — antes solo existía en la vista de
                        escritorio, por eso en el teléfono "Anular Venta" no hacía nada. */}
                    {showCancelModal && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99999] flex items-center justify-center p-4">
                            <div className="bg-[var(--color-surface)] dark:bg-[#0f0f2d] border border-red-500/20 p-6 rounded-2xl w-full max-w-md shadow-2xl">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                                        <AlertTriangle className="text-red-500" size={24} />
                                        Anular Venta
                                    </h3>
                                    <button
                                        onClick={() => { setShowCancelModal(false); setCancellationReason(''); }}
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
                                        onClick={() => { setShowCancelModal(false); setCancellationReason(''); }}
                                        className="flex-1 px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] rounded-lg text-sm font-bold transition-colors"
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

                    {/* Mobile Return Success Toast */}
                    {returnSuccess && (
                        <div className="fixed top-4 left-4 right-4 z-[99999] bg-green-500/90 text-white px-4 py-3 rounded-xl shadow-lg flex items-center justify-center gap-2">
                            <RotateCcw size={16} />
                            <span className="text-sm font-bold">Devolución: {formatCurrency(returnSuccess, currentCurrency)}</span>
                        </div>
                    )}

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
