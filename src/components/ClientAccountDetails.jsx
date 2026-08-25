import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, FileText, Check, Eye, MessageCircle, Banknote, Shield, ShieldAlert, ShieldOff, AlertTriangle, Clock, Download, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import ClientReceiptModal from './ClientReceiptModal';
import ClientPaymentModal from './ClientPaymentModal';
import { formatCurrency } from '../utils/formatCurrency';

import { usePermissions } from '../hooks/usePermissions';
import AccessDenied from './auth/AccessDenied';
import { generateAccountStatementPDF } from '../utils/generateAccountPDF';
import { tieneDeuda, estaSaldada } from '../utils/deuda';

const ClientAccountDetails = ({ client, onBack }) => {
    const { users, registerClientPayment, fetchClientSales, currentCurrency, activeCompanyId } = useStore();
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const { can } = usePermissions();

    const [rawClientSales, setRawClientSales] = useState([]); // All sales for this client
    const [viewMode, setViewMode] = useState('pending'); // 'pending' | 'history'
    const [selectedSale, setSelectedSale] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    // Ventas tildadas para abonar solo esas. Guarda ids; qué significa cada id se
    // resuelve más abajo contra lo que hay en pantalla.
    const [seleccionadas, setSeleccionadas] = useState(() => new Set());
    // Ids que se le pasan al modal: null = repartir sobre toda la deuda (lo de siempre).
    const [idsAPagar, setIdsAPagar] = useState(null);

    // Filters
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');

    useEffect(() => {
        let mounted = true;

        const loadClientData = async () => {
            if (client) {
                const clientSales = await fetchClientSales(client.id);
                if (mounted) {
                    setRawClientSales(clientSales);
                }
            }
        };

        loadClientData();
        setSeleccionadas(new Set());

        return () => { mounted = false; };
    }, [client]);

    // El historial no se abona: al cambiar de pestaña la selección deja de tener sentido.
    useEffect(() => { setSeleccionadas(new Set()); }, [viewMode]);

    // Permission Check
    if (!can('clients.view_account')) {
        return <AccessDenied />;
    }

    if (!client) return null;

    // Calculate Total Debt (Always from pending credit sales).
    // `tieneDeuda` también descarta las que quedaron con un resto de centavos por
    // el redondeo de un abono: en la base siguen 'completed', pero no se les puede
    // cobrar nada. Ver src/utils/deuda.js
    const pendingSales = rawClientSales.filter(tieneDeuda);
    const totalDebt = pendingSales.reduce((sum, sale) => sum + parseFloat(sale.total) - parseFloat(sale.amount_paid || 0), 0);

    // Credit status info
    const creditLimit = parseFloat(client.credit_limit || 0);
    const creditEnabled = client.credit_enabled === 1 || client.credit_enabled === true;
    const clientStatus = client.client_status || 'active';
    const availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - totalDebt) : null;
    const creditUsagePercent = creditLimit > 0 ? Math.min(100, (totalDebt / creditLimit) * 100) : 0;
    const overdueCount = pendingSales.filter(s => s.payment_due_date && new Date(s.payment_due_date) < new Date()).length;
    const oldestOverdue = pendingSales
        .filter(s => s.payment_due_date && new Date(s.payment_due_date) < new Date())
        .sort((a, b) => new Date(a.payment_due_date) - new Date(b.payment_due_date))[0];
    const oldestOverdueDays = oldestOverdue ? Math.floor((Date.now() - new Date(oldestOverdue.payment_due_date).getTime()) / (1000 * 60 * 60 * 24)) : 0;

    // Determine which sales to show based on viewMode
    const salesToShow = rawClientSales.filter(sale => {
        // Mode Filter
        if (viewMode === 'pending') {
            if (!tieneDeuda(sale)) return false;
        } else {
            // History: Show Paid, Cancelled, or non-credit sales
            // User asked for "ventas pagadas o canceladas", basically history.
            // We usually exclude pending from history to avoid duplication, or show everything?
            // "cambiar de estado de cuentas [pending] a ventas pagadas..." implies they are mutually exclusive sets.
            if (tieneDeuda(sale)) return false;
        }

        // Apply Common Filters (Date/Amount)
        const saleDate = new Date(sale.date).toISOString().split('T')[0];
        const amount = parseFloat(sale.total);

        if (startDate && saleDate < startDate) return false;
        if (endDate && saleDate > endDate) return false;
        if (minAmount && amount < parseFloat(minAmount)) return false;
        if (maxAmount && amount > parseFloat(maxAmount)) return false;

        return true;
    });

    // Solo se puede seleccionar lo que está a la vista: si un filtro de fecha o
    // monto esconde una venta tildada, deja de contar. Así lo que dice la barra
    // ("3 seleccionadas") siempre coincide con lo que el ojo ve en la tabla.
    const puedeSeleccionar = viewMode === 'pending' && can('clients.manage_payments');
    const ventasSeleccionadas = puedeSeleccionar
        ? salesToShow.filter(s => seleccionadas.has(s.id))
        : [];
    const totalSeleccionado = ventasSeleccionadas.reduce(
        (suma, s) => suma + (parseFloat(s.total) - parseFloat(s.amount_paid || 0)), 0
    );
    const todasTildadas = salesToShow.length > 0 && ventasSeleccionadas.length === salesToShow.length;

    const alternarVenta = (id) => {
        setSeleccionadas(previas => {
            const copia = new Set(previas);
            if (copia.has(id)) copia.delete(id); else copia.add(id);
            return copia;
        });
    };

    const alternarTodas = () => {
        setSeleccionadas(todasTildadas ? new Set() : new Set(salesToShow.map(s => s.id)));
    };

    const abrirAbono = (ids = null) => {
        setIdsAPagar(ids);
        setIsPaymentModalOpen(true);
    };

    const handlePaymentConfirm = async (distribution, amount, paymentMethod) => {
        const result = await registerClientPayment(client, amount, distribution, paymentMethod);
        if (result.success) {
            setIsPaymentModalOpen(false);
            setSeleccionadas(new Set());
            setIdsAPagar(null);
            // Reload client sales to reflect partial payments
            const updatedSales = await fetchClientSales(client.id);
            setRawClientSales(updatedSales);
        } else {
            alert("Error al procesar el abono: " + result.error);
        }
    };


    const handleWhatsAppShare = (e, sale) => {
        e.stopPropagation();

        const cleanNumber = client.phone ? client.phone.replace(/\D/g, '') : '';
        const fullNumber = cleanNumber ? `569${cleanNumber}` : '';

        const seller = users.find(u => u.id === sale.user_id);
        const sellerName = seller?.name || 'Vendedor';

        const date = new Date(sale.date).toLocaleString('es-CL');
        const ticketId = sale.id ? `${sale.id}` : `${new Date(sale.date).getTime().toString().slice(-6)}`;



        let receiptText = `*COMPROBANTE DETALLE*\n`;
        receiptText += `Sotomayor 1460-A\n\n`;
        receiptText += `Boleta: ${ticketId}\n`;
        receiptText += `Fecha: ${date}\n`;
        receiptText += `Vend: ${sellerName}\n`;
        receiptText += `Cliente: ${client.name}\n`;
        receiptText += `--------------------------------\n`;
        receiptText += `\`\`\``;

        receiptText += `DESCRIPCION           TOTAL\n`;
        receiptText += `---------------------------\n`;

        sale.items.forEach(item => {
            const name = item.name.length > 20 ? item.name.substring(0, 20) : item.name;
            const total = item.price * item.quantity;
            receiptText += `${name}\n`;

            const qtyPrice = `${item.quantity} x ${formatCurrency(item.price, currentCurrency)}`;
            const totalStr = formatCurrency(total, currentCurrency);

            const spaceNeeded = 27 - qtyPrice.length - totalStr.length;
            const spaces = spaceNeeded > 0 ? ' '.repeat(spaceNeeded) : ' ';

            receiptText += `${qtyPrice}${spaces}${totalStr}\n`;
        });

        receiptText += `---------------------------\n`;

        const totalLabel = "TOTAL";
        const totalValue = formatCurrency(sale.total, currentCurrency);
        const totalSpaces = 27 - totalLabel.length - totalValue.length;
        receiptText += `${totalLabel}${' '.repeat(totalSpaces > 0 ? totalSpaces : 1)}${totalValue}\n`;

        receiptText += `\`\`\``;
        receiptText += `\nEstado: ${sale.status === 'paid' ? 'PAGADO' : 'PENDIENTE'}\n`;
        receiptText += `\n*¡GRACIAS POR SU PREFERENCIA!*`;

        const encodedMessage = encodeURIComponent(receiptText);
        const url = fullNumber
            ? `https://wa.me/${fullNumber}?text=${encodedMessage}`
            : `https://wa.me/?text=${encodedMessage}`;

        window.open(url, '_blank');
    };

    // Helpers de render reutilizados por la tabla (escritorio) y las tarjetas (móvil).
    const renderVence = (sale) => {
        if (!sale.payment_due_date) return <span className="text-[var(--color-text-muted)] text-xs">-</span>;
        const dueDate = new Date(sale.payment_due_date);
        const daysLeft = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
        const isPaid = sale.status === 'paid';
        const isCancelled = sale.status === 'cancelled';
        if (isPaid || isCancelled) return <span className="text-[var(--color-text-muted)]">{dueDate.toLocaleDateString()}</span>;
        if (daysLeft < 0) return <span className="text-red-400 font-bold flex items-center gap-1"><AlertTriangle size={14} />Vencido ({Math.abs(daysLeft)}d)</span>;
        if (daysLeft <= 3) return <span className="text-yellow-400 font-medium flex items-center gap-1"><Clock size={14} />{daysLeft === 0 ? 'Hoy' : `${daysLeft}d`}</span>;
        return <span className="text-green-400">{dueDate.toLocaleDateString()}</span>;
    };

    const renderMonto = (sale) => {
        const isAbono = sale.status === 'completed' && sale.summary?.includes('Abono');
        const isPaid = sale.status === 'paid';
        const isCancelled = sale.status === 'cancelled';
        const hasPartialPayment = parseFloat(sale.amount_paid || 0) > 0 && !isPaid && !isCancelled;
        const saleTotal = Math.abs(parseFloat(sale.total));
        const remaining = saleTotal - parseFloat(sale.amount_paid || 0);
        let colorClass = 'text-red-400';
        let sign = '-';
        if (isCancelled) colorClass = 'line-through text-[var(--color-text-muted)]';
        else if (isAbono) { colorClass = 'text-blue-400'; sign = '+'; }
        else if (isPaid) colorClass = 'text-green-400';
        return (
            <div className="text-right">
                <span className={`font-bold text-sm ${colorClass}`}>{sign}{formatCurrency(saleTotal, currentCurrency)}</span>
                {hasPartialPayment && <p className="text-[10px] text-yellow-400/80 mt-0.5">Resta: {formatCurrency(remaining, currentCurrency)}</p>}
            </div>
        );
    };

    const renderBadges = (sale) => (
        <>
            {sale.payment_method === 'Crédito' && sale.status === 'paid' && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">DEUDA PAGADA</span>
            )}
            {sale.payment_method === 'Crédito' && sale.status !== 'paid' && sale.status !== 'cancelled' && parseFloat(sale.amount_paid || 0) > 0 && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">ABONO PARCIAL: {formatCurrency(parseFloat(sale.amount_paid), currentCurrency)} / {formatCurrency(parseFloat(sale.total), currentCurrency)}</span>
            )}
            {sale.status === 'cancelled' && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">ANULADO</span>
            )}
            {sale.status === 'completed' && sale.summary?.includes('Abono') && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">COMPROBANTE DE PAGO</span>
            )}
        </>
    );

    return (
        <div className="flex flex-col h-full gap-4 lg:gap-6 overflow-y-auto overflow-x-hidden lg:overflow-hidden animate-in fade-in duration-300 relative">
            {/* Header / Nav — en móvil se apila en vertical para no desbordar el ancho. */}
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 lg:gap-4 shrink-0">
                {/* Título: "Estado de Cuenta" arriba; nombre y RUT debajo. */}
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--color-text)] transition-colors border border-white/10 shrink-0"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0">
                        <h2 className="text-base lg:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                            <FileText className="text-[var(--color-primary)] shrink-0" size={20} />
                            <span>Estado de Cuenta</span>
                        </h2>
                        <p className="text-[var(--color-primary)] font-bold text-sm lg:text-base truncate">{client.name}</p>
                        <p className="text-[var(--color-text-muted)] text-xs">{client.rut || 'Sin RUT'}</p>
                    </div>
                </div>

                {/* Controles: en móvil van full-width y apilados (no a un lado). */}
                <div className="flex flex-col sm:flex-row lg:items-center gap-2 shrink-0">
                    <div className="bg-black/20 p-1 rounded-xl border border-white/10 flex">
                        <button
                            onClick={() => setViewMode('pending')}
                            className={`flex-1 lg:flex-none px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'pending' ? 'bg-[var(--color-primary)] text-black shadow-lg' : 'text-[var(--color-text-muted)] hover:text-white'}`}
                        >
                            Pendientes
                        </button>
                        <button
                            onClick={() => setViewMode('history')}
                            className={`flex-1 lg:flex-none px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'history' ? 'bg-[var(--color-primary)] text-black shadow-lg' : 'text-[var(--color-text-muted)] hover:text-white'}`}
                        >
                            Historial
                        </button>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                setIsGeneratingPDF(true);
                                try {
                                    await generateAccountStatementPDF({
                                        client,
                                        pendingSales,
                                        allSales: rawClientSales,
                                        totalDebt,
                                        creditLimit,
                                        creditEnabled,
                                        clientStatus,
                                        activeCompanyId,
                                        currentCurrency,
                                        users
                                    });
                                } catch (e) {
                                    console.error('Error generating PDF:', e);
                                } finally {
                                    setIsGeneratingPDF(false);
                                }
                            }}
                            disabled={isGeneratingPDF}
                            className="flex-1 lg:flex-none justify-center px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 border border-[var(--color-primary)]/50 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-all disabled:opacity-50 text-sm"
                        >
                            <Download size={18} className={isGeneratingPDF ? 'animate-bounce' : ''} />
                            {isGeneratingPDF ? 'Generando...' : 'Descargar PDF'}
                        </button>

                        {can('clients.manage_payments') && (
                            <button
                                onClick={() => abrirAbono(null)}
                                disabled={pendingSales.length === 0}
                                className="flex-1 lg:flex-none justify-center btn-primary px-4 lg:px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)] disabled:opacity-50 disabled:shadow-none text-sm"
                            >
                                <Banknote size={20} />
                                Abonar / Pagar
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Dashboard Cards — 2×2 en móvil, 4 en fila en escritorio. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-4 shrink-0">
                {/* Total Debt Card */}
                <div className="glass-card p-3 lg:p-6 bg-red-500/10 border-red-500/20 relative overflow-hidden group">
                    <div className="relative z-10">
                        <p className="text-red-400 text-xs lg:text-sm font-bold uppercase tracking-wider mb-2">Deuda Total</p>
                        <p className="text-xl lg:text-4xl font-black text-white tracking-tight break-words">{formatCurrency(totalDebt, currentCurrency)}</p>
                    </div>
                    <div className="absolute right-[-20px] top-[-20px] opacity-10 group-hover:opacity-20 transition-opacity">
                        <DollarSignIcon size={120} />
                    </div>
                </div>

                {/* Credit Limit Card */}
                <div className="glass-card p-3 lg:p-6 bg-[var(--glass-bg)] border-[var(--glass-border)]">
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm font-bold uppercase tracking-wider mb-2">Límite de Crédito</p>
                    {creditLimit > 0 ? (
                        <>
                            <p className="text-base lg:text-xl font-bold text-[var(--color-text)]">{formatCurrency(creditLimit, currentCurrency)}</p>
                            <div className="mt-2 w-full bg-white/10 rounded-full h-2">
                                <div
                                    className={cn(
                                        'h-2 rounded-full transition-all',
                                        creditUsagePercent >= 95 ? 'bg-red-500' :
                                        creditUsagePercent >= 80 ? 'bg-yellow-500' : 'bg-green-500'
                                    )}
                                    style={{ width: `${creditUsagePercent}%` }}
                                />
                            </div>
                            <p className="text-xs text-[var(--color-text-muted)] mt-1">{creditUsagePercent.toFixed(0)}% utilizado</p>
                        </>
                    ) : (
                        <p className="text-base lg:text-xl font-bold text-[var(--color-text)]">Sin límite</p>
                    )}
                </div>

                {/* Available Credit / Status Card */}
                <div className={cn(
                    'glass-card p-3 lg:p-6',
                    overdueCount > 0 ? 'bg-red-500/10 border-red-500/20' :
                    clientStatus !== 'active' ? 'bg-orange-500/10 border-orange-500/20' :
                    'bg-green-500/10 border-green-500/20'
                )}>
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm font-bold uppercase tracking-wider mb-2">Estado</p>
                    {overdueCount > 0 ? (
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="text-red-400" size={24} />
                            <div>
                                <p className="text-base lg:text-xl font-bold text-red-400">Moroso</p>
                                <p className="text-xs text-red-400/80">{oldestOverdueDays} días de atraso • {overdueCount} deuda{overdueCount > 1 ? 's' : ''}</p>
                            </div>
                        </div>
                    ) : clientStatus === 'blocked' ? (
                        <div className="flex items-center gap-2">
                            <ShieldAlert className="text-red-400" size={24} />
                            <p className="text-base lg:text-xl font-bold text-red-400">Bloqueado</p>
                        </div>
                    ) : clientStatus === 'credit_blocked' ? (
                        <div className="flex items-center gap-2">
                            <ShieldOff className="text-orange-400" size={24} />
                            <p className="text-base lg:text-xl font-bold text-orange-400">Sin Crédito</p>
                        </div>
                    ) : !creditEnabled ? (
                        <div className="flex items-center gap-2">
                            <ShieldOff className="text-orange-400" size={24} />
                            <p className="text-base lg:text-xl font-bold text-orange-400">Crédito OFF</p>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Shield className="text-green-400" size={24} />
                            <p className="text-base lg:text-xl font-bold text-green-400">Al Día</p>
                        </div>
                    )}
                </div>

                {/* Last Movement Card */}
                <div className="glass-card p-3 lg:p-6 bg-[var(--glass-bg)] border-[var(--glass-border)]">
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm font-bold uppercase tracking-wider mb-2">Último Movimiento</p>
                    <p className="text-base lg:text-xl font-bold text-[var(--color-text)]">
                        {rawClientSales.length > 0 ? new Date(rawClientSales[0].date).toLocaleDateString() : 'N/A'}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {creditLimit > 0 && availableCredit !== null
                            ? `Disponible: ${formatCurrency(availableCredit, currentCurrency)}`
                            : rawClientSales.length > 0 ? `Plazo: ${client.credit_period_days || 30} días` : 'Sin movimientos'
                        }
                    </p>
                </div>
            </div>

            {/* Detailed List */}
            <div className="shrink-0 lg:flex-1 lg:min-h-0 glass-card p-0 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-[var(--color-text)]">
                            {viewMode === 'pending' ? 'Movimientos Pendientes' : 'Historial de Pagos y Ventas'}
                        </h3>
                        <span className={cn(
                            "text-xs px-2 py-1 rounded-full font-bold",
                            viewMode === 'pending' ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                        )}>
                            {salesToShow.length} Registros
                        </span>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="flex items-center gap-2 bg-white/5 rounded-lg p-1 border border-white/10">
                            <span className="text-xs text-[var(--color-text-muted)] pl-2 font-medium uppercase">Fecha:</span>
                            <input
                                type="date"
                                className="bg-transparent text-sm text-[var(--color-text)] p-1 outline-none border-b border-transparent focus:border-[var(--color-primary)] transition-colors w-32"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                placeholder="Desde"
                            />
                            <span className="text-[var(--color-text-muted)] text-xs">-</span>
                            <input
                                type="date"
                                className="bg-transparent text-sm text-[var(--color-text)] p-1 outline-none border-b border-transparent focus:border-[var(--color-primary)] transition-colors w-32"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                placeholder="Hasta"
                            />
                        </div>

                        <div className="flex items-center gap-2 bg-white/5 rounded-lg p-1 border border-white/10">
                            <span className="text-xs text-[var(--color-text-muted)] pl-2 font-medium uppercase">Monto ($):</span>
                            <input
                                type="number"
                                className="bg-transparent text-sm text-[var(--color-text)] p-1 outline-none border-b border-transparent focus:border-[var(--color-primary)] transition-colors w-24"
                                value={minAmount}
                                onChange={(e) => setMinAmount(e.target.value)}
                                placeholder="Min"
                            />
                            <span className="text-[var(--color-text-muted)] text-xs">-</span>
                            <input
                                type="number"
                                className="bg-transparent text-sm text-[var(--color-text)] p-1 outline-none border-b border-transparent focus:border-[var(--color-primary)] transition-colors w-24"
                                value={maxAmount}
                                onChange={(e) => setMaxAmount(e.target.value)}
                                placeholder="Max"
                            />
                        </div>

                        <button
                            onClick={() => { setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); }}
                            className="text-xs text-[var(--color-text-muted)] hover:text-white underline decoration-dashed"
                        >
                            Limpiar
                        </button>
                    </div>
                </div>

                {/* Barra de acción: aparece solo cuando hay ventas tildadas. */}
                {ventasSeleccionadas.length > 0 && (
                    <div className="px-4 py-3 border-b border-cyan-500/30 bg-cyan-500/10 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm">
                            <span className="font-bold text-cyan-300">
                                {ventasSeleccionadas.length} venta{ventasSeleccionadas.length === 1 ? '' : 's'} seleccionada{ventasSeleccionadas.length === 1 ? '' : 's'}
                            </span>
                            <span className="text-[var(--color-text-muted)]"> · deuda de estas: </span>
                            <span className="font-bold text-[var(--color-text)]">
                                {formatCurrency(totalSeleccionado, currentCurrency)}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setSeleccionadas(new Set())}
                                className="text-xs text-[var(--color-text-muted)] hover:text-white flex items-center gap-1 px-2 py-1.5"
                            >
                                <X size={14} /> Limpiar
                            </button>
                            <button
                                onClick={() => abrirAbono(ventasSeleccionadas.map(v => v.id))}
                                className="btn-primary px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm"
                            >
                                <Banknote size={18} />
                                Abonar solo estas
                            </button>
                        </div>
                    </div>
                )}

                <div className="lg:flex-1 lg:overflow-y-auto">
                    {salesToShow.length > 0 ? (
                        <>
                        {/* MÓVIL: cada movimiento es una tarjeta con TODO el detalle
                            (sin scroll horizontal). */}
                        <div className="lg:hidden divide-y divide-[var(--glass-border)]">
                            {salesToShow.map(sale => (
                                // Era un <button> con más botones adentro (WhatsApp, Ver detalle),
                                // que no es HTML válido y encima ahora tiene que llevar una casilla.
                                // Pasa a <div>: el detalle se sigue abriendo al tocar la tarjeta.
                                <div
                                    key={sale.id}
                                    onClick={() => setSelectedSale(sale)}
                                    className={cn(
                                        "w-full text-left p-3 flex flex-col gap-2 transition-colors cursor-pointer",
                                        seleccionadas.has(sale.id) ? "bg-cyan-500/10" : "hover:bg-white/5 active:bg-white/10"
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                                            {puedeSeleccionar && (
                                                <input
                                                    type="checkbox"
                                                    checked={seleccionadas.has(sale.id)}
                                                    onChange={() => alternarVenta(sale.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-4 h-4 shrink-0 accent-[var(--color-primary)] cursor-pointer"
                                                    aria-label="Seleccionar esta venta para abonar"
                                                />
                                            )}
                                            <Calendar size={12} className="shrink-0" />
                                            {new Date(sale.date).toLocaleString()}
                                        </div>
                                        {renderMonto(sale)}
                                    </div>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[var(--color-text)] font-medium text-sm">{sale.summary}</p>
                                            <p className="text-xs text-[var(--color-text-muted)] italic mt-0.5">{sale.observation || 'Sin observaciones'}</p>
                                            <div className="flex flex-wrap gap-1">{renderBadges(sale)}</div>
                                        </div>
                                        <div className="text-sm text-right shrink-0">{renderVence(sale)}</div>
                                    </div>
                                    <div className="flex gap-2 pt-1">
                                        <button
                                            onClick={(e) => handleWhatsAppShare(e, sale)}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-500/10 text-green-400 rounded-lg text-xs font-bold"
                                        >
                                            <MessageCircle size={14} /> WhatsApp
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedSale(sale); }}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-cyan-500/10 text-cyan-400 rounded-lg text-xs font-bold"
                                        >
                                            <Eye size={14} /> Ver detalle
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ESCRITORIO: tabla */}
                        <table className="hidden lg:table w-full text-left border-collapse">
                            <thead className="bg-black/20 sticky top-0 backdrop-blur-md z-10">
                                <tr>
                                    {puedeSeleccionar && (
                                        <th className="p-4 w-10">
                                            <input
                                                type="checkbox"
                                                checked={todasTildadas}
                                                ref={el => { if (el) el.indeterminate = ventasSeleccionadas.length > 0 && !todasTildadas; }}
                                                onChange={alternarTodas}
                                                className="w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
                                                aria-label="Seleccionar todas las ventas de la lista"
                                            />
                                        </th>
                                    )}
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Fecha</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Detalle</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Vence</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider text-right">Monto</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {salesToShow.map(sale => (
                                    <tr
                                        key={sale.id}
                                        className={cn(
                                            "transition-colors group cursor-pointer",
                                            seleccionadas.has(sale.id) ? "bg-cyan-500/10" : "hover:bg-white/5"
                                        )}
                                        onClick={() => setSelectedSale(sale)}
                                    >
                                        {puedeSeleccionar && (
                                            <td className="p-4 w-10" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={seleccionadas.has(sale.id)}
                                                    onChange={() => alternarVenta(sale.id)}
                                                    className="w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
                                                    aria-label="Seleccionar esta venta para abonar"
                                                />
                                            </td>
                                        )}
                                        <td className="p-4 text-[var(--color-text-muted)] text-sm whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} />
                                                {new Date(sale.date).toLocaleString()}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <p className="text-[var(--color-text)] font-medium text-sm">{sale.summary}</p>
                                            <p className="text-xs text-[var(--color-text-muted)] italic mt-0.5">{sale.observation || 'Sin observaciones'}</p>

                                            {/* STATUS BADGES */}
                                            {sale.payment_method === 'Crédito' && sale.status === 'paid' && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                                                    DEUDA PAGADA
                                                </span>
                                            )}
                                            {/* Solo si de verdad falta plata: un "ABONO PARCIAL: $6.082 / $6.082"
                                                con Resta $0 decía lo contrario de lo que pasaba. */}
                                            {tieneDeuda(sale) && parseFloat(sale.amount_paid || 0) > 0 && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                                                    ABONO PARCIAL: {formatCurrency(parseFloat(sale.amount_paid), currentCurrency)} / {formatCurrency(parseFloat(sale.total), currentCurrency)}
                                                </span>
                                            )}
                                            {sale.payment_method === 'Crédito' && sale.status !== 'paid' && sale.status !== 'cancelled' && estaSaldada(sale) && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                                                    SALDADA
                                                </span>
                                            )}
                                            {sale.status === 'cancelled' && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                                                    ANULADO
                                                </span>
                                            )}
                                            {/* Check if it's an Abono/Payment Receipt */}
                                            {sale.status === 'completed' && sale.summary?.includes('Abono') && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                                    COMPROBANTE DE PAGO
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-sm whitespace-nowrap">
                                            {sale.payment_due_date ? (() => {
                                                const dueDate = new Date(sale.payment_due_date);
                                                const now = new Date();
                                                const daysLeft = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                                                const isPaid = sale.status === 'paid';
                                                const isCancelled = sale.status === 'cancelled';
                                                
                                                if (isPaid || isCancelled) {
                                                    return <span className="text-[var(--color-text-muted)]">{dueDate.toLocaleDateString()}</span>;
                                                }
                                                if (daysLeft < 0) {
                                                    return (
                                                        <span className="text-red-400 font-bold flex items-center gap-1">
                                                            <AlertTriangle size={14} />
                                                            Vencido ({Math.abs(daysLeft)}d)
                                                        </span>
                                                    );
                                                }
                                                if (daysLeft <= 3) {
                                                    return (
                                                        <span className="text-yellow-400 font-medium flex items-center gap-1">
                                                            <Clock size={14} />
                                                            {daysLeft === 0 ? 'Hoy' : `${daysLeft}d`}
                                                        </span>
                                                    );
                                                }
                                                return <span className="text-green-400">{dueDate.toLocaleDateString()}</span>;
                                            })() : (
                                                <span className="text-[var(--color-text-muted)] text-xs">-</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            {(() => {
                                                // Determine styling based on type
                                                const isAbono = sale.status === 'completed' && sale.summary?.includes('Abono');
                                                const isPaid = sale.status === 'paid';
                                                const isCancelled = sale.status === 'cancelled';
                                                const hasPartialPayment = parseFloat(sale.amount_paid || 0) > 0 && !isPaid && !isCancelled;
                                                const saleTotal = Math.abs(parseFloat(sale.total));
                                                const remaining = saleTotal - parseFloat(sale.amount_paid || 0);

                                                let colorClass = 'text-red-400'; // Default negative/debt
                                                let sign = '-';

                                                if (isCancelled) {
                                                    colorClass = 'line-through text-[var(--color-text-muted)]';
                                                } else if (isAbono) {
                                                    colorClass = 'text-blue-400'; // Payment received
                                                    sign = '+';
                                                } else if (isPaid) {
                                                    colorClass = 'text-green-400'; // Debt settled
                                                }

                                                return (
                                                    <div className="text-right">
                                                        <span className={`font-bold text-sm ${colorClass}`}>
                                                            {sign}{formatCurrency(saleTotal, currentCurrency)}
                                                        </span>
                                                        {hasPartialPayment && (
                                                            <p className="text-[10px] text-yellow-400/80 mt-0.5">
                                                                Resta: {formatCurrency(remaining, currentCurrency)}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => handleWhatsAppShare(e, sale)}
                                                    className="p-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg transition-colors"
                                                    title="Enviar por WhatsApp"
                                                >
                                                    <MessageCircle size={16} />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedSale(sale);
                                                    }}
                                                    className="p-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg transition-colors"
                                                    title="Ver Detalle"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </>
                    ) : (
                        <div className="min-h-[200px] lg:h-full flex flex-col items-center justify-center text-[var(--color-text-muted)] gap-4 opacity-50">
                            <Check size={64} />
                            <p className="text-lg font-medium">No hay registros</p>
                        </div>
                    )}
                </div>
            </div>

            <ClientReceiptModal
                isOpen={!!selectedSale}
                onClose={() => setSelectedSale(null)}
                sale={selectedSale}
                client={client}
            />

            <ClientPaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                client={client}
                sales={rawClientSales}
                soloVentas={idsAPagar}
                onConfirm={handlePaymentConfirm}
            />
        </div>
    );
};

const DollarSignIcon = ({ size }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="12" x2="12" y1="2" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
);

export default ClientAccountDetails;
