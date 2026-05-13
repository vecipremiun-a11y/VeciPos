import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Check, CreditCard, ChevronDown, ChevronUp, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';

const ClientPaymentModal = ({ isOpen, onClose, client, sales, onConfirm }) => {
    const { currentCurrency } = useStore();
    const [paymentMethod, setPaymentMethod] = useState('Efectivo');
    const [customAmount, setCustomAmount] = useState('');
    const [showAllDistribution, setShowAllDistribution] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setPaymentMethod('Efectivo');
            setCustomAmount('');
            setShowAllDistribution(false);
            setTimeout(() => inputRef.current?.focus(), 150);
        }
    }, [isOpen]);

    // Filter pending sales (oldest first), accounting for partial payments
    const pendingSales = useMemo(() => {
        if (!client || !sales) return [];
        return sales.filter(s =>
            (s.clientId === client.id || s.client_id === client.id) &&
            (s.paymentMethod === 'Crédito' || s.payment_method === 'Crédito') &&
            s.status !== 'paid' && s.status !== 'cancelled'
        ).sort((a, b) => new Date(a.date) - new Date(b.date));
    }, [sales, client]);

    // Calculate remaining debt per sale (total - already paid)
    const salesWithDebt = useMemo(() => pendingSales.map(s => {
        const total = parseFloat(s.total);
        const alreadyPaid = parseFloat(s.amount_paid || 0);
        return { ...s, totalAmount: total, alreadyPaid, remaining: total - alreadyPaid };
    }), [pendingSales]);

    const totalGlobalDebt = useMemo(() => salesWithDebt.reduce((sum, s) => sum + s.remaining, 0), [salesWithDebt]);
    const paymentAmount = parseFloat(customAmount) || 0;

    // Distribute payment from oldest to newest
    const distribution = useMemo(() => {
        let remaining = paymentAmount;
        return salesWithDebt.map(sale => {
            if (remaining <= 0) {
                return { ...sale, applied: 0, newRemaining: sale.remaining, fullyPaid: false, partiallyPaid: false };
            }
            const apply = Math.min(remaining, sale.remaining);
            remaining -= apply;
            const newRemaining = sale.remaining - apply;
            return {
                ...sale,
                applied: apply,
                newRemaining,
                fullyPaid: newRemaining <= 0,
                partiallyPaid: apply > 0 && newRemaining > 0
            };
        });
    }, [paymentAmount, salesWithDebt]);

    const totalApplied = distribution.reduce((sum, d) => sum + d.applied, 0);
    const affectedCount = distribution.filter(d => d.applied > 0).length;
    const fullyPaidCount = distribution.filter(d => d.fullyPaid).length;
    const partialCount = distribution.filter(d => d.partiallyPaid).length;
    const remainingDebt = totalGlobalDebt - totalApplied;
    const isOverpay = paymentAmount > totalGlobalDebt;
    const effectiveAmount = Math.min(paymentAmount, totalGlobalDebt);

    // Quick amount buttons
    const quickAmounts = useMemo(() => {
        const amounts = [];
        if (totalGlobalDebt > 0) {
            const rounded = [5000, 10000, 20000, 50000].filter(a => a < totalGlobalDebt);
            amounts.push(...rounded);
            amounts.push(Math.round(totalGlobalDebt));
        }
        return [...new Set(amounts)].sort((a, b) => a - b).slice(0, 5);
    }, [totalGlobalDebt]);

    if (!isOpen || !client) return null;

    const handleSubmit = () => {
        if (effectiveAmount <= 0) return;
        // Build distribution data for the store
        const paymentDistribution = distribution
            .filter(d => d.applied > 0)
            .map(d => ({
                saleId: d.id,
                amount: d.applied,
                fullyPaid: d.fullyPaid,
                newTotalPaid: d.alreadyPaid + d.applied
            }));
        onConfirm(paymentDistribution, effectiveAmount, paymentMethod);
    };

    const handleAmountChange = (e) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        setCustomAmount(val);
    };

    // Show max 4 items by default in distribution preview
    const affectedDistribution = distribution.filter(d => d.applied > 0);
    const visibleDistribution = showAllDistribution ? affectedDistribution : affectedDistribution.slice(0, 4);
    const hasMore = affectedDistribution.length > 4;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl"
                >
                    <div className="absolute inset-0 bg-green-500/20 blur-3xl rounded-full opacity-30 pointer-events-none" />

                    <div className="relative glass-card bg-[#0f0f13] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">

                        {/* Header */}
                        <div className="p-6 border-b border-white/10 flex justify-between items-center relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500 to-transparent opacity-75" />
                            <div>
                                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-200 tracking-tight flex items-center gap-2">
                                    <CreditCard className="text-green-500" />
                                    Realizar Abono
                                </h2>
                                <p className="text-green-500/70 font-mono text-sm tracking-widest mt-1">
                                    {client.name}
                                </p>
                            </div>
                            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-white/50 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex flex-col md:flex-row h-full overflow-hidden">
                            {/* Left: Amount Input + Distribution Preview */}
                            <div className="flex-1 overflow-y-auto p-5 space-y-5 border-r border-white/10 custom-scrollbar">

                                {/* Amount Input */}
                                <div>
                                    <label className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 block">
                                        Monto a Abonar
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-green-500/60">$</span>
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            inputMode="numeric"
                                            value={customAmount ? Number(customAmount).toLocaleString('es-CL') : ''}
                                            onChange={handleAmountChange}
                                            placeholder="0"
                                            className="w-full bg-white/5 border-2 border-white/10 focus:border-green-500/60 rounded-xl py-4 pl-10 pr-4 text-3xl font-black text-white text-right outline-none transition-colors placeholder:text-white/15"
                                        />
                                    </div>
                                    {isOverpay && (
                                        <p className="text-yellow-400 text-xs mt-2 flex items-center gap-1">
                                            <AlertCircle size={12} />
                                            El monto excede la deuda. Se aplicará solo {formatCurrency(totalGlobalDebt, currentCurrency)}
                                        </p>
                                    )}

                                    {/* Quick Amount Buttons */}
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {quickAmounts.map(amt => (
                                            <button
                                                key={amt}
                                                onClick={() => setCustomAmount(String(amt))}
                                                className={`
                                                    px-3 py-1.5 rounded-lg text-xs font-bold transition-all border
                                                    ${parseFloat(customAmount) === amt
                                                        ? 'bg-green-500/20 text-green-400 border-green-500/50 scale-105'
                                                        : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/60'}
                                                `}
                                            >
                                                {amt === Math.round(totalGlobalDebt)
                                                    ? `Todo (${formatCurrency(amt, currentCurrency)})`
                                                    : formatCurrency(amt, currentCurrency)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Distribution Preview */}
                                {paymentAmount > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="space-y-2"
                                    >
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                                                <Zap size={12} className="text-green-400" />
                                                Distribución Automática
                                            </label>
                                            <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
                                                Del más antiguo al más nuevo
                                            </span>
                                        </div>

                                        <div className="space-y-1.5">
                                            {visibleDistribution.map((item, idx) => (
                                                <motion.div
                                                    key={item.id}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: idx * 0.03 }}
                                                    className={`
                                                        p-3 rounded-xl border transition-all
                                                        ${item.fullyPaid
                                                            ? 'bg-green-500/10 border-green-500/30'
                                                            : item.partiallyPaid
                                                                ? 'bg-yellow-500/10 border-yellow-500/30'
                                                                : 'bg-white/5 border-white/5'
                                                        }
                                                    `}
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        {item.fullyPaid ? (
                                                            <CheckCircle2 size={16} className="text-green-400 shrink-0" />
                                                        ) : (
                                                            <div className="w-4 h-4 rounded-full border-2 border-yellow-400 shrink-0 flex items-center justify-center">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                                                            </div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-xs text-white/60">
                                                                    {new Date(item.date).toLocaleDateString('es-CL')}
                                                                    <span className="text-white/30 ml-1.5">
                                                                        {item.items?.length || '?'} producto{(item.items?.length || 0) !== 1 ? 's' : ''}
                                                                    </span>
                                                                </span>
                                                                <span className="font-mono text-xs text-white/40">
                                                                    {formatCurrency(item.totalAmount, currentCurrency)}
                                                                </span>
                                                            </div>

                                                            {item.fullyPaid ? (
                                                                <p className="text-xs text-green-400 font-bold mt-0.5">
                                                                    ✓ Pagado completo
                                                                    {item.alreadyPaid > 0 && (
                                                                        <span className="text-green-400/60 font-normal ml-1">
                                                                            (abono anterior: {formatCurrency(item.alreadyPaid, currentCurrency)})
                                                                        </span>
                                                                    )}
                                                                </p>
                                                            ) : (
                                                                <div className="mt-1">
                                                                    <div className="flex justify-between text-xs">
                                                                        <span className="text-yellow-400 font-bold">
                                                                            Se abona: {formatCurrency(item.applied, currentCurrency)}
                                                                        </span>
                                                                        <span className="text-red-400/80">
                                                                            Queda: {formatCurrency(item.newRemaining, currentCurrency)}
                                                                        </span>
                                                                    </div>
                                                                    {/* Progress bar */}
                                                                    <div className="mt-1.5 w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                                                                        <div className="h-full rounded-full flex">
                                                                            {item.alreadyPaid > 0 && (
                                                                                <div
                                                                                    className="h-full bg-blue-400/60"
                                                                                    style={{ width: `${(item.alreadyPaid / item.totalAmount) * 100}%` }}
                                                                                />
                                                                            )}
                                                                            <div
                                                                                className="h-full bg-yellow-400"
                                                                                style={{ width: `${(item.applied / item.totalAmount) * 100}%` }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>

                                        {hasMore && (
                                            <button
                                                onClick={() => setShowAllDistribution(!showAllDistribution)}
                                                className="w-full text-center py-1.5 text-xs text-green-400/80 hover:text-green-400 flex items-center justify-center gap-1 transition-colors"
                                            >
                                                {showAllDistribution ? (
                                                    <>Ver menos <ChevronUp size={14} /></>
                                                ) : (
                                                    <>Ver {affectedDistribution.length - 4} más <ChevronDown size={14} /></>
                                                )}
                                            </button>
                                        )}

                                        {/* Summary badges */}
                                        {affectedCount > 0 && (
                                            <div className="flex flex-wrap gap-2 pt-1">
                                                {fullyPaidCount > 0 && (
                                                    <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold">
                                                        {fullyPaidCount} boleta{fullyPaidCount > 1 ? 's' : ''} pagada{fullyPaidCount > 1 ? 's' : ''} completa{fullyPaidCount > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                                {partialCount > 0 && (
                                                    <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold">
                                                        {partialCount} boleta con pago parcial
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </motion.div>
                                )}

                                {/* Empty state */}
                                {pendingSales.length === 0 && (
                                    <div className="text-center py-10 text-white/30 italic">
                                        No hay deudas pendientes.
                                    </div>
                                )}
                            </div>

                            {/* Right: Summary & Action */}
                            <div className="w-full md:w-72 bg-black/20 p-6 flex flex-col gap-6 shrink-0">
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2 block">Resumen</label>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-white/60">Deuda Total</span>
                                                <span className="text-white font-mono">{formatCurrency(totalGlobalDebt, currentCurrency)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-green-400 font-bold">Abono</span>
                                                <span className="text-green-400 font-mono font-bold">
                                                    {effectiveAmount > 0 ? `-${formatCurrency(effectiveAmount, currentCurrency)}` : formatCurrency(0, currentCurrency)}
                                                </span>
                                            </div>
                                            <div className="border-t border-white/10 my-2 pt-2 flex justify-between text-sm">
                                                <span className="text-white/60">Restante</span>
                                                <span className="text-white font-mono opacity-80">{formatCurrency(remainingDebt, currentCurrency)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Boletas info */}
                                    <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                                        <p className="text-xs text-white/40 mb-1">Boletas pendientes</p>
                                        <p className="text-xl font-black text-white">{pendingSales.length}</p>
                                        {affectedCount > 0 && (
                                            <p className="text-xs text-green-400/80 mt-1">
                                                {affectedCount} será{affectedCount > 1 ? 'n' : ''} afectada{affectedCount > 1 ? 's' : ''}
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2 block">Medio de Pago</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['Efectivo', 'Tarjeta', 'Transferencia'].map(method => (
                                                <button
                                                    key={method}
                                                    onClick={() => setPaymentMethod(method)}
                                                    className={`
                                                        px-3 py-2 rounded-lg text-xs font-bold transition-colors border
                                                        ${paymentMethod === method
                                                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                                                            : 'bg-white/5 text-white/50 border-transparent hover:bg-white/10'
                                                        }
                                                    `}
                                                >
                                                    {method}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-auto">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={effectiveAmount <= 0}
                                        className={`
                                            w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all
                                            ${effectiveAmount > 0
                                                ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:scale-[1.02] active:scale-[0.98]'
                                                : 'bg-white/10 text-white/20 cursor-not-allowed'
                                            }
                                        `}
                                    >
                                        <Check size={24} />
                                        Confirmar Abono
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ClientPaymentModal;
