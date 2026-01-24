import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Lock, User, AlertCircle, ArrowRight } from 'lucide-react';

const Login = () => {
    const navigate = useNavigate();
    const { login } = useStore();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const success = await login(username, password);
            if (success) {
                navigate('/dashboard');
            } else {
                setError('Credenciales inválidas. Intente nuevamente.');
            }
        } catch (err) {
            setError('Error de conexión.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--color-surface)] dark:bg-[#050505]">
            {/* Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-[var(--color-secondary)] opacity-10 blur-[120px] animate-[float_10s_ease-in-out_infinite]"></div>
                <div className="absolute bottom-[10%] right-[10%] w-[40%] h-[40%] rounded-full bg-[var(--color-primary)] opacity-10 blur-[120px] animate-[float_12s_ease-in-out_infinite_reverse]"></div>
            </div>

            <div className="glass-card w-full max-w-md p-8 relative z-10 border border-[var(--glass-border)] shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                <div className="text-center mb-10">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-tr from-[var(--color-primary)] to-[var(--color-secondary)] rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(0,240,255,0.3)]">
                        <Lock className="text-black" size={32} />
                    </div>
                    <h1 className="text-4xl font-bold text-[var(--color-text)] tracking-tight mb-2">POSKEM</h1>
                    <p className="text-[var(--color-text-muted)] text-sm tracking-widest uppercase">Acceso al Sistema</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg text-sm flex items-center gap-2 animate-[shake_0.5s_ease-in-out]">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider ml-1">Usuario</label>
                        <div className="relative group">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] group-focus-within:text-[var(--color-primary)] transition-colors">
                                <User size={20} />
                            </span>
                            <input
                                type="text"
                                className="glass-input w-full !pl-12 py-3 transition-all focus:border-[var(--color-primary)]/50 focus:shadow-[0_0_15px_rgba(0,240,255,0.1)]"
                                placeholder="usuario@empresa.cl"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider ml-1">Contraseña</label>
                        <div className="relative group">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] group-focus-within:text-[var(--color-primary)] transition-colors">
                                <Lock size={20} />
                            </span>
                            <input
                                type="password"
                                className="glass-input w-full !pl-12 py-3 transition-all focus:border-[var(--color-primary)]/50 focus:shadow-[0_0_15px_rgba(0,240,255,0.1)]"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="btn-primary w-full py-4 mt-6 text-base font-bold flex items-center justify-center gap-2 group relative overflow-hidden"
                    >
                        <span className="relative z-10">{isLoading ? 'Verificando...' : 'Iniciar Sesión'}</span>
                        {!isLoading && <ArrowRight size={20} className="relative z-10 group-hover:translate-x-1 transition-transform" />}
                        <div className="absolute inset-0 bg-[var(--glass-bg)] translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-widest">
                        Minimarket POS System v1.0
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
