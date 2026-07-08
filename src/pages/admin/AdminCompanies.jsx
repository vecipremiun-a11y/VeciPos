import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import {
    Building2, CheckCircle, XCircle, Clock, DollarSign,
    Eye, Ban, Calendar, Plus, X
} from 'lucide-react';
import CompanyDetailsModal from './CompanyDetailsModal';
import CreateCompanyModal from './CreateCompanyModal';
import { cn } from '../../lib/utils';
import { effectiveCompanyStatus } from '../../lib/companyAccess';

// Estados del ciclo de vida de una empresa (editables por el admin).
// 'pending_payment' se mantiene solo para mostrar/migrar empresas legacy.
const STATUS_OPTIONS = [
    { value: 'trial', label: 'Prueba' },
    { value: 'active', label: 'Activa' },
    { value: 'past_due', label: 'Vencida' },
    { value: 'blocked', label: 'Bloqueada' },
    { value: 'suspended', label: 'Suspendida' },
    { value: 'cancelled', label: 'Cancelada' },
    { value: 'pending_payment', label: 'Pendiente' },
];
const STATUS_TEXT = {
    trial: 'text-blue-400', active: 'text-green-400', past_due: 'text-orange-400',
    blocked: 'text-red-500', suspended: 'text-rose-400', cancelled: 'text-gray-400', pending_payment: 'text-yellow-400',
};
const PLAN_OPTIONS = [
    { value: 'basico', label: 'Básico' },
    { value: 'medium', label: 'Medium' },
    { value: 'pro', label: 'Pro' },
];
// Normaliza planes legacy/desconocidos a Básico (ya no existe el plan Gratis).
const normPlan = (p) => {
    const k = (p || '').toString().toLowerCase();
    return (k === 'medium' || k === 'medio') ? 'medium' : (k === 'pro' ? 'pro' : 'basico');
};
const SELECT_CLS = 'bg-[#0f0f12] border border-white/10 rounded-lg px-2 py-1.5 text-xs font-bold focus:border-[var(--color-primary)] outline-none cursor-pointer';

