import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { ALL_APPS, getAppPrice } from '../constants/apps';
import { formatMoney } from '../config/mercadopago';
import { toast } from '../lib/toast';
import { cn } from '../lib/utils';
import {
    Store, Crown, Check, Clock, Lock, Sparkles, ArrowRight,
    ChefHat, Plug, Scale, Globe, Bike, Gift, MessageCircle, Utensils, Scissors,
    MonitorPlay, UsersRound, Calculator, Code, BarChart3, Package,
} from 'lucide-react';

const ICONS = { ChefHat, Plug, Scale, Globe, Bike, Gift, MessageCircle, Utensils, Scissors, MonitorPlay, UsersRound, Calculator, Code, Sparkles, BarChart3 };

const daysLeft = (iso) => {
    if (!iso) return null;
    const d = Math.ceil((new Date(iso) - new Date()) / 86400000);
    return Number.isFinite(d) ? d : null;
};

const Marketplace = () => {
    const navigate = useNavigate();
    const {
        currentPlanLevel, companyApps, currentCurrency,
        fetchCompanyApps, activateApp, cancelApp,
    } = useStore(useShallow((s) => ({
        currentPlanLevel: s.currentPlanLevel,
        companyApps: s.companyApps,
        currentCurrency: s.currentCurrency,
        fetchCompanyApps: s.fetchCompanyApps,
        activateApp: s.activateApp,
        cancelApp: s.cancelApp,
    })));

    const [busy, setBusy] = useState(null); // app_key en proceso
    const currency = currentCurrency === 'USD' ? 'USD' : 'CLP';
    const isProfessional = (currentPlanLevel ?? 2) >= 2;

    useEffect(() => { fetchCompanyApps?.(); }, [fetchCompanyApps]);

    // Estado de una App para la empresa/sucursal activa.
    const appState = (appKey) => {
        const row = companyApps?.find((a) => a.app_key === appKey);
        if (!row) return { state: 'none' };
        if (row.status === 'active') return { state: 'active' };
        if (row.status === 'trial') {
            const dl = daysLeft(row.trial_ends_at);
            if (dl == null || dl >= 0) return { state: 'trial', daysLeft: dl };
            return { state: 'expired' };
        }
        return { state: 'none' }; // cancelled
    };

    const onActivate = async (app) => {
        if (!isProfessional) { toast('Necesitas el Plan Profesional para activar complementos.', 'error'); return; }
        setBusy(app.key);
        const r = await activateApp(app.key);
        setBusy(null);
        if (r?.success) toast(r.already ? `${app.name} ya estaba activo` : `${app.name} activado · 30 días de prueba gratis`, 'success');
        else toast(r?.error || 'No se pudo activar el complemento', 'error');
    };

    const onCancel = async (app) => {
        if (!window.confirm(`¿Cancelar ${app.name}? Perderás el acceso a sus funciones.`)) return;
        setBusy(app.key);
        const r = await cancelApp(app.key);
        setBusy(null);
        if (r?.success) toast(`${app.name} cancelado`, 'info');
        else toast(r?.error || 'No se pudo cancelar', 'error');
    };

    return (
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-[var(--color-text)] flex items-center gap-3">
                    <Store size={28} className="text-[var(--color-primary)]" /> Marketplace de complementos
                </h1>
                <p className="text-[var(--color-text-muted)] mt-1">
                    Amplía POSVECI con complementos. Cada uno incluye <strong>30 días de prueba gratis</strong> y se puede cancelar cuando quieras.
                </p>
            </div>

            {/* Banner Standard */}
            {!isProfessional && (
                <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-yellow-500/10 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
                        <Crown size={24} />
                    </div>
                    <div className="flex-1">
                        <p className="font-bold text-[var(--color-text)]">Necesitas el Plan Profesional para comprar complementos</p>
                        <p className="text-sm text-[var(--color-text-muted)]">Mejora a Profesional para activar Cocina, Integración, Báscula, Tienda Web y más.</p>
                    </div>
                    <button
                        onClick={() => navigate('/settings/plan')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-black font-bold text-sm hover:brightness-110 transition-all flex-shrink-0"
                    >
                        <Sparkles size={16} /> Mejorar a Profesional
                    </button>
                </div>
            )}

            {/* Grid de complementos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {ALL_APPS.map((app) => {
                    const Icon = ICONS[app.icon] || Package;
                    const price = getAppPrice(app, currency);
                    const isComingSoon = app.status === 'coming_soon';
                    const st = appState(app.key);
                    const scopeLabel = app.scope === 'company' ? 'Por empresa' : 'Por sucursal';

                    return (
                        <div
                            key={app.key}
                            className={cn(
                                'relative rounded-2xl border p-5 flex flex-col transition-all',
                                st.state === 'active' || st.state === 'trial'
                                    ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
                                    : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:border-[var(--color-primary)]/40',
                                isComingSoon && 'opacity-70'
                            )}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className={cn(
                                    'w-12 h-12 rounded-xl flex items-center justify-center',
                                    isComingSoon ? 'bg-white/5 text-[var(--color-text-muted)]' : 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                                )}>
                                    <Icon size={24} />
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] border border-[var(--glass-border)] rounded-full px-2 py-0.5">
                                    {scopeLabel}
                                </span>
                            </div>

                            <h3 className="font-bold text-[var(--color-text)] text-lg">{app.name}</h3>
                            <p className="text-sm text-[var(--color-text-muted)] mt-1 flex-1">{app.description}</p>

                            {/* Precio / estado */}
                            <div className="mt-4 flex items-center justify-between">
                                {isComingSoon ? (
                                    <span className="text-sm font-bold text-[var(--color-text-muted)]">Próximamente</span>
                                ) : (
                                    <span className="text-xl font-extrabold text-[var(--color-text)]">
                                        {formatMoney(price, currency)}<span className="text-xs font-medium text-[var(--color-text-muted)]">/mes</span>
                                    </span>
                                )}
                                {isProfessional && st.state === 'active' && (
                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400"><Check size={14} /> Activa</span>
                                )}
                                {isProfessional && st.state === 'trial' && (
                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-400"><Clock size={14} /> Prueba · {st.daysLeft ?? 0}d</span>
                                )}
                            </div>

                            {/* Acción */}
                            <div className="mt-4">
                                {isComingSoon ? (
                                    <button disabled className="w-full py-2.5 rounded-lg bg-white/5 text-[var(--color-text-muted)] font-bold text-sm cursor-not-allowed">
                                        Próximamente
                                    </button>
                                ) : !isProfessional ? (
                                    <button disabled className="w-full py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-400 font-bold text-sm cursor-not-allowed inline-flex items-center justify-center gap-1.5">
                                        <Lock size={14} /> Requiere Profesional
                                    </button>
                                ) : (st.state === 'active' || st.state === 'trial') ? (
                                    <button
                                        onClick={() => onCancel(app)}
                                        disabled={busy === app.key}
                                        className="w-full py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold text-sm hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-60"
                                    >
                                        {busy === app.key ? '…' : 'Cancelar complemento'}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => onActivate(app)}
                                        disabled={busy === app.key}
                                        className="w-full py-2.5 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm hover:brightness-110 transition-all disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                                    >
                                        {busy === app.key ? 'Activando…' : <>{st.state === 'expired' ? 'Reactivar' : 'Activar · 30 días gratis'} <ArrowRight size={15} /></>}
                                    </button>
                                )}
                            </div>

                            {app.scope === 'branch' && !isComingSoon && (
                                <p className="text-[10px] text-[var(--color-text-muted)] mt-2 text-center">Se activa en la sucursal actual</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Marketplace;
