import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, FileText, Check, Eye, MessageCircle, Banknote } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import ClientReceiptModal from './ClientReceiptModal';
import ClientPaymentModal from './ClientPaymentModal';

const ClientAccountDetails = ({ client, onBack }) => {
    const { sales, users, registerClientPayment, fetchSales } = useStore();
    const [rawClientSales, setRawClientSales] = useState([]); // All sales for this client
    const [viewMode, setViewMode] = useState('pending'); // 'pending' | 'history'
    const [selectedSale, setSelectedSale] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    // Filters
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');

    // Reload sales on mount to ensure we have real IDs (not optimistic ones)
    useEffect(() => {
        fetchSales();
    }, []);

    useEffect(() => {
        if (client) {
            // Get ALL sales for this client
            const allSales = sales.filter(s => s.clientId === client.id)
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            setRawClientSales(allSales);
        }
    }, [client, sales]);

    if (!client) return null;

    // Calculate Total Debt (Always from pending credit sales)
    const pendingSales = rawClientSales.filter(s =>
        s.paymentMethod === 'Crédito' && s.status !== 'paid' && s.status !== 'cancelled'
    );
    const totalDebt = pendingSales.reduce((sum, sale) => sum + parseFloat(sale.total), 0);

    // Determine which sales to show based on viewMode
    const salesToShow = rawClientSales.filter(sale => {
        // Mode Filter
        if (viewMode === 'pending') {
            if (sale.paymentMethod !== 'Crédito' || sale.status === 'paid' || sale.status === 'cancelled') return false;
        } else {
            // History: Show Paid, Cancelled, or non-credit sales
            // User asked for "ventas pagadas o canceladas", basically history.
            // We usually exclude pending from history to avoid duplication, or show everything?
            // "cambiar de estado de cuentas [pending] a ventas pagadas..." implies they are mutually exclusive sets.
            if (sale.paymentMethod === 'Crédito' && sale.status !== 'paid' && sale.status !== 'cancelled') return false;
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

    const handlePaymentConfirm = async (selectedSalesIds, amount, paymentMethod) => {
        const result = await registerClientPayment(client, amount, selectedSalesIds, paymentMethod);
        if (result.success) {
            setIsPaymentModalOpen(false);
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
        const ticketId = `T-${new Date(sale.date).getTime().toString().slice(-6)}`;

        const formatMoney = (amount) => `$${parseFloat(amount).toLocaleString('es-CL')}`;

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

            const qtyPrice = `${item.quantity} x ${formatMoney(item.price)}`;
            const totalStr = formatMoney(total);

            const spaceNeeded = 27 - qtyPrice.length - totalStr.length;
            const spaces = spaceNeeded > 0 ? ' '.repeat(spaceNeeded) : ' ';

            receiptText += `${qtyPrice}${spaces}${totalStr}\n`;
        });

        receiptText += `---------------------------\n`;

        const totalLabel = "TOTAL";
        const totalValue = formatMoney(sale.total);
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

    return (
        <div className="flex flex-col h-full gap-6 animate-in fade-in duration-300 relative">
            {/* Header / Nav */}
            <div className="flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--color-text)] transition-colors border border-white/10"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                            <FileText className="text-[var(--color-primary)]" />
                            Estado de Cuenta: <span className="text-[var(--color-primary)]">{client.name}</span>
                        </h2>
                        <p className="text-[var(--color-text-muted)] text-sm">{client.rut || 'Sin RUT'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-black/20 p-1 rounded-xl border border-white/10 flex">
                        <button
                            onClick={() => setViewMode('pending')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'pending' ? 'bg-[var(--color-primary)] text-black shadow-lg' : 'text-[var(--color-text-muted)] hover:text-white'}`}
                        >
                            Pendientes
                        </button>
                        <button
                            onClick={() => setViewMode('history')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewMode === 'history' ? 'bg-[var(--color-primary)] text-black shadow-lg' : 'text-[var(--color-text-muted)] hover:text-white'}`}
                        >
                            Historial
                        </button>
                    </div>

                    <button
                        onClick={() => setIsPaymentModalOpen(true)}
                        disabled={pendingSales.length === 0}
                        className="btn-primary px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)] disabled:opacity-50 disabled:shadow-none"
                    >
                        <Banknote size={20} />
                        Abonar / Pagar
                    </button>
                </div>
            </div>

            {/* Dashboard Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
                {/* Total Debt Card */}
                <div className="glass-card p-6 bg-red-500/10 border-red-500/20 relative overflow-hidden group">
                    <div className="relative z-10">
                        <p className="text-red-400 text-sm font-bold uppercase tracking-wider mb-2">Deuda Total</p>
                        <p className="text-4xl font-black text-white tracking-tight">${totalDebt.toLocaleString('es-CL')}</p>
                    </div>
                    <div className="absolute right-[-20px] top-[-20px] opacity-10 group-hover:opacity-20 transition-opacity">
                        <DollarSignIcon size={120} />
                    </div>
                </div>

                {/* Last Purchase Card (Example Placeholder) */}
                <div className="glass-card p-6 bg-[var(--glass-bg)] border-[var(--glass-border)]">
                    <p className="text-[var(--color-text-muted)] text-sm font-bold uppercase tracking-wider mb-2">Último Movimiento</p>
                    <p className="text-xl font-bold text-[var(--color-text)]">
                        {rawClientSales.length > 0 ? new Date(rawClientSales[0].date).toLocaleDateString() : 'N/A'}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {rawClientSales.length > 0 ? 'Registro de cliente' : 'Sin movimientos recientes'}
                    </p>
                </div>
            </div>

            {/* Detailed List */}
            <div className="flex-1 glass-card p-0 overflow-hidden flex flex-col">
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

                <div className="flex-1 overflow-y-auto">
                    {salesToShow.length > 0 ? (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-black/20 sticky top-0 backdrop-blur-md z-10">
                                <tr>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Fecha</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Detalle</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider text-right">Monto</th>
                                    <th className="p-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {salesToShow.map(sale => (
                                    <tr key={sale.id} className="hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => setSelectedSale(sale)}>
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
                                            {sale.paymentMethod === 'Crédito' && sale.status === 'paid' && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                                                    DEUDA PAGADA
                                                </span>
                                            )}
                                            {sale.status === 'cancelled' && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                                                    ANULADO
                                                </span>
                                            )}
                                            {/* Check if it's an Abono/Payment Receipt */}
                                            {sale.status === 'completed' && sale.summary.includes('Abono') && (
                                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                                    COMPROBANTE DE PAGO
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            {(() => {
                                                // Determine styling based on type
                                                const isAbono = sale.status === 'completed' && sale.summary.includes('Abono');
                                                const isPaid = sale.status === 'paid';
                                                const isCancelled = sale.status === 'cancelled';

                                                let colorClass = 'text-red-400'; // Default negative/debt
                                                let sign = '-';

                                                if (isCancelled) {
                                                    colorClass = 'line-through text-[var(--color-text-muted)]';
                                                } else if (isAbono) {
                                                    colorClass = 'text-blue-400'; // Payment received
                                                    sign = '+';
                                                } else if (isPaid) {
                                                    colorClass = 'text-green-400'; // Debt settled
                                                    // sign stays '-' because it was a cost, but now green to show it's okay
                                                }

                                                return (
                                                    <span className={`font-bold text-sm ${colorClass}`}>
                                                        {sign}${Math.abs(parseFloat(sale.total)).toLocaleString('es-CL')}
                                                    </span>
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
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)] gap-4 opacity-50">
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
                sales={sales}
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
