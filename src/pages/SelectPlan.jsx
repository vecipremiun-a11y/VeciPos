import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowLeft, CreditCard, Zap, Shield, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { SUBSCRIPTION_PLANS, formatPrice } from '../config/mercadopago';

const SelectPlan = () => {
    const navigate = useNavigate();
    const [selectedPlan, setSelectedPlan] = useState('monthly');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Verificar que hay datos de registro
    useEffect(() => {
        const pendingData = sessionStorage.getItem('pendingRegistration');
        if (!pendingData) {
            // Si no hay datos, redirigir a registro
            navigate('/registro');
        }
    }, [navigate]);

    const handleSelectPlan = async () => {
        setIsLoading(true);
        setError('');

        try {
            const registrationData = JSON.parse(sessionStorage.getItem('pendingRegistration'));
            const plan = SUBSCRIPTION_PLANS[selectedPlan];

            // Llamar al backend para crear la preferencia de pago
            const response = await fetch('/api/create-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    planId: plan.id,
                    planName: plan.name,
                    amount: plan.price,
                    currency: plan.currency,
                    registrationData: registrationData
                })
            });

            const data = await response.json();

            if (data.success && data.init_point) {
                // Redirigir al checkout de MercadoPago
                window.location.href = data.init_point;
            } else {
                setError(data.error || 'Error al crear el pago');
            }

        } catch (err) {
            console.error('Error creating payment:', err);
            setError('Error de conexión. Por favor intenta nuevamente.');
        } finally {
            setIsLoading(false);
        }
    };

    const plans = [
        {
            ...SUBSCRIPTION_PLANS.monthly,
            popular: false
        },
        {
            ...SUBSCRIPTION_PLANS.yearly,
            popular: true
        }
    ];

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--color-surface)] dark:bg-[#050505] py-12">
            {/* Background */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-[var(--color-secondary)] opacity-10 blur-[120px] animate-[float_10s_ease-in-out_infinite]"></div>
                <div className="absolute bottom-[10%] right-[10%] w-[40%] h-[40%] rounded-full bg-[var(--color-primary)] opacity-10 blur-[120px] animate-[float_12s_ease-in-out_infinite_reverse]"></div>
            </div>

            <div className="w-full max-w-6xl px-4">
                {/* Back Button */}
                <button
                    onClick={() => navigate('/registro')}
                    className="mb-6 flex items-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                    <ArrowLeft size={20} />
                    <span>Volver</span>
                </button>

                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-[var(--color-text)] mb-4">
                        Elige tu plan
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-lg">
                        Comienza con 15 días de prueba gratuita, sin tarjeta requerida
                    </p>
                </div>

                {/* Plans Grid */}
                <div className="grid md:grid-cols-2 gap-8 mb-8">
                    {plans.map((plan) => (
                        <div
                            key={plan.id}
                            onClick={() => setSelectedPlan(plan.id)}
                            className={cn(
                                "glass-card p-8 cursor-pointer transition-all relative",
                                selectedPlan === plan.id
                                    ? "border-2 border-[var(--color-primary)] shadow-[0_0_30px_rgba(0,240,255,0.3)]"
                                    : "border border-[var(--glass-border)] hover:border-[var(--color-primary)]/50"
                            )}
                        >
                            {/* Popular Badge */}
                            {plan.popular && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                                    <div className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-black px-4 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                                        <Star size={12} fill="currentColor" />
                                        MÁS POPULAR
                                    </div>
                                </div>
                            )}

                            {/* Radio Button */}
                            <div className="absolute top-6 right-6">
                                <div className={cn(
                                    "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                                    selectedPlan === plan.id
                                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                                        : "border-[var(--glass-border)]"
                                )}>
                                    {selectedPlan === plan.id && (
                                        <Check size={14} className="text-black" strokeWidth={3} />
                                    )}
                                </div>
                            </div>

                            {/* Plan Content */}
                            <div className="mb-6">
                                <h3 className="text-2xl font-bold text-[var(--color-text)] mb-2">
                                    {plan.name}
                                </h3>
                                {plan.discount && (
                                    <span className="inline-block bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-xs font-bold mb-4">
                                        {plan.discount}
                                    </span>
                                )}
                                <div className="flex items-baseline gap-2 mb-2">
                                    <span className="text-5xl font-extrabold text-[var(--color-text)]">
                                        {formatPrice(plan.pricePerMonth || plan.price)}
                                    </span>
                                    <span className="text-[var(--color-text-muted)]">/mes</span>
                                </div>
                                {plan.frequency === 'yearly' && (
                                    <p className="text-sm text-[var(--color-text-muted)]">
                                        Facturado anualmente {formatPrice(plan.price)}
                                    </p>
                                )}
                            </div>

                            {/* Features */}
                            <ul className="space-y-3 mb-6">
                                {plan.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3 text-sm text-[var(--color-text)]">
                                        <Check size={18} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            {/* Description */}
                            <p className="text-xs text-[var(--color-text-muted)] pt-4 border-t border-[var(--glass-border)]">
                                {plan.description}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Features Comparison */}
                <div className="glass-card p-6 mb-8">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 text-center">
                        Todos los planes incluyen:
                    </h3>
                    <div className="grid md:grid-cols-3 gap-6">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-3">
                                <Zap size={24} className="text-[var(--color-primary)]" />
                            </div>
                            <h4 className="font-bold text-[var(--color-text)] mb-1">Sin límites</h4>
                            <p className="text-sm text-[var(--color-text-muted)]">
                                Productos, ventas y usuarios ilimitados
                            </p>
                        </div>
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-3">
                                <Shield size={24} className="text-[var(--color-primary)]" />
                            </div>
                            <h4 className="font-bold text-[var(--color-text)] mb-1">100% Seguro</h4>
                            <p className="text-sm text-[var(--color-text-muted)]">
                                Datos encriptados y respaldos automáticos
                            </p>
                        </div>
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-3">
                                <CreditCard size={24} className="text-[var(--color-primary)]" />
                            </div>
                            <h4 className="font-bold text-[var(--color-text)] mb-1">Pago seguro</h4>
                            <p className="text-sm text-[var(--color-text-muted)]">
                                Procesado por MercadoPago
                            </p>
                        </div>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg text-center mb-6">
                        {error}
                    </div>
                )}

                {/* Continue Button */}
                <div className="text-center">
                    <button
                        onClick={handleSelectPlan}
                        disabled={isLoading}
                        className="btn-primary px-12 py-4 text-lg font-bold inline-flex items-center gap-3 disabled:opacity-50"
                    >
                        {isLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                <span>Procesando...</span>
                            </>
                        ) : (
                            <>
                                <CreditCard size={20} />
                                <span>Continuar al pago</span>
                            </>
                        )}
                    </button>
                    <p className="text-xs text-[var(--color-text-muted)] mt-4">
                        15 días gratis, cancela cuando quieras
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SelectPlan;