const AdminCompanies = () => {
    const { fetchAllSubscriptions, toggleCompanyStatus, adminSetCompanyPlan, adminSetCompanyAccess, deleteCompany } = useStore();
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, active, trial, suspended, pending
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [activateCompany, setActivateCompany] = useState(null); // empresa en el modal de activar/extender

    useEffect(() => {
        loadCompanies();
    }, []);

    const loadCompanies = async () => {
        setLoading(true);
        try {
            const data = await fetchAllSubscriptions();
            setCompanies(data);
        } catch (error) {
            console.error('Error loading companies:', error);
        } finally {
            setLoading(false);
        }
    };

    // Nombre de la empresa principal a la que está enlazada (si es secundaria).
    const parentName = (company) => companies.find(x => x.company_id === company.parent_company_id)?.company_name;

    // Estado efectivo (calculado por fecha) — lo que se muestra y sobre lo que se decide.
    const effStatus = (company) => effectiveCompanyStatus({
        status: company.company_status,
        trial_ends_at: company.trial_ends_at,
        access_until: company.access_until,
    });

    const handleStatusChange = async (company, newStatus) => {
        if (newStatus === effStatus(company)) return;

        // Activar/Extender → abre el modal para elegir hasta cuándo.
        if (newStatus === 'active') {
            setActivateCompany(company);
            return;
        }
        // Overrides manuales (bloqueo)
        if (['suspended', 'cancelled'].includes(newStatus)) {
            const label = newStatus === 'suspended' ? 'Suspendida' : 'Cancelada';
            if (!window.confirm(`¿Cambiar "${company.company_name}" a ${label}? El usuario no podrá iniciar sesión.`)) return;
            const res = await adminSetCompanyAccess(company.company_id, { status: newStatus });
            if (res.success) loadCompanies(); else alert("Error: " + res.error);
            return;
        }
        // Dar/renovar prueba: 30 días desde hoy
        if (newStatus === 'trial') {
            const d = new Date(); d.setDate(d.getDate() + 30);
            const res = await adminSetCompanyAccess(company.company_id, { status: 'trial', accessUntil: d.toISOString() });
            if (res.success) loadCompanies(); else alert("Error: " + res.error);
            return;
        }
        // Marcar Vencida manualmente (access_until = ahora)
        if (newStatus === 'past_due') {
            if (!window.confirm(`¿Marcar "${company.company_name}" como Vencida?`)) return;
            const res = await adminSetCompanyAccess(company.company_id, { status: 'past_due', accessUntil: new Date().toISOString() });
            if (res.success) loadCompanies(); else alert("Error: " + res.error);
            return;
        }
        // Bloquear manualmente (se reactiva SOLA cuando pague)
        if (newStatus === 'blocked') {
            if (!window.confirm(`¿Bloquear "${company.company_name}"? No podrá ingresar hasta que pague (se reactiva automáticamente al pagar).`)) return;
            const res = await adminSetCompanyAccess(company.company_id, { status: 'blocked', accessUntil: new Date().toISOString() });
            if (res.success) loadCompanies(); else alert("Error: " + res.error);
            return;
        }
        // Otros (legacy): set directo
        const res = await toggleCompanyStatus(company.company_id, newStatus);
        if (res.success) loadCompanies(); else alert("Error: " + res.error);
    };

    // Confirmación del modal: activa la empresa hasta la fecha elegida (sigue en el ciclo automático).
    const handleConfirmActivate = async (accessUntilISO) => {
        if (!activateCompany) return;
        const res = await adminSetCompanyAccess(activateCompany.company_id, { status: 'active', accessUntil: accessUntilISO });
        setActivateCompany(null);
        if (res.success) loadCompanies(); else alert("Error: " + res.error);
    };

    const handlePlanChange = async (company, newPlan) => {
        if (newPlan === normPlan(company.company_plan)) return;
        const res = await adminSetCompanyPlan(company.company_id, newPlan);
        if (res.success) loadCompanies();
        else alert("Error: " + res.error);
    };

    const handleDelete = async (company) => {
        if (window.confirm(`PELIGRO: ¿Estás seguro de ELIMINAR la empresa "${company.company_name}"? \n\nEsta acción eliminará todos sus datos y NO se puede deshacer.`)) {
            const res = await deleteCompany(company.company_id);
            if (res.success) {
                loadCompanies();
            } else {
                alert("Error al eliminar: " + res.error);
            }
        }
    };


    const filteredCompanies = companies.filter(company => {
        if (filter === 'all') return true;
        return effStatus(company) === filter;
    });

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('es-CL');
    };

    if (loading) {
        return (
            <div className="p-8 text-white">
                <div className="animate-pulse">
                    <div className="h-8 bg-white/5 rounded w-64 mb-8"></div>
                    <div className="space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-24 bg-white/5 rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const stats = {
        total: companies.length,
        active: companies.filter(c => effStatus(c) === 'active').length,
        trial: companies.filter(c => effStatus(c) === 'trial').length,
        // "Sin acceso" = bloqueadas (auto) + suspendidas (manual)
        blocked: companies.filter(c => ['blocked', 'suspended'].includes(effStatus(c))).length,
        revenue: companies
            .filter(c => c.subscription_status === 'active')
            .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0)
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Gestión de Empresas</h1>
                    <p className="text-gray-400">Administración de suscripciones y pagos</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-primary)] text-black font-bold rounded-xl hover:brightness-110 transition-all text-sm"
                >
                    <Plus size={18} />
                    Nueva Empresa
                </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
                <StatCard
                    title="Total Empresas"
                    value={stats.total}
                    icon={<Building2 size={20} />}
                    color="text-blue-400"
                    bgColor="bg-blue-500/10"
                />
                <StatCard
                    title="Activas"
                    value={stats.active}
                    icon={<CheckCircle size={20} />}
                    color="text-green-400"
                    bgColor="bg-green-500/10"
                />
                <StatCard
                    title="En Prueba"
                    value={stats.trial}
                    icon={<Clock size={20} />}
                    color="text-blue-400"
                    bgColor="bg-blue-500/10"
                />
                <StatCard
                    title="Sin acceso"
                    value={stats.blocked}
                    icon={<Ban size={20} />}
                    color="text-red-400"
                    bgColor="bg-red-500/10"
                />
                <StatCard
                    title="Ingresos Mensuales"
                    value={formatCurrency(stats.revenue)}
                    icon={<DollarSign size={20} />}
                    color="text-green-400"
                    bgColor="bg-green-500/10"
                    isSmall
                />
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-6">
                {[
                    { id: 'all', label: 'Todas' },
                    { id: 'active', label: 'Activas' },
                    { id: 'trial', label: 'Prueba' },
                    { id: 'past_due', label: 'Vencidas' },
                    { id: 'blocked', label: 'Bloqueadas' },
                    { id: 'suspended', label: 'Suspendidas' }
                ].map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={cn(
                            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                            filter === f.id
                                ? 'bg-[var(--color-primary)] text-black'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                        )}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Companies Table */}
            <div className="bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-white/5">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">
                                    Empresa
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">
                                    Estado
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">
                                    Plan
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">
                                    Monto
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">
                                    Período
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase">
                                    Acciones
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredCompanies.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                                        No hay empresas con este filtro
                                    </td>
                                </tr>
                            ) : (
                                filteredCompanies.map((company) => (
                                    <tr key={company.company_id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                                    <Building2 size={20} className="text-gray-400" />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-white">
                                                        {company.company_name}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        ID: {company.company_id.slice(0, 12)}...
                                                    </div>
                                                    {company.parent_company_id && (
                                                        <div className="text-[11px] text-sky-400/80 mt-0.5">
                                                            ↳ de {parentName(company) || 'empresa principal'}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <select
                                                value={effStatus(company)}
                                                onChange={(e) => handleStatusChange(company, e.target.value)}
                                                className={cn(SELECT_CLS, STATUS_TEXT[effStatus(company)] || 'text-gray-300')}
                                                title="Cambiar estado"
                                            >
                                                {STATUS_OPTIONS.map(o => (
                                                    <option key={o.value} value={o.value} className="bg-[#18181b] text-white">{o.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-6 py-4">
                                            <select
                                                value={normPlan(company.company_plan)}
                                                onChange={(e) => handlePlanChange(company, e.target.value)}
                                                className={cn(SELECT_CLS, 'text-white')}
                                                title="Cambiar plan"
                                            >
                                                {PLAN_OPTIONS.map(o => (
                                                    <option key={o.value} value={o.value} className="bg-[#18181b] text-white">{o.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-mono text-green-400">
                                                {formatCurrency(company.amount || 0)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-400">
                                                <div className="flex items-center gap-1">
                                                    <Calendar size={14} />
                                                    <span className="text-xs">Acceso hasta</span>
                                                </div>
                                                <div className="text-xs text-gray-200 font-medium mt-0.5">
                                                    {formatDate(company.access_until)}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setSelectedCompany(company)}
                                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                                                    title="Ver detalles"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                                {/* Delete Button (Only for pending/suspended/cancelled) */}
                                                {['pending_payment', 'suspended', 'cancelled'].includes(company.company_status) && (
                                                    <button
                                                        onClick={() => handleDelete(company)}
                                                        className="p-2 rounded-lg transition-colors text-red-500 hover:bg-red-500/10"
                                                        title="Eliminar Empresa"
                                                    >
                                                        <XCircle size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Details Modal */}
            {selectedCompany && (
                <CompanyDetailsModal
                    company={selectedCompany}
                    onClose={() => setSelectedCompany(null)}
                />
            )}

            {/* Create Company Modal */}
            {showCreateModal && (
                <CreateCompanyModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={loadCompanies}
                />
            )}

            {/* Activate / Extend Modal */}
            {activateCompany && (
                <ActivateModal
                    company={activateCompany}
                    onClose={() => setActivateCompany(null)}
                    onConfirm={handleConfirmActivate}
                />
            )}
        </div>
    );
};

// Modal para activar/extender una empresa eligiendo hasta cuándo (duraciones rápidas o fecha exacta).
const ActivateModal = ({ company, onClose, onConfirm }) => {
    const [custom, setCustom] = useState('');
    const [busy, setBusy] = useState(false);

    const endOfDay = (d) => { d.setHours(23, 59, 59, 0); return d; };
    const addMonths = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n); return endOfDay(d); };

    const apply = async (date) => {
        setBusy(true);
        await onConfirm(date.toISOString());
        setBusy(false);
    };

    const quick = [
        { label: '1 mes', months: 1 },
        { label: '3 meses', months: 3 },
        { label: '6 meses', months: 6 },
        { label: '1 año', months: 12 },
    ];

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-lg font-bold text-white">Activar / Extender</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X size={18} /></button>
                </div>
                <p className="text-sm text-gray-400 mb-5">{company.company_name} — elige hasta cuándo tendrá acceso. Al llegar esa fecha, vuelve a evaluarse automáticamente.</p>

                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Duración rápida</p>
                <div className="grid grid-cols-2 gap-2 mb-5">
                    {quick.map(q => (
                        <button
                            key={q.months}
                            disabled={busy}
                            onClick={() => apply(addMonths(q.months))}
                            className="py-2.5 rounded-lg border border-white/10 text-white text-sm font-bold hover:border-[var(--color-primary)]/60 hover:bg-[var(--color-primary)]/10 disabled:opacity-60"
                        >
                            {q.label}
                        </button>
                    ))}
                </div>

                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">O fecha exacta</p>
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                        className="flex-1 bg-[#0f0f12] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-[var(--color-primary)] outline-none"
                    />
                    <button
                        disabled={busy || !custom}
                        onClick={() => apply(endOfDay(new Date(custom + 'T00:00:00')))}
                        className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm hover:brightness-110 disabled:opacity-50"
                    >
                        Aplicar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const StatCard = ({ title, value, icon, color, bgColor, isSmall }) => (
    <div className="bg-[#18181b] border border-white/10 p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
            <div className={cn('p-2 rounded-xl', bgColor, color)}>
                {icon}
            </div>
        </div>
        <div className={cn('font-bold mb-1', color, isSmall ? 'text-lg' : 'text-3xl')}>
            {value}
        </div>
        <div className="text-sm text-gray-400">{title}</div>
    </div>
);

export default AdminCompanies;
