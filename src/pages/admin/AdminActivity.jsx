import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { formatDistanceToNow, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    Activity, Users, Search, RefreshCw, ChevronDown, Clock,
    ShoppingCart, AlertTriangle, Building2, CalendarClock, Inbox,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// Monitoreo de clientes: responde "¿este cliente está usando el sistema?".
// La señal es la actividad real (ventas, productos, compras…), no el login:
// el sistema no guarda logins, y de todos modos importa más si TRABAJAN en él.

const SALUD = {
    activo: { label: 'Activo', dot: 'bg-emerald-400', text: 'text-emerald-400', chip: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', hint: 'Trabajó en las últimas 48 h' },
    enfriando: { label: 'Enfriando', dot: 'bg-amber-400', text: 'text-amber-400', chip: 'bg-amber-500/10 border-amber-500/30 text-amber-400', hint: 'Sin movimientos hace 3-10 días' },
    inactivo: { label: 'Inactivo', dot: 'bg-red-500', text: 'text-red-400', chip: 'bg-red-500/10 border-red-500/30 text-red-400', hint: 'Más de 10 días sin usarlo' },
    nunca: { label: 'Nunca lo usó', dot: 'bg-zinc-600', text: 'text-zinc-400', chip: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400', hint: 'Se registró pero nunca cargó nada' },
};

const ESTADO = {
    trial: { label: 'Prueba', chip: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
    active: { label: 'Activa', chip: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
    past_due: { label: 'Vencida', chip: 'bg-orange-500/10 border-orange-500/30 text-orange-400' },
    blocked: { label: 'Bloqueada', chip: 'bg-red-500/10 border-red-500/30 text-red-400' },
    suspended: { label: 'Suspendida', chip: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400' },
    cancelled: { label: 'Cancelada', chip: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400' },
};

const hace = (iso) => {
    if (!iso) return 'nunca';
    try { return formatDistanceToNow(new Date(iso), { locale: es, addSuffix: true }); }
    catch { return '—'; }
};
const miles = (n) => Number(n || 0).toLocaleString('es-CL');
const plata = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');

const AdminActivity = () => {
    const { adminFetchClientActivity } = useStore();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filtro, setFiltro] = useState('todos');
    const [busca, setBusca] = useState('');
    const [abierta, setAbierta] = useState(null);

    const cargar = useCallback(async () => {
        setLoading(true);
        setError(null);
        const r = await adminFetchClientActivity();
        if (r?.success) setData(r);
        else setError(r?.error || 'No se pudo cargar la actividad');
        setLoading(false);
    }, [adminFetchClientActivity]);

    useEffect(() => { cargar(); }, [cargar]);

    // Referencia estable: sin esto el array se recrea en cada render y los
    // useMemo de abajo recalculan siempre.
    const companies = useMemo(() => data?.companies || [], [data]);

    const conteo = useMemo(() => {
        const c = { activo: 0, enfriando: 0, inactivo: 0, nunca: 0 };
        companies.forEach(x => { c[x.salud] = (c[x.salud] || 0) + 1; });
        return c;
    }, [companies]);

    // Lo que hay que mirar primero: paga (o está por pagar) pero no lo está usando.
    const atencion = useMemo(() => companies.filter(c =>
        ['trial', 'active'].includes(c.status) && c.salud !== 'activo'
    ), [companies]);

    const lista = useMemo(() => {
        const t = busca.trim().toLowerCase();
        const orden = { inactivo: 0, nunca: 1, enfriando: 2, activo: 3 };
        return companies
            .filter(c => filtro === 'todos' || c.salud === filtro)
            .filter(c => !t || [c.name, c.owner, c.email, c.id].some(v => String(v || '').toLowerCase().includes(t)))
            .sort((a, b) => (orden[a.salud] - orden[b.salud]) || String(a.name).localeCompare(String(b.name)));
    }, [companies, filtro, busca]);

    return (
        <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
                <div>
                    <h1 className="text-3xl font-bold text-white">Monitoreo de Clientes</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Quién está usando el sistema y quién se está enfriando, para llegar antes de que se vaya.
                    </p>
                </div>
                <button
                    onClick={cargar}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#18181b] border border-white/10 text-sm font-bold text-white hover:border-red-500/40 disabled:opacity-60"
                >
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>
            {data?.generatedAt && (
                <p className="text-xs text-gray-600 mb-6">Datos al {hace(data.generatedAt)}</p>
            )}

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>
            )}

            {/* Resumen por salud — también funcionan como filtro */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                {Object.entries(SALUD).map(([key, s]) => (
                    <button
                        key={key}
                        onClick={() => setFiltro(filtro === key ? 'todos' : key)}
                        className={cn(
                            'text-left p-5 rounded-2xl border transition-all',
                            filtro === key
                                ? 'bg-white/[0.06] border-white/25'
                                : 'bg-[#18181b] border-white/10 hover:border-white/20'
                        )}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <span className={cn('w-2.5 h-2.5 rounded-full', s.dot)} />
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</span>
                        </div>
                        <p className={cn('text-3xl font-bold', s.text)}>{conteo[key] || 0}</p>
                        <p className="text-[11px] text-gray-600 mt-1 leading-snug">{s.hint}</p>
                    </button>
                ))}
            </div>

            {/* Alertas accionables */}
            {atencion.length > 0 && (
                <div className="mb-6 p-4 rounded-2xl bg-amber-500/[0.07] border border-amber-500/25">
                    <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={16} className="text-amber-400" />
                        <h2 className="text-sm font-bold text-amber-300">
                            {atencion.length} {atencion.length === 1 ? 'cliente necesita' : 'clientes necesitan'} atención
                        </h2>
                    </div>
                    <p className="text-xs text-amber-200/60 mb-3">
                        Tienen la cuenta al día (activa o en prueba) pero no están trabajando en el sistema.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {atencion.map(c => (
                            <button
                                key={c.id}
                                onClick={() => { setFiltro('todos'); setBusca(c.name); setAbierta(c.id); }}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/30 border border-amber-500/20 text-xs text-white hover:border-amber-500/50"
                            >
                                <span className={cn('w-1.5 h-1.5 rounded-full', SALUD[c.salud].dot)} />
                                {c.name}
                                <span className="text-amber-200/50">· {hace(c.lastActivity)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Buscador */}
            <div className="relative mb-4">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar por empresa, dueño o email..."
                    className="w-full bg-[#18181b] border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:border-red-500/50 outline-none"
                />
            </div>

            {loading && !data ? (
                <div className="py-20 text-center text-gray-500 text-sm">Cargando actividad…</div>
            ) : lista.length === 0 ? (
                <div className="py-20 text-center text-gray-500 text-sm flex flex-col items-center gap-3">
                    <Inbox size={28} className="text-gray-700" />
                    No hay clientes que coincidan.
                </div>
            ) : (
                <div className="space-y-3">
                    {lista.map(c => (
                        <TarjetaCliente
                            key={c.id}
                            c={c}
                            abierta={abierta === c.id}
                            onToggle={() => setAbierta(abierta === c.id ? null : c.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const TarjetaCliente = ({ c, abierta, onToggle }) => {
    const s = SALUD[c.salud];
    const est = ESTADO[c.status] || { label: c.status, chip: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400' };
    const diasAcceso = c.accessUntil ? differenceInCalendarDays(new Date(c.accessUntil), new Date()) : null;

    return (
        <div className={cn(
            'rounded-2xl border bg-[#18181b] overflow-hidden transition-all',
            abierta ? 'border-white/25' : 'border-white/10 hover:border-white/20'
        )}>
            <button onClick={onToggle} className="w-full text-left p-5">
                <div className="flex flex-wrap items-start gap-4">
                    {/* Identidad */}
                    <div className="flex items-start gap-3 min-w-[220px] flex-1">
                        <div className="relative mt-0.5">
                            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                <Building2 size={17} className="text-gray-400" />
                            </div>
                            <span className={cn('absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#18181b]', s.dot)} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-bold text-white truncate">{c.name}</h3>
                                {c.isBranch && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 text-gray-500 border border-white/10">sucursal</span>
                                )}
                            </div>
                            <p className="text-xs text-gray-500 truncate">{c.owner || 'sin dueño'}{c.email ? ` · ${c.email}` : ''}</p>
                            <div className="flex items-center gap-1.5 mt-2">
                                <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold border', s.chip)}>{s.label}</span>
                                <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold border', est.chip)}>{est.label}</span>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border border-white/10 text-gray-400 capitalize">{c.plan}</span>
                            </div>
                        </div>
                    </div>

                    {/* Métricas */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                        <Metrica icon={<Clock size={13} />} label="Última actividad"
                            value={hace(c.lastActivity)} tone={s.text} />
                        <Metrica icon={<Users size={13} />} label="Usuarios activos"
                            value={`${c.activeUsers7d} de ${c.userCount}`}
                            tone={c.activeUsers7d === 0 ? 'text-red-400' : 'text-white'} />
                        <Metrica icon={<ShoppingCart size={13} />} label="Ventas (7 días)"
                            value={miles(c.sales7d)} tone={c.sales7d === 0 ? 'text-red-400' : 'text-white'} />
                        <Metrica icon={<Activity size={13} />} label="Facturado (30 d)"
                            value={plata(c.revenue30d)} />
                    </div>

                    <ChevronDown size={18} className={cn('text-gray-500 shrink-0 transition-transform mt-3', abierta && 'rotate-180')} />
                </div>

                {/* Aviso de vencimiento */}
                {diasAcceso !== null && diasAcceso <= 7 && (
                    <div className={cn(
                        'mt-4 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border',
                        diasAcceso < 0
                            ? 'bg-red-500/10 border-red-500/25 text-red-300'
                            : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                    )}>
                        <CalendarClock size={13} />
                        {diasAcceso < 0
                            ? `El acceso venció hace ${Math.abs(diasAcceso)} ${Math.abs(diasAcceso) === 1 ? 'día' : 'días'}`
                            : diasAcceso === 0
                                ? 'El acceso vence hoy'
                                : `El acceso vence en ${diasAcceso} ${diasAcceso === 1 ? 'día' : 'días'}`}
                    </div>
                )}
            </button>

            {/* Detalle por usuario */}
            {abierta && (
                <div className="border-t border-white/10 bg-black/20 px-5 py-4">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                        Usuarios ({c.userCount})
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                                    <th className="text-left font-semibold pb-2">Usuario</th>
                                    <th className="text-left font-semibold pb-2">Rol</th>
                                    <th className="text-left font-semibold pb-2">Última actividad</th>
                                    <th className="text-right font-semibold pb-2">7 días</th>
                                    <th className="text-right font-semibold pb-2">30 días</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {c.users.map(u => (
                                    <tr key={u.userId}>
                                        <td className="py-2.5 pr-4">
                                            <div className="flex items-center gap-2">
                                                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', SALUD[u.salud].dot)} />
                                                <span className="text-white font-medium">{u.name}</span>
                                                <span className="text-gray-600 text-xs">@{u.username}</span>
                                            </div>
                                        </td>
                                        <td className="py-2.5 pr-4 text-gray-400 text-xs capitalize">{u.role}</td>
                                        <td className={cn('py-2.5 pr-4 text-xs', SALUD[u.salud].text)}>{hace(u.lastActivity)}</td>
                                        <td className="py-2.5 text-right text-gray-300 text-xs">{miles(u.events7d)}</td>
                                        <td className="py-2.5 text-right text-gray-500 text-xs">{miles(u.events30d)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-white/5">
                        <Dato label="Última venta" value={hace(c.lastSale)} />
                        <Dato label="Última caja abierta" value={hace(c.lastRegisterOpen)} />
                        <Dato label="Ventas (30 días)" value={miles(c.sales30d)} />
                        <Dato label="Cliente desde" value={hace(c.createdAt)} />
                    </div>
                </div>
            )}
        </div>
    );
};

const Metrica = ({ icon, label, value, tone = 'text-white' }) => (
    <div className="min-w-[110px]">
        <div className="flex items-center gap-1.5 text-gray-500 mb-1">
            {icon}
            <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        </div>
        <p className={cn('text-sm font-bold', tone)}>{value}</p>
    </div>
);

const Dato = ({ label, value }) => (
    <div>
        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-xs text-gray-300">{value}</p>
    </div>
);

export default AdminActivity;
