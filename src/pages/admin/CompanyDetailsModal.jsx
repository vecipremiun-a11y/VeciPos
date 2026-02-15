import React from 'react';
import { X, Building2, Calendar, CreditCard, Mail, Phone, MapPin, User, CheckCircle, Ban, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';

const CompanyDetailsModal = ({ company, onClose }) => {
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

                    {/* Additional Info (Placeholder for now as we don't fetch users/contacts yet) */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex items-center gap-2">
                            <Clock size={16} /> Fechas
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white/5 p-3 rounded-lg">
                                <div className="text-xs text-gray-500 mb-1">Fecha de Creación</div>
                                <div className="text-sm text-white">{formatDate(company.created_at || new Date().toISOString())}</div>
                                {/* Note: company.created_at might not be in the fetchAllSubscriptions query yet, added fallback */}
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
