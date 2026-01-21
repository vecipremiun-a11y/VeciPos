import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { DollarSign, ArrowUpRight, ArrowDownLeft, Clock, ShoppingCart, LogOut, X, TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../lib/utils';
import CashClosingModal from './CashClosingModal';
import CashCloseSuccessModal from './CashCloseSuccessModal';

const CashStatusWidget = () => {
    const { cashRegister, registerStats, refreshRegisterStats, addCashMovement, closeRegister, currentUser } = useStore();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [txModalType, setTxModalType] = useState(null); // 'IN' or 'OUT'
    const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
    const [successModalData, setSuccessModalData] = useState(null);

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
        if (!txModalType) return;
        await addCashMovement(cashRegister.id, txModalType, amount, reason);
        await refreshRegisterStats(cashRegister.id);
        setTxModalType(null);
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
                        className="h-10 px-4 rounded-xl bg-[#050505] border border-white/20 flex items-center gap-3 hover:border-[var(--color-primary)] transition-all group"
                    >
                        <div className="flex flex-col items-end">
                            <span className="text-[var(--color-primary)] font-bold text-lg leading-none">
                                ${Math.floor(registerStats.balance).toLocaleString('es-CL')}
                            </span>
                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                <Clock size={10} />
                                Desde {format(new Date(cashRegister.opening_time), 'h:mm a', { locale: es })}
                            </span>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] group-hover:bg-[var(--color-primary)] group-hover:text-black transition-colors">
                            <DollarSign size={18} />
                        </div>
                    </button>

                    {/* Dropdown / Modal */}
                    {isOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                            <div className="absolute top-16 right-0 w-[400px] glass-card p-0 !bg-[#050505] border border-white/20 shadow-2xl z-50 overflow-hidden animate-[float_0.2s_ease-out]">
                                {/* Header */}
                                <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                                    <h3 className="font-bold text-white">Estado de Caja</h3>
                                    <div className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/30">
                                        Turno Activo
                                    </div>
                                </div>

                                {/* Main Balance */}
                                <div className="p-6 bg-gradient-to-br from-[var(--color-primary)]/10 to-transparent flex flex-col items-center justify-center border-b border-white/5 relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-[var(--color-primary)]/5 opacity-0 group-hover:opacity-100 transition-opacity blur-xl"></div>
                                    <span className="text-4xl font-extrabold text-[var(--color-primary)] mb-1 relative z-10 text-glow">
                                        ${registerStats.balance.toLocaleString('es-CL')}
                                    </span>
                                    <span className="text-sm text-gray-400 font-medium relative z-10">Saldo Actual en Caja</span>
                                </div>

                                {/* Quick Stats Grid */}
                                <div className="grid grid-cols-2 gap-3 p-4">
                                    <div className="p-3 bg-blue-500/5 rounded-xl border border-blue-500/20 flex flex-col items-center">
                                        <TrendingUp size={16} className="text-blue-400 mb-1" />
                                        <span className="text-2xl font-bold text-blue-400">${registerStats.sales.toLocaleString('es-CL')}</span>
                                        <span className="text-xs text-blue-300/60">Ventas Efectivo</span>
                                    </div>
                                    <div className="p-3 bg-orange-500/5 rounded-xl border border-orange-500/20 flex flex-col items-center">
                                        <TrendingDown size={16} className="text-orange-400 mb-1" />
                                        <span className="text-2xl font-bold text-orange-400">${registerStats.movements_out.toLocaleString('es-CL')}</span>
                                        <span className="text-xs text-orange-300/60">Retiros</span>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="grid grid-cols-2 gap-3 px-4 pb-4">
                                    <button
                                        onClick={() => setTxModalType('IN')}
                                        className="p-3 rounded-xl border border-green-500/30 text-green-400 hover:bg-green-500/10 font-bold text-sm flex items-center justify-center gap-2 transition-all"
                                    >
                                        <ArrowDownLeft size={16} /> Ingreso
                                    </button>
                                    <button
                                        onClick={() => setTxModalType('OUT')}
                                        className="p-3 rounded-xl border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 font-bold text-sm flex items-center justify-center gap-2 transition-all"
                                    >
                                        <ArrowUpRight size={16} /> Retiro
                                    </button>
                                </div>

                                {/* Transaction List (Mini) */}
                                <div className="px-4 pb-2">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Últimos Movimientos</h4>
                                    <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1 scrollbar-thin">
                                        <div className="flex justify-between items-center text-sm p-2 rounded-lg hover:bg-white/5 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 border border-yellow-500/30">
                                                    <Clock size={14} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-white">Apertura</span>
                                                    <span className="text-[10px] text-gray-400">Apertura de caja</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="block font-bold text-green-400">+${registerStats.initial.toLocaleString('es-CL')}</span>
                                                <span className="text-[10px] text-gray-500">{format(new Date(cashRegister.opening_time), 'h:mm a')}</span>
                                            </div>
                                        </div>

                                        {registerStats.transactions.map((tx) => (
                                            <div key={tx.id} className="flex justify-between items-center text-sm p-2 rounded-lg hover:bg-white/5 transition-colors animate-[fadeIn_0.3s_ease-out]">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-full flex items-center justify-center border",
                                                        tx.type === 'VENTA' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                                                            tx.type === 'INGRESO' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                                                                "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                                    )}>
                                                        {tx.type === 'VENTA' ? <ShoppingCart size={14} /> :
                                                            tx.type === 'INGRESO' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-white">
                                                            {tx.type === 'VENTA' ? 'Venta (Efectivo)' :
                                                                tx.type === 'INGRESO' ? (tx.reason || 'Ingreso Manual') :
                                                                    (tx.reason || 'Retiro Manual')}
                                                        </span>
                                                        <span className="text-[10px] text-gray-400">{tx.type}</span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <span className={cn("block font-bold",
                                                        (tx.type === 'VENTA' || tx.type === 'INGRESO') ? "text-green-400" : "text-orange-400"
                                                    )}>
                                                        {(tx.type === 'VENTA' || tx.type === 'INGRESO') ? '+' : '-'}${tx.amount.toLocaleString('es-CL')}
                                                    </span>
                                                    <span className="text-[10px] text-gray-500">{format(new Date(tx.date), 'h:mm a')}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="p-4 border-t border-white/10 bg-black/40 mt-2">
                                    <button
                                        onClick={handleInitialCloseClick}
                                        className="w-full py-3 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 font-bold transition-all flex items-center justify-center gap-2 group"
                                    >
                                        <LogOut size={18} className="group-hover:-translate-x-1 transition-transform" />
                                        Cerrar Caja
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Sub Modals */}
            <TransactionModal
                isOpen={!!txModalType}
                onClose={() => setTxModalType(null)}
                type={txModalType}
                onConfirm={handleTransactionConfirm}
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

const TransactionModal = ({ isOpen, onClose, type, onConfirm }) => {
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

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="glass-card w-full max-w-sm p-6 relative animate-[float_0.3s_ease-out]">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20} /></button>

                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    {type === 'IN' ? <ArrowDownLeft className="text-green-400" /> : <ArrowUpRight className="text-orange-400" />}
                    {type === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-gray-400 mb-1 block">Monto</label>
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
                        <label className="text-sm text-gray-400 mb-1 block">Motivo (Opcional)</label>
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
                        className={cn(
                            "w-full py-3 rounded-xl font-bold text-black shadow-lg transition-all",
                            type === 'IN' ? "bg-green-400 hover:bg-green-300 shadow-green-400/20" : "bg-orange-400 hover:bg-orange-300 shadow-orange-400/20"
                        )}
                    >
                        Confirmar {type === 'IN' ? 'Ingreso' : 'Retiro'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CashStatusWidget;
