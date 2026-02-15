import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { DollarSign, ArrowUpRight, ArrowDownLeft, Clock, ShoppingCart, LogOut, X, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../lib/utils';
import CashClosingModal from './CashClosingModal';
import CashCloseSuccessModal from './CashCloseSuccessModal';
import { formatCurrency } from '../utils/formatCurrency';

import { usePermissions } from '../hooks/usePermissions';

const CashStatusWidget = () => {
    const { cashRegister, registerStats, refreshRegisterStats, addCashMovement, closeRegister, currentUser, currentCurrency } = useStore();
    const { can } = usePermissions();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [txModalType, setTxModalType] = useState(null); // 'IN' or 'OUT'
    const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
    const [successModalData, setSuccessModalData] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);

    // Refresh stats periodically or when opening
    useEffect(() => {
        if (cashRegister) {
            refreshRegisterStats(cashRegister.id);
            const interval = setInterval(() => refreshRegisterStats(cashRegister.id), 10000); // Poll every 10s
            return () => clearInterval(interval);
        }
    }, [cashRegister, refreshRegisterStats]);

    // If no register is open AND no success data to show, render nothing
    if (!cashRegister && !successModalData) return null;

    const handleInitialCloseClick = () => {
        setIsClosingModalOpen(true);
        setIsOpen(false);
    };

    const handleConfirmClose = async (registerId, finalAmount, observations, difference) => {
        const success = await closeRegister(registerId, finalAmount, observations, difference);
        if (success) {
            // Prepare data for Success Modal
            setSuccessModalData({
                registerId,
                user: currentUser,
                openingTime: cashRegister.opening_time,
                closingTime: new Date().toISOString(),
                openingAmount: cashRegister.opening_amount,
                salesBreakdown: registerStats.salesBreakdown || { cash: registerStats.sales, card: 0, transfer: 0, total: registerStats.sales },
                movementsIn: registerStats.movements_in,
                movementsOut: registerStats.movements_out,
                expectedBalance: registerStats.balance,
                realBalance: finalAmount,
                difference: difference,
                observations: observations
            });
            setIsClosingModalOpen(false);
        }
    };

    const handleSuccessModalClose = () => {
        setSuccessModalData(null);
        navigate('/dashboard');
    };

    const handleTransactionConfirm = async (amount, reason) => {
        if (!txModalType || isProcessing) return;

        try {
            setIsProcessing(true);
            await addCashMovement(cashRegister.id, txModalType, amount, reason);
            await refreshRegisterStats(cashRegister.id);
            setTxModalType(null);
        } catch (error) {
            console.error("Transaction failed:", error);
            alert("Error al registrar movimiento");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <>
            {cashRegister && (
                <div className="relative">
                    {/* Widget Button */}
                    <button
                        onClick={() => {
                            setIsOpen(!isOpen);
                            refreshRegisterStats(cashRegister.id);
                        }}
                        className="h-10 px-4 rounded-xl bg-[var(--glass-bg)] border-[var(--glass-border)] flex items-center gap-3 hover:border-[var(--color-primary)] transition-all group"
                    >
                        <div className="flex flex-col items-end">
                            <span className="text-[var(--color-primary)] font-bold text-lg leading-none">
                                {formatCurrency(Math.floor(registerStats.balance), currentCurrency)}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                                <Clock size={10} />
                                Desde {format(new Date(cashRegister.opening_time), 'h:mm a', { locale: es })}
                            </span>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] group-hover:bg-[var(--color-primary)] group-hover:text-black transition-colors">
                            <DollarSign size={18} />
                        </div>
                    </button>

                    {/* Dropdown / Modal - Responsive - Using Portal */}
                    {isOpen && createPortal(
                        <div className="fixed inset-0 z-[9999]">
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)}></div>
                            <div className="absolute inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-auto sm:w-[360px] glass-card p-0 !bg-[#0f0f2d]/98 border-[var(--glass-border)] shadow-2xl overflow-hidden animate-[float_0.2s_ease-out] max-h-[90vh] flex flex-col rounded-2xl">
                                {/* Header */}
                                <div className="p-3 border-b border-[var(--glass-border)] flex justify-between items-center shrink-0">
                                    <h3 className="font-bold text-[var(--color-text)] text-sm lg:text-base">Estado de Caja</h3>
                                    <div className="flex items-center gap-2">
                                        <div className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px] lg:text-xs font-bold border border-green-500/30">
                                            Turno Activo
                                        </div>
                                        <button onClick={() => setIsOpen(false)} className="p-1 text-gray-400 hover:text-white">
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>

                                {/* Scrollable Content */}
                                <div className="flex-1 overflow-y-auto">
                                    {/* Main Balance */}
                                    <div className="p-4 bg-gradient-to-br from-[var(--color-primary)]/10 to-transparent flex flex-col items-center justify-center border-b border-[var(--glass-border)]">
                                        <span className="text-3xl lg:text-4xl font-extrabold text-[var(--color-primary)] mb-0.5 text-glow">
                                            {formatCurrency(registerStats.balance, currentCurrency)}
                                        </span>
                                        <span className="text-xs lg:text-sm text-[var(--color-text-muted)] font-medium">Saldo Actual en Caja</span>
                                    </div>

                                    {/* Quick Stats Grid */}
                                    <div className="grid grid-cols-2 gap-2 p-3">
                                        <div className="p-2 lg:p-3 bg-blue-500/5 rounded-xl border border-blue-500/20 flex flex-col items-center">
                                            <TrendingUp size={14} className="text-blue-400 mb-0.5" />
                                            <span className="text-lg lg:text-xl font-bold text-blue-400">{formatCurrency(registerStats.sales, currentCurrency)}</span>
                                            <span className="text-[10px] lg:text-xs text-blue-300/60">Ventas Efectivo</span>
                                        </div>
                                        <div className="p-2 lg:p-3 bg-orange-500/5 rounded-xl border border-orange-500/20 flex flex-col items-center">
                                            <TrendingDown size={14} className="text-orange-400 mb-0.5" />
                                            <span className="text-lg lg:text-xl font-bold text-orange-400">{formatCurrency(registerStats.movements_out, currentCurrency)}</span>
                                            <span className="text-[10px] lg:text-xs text-orange-300/60">Retiros</span>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                                        {can('pos.cash_in') && (
                                            <button
                                                onClick={() => setTxModalType('IN')}
                                                className="p-2.5 rounded-xl border border-green-500/30 text-green-400 hover:bg-green-500/10 font-bold text-xs lg:text-sm flex items-center justify-center gap-1.5 transition-all"
                                            >
                                                <ArrowDownLeft size={14} /> Ingreso
                                            </button>
                                        )}
                                        {can('pos.cash_out') && (
                                            <button
                                                onClick={() => setTxModalType('OUT')}
                                                className="p-2.5 rounded-xl border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 font-bold text-xs lg:text-sm flex items-center justify-center gap-1.5 transition-all"
                                            >
                                                <ArrowUpRight size={14} /> Retiro
                                            </button>
                                        )}
                                    </div>

                                    {/* Transaction List (Mini) */}
                                    <div className="px-3 pb-2">
                                        <h4 className="text-[10px] lg:text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Últimos Movimientos</h4>
                                        <div className="space-y-1.5 max-h-[120px] lg:max-h-[150px] overflow-y-auto pr-1 scrollbar-thin">
                                            <div className="flex justify-between items-center text-xs lg:text-sm p-1.5 lg:p-2 rounded-lg hover:bg-[var(--glass-bg)] transition-colors">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 lg:w-8 lg:h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 border border-yellow-500/30">
                                                        <Clock size={12} />
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-[var(--color-text)] text-xs lg:text-sm">Apertura</span>
                                                        <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">Apertura de caja</span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <span className="block font-bold text-green-400 text-xs lg:text-sm">+{formatCurrency(registerStats.initial, currentCurrency)}</span>
                                                    <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">{format(new Date(cashRegister.opening_time), 'h:mm a')}</span>
                                                </div>
                                            </div>

                                            {registerStats.transactions.map((tx) => (
                                                <div key={tx.id} className="flex justify-between items-center text-xs lg:text-sm p-1.5 lg:p-2 rounded-lg hover:bg-[var(--glass-bg)] transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn(
                                                            "w-6 h-6 lg:w-8 lg:h-8 rounded-full flex items-center justify-center border",
                                                            tx.type === 'VENTA' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                                                                tx.type === 'INGRESO' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                                                                    "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                                        )}>
                                                            {tx.type === 'VENTA' ? <ShoppingCart size={12} /> :
                                                                tx.type === 'INGRESO' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-[var(--color-text)] text-xs lg:text-sm truncate max-w-[100px] lg:max-w-[140px]">
                                                                {tx.type === 'VENTA' ? 'Venta (Efectivo)' :
                                                                    tx.type === 'INGRESO' ? (tx.reason || 'Ingreso') :
                                                                        (tx.reason || 'Retiro')}
                                                            </span>
                                                            <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">{tx.type}</span>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={cn("block font-bold text-xs lg:text-sm",
                                                            (tx.type === 'VENTA' || tx.type === 'INGRESO') ? "text-green-400" : "text-orange-400"
                                                        )}>
                                                            {(tx.type === 'VENTA' || tx.type === 'INGRESO') ? '+' : '-'}{formatCurrency(tx.amount, currentCurrency)}
                                                        </span>
                                                        <span className="text-[9px] lg:text-[10px] text-[var(--color-text-muted)]">{format(new Date(tx.date), 'h:mm a')}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="p-3 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] shrink-0">
                                    {can('pos.close_register') && (
                                        <button
                                            onClick={handleInitialCloseClick}
                                            className="w-full py-2.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 font-bold text-sm transition-all flex items-center justify-center gap-2"
                                        >
                                            <LogOut size={16} />
                                            Cerrar Caja
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
            )}

            {/* Sub Modals */}
            <TransactionModal
                isOpen={!!txModalType}
                onClose={() => setTxModalType(null)}
                type={txModalType}
                onConfirm={handleTransactionConfirm}
                isProcessing={isProcessing}
            />

            {/* Only render closing modal if register exists (it requires register stats) */}
            {cashRegister && (
                <CashClosingModal
                    isOpen={isClosingModalOpen}
                    onClose={() => setIsClosingModalOpen(false)}
                    stats={registerStats}
                    registerId={cashRegister.id}
                    onConfirm={handleConfirmClose}
                />
            )}

            <CashCloseSuccessModal
                isOpen={!!successModalData}
                onClose={handleSuccessModalClose}
                data={successModalData}
            />
        </>
    );
};

const TransactionModal = ({ isOpen, onClose, type, onConfirm, isProcessing }) => {
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setReason('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (!amount) return;
        onConfirm(parseFloat(amount), reason || (type === 'IN' ? 'Ingreso Manual' : 'Retiro Manual'));
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-surface)]/50 dark:bg-black/80 backdrop-blur-sm">
            <div className="glass-card w-full max-w-sm p-6 relative animate-[float_0.3s_ease-out] !bg-[#0f0f2d]/90">
                <button onClick={onClose} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={20} /></button>

                <h3 className="text-xl font-bold text-[var(--color-text)] mb-6 flex items-center gap-2">
                    {type === 'IN' ? <ArrowDownLeft className="text-green-400" /> : <ArrowUpRight className="text-orange-400" />}
                    {type === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)] mb-1 block">Monto</label>
                        <input
                            type="number"
                            placeholder="0"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            className="glass-input w-full text-2xl font-bold text-center"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)] mb-1 block">Motivo (Opcional)</label>
                        <input
                            type="text"
                            placeholder="Ej: Cambio, Pago proveedor..."
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            className="glass-input w-full text-sm"
                        />
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className={cn(
                            "w-full py-3 rounded-xl font-bold text-black shadow-lg transition-all flex items-center justify-center gap-2",
                            type === 'IN'
                                ? (isProcessing ? "bg-green-400/50 cursor-wait" : "bg-green-400 hover:bg-green-300 shadow-green-400/20")
                                : (isProcessing ? "bg-orange-400/50 cursor-wait" : "bg-orange-400 hover:bg-orange-300 shadow-orange-400/20")
                        )}
                    >
                        {isProcessing ? (
                            <>
                                <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                Procesando...
                            </>
                        ) : (
                            `Confirmar ${type === 'IN' ? 'Ingreso' : 'Retiro'}`
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default CashStatusWidget;
