import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, LogOut } from 'lucide-react';
import { useStore } from '../store/useStore';

const RenewSubscription = () => {
    const navigate = useNavigate();
    const { logout } = useStore();

    const handleRenew = () => {
        // Redirigir a selección de plan
        navigate('/select-plan');
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] dark:bg-[#050505]">
            <div className="glass-card p-12 text-center max-w-2xl mx-4">
                {/* Warning Icon */}
                <div className="w-20 h-20 mx-auto mb-6 bg-orange-500/10 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-12 h-12 text-orange-500" />
                </div>

                {/* Title */}
                <h1 className="text-3xl font-bold text-[var(--color-text)] mb-4">
                    Suscripción Vencida
                </h1>

                {/* Message */}
                <p className="text-lg text-[var(--color-text-muted)] mb-8">
                    Tu suscripción ha expirado. Por favor renuévala para continuar usando POSVECI.
                </p>

                {/* Info Box */}
                <div className="bg-orange-500/5 border border-orange-500/20 p-6 rounded-xl mb-8 text-left">
                    <h3 className="font-bold text-[var(--color-text)] mb-3">¿Qué pasó con mis datos?</h3>
                    <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
                        <li>✓ Todos tus datos están seguros</li>
                        <li>✓ Tu información no se ha perdido</li>
                        <li>✓ Solo necesitas renovar para acceder</li>
                    </ul>
                </div>

                {/* Buttons */}
                <div className="flex gap-4 justify-center">
                    <button
                        onClick={handleRenew}
                        className="btn-primary px-8 py-4 text-lg inline-flex items-center gap-3"
                    >
                        <CreditCard size={20} />
                        <span>Renovar Suscripción</span>
                    </button>
                    <button
                        onClick={handleLogout}
                        className="px-8 py-4 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-colors inline-flex items-center gap-2"
                    >
                        <LogOut size={18} />
                        <span>Cerrar Sesión</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RenewSubscription;
