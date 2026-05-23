import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search, ShoppingCart, Trash2, Plus, Minus, X, Clock, Phone, User,
    MapPin, FileText, Calendar, ChevronDown, Check, DollarSign, Package,
    ClipboardList, Truck, AlertCircle, CreditCard, Banknote, ArrowRight, CakeSlice, Printer
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import OptimizedImage from '../components/OptimizedImage';
import ClientSearchWidget from '../components/ClientSearchWidget';
import DeliveryCheckoutModal from '../components/DeliveryCheckoutModal';
import QuickPreorderProductModal from '../components/QuickPreorderProductModal';
import PaymentDetailPicker from '../components/PaymentDetailPicker';
import { printPreorder } from '../utils/printPreorder';

const STATUS_CONFIG = {
    pending: { label: 'Pendiente', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock, next: 'preparing' },
    preparing: { label: 'Preparando', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Package, next: 'ready' },
    ready: { label: 'Listo', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: Check, next: 'delivered' },
    delivered: { label: 'Entregado', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: Truck, next: null },
    canceled: { label: 'Cancelado', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: X, next: null }
};

const STATUS_NEXT_LABEL = {
    pending: 'Preparar',
    preparing: 'Marcar Listo',
    ready: 'Entregar',
};

// ===== Confirm Preorder Modal =====
const ConfirmPreorderModal = ({ isOpen, onClose, onConfirm, cart, total, currentCurrency }) => {
    const { clients } = useStore();
    const [dueDate, setDueDate] = useState('today');
    const [customDate, setCustomDate] = useState('');
    const [dueTime, setDueTime] = useState('10:00');
    const [depositAmount, setDepositAmount] = useState('');
    const [depositMethod, setDepositMethod] = useState('Efectivo');
    const [depositTerminalId, setDepositTerminalId] = useState(null);
    const [depositBankAccountId, setDepositBankAccountId] = useState(null);
    const [deliveryType, setDeliveryType] = useState('pickup');
    const [deliveryAddress, setDeliveryAddress] = useState('');
    const [notes, setNotes] = useState('');
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [selectedClient, setSelectedClient] = useState(null);
    const [clientSearch, setClientSearch] = useState('');
    const [showClientDropdown, setShowClientDropdown] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const filteredClients = clientSearch.length > 0
        ? clients.filter(c =>
            c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
            (c.phone && c.phone.includes(clientSearch))
        ).slice(0, 5)
        : [];

    const getActualDate = () => {
        if (dueDate === 'today') return new Date().toLocaleDateString('en-CA');
        if (dueDate === 'tomorrow') {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return d.toLocaleDateString('en-CA');
        }
        return customDate;
    };

    const deposit = parseFloat(depositAmount) || 0;
    const remaining = total ? (total - deposit) : null; // If total is pending (null), remaining is pending

    const isPendingTotal = total === null;

    const handleSubmit = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        await onConfirm({
            client_id: selectedClient?.id || null,
            client_name: selectedClient?.name || clientName,
            client_phone: selectedClient?.phone || clientPhone,
            due_date: getActualDate(),
            due_time: dueTime,
            total_amount: total || 0, // 0 if pending
            deposit_amount: deposit,
            deposit_method: depositMethod,
            deposit_terminal_id: depositMethod === 'Tarjeta' ? depositTerminalId : null,
            deposit_bank_account_id: depositMethod === 'Transferencia' ? depositBankAccountId : null,
            delivery_type: deliveryType,
            delivery_address: deliveryAddress,
            notes,
            items: cart
        });
        setIsSubmitting(false);
    };

    if (!isOpen) return null;

    const timeSlots = [];
    for (let h = 6; h <= 22; h++) {
        for (let m = 0; m < 60; m += 15) {
            timeSlots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="glass-card w-full max-w-lg my-auto animate-[float_0.3s_ease-out] max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <ClipboardList className="text-[var(--color-primary)]" size={24} />
                        Confirmar Encargo
                    </h2>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5">
                    {/* Client */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                            <User size={16} className="text-[var(--color-primary)]" />
                            Cliente
                        </label>
                        {selectedClient ? (
                            <div className="flex items-center justify-between bg-[var(--color-primary)]/10 border border-[var(--color-primary)] rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2">
                                    <User size={16} className="text-[var(--color-primary)]" />
                                    <span className="text-sm font-medium text-[var(--color-text)]">{selectedClient.name}</span>
                                    {selectedClient.phone && <span className="text-xs text-[var(--color-text-muted)]">{selectedClient.phone}</span>}
                                </div>
                                <button onClick={() => { setSelectedClient(null); setClientSearch(''); }}
                                    className="text-[var(--color-text-muted)] hover:text-red-400 p-1">
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Buscar o escribir nombre..."
                                    className="glass-input w-full text-sm"
                                    value={clientSearch}
                                    onChange={e => { setClientSearch(e.target.value); setClientName(e.target.value); setShowClientDropdown(true); }}
                                    onFocus={() => setShowClientDropdown(true)}
                                />
                                {showClientDropdown && filteredClients.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#18181b] border border-[var(--glass-border)] shadow-xl z-50 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                                        {filteredClients.map(c => (
                                            <button key={c.id} onClick={() => { setSelectedClient(c); setClientSearch(c.name); setClientName(c.name); setClientPhone(c.phone || ''); setShowClientDropdown(false); }}
                                                className="w-full text-left px-3 py-2 hover:bg-[var(--color-primary)] hover:text-black transition-colors text-sm border-b border-white/5 last:border-0">
                                                <p className="font-bold text-white">{c.name}</p>
                                                {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <input type="text" placeholder="Celular" className="glass-input w-full text-sm"
                            value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
                    </div>

                    {/* Due Date & Time */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                            <Calendar size={16} className="text-[var(--color-primary)]" />
                            ¿Para cuándo?
                        </label>
                        <div className="flex gap-2">
                            {['today', 'tomorrow', 'custom'].map(opt => (
                                <button key={opt} onClick={() => setDueDate(opt)}
                                    className={cn("flex-1 py-2 rounded-lg text-xs font-bold transition-all border",
                                        dueDate === opt
                                            ? "bg-[var(--color-primary)] text-black border-[var(--color-primary)]"
                                            : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)] hover:border-[var(--color-primary)]"
                                    )}>
                                    {opt === 'today' ? 'Hoy' : opt === 'tomorrow' ? 'Mañana' : 'Elegir'}
                                </button>
                            ))}
                        </div>
                        {dueDate === 'custom' && (
                            <input type="date" className="glass-input w-full text-sm" value={customDate}
                                onChange={e => setCustomDate(e.target.value)} />
                        )}
                        <select className="glass-input w-full text-sm" value={dueTime} onChange={e => setDueTime(e.target.value)}>
                            {timeSlots.map(t => <option key={t} value={t} className="bg-gray-900">{t}</option>)}
                        </select>
                    </div>

                    {/* Deposit */}
                    <div className="space-y-2">
                        <h3 className="text-[var(--color-text)] font-bold text-lg mb-4 flex items-center gap-2">
                            <DollarSign size={20} className="text-green-400" />
                            Total y Abono
                        </h3>

                        <div className="bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)] mb-4 space-y-2">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-[var(--color-text-muted)]">Total Estimado:</span>
                                <span className="text-[var(--color-text)] font-bold text-lg">
                                    {isPendingTotal ? (
                                        <span className="text-orange-400">PENDIENTE</span>
                                    ) : (
                                        formatCurrency(total, currentCurrency)
                                    )}
                                </span>
                            </div>

                            {/* Quick Deposit % Buttons (Disabled if pending) */}
                            <div className="flex gap-2 pt-2">
                                {[10, 20, 30, 50].map(pct => (
                                    <button
                                        key={pct}
                                        type="button"
                                        disabled={isPendingTotal}
                                        onClick={() => setDepositAmount(Math.round(total * (pct / 100)))}
                                        className="flex-1 py-1 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        {pct}%
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-[var(--color-text)] mb-1">Monto del Abono</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] font-bold">$</span>
                                    <input
                                        type="number"
                                        className="glass-input w-full !pl-7 text-lg font-bold text-green-400"
                                        placeholder="0"
                                        value={depositAmount}
                                        onChange={e => setDepositAmount(e.target.value)}
                                    />
                                </div>
                                {isPendingTotal && (
                                    <p className="text-[10px] text-orange-400 mt-1">
                                        * Total estimado pendiente. Puedes ingresar un abono manual referencial.
                                    </p>
                                )}
                            </div>

                            <div className="flex bg-[var(--glass-bg)] p-3 rounded-xl justify-between items-center">
                                <span className="text-sm font-bold text-[var(--color-text-muted)]">Saldo Pendiente:</span>
                                <span className="text-xl font-bold text-orange-400">
                                    {isPendingTotal ? 'PENDIENTE' : formatCurrency(remaining, currentCurrency)}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                {['Efectivo', 'Tarjeta', 'Transferencia'].map(m => (
                                    <button key={m} onClick={() => { setDepositMethod(m); setDepositTerminalId(null); setDepositBankAccountId(null); }}
                                        className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                            depositMethod === m
                                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                                : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                        )}>
                                        {m === 'Efectivo' ? '💵' : m === 'Tarjeta' ? '💳' : '📱'} {m}
                                    </button>
                                ))}
                            </div>
                            <PaymentDetailPicker
                                method={depositMethod}
                                terminalId={depositTerminalId}
                                bankAccountId={depositBankAccountId}
                                onChange={({ terminalId, bankAccountId }) => {
                                    if (terminalId !== undefined) setDepositTerminalId(terminalId);
                                    if (bankAccountId !== undefined) setDepositBankAccountId(bankAccountId);
                                }}
                            />
                        </div>
                    </div>

                    {/* Delivery */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                            <Truck size={16} className="text-[var(--color-primary)]" />
                            Entrega
                        </label>
                        <div className="flex gap-2">
                            <button onClick={() => setDeliveryType('pickup')}
                                className={cn("flex-1 py-2 rounded-lg text-xs font-bold transition-all border",
                                    deliveryType === 'pickup'
                                        ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] border-[var(--color-primary)]"
                                        : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                )}>
                                🏪 Retiro en tienda
                            </button>
                            <button onClick={() => setDeliveryType('delivery')}
                                className={cn("flex-1 py-2 rounded-lg text-xs font-bold transition-all border",
                                    deliveryType === 'delivery'
                                        ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] border-[var(--color-primary)]"
                                        : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                )}>
                                🚗 Delivery
                            </button>
                        </div>
                        {deliveryType === 'delivery' && (
                            <input type="text" placeholder="Dirección de entrega..." className="glass-input w-full text-sm"
                                value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} />
                        )}
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                            <FileText size={16} className="text-[var(--color-text-muted)]" />
                            Nota general
                        </label>
                        <textarea className="glass-input w-full text-sm resize-none" rows={2}
                            placeholder="Ej: Llamar antes de preparar..."
                            value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>

                    {/* Submit */}
                    <button onClick={handleSubmit} disabled={isSubmitting || !getActualDate()}
                        className="w-full btn-primary py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                        {isSubmitting ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-black" />
                        ) : (
                            <>
                                <Check size={20} />
                                Guardar Encargo
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ===== Preorder Detail Modal =====
const PreorderDetailModal = ({ preorder, onClose, onStatusChange, onPayBalance, currentCurrency }) => {
    const [details, setDetails] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showPayment, setShowPayment] = useState(false);
    const [payAmount, setPayAmount] = useState('');
    const [payMethod, setPayMethod] = useState('Efectivo');
    const [payTerminalId, setPayTerminalId] = useState(null);
    const [payBankAccountId, setPayBankAccountId] = useState(null);
    const { getPreorderDetails, addPreorderPayment } = useStore();

    useEffect(() => {
        const load = async () => {
            const result = await getPreorderDetails(preorder.id);
            if (result.success) setDetails(result);
            setIsLoading(false);
        };
        load();
    }, [preorder.id]);

    const handlePayBalance = async () => {
        const amount = parseFloat(payAmount);
        if (!amount || amount <= 0) return;

        const result = await addPreorderPayment(preorder.id, amount, payMethod, 'final', {
            terminalId: payMethod === 'Tarjeta' ? payTerminalId : null,
            bankAccountId: payMethod === 'Transferencia' ? payBankAccountId : null,
        });
        if (result.success) {
            // Reload details
            const updated = await getPreorderDetails(preorder.id);
            if (updated.success) setDetails(updated);
            setShowPayment(false);
            setPayAmount('');
            setPayTerminalId(null);
            setPayBankAccountId(null);
        }
    };

    const statusConfig = STATUS_CONFIG[preorder.status] || STATUS_CONFIG.pending;
    const StatusIcon = statusConfig.icon;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-lg my-auto animate-[float_0.3s_ease-out] max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                        <ClipboardList className="text-[var(--color-primary)]" size={20} />
                        Encargo #{preorder.id}
                    </h2>
                    <div className="flex gap-2">
                        <button onClick={() => {
                            // Construct print object from details
                            const printData = {
                                id: preorder.id,
                                clientName: details.preorder.client_name,
                                clientPhone: details.preorder.client_phone,
                                dueDate: details.preorder.due_date,
                                dueTime: details.preorder.due_time,
                                deliveryType: details.preorder.delivery_type,
                                totalAmount: details.preorder.total_amount,
                                depositAmount: details.preorder.deposit_amount,
                                paymentMethod: details.payments[0]?.method, // Approximate
                                notes: details.preorder.notes
                            };
                            printPreorder(printData, details.items.map(i => ({
                                qty: i.qty,
                                unit: i.unit,
                                name: i.product_name,
                                total: i.line_total,
                                note: i.note
                            })));
                        }} className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mr-2">
                            <Printer size={20} />
                        </button>
                        <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
                    </div>
                ) : details ? (
                    <div className="space-y-4">
                        {/* Status Badge */}
                        <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-bold", statusConfig.color)}>
                            <StatusIcon size={16} />
                            {statusConfig.label}
                        </div>

                        {/* Client & Schedule */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-[var(--glass-bg)] rounded-lg p-3 border border-[var(--glass-border)]">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Cliente</p>
                                <p className="text-sm font-bold text-[var(--color-text)]">{details.preorder.client_name || 'Sin nombre'}</p>
                                {details.preorder.client_phone && (
                                    <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mt-1">
                                        <Phone size={10} /> {details.preorder.client_phone}
                                    </p>
                                )}
                            </div>
                            <div className="bg-[var(--glass-bg)] rounded-lg p-3 border border-[var(--glass-border)]">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Para cuando</p>
                                <p className="text-sm font-bold text-[var(--color-text)]">{details.preorder.due_date}</p>
                                <p className="text-xs text-[var(--color-primary)] font-bold mt-1">
                                    <Clock size={10} className="inline mr-1" />{details.preorder.due_time}
                                </p>
                            </div>
                        </div>

                        {/* Items */}
                        <div>
                            <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Productos</p>
                            <div className="space-y-2">
                                {details.items.map(item => (
                                    <div key={item.id} className="flex justify-between items-center bg-[var(--glass-bg)] rounded-lg p-2 border border-[var(--glass-border)]">
                                        <div>
                                            <p className="text-sm font-medium text-[var(--color-text)]">{item.product_name}</p>
                                            <p className="text-xs text-[var(--color-text-muted)]">
                                                {item.qty} {item.unit} × {formatCurrency(item.unit_price, currentCurrency)}
                                            </p>
                                            {item.note && <p className="text-xs text-yellow-400 italic mt-0.5">📝 {item.note}</p>}
                                        </div>
                                        <span className="text-sm font-bold text-green-400">{formatCurrency(item.line_total, currentCurrency)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Payment Summary */}
                        <div className="bg-black/20 rounded-xl p-3 border border-white/10 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-[var(--color-text-muted)]">Total</span>
                                <span className="font-bold text-[var(--color-text)]">{formatCurrency(details.preorder.total_amount, currentCurrency)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-[var(--color-text-muted)]">Abonado</span>
                                <span className="font-bold text-green-400">{formatCurrency(details.preorder.deposit_amount, currentCurrency)}</span>
                            </div>
                            <div className="flex justify-between text-sm border-t border-white/10 pt-2">
                                <span className="text-[var(--color-text-muted)] font-bold">Saldo</span>
                                <span className={cn("font-bold text-lg", details.preorder.remaining_amount > 0 ? "text-orange-400" : "text-green-400")}>
                                    {formatCurrency(details.preorder.remaining_amount, currentCurrency)}
                                </span>
                            </div>
                        </div>

                        {/* Payment History */}
                        {details.payments.length > 0 && (
                            <div>
                                <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Pagos</p>
                                <div className="space-y-1">
                                    {details.payments.map(p => (
                                        <div key={p.id} className="flex justify-between items-center text-xs bg-[var(--glass-bg)] rounded p-2">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold",
                                                    p.type === 'deposit' ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"
                                                )}>{p.type === 'deposit' ? 'Abono' : 'Pago'}</span>
                                                <span className="text-[var(--color-text-muted)]">{p.method}</span>
                                            </div>
                                            <span className="font-bold text-[var(--color-text)]">{formatCurrency(p.amount, currentCurrency)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Pay Balance Section */}
                        {showPayment && (
                            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 space-y-3 animate-in slide-in-from-top-2">
                                <p className="text-sm font-bold text-green-400">💰 Cobrar Saldo</p>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                                    <input type="number" placeholder={String(details.preorder.remaining_amount)}
                                        className="glass-input w-full !pl-8 font-bold"
                                        value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                                </div>
                                <div className="flex gap-2">
                                    {['Efectivo', 'Tarjeta', 'Transferencia'].map(m => (
                                        <button key={m} onClick={() => { setPayMethod(m); setPayTerminalId(null); setPayBankAccountId(null); }}
                                            className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                                payMethod === m
                                                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                                                    : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                            )}>
                                            {m}
                                        </button>
                                    ))}
                                </div>
                                <PaymentDetailPicker
                                    method={payMethod}
                                    terminalId={payTerminalId}
                                    bankAccountId={payBankAccountId}
                                    onChange={({ terminalId, bankAccountId }) => {
                                        if (terminalId !== undefined) setPayTerminalId(terminalId);
                                        if (bankAccountId !== undefined) setPayBankAccountId(bankAccountId);
                                    }}
                                />
                                <div className="flex gap-2">
                                    <button onClick={() => setShowPayment(false)}
                                        className="flex-1 py-2 rounded-lg text-sm font-bold bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)]">
                                        Cancelar
                                    </button>
                                    <button onClick={handlePayBalance}
                                        className="flex-1 py-2 rounded-lg text-sm font-bold bg-green-500 text-black">
                                        Confirmar Pago
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                            {details.preorder.remaining_amount > 0 && details.preorder.status !== 'canceled' && (
                                <button onClick={() => setShowPayment(!showPayment)}
                                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all flex items-center justify-center gap-2">
                                    <DollarSign size={16} />
                                    Cobrar Saldo
                                </button>
                            )}
                            {STATUS_NEXT_LABEL[preorder.status] && (
                                <button onClick={() => onStatusChange(preorder.id, STATUS_CONFIG[preorder.status].next)}
                                    className="flex-1 py-3 rounded-xl font-bold text-sm btn-primary flex items-center justify-center gap-2">
                                    <ArrowRight size={16} />
                                    {STATUS_NEXT_LABEL[preorder.status]}
                                </button>
                            )}
                            {preorder.status !== 'canceled' && preorder.status !== 'delivered' && (
                                <button onClick={() => onStatusChange(preorder.id, 'canceled')}
                                    className="py-3 px-4 rounded-xl font-bold text-sm bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all">
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        {/* Delivery Info */}
                        {details.preorder.delivery_type === 'delivery' && details.preorder.delivery_address && (
                            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2 text-xs flex items-center gap-2">
                                <MapPin size={14} className="text-purple-400" />
                                <span className="text-purple-300">{details.preorder.delivery_address}</span>
                            </div>
                        )}
                        {details.preorder.notes && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2 text-xs flex items-center gap-2">
                                <FileText size={14} className="text-yellow-400" />
                                <span className="text-yellow-300">{details.preorder.notes}</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-center text-[var(--color-text-muted)] py-8">No se encontró el encargo</p>
                )}
            </div>
        </div>
    );
};

// ===== MAIN PREORDERS PAGE =====
const Preorders = () => {
    const {
        preorders, preorderCart, categories: storedCategories,
        addToPreorderCart, updatePreorderCartItem, removeFromPreorderCart,
        clearPreorderCart, createPreorder, fetchPreorders,
        updatePreorderStatus, getPreorderableProducts, currentCurrency, clients,
        deliverPreorder, getPreorderDetails
    } = useStore();

    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState('new'); // 'new' | 'list'
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('Todos');
    const [preorderProducts, setPreorderProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [selectedPreorder, setSelectedPreorder] = useState(null);
    const [showDeliveryModal, setShowDeliveryModal] = useState(false);

    const [deliveryPreorder, setDeliveryPreorder] = useState(null);
    const [showQuickProductModal, setShowQuickProductModal] = useState(false);

    // List filters
    const [dateFilter, setDateFilter] = useState('today');
    const [statusFilter, setStatusFilter] = useState('all');

    const categoryList = ['Todos', ...storedCategories
        .filter(c => {
            // Check visibility (handle both optimistic UI state and DB state)
            // Default to visible if undefined (e.g. migration hasn't run or new record)
            const isVisible = c.showInPreorders ?? (c.show_in_preorders !== 0);
            return c.status === 'active' && isVisible;
        })
        .map(c => c.name)];

    const cartTotal = useMemo(() => {
        // If any item has null total (pending), the overall total is null (pending)
        const hasPending = preorderCart.some(item => item.line_total === null);
        if (hasPending) return null;
        return preorderCart.reduce((sum, item) => sum + (item.line_total || 0), 0);
    }, [preorderCart]);

    const hasKgItems = preorderCart.some(item => item.billing_unit === 'kg');

    // Load preorderable products
    // Estrategia rápida:
    //   1) Filtrar en memoria desde state.products (instantáneo)
    //   2) Si no hay nada en memoria, intentar Dexie
    //   3) Refrescar contra Turso en background (silencioso, con timeout)
    const loadProducts = async (search = '', cat = 'Todos') => {
        const term = String(search || '').toLowerCase();
        const filterList = (list) => {
            let out = (list || []).filter(p =>
                p && (p.sale_mode === 'preorder_only' || p.sale_mode === 'both')
            );
            if (cat && cat !== 'Todos') out = out.filter(p => p.category === cat);
            if (term) out = out.filter(p =>
                (p.name && String(p.name).toLowerCase().includes(term)) ||
                (p.sku && String(p.sku).toLowerCase().includes(term))
            );
            out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            return out.slice(0, 50).map(p => ({
                ...p,
                price_ranges: typeof p.price_ranges === 'string'
                    ? (() => { try { return JSON.parse(p.price_ranges); } catch { return []; } })()
                    : (p.price_ranges || [])
            }));
        };

        let gotLocal = false;

        // 1) Memoria
        try {
            const fast = filterList(useStore.getState().products);
            if (fast.length > 0) {
                setPreorderProducts(fast);
                gotLocal = true;
            }
        } catch { /* noop */ }

        // 2) Dexie como respaldo si la memoria está vacía
        if (!gotLocal) {
            try {
                const { localDb } = await import('../lib/db/localdb');
                const { activeCompanyId } = useStore.getState();
                if (activeCompanyId) {
                    const all = await localDb.products.where('companyId').equals(activeCompanyId).toArray();
                    const fast = filterList(all);
                    if (fast.length > 0) {
                        setPreorderProducts(fast);
                        gotLocal = true;
                    }
                }
            } catch { /* noop */ }
        }

        // Quitar spinner ya — sea con datos locales o vacío.
        // Turso refrescará en silencio.
        setIsLoading(false);

        // 3) Refrescar con Turso (si está online), con timeout de 8s
        if (typeof navigator === 'undefined' || navigator.onLine) {
            try {
                const tursoPromise = getPreorderableProducts(search, cat);
                const timeoutPromise = new Promise((resolve) =>
                    setTimeout(() => resolve({ success: false, _timeout: true }), 8000)
                );
                const result = await Promise.race([tursoPromise, timeoutPromise]);
                if (result && result.success) setPreorderProducts(result.products);
                else if (result && result._timeout) {
                    console.warn('[preorders] Turso timeout — usando datos locales');
                }
            } catch (e) {
                console.warn('[preorders] refresh Turso falló:', e);
            }
        }
    };

    useEffect(() => {
        // Carga inicial (sin debounce) — mostrar lo que se tenga rápido.
        loadProducts();
        fetchPreorders(getListFilters());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Search debounce
    useEffect(() => {
        const delay = setTimeout(() => {
            loadProducts(searchTerm, selectedCategory);
        }, 300);
        return () => clearTimeout(delay);
    }, [searchTerm, selectedCategory]);

    const getListFilters = () => {
        const today = new Date().toLocaleDateString('en-CA');
        const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');

        const filters = { status: statusFilter };
        if (dateFilter === 'today') filters.date = today;
        else if (dateFilter === 'tomorrow') filters.date = tomorrow;
        // 'all' = no date filter
        return filters;
    };

    useEffect(() => {
        if (activeTab === 'list') {
            fetchPreorders(getListFilters());
        }
    }, [activeTab, dateFilter, statusFilter]);

    const handleConfirmPreorder = async (data) => {
        const result = await createPreorder(data);
        if (result.success) {
            setShowConfirmModal(false);
            setActiveTab('list');

            // Auto-print receipt
            const printData = {
                id: result.preorderId,
                clientName: data.client_name,
                clientPhone: data.client_phone,
                dueDate: data.due_date,
                dueTime: data.due_time,
                deliveryType: data.delivery_type,
                totalAmount: data.total_amount,
                depositAmount: data.deposit_amount,
                paymentMethod: data.deposit_method,
                notes: data.notes
            };

            // Map items for printer
            const printItems = data.items.map(item => ({
                qty: item.qty,
                unit: item.unit || 'Und',
                name: item.product_name,
                total: item.line_total, // might be null if pending
                note: item.note
            }));

            printPreorder(printData, printItems);

        } else {
            alert('Error al crear encargo: ' + result.error);
        }
    };

    const handleStatusChange = async (preorderId, newStatus) => {
        if (newStatus === 'delivered') {
            // Intercept delivery to show checkout modal
            setIsLoading(true);
            const details = await getPreorderDetails(preorderId);
            setIsLoading(false);
            if (details.success) {
                setDeliveryPreorder(details);
                setShowDeliveryModal(true);
            }
            return;
        }
        await updatePreorderStatus(preorderId, newStatus);
        fetchPreorders(getListFilters());
        // If we are in detail view, close it or refetch?
        // Existing behavior was setSelectedPreorder(null) which closes it
        setSelectedPreorder(null);
    };

    const handleDeliverSuccess = async (preorderId, weights, method) => {
        const result = await deliverPreorder(preorderId, weights, method);
        if (result.success) {
            setShowDeliveryModal(false);
            setDeliveryPreorder(null);
            setSelectedPreorder(null); // Close detail modal if open
            fetchPreorders(getListFilters());
        } else {
            alert('Error al entregar: ' + result.error);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-100px)]">
            {/* Header compacto: switch POS/Encargos + tabs internas */}
            <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
                {/* Switch POS / Encargos (segmented) */}
                <div className="inline-flex p-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                    <button
                        onClick={() => navigate('/pos')}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    >
                        <ShoppingCart size={14} />
                        Venta
                    </button>
                    <button
                        className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 bg-[var(--color-primary)] text-black"
                    >
                        <CakeSlice size={14} />
                        Encargos
                    </button>
                </div>

                <div className="hidden sm:block h-5 w-px bg-[var(--glass-border)]" />

                {/* Tabs internas: Nuevo / Lista (segmented) */}
                <div className="inline-flex p-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                    <button
                        onClick={() => setActiveTab('new')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors",
                            activeTab === 'new'
                                ? "bg-[var(--color-primary)] text-black"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        )}
                    >
                        <Plus size={14} />
                        Nuevo Encargo
                    </button>
                    <button
                        onClick={() => setActiveTab('list')}
                        className={cn(
                            "relative px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors",
                            activeTab === 'list'
                                ? "bg-[var(--color-primary)] text-black"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        )}
                    >
                        <ClipboardList size={14} />
                        Encargos
                        {preorders.filter(p => p.status !== 'delivered' && p.status !== 'canceled').length > 0 && (
                            <span className={cn(
                                "ml-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                                activeTab === 'list'
                                    ? "bg-black text-[var(--color-primary)]"
                                    : "bg-red-500 text-white"
                            )}>
                                {preorders.filter(p => p.status !== 'delivered' && p.status !== 'canceled').length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* ===== TAB: NEW PREORDER ===== */}
            {activeTab === 'new' && (
                <div className="flex flex-col lg:flex-row gap-4 flex-1 overflow-hidden min-h-0">
                    {/* Product Catalog */}
                    <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">
                        <div className="glass-card p-3 space-y-3 shrink-0">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                                    <input type="text" placeholder="Buscar productos encargables..."
                                        className="glass-input !pl-10 w-full text-sm"
                                        value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                                </div>
                                <button
                                    onClick={() => setShowQuickProductModal(true)}
                                    className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0"
                                    title="Crear producto rápido solo para encargo"
                                >
                                    <span className="text-lg leading-none">⚡</span>
                                    <span className="hidden sm:inline">Rápido</span>
                                </button>
                            </div>
                            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                                {categoryList.map(cat => (
                                    <button key={cat} onClick={() => setSelectedCategory(cat)}
                                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                                            selectedCategory === cat
                                                ? "bg-[var(--color-primary)] text-black shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                                                : "glass text-[var(--color-text-muted)] hover:bg-[var(--glass-bg)]"
                                        )}>
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pos-product-grid flex-1 overflow-y-auto pr-2 grid gap-2 lg:gap-4 content-start pb-28 lg:pb-4 custom-scrollbar grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] lg:grid-cols-2">
                            {isLoading ? (
                                <div className="col-span-full flex items-center justify-center py-12">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500" />
                                </div>
                            ) : preorderProducts.length === 0 ? (
                                <div className="col-span-full text-center py-12 space-y-3">
                                    <Package size={48} className="mx-auto text-[var(--color-text-muted)] opacity-30" />
                                    <p className="text-[var(--color-text-muted)]">No hay productos de encargo</p>
                                    <p className="text-xs text-[var(--color-text-muted)] opacity-60">
                                        Para que aparezcan aquí, ve a Inventario → Editar Producto → Disponibilidad → "Solo encargo" o "Venta + Encargo"
                                    </p>
                                </div>
                            ) : (
                                preorderProducts.map(product => (
                                    <div key={product.id} onClick={() => addToPreorderCart(product)}
                                        className="rounded-xl glass-card bg-card p-0 cursor-pointer border border-[var(--glass-border)] hover:border-[var(--color-primary)] transition-all flex flex-col active:scale-95 group">
                                        <div className="w-full aspect-square bg-[var(--glass-bg)] flex items-center justify-center overflow-hidden rounded-t-xl">
                                            <OptimizedImage src={product.image} alt={product.name}
                                                className="w-full h-full object-contain p-2 transition-transform duration-500 group-hover:scale-110" />
                                        </div>
                                        <div className="p-2 lg:p-3">
                                            <h3 className="text-[11px] lg:text-sm font-bold text-[var(--color-text)] line-clamp-2 leading-tight mb-1 group-hover:text-[var(--color-primary)] transition-colors">
                                                {product.name}
                                            </h3>
                                            <span className="text-green-400 font-bold text-sm lg:text-lg">
                                                {formatCurrency(product.price, currentCurrency)}
                                            </span>
                                            {product.allow_item_notes === 1 && (
                                                <span className="block text-[9px] text-yellow-400 mt-0.5">📝 Permite notas</span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Preorder Cart */}
                    <div className="hidden lg:flex w-full lg:w-[420px] flex-col glass-card p-0 overflow-hidden">
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                            <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2">
                                <ShoppingCart size={18} className="text-[var(--color-primary)]" />
                                Carrito de Encargo
                                {preorderCart.length > 0 && (
                                    <span className="bg-[var(--color-primary)]/20 text-[var(--color-primary)] text-xs px-2 py-0.5 rounded-full font-bold">
                                        {preorderCart.reduce((s, i) => s + i.qty, 0)} items
                                    </span>
                                )}
                            </h3>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {preorderCart.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)] gap-2">
                                    <ShoppingCart size={48} className="opacity-20" />
                                    <p>Agrega productos para el encargo</p>
                                </div>
                            ) : (
                                preorderCart.map(item => (
                                    <div key={item.id} className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] space-y-2">
                                        <div className="flex justify-between items-start gap-2">
                                            <h4 className="text-[var(--color-text)] font-medium text-sm line-clamp-2">{item.product_name}</h4>
                                            <button className="text-[var(--color-text-muted)] hover:text-red-400 p-1"
                                                onClick={() => removeFromPreorderCart(item.id)}>
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <div className="flex justify-between items-center text-xs text-[var(--color-text-muted)]">
                                            <div className="flex items-center gap-2">
                                                <div className="relative w-24">
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">$</span>
                                                    <input
                                                        type="number"
                                                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded px-1 pl-4 py-0.5 text-right text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                                                        value={item.billing_unit === 'kg' ? item.price_per_kg : item.unit_price}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            if (!isNaN(val) && val >= 0) {
                                                                if (item.billing_unit === 'kg') {
                                                                    updatePreorderCartItem(item.id, { price_per_kg: val });
                                                                } else {
                                                                    updatePreorderCartItem(item.id, { unit_price: val });
                                                                }
                                                            }
                                                        }}
                                                        onClick={(e) => e.target.select()}
                                                    />
                                                </div>
                                                {item.billing_unit === 'kg' && <span>/kg · {item.gram_per_unit}g/un</span>}
                                            </div>

                                            <span className="text-[var(--color-primary)] font-bold text-base">
                                                {item.billing_unit === 'kg' && <span className="text-xs font-normal text-orange-400 mr-1">≈</span>}
                                                {item.line_total === null ? (
                                                    <span className="text-xs text-orange-400 tracking-wider">PENDIENTE</span>
                                                ) : (
                                                    formatCurrency(item.line_total, currentCurrency)
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            {/* Item Notes */}
                                            {item.allow_item_notes ? (
                                                <input type="text" placeholder="Nota: sin sal, rebanado..."
                                                    className="glass-input text-xs py-1 px-2 flex-1 text-yellow-400 placeholder:text-gray-600"
                                                    value={item.note || ''}
                                                    onChange={e => updatePreorderCartItem(item.id, { note: e.target.value })} />
                                            ) : <div className="flex-1" />}

                                            {/* Qty Controls */}
                                            <div className="flex items-center gap-2 bg-[var(--glass-bg)] rounded-lg p-1 border border-[var(--glass-border)]">
                                                <button className="w-7 h-7 rounded-lg bg-[var(--glass-bg)] flex items-center justify-center text-[var(--color-text)] hover:bg-white/10"
                                                    onClick={() => item.qty > 1 && updatePreorderCartItem(item.id, { qty: item.qty - 1 })}>
                                                    <Minus size={14} />
                                                </button>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    className="w-12 bg-transparent text-[var(--color-text)] font-bold text-center text-sm focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none px-0"
                                                    value={item.qty}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value);
                                                        if (!isNaN(val) && val > 0) updatePreorderCartItem(item.id, { qty: val });
                                                    }}
                                                    onClick={(e) => e.target.select()}
                                                />
                                                <button className="w-7 h-7 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-black"
                                                    onClick={() => updatePreorderCartItem(item.id, { qty: item.qty + 1 })}>
                                                    <Plus size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-3">
                            <div className="flex justify-between items-center text-[var(--color-text)] text-2xl font-bold">
                                <span>{hasKgItems ? 'Total Aprox.' : 'Total'}</span>
                                <span className="neon-text">
                                    {hasKgItems && <span className="text-sm text-orange-400 mr-1">≈</span>}
                                    {cartTotal === null ? 'PENDIENTE' : formatCurrency(cartTotal, currentCurrency)}
                                </span>
                            </div>
                            {hasKgItems && (
                                <p className="text-xs text-orange-400/70 text-center">El total exacto se calculará al pesar los productos</p>
                            )}
                            <button disabled={preorderCart.length === 0}
                                onClick={() => setShowConfirmModal(true)}
                                className="btn-primary w-full flex items-center justify-center gap-2 py-3 rounded-xl disabled:opacity-50">
                                <ClipboardList size={18} />
                                Confirmar Encargo
                            </button>
                        </div>
                    </div>

                    {/* Mobile Cart Button */}
                    <div className="lg:hidden fixed bottom-4 left-4 right-4 z-40">
                        <button onClick={() => setShowConfirmModal(true)} disabled={preorderCart.length === 0}
                            className="w-full bg-[var(--color-primary)] text-black rounded-2xl py-4 px-6 flex items-center justify-center gap-3 shadow-2xl font-bold text-lg disabled:opacity-50">
                            <ClipboardList size={24} />
                            Confirmar Encargo
                            {preorderCart.length > 0 && (
                                <>
                                    <span className="opacity-50">•</span>
                                    <span className="text-sm">{preorderCart.reduce((s, i) => s + i.qty, 0)} items</span>
                                    <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-bold ml-auto">
                                        {formatCurrency(cartTotal, currentCurrency)}
                                    </span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* ===== TAB: PREORDER LIST ===== */}
            {activeTab === 'list' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Filters */}
                    <div className="glass-card p-3 mb-4 shrink-0 space-y-3">
                        <div className="flex gap-2">
                            {[
                                { key: 'today', label: 'Hoy' },
                                { key: 'tomorrow', label: 'Mañana' },
                                { key: 'all', label: 'Todos' }
                            ].map(f => (
                                <button key={f.key} onClick={() => setDateFilter(f.key)}
                                    className={cn("flex-1 py-2 rounded-lg text-xs font-bold transition-all border",
                                        dateFilter === f.key
                                            ? "bg-[var(--color-primary)] text-black border-[var(--color-primary)]"
                                            : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                    )}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto">
                            {[
                                { key: 'all', label: 'Todos' },
                                { key: 'pending', label: '⏳ Pendientes' },
                                { key: 'preparing', label: '🍞 Preparando' },
                                { key: 'ready', label: '✅ Listos' },
                                { key: 'delivered', label: '📦 Entregados' },
                                { key: 'canceled', label: '❌ Cancelados' }
                            ].map(s => (
                                <button key={s.key} onClick={() => setStatusFilter(s.key)}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                                        statusFilter === s.key
                                            ? "bg-[var(--color-primary)] text-black"
                                            : "glass text-[var(--color-text-muted)]"
                                    )}>
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Preorder Cards */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                        {preorders.length === 0 ? (
                            <div className="text-center py-12 space-y-3">
                                <ClipboardList size={48} className="mx-auto text-[var(--color-text-muted)] opacity-30" />
                                <p className="text-[var(--color-text-muted)]">No hay encargos para este filtro</p>
                            </div>
                        ) : (
                            preorders.map(preorder => {
                                const config = STATUS_CONFIG[preorder.status] || STATUS_CONFIG.pending;
                                const StatusIcon = config.icon;

                                return (
                                    <div key={preorder.id}
                                        onClick={() => setSelectedPreorder(preorder)}
                                        className="glass-card p-4 cursor-pointer hover:border-[var(--color-primary)] transition-all border border-[var(--glass-border)] space-y-3 active:scale-[0.99]">
                                        {/* Header */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold", config.color)}>
                                                    <StatusIcon size={12} />
                                                    {config.label}
                                                </div>
                                                <span className="text-xs text-[var(--color-text-muted)]">#{preorder.id}</span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-[var(--color-primary)]">
                                                    <Clock size={12} className="inline mr-1" />{preorder.due_time}
                                                </p>
                                                <p className="text-[10px] text-[var(--color-text-muted)]">{preorder.due_date}</p>
                                            </div>
                                        </div>

                                        {/* Client + Items */}
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-1">
                                                <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
                                                    <User size={14} className="text-[var(--color-primary)]" />
                                                    {preorder.client_name || 'Sin nombre'}
                                                </p>
                                                {preorder.client_phone && (
                                                    <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                                                        <Phone size={10} /> {preorder.client_phone}
                                                    </p>
                                                )}
                                                <p className="text-xs text-[var(--color-text-muted)] line-clamp-1">{preorder.items_summary}</p>
                                            </div>
                                            <div className="text-right space-y-1">
                                                <p className="text-lg font-bold text-[var(--color-text)]">{formatCurrency(preorder.total_amount, currentCurrency)}</p>
                                                {preorder.remaining_amount > 0 ? (
                                                    <p className="text-xs text-orange-400 font-bold">
                                                        Saldo: {formatCurrency(preorder.remaining_amount, currentCurrency)}
                                                    </p>
                                                ) : (
                                                    <p className="text-xs text-green-400 font-bold">✓ Pagado</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Quick Actions */}
                                        {STATUS_NEXT_LABEL[preorder.status] && (
                                            <div className="flex gap-2 pt-1">
                                                <button onClick={(e) => { e.stopPropagation(); handleStatusChange(preorder.id, config.next); }}
                                                    className="flex-1 py-2 rounded-lg text-xs font-bold btn-primary flex items-center justify-center gap-1.5">
                                                    <ArrowRight size={14} />
                                                    {STATUS_NEXT_LABEL[preorder.status]}
                                                </button>
                                                {preorder.remaining_amount > 0 && (
                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedPreorder(preorder); }}
                                                        className="py-2 px-3 rounded-lg text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                                                        <DollarSign size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* Modals */}
            <ConfirmPreorderModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onConfirm={handleConfirmPreorder}
                cart={preorderCart}
                total={cartTotal}
                currentCurrency={currentCurrency}
            />

            {selectedPreorder && (
                <PreorderDetailModal
                    preorder={selectedPreorder}
                    onClose={() => setSelectedPreorder(null)}
                    onStatusChange={handleStatusChange}
                    currentCurrency={currentCurrency}
                />
            )}

            <QuickPreorderProductModal
                isOpen={showQuickProductModal}
                onClose={() => setShowQuickProductModal(false)}
            />

            {/* Delivery Checkout Modal */}
            <DeliveryCheckoutModal
                isOpen={showDeliveryModal}
                onClose={() => setShowDeliveryModal(false)}
                preorderDetails={deliveryPreorder}
                onDeliver={handleDeliverSuccess}
                currentCurrency={currentCurrency}
            />
        </div>
    );
};

export default Preorders;
