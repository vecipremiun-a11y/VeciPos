import React, { useState } from 'react';
import { DollarSign, ArrowRight, Wallet, ArrowLeft } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';

const CashOpeningModal = ({ isOpen }) => {
    const { openRegister, currentUser } = useStore();
    const navigate = useNavigate();
    const [amount, setAmount] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!amount || isNaN(amount) || !currentUser) return;

        setIsLoading(true);
        await openRegister(currentUser.id, parseFloat(amount));
        setIsLoading(false); // Modal will unmount/hide because parent state checks cashRegister presence
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className="glass-card w-full max-w-md p-8 relative animate-[float_0.3s_ease-out]">
                {/* Back Button */}
                <button
                    onClick={() => navigate('/dashboard')}
                    className="absolute top-4 left-4 text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"
                    title="Volver al Dashboard"
                >
                    <ArrowLeft size={24} />
                </button>

                <div className="text-center mb-6">
                    <div className="w-16 h-16 mx-auto mb-4 bg-[var(--color-primary)]/20 rounded-full flex items-center justify-center text-[var(--color-primary)] shadow-[0_0_20px_rgba(0,240,255,0.2)]">
                        <Wallet size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Apertura de Caja</h2>
                    <p className="text-gray-400 text-sm">
                        Debes abrir la caja antes de comenzar las ventas.
                        Ingresa el monto inicial con el que comenzarás el turno.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-white ml-1">Monto de Apertura</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
                            <input
                                type="number"
                                className="glass-input w-full !pl-10 h-14 text-2xl font-bold text-white placeholder-gray-600 focus:border-[var(--color-primary)] transition-all"
                                placeholder="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                autoFocus
                                required
                                min="0"
                            />
                        </div>
                    </div>

                    <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex gap-3 items-start">
                        <div className="mt-1 text-blue-400">
                            <DollarSign size={16} />
                        </div>
                        <div className="space-y-1">
                            <p className="text-blue-200 font-bold text-sm">Recuerda:</p>
                            <ul className="text-xs text-blue-300/80 space-y-1 list-disc pl-4">
                                <li>Contar físicamente el efectivo antes de ingresarlo</li>
                                <li>Separar billetes falsos o dañados</li>
                            </ul>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || !amount}
                        className="btn-primary w-full py-4 text-lg flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <span>{isLoading ? 'Abriendo...' : 'Abrir Caja'}</span>
                        {!isLoading && <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default CashOpeningModal;
