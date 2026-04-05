import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Save, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, ChevronDown, Clock, CalendarDays, TrendingDown, Gift, Wallet, Lock } from 'lucide-react';
import { cn } from '../../../lib/utils';

const PAY_TYPE_LABELS = {
    monthly: '💰 Mensual',
    hourly: '⏱️ Por Hora',
    weekly: '📅 Semanal',
    biweekly: '🧾 Quincenal',
    mixed: '📊 Mixto',
};

const PeriodCalculator = () => {
    const {
        staffMembers,
        fetchStaffMembers,
        calculatePeriod,
        createPayrollPeriod,
        closePeriod,
        fetchPayrollPeriods,
        payrollPeriods,
        currentUser
    } = useStore();

    const [currentDate, setCurrentDate] = useState(new Date());
    const [calculations, setCalculations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [periodClosed, setPeriodClosed] = useState(false);
    const [expandedUser, setExpandedUser] = useState(null);

    useEffect(() => {
        fetchStaffMembers();
        fetchPayrollPeriods();
    }, []);

    useEffect(() => {
        const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
        const closed = payrollPeriods.find(p => p.period_start === start || p.start_date === start);
        setPeriodClosed(!!closed);
    }, [currentDate, payrollPeriods]);

    useEffect(() => {
        if (!periodClosed) runCalculations();
    }, [currentDate, staffMembers, periodClosed]);

    const runCalculations = async () => {
        if (staffMembers.length === 0) return;
        setLoading(true);
        const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentDate), 'yyyy-MM-dd');
        try {
            const results = await Promise.all(staffMembers.map(async (user) => {
                const calc = await calculatePeriod(user.id, start, end);
                return { user, ...calc };
            }));
            setCalculations(results);
        } catch (error) {
            console.error("Error calculating period", error);
        }
        setLoading(false);
    };

    const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

    const handleClosePeriod = async () => {
        if (!window.confirm("¿Cerrar este periodo? Se generarán los registros de pago y se descontarán los adelantos. Esta acción no se puede deshacer.")) return;
        setLoading(true);
        const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentDate), 'yyyy-MM-dd');

        let allSuccess = true;
        for (const c of calculations) {
            const totalBonuses = (c.auto_bonuses || 0) + (c.manual_bonus || 0);
            const totalDiscounts = (c.auto_discounts || 0) + (c.manual_discount || 0);
            const result = await createPayrollPeriod({
                user_id: c.user.id,
                period_label: format(startOfMonth(currentDate), 'MMMM yyyy', { locale: es }),
                period_start: start,
                period_end: end,
                hours_worked: c.hours_worked || 0,
                days_absent: c.days_absent || 0,
                late_count: c.late_count || 0,
                late_minutes: c.late_minutes || 0,
                extra_hours: c.extra_hours || 0,
                manual_bonus: totalBonuses,
                manual_discount: totalDiscounts,
                advances_discounted: c.advances_discounted || 0,
                base_amount: c.base_amount || 0,
                total_to_pay: c.total_to_pay || 0,
            }, currentUser?.username || 'admin');
            if (!result.success) allSuccess = false;
        }

        if (allSuccess) {
            alert("Periodo cerrado exitosamente");
            fetchPayrollPeriods();
        } else {
            alert('Hubo errores al cerrar el periodo');
        }
        setLoading(false);
    };

    const fmt = (amount) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);

    const toggleDetail = (userId) => setExpandedUser(prev => prev === userId ? null : userId);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] p-1 rounded-lg border border-[var(--glass-border)]">
                        <button onClick={handlePrevMonth} className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><ChevronLeft size={20} /></button>
                        <span className="font-bold text-[var(--color-text)] px-2 min-w-[140px] text-center capitalize">{format(currentDate, 'MMMM yyyy', { locale: es })}</span>
                        <button onClick={handleNextMonth} className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><ChevronRight size={20} /></button>
                    </div>
                    {periodClosed ? (
                        <div className="flex items-center gap-2 text-green-500 bg-green-500/10 px-3 py-1.5 rounded-lg border border-green-500/20">
                            <Lock size={14} /><span className="text-sm font-bold">Cerrado</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-yellow-400 bg-yellow-500/10 px-3 py-1.5 rounded-lg border border-yellow-500/20">
                            <AlertCircle size={14} /><span className="text-sm font-medium">Abierto</span>
                        </div>
                    )}
                </div>
                {!periodClosed && (
                    <button onClick={handleClosePeriod} disabled={loading || calculations.length === 0}
                        className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm">
                        <Save size={16} /> Cerrar Periodo
                    </button>
                )}
            </div>

            {periodClosed ? (
                <div className="glass-card p-10 text-center text-[var(--color-text-muted)]">
                    <Lock size={24} className="mx-auto mb-2 text-green-400" />
                    <p>Periodo cerrado. Ver detalles en <strong>Historial</strong>.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {loading && <div className="p-4 text-center text-[var(--color-text-muted)]">Calculando para todos los empleados...</div>}

                    {!loading && calculations.length === 0 && (
                        <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">No hay personal registrado.</div>
                    )}

                    {!loading && calculations.map(c => {
                        const totalBonuses = (c.auto_bonuses || 0) + (c.manual_bonus || 0);
                        const totalDiscounts = (c.auto_discounts || 0) + (c.manual_discount || 0);
                        const isExpanded = expandedUser === c.user.id;

                        return (
                            <div key={c.user.id} className="glass-card p-0 overflow-hidden">
                                {/* Summary row */}
                                <div className="p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center cursor-pointer hover:bg-[var(--glass-bg)] transition-colors"
                                    onClick={() => toggleDetail(c.user.id)}>
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-[var(--color-primary)] font-bold text-sm ring-1 ring-[var(--glass-border)] flex-shrink-0">
                                            {c.user.name[0]}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-bold text-[var(--color-text)] truncate">{c.user.name}</p>
                                            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                                                <span>{c.user.labor_position || 'Sin cargo'}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--glass-border)]">{PAY_TYPE_LABELS[c.pay_type] || c.pay_type}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6 flex-shrink-0">
                                        <div className="hidden md:flex items-center gap-4 text-xs">
                                            <span className="text-[var(--color-text-muted)]">{fmt(c.base_amount)}</span>
                                            {totalBonuses > 0 && <span className="text-emerald-400">+{fmt(totalBonuses)}</span>}
                                            {totalDiscounts > 0 && <span className="text-red-400">-{fmt(totalDiscounts)}</span>}
                                            {c.advances_discounted > 0 && <span className="text-orange-400">-{fmt(c.advances_discounted)}</span>}
                                        </div>
                                        <span className="text-lg font-bold text-[var(--color-primary)]">{fmt(c.total_to_pay)}</span>
                                        <ChevronDown size={16} className={cn("text-[var(--color-text-muted)] transition-transform", isExpanded && "rotate-180")} />
                                    </div>
                                </div>

                                {/* Detail panel */}
                                {isExpanded && (
                                    <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 animate-in slide-in-from-top-2 duration-200">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                            <Stat icon={CalendarDays} label="Días trabajados" value={`${c.days_worked || 0} / ${c.total_shifts || 0}`} />
                                            <Stat icon={Clock} label="Horas trabajadas" value={`${c.hours_worked || 0}h`} />
                                            <Stat icon={TrendingDown} label="Atrasos" value={c.late_count > 0 ? `${c.late_count}x (${c.late_minutes}min)` : 'Ninguno'}
                                                color={c.late_count > 0 ? 'text-amber-400' : 'text-emerald-400'} />
                                            <Stat icon={AlertCircle} label="Faltas" value={c.days_unjustified > 0 ? `${c.days_unjustified} inj.` : 'Ninguna'}
                                                color={c.days_unjustified > 0 ? 'text-red-400' : 'text-emerald-400'} />
                                        </div>

                                        {/* Ausencias pagadas */}
                                        {(c.days_vacation > 0 || c.days_medical > 0 || c.days_permission > 0) && (
                                            <div className="flex gap-3 mb-4 flex-wrap">
                                                {c.days_vacation > 0 && <span className="text-xs px-2 py-1 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/20">🟣 Vacaciones: {c.days_vacation}d</span>}
                                                {c.days_medical > 0 && <span className="text-xs px-2 py-1 rounded-lg bg-red-500/15 text-red-400 border border-red-500/20">🔴 Licencia: {c.days_medical}d</span>}
                                                {c.days_permission > 0 && <span className="text-xs px-2 py-1 rounded-lg bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">🟡 Permisos: {c.days_permission}d</span>}
                                            </div>
                                        )}

                                        {/* Desglose financiero */}
                                        <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--glass-border)] divide-y divide-[var(--glass-border)] text-sm">
                                            <Row label="Sueldo base" value={fmt(c.base_amount)} />
                                            {(c.paid_absence_amount || 0) > 0 && <Row label="Ausencias pagadas" value={`+${fmt(c.paid_absence_amount)}`} className="text-purple-400" />}
                                            {(c.bonus_details || []).map((b, i) => <Row key={`b${i}`} label={`🎯 ${b.label}`} value={`+${fmt(b.amount)}`} className="text-emerald-400" />)}
                                            {(c.manual_bonus || 0) > 0 && <Row label="Bono fijo" value={`+${fmt(c.manual_bonus)}`} className="text-emerald-400" />}
                                            {(c.discount_details || []).map((d, i) => <Row key={`d${i}`} label={`⚠️ ${d.label}`} value={`-${fmt(d.amount)}`} className="text-red-400" />)}
                                            {(c.manual_discount || 0) > 0 && <Row label="Descuento fijo" value={`-${fmt(c.manual_discount)}`} className="text-red-400" />}
                                            {c.advances_discounted > 0 && <Row label="Adelantos" value={`-${fmt(c.advances_discounted)}`} className="text-orange-400" />}
                                            <div className="flex justify-between items-center p-3 font-bold text-base">
                                                <span className="text-[var(--color-text)]">TOTAL A PAGAR</span>
                                                <span className="text-[var(--color-primary)]">{fmt(c.total_to_pay)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Grand total */}
                    {!loading && calculations.length > 0 && (
                        <div className="glass-card p-4 flex justify-between items-center">
                            <span className="font-bold text-[var(--color-text)] text-lg">TOTAL NÓMINA</span>
                            <span className="text-2xl font-bold text-[var(--color-primary)]">
                                {fmt(calculations.reduce((s, c) => s + (c.total_to_pay || 0), 0))}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const Stat = ({ icon: Icon, label, value, color }) => (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
        <Icon size={16} className="text-[var(--color-text-muted)] flex-shrink-0" />
        <div>
            <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{label}</p>
            <p className={cn("text-sm font-bold", color || "text-[var(--color-text)]")}>{value}</p>
        </div>
    </div>
);

const Row = ({ label, value, className }) => (
    <div className="flex justify-between items-center p-3 text-sm">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className={cn("font-medium", className || "text-[var(--color-text)]")}>{value}</span>
    </div>
);

export default PeriodCalculator;
