import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, ChevronDown, ChevronRight, FileText, Lock, Clock, AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';

const PayrollHistory = () => {
    const { fetchPayrollPeriods, payrollPeriods, fetchStaffMembers, staffMembers } = useStore();
    const [loading, setLoading] = useState(false);
    const [expandedPeriod, setExpandedPeriod] = useState(null);

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchPayrollPeriods(), fetchStaffMembers()]).then(() => setLoading(false));
    }, []);

    const formatCurrency = (amount) =>
        new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);

    const getUserName = (id) => {
        const user = staffMembers.find(u => u.id === id);
        return user ? user.name : 'Desconocido';
    };

    // Group individual records by period_start (same month = same period)
    const grouped = {};
    payrollPeriods.forEach(p => {
        const key = p.period_start || p.start_date || 'unknown';
        if (!grouped[key]) {
            grouped[key] = {
                period_start: p.period_start || p.start_date,
                period_end: p.period_end || p.end_date,
                period_label: p.period_label,
                is_closed: p.is_closed,
                records: []
            };
        }
        grouped[key].records.push(p);
    });

    const periods = Object.values(grouped).sort((a, b) => b.period_start.localeCompare(a.period_start));

    return (
        <div className="space-y-4 animate-in fade-in duration-500">
            {loading ? (
                <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando historial...</div>
            ) : periods.length === 0 ? (
                <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                    No hay periodos de pago cerrados.
                </div>
            ) : (
                periods.map(period => {
                    const totalAmount = period.records.reduce((s, r) => s + (r.total_to_pay || 0), 0);
                    const isExpanded = expandedPeriod === period.period_start;
                    let periodDate;
                    try {
                        periodDate = new Date(period.period_start + 'T12:00:00');
                    } catch {
                        periodDate = new Date();
                    }

                    return (
                        <div key={period.period_start} className="glass-card p-0 overflow-hidden">
                            <div className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center cursor-pointer hover:bg-[var(--glass-bg)] transition-colors"
                                onClick={() => setExpandedPeriod(isExpanded ? null : period.period_start)}>
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg">
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <p className="font-bold text-[var(--color-text)] capitalize">
                                            {period.period_label || format(periodDate, 'MMMM yyyy', { locale: es })}
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                                            <Calendar size={12} />
                                            <span>{format(periodDate, 'dd/MM/yyyy')} - {format(new Date(period.period_end + 'T12:00:00'), 'dd/MM/yyyy')}</span>
                                            {period.is_closed ? (
                                                <span className="flex items-center gap-1 text-green-400"><Lock size={10} /> Cerrado</span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-yellow-400"><AlertCircle size={10} /> Abierto</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{period.records.length} empleado{period.records.length !== 1 ? 's' : ''}</p>
                                        <p className="font-bold text-[var(--color-primary)] text-lg">{formatCurrency(totalAmount)}</p>
                                    </div>
                                    {isExpanded ? <ChevronDown className="text-[var(--color-text-muted)]" /> : <ChevronRight className="text-[var(--color-text-muted)]" />}
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="bg-[var(--glass-bg)] border-t border-[var(--glass-border)] p-4 animate-in slide-in-from-top-2 duration-200">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="text-[var(--color-text-muted)] border-b border-[var(--glass-border)]">
                                                    <th className="text-left pb-2 font-medium">Empleado</th>
                                                    <th className="text-right pb-2 font-medium">Horas</th>
                                                    <th className="text-right pb-2 font-medium">Atrasos</th>
                                                    <th className="text-right pb-2 font-medium">Faltas</th>
                                                    <th className="text-right pb-2 font-medium">Base</th>
                                                    <th className="text-right pb-2 font-medium">Bonos</th>
                                                    <th className="text-right pb-2 font-medium">Desc.</th>
                                                    <th className="text-right pb-2 font-medium">Adelantos</th>
                                                    <th className="text-right pb-2 font-medium font-bold">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {period.records.map(r => (
                                                    <tr key={r.id} className="hover:bg-[var(--color-surface)]/50">
                                                        <td className="py-2 text-[var(--color-text)]">
                                                            <p className="font-medium">{r.name || getUserName(r.user_id)}</p>
                                                        </td>
                                                        <td className="py-2 text-right text-[var(--color-text-muted)]">
                                                            <span className="flex items-center justify-end gap-1"><Clock size={10} />{r.hours_worked || 0}h</span>
                                                        </td>
                                                        <td className="py-2 text-right">
                                                            {r.late_count > 0 ? (
                                                                <span className="text-amber-400">{r.late_count}x ({r.late_minutes}min)</span>
                                                            ) : <span className="text-emerald-400">0</span>}
                                                        </td>
                                                        <td className="py-2 text-right">
                                                            {r.days_absent > 0 ? (
                                                                <span className="text-red-400">{r.days_absent}d</span>
                                                            ) : <span className="text-emerald-400">0</span>}
                                                        </td>
                                                        <td className="py-2 text-right">{formatCurrency(r.base_amount)}</td>
                                                        <td className="py-2 text-right text-emerald-400">+{formatCurrency(r.manual_bonus)}</td>
                                                        <td className="py-2 text-right text-red-400">-{formatCurrency(r.manual_discount)}</td>
                                                        <td className="py-2 text-right text-orange-400">-{formatCurrency(r.advances_discounted)}</td>
                                                        <td className="py-2 text-right font-bold text-[var(--color-text)]">{formatCurrency(r.total_to_pay)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="bg-[var(--color-surface)] font-bold">
                                                    <td className="py-2 pl-2 text-[var(--color-text)]" colSpan={4}>TOTAL PERIODO</td>
                                                    <td className="py-2 text-right">{formatCurrency(period.records.reduce((s, r) => s + (r.base_amount || 0), 0))}</td>
                                                    <td className="py-2 text-right text-emerald-400">+{formatCurrency(period.records.reduce((s, r) => s + (r.manual_bonus || 0), 0))}</td>
                                                    <td className="py-2 text-right text-red-400">-{formatCurrency(period.records.reduce((s, r) => s + (r.manual_discount || 0), 0))}</td>
                                                    <td className="py-2 text-right text-orange-400">-{formatCurrency(period.records.reduce((s, r) => s + (r.advances_discounted || 0), 0))}</td>
                                                    <td className="py-2 text-right text-[var(--color-primary)] text-base">{formatCurrency(totalAmount)}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })
            )}
        </div>
    );
};

export default PayrollHistory;
