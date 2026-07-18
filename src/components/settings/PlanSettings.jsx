import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import {
    SUBSCRIPTION_PLANS, BILLING_CYCLES, PLAN_COMPANIES,
    getDisplayCurrency, formatMoney,
} from '../../config/mercadopago';
import { getAppByKey } from '../../constants/apps';
import { Crown, Check, Star, Clock, Receipt, AlertCircle, Building2, Plus, X, Lock, Store, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import PlanCheckoutModal from './PlanCheckoutModal';

const STATUS_STYLES = {
    trial: { label: 'En prueba', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    active: { label: 'Activa', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    past_due: { label: 'Vencida', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    suspended: { label: 'Suspendida', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    cancelled: { label: 'Cancelada', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    blocked: { label: 'Bloqueada', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    pending_payment: { label: 'Pago pendiente', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
};

const PAYMENT_STATUS = {
    approved: { label: 'Aprobado', cls: 'text-emerald-400' },
    pending: { label: 'Pendiente', cls: 'text-yellow-400' },
    rejected: { label: 'Rechazado', cls: 'text-red-400' },
    cancelled: { label: 'Cancelado', cls: 'text-red-400' },
};

const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Etiqueta legible del plan de una sucursal (tolera valores legacy).
const planLabelOf = (plan) => {
    const k = (plan || '').toString().toLowerCase();
    if (k === 'professional' || k === 'medium' || k === 'medio' || k === 'pro') return 'Profesional';
    if (k === 'standard' || k === 'basico' || k === 'basic') return 'Standard';
    return plan || '—';
};

// Plan sintético "sucursal adicional" ($20/mes, funcionalidad Profesional).
const branchExtraPlan = () => ({
    id: 'branch_extra',
    name: 'Sucursal adicional',
    prices: {
        CLP: { monthly: PLAN_COMPANIES.professional.extraClp, annual: PLAN_COMPANIES.professional.extraClp * 10 },
        USD: { monthly: PLAN_COMPANIES.professional.extraUsd, annual: PLAN_COMPANIES.professional.extraUsd * 10 },
    },
});

const PlanSettings = () => {
    const navigate = useNavigate();
    const {
        activeCompanyId, checkSubscriptionStatus, fetchPaymentHistory,
        currentPlanLevel, fetchMyBranches, companyApps,
    } = useStore();

    const [subInfo, setSubInfo] = useState(null);
    const [payments, setPayments] = useState([]);
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [billingCycle, setBillingCycle] = useState('monthly');
    const [checkoutPlanId, setCheckoutPlanId] = useState(null);      // upgrade del plan actual
    const [showCreateBranch, setShowCreateBranch] = useState(false); // modal "agregar sucursal"
    const [branchCheckout, setBranchCheckout] = useState(null);      // { companyId } sucursal recién creada

    const reload = React.useCallback(() => {
        if (!activeCompanyId) return;
        setLoading(true);
        Promise.all([
            checkSubscriptionStatus ? checkSubscriptionStatus(activeCompanyId) : Promise.resolve(null),
            fetchPaymentHistory ? fetchPaymentHistory(activeCompanyId) : Promise.resolve([]),
            fetchMyBranches ? fetchMyBranches() : Promise.resolve([]),
        ]).then(([info, hist, brs]) => {
            setSubInfo(info);
            setPayments(Array.isArray(hist) ? hist : []);
            setBranches(Array.isArray(brs) ? brs : []);
        }).finally(() => setLoading(false));
    }, [activeCompanyId, checkSubscriptionStatus, fetchPaymentHistory, fetchMyBranches]);

    useEffect(() => { reload(); }, [reload]);

    const status = STATUS_STYLES[subInfo?.status] || STATUS_STYLES.active;
    const isTrial = subInfo?.status === 'trial';
    const currency = getDisplayCurrency(subInfo?.country_code);

    // Plan efectivo de la sucursal activa (según el gating cargado en el store):
    // nivel 2 = Profesional, 1 = Standard. Es la fuente para "puede agregar sucursales".
    const isProfessional = (currentPlanLevel ?? 2) >= 2;
    const currentPlanId = isProfessional ? 'professional' : 'standard';
    const currentPlanMonthly = SUBSCRIPTION_PLANS[currentPlanId]?.prices?.[currency]?.monthly;

    // Solo se ofrecen planes de nivel superior al actual. En trial (sin planId con
    // suscripción) mostramos ambos para que elija al terminar la prueba.
    const currentLevel = SUBSCRIPTION_PLANS[subInfo?.planId]?.level || 0;
    const plans = Object.values(SUBSCRIPTION_PLANS).filter((p) => p.level > currentLevel);
    const hasUpgrades = plans.length > 0;

    return (
        <div className="space-y-6">
            {/* 1. PLAN ACTUAL */}
            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Crown size={20} className="text-[var(--color-primary)]" />
                        Mi Plan
                    </h2>
                    <span className={cn('text-xs font-bold px-3 py-1 rounded-full border', status.cls)}>
                        {status.label}
                    </span>
                </div>

                {loading ? (
                    <p className="text-[var(--color-text-muted)] text-sm">Cargando…</p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Plan</p>
                            <p className="text-[var(--color-text)] font-bold">
                                {isTrial ? 'Prueba (acceso Profesional)' : (subInfo?.planLabel || planLabelOf(currentPlanId))}
                            </p>
                        </div>
                        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Precio mensual</p>
                            <p className="text-[var(--color-text)] font-bold">
                                {isTrial ? 'Gratis' : (currentPlanMonthly ? `${formatMoney(currentPlanMonthly, currency)}` : '—')}
                            </p>
                        </div>
                        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                                {isTrial ? 'Prueba vence' : 'Próximo cobro'}
                            </p>
                            <p className="text-[var(--color-text)] font-bold">{formatDate(subInfo?.expiresAt)}</p>
                        </div>
                        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Días restantes</p>
                            <p className="text-[var(--color-text)] font-bold flex items-center gap-2">
                                <Clock size={16} className="text-[var(--color-primary)]" />
                                {Number.isFinite(subInfo?.daysRemaining) ? `${subInfo.daysRemaining} días` : '—'}
                            </p>
                        </div>
                    </div>
                )}

                {isTrial && (
                    <div className="mt-4 bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-sm text-blue-300/90 flex items-start gap-2">
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <span>Estás en período de prueba con acceso completo. Elige un plan abajo para continuar usando POSVECI cuando termine.</span>
                    </div>
                )}
            </div>

            {/* 2. MIS SUCURSALES */}
            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Building2 size={20} className="text-[var(--color-primary)]" /> Mis sucursales
                    </h2>
                    {isProfessional ? (
                        <button
                            onClick={() => setShowCreateBranch(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-primary)] text-black font-bold text-sm hover:brightness-110 transition-all"
                        >
                            <Plus size={16} /> Agregar sucursal · {formatMoney(PLAN_COMPANIES.professional[currency === 'USD' ? 'extraUsd' : 'extraClp'], currency)}/mes
                        </button>
                    ) : (
                        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 font-bold text-xs">
                            <Lock size={14} /> Mejora a Profesional para agregar sucursales
                        </span>
                    )}
                </div>

                {loading ? (
                    <p className="text-[var(--color-text-muted)] text-sm">Cargando…</p>
                ) : (
                    <div className="space-y-2">
                        {branches.map((b) => {
                            const bst = STATUS_STYLES[b.status] || STATUS_STYLES.active;
                            const isRoot = !b.parent_company_id;
                            return (
                                <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                    <div className="min-w-0">
                                        <p className="font-bold text-[var(--color-text)] truncate flex items-center gap-2">
                                            {b.name}
                                            {isRoot && <span className="text-[10px] font-bold text-[var(--color-text-muted)] border border-[var(--glass-border)] rounded px-1.5 py-0.5">PRINCIPAL</span>}
                                            {b.id === activeCompanyId && <span className="text-[10px] font-bold text-[var(--color-primary)]">· activa</span>}
                                        </p>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            Plan {planLabelOf(b.plan)} · vence {formatDate(b.access_until || b.trial_ends_at)}
                                        </p>
                                    </div>
                                    <span className={cn('text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0', bst.cls)}>
                                        {bst.label}
                                    </span>
                                </div>
                            );
                        })}
                        {branches.length === 0 && (
                            <p className="text-[var(--color-text-muted)] text-sm">No hay sucursales para mostrar.</p>
                        )}
                    </div>
                )}

                {!isProfessional && (
                    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                        Las sucursales adicionales cuestan {formatMoney(PLAN_COMPANIES.professional[currency === 'USD' ? 'extraUsd' : 'extraClp'], currency)}/mes cada una e incluyen todas las funciones Profesional. Disponible solo para cuentas Profesional.
                    </p>
                )}
            </div>

            {/* 3. PLANES DISPONIBLES (solo upgrades respecto al plan actual) */}
            {!loading && !hasUpgrades ? (
                <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h2 className="text-xl font-bold text-[var(--color-text)] mb-1">Planes disponibles</h2>
                    <div className="mt-4 flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                        <Crown size={22} className="text-[var(--color-primary)] flex-shrink-0" />
                        <p className="text-sm text-[var(--color-text)]">
                            Ya cuentas con el <strong>plan más alto</strong> ({subInfo?.planLabel || 'Plan Profesional'}). No hay planes superiores para contratar.
                        </p>
                    </div>
                </div>
            ) : (
            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-1">Planes disponibles</h2>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">
                    {currentLevel > 0
                        ? `Mejora tu plan actual. Precios en ${currency}.`
                        : `Elige el plan que mejor se adapte a tu negocio. Precios en ${currency}.`}
                </p>

                {/* Toggle Mensual / Anual */}
                <div className="flex justify-center mb-6">
                    <div className="inline-flex items-center bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-1">
                        {Object.values(BILLING_CYCLES).map((cycle) => (
                            <button
                                key={cycle.id}
                                onClick={() => setBillingCycle(cycle.id)}
                                className={cn(
                                    'px-5 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2',
                                    billingCycle === cycle.id
                                        ? 'bg-[var(--color-primary)] text-black'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                )}
                            >
                                {cycle.label}
                                {cycle.id === 'annual' && (
                                    <span className={cn(
                                        'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                                        billingCycle === 'annual' ? 'bg-black/20 text-black' : 'bg-emerald-500/15 text-emerald-400'
                                    )}>
                                        2 meses gratis
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={cn(
                    'grid grid-cols-1 gap-5',
                    plans.length === 1 ? 'max-w-sm mx-auto' : 'sm:grid-cols-2 max-w-3xl mx-auto'
                )}>
                    {plans.map((plan) => (
                        <div
                            key={plan.id}
                            className={cn(
                                'relative rounded-2xl p-6 border transition-all',
                                plan.popular
                                    ? 'border-[var(--color-primary)] shadow-[0_0_24px_rgba(0,240,255,0.18)]'
                                    : 'border-[var(--glass-border)] hover:border-[var(--color-primary)]/50'
                            )}
                        >
                            {plan.popular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <div className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-black px-3 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                                        <Star size={10} fill="currentColor" /> MÁS POPULAR
                                    </div>
                                </div>
                            )}
                            <h3 className="text-lg font-bold text-[var(--color-text)]">{plan.name}</h3>
                            <div className="flex items-baseline gap-1 my-3">
                                <span className="text-3xl font-extrabold text-[var(--color-text)]">
                                    {formatMoney(plan.prices[currency][billingCycle], currency)}
                                </span>
                                <span className="text-[var(--color-text-muted)] text-sm">
                                    {BILLING_CYCLES[billingCycle].suffix} · por sucursal
                                </span>
                            </div>
                            {billingCycle === 'annual' && (
                                <p className="text-xs text-emerald-400 -mt-2 mb-2">
                                    ≈ {formatMoney(Math.round(plan.prices[currency].annual / 12), currency)}/mes · ahorras {formatMoney(plan.prices[currency].monthly * 12 - plan.prices[currency].annual, currency)} al año
                                </p>
                            )}
                            <ul className="space-y-2 my-4">
                                {plan.features.map((f, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                                        <Check size={16} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
                                        <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                            <button
                                onClick={() => setCheckoutPlanId(plan.id)}
                                className={cn(
                                    'w-full py-2.5 rounded-lg font-bold text-sm transition-colors',
                                    plan.popular
                                        ? 'bg-[var(--color-primary)] text-black hover:opacity-90'
                                        : 'border border-[var(--color-primary)]/40 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
                                )}
                            >
                                {currentLevel > 0 ? 'Mejorar a este plan' : 'Contratar este plan'}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            )}

            {/* 4. COMPLEMENTOS (Marketplace) */}
            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Store size={20} className="text-[var(--color-primary)]" /> Complementos (Apps)
                    </h2>
                    <button
                        onClick={() => navigate('/marketplace')}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--color-primary)]/40 text-[var(--color-primary)] font-bold text-sm hover:bg-[var(--color-primary)]/10 transition-all"
                    >
                        Ir al Marketplace <ArrowRight size={15} />
                    </button>
                </div>

                {(() => {
                    const now = new Date();
                    const contracted = (companyApps || []).filter((a) =>
                        a.status === 'active' || (a.status === 'trial' && (!a.trial_ends_at || new Date(a.trial_ends_at) >= now))
                    );
                    if (contracted.length === 0) {
                        return (
                            <p className="text-sm text-[var(--color-text-muted)]">
                                {isProfessional
                                    ? 'Aún no tienes complementos activos. Actívalos con 30 días de prueba gratis desde el Marketplace.'
                                    : 'El Marketplace de complementos (Cocina, Integración, Báscula, Tienda Web…) está disponible para cuentas Profesional.'}
                            </p>
                        );
                    }
                    return (
                        <div className="space-y-2">
                            {contracted.map((a) => {
                                const app = getAppByKey(a.app_key);
                                const isTrial = a.status === 'trial';
                                const dl = a.trial_ends_at ? Math.ceil((new Date(a.trial_ends_at) - now) / 86400000) : null;
                                return (
                                    <div key={a.app_key} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                                        <div>
                                            <p className="font-bold text-[var(--color-text)]">{app?.name || a.app_key}</p>
                                            <p className="text-xs text-[var(--color-text-muted)]">
                                                {isTrial ? `Prueba · ${dl ?? 0} días restantes` : `Activa · ${formatMoney(a.price || 0, a.currency || currency)}/mes`}
                                            </p>
                                        </div>
                                        <span className={cn('text-[10px] font-bold px-2.5 py-1 rounded-full border',
                                            isTrial ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30')}>
                                            {isTrial ? 'En prueba' : 'Activa'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>

            {/* 5. HISTORIAL DE PAGOS */}
            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                    <Receipt size={20} className="text-[var(--color-primary)]" />
                    Historial de pagos
                </h2>

                {loading ? (
                    <p className="text-[var(--color-text-muted)] text-sm">Cargando…</p>
                ) : payments.length === 0 ? (
                    <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                        Aún no tienes pagos registrados.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--glass-border)]">
                                    <th className="py-2 pr-4 font-medium">Fecha</th>
                                    <th className="py-2 pr-4 font-medium">Descripción</th>
                                    <th className="py-2 pr-4 font-medium">Monto</th>
                                    <th className="py-2 font-medium">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payments.map((p) => {
                                    const ps = PAYMENT_STATUS[p.status] || { label: p.status || '—', cls: 'text-[var(--color-text-muted)]' };
                                    return (
                                        <tr key={p.id} className="border-b border-[var(--glass-border)]/50">
                                            <td className="py-2.5 pr-4 text-[var(--color-text)]">{formatDate(p.created_at)}</td>
                                            <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.description || '—'}</td>
                                            <td className="py-2.5 pr-4 text-[var(--color-text)] font-medium">
                                                {formatMoney(p.amount || 0, p.currency || 'CLP')}
                                            </td>
                                            <td className={cn('py-2.5 font-bold', ps.cls)}>{ps.label}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal de medios de pago (upgrade del plan de la empresa actual) */}
            {checkoutPlanId && SUBSCRIPTION_PLANS[checkoutPlanId] && (
                <PlanCheckoutModal
                    plan={SUBSCRIPTION_PLANS[checkoutPlanId]}
                    billingCycle={billingCycle}
                    currency={currency}
                    companyId={activeCompanyId}
                    onClose={() => setCheckoutPlanId(null)}
                />
            )}

            {/* Modal: agregar sucursal (Profesional, $20/mes) */}
            {showCreateBranch && (
                <CreateBranchModal
                    defaultName={`Sucursal ${(branches?.length || 1) + 1}`}
                    currency={currency}
                    onClose={() => setShowCreateBranch(false)}
                    onConfirm={({ companyId }) => {
                        setShowCreateBranch(false);
                        setBranchCheckout({ companyId });
                        reload();
                    }}
                />
            )}

            {/* Pago de la sucursal recién creada ($20/mes, tarifa branch_extra) */}
            {branchCheckout && (
                <PlanCheckoutModal
                    plan={branchExtraPlan()}
                    billingCycle="monthly"
                    currency={currency}
                    companyId={branchCheckout.companyId}
                    onClose={() => { setBranchCheckout(null); reload(); }}
                />
            )}
        </div>
    );
};

// Modal para agregar una sucursal: nombre + confirma. Siempre Profesional a la
// tarifa de sucursal adicional ($20/mes). Crea la empresa (pending_payment) y
// continúa al pago.
const CreateBranchModal = ({ defaultName, currency, onClose, onConfirm }) => {
    const { createLinkedCompany } = useStore();
    const [name, setName] = useState(defaultName || 'Sucursal nueva');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const price = PLAN_COMPANIES.professional[currency === 'USD' ? 'extraUsd' : 'extraClp'];

    const handleContinue = async () => {
        if (!name.trim()) { setError('Ponle un nombre a la sucursal.'); return; }
        setError('');
        setBusy(true);
        const r = await createLinkedCompany({ name: name.trim(), plan: 'professional' });
        setBusy(false);
        if (r?.success) onConfirm({ companyId: r.companyId });
        else setError(r?.error || 'No se pudo crear la sucursal.');
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="glass-card w-full max-w-md max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl !bg-[#18181b] !backdrop-blur-none" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-lg font-bold text-[var(--color-text)]">Agregar sucursal</h3>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1"><X size={20} /></button>
                </div>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">
                    Se creará una sucursal nueva enlazada a tu cuenta con todas las funciones Profesional.
                    Hereda zona horaria y moneda; el resto (datos, usuarios) lo configuras después. Aparecerá en el selector al confirmar el pago.
                </p>

                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">Nombre de la sucursal</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#0f0f12] border border-white/10 rounded-lg px-3 py-2.5 text-[var(--color-text)] text-sm focus:border-[var(--color-primary)] outline-none mb-4"
                    placeholder="Ej: Sucursal Norte"
                />

                <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 mb-4">
                    <div>
                        <p className="font-bold text-[var(--color-text)]">Sucursal Profesional</p>
                        <p className="text-xs text-[var(--color-text-muted)]">Todas las funciones incluidas</p>
                    </div>
                    <span className="text-lg font-extrabold text-[var(--color-primary)]">{formatMoney(price, currency)}<span className="text-xs font-medium text-[var(--color-text-muted)]">/mes</span></span>
                </div>

                {error && (
                    <div className="mb-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-2.5 text-sm flex items-center gap-2">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <button
                    onClick={handleContinue}
                    disabled={busy}
                    className="w-full py-2.5 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm hover:brightness-110 transition-all disabled:opacity-60"
                >
                    {busy ? 'Creando…' : 'Continuar al pago'}
                </button>
            </div>
        </div>,
        document.body
    );
};

export default PlanSettings;
