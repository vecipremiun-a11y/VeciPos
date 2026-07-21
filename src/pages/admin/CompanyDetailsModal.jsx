import React, { useEffect, useState } from 'react';
import { X, Building2, Calendar, CreditCard, Clock, Package, Check, Sparkles, Store } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import { ALL_MODULES } from '../../constants/modules';
import { ALL_APPS } from '../../constants/apps';

// Complementos reales (comprables). Los "próximamente" no se listan aquí.
const REAL_APPS = ALL_APPS.filter((a) => a.status === 'available');

const ToggleSwitch = ({ enabled, onChange, disabled }) => (
    <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${enabled ? 'bg-emerald-500' : 'bg-gray-600'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
    </button>
);

const CompanyDetailsModal = ({ company, onClose }) => {
    const { adminFetchCompanyModules, adminSetCompanyModule, adminFetchCompanyApps, adminSetCompanyApp } = useStore();
    const [modules, setModules] = useState([]);
    const [loadingModules, setLoadingModules] = useState(true);
    const [updatingModule, setUpdatingModule] = useState(null);
    const [appRows, setAppRows] = useState([]);
    const [loadingApps, setLoadingApps] = useState(true);
    const [updatingApp, setUpdatingApp] = useState(null);
    const [trialDays, setTrialDays] = useState(30);

    useEffect(() => {
        if (company) {
            loadModules();
            loadApps();
        }
    }, [company]);

    const loadModules = async () => {
        setLoadingModules(true);
        const dbModules = await adminFetchCompanyModules(company.company_id);

        // Merge DB records with ALL_MODULES definition
        const merged = ALL_MODULES.map(mod => {
            const dbRecord = dbModules.find(m => m.module_key === mod.key);
            return {
                ...mod,
                enabled: dbRecord ? Number(dbRecord.enabled) === 1 : mod.defaultEnabled,
            };
        });
        setModules(merged);
        setLoadingModules(false);
    };

    const loadApps = async () => {
        setLoadingApps(true);
        const rows = await adminFetchCompanyApps(company.company_id);
        setAppRows(Array.isArray(rows) ? rows : []);
        setLoadingApps(false);
    };

    // Estado actual de una App para la empresa (según company_apps).
    const appStateOf = (appKey) => {
        const row = appRows.find((a) => a.app_key === appKey);
        if (!row || row.status === 'cancelled') return { key: 'off', label: 'Inactiva', cls: 'text-gray-400' };
        const periodEnd = row.period_end || row.trial_ends_at || null;
        const expired = periodEnd && new Date(periodEnd) < new Date();
        if (expired) return { key: 'off', label: 'Vencida', cls: 'text-gray-400' };
        if (row.status === 'trial') return { key: 'trial', label: 'En prueba', cls: 'text-blue-400' };
        if (Number(row.granted_free) === 1) return { key: 'free', label: 'Gratis', cls: 'text-emerald-400' };
        if (Number(row.will_renew) === 0) return { key: 'paid', label: 'Activa · no renueva', cls: 'text-amber-400' };
        return { key: 'paid', label: 'Activa (paga)', cls: 'text-emerald-400' };
    };

    const handleSetApp = async (appKey, mode) => {
        setUpdatingApp(appKey + mode);
        const res = await adminSetCompanyApp(company.company_id, appKey, mode, { trialDays });
        if (res?.success) await loadApps();
        else alert('Error: ' + (res?.error || 'no se pudo actualizar el complemento'));
        setUpdatingApp(null);
    };

    const handleToggleModule = async (moduleKey, newValue) => {
        setUpdatingModule(moduleKey);
        const res = await adminSetCompanyModule(company.company_id, moduleKey, newValue);
        if (res.success) {
            setModules(prev => prev.map(m =>
                m.key === moduleKey ? { ...m, enabled: newValue } : m
            ));
        } else {
            alert('Error: ' + res.error);
        }
        setUpdatingModule(null);
    };

    if (!company) return null;

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('es-CL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const StatusBadge = ({ status }) => {
        const styles = {
            active: "bg-green-500/10 text-green-400 border-green-500/30",
            trial: "bg-blue-500/10 text-blue-400 border-blue-500/30",
            suspended: "bg-red-500/10 text-red-400 border-red-500/30",
            pending_payment: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
        };
        const style = styles[status] || styles.pending_payment;
        const label = status === 'active' ? 'Activa'
            : status === 'trial' ? 'Prueba'
                : status === 'suspended' ? 'Suspendida'
                    : 'Pendiente';

        return (
            <span className={cn("px-2 py-1 rounded-full text-xs font-bold border", style)}>
                {label}
            </span>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10 sticky top-0 bg-[#18181b] z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
                            <Building2 size={24} className="text-[var(--color-primary)]" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white mb-1">{company.company_name}</h2>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 font-mono">ID: {company.company_id}</span>
                                <StatusBadge status={company.company_status} />
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-8">

                    {/* Subscription Info */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex items-center gap-2">
                            <CreditCard size={16} /> Suscripción
                        </h3>
                        <div className="bg-white/5 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <div className="text-xs text-gray-500 mb-1">Plan Actual</div>
                                <div className="text-white font-medium">{company.plan_name || (company.plan_id === 'monthly' ? 'Plan Mensual' : 'Sin Plan')}</div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 mb-1">Estado Suscripción</div>
                                <div className={cn(
                                    "font-medium",
                                    company.subscription_status === 'active' ? "text-green-400" : "text-gray-400"
                                )}>
                                    {company.subscription_status === 'active' ? 'Activa' : 'Inactiva / Pendiente'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 mb-1">Monto</div>
                                <div className="text-white font-medium font-mono">{formatCurrency(company.amount || 0)} <span className="text-xs text-gray-500">CLP</span></div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 mb-1">Próximo Pago</div>
                                <div className="text-white font-medium">{formatDate(company.current_period_end)}</div>
                            </div>
                        </div>
                    </div>

                    {/* Modules Management */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex items-center gap-2">
                            <Package size={16} /> Módulos Habilitados
                        </h3>
                        <p className="text-xs text-gray-500 mb-4">
                            Activa o desactiva módulos para esta empresa. Los módulos desactivados mostrarán un badge PRO en el menú.
                        </p>

                        {loadingModules ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="bg-white/5 rounded-xl h-16 animate-pulse" />
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3">
                                {modules.map(mod => (
                                    <div
                                        key={mod.key}
                                        className={cn(
                                            "p-4 rounded-xl border transition-all duration-200 flex items-center justify-between",
                                            mod.enabled
                                                ? "bg-white/5 border-white/10"
                                                : "bg-white/[0.02] border-white/5 opacity-60"
                                        )}
                                    >
                                        <div className="flex-1 mr-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-white font-medium text-sm">{mod.label}</span>
                                                {mod.plan === 'professional' && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/20">
                                                        <Sparkles size={8} />
                                                        PROFESIONAL
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-gray-500 text-xs mt-0.5">{mod.description}</div>
                                        </div>
                                        <ToggleSwitch
                                            enabled={mod.enabled}
                                            onChange={(val) => handleToggleModule(mod.key, val)}
                                            disabled={updatingModule === mod.key}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Complementos (Apps) — god-mode: precio / prueba / gratis / apagar */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex items-center gap-2">
                            <Store size={16} /> Complementos (Apps)
                        </h3>
                        <p className="text-xs text-gray-500 mb-4">
                            <strong className="text-emerald-400">Precio</strong>: suma al pago mensual (se ve como compra del Marketplace) ·{' '}
                            <strong className="text-purple-400">Gratis</strong>: activa sin cobro ·{' '}
                            <strong className="text-blue-400">Prueba</strong>: N días gratis ·{' '}
                            <strong className="text-red-400">Apagar</strong>: da de baja.
                        </p>

                        <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
                            <span>Días de prueba:</span>
                            <input
                                type="number" min="1" max="365" value={trialDays}
                                onChange={(e) => setTrialDays(Math.max(1, Number(e.target.value) || 30))}
                                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs outline-none focus:border-[var(--color-primary)]"
                            />
                        </div>

                        {loadingApps ? (
                            <div className="space-y-3">
                                {[1, 2].map(i => <div key={i} className="bg-white/5 rounded-xl h-20 animate-pulse" />)}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3">
                                {REAL_APPS.map(app => {
                                    const st = appStateOf(app.key);
                                    const price = app.priceClp || 0;
                                    const MODES = [
                                        { key: 'trial', label: 'Prueba', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/40' },
                                        { key: 'paid', label: 'Precio', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
                                        { key: 'free', label: 'Gratis', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/40' },
                                        { key: 'off', label: 'Apagar', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
                                    ];
                                    return (
                                        <div key={app.key} className="p-4 rounded-xl border border-white/10 bg-white/5">
                                            <div className="flex items-center justify-between mb-3">
                                                <div>
                                                    <span className="text-white font-medium text-sm">{app.name}</span>
                                                    <span className="text-gray-500 text-xs ml-2">${price.toLocaleString('es-CL')}/mes</span>
                                                </div>
                                                <span className={cn('text-xs font-bold', st.cls)}>{st.label}</span>
                                            </div>
                                            <div className="grid grid-cols-4 gap-2">
                                                {MODES.map(m => {
                                                    const isActive = st.key === m.key;
                                                    const busy = updatingApp === app.key + m.key;
                                                    return (
                                                        <button
                                                            key={m.key}
                                                            onClick={() => handleSetApp(app.key, m.key)}
                                                            disabled={!!updatingApp}
                                                            className={cn(
                                                                'py-1.5 rounded-lg text-xs font-bold border transition-colors',
                                                                isActive ? m.cls : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20',
                                                                updatingApp && 'opacity-60'
                                                            )}
                                                        >
                                                            {busy ? '…' : m.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Dates Info */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex items-center gap-2">
                            <Clock size={16} /> Fechas
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white/5 p-3 rounded-lg">
                                <div className="text-xs text-gray-500 mb-1">Fecha de Creación</div>
                                <div className="text-sm text-white">{formatDate(company.created_at || new Date().toISOString())}</div>
                            </div>
                            <div className="bg-white/5 p-3 rounded-lg">
                                <div className="text-xs text-gray-500 mb-1">Inicio Periodo Actual</div>
                                <div className="text-sm text-white">{formatDate(company.current_period_start)}</div>
                            </div>
                        </div>
                    </div>

                </div>

                <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        Cerrar
                    </button>
                </div>

            </div>
        </div>
    );
};

export default CompanyDetailsModal;
