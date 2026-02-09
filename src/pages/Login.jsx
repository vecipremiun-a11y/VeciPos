import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Lock, User, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

const Login = () => {
    const navigate = useNavigate();
    const { login, fetchInitialData } = useStore();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        console.log('🔐 Attempting login:', username);

        try {
            const result = await login(username, password);
            if (result.success) {
                console.log('✅ Login successful, loading data...');
                await fetchInitialData();
                console.log('✅ Data loaded, navigating to dashboard');
                navigate('/dashboard');
            } else {
                if (result.needsRenewal) {
                    navigate('/renew-subscription');
                } else {
                    setError(result.error || 'Credenciales inválidas. Intente nuevamente.');
                }
            }
        } catch (err) {
            console.error("Login error wrapper:", err);
            setError('Error de conexión.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-[#030712]">
            {/* Background Effects - Deep Space Theme */}
            <div className="absolute inset-0 w-full h-full z-0 pointer-events-none">
                {/* Nebula Gradients */}
                <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-blue-900/20 rounded-full blur-[150px] mix-blend-screen animate-pulse"></div>
                <div className="absolute bottom-[-20%] right-[-10%] w-[70%] h-[70%] bg-indigo-900/20 rounded-full blur-[150px] mix-blend-screen animate-pulse delay-1000"></div>

                {/* Twinkling Stars Simulation via CSS */}
                <div
                    className="absolute inset-0 opacity-40 animate-[fly_60s_linear_infinite]"
                    style={{
                        backgroundImage: `radial-gradient(white 1px, transparent 1px), radial-gradient(white 1px, transparent 1px)`,
                        backgroundSize: '50px 50px, 100px 100px',
                        backgroundPosition: '0 0, 25px 25px',
                        width: '200%',
                        height: '200%'
                    }}
                ></div>
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#030712]/50 to-[#030712]"></div>
            </div>

            {/* Login Card */}
            <div className="relative z-10 w-full max-w-[420px] p-8 mx-4">
                <div className="absolute inset-0 bg-blue-950/30 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_0_60px_-15px_rgba(37,99,235,0.3)]"></div>

                {/* Thin glowing border effect */}
                <div className="absolute inset-0 rounded-2xl border border-blue-500/20 pointer-events-none shadow-[inset_0_0_20px_rgba(59,130,246,0.1)]"></div>

                <div className="relative z-20">
                    <div className="text-center mb-10">
                        <h1 className="text-3xl font-bold text-white tracking-wide drop-shadow-md">
                            Iniciar Sesión
                        </h1>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-5">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-3 rounded-lg text-sm flex items-center gap-2 animate-[shake_0.5s_ease-in-out]">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            {/* Email Input */}
                            <div className="group relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-300/70 group-focus-within:text-blue-400 transition-colors">
                                    <User size={20} />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Correo Electrónico"
                                    className="w-full bg-[#0f172a]/60 border border-blue-900/30 text-white placeholder-blue-200/30 text-sm rounded-xl py-3.5 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all font-medium"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </div>

                            {/* Password Input */}
                            <div className="group relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-300/70 group-focus-within:text-blue-400 transition-colors">
                                    <Lock size={20} />
                                </div>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Contraseña"
                                    className="w-full bg-[#0f172a]/60 border border-blue-900/30 text-white placeholder-blue-200/30 text-sm rounded-xl py-3.5 pl-12 pr-12 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all font-medium"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-300/50 hover:text-blue-300 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Remember & Forgot Password */}
                        <div className="flex items-center justify-between text-xs sm:text-sm text-blue-200/70 mt-2">
                            <label className="flex items-center gap-2 cursor-pointer hover:text-blue-200 transition-colors">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-blue-900/50 bg-[#0f172a]/60 checked:bg-blue-600 focus:ring-0 focus:ring-offset-0 transition-all"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                />
                                Recordarme
                            </label>
                            <button type="button" className="hover:text-blue-200 hover:underline transition-colors">
                                ¿Olvidaste tu contraseña?
                            </button>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-700 to-blue-500 hover:from-blue-600 hover:to-blue-400 text-white font-bold text-lg shadow-[0_4px_20px_rgba(37,99,235,0.4)] hover:shadow-[0_6px_25px_rgba(37,99,235,0.5)] transform hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.98] mt-6 border-t border-white/10"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Verificando...
                                </span>
                            ) : (
                                "Ingresar"
                            )}
                        </button>

                        {/* Footer Link */}
                        <div className="text-center mt-8">
                            <p className="text-sm text-blue-200/60">
                                ¿Aún no tienes cuenta?{" "}
                                <button
                                    type="button"
                                    onClick={() => navigate('/registro')}
                                    className="text-white font-medium hover:underline hover:text-blue-300 transition-colors"
                                >
                                    Registrate
                                </button>
                            </p>
                        </div>
                    </form>
                </div>
            </div>

            {/* Holographic Decorations (simulated) */}
            <div className="absolute right-[5%] top-[20%] w-24 h-24 border border-blue-500/20 rounded-lg -rotate-12 bg-blue-500/5 backdrop-blur-sm hidden lg:block animate-float"></div>
            <div className="absolute right-[10%] bottom-[30%] w-16 h-16 border border-purple-500/20 rounded-lg rotate-12 bg-purple-500/5 backdrop-blur-sm hidden lg:block animate-float-delayed"></div>
        </div>
    );
};

export default Login;
