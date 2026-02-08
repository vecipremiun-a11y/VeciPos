import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, Loader } from 'lucide-react';

const PaymentSuccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [isProcessing, setIsProcessing] = useState(true);

    const paymentId = searchParams.get('payment_id');

    useEffect(() => {
        // Simular tiempo de procesamiento del webhook
        const timer = setTimeout(() => {
            setIsProcessing(false);
        }, 3000);

        return () => clearTimeout(timer);
    }, []);

    if (isProcessing) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] dark:bg-[#050505]">
                <div className="glass-card p-12 text-center max-w-md">
                    <Loader className="w-16 h-16 mx-auto mb-6 text-[var(--color-primary)] animate-spin" />
                    <h2 className="text-2xl font-bold text-[var(--color-text)] mb-3">
                        Procesando tu pago...
                    </h2>
                    <p className="text-[var(--color-text-muted)]">
                        Estamos activando tu cuenta. Esto puede tomar unos segundos.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] dark:bg-[#050505] py-12">
            <div className="glass-card p-12 text-center max-w-2xl mx-4">
                {/* Success Icon */}
                <div className="w-20 h-20 mx-auto mb-6 bg-green-500/10 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                </div>

                {/* Title */}
                <h1 className="text-3xl font-bold text-[var(--color-text)] mb-4">
                    ¡Pago Exitoso!
                </h1>

                {/* Message */}
                <p className="text-lg text-[var(--color-text-muted)] mb-8">
                    Tu cuenta ha sido activada correctamente. Ya puedes comenzar a usar POSVECI.
                </p>

                {/* Info Box */}
                <div className="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 p-6 rounded-xl mb-8 text-left">
                    <h3 className="font-bold text-[var(--color-text)] mb-3">📧 Revisa tu email</h3>
                    <p className="text-sm text-[var(--color-text-muted)] mb-4">
                        Te hemos enviado un correo con:
                    </p>
                    <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                        <li>✓ Confirmación de tu suscripción</li>
                        <li>✓ Datos de acceso al sistema</li>
                        <li>✓ Guía de primeros pasos</li>
                    </ul>
                </div>

                {/* Trial Info */}
                <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-xl mb-8">
                    <p className="text-sm text-blue-400">
                        🎉 Tu prueba gratuita de <strong>15 días</strong> comienza ahora
                    </p>
                </div>

                {/* Button */}
                <button
                    onClick={() => {
                        // Limpiar sessionStorage
                        sessionStorage.removeItem('pendingRegistration');
                        navigate('/login');
                    }}
                    className="btn-primary px-8 py-4 text-lg inline-flex items-center gap-3"
                >
                    <span>Ir al Login</span>
                    <ArrowRight size={20} />
                </button>

                {/* Payment ID */}
                {paymentId && (
                    <p className="mt-6 text-xs text-[var(--color-text-muted)]">
                        ID de Pago: {paymentId}
                    </p>
                )}
            </div>
        </div>
    );
};

export default PaymentSuccess;
