import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
    Building2, CheckCircle, XCircle, Clock, DollarSign,
    Eye, Ban, AlertCircle, Calendar, CreditCard, Power
} from 'lucide-react';
import CompanyDetailsModal from './CompanyDetailsModal';
import { cn } from '../../lib/utils';

const AdminCompanies = () => {
    const { fetchAllSubscriptions, toggleCompanyStatus, deleteCompany, adminCreateSubscription } = useStore();
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, active, trial, suspended, pending
    const [selectedCompany, setSelectedCompany] = useState(null);

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

    const handleToggleStatus = async (id, currentStatus) => {
        // Simple toggle for now: Only suspend/activate if implemented in backend
        // User prompt shows UI logic for toggle, but minimal store logic.
        // Assuming toggleCompanyStatus exists or we use raw update if not.
        if (!toggleCompanyStatus) {
            alert("Función toggleCompanyStatus no implementada en store.");
            return;
        }
        const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
        if (window.confirm(`¿Estás seguro de cambiar el estado a ${newStatus}?`)) {
            const res = await toggleCompanyStatus(id, newStatus);
            if (res.success) {
                loadCompanies();
            } else {
                alert("Error: " + res.error);
            }
        }
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

    const handleActivateSubscription = async (company) => {
        if (window.confirm(`¿Activar suscripción MANUAL para "${company.company_name}"? \n\nEsto le dará acceso completo con el plan Básico (Mensual).`)) {
            const res = await adminCreateSubscription(company.company_id);
            if (res.success) {
                loadCompanies();
                alert("✅ Suscripción activada correctamente.");
            } else {
                alert("Error: " + res.error);
            }
        }
    };


    const filteredCompanies = companies.filter(company => {
        if (filter === 'all') return true;
        return company.company_status === filter;
    });

    const getStatusBadge = (status) => {
        const badges = {
            active: {
                label: 'Activa',
                color: 'bg-green-500/10 text-green-400 border-green-500/30',
                icon: CheckCircle
            },
            trial: {
                label: 'Prueba',
                color: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
                icon: Clock
            },
            suspended: {
                label: 'Suspendida',
                color: 'bg-red-500/10 text-red-400 border-red-500/30',
                icon: Ban
            },
            past_due: {
                label: 'Vencida',
                color: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
                icon: AlertCircle
            },
            pending_payment: {
                label: 'Pendiente',
                color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
                icon: Clock
            },
            cancelled: {
                label: 'Cancelada',
                color: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
                icon: XCircle
            }
        };

        const badge = badges[status] || badges.pending_payment;
        const Icon = badge.icon;

        return (
            <span className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border',
                badge.color
            )}>
                <Icon size={14} />
                {badge.label}
            </span>
        );
    };

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
        active: companies.filter(c => c.company_status === 'active').length,
        trial: companies.filter(c => c.company_status === 'trial').length,
        suspended: companies.filter(c => c.company_status === 'suspended').length,
        revenue: companies
            .filter(c => c.subscription_status === 'active')
            .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0)
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">Gestión de Empresas</h1>
                <p className="text-gray-400">Administración de suscripciones y pagos</p>
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
                    title="Suspendidas"
                    value={stats.suspended}
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
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {getStatusBadge(company.company_status)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-white font-medium">
                                                {company.plan_name || 'Sin plan'}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {company.plan_id === 'monthly' ? 'Mensual' : 'Anual'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-mono text-green-400">
                                                {formatCurrency(company.amount || 0)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-400">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Calendar size={14} />
                                                    {formatDate(company.current_period_start)}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    hasta {formatDate(company.current_period_end)}
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
                                                <button
                                                    onClick={() => handleToggleStatus(company.company_id, company.company_status)}
                                                    className={cn(
                                                        'p-2 rounded-lg transition-colors',
                                                        company.company_status === 'active'
                                                            ? 'text-yellow-400 hover:bg-yellow-500/10'
                                                            : 'text-green-400 hover:bg-green-500/10'
                                                    )}
                                                    title={company.company_status === 'active' ? "Suspender" : "Activar"}
                                                >
                                                    {company.company_status === 'active' ? <Ban size={18} /> : <Power size={18} />}
                                                </button>

                                                {/* Activate Manual Sub */}
                                                {!company.subscription_id && company.company_status === 'active' && (
                                                    <button
                                                        onClick={() => handleActivateSubscription(company)}
                                                        className="p-2 rounded-lg transition-colors text-blue-400 hover:bg-blue-500/10"
                                                        title="Activar Suscripción Manual (Básico)"
                                                    >
                                                        <CreditCard size={18} />
                                                    </button>
                                                )}

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
        </div>
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
