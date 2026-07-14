import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Building2, User, Mail, Lock, ArrowRight, AlertCircle, Check } from 'lucide-react';
import { cn } from '../lib/utils';

const Register = () => {
    const navigate = useNavigate();
    const { login } = useStore();
    const [step, setStep] = useState(1); // 1: Datos, 2: Selección de plan

    // Datos de la empresa
    const [companyName, setCompanyName] = useState('');
    const [companyType, setCompanyType] = useState('minimarket');

    // Datos del usuario admin
    const [adminName, setAdminName] = useState('');
    const [adminEmail, setAdminEmail] = useState('');
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmitStep1 = async (e) => {
        e.preventDefault();
        setError('');

        // Validaciones
        if (!companyName.trim()) {
            setError('El nombre de la empresa es obligatorio');
            return;
        }

        if (!adminName.trim() || !adminEmail.trim() || !adminUsername.trim()) {
            setError('Todos los campos son obligatorios');
            return;
        }

        if (!adminEmail.includes('@')) {
            setError('El email no es válido');
            return;
        }

        if (adminPassword.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        if (adminPassword !== confirmPassword) {
            setError('Las contraseñas no coinciden');
            return;
        }

        // Crear cuenta de prueba gratis (30 días, sin pago) directamente en la BD del sistema
        setIsLoading(true);
        try {
            const response = await fetch('/api/start-trial', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    company: {
                        name: companyName,
                        type: companyType
                    },
                    admin: {
                        name: adminName,
                        email: adminEmail,
                        username: adminUsername,
                        password: adminPassword
                    }
                })
            });

            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'No se pudo crear la cuenta. Intenta nuevamente.');
                return;
            }

            // Cuenta creada: iniciar sesión automáticamente y entrar al sistema
            const result = await login(adminUsername.trim().toLowerCase(), adminPassword);
            if (result.success) {
                navigate('/dashboard');
            } else {
                // Cuenta creada pero el auto-login falló: mandar al login manual
                navigate('/login');
            }
        } catch (err) {
            console.error('Error creando prueba:', err);
            setError('Error de conexión. Por favor intenta nuevamente.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--color-surface)] dark:bg-[#050505] py-12">
            {/* Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-[var(--color-secondary)] opacity-10 blur-[120px] animate-[float_10s_ease-in-out_infinite]"></div>
                <div className="absolute bottom-[10%] right-[10%] w-[40%] h-[40%] rounded-full bg-[var(--color-primary)] opacity-10 blur-[120px] animate-[float_12s_ease-in-out_infinite_reverse]"></div>
            </div>

            <div className="glass-card w-full max-w-2xl p-8 relative z-10 border border-[var(--glass-border)] shadow-[0_0_50px_rgba(0,0,0,0.5)] mx-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-tr from-[var(--color-primary)] to-[var(--color-secondary)] rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(0,240,255,0.3)]">
                        <Building2 className="text-black" size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] tracking-tight mb-2">Crear cuenta POSVECI</h1>
                    <p className="text-[var(--color-text-muted)] text-sm">
                        Comienza tu prueba gratuita de 30 días
                    </p>
                </div>

                {/* Progress Steps */}
                <div className="flex items-center justify-center mb-8">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-primary)] text-white font-bold text-sm">
                            1
                        </div>
                        <span className="text-[var(--color-text)] font-medium">Datos de empresa</span>
                    </div>
                    <div className="w-16 h-0.5 bg-[var(--glass-border)] mx-4"></div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--glass-border)] text-[var(--color-text-muted)] font-bold text-sm">
                            2
                        </div>
                        <span className="text-[var(--color-text-muted)] font-medium">Acceso inmediato</span>
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmitStep1} className="space-y-6">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg text-sm flex items-center gap-2">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    {/* Sección Empresa */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                            <Building2 size={20} className="text-[var(--color-primary)]" />
                            Datos de la Empresa
                        </h3>

                        <div>
                            <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                Nombre de la Empresa *
                            </label>
                            <input
                                type="text"
                                className="glass-input w-full py-3"
                                placeholder="Ej: Minimarket Don José"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                Tipo de Negocio
                            </label>
                            <select
                                className="glass-input w-full py-3"
                                value={companyType}
                                onChange={(e) => setCompanyType(e.target.value)}
                            >
                                <option value="minimarket">Minimarket</option>
                                <option value="almacen">Almacén</option>
                                <option value="abarrotes">Abarrotes</option>
                                <option value="boutique">Boutique</option>
                                <option value="ferreteria">Ferretería</option>
                                <option value="libreria">Librería</option>
                                <option value="otro">Otro</option>
                            </select>
                        </div>
                    </div>

                    {/* Sección Usuario Admin */}
                    <div className="space-y-4 pt-4 border-t border-[var(--glass-border)]">
                        <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                            <User size={20} className="text-[var(--color-primary)]" />
                            Datos del Administrador
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                    Nombre Completo *
                                </label>
                                <input
                                    type="text"
                                    className="glass-input w-full py-3"
                                    placeholder="Juan Pérez"
                                    value={adminName}
                                    onChange={(e) => setAdminName(e.target.value)}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                    Email *
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
                                        <Mail size={18} />
                                    </span>
                                    <input
                                        type="email"
                                        className="glass-input w-full py-3 !pl-10"
                                        placeholder="juan@email.com"
                                        value={adminEmail}
                                        onChange={(e) => setAdminEmail(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                Usuario de Acceso *
                            </label>
                            <input
                                type="text"
                                className="glass-input w-full py-3"
                                placeholder="juan.perez"
                                value={adminUsername}
                                onChange={(e) => setAdminUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                    Contraseña *
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
                                        <Lock size={18} />
                                    </span>
                                    <input
                                        type="password"
                                        className="glass-input w-full py-3 !pl-10"
                                        placeholder="Mínimo 6 caracteres"
                                        value={adminPassword}
                                        onChange={(e) => setAdminPassword(e.target.value)}
                                        required
                                        minLength={6}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                    Confirmar Contraseña *
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
                                        <Lock size={18} />
                                    </span>
                                    <input
                                        type="password"
                                        className="glass-input w-full py-3 !pl-10"
                                        placeholder="Repetir contraseña"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Benefits */}
                    <div className="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 p-4 rounded-xl">
                        <p className="text-[var(--color-primary)] font-bold text-sm mb-3">✨ Incluye en tu prueba gratuita:</p>
                        <ul className="space-y-2">
                            {[
                                '30 días de acceso completo',
                                'Sin tarjeta de crédito requerida',
                                'Configuración guiada',
                                'Soporte por email'
                            ].map((benefit, idx) => (
                                <li key={idx} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                                    <Check size={16} className="text-[var(--color-primary)]" />
                                    {benefit}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-4 pt-4">
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="flex-1 px-6 py-3 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-colors"
                        >
                            Ya tengo cuenta
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 btn-primary py-3 flex items-center justify-center gap-2 group"
                        >
                            <span>{isLoading ? 'Creando tu cuenta...' : 'Comenzar prueba gratis'}</span>
                            {!isLoading && <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />}
                        </button>
                    </div>
                </form>

                {/* Footer */}
                <div className="mt-8 text-center text-xs text-[var(--color-text-muted)]">
                    Al continuar, aceptas nuestros{' '}
                    <a href="/terminos" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">Términos de Servicio</a>
                    {' '}y{' '}
                    <a href="/privacidad" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">Política de Privacidad</a>
                </div>
            </div>
        </div>
    );
};

export default Register;
