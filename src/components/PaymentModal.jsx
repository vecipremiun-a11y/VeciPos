import React, { useState, useEffect, useMemo } from 'react';
import { X, Banknote, CreditCard, Landmark, Coins, ArrowLeft, Check, Plus, Trash2, FileText, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';

const PaymentModal = ({ isOpen, onClose, total, onConfirm }) => {
    const {
        carts,
        activeCartId,
        currentCurrency,
        paymentMethodsConfig,
        paymentTerminals,
        bankAccounts,
        fetchPaymentMethodsSettings
    } = useStore();

    // Derivar el cliente seleccionado desde el carrito activo
    const posSelectedClient = useMemo(() => {
        return carts.find(c => c.id === activeCartId)?.client || null;
    }, [carts, activeCartId]);

    const [step, setStep] = useState('select-method'); // 'select-method' | 'payment-details'
    const [method, setMethod] = useState(null);
    const [amountPaid, setAmountPaid] = useState('');
    const [observations, setObservations] = useState('');
    const [selectedTerminal, setSelectedTerminal] = useState(null); // 'TUU' | 'CompraAqui'

    // State for Mixed Payment
    const [mixedPayments, setMixedPayments] = useState([]);

    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (isOpen) setIsProcessing(false);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setStep('select-method');
            setMethod(null);
            setAmountPaid('');
            setObservations('');
            setSelectedTerminal(null);
            setMixedPayments([]);
        }
    }, [isOpen, total]);

    const mounted = React.useRef(true);
    useEffect(() => {
        fetchPaymentMethodsSettings();
        return () => { mounted.current = false; };
    }, []);

    // Validation for Mixed Payment
    const isMixedValid = () => {
        const currentTotal = mixedPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        // Check total covered (allowing slight floating point diffs)
        if (Math.abs(currentTotal - total) > 0.01) return false;

        // Check required fields for specific methods
        return mixedPayments.every(p => {
            if (p.method === 'Tarjeta' && !p.terminal) return false;
            if (p.method === 'Transferencia' && !p.account) return false;
            return true;
        });
    };

    const suggestions = [
        Math.ceil(total),
        Math.ceil(total / 1000) * 1000 + 1000,
        Math.ceil(total / 5000) * 5000 + 5000,
        Math.ceil(total / 10000) * 10000 + 10000
    ].filter((v, i, a) => a.indexOf(v) === i && v >= total).slice(0, 3);

    if (!isOpen) return null;

    const handleMethodSelect = (selectedMethod) => {
        setMethod(selectedMethod);
        if (selectedMethod === 'Mixto') {
            // Initialize with one row of Cash covering the total
            setMixedPayments([
                { id: Date.now(), method: 'Efectivo', amount: total.toString(), terminal: '', account: '' }
            ]);
        } else if (selectedMethod === 'Efectivo') {
            setAmountPaid(Math.ceil(total).toString());
        } else {
            setAmountPaid(total.toString());
        }
        setStep('payment-details');
    };

    const handleAmountClick = (amount) => {
        setAmountPaid(amount.toString());
    };

    // Mixed Payment Logic
    const getMixedTotal = () => {
        return mixedPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    };

    const getAvailableMethods = (currentRowId) => {
        const usedMethods = mixedPayments
            .filter(p => p.id !== currentRowId) // Exclude current row
            .map(p => p.method);

        return ['Efectivo', 'Tarjeta', 'Transferencia'].filter(m => !usedMethods.includes(m));
    };

    const handleAddMethod = () => {
        if (mixedPayments.length >= 3) return; // Max 3 methods

        const currentTotal = getMixedTotal();
        const remaining = Math.max(0, total - currentTotal);

        // Find first available method
        const available = getAvailableMethods(null);
        if (available.length === 0) return;

        setMixedPayments([
            ...mixedPayments,
            {
                id: Date.now(),
                method: available[0], // Auto-select first available unused method 
                amount: remaining.toString(),
                terminal: '',
                account: ''
            }
        ]);

        // Trigger rebalance immediately if adding row causes Row 1 to need adjustment? 
        // No, usually adding a row (which takes remaining) doesn't change Row 1 unless we force Row 1 to split.
        // Standard split logic: Row 1 has X. Add Row 2. Row 2 init with Y (Remaining).
        // If Remaining is 0, user will type in Row 2, which triggers rebalance.
    };

    const handleRemoveMethod = (id) => {
        if (mixedPayments.length > 1) {
            const newPayments = mixedPayments.filter(p => p.id !== id);
            // Re-allocate the removed amount to the first method?
            // To keep user friendly, let's just remove it. The user will see "Por cobrar" increase.
            setMixedPayments(newPayments);
        }
    };

    const updatePaymentRow = (id, field, value) => {
        // Simple update for non-amount fields
        if (field !== 'amount') {
            setMixedPayments(mixedPayments.map(p => {
                if (p.id === id) return { ...p, [field]: value };
                return p;
            }));
            return;
        }

        // Amount Balancing Logic
        const newVal = parseFloat(value) || 0;

        // If we are editing the FIRST row, just update it (don't auto-balance others, user is driving)
        if (mixedPayments.length > 0 && mixedPayments[0].id === id) {
            setMixedPayments(mixedPayments.map(p => {
                if (p.id === id) return { ...p, amount: value };
                return p;
            }));
            return;
        }

        // If editing a secondary row (id != mixedPayments[0].id)
        // We want to adjust the FIRST row to absorb the difference
        const firstRow = mixedPayments[0];
        const otherRowsSum = mixedPayments
            .filter(p => p.id !== firstRow.id && p.id !== id) // Sum of others excluding first and current
            .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

        // Calculate what the first row *should* be
        // FirstRow = Total - (OtherRows + NewValue)
        let newFirstRowAmount = total - (otherRowsSum + newVal);
        if (newFirstRowAmount < 0) newFirstRowAmount = 0; // Prevent negative

        setMixedPayments(mixedPayments.map(p => {
            if (p.id === id) return { ...p, amount: value };
            if (p.id === firstRow.id) return { ...p, amount: newFirstRowAmount.toFixed(0) }; // Use integer strings for cleanliness if preferred, or match input
            return p;
        }));
    };

    const handleConfirm = async () => {
        // ============================================
        // 🔒 VALIDACIÓN ROBUSTA DE PAGOS
        // ============================================

        if (isProcessing) return;

        // Validar método de pago seleccionado
        if (!method) {
            alert('Debes seleccionar un método de pago');
            return;
        }

        let finalPayData = {
            method,
            total,
            observations,
        };

        if (method === 'Mixto') {
            // VALIDACIÓN DE PAGO MIXTO
            const paid = getMixedTotal();

            // 1. Validar que cada pago individual sea positivo
            for (const p of mixedPayments) {
                const amount = parseFloat(p.amount);

                if (isNaN(amount)) {
                    alert(`Monto inválido en método ${p.method}`);
                    return;
                }

                if (amount <= 0) {
                    alert(`El monto de ${p.method} debe ser mayor a cero`);
                    return;
                }

                // Validar campos requeridos según método
                if (p.method === 'Tarjeta' && !p.terminal) {
                    alert('Debes seleccionar el datáfono para pago con tarjeta');
                    return;
                }

                if (p.method === 'Transferencia' && !p.account) {
                    alert('Debes seleccionar la cuenta para transferencia');
                    return;
                }
            }

            // 2. Validar que el total cubra el monto (con margen de error de centavos)
            const diff = Math.abs(paid - total);
            if (diff > 0.01) {
                if (paid < total) {
                    alert(`Faltan ${formatCurrency(total - paid, currentCurrency)} por pagar`);
                } else {
                    alert(`Hay ${formatCurrency(paid - total, currentCurrency)} de más. Ajusta los montos.`);
                }
                return;
            }

            finalPayData = {
                ...finalPayData,
                amountPaid: paid,
                change: 0, // En pago mixto, el cambio debe ser exacto
                mixedPayments: mixedPayments
            };

        } else {
            // VALIDACIÓN DE PAGO SIMPLE
            const paid = parseFloat(amountPaid);

            // 1. Validar que sea un número válido
            if (isNaN(paid)) {
                alert('Monto de pago inválido');
                return;
            }

            // 2. Validar que no sea negativo
            if (paid < 0) {
                alert('El monto de pago no puede ser negativo');
                return;
            }

            // 3. Validar según método de pago
            if (method === 'Crédito') {
                // En crédito, verificar que haya cliente seleccionado
                if (!posSelectedClient) {
                    alert('Debes seleccionar un cliente para ventas a crédito');
                    return;
                }
                // En crédito, el monto debe ser exacto
                if (Math.abs(paid - total) > 0.01) {
                    alert('En ventas a crédito, el monto debe ser exacto al total');
                    return;
                }
            } else if (method === 'Efectivo') {
                // En efectivo, validar que cubra el total
                if (paid < total) {
                    alert(`Monto insuficiente. Faltan ${formatCurrency(total - paid, currentCurrency)}`);
                    return;
                }
            } else {
                // Tarjeta, Transferencia: debe ser exacto
                if (Math.abs(paid - total) > 0.01) {
                    alert('El monto debe ser exacto al total de la venta');
                    return;
                }

                // Validar terminal para tarjeta
                if (method === 'Tarjeta' && !selectedTerminal) {
                    alert('Debes seleccionar el datáfono utilizado');
                    return;
                }
            }

            finalPayData = {
                ...finalPayData,
                amountPaid: paid,
                change: paid - total,
                terminal: selectedTerminal
            };
        }

        // ============================================
        // ⚡ CONFIRMACIÓN INSTANTÁNEA (OPTIMISTIC UI)
        // ============================================

        setIsProcessing(true);
        console.log('✅ Payment validated (Instant UI):', finalPayData);

        // Ejecutar inmediatamente para cerrar modal y mostrar éxito
        onConfirm(finalPayData);

        // Cerrar modal visualmente
        onClose();
    };


    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="glass-card w-full max-w-2xl relative animate-[float_0.3s_ease-out] p-0 overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <div className="flex items-center gap-3">
                        {step === 'payment-details' && (
                            <button onClick={() => setStep('select-method')} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                                <ArrowLeft size={20} className="text-gray-400" />
                            </button>
                        )}
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            {step === 'select-method' ? 'Seleccionar método de pago' : 'Pagar factura'}
                        </h2>
                    </div>

                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-8 flex-1 overflow-y-auto">

                    {step === 'select-method' && (
                        <div className="flex flex-col gap-6">
                            <h3 className="text-center text-gray-300 text-lg">
                                Elige cómo quieres procesar el pago por <span className="text-[var(--color-primary)] font-bold text-xl">{formatCurrency(total, currentCurrency)}</span>
                            </h3>

                            <div className="grid grid-cols-2 gap-4">
                                {paymentMethodsConfig.cash_enabled === 1 && (
                                    <MethodButton
                                        icon={<Banknote size={40} />}
                                        label="Efectivo"
                                        color="text-green-400"
                                        onClick={() => handleMethodSelect('Efectivo')}
                                    />
                                )}
                                {paymentMethodsConfig.card_enabled === 1 && (
                                    <MethodButton
                                        icon={<CreditCard size={40} />}
                                        label="Tarjeta"
                                        color="text-blue-400"
                                        onClick={() => handleMethodSelect('Tarjeta')}
                                    />
                                )}
                                {paymentMethodsConfig.transfer_enabled === 1 && (
                                    <MethodButton
                                        icon={<Landmark size={40} />}
                                        label="Transferencia"
                                        color="text-purple-400"
                                        onClick={() => handleMethodSelect('Transferencia')}
                                    />
                                )}
                                {paymentMethodsConfig.mixed_enabled === 1 && (
                                    <MethodButton
                                        icon={<Coins size={40} />}
                                        label="Pago Mixto"
                                        color="text-pink-400"
                                        onClick={() => handleMethodSelect('Mixto')}
                                    />
                                )}
                                {paymentMethodsConfig.credit_enabled === 1 && (
                                    <MethodButton
                                        icon={<FileText size={40} />}
                                        label="Crédito"
                                        color="text-orange-400"
                                        onClick={() => {
                                            if (!posSelectedClient) {
                                                alert("Debes seleccionar un cliente para ventas a crédito.");
                                                return;
                                            }
                                            handleMethodSelect('Crédito');
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* SINGLE METHOD VIEWS */}
                    {step === 'payment-details' && method === 'Tarjeta' && (
                        <div className="flex flex-col gap-6 max-w-lg mx-auto">
                            <div className="text-center space-y-4">
                                <p className="text-gray-300 text-lg">
                                    La cajera cobrará con el datáfono físico. Cuando salga el recibo, confirma el pago.
                                </p>
                                <div className="bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 p-8 rounded-xl shadow-[0_0_20px_rgba(0,240,255,0.1)]">
                                    <p className="text-[var(--color-primary)] font-bold mb-2 uppercase text-sm tracking-wider">Monto a cobrar</p>
                                    <span className="text-6xl font-extrabold text-white tracking-tight text-glow">{formatCurrency(total, currentCurrency)}</span>
                                    <p className="text-gray-400 text-sm mt-3 font-medium">Se cobrará el monto total con tarjeta</p>
                                </div>
                            </div>
                            <div className="space-y-4 mt-4">
                                <h4 className="font-bold text-white text-lg">Datáfono utilizado</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {paymentTerminals.length === 0 ? (
                                        <p className="col-span-2 text-center text-gray-400 py-4 italic">
                                            No hay terminales configurados. Ve a Configuración &gt; Medios de Pago.
                                        </p>
                                    ) : (
                                        paymentTerminals.map(terminal => (
                                            <button
                                                key={terminal.id}
                                                onClick={() => setSelectedTerminal(terminal.name)}
                                                className={cn(
                                                    "flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all relative overflow-hidden group",
                                                    selectedTerminal === terminal.name
                                                        ? "bg-white/10 border-white shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                                                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/30"
                                                )}
                                                style={{ borderColor: selectedTerminal === terminal.name ? terminal.color || '#3B82F6' : undefined }}
                                            >
                                                <div
                                                    className={cn("mb-3 rounded-full p-3 transition-colors", selectedTerminal === terminal.name ? "bg-white/20" : "bg-white/10 group-hover:bg-white/20")}
                                                    style={{ color: terminal.color || '#3B82F6' }}
                                                >
                                                    <CreditCard size={32} />
                                                </div>
                                                <span className="font-bold text-lg text-white">{terminal.name}</span>
                                                {selectedTerminal === terminal.name && <div className="absolute top-2 right-2 text-white"><Check size={16} strokeWidth={4} /></div>}
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'payment-details' && method === 'Transferencia' && (
                        <div className="flex flex-col gap-6 max-w-lg mx-auto">
                            <div className="text-center space-y-2">
                                <p className="text-gray-300">El cliente ya realizó la transferencia por el monto exacto.</p>
                                <div className="bg-green-500/10 border border-green-500/30 p-6 rounded-xl shadow-[0_0_15px_rgba(34,197,94,0.2)]">
                                    <p className="text-green-400 font-bold mb-1 uppercase text-xs tracking-wider">Monto transferido</p>
                                    <span className="text-5xl font-bold text-white tracking-tight">{formatCurrency(total, currentCurrency)}</span>
                                    <p className="text-green-400/80 text-sm mt-2 font-medium">El cliente transfirió el monto total exacto</p>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-white font-medium block">Cuenta de destino</label>
                                    <select
                                        className="glass-input w-full p-4 text-lg appearance-none cursor-pointer hover:bg-white/10 transition-colors"
                                        value={observations}
                                        onChange={(e) => setObservations(e.target.value)}
                                        defaultValue=""
                                    >
                                        <option value="" disabled className="bg-gray-900 text-gray-400">Selecciona la cuenta bancaria</option>
                                        {bankAccounts.map(account => (
                                            <option key={account.id} value={`${account.bank_name} - ${account.owner_name}`} className="bg-gray-900 text-white">
                                                {account.bank_name} - {account.account_type} {account.account_number} ({account.owner_name})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg flex gap-3 items-start">
                                    <div className="mt-0.5 text-yellow-500"><Check size={18} className="bg-yellow-500/20 rounded-full p-0.5" /></div>
                                    <p className="text-sm text-yellow-200/90 leading-relaxed"><span className="font-bold text-yellow-400">Nota:</span> Confirma que el cliente realizó la transferencia.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* MIXED PAYMENT VIEW */}
                    {step === 'payment-details' && method === 'Mixto' && (
                        <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
                            <div className="text-center mb-2">
                                <h3 className="text-4xl font-bold text-white tracking-tight">{formatCurrency(total, currentCurrency)}</h3>
                                <div className="flex justify-center gap-4 text-sm font-medium mt-2">
                                    <span className="text-green-400">Total recibido: {formatCurrency(getMixedTotal(), currentCurrency)}</span>
                                    <span className={cn(
                                        Math.abs(getMixedTotal() - total) < 0.01 ? "text-green-500" : "text-red-400"
                                    )}>
                                        {getMixedTotal() >= total ? 'Cobro cubierto' : `Por cobrar: ${formatCurrency(total - getMixedTotal(), currentCurrency)}`}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-sm text-gray-400 font-medium">Métodos de pago</label>
                                {mixedPayments.map((row, index) => (
                                    <div key={row.id} className="bg-white/5 border border-white/10 rounded-xl p-4 animate-[fadeIn_0.3s_ease-out]">
                                        <div className="flex gap-3 items-start">
                                            {/* Method Selector */}
                                            <div className="w-1/3">
                                                <select
                                                    className="glass-input w-full p-3 text-sm h-12 bg-[#1a1a1a] appearance-none cursor-pointer"
                                                    value={row.method}
                                                    onChange={(e) => updatePaymentRow(row.id, 'method', e.target.value)}
                                                >
                                                    {/* show available methods (includes current one) */}
                                                    {getAvailableMethods(row.id).map(m => (
                                                        <option key={m} value={m} className="bg-gray-900">{m}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Amount Input */}
                                            <div className="flex-1 relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                                <input
                                                    type="number"
                                                    value={row.amount}
                                                    onChange={(e) => updatePaymentRow(row.id, 'amount', e.target.value)}
                                                    className="glass-input w-full p-3 pl-8 text-sm h-12 font-bold text-right"
                                                    placeholder="0"
                                                />
                                            </div>

                                            {/* Delete Button */}
                                            {mixedPayments.length > 1 && (
                                                <button
                                                    onClick={() => handleRemoveMethod(row.id)}
                                                    className="p-3 h-12 w-12 flex items-center justify-center rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            )}
                                        </div>

                                        {/* Sub-inputs for specific methods */}
                                        {row.method === 'Tarjeta' && (
                                            <div className="mt-3 pl-1">
                                                <select
                                                    className="glass-input w-full p-2 text-sm bg-[#1a1a1a] border-dashed border-white/20"
                                                    value={row.terminal}
                                                    onChange={(e) => updatePaymentRow(row.id, 'terminal', e.target.value)}
                                                >
                                                    <option value="" disabled className="bg-gray-900">Seleccionar datáfono...</option>
                                                    {paymentTerminals.map(t => (
                                                        <option key={t.id} value={t.name} className="bg-gray-900">{t.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {row.method === 'Transferencia' && (
                                            <div className="mt-3 pl-1">
                                                <select
                                                    className="glass-input w-full p-2 text-sm bg-[#1a1a1a] border-dashed border-white/20"
                                                    value={row.account}
                                                    onChange={(e) => updatePaymentRow(row.id, 'account', e.target.value)}
                                                >
                                                    <option value="" disabled className="bg-gray-900">Seleccionar cuenta...</option>
                                                    {bankAccounts.map(a => (
                                                        <option key={a.id} value={`${a.bank_name} - ${a.owner_name}`} className="bg-gray-900">
                                                            {a.bank_name} - {a.account_type} ({a.owner_name})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {mixedPayments.length < 3 && getAvailableMethods(null).length > 0 && (
                                    <button
                                        onClick={handleAddMethod}
                                        className="w-full py-3 border-2 border-dashed border-var(--color-primary) text-[var(--color-primary)] rounded-xl hover:bg-[var(--color-primary)]/10 transition-colors flex items-center justify-center gap-2 font-medium"
                                    >
                                        <Plus size={20} />
                                        Agregar método
                                    </button>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Observaciones</label>
                                <textarea
                                    value={observations}
                                    onChange={(e) => setObservations(e.target.value)}
                                    className="glass-input w-full h-20 resize-none text-sm"
                                    placeholder="Notas adicionales sobre el pago..."
                                ></textarea>
                            </div>
                        </div>
                    )}

                    {/* CREDIT VIEW */}
                    {step === 'payment-details' && method === 'Crédito' && (
                        <div className="flex flex-col gap-6 max-w-lg mx-auto">
                            <div className="text-center space-y-2">
                                <p className="text-gray-300">Venta a Crédito para:</p>
                                <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                                    <p className="text-red-400 font-bold mb-1 uppercase text-xs tracking-wider">Cliente</p>
                                    <span className="text-3xl font-bold text-white tracking-tight">{posSelectedClient?.name}</span>
                                    <p className="text-red-400/80 text-sm mt-2 font-medium">Monto a anotar: {formatCurrency(total, currentCurrency)}</p>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-white font-medium block">Observaciones (Opcional)</label>
                                    <textarea
                                        value={observations}
                                        onChange={(e) => setObservations(e.target.value)}
                                        className="glass-input w-full h-24 resize-none text-sm p-4"
                                        placeholder="Detalles sobre el crédito..."
                                    ></textarea>
                                </div>
                                <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg flex gap-3 items-start">
                                    <div className="mt-0.5 text-yellow-500"><Check size={18} className="bg-yellow-500/20 rounded-full p-0.5" /></div>
                                    <p className="text-sm text-yellow-200/90 leading-relaxed"><span className="font-bold text-yellow-400">Nota:</span> Esta venta quedará registrada como deuda en la cuenta del cliente.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* BASIC CASH VIEW */}
                    {step === 'payment-details' && method !== 'Tarjeta' && method !== 'Transferencia' && method !== 'Mixto' && method !== 'Crédito' && (
                        <div className="flex flex-col gap-6 max-w-md mx-auto">

                            <div className="text-center">
                                <span className="text-5xl font-bold text-white tracking-tight">{formatCurrency(total, currentCurrency)}</span>
                                <p className="text-red-400 text-sm mt-1 font-medium">Por cobrar: {formatCurrency(total, currentCurrency)}</p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">
                                        Valor del pago en {method} <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        value={amountPaid}
                                        onChange={(e) => setAmountPaid(e.target.value)}
                                        className="glass-input w-full text-center !text-4xl font-bold py-4 h-16"
                                        autoFocus
                                        placeholder="0"
                                    />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {suggestions.map((amt) => (
                                        <button key={amt} onClick={() => handleAmountClick(amt)} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white font-medium text-sm">
                                            {formatCurrency(amt, currentCurrency)}
                                        </button>
                                    ))}
                                </div>
                                <div className="text-center py-2">
                                    <span className={cn("text-xl font-bold", (parseFloat(amountPaid) - total) >= 0 ? "text-green-500" : "text-gray-500")}>
                                        Cambio: {formatCurrency((parseFloat(amountPaid) || 0) - total, currentCurrency)}
                                    </span>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Observaciones</label>
                                    <textarea value={observations} onChange={(e) => setObservations(e.target.value)} className="glass-input w-full h-20 resize-none text-sm" placeholder="Observaciones adicionales (opcional)"></textarea>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step === 'payment-details' && (
                    <div className="p-6 border-t border-white/10 bg-black/20 flex gap-4">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl border border-white/10 text-white hover:bg-white/5 transition-colors font-medium"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={
                                isProcessing || (
                                    method === 'Mixto'
                                        ? !isMixedValid()
                                        : method === 'Tarjeta'
                                            ? !selectedTerminal
                                            : method === 'Transferencia'
                                                ? !observations
                                                : method === 'Crédito'
                                                    ? false // Always valid if arrived here (client check done before)
                                                    : (parseFloat(amountPaid) || 0) < total
                                )
                            }
                            className={cn(
                                "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all",
                                method === 'Tarjeta'
                                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30"
                                    : method === 'Transferencia' || method === 'Crédito'
                                        ? "bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-500/30"
                                        : "btn-primary text-black"
                            )}
                        >
                            {isProcessing ? (
                                <Loader2 size={20} className="animate-spin" />
                            ) : (
                                <Check size={20} />
                            )}
                            {isProcessing
                                ? 'Procesando...'
                                : (method === 'Tarjeta' ? 'Confirmar y Pagar' : method === 'Transferencia' ? 'Confirmar Pago Recibido' : method === 'Crédito' ? 'Confirmar Crédito' : 'Pagar')
                            }
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const MethodButton = ({ icon, label, color, onClick }) => (
    <button
        onClick={onClick}
        className="glass-card hover:bg-white/10 transition-all p-8 flex flex-col items-center justify-center gap-4 group border border-white/5 hover:border-[var(--color-primary)]/50"
    >
        <div className={cn("transition-transform group-hover:scale-110 duration-300", color)}>
            {icon}
        </div>
        <span className="text-white font-bold text-lg">{label}</span>
    </button>
);

export default PaymentModal;
