import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { SUBSCRIPTION_PLANS, BILLING_CYCLES, getDisplayCurrency, formatMoney } from '../../config/mercadopago';
import { Crown, Check, Star, Clock, Receipt, AlertCircle, Building2, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import PlanCheckoutModal from './PlanCheckoutModal';

const STATUS_STYLES = {
    trial: { label: 'En prueba', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    active: { label: 'Activa', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    past_due: { label: 'Vencida', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    suspended: { label: 'Suspendida', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    cancelled: { label: 'Cancelada', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
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

const PlanSettings = () => {
    const { activeCompanyId, checkSubscriptionStatus, fetchPaymentHistory, hasModule, availableCompanies } = useStore();

    const [subInfo, setSubInfo] = useState(null);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'annual'
    const [checkoutPlanId, setCheckoutPlanId] = useState(null); // plan con modal de pago abierto
    const [showCreateCompany, setShowCreateCompany] = useState(false); // modal "crear otra empresa"
    const [newCheckout, setNewCheckout] = useState(null); // { companyId, planId, billingCycle } de la empresa recién creada

    useEffect(() => {
        let alive = true;
        if (!activeCompanyId) return;
        setLoading(true);
        Promise.all([
            checkSubscriptionStatus ? checkSubscriptionStatus(activeCompanyId) : Promise.resolve(null),
            fetchPaymentHistory ? fetchPaymentHistory(activeCompanyId) : Promise.resolve([]),
        ]).then(([info, hist]) => {
            if (!alive) return;
            setSubInfo(info);
            setPayments(Array.isArray(hist) ? hist : []);
        }).finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [activeCompanyId, checkSubscriptionStatus, fetchPaymentHistory]);

    const status = STATUS_STYLES[subInfo?.status] || STATUS_STYLES.active;
    const isTrial = subInfo?.status === 'trial';

    // Moneda según el país de la empresa: Chile → CLP, resto → USD
    const currency = getDisplayCurrency(subInfo?.country_code);

    // Solo se ofrecen planes de nivel superior al actual: básico → ve medium/pro,
    // medium → ve pro, pro → no ve ninguno (ya tiene el más alto). En trial (sin
    // planId) el nivel es 0, así que ve los 3.
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
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Plan</p>
                            <p className="text-[var(--color-text)] font-bold">{subInfo?.planLabel || '—'}</p>
                        </div>
                        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                                {isTrial ? 'Prueba vence' : 'Vencimiento'}
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
                        <span>Estás en período de prueba gratuito. Elige un plan abajo para continuar usando POSVECI cuando termine.</span>
                    </div>
                )}
            </div>

            {/* 2. PLANES DISPONIBLES (solo upgrades respecto al plan actual) */}
            {!loading && !hasUpgrades ? (
                <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h2 className="text-xl font-bold text-[var(--color-text)] mb-1">Planes disponibles</h2>
                    <div className="mt-4 flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                        <Crown size={22} className="text-[var(--color-primary)] flex-shrink-0" />
                        <p className="text-sm text-[var(--color-text)]">
                            Ya cuentas con el <strong>plan más alto</strong> ({subInfo?.planLabel || 'Plan Pro'}). No hay planes superiores para contratar.
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
                    plans.length === 1 ? 'max-w-sm mx-auto'
                        : plans.length === 2 ? 'sm:grid-cols-2 max-w-3xl mx-auto'
                        : 'md:grid-cols-3'
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
                                    {BILLING_CYCLES[billingCycle].suffix}
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
                                Contratar este plan
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            )}

            {/* CREAR OTRA EMPRESA (multi-sucursal · solo Medium+) */}
            {hasModule && hasModule('multisucursal') && (
                <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h2 className="text-xl font-bold text-[var(--color-text)] mb-1 flex items-center gap-2">
                        <Building2 size={20} className="text-[var(--color-primary)]" /> Tus empresas
                    </h2>
                    <p className="text-sm text-[var(--color-text-muted)] mb-4">
                        Multi-sucursal: crea otra empresa enlazada a tu cuenta. Cada empresa tiene su propio plan y pago, y se administra por separado.
                    </p>
                    <button
                        onClick={() => setShowCreateCompany(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--color-primary)] text-black font-bold text-sm hover:brightness-110 transition-all"
                    >
                        <Plus size={16} /> Crear otra empresa
                    </button>
                </div>
            )}

            {/* HISTORIAL DE PAGOS */}
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

            {/* Modal de medios de pago (plan de la empresa actual) */}
            {checkoutPlanId && SUBSCRIPTION_PLANS[checkoutPlanId] && (
                <PlanCheckoutModal
                    plan={SUBSCRIPTION_PLANS[checkoutPlanId]}
                    billingCycle={billingCycle}
                    currency={currency}
                    companyId={activeCompanyId}
                    onClose={() => setCheckoutPlanId(null)}
                />
            )}

            {/* Modal: crear otra empresa (elige plan) */}
            {showCreateCompany && (
                <CreateAnotherCompanyModal
                    defaultName={`Empresa ${(availableCompanies?.length || 1) + 1}`}
                    currency={currency}
                    onClose={() => setShowCreateCompany(false)}
                    onConfirm={({ companyId, planId, billingCycle: cyc }) => {
                        setShowCreateCompany(false);
                        setNewCheckout({ companyId, planId, billingCycle: cyc });
                    }}
                />
            )}

            {/* Pago de la empresa recién creada (se activa al confirmar el pago) */}
            {newCheckout && SUBSCRIPTION_PLANS[newCheckout.planId] && (
                <PlanCheckoutModal
                    plan={SUBSCRIPTION_PLANS[newCheckout.planId]}
                    billingCycle={newCheckout.billingCycle}
                    currency={currency}
                    companyId={newCheckout.companyId}
                    onClose={() => setNewCheckout(null)}
                />
            )}
        </div>
    );
};

// Modal para crear una empresa adicional enlazada: elige nombre + plan + ciclo,
// crea la empresa (limpia, en pending_payment) y continúa al pago.
const CreateAnotherCompanyModal = ({ defaultName, currency, onClose, onConfirm }) => {
    const { createLinkedCompany } = useStore();
    const [name, setName] = useState(defaultName || 'Empresa nueva');
    const [planId, setPlanId] = useState('medium');
    const [billingCycle, setBillingCycle] = useState('monthly');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const plans = Object.values(SUBSCRIPTION_PLANS);

    const handleContinue = async () => {
        if (!name.trim()) { setError('Ponle un nombre a la empresa.'); return; }
        setError('');
        setBusy(true);
        const r = await createLinkedCompany({ name: name.trim(), plan: planId });
        setBusy(false);
        if (r?.success) onConfirm({ companyId: r.companyId, planId, billingCycle });
        else setError(r?.error || 'No se pudo crear la empresa.');
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="glass-card w-full max-w-md max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl !bg-[#18181b] !backdrop-blur-none" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-lg font-bold text-[var(--color-text)]">Crear otra empresa</h3>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1"><X size={20} /></button>
                </div>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">
                    Se creará una empresa nueva enlazada a tu cuenta. Hereda zona horaria y moneda; el resto (datos, usuarios) lo configuras después. Aparecerá en el selector al confirmar el pago.
                </p>

                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">Nombre de la empresa</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#0f0f12] border border-white/10 rounded-lg px-3 py-2.5 text-[var(--color-text)] text-sm focus:border-[var(--color-primary)] outline-none mb-4"
                    placeholder="Ej: Sucursal Centro"
                />

                {/* Ciclo */}
                <div className="flex justify-center mb-4">
                    <div className="inline-flex items-center bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-1">
                        {Object.values(BILLING_CYCLES).map((c) => (
                            <button
                                key={c.id}
                                onClick={() => setBillingCycle(c.id)}
                                className={cn('px-4 py-1.5 rounded-lg text-sm font-bold transition-colors',
                                    billingCycle === c.id ? 'bg-[var(--color-primary)] text-black' : 'text-[var(--color-text-muted)]')}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Plan */}
                <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">Plan de la nueva empresa</label>
                <div className="space-y-2 mb-4">
                    {plans.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => setPlanId(p.id)}
                            className={cn('w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all',
                                planId === p.id ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--glass-border)] hover:border-[var(--color-primary)]/50')}
                        >
                            <span className="font-bold text-[var(--color-text)]">{p.name}</span>
                            <span className="text-sm font-bold text-[var(--color-primary)]">
                                {formatMoney(p.prices[currency][billingCycle], currency)}{BILLING_CYCLES[billingCycle].suffix}
                            </span>
                        </button>
                    ))}
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
