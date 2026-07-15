import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Lock, User, Eye, EyeOff, AlertCircle, ShieldCheck, WifiOff, FileCheck2, TrendingUp } from 'lucide-react';

// Login split-screen: panel de marca (izquierda, solo desktop) + formulario.
// El "dashboard" del panel izquierdo es ilustrativo, dibujado en CSS puro
// para no depender de imágenes externas.

const Login = () => {
    const navigate = useNavigate();
    const { login } = useStore();

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

        try {
            const result = await login(username, password);
            if (result.success) {
                navigate('/dashboard');
            } else {
                if (result.needsRenewal) {
                    navigate('/renew-subscription');
                } else {
                    setError(result.error || 'Credenciales inválidas. Intente nuevamente.');
                }
            }
        } catch (err) {
            console.error('Login error wrapper:', err);
            setError('Error de conexión.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex bg-[#0b1120] text-white">
            {/* ══════════ Panel izquierdo · marca (solo desktop) ══════════ */}
            <div className="hidden lg:flex flex-col flex-1 relative overflow-hidden bg-[#080d1a] px-14 py-10">
                {/* Fondo: gradiente profundo + trama sutil */}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#0c1428] via-[#080d1a] to-[#060a14]" />
                    <div
                        className="absolute inset-0 opacity-[0.35]"
                        style={{
                            backgroundImage: 'radial-gradient(rgba(59,130,246,0.14) 1px, transparent 1px)',
                            backgroundSize: '28px 28px',
                        }}
                    />
                    <div className="absolute -top-32 -left-32 w-[480px] h-[480px] bg-blue-600/10 rounded-full blur-[140px]" />
                    <div className="absolute bottom-0 right-0 w-[420px] h-[420px] bg-indigo-500/10 rounded-full blur-[140px]" />
                </div>

                {/* Separador diagonal con brillo hacia el panel derecho */}
                <div className="absolute top-[-10%] right-0 h-[120%] w-[2px] bg-gradient-to-b from-transparent via-blue-500/60 to-transparent rotate-[4deg] origin-top" />

                {/* Logo / marca */}
                <div className="relative flex items-center gap-3">
                    <img src="/icon-192.png" alt="POSVECI" className="w-12 h-12 rounded-xl shadow-lg shadow-blue-900/40" />
                    <div>
                        <p className="text-xl font-bold tracking-[0.18em]">
                            POS<span className="text-blue-400">VECI</span>
                        </p>
                        <p className="text-[11px] text-slate-400 -mt-0.5">Sistema POS Inteligente</p>
                    </div>
                </div>

                {/* Mensaje principal */}
                <div className="relative mt-16 max-w-md">
                    <h1 className="text-4xl xl:text-[2.75rem] font-bold leading-tight">
                        Gestiona tu negocio
                        <span className="block text-blue-400">con control total.</span>
                    </h1>
                    <div className="w-14 h-1 bg-blue-500 rounded-full mt-5" />
                    <p className="mt-5 text-slate-300/90 text-[15px] leading-relaxed">
                        Ventas, inventario, clientes y reportes en tiempo real,
                        desde cualquier dispositivo.
                    </p>
                </div>

                {/* Mini dashboard ilustrativo */}
                <div className="relative mt-12 max-w-lg" style={{ perspective: '1200px' }}>
                    <div
                        className="rounded-2xl border border-white/10 bg-[#0d1526]/90 backdrop-blur shadow-[0_30px_80px_-20px_rgba(2,6,23,0.9)] p-5"
                        style={{ transform: 'rotateX(4deg) rotateY(-4deg)' }}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-xs font-semibold text-slate-300">Dashboard</p>
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-slate-600" />
                                <span className="w-2 h-2 rounded-full bg-slate-600" />
                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            {/* Ventas hoy */}
                            <div className="col-span-1 rounded-xl bg-[#111c33] border border-white/5 p-3">
                                <p className="text-[10px] text-slate-400">Ventas hoy</p>
                                <p className="text-sm font-bold mt-1">$1.250.000</p>
                                <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1">
                                    <TrendingUp size={10} /> +12,5%
                                </p>
                            </div>
                            {/* Tickets */}
                            <div className="col-span-1 rounded-xl bg-[#111c33] border border-white/5 p-3">
                                <p className="text-[10px] text-slate-400">Tickets hoy</p>
                                <p className="text-sm font-bold mt-1">156</p>
                                <p className="text-[10px] text-emerald-400 mt-1">+8,3%</p>
                            </div>
                            {/* Mini gráfico de barras */}
                            <div className="col-span-1 rounded-xl bg-[#111c33] border border-white/5 p-3 flex flex-col">
                                <p className="text-[10px] text-slate-400 mb-2">Últimos 7 días</p>
                                <div className="flex items-end gap-1 flex-1 min-h-[34px]">
                                    {[35, 55, 42, 70, 58, 85, 100].map((h, i) => (
                                        <span
                                            key={i}
                                            className={`flex-1 rounded-sm ${i === 6 ? 'bg-blue-400' : 'bg-blue-500/45'}`}
                                            style={{ height: `${h}%` }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Productos más vendidos */}
                        <div className="mt-3 rounded-xl bg-[#111c33] border border-white/5 p-3">
                            <p className="text-[10px] text-slate-400 mb-2.5">Productos más vendidos</p>
                            <div className="space-y-2">
                                {[
                                    { name: 'Coca Cola 1.5L', w: '92%' },
                                    { name: 'Pan de Molde Blanco', w: '74%' },
                                    { name: 'Leche Entera 1L', w: '58%' },
                                ].map((p) => (
                                    <div key={p.name} className="flex items-center gap-3">
                                        <span className="text-[10px] text-slate-300 w-36 truncate">{p.name}</span>
                                        <span className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                            <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: p.w }} />
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sellos de confianza */}
                <div className="relative mt-auto pt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck size={13} className="text-blue-400" /> Datos cifrados
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <WifiOff size={13} className="text-blue-400" /> Funciona sin internet
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <FileCheck2 size={13} className="text-blue-400" /> Boleta electrónica SII
                    </span>
                </div>
            </div>

            {/* ══════════ Panel derecho · formulario ══════════ */}
            <div className="flex-1 lg:max-w-[46%] flex flex-col items-center justify-center relative px-4 py-10 bg-[#0b1120]">
                {/* Textura sutil de puntos */}
                <div
                    className="absolute inset-0 opacity-[0.25] pointer-events-none"
                    style={{
                        backgroundImage: 'radial-gradient(rgba(148,163,184,0.12) 1px, transparent 1px)',
                        backgroundSize: '22px 22px',
                    }}
                />

                <div className="relative w-full max-w-[400px]">
                    <div className="rounded-2xl border border-white/10 bg-[#0e1628]/90 backdrop-blur-xl shadow-[0_20px_70px_-20px_rgba(2,6,23,0.9)] p-8">
                        {/* Marca */}
                        <div className="flex flex-col items-center mb-7">
                            <div className="flex items-center gap-2.5">
                                <img src="/icon-192.png" alt="POSVECI" className="w-9 h-9 rounded-lg" />
                                <p className="text-lg font-bold tracking-[0.18em]">
                                    POS<span className="text-blue-400">VECI</span>
                                </p>
                            </div>
                            <h2 className="text-2xl font-bold mt-5">Iniciar sesión</h2>
                            <p className="text-sm text-slate-400 mt-1">Accede a tu cuenta para continuar</p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/40 text-red-300 p-3 rounded-lg text-sm flex items-center gap-2">
                                    <AlertCircle size={16} className="flex-shrink-0" />
                                    {error}
                                </div>
                            )}

                            {/* Usuario */}
                            <div className="group relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors">
                                    <User size={18} />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Usuario"
                                    autoComplete="username"
                                    className="w-full bg-[#0a111f] border border-white/10 text-white placeholder-slate-500 text-sm rounded-xl py-3.5 pl-11 pr-4 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </div>

                            {/* Contraseña */}
                            <div className="group relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Contraseña"
                                    autoComplete="current-password"
                                    className="w-full bg-[#0a111f] border border-white/10 text-white placeholder-slate-500 text-sm rounded-xl py-3.5 pl-11 pr-12 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            {/* Recordarme / olvido */}
                            <div className="flex items-center justify-between text-xs sm:text-[13px] text-slate-400 pt-1">
                                <label className="flex items-center gap-2 cursor-pointer hover:text-slate-200 transition-colors">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-white/20 bg-[#0a111f] checked:bg-blue-600 focus:ring-0 focus:ring-offset-0"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                    />
                                    Recordarme
                                </label>
                                <button type="button" className="text-blue-400 hover:text-blue-300 hover:underline transition-colors">
                                    ¿Olvidaste tu contraseña?
                                </button>
                            </div>

                            {/* Botón principal */}
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-70 text-white font-semibold text-[15px] shadow-[0_10px_30px_-10px_rgba(37,99,235,0.7)] transition-all active:scale-[0.99] mt-2"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Verificando...
                                    </span>
                                ) : (
                                    'Ingresar'
                                )}
                            </button>
                        </form>

                        {/* Registro */}
                        <div className="mt-6 pt-5 border-t border-white/5 text-center">
                            <p className="text-[13px] text-slate-400">
                                ¿Aún no tienes cuenta?{' '}
                                <button
                                    type="button"
                                    onClick={() => navigate('/registro')}
                                    className="text-blue-400 font-semibold hover:text-blue-300 hover:underline transition-colors"
                                >
                                    Comienza tu prueba gratis
                                </button>
                            </p>
                        </div>
                    </div>

                    {/* Pie */}
                    <p className="text-center text-[11px] text-slate-500 mt-6">
                        © {new Date().getFullYear()} PosVeci. Todos los derechos reservados. ·{' '}
                        <a href="/terminos" className="hover:text-slate-300 hover:underline">Términos</a> ·{' '}
                        <a href="/privacidad" className="hover:text-slate-300 hover:underline">Privacidad</a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
