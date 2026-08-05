import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Scale, Package, DollarSign, CheckCircle2, AlertTriangle, Plus, Minus } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import PaymentDetailPicker from './PaymentDetailPicker';

const DeliveryCheckoutModal = ({ isOpen, onClose, preorderDetails, onDeliver, currentCurrency }) => {
    const [itemWeights, setItemWeights] = useState([]);
    const [paymentMethod, setPaymentMethod] = useState('Efectivo');
    const [terminalId, setTerminalId] = useState(null);
    const [bankAccountId, setBankAccountId] = useState(null);
    const [authCode, setAuthCode] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // El modal no se desmonta al cerrarse (solo devuelve null), así que su estado
    // sobrevive de una apertura a la otra. Si los productos del siguiente encargo
    // no llegaran, se quedaba mostrando los del anterior. Se vacía siempre y se
    // vuelve a llenar solo con lo que llegó.
    useEffect(() => {
        if (!preorderDetails?.items?.length) {
            setItemWeights([]);
        } else {
            setItemWeights(preorderDetails.items.map(item => ({
                id: item.id,
                product_name: item.product_name,
                qty: item.qty,
                real_qty: item.qty, // arranca con la planeada, editable
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
                // Precio por kg: el peso real determina el total. real_qty es
                // solo conteo de unidades entregadas (informativo/tracking).
                const w = parseFloat(iw.real_weight_kg) || 0;
                return sum + w * iw.price_per_kg;
            }
            // Productos por unidad: total = real_qty * unit_price.
            const q = parseFloat(iw.real_qty) || 0;
            return sum + q * (iw.unit_price || 0);
        }, 0);
    }, [itemWeights]);

    const balanceDue = Math.max(0, realTotal - depositPaid);
    // OJO con el `every` a secas: sobre una lista VACÍA devuelve true, así que un
    // encargo que llegara sin productos habilitaba "Confirmar Entrega" y lo cerraba
    // con total $0. Se exige que haya productos.
    const allWeightsFilled = itemWeights.length > 0 && itemWeights.every(iw =>
        iw.billing_unit !== 'kg' || (parseFloat(iw.real_weight_kg) > 0)
    );

    const handleWeightChange = (itemId, value) => {
        setItemWeights(prev => prev.map(iw =>
            iw.id === itemId ? { ...iw, real_weight_kg: value } : iw
        ));
    };

    const handleQtyChange = (itemId, value) => {
        const v = Math.max(0, Number(value) || 0);
        setItemWeights(prev => prev.map(iw =>
            iw.id === itemId ? { ...iw, real_qty: v } : iw
        ));
    };

    const adjustQty = (itemId, delta) => {
        setItemWeights(prev => prev.map(iw => {
            if (iw.id !== itemId) return iw;
            const next = Math.max(0, (parseFloat(iw.real_qty) || 0) + delta);
            return { ...iw, real_qty: next };
        }));
    };

    const handleDeliver = async () => {
        if (!allWeightsFilled) return;
        setIsProcessing(true);
        try {
            await onDeliver(preorderDetails.preorder.id, itemWeights, paymentMethod, {
                terminalId: paymentMethod === 'Tarjeta' ? terminalId : null,
                bankAccountId: paymentMethod === 'Transferencia' ? bankAccountId : null,
                authCode: paymentMethod === 'Tarjeta' ? authCode.trim() : null,
            });
            onClose();
        } catch (e) {
            console.error('Delivery error:', e);
        }
        setIsProcessing(false);
    };

    // Sin `preorder` el encabezado reventaba (leía client_name de null) y la
    // pantalla quedaba en blanco: mejor no abrir que abrir roto.
    if (!isOpen || !preorderDetails?.preorder) return null;

    const preorder = preorderDetails.preorder;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-card modal-solido w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-slide-up">
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
                    {itemWeights.map(iw => {
                        const isKg = iw.billing_unit === 'kg';
                        const realQty = parseFloat(iw.real_qty) || 0;
                        const realKg = parseFloat(iw.real_weight_kg) || 0;
                        const qtyChanged = realQty !== iw.qty;
                        const lineTotal = isKg ? realKg * iw.price_per_kg : realQty * (iw.unit_price || 0);
                        return (
                            <div key={iw.id} className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] space-y-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="text-[var(--color-text)] font-medium text-sm">{iw.product_name}</h4>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            Planeado: {iw.qty} {iw.unit}
                                            {isKg && (
                                                <span className="ml-2 text-orange-400">
                                                    · {formatCurrency(iw.price_per_kg, currentCurrency)}/kg
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <span className="text-[var(--color-primary)] font-bold">
                                        {formatCurrency(lineTotal, currentCurrency)}
                                    </span>
                                </div>

                                {/* Control de unidades reales entregadas (+/−) */}
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-[var(--color-text-muted)] font-bold uppercase tracking-wider">Entregado</span>
                                    <div className="flex items-center gap-1">
                                        <button type="button" onClick={() => adjustQty(iw.id, -1)}
                                            className="w-7 h-7 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400 transition-all flex items-center justify-center">
                                            <Minus size={14} />
                                        </button>
                                        <input
                                            type="number"
                                            min="0"
                                            step={isKg ? '1' : 'any'}
                                            value={iw.real_qty}
                                            onChange={e => handleQtyChange(iw.id, e.target.value)}
                                            onFocus={e => e.target.select()}
                                            className="w-16 h-7 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-center font-bold text-[var(--color-text)] text-sm cursor-text"
                                        />
                                        <button type="button" onClick={() => adjustQty(iw.id, 1)}
                                            className="w-7 h-7 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-green-500/20 hover:border-green-500/30 hover:text-green-400 transition-all flex items-center justify-center">
                                            <Plus size={14} />
                                        </button>
                                        <span className="text-xs text-[var(--color-text-muted)] ml-1">{iw.unit}</span>
                                    </div>
                                    {qtyChanged && (
                                        <span className={cn(
                                            "text-[10px] font-bold px-1.5 py-0.5 rounded",
                                            realQty > iw.qty ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"
                                        )}>
                                            {realQty > iw.qty ? `+${(realQty - iw.qty).toFixed(realQty % 1 === 0 ? 0 : 2)}` : `${(realQty - iw.qty).toFixed(realQty % 1 === 0 ? 0 : 2)}`}
                                        </span>
                                    )}
                                </div>

                                {isKg && (
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <div className="relative flex-1">
                                                <Scale size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    placeholder="Peso real"
                                                    className="glass-input w-full !pl-9 !pr-10 text-lg font-bold cursor-text"
                                                    value={iw.real_weight_kg}
                                                    onChange={e => handleWeightChange(iw.id, e.target.value)}
                                                    // Al ENTRAR selecciona lo escrito (para reemplazarlo de una),
                                                    // pero los clics siguientes ya no: con onClick volvía a
                                                    // seleccionar todo cada vez y era imposible poner el cursor
                                                    // en un dígito para corregirlo.
                                                    onFocus={e => e.target.select()}
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold pointer-events-none">kg</span>
                                            </div>
                                            <div className="text-right min-w-[80px]">
                                                <p className="text-[var(--color-primary)] font-bold">
                                                    {formatCurrency(realKg * iw.price_per_kg, currentCurrency)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
                                            <span>Estimado: ~{((realQty * iw.gram_per_unit) / 1000).toFixed(2)} kg ({realQty} {iw.unit})</span>
                                            <span>≈ {formatCurrency(realQty * iw.gram_per_unit / 1000 * iw.price_per_kg, currentCurrency)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
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
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                {['Efectivo', 'Tarjeta', 'Transferencia'].map(m => (
                                    <button key={m} onClick={() => { setPaymentMethod(m); setTerminalId(null); setBankAccountId(null); setAuthCode(''); }}
                                        className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                            paymentMethod === m
                                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                                : "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]"
                                        )}>
                                        {m === 'Efectivo' ? '💵' : m === 'Tarjeta' ? '💳' : '📱'} {m}
                                    </button>
                                ))}
                            </div>
                            <PaymentDetailPicker
                                method={paymentMethod}
                                terminalId={terminalId}
                                bankAccountId={bankAccountId}
                                onChange={({ terminalId: tId, bankAccountId: baId }) => {
                                    if (tId !== undefined) setTerminalId(tId);
                                    if (baId !== undefined) setBankAccountId(baId);
                                }}
                            />
                            {paymentMethod === 'Tarjeta' && (
                                <div className="mt-2">
                                    <label className="block text-[10px] text-[var(--color-text-muted)] mb-1">
                                        Código de autorización <span className="text-[var(--color-text-muted)]">(del recibo · recomendado)</span>
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={authCode}
                                        onChange={(e) => setAuthCode(e.target.value.replace(/\s/g, ''))}
                                        placeholder="Ej: 541692"
                                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                                        autoComplete="off"
                                    />
                                </div>
                            )}
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
        </div>,
        document.body
    );
};

export default DeliveryCheckoutModal;
