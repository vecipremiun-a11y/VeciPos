import React from 'react';
import { useNavigate } from 'react-router-dom';
import { XCircle, RotateCw } from 'lucide-react';

const PaymentFailure = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] dark:bg-[#050505] py-12">
            <div className="glass-card p-12 text-center max-w-2xl mx-4">
                {/* Error Icon */}
                <div className="w-20 h-20 mx-auto mb-6 bg-red-500/10 rounded-full flex items-center justify-center">
                    <XCircle className="w-12 h-12 text-red-500" />
                </div>

                {/* Title */}
                <h1 className="text-3xl font-bold text-[var(--color-text)] mb-4">
                    Pago no Completado
                </h1>

                {/* Message */}
                <p className="text-lg text-[var(--color-text-muted)] mb-8">
                    Hubo un problema al procesar tu pago. No te preocupes, no se realizó ningún cargo.
                </p>

                {/* Info Box */}
                <div className="bg-red-500/5 border border-red-500/20 p-6 rounded-xl mb-8 text-left">
                    <h3 className="font-bold text-[var(--color-text)] mb-3">Posibles causas:</h3>
                    <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                        <li>• Fondos insuficientes</li>
                        <li>• Datos de tarjeta incorrectos</li>
                        <li>• Pago cancelado por el usuario</li>
                        <li>• Error temporal del banco</li>
                    </ul>
                </div>

                {/* Buttons */}
                <div className="flex gap-4 justify-center">
                    <button
                        onClick={() => navigate('/select-plan')}
                        className="btn-primary px-8 py-4 text-lg inline-flex items-center gap-3"
                    >
                        <RotateCw size={20} />
                        <span>Intentar Nuevamente</span>
                    </button>
                    <button
                        onClick={() => navigate('/login')}
                        className="px-8 py-4 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-colors"
                    >
                        Volver
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentFailure;
