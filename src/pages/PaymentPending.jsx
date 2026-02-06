import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, ArrowRight, Mail } from 'lucide-react';

const PaymentPending = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] dark:bg-[#050505] py-12">
            <div className="glass-card p-12 text-center max-w-2xl mx-4">
                {/* Pending Icon */}
                <div className="w-20 h-20 mx-auto mb-6 bg-yellow-500/10 rounded-full flex items-center justify-center">
                    <Clock className="w-12 h-12 text-yellow-500" />
                </div>

                {/* Title */}
                <h1 className="text-3xl font-bold text-[var(--color-text)] mb-4">
                    Pago Pendiente
                </h1>

                {/* Message */}
                <p className="text-lg text-[var(--color-text-muted)] mb-8">
                    Tu pago está siendo procesado. Recibirás un email cuando se complete.
                </p>

                {/* Info Box */}
                <div className="bg-yellow-500/5 border border-yellow-500/20 p-6 rounded-xl mb-8 text-left">
                    <div className="flex items-start gap-3">
                        <Mail className="w-5 h-5 text-yellow-500 mt-1" />
                        <div>
                            <h3 className="font-bold text-[var(--color-text)] mb-2">¿Qué sigue?</h3>
                            <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                                <li>• El procesamiento puede tomar de minutos a horas</li>
                                <li>• Te notificaremos por email cuando se complete</li>
                                <li>• Podrás acceder al sistema una vez aprobado el pago</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Button */}
                <button
                    onClick={() => navigate('/login')}
                    className="btn-primary px-8 py-4 text-lg inline-flex items-center gap-3"
                >
                    <span>Volver al Login</span>
                    <ArrowRight size={20} />
                </button>
            </div>
        </div>
    );
};

export default PaymentPending;
