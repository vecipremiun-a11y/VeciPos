import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calculator, Save, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, DollarSign } from 'lucide-react';
import { cn } from '../../../lib/utils';

const PeriodCalculator = () => {
    const {
        staffMembers,
        fetchStaffMembers,
        calculatePeriod,
        createPayrollPeriod,
        fetchPayrollPeriods,
        payrollPeriods,
        currentUser
    } = useStore();

    const [currentDate, setCurrentDate] = useState(new Date());
    const [calculations, setCalculations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [periodClosed, setPeriodClosed] = useState(false);

    useEffect(() => {
        fetchStaffMembers();
        fetchPayrollPeriods();
    }, []);

    useEffect(() => {
        const checkStatus = () => {
            const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
            // Check if any period starts on this date (simplification)
            const closed = payrollPeriods.find(p => p.start_date === start);
            setPeriodClosed(!!closed);
        };
        checkStatus();
    }, [currentDate, payrollPeriods]);

    useEffect(() => {
        if (!periodClosed) {
            runCalculations();
        }
    }, [currentDate, staffMembers, periodClosed]);

    const runCalculations = async () => {
        // Only run if we have staff
        if (staffMembers.length === 0) return;

        setLoading(true);
        const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentDate), 'yyyy-MM-dd');

        try {
            const results = await Promise.all(staffMembers.map(async (user) => {
                const calc = await calculatePeriod(user.id, start, end);
                return {
                    user,
                    ...calc,
                    // Normalizar nombres de campos
                    advances: calc.advances_discounted || 0,
                    bonuses: calc.manual_bonus || 0,
                    discounts: calc.manual_discount || 0,
                    total_payable: calc.total_to_pay || 0,
                    base_amount: calc.base_amount || 0,
                };
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
        if (!window.confirm("¿Estás seguro de cerrar este periodo? Se generarán los registros de pago y se descontarán los adelantos. Esta acción no se puede deshacer.")) return;
        setLoading(true);

        const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentDate), 'yyyy-MM-dd');
        const totalAmount = calculations.reduce((sum, item) => sum + (item.total_payable || 0), 0);

        // Cerrar periodo por cada empleado individualmente
        let allSuccess = true;
        for (const c of calculations) {
            const result = await createPayrollPeriod({
                user_id: c.user.id,
                period_label: format(startOfMonth(currentDate), 'MMMM yyyy', { locale: es }),
                period_start: start,
                period_end: end,
                hours_worked: parseFloat(c.hours_worked) || 0,
                days_absent: c.days_absent || 0,
                late_count: c.late_count || 0,
                late_minutes: c.late_minutes || 0,
                extra_hours: c.extra_hours || 0,
                manual_bonus: c.bonuses || 0,
                manual_discount: c.discounts || 0,
                advances_discounted: c.advances || 0,
                base_amount: c.base_amount || 0,
                total_to_pay: c.total_payable || 0,
            }, currentUser?.username || 'admin');
            if (!result.success) allSuccess = false;
        }

        const result = { success: allSuccess };

        if (result.success) {
            alert("Periodo cerrado exitosamente");
            fetchPayrollPeriods();
        } else {
            alert(result.error || 'Error al cerrar periodo');
        }
        setLoading(false);
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount || 0);
    };

    return (
        <div className="space-y-6">
            {/* Header / Month Selector */}
            <div className="flex justify-between items-center bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] p-1 rounded-lg border border-[var(--glass-border)]">
                        <button onClick={handlePrevMonth} className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <ChevronLeft size={20} />
                        </button>
                        <span className="font-bold text-[var(--color-text)] px-2 min-w-[140px] text-center capitalize">
                            {format(currentDate, 'MMMM yyyy', { locale: es })}
                        </span>
                        <button onClick={handleNextMonth} className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                    {periodClosed ? (
                        <div className="flex items-center gap-2 text-green-400 bg-green-500/10 px-3 py-1 rounded-lg border border-green-500/20">
                            <CheckCircle size={16} />
                            <span className="text-sm font-medium">Periodo Cerrado</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-yellow-400 bg-yellow-500/10 px-3 py-1 rounded-lg border border-yellow-500/20">
                            <AlertCircle size={16} />
                            <span className="text-sm font-medium">Periodo Abierto (Preliminar)</span>
                        </div>
                    )}
                </div>

                {!periodClosed && (
                    <button
                        onClick={handleClosePeriod}
                        disabled={loading || calculations.length === 0}
                        className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
                    >
                        <Save size={16} />
                        Cerrar Periodo
                    </button>
                )}
            </div>

            {/* Calculations Table */}
            {periodClosed ? (
                <div className="glass-card p-10 text-center text-[var(--color-text-muted)]">
                    <p>Este periodo ya ha sido cerrado. Puedes ver los detalles en la pestaña de <strong>Historial</strong>.</p>
                </div>
            ) : (
                <div className="glass-card p-0 overflow-hidden">
                    {loading && <div className="p-4 text-center text-[var(--color-text-muted)]">Calculando...</div>}
                    {!loading && (
                        <table className="w-full">
                            <thead className="bg-[var(--glass-bg)] text-xs font-bold text-[var(--color-text-muted)] uppercase">
                                <tr>
                                    <th className="p-4 text-left">Empleado</th>
                                    <th className="p-4 text-right">Base</th>
                                    <th className="p-4 text-right">Bonos</th>
                                    <th className="p-4 text-right">Descuentos</th>
                                    <th className="p-4 text-right">Adelantos</th>
                                    <th className="p-4 text-right text-[var(--color-text)]">Total a Pagar</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {calculations.map((item, index) => (
                                    <tr key={index} className="hover:bg-[var(--color-surface)] transition-colors">
                                        <td className="p-4">
                                            <p className="font-bold text-[var(--color-text)]">{item.user.name}</p>
                                            <p className="text-[10px] text-[var(--color-text-muted)]">{item.user.labor_position || 'Sin cargo'}</p>
                                        </td>
                                        <td className="p-4 text-right font-medium">{formatCurrency(item.base_amount)}</td>
                                        <td className="p-4 text-right text-green-400">+{formatCurrency(item.bonuses)}</td>
                                        <td className="p-4 text-right text-red-400">-{formatCurrency(item.discounts)}</td>
                                        <td className="p-4 text-right text-orange-400">-{formatCurrency(item.advances)}</td>
                                        <td className="p-4 text-right font-bold text-[var(--color-primary)] text-lg">
                                            {formatCurrency(item.total_payable)}
                                        </td>
                                    </tr>
                                ))}
                                {calculations.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-[var(--color-text-muted)]">
                                            No hay datos para calcular.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot className="bg-[var(--glass-bg)] font-bold text-[var(--color-text)]">
                                <tr>
                                    <td className="p-4">TOTAL</td>
                                    <td className="p-4 text-right">{formatCurrency(calculations.reduce((s, i) => s + (i.base_amount || 0), 0))}</td>
                                    <td className="p-4 text-right text-green-400">+{formatCurrency(calculations.reduce((s, i) => s + (i.bonuses || 0), 0))}</td>
                                    <td className="p-4 text-right text-red-400">-{formatCurrency(calculations.reduce((s, i) => s + (i.discounts || 0), 0))}</td>
                                    <td className="p-4 text-right text-orange-400">-{formatCurrency(calculations.reduce((s, i) => s + (i.advances || 0), 0))}</td>
                                    <td className="p-4 text-right text-[var(--color-primary)] text-lg">
                                        {formatCurrency(calculations.reduce((s, i) => s + (i.total_payable || 0), 0))}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

export default PeriodCalculator;
