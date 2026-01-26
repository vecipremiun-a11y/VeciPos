import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, CheckCircle, AlertTriangle, Save, ArrowRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const CashClosingModal = ({ isOpen, onClose, stats, registerId, onConfirm }) => {
    const [actualAmount, setActualAmount] = useState('');
    const [observations, setObservations] = useState('');
    const [difference, setDifference] = useState(0);

    // Expected Balance from system calculation
    const expectedBalance = stats.balance;

    useEffect(() => {
        if (isOpen) {
            // Default actual amount to expected balance as requested
            setActualAmount(expectedBalance.toString());
            setObservations('');
        }
    }, [isOpen, expectedBalance]);

    useEffect(() => {
        const actual = parseFloat(actualAmount) || 0;
        setDifference(actual - expectedBalance);
    }, [actualAmount, expectedBalance]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        const finalAmount = parseFloat(actualAmount) || 0;
        // Call parent handler (which calls store action)
        onConfirm(registerId, finalAmount, observations, difference);
        onClose();
    };

    const isMatch = Math.abs(difference) < 1;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-md relative animate-[float_0.3s_ease-out] p-0 overflow-hidden flex flex-col max-h-[90vh] !bg-[#0f0f2d]/95">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--color-primary)]/20 rounded-lg text-[var(--color-primary)]">
                            <Calculator size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Arqueo de Caja</h2>
                            <p className="text-xs text-gray-400">Cuadre de turno y cierre</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">

                    {/* Summary Section */}
                    <div className="bg-white/5 rounded-xl p-4 space-y-3 border border-white/5">
                        <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                            Resumen del Turno
                        </h3>
                        <div className="grid grid-cols-2 gap-y-2 text-sm">
                            <span className="text-gray-400">Apertura:</span>
                            <span className="text-right text-white font-mono">${stats.initial?.toLocaleString('es-CL')}</span>

                            <span className="text-green-400/80">Ventas (Efectivo):</span>
                            <span className="text-right text-green-400 font-mono">+${stats.sales?.toLocaleString('es-CL')}</span>

                            <span className="text-blue-400/80">Ingresos:</span>
                            <span className="text-right text-blue-400 font-mono">+${stats.movements_in?.toLocaleString('es-CL')}</span>

                            <span className="text-orange-400/80">Retiros:</span>
                            <span className="text-right text-orange-400 font-mono">-${stats.movements_out?.toLocaleString('es-CL')}</span>
                        </div>
                        <div className="pt-2 border-t border-white/10 flex justify-between items-center">
                            <span className="font-bold text-white">Saldo Esperado:</span>
                            <span className="font-bold text-xl text-[var(--color-primary)]">${expectedBalance.toLocaleString('es-CL')}</span>
                        </div>
                    </div>

                    {/* Actual Input Section */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Saldo Real (Conteo Físico)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
                            <input
                                type="number"
                                value={actualAmount}
                                onChange={(e) => setActualAmount(e.target.value)}
                                className="glass-input w-full pl-8 text-right text-2xl font-bold text-white tracking-wider appearance-none"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    {/* Status Message */}
                    <div className={cn(
                        "rounded-xl p-4 flex items-center gap-4 transition-colors",
                        isMatch ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"
                    )}>
                        {isMatch ? (
                            <>
                                <div className="bg-green-500/20 p-2 rounded-full text-green-400">
                                    <CheckCircle size={24} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-green-400">¡Caja Cuadrada!</h4>
                                    <p className="text-xs text-green-300/80">El saldo físico coincide con el sistema.</p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="bg-red-500/20 p-2 rounded-full text-red-400">
                                    <AlertTriangle size={24} />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold text-red-400">Diferencia Detectada</h4>
                                    <p className="text-xs text-red-300/80">
                                        {difference > 0 ? `Sobra dinero: +$${difference.toLocaleString('es-CL')}` : `Falta dinero: -$${Math.abs(difference).toLocaleString('es-CL')}`}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Observations */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Observaciones</label>
                        <textarea
                            value={observations}
                            onChange={(e) => setObservations(e.target.value)}
                            className="glass-input w-full h-24 resize-none text-sm"
                            placeholder="Notas sobre el arqueo, diferencias encontradas, etc..."
                        />
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="p-6 border-t border-white/10 bg-black/20 flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-colors border border-white/5"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={cn(
                            "flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg",
                            isMatch
                                ? "bg-[var(--color-primary)] text-black hover:bg-[var(--color-primary)]/90 shadow-[0_0_20px_rgba(0,240,255,0.2)]"
                                : "bg-red-500 text-white hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                        )}
                    >
                        <Save size={20} />
                        Cerrar Caja
                    </button>
                </div>

            </div>
        </div>,
        document.body
    );
};

export default CashClosingModal;
