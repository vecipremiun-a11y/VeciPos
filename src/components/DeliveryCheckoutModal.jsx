import React, { useState, useEffect, useMemo } from 'react';
import { X, Scale, Package, DollarSign, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';

const DeliveryCheckoutModal = ({ isOpen, onClose, preorderDetails, onDeliver, currentCurrency }) => {
    const [itemWeights, setItemWeights] = useState([]);
    const [paymentMethod, setPaymentMethod] = useState('Efectivo');
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (preorderDetails?.items) {
            setItemWeights(preorderDetails.items.map(item => ({
                id: item.id,
                product_name: item.product_name,
                qty: item.qty,
                unit: item.unit,
                billing_unit: item.billing_unit || 'unit',
                price_per_kg: item.price_per_kg || 0,
                gram_per_unit: item.gram_per_unit || 0,
                unit_price: item.unit_price,
                line_total: item.line_total,
                estimated_total: item.estimated_total || item.line_total,
                real_weight_kg: item.billing_unit === 'kg'
                    ? '' // empty so user must type
                    : null // not applicable
            })));
        }
    }, [preorderDetails]);

    const depositPaid = useMemo(() => {
        if (!preorderDetails?.payments) return 0;
        return preorderDetails.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    }, [preorderDetails]);

    const realTotal = useMemo(() => {
        return itemWeights.reduce((sum, iw) => {
            if (iw.billing_unit === 'kg') {
                const w = parseFloat(iw.real_weight_kg) || 0;
                return sum + w * iw.price_per_kg;
            }
            return sum + iw.line_total;
        }, 0);
    }, [itemWeights]);

    const balanceDue = Math.max(0, realTotal - depositPaid);
    const allWeightsFilled = itemWeights.every(iw =>
        iw.billing_unit !== 'kg' || (parseFloat(iw.real_weight_kg) > 0)
    );

    const handleWeightChange = (itemId, value) => {
        setItemWeights(prev => prev.map(iw =>
            iw.id === itemId ? { ...iw, real_weight_kg: value } : iw
        ));
    };

    const handleDeliver = async () => {
        if (!allWeightsFilled) return;
        setIsProcessing(true);
        try {
            await onDeliver(preorderDetails.preorder.id, itemWeights, paymentMethod);
            onClose();
        } catch (e) {
            console.error('Delivery error:', e);
        }
        setIsProcessing(false);
    };

    if (!isOpen || !preorderDetails) return null;

    const preorder = preorderDetails.preorder;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-slide-up">
                {/* Header */}
                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                            <Scale size={20} className="text-green-400" />
                        </div>
                        <div>
                            <h2 className="text-[var(--color-text)] font-bold text-lg">Entrega de Encargo</h2>
                            <p className="text-xs text-[var(--color-text-muted)]">
                                {preorder.client_name || 'Sin cliente'} — #{preorder.id}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1">
                        <X size={20} />
                    </button>
                </div>

                {/* Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {itemWeights.map(iw => (
                        <div key={iw.id} className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] space-y-2">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="text-[var(--color-text)] font-medium text-sm">{iw.product_name}</h4>
                                    <p className="text-xs text-[var(--color-text-muted)]">
                                        {iw.qty} {iw.unit}
                                        {iw.billing_unit === 'kg' && (
                                            <span className="ml-2 text-orange-400">
                                                · {formatCurrency(iw.price_per_kg, currentCurrency)}/kg
                                            </span>
                                        )}
                                    </p>
                                </div>
                                {iw.billing_unit !== 'kg' && (
                                    <span className="text-[var(--color-primary)] font-bold">
                                        {formatCurrency(iw.line_total, currentCurrency)}
                                    </span>
                                )}
                            </div>

                            {iw.billing_unit === 'kg' && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <Scale size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                placeholder="Peso real"
                                                className="glass-input w-full !pl-9 !pr-10 text-lg font-bold"
                                                value={iw.real_weight_kg}
                                                onChange={e => handleWeightChange(iw.id, e.target.value)}
                                                onClick={e => e.target.select()}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold pointer-events-none">kg</span>
                                        </div>
                                        <div className="text-right min-w-[80px]">
                                            <p className="text-[var(--color-primary)] font-bold">
                                                {formatCurrency((parseFloat(iw.real_weight_kg) || 0) * iw.price_per_kg, currentCurrency)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
                                        <span>Estimado: ~{((iw.qty * iw.gram_per_unit) / 1000).toFixed(2)} kg</span>
                                        <span>≈ {formatCurrency(iw.estimated_total, currentCurrency)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Summary */}
                <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-3">
                    {/* Real total */}
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-[var(--color-text-muted)]">Total Real</span>
                        <span className="text-[var(--color-text)] font-bold text-xl">
                            {formatCurrency(realTotal, currentCurrency)}
                        </span>
                    </div>

                    {/* Deposit already paid */}
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-[var(--color-text-muted)]">Abono(s) pagado(s)</span>
                        <span className="text-green-400 font-bold">
                            -{formatCurrency(depositPaid, currentCurrency)}
                        </span>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-[var(--glass-border)]"></div>

                    {/* Balance Due */}
                    <div className="flex justify-between items-center">
                        <span className="text-[var(--color-text)] font-bold text-lg">Saldo Final</span>
                        <span className={cn(
                            "font-bold text-2xl",
                            balanceDue > 0 ? "text-orange-400" : "text-green-400"
                        )}>
                            {balanceDue > 0
                                ? formatCurrency(balanceDue, currentCurrency)
                                : '✅ Pagado'
                            }
                        </span>
                    </div>

                    {/* Payment method for the balance */}
                    {balanceDue > 0 && (
                        <div className="flex gap-2">
                            {['Efectivo', 'Tarjeta', 'Transferencia'].map(m => (
                                <button key={m} onClick={() => setPaymentMethod(m)}
                                    className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                        paymentMethod === m
                                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                                            : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                    )}>
                                    {m === 'Efectivo' ? '💵' : m === 'Tarjeta' ? '💳' : '📱'} {m}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Warning if weights not filled */}
                    {!allWeightsFilled && (
                        <div className="flex items-center gap-2 text-xs text-orange-400 bg-orange-500/10 p-2 rounded-lg border border-orange-500/20">
                            <AlertTriangle size={14} />
                            Ingresa el peso real de todos los productos por kilo
                        </div>
                    )}

                    {/* Deliver button */}
                    <button
                        disabled={!allWeightsFilled || isProcessing}
                        onClick={handleDeliver}
                        className="w-full py-3 rounded-xl font-bold text-lg bg-green-500 text-black flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-400 transition-colors"
                    >
                        <CheckCircle2 size={20} />
                        {isProcessing ? 'Procesando...' : 'Confirmar Entrega'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeliveryCheckoutModal;
