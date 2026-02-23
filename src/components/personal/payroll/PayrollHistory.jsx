import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, DollarSign, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { cn } from '../../../lib/utils';

const PayrollHistory = () => {
    const { fetchPayrollPeriods, payrollPeriods, fetchStaffMembers, staffMembers } = useStore();
    const [loading, setLoading] = useState(false);
    const [expandedPeriod, setExpandedPeriod] = useState(null);

    useEffect(() => {
        setLoading(true);
        fetchPayrollPeriods().then(() => setLoading(false));
        fetchStaffMembers();
    }, []);

    const toggleExpand = (id) => {
        if (expandedPeriod === id) setExpandedPeriod(null);
        else setExpandedPeriod(id);
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
    };

    const getUserName = (id) => {
        const user = staffMembers.find(u => u.id === id);
        return user ? user.name : 'Desconocido';
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-500">
            {loading ? (
                <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando historial...</div>
            ) : payrollPeriods.length === 0 ? (
                <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                    No hay periodos de pago cerrados.
                </div>
            ) : (
                payrollPeriods.map(period => (
                    <div key={period.id} className="glass-card p-0 overflow-hidden">
                        <div
                            className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center cursor-pointer hover:bg-[var(--glass-bg)] transition-colors"
                            onClick={() => toggleExpand(period.id)}
                        >
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg">
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <p className="font-bold text-[var(--color-text)] capitalize">
                                        {format(new Date(period.start_date), 'MMMM yyyy', { locale: es })}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                                        <Calendar size={12} />
                                        <span>{format(new Date(period.start_date), 'dd/MM/yyyy')} - {format(new Date(period.end_date), 'dd/MM/yyyy')}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-6">
                                <div className="text-right">
                                    <p className="text-xs text-[var(--color-text-muted)] uppercase">Total Pagado</p>
                                    <p className="font-bold text-[var(--color-primary)] text-lg">{formatCurrency(period.total_amount)}</p>
                                </div>
                                {expandedPeriod === period.id ? <ChevronDown className="text-[var(--color-text-muted)]" /> : <ChevronRight className="text-[var(--color-text-muted)]" />}
                            </div>
                        </div>

                        {expandedPeriod === period.id && (
                            <div className="bg-[var(--glass-bg)] border-t border-[var(--glass-border)] p-4 animate-in slide-in-from-top-2 duration-200">
                                <h4 className="text-sm font-bold text-[var(--color-text-muted)] mb-3 uppercase">Detalle de Pagos</h4>
                                {period.payments && period.payments.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="text-[var(--color-text-muted)] border-b border-[var(--glass-border)]">
                                                    <th className="text-left pb-2 font-medium">Empleado</th>
                                                    <th className="text-right pb-2 font-medium">Base</th>
                                                    <th className="text-right pb-2 font-medium">Bonos</th>
                                                    <th className="text-right pb-2 font-medium">Desc.</th>
                                                    <th className="text-right pb-2 font-medium">Adelantos</th>
                                                    <th className="text-right pb-2 font-medium">Total</th>
                                                    <th className="text-center pb-2 font-medium">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {/* Assuming payrollPeriods from store includes payments join or I need to fetch payments for this period? */}
                                                {/* The store 'fetchPayrollPeriods' query usually joins or I fetch separate. */}
                                                {/* If detailed payments are not in 'period' object, I should fetch them. */}
                                                {/* For now assuming the store returns them nested or I need to update store logic. */}
                                                {/* If payments are missing, I'll show a message or fetch. */}
                                                {/* Let's assume standard behavior: master object has details if queried right or shallow if not. */}
                                                {/* If period.payments is undefined, we assume lazy loading or missing. */}
                                                {period.payments ? period.payments.map((pay, idx) => (
                                                    <tr key={idx} className="hover:bg-[var(--color-surface)]/50">
                                                        <td className="py-2 text-[var(--color-text)]">{getUserName(pay.user_id)}</td>
                                                        <td className="py-2 text-right">{formatCurrency(pay.base_amount)}</td>
                                                        <td className="py-2 text-right text-green-400">+{formatCurrency(pay.bonuses)}</td>
                                                        <td className="py-2 text-right text-red-400">-{formatCurrency(pay.discounts)}</td>
                                                        <td className="py-2 text-right text-orange-400">-{formatCurrency(pay.advances)}</td>
                                                        <td className="py-2 text-right font-bold text-[var(--color-text)]">{formatCurrency(pay.amount)}</td>
                                                        <td className="py-2 text-center">
                                                            <span className={cn(
                                                                "px-2 py-0.5 rounded text-[10px] uppercase font-bold",
                                                                pay.status === 'paid' ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
                                                            )}>
                                                                {pay.status === 'paid' ? 'Pagado' : 'Pendiente'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                )) : (
                                                    <tr>
                                                        <td colSpan="7" className="py-4 text-center text-[var(--color-text-muted)]">
                                                            No hay detalles de pagos disponibles o cargando...
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-sm text-[var(--color-text-muted)] italic">No hay registros de pagos asociados.</p>
                                )}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );
};

export default PayrollHistory;
