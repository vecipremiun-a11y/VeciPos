import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Users, Building2, Mail, Crown, Search, Calendar, KeyRound, Copy, Check, X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { effectiveCompanyStatus } from '../../lib/companyAccess';
import { SUBSCRIPTION_PLANS, getDisplayCurrency, formatMoney } from '../../config/mercadopago';

const STATUS = {
    trial: { label: 'Prueba', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    active: { label: 'Activa', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
    past_due: { label: 'Vencida', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    blocked: { label: 'Bloqueada', cls: 'bg-red-500/15 text-red-500 border-red-500/30' },
    suspended: { label: 'Suspendida', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
    cancelled: { label: 'Cancelada', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
    pending_payment: { label: 'Pendiente', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
};
const PLAN_LABEL = { basico: 'Básico', basic: 'Básico', medium: 'Medium', medio: 'Medium', pro: 'Pro', free: 'Gratis' };
const normPlan = (p) => (p === 'basic' ? 'basico' : (p || 'basico'));

const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const planMonthly = (plan, countryCode) => {
    const cur = getDisplayCurrency(countryCode);
    const p = SUBSCRIPTION_PLANS[normPlan(plan)];
    if (!p) return formatMoney(0, cur);
    return formatMoney(p.prices[cur].monthly, cur);
};

// Modal de restablecimiento: confirma, genera la clave temporal y permite copiarla.
const ResetPasswordModal = ({ client, onClose }) => {
    const { adminResetUserPassword } = useStore();
    const [step, setStep] = useState('confirm'); // confirm | loading | done | error
    const [tempPassword, setTempPassword] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    const doReset = async () => {
        setStep('loading');
        const r = await adminResetUserPassword(client.userId);
        if (r?.success) {
            setTempPassword(r.tempPassword);
            setStep('done');
        } else {
            setError(r?.error || 'No se pudo restablecer la contraseña');
            setStep('error');
        }
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(tempPassword);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard no disponible */ }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={step !== 'loading' ? onClose : undefined}>
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <KeyRound size={18} className="text-amber-400" /> Restablecer contraseña
                    </h3>
                    {step !== 'loading' && (
                        <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
                    )}
                </div>

                {step === 'confirm' && (
                    <>
                        <p className="text-sm text-gray-300 mb-1">
                            Se generará una <b>contraseña temporal</b> para <b className="text-white">@{client.username}</b> ({client.name || 'sin nombre'}).
                        </p>
                        <p className="text-xs text-gray-500 mb-5">La contraseña actual dejará de funcionar de inmediato. Envíale la nueva al cliente por un canal seguro.</p>
                        <div className="flex gap-2 justify-end">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10">Cancelar</button>
                            <button onClick={doReset} className="px-4 py-2 rounded-xl text-sm font-bold text-black bg-amber-400 hover:bg-amber-300">Generar nueva clave</button>
                        </div>
                    </>
                )}

                {step === 'loading' && (
                    <div className="flex items-center gap-3 text-gray-300 text-sm py-4 justify-center">
                        <Loader2 size={18} className="animate-spin" /> Restableciendo…
                    </div>
                )}

                {step === 'done' && (
                    <>
                        <p className="text-sm text-gray-300 mb-3">Listo. Nueva contraseña temporal de <b className="text-white">@{client.username}</b>:</p>
                        <div className="flex items-center gap-2 mb-2">
                            <code className="flex-1 bg-black/40 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-lg font-mono tracking-wider text-center select-all">
                                {tempPassword}
                            </code>
                            <button onClick={copy} className="p-3 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10" title="Copiar">
                                {copied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-5">Cópiala ahora — no se volverá a mostrar. Recomiéndale al cliente cambiarla al entrar.</p>
                        <div className="flex justify-end">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-black bg-amber-400 hover:bg-amber-300">Entendido</button>
                        </div>
                    </>
                )}

                {step === 'error' && (
                    <>
                        <p className="text-sm text-red-400 mb-5">{error}</p>
                        <div className="flex justify-end">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10">Cerrar</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const AdminClients = () => {
    const { adminFetchClients } = useStore();
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [resetClient, setResetClient] = useState(null);

    useEffect(() => {
        setLoading(true);
        adminFetchClients().then(setClients).finally(() => setLoading(false));
    }, [adminFetchClients]);

    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        if (!term) return clients;
        return clients.filter(c =>
            (c.username || '').toLowerCase().includes(term) ||
            (c.name || '').toLowerCase().includes(term) ||
            (c.email || '').toLowerCase().includes(term) ||
            c.companies.some(co => (co.name || '').toLowerCase().includes(term))
        );
    }, [clients, q]);

    const totalCompanies = clients.reduce((s, c) => s + c.companies.length, 0);

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2">Clientes</h1>
                <p className="text-gray-400">Dueños de cuenta, sus empresas e información relevante.</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-[#18181b] border border-white/10 rounded-2xl p-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center"><Users size={20} /></div>
                    <div><div className="text-2xl font-bold text-blue-400">{clients.length}</div><div className="text-sm text-gray-400">Clientes</div></div>
                </div>
                <div className="bg-[#18181b] border border-white/10 rounded-2xl p-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><Building2 size={20} /></div>
                    <div><div className="text-2xl font-bold text-emerald-400">{totalCompanies}</div><div className="text-sm text-gray-400">Empresas en total</div></div>
                </div>
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar por cliente, email o empresa…"
                    className="w-full bg-[#18181b] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-[var(--color-primary)] outline-none"
                />
            </div>

            {loading ? (
                <p className="text-gray-500 text-center py-12">Cargando…</p>
            ) : filtered.length === 0 ? (
                <p className="text-gray-500 text-center py-12">No hay clientes con ese filtro.</p>
            ) : (
                <div className="space-y-4">
                    {filtered.map((client) => (
                        <div key={client.userId} className="bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden">
                            {/* Cabecera del cliente */}
                            <div className="flex items-center justify-between gap-3 p-5 border-b border-white/10">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-amber-500/30 to-yellow-600/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                                        <Crown size={20} className="text-amber-400" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-bold text-white truncate">{client.name || client.username}</div>
                                        <div className="text-xs text-gray-400 flex items-center gap-3 flex-wrap">
                                            <span>@{client.username}</span>
                                            {client.email && <span className="flex items-center gap-1"><Mail size={12} /> {client.email}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => setResetClient(client)}
                                        title="Restablecer contraseña"
                                        className="flex items-center gap-1.5 text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1 hover:bg-amber-500/20"
                                    >
                                        <KeyRound size={13} /> <span className="hidden sm:inline">Restablecer clave</span>
                                    </button>
                                    <span className="text-xs font-bold text-gray-300 bg-white/5 border border-white/10 rounded-full px-3 py-1 whitespace-nowrap">
                                        {client.companies.length} empresa{client.companies.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </div>

                            {/* Empresas del cliente */}
                            <div className="divide-y divide-white/5">
                                {client.companies.map((co) => {
                                    const eff = effectiveCompanyStatus({ status: co.status, trial_ends_at: co.trial_ends_at, access_until: co.access_until });
                                    const st = STATUS[eff] || { label: eff, cls: 'bg-white/5 text-gray-400 border-white/10' };
                                    return (
                                        <div key={co.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-white/5">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <Building2 size={16} className="text-gray-500 flex-shrink-0" />
                                                <div className="min-w-0">
                                                    <div className="text-white text-sm font-medium truncate">
                                                        {co.name}
                                                        {co.parent_company_id && <span className="text-sky-400/80 text-[11px] ml-2">↳ secundaria</span>}
                                                    </div>
                                                    <div className="text-[11px] text-gray-500 flex items-center gap-1">
                                                        <Calendar size={11} /> Acceso hasta {formatDate(co.access_until)} · {co.members} usuario{co.members !== 1 ? 's' : ''}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <span className="text-xs text-gray-400 hidden sm:inline">{planMonthly(co.plan, co.country_code)}/mes</span>
                                                <span className="text-xs font-bold text-gray-200 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">{PLAN_LABEL[normPlan(co.plan)] || co.plan}</span>
                                                <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border', st.cls)}>{st.label}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {resetClient && <ResetPasswordModal client={resetClient} onClose={() => setResetClient(null)} />}
        </div>
    );
};

export default AdminClients;
