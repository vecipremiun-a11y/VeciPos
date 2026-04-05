import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, eachWeekOfInterval, eachDayOfInterval, isAfter, isBefore, parseISO, differenceInDays, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, TrendingUp, Clock, AlertTriangle, Users, DollarSign, CalendarDays, UserX, Activity } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const ABSENCE_LABELS = {
    medical: 'Licencia',
    vacation: 'Vacaciones',
    permission: 'Permiso',
    administrative: 'Administrativo',
    unjustified: 'Injustificada',
    unpaid_leave: 'Sin goce',
    other: 'Otro'
};

const ReportsDashboard = () => {
    const {
        fetchStaffMembers, staffMembers,
        fetchAttendanceByRange,
        fetchShifts, workShifts,
        fetchAbsences, laborAbsences,
        fetchPayrollPeriods, payrollPeriods,
        fetchVacationBalances, vacationBalances,
        personalConfig, fetchPersonalConfig,
        currentCompanyTimezone
    } = useStore();

    const [loading, setLoading] = useState(true);
    const [attendance, setAttendance] = useState([]);
    const [prevAttendance, setPrevAttendance] = useState([]);
    const [prevAbsences, setPrevAbsences] = useState([]);

    const now = new Date();
    const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
    const prevMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
    const prevMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const [att, prevAtt] = await Promise.all([
                fetchAttendanceByRange(monthStart, monthEnd),
                fetchAttendanceByRange(prevMonthStart, prevMonthEnd),
                fetchStaffMembers(),
                fetchShifts(monthStart, monthEnd),
                fetchAbsences(monthStart, monthEnd),
                fetchPayrollPeriods(),
                fetchVacationBalances(),
                fetchPersonalConfig()
            ]);
            setAttendance(att || []);
            setPrevAttendance(prevAtt || []);
            // Fetch prev month absences separately
            const store = useStore.getState();
            const prevAbs = await store.fetchAbsences(prevMonthStart, prevMonthEnd);
            setPrevAbsences(prevAbs || []);
            // Re-fetch current month absences (fetchAbsences overwrites state)
            await fetchAbsences(monthStart, monthEnd);
            setLoading(false);
        };
        load();
    }, []);

    // ─── Puntualidad ───
    const punctualityStats = useMemo(() => {
        if (!attendance.length || !workShifts.length) return { current: 0, prev: 0 };
        const tolerance = personalConfig?.late_tolerance_minutes || 5;

        const calcPunctuality = (records, shifts) => {
            let onTime = 0, total = 0;
            for (const rec of records) {
                if (!rec.check_in) continue;
                const shift = shifts.find(s => s.user_id === rec.user_id && s.shift_date === rec.date && s.notes !== 'LIBRE');
                if (!shift) continue;
                total++;
                const shiftStart = new Date(shift.start_time);
                const checkIn = new Date(rec.check_in);
                const diffMin = (checkIn - shiftStart) / 60000;
                if (diffMin <= tolerance) onTime++;
            }
            return total > 0 ? Math.round((onTime / total) * 100) : 100;
        };

        return {
            current: calcPunctuality(attendance, workShifts),
            prev: calcPunctuality(prevAttendance, workShifts)
        };
    }, [attendance, prevAttendance, workShifts, personalConfig]);

    // ─── Ausencias del mes ───
    const absenceStats = useMemo(() => {
        const abs = laborAbsences || [];
        const byType = {};
        abs.forEach(a => {
            byType[a.type] = (byType[a.type] || 0) + 1;
        });
        return { total: abs.length, byType };
    }, [laborAbsences]);

    // ─── Horas extra ───
    const extraHours = useMemo(() => {
        if (!attendance.length || !workShifts.length) return 0;
        let totalExtra = 0;
        for (const rec of attendance) {
            if (!rec.check_in || !rec.check_out) continue;
            const shift = workShifts.find(s => s.user_id === rec.user_id && s.shift_date === rec.date && s.notes !== 'LIBRE');
            if (!shift) continue;
            const shiftHrs = (new Date(shift.end_time) - new Date(shift.start_time)) / 3600000;
            const workedHrs = (new Date(rec.check_out) - new Date(rec.check_in)) / 3600000;
            if (workedHrs > shiftHrs) totalExtra += workedHrs - shiftHrs;
        }
        return Math.round(totalExtra * 10) / 10;
    }, [attendance, workShifts]);

    // ─── Costo nómina ───
    const payrollCost = useMemo(() => {
        if (!staffMembers?.length) return 0;
        // If there are closed periods for this month, use those
        const monthPeriods = (payrollPeriods || []).filter(p =>
            p.period_start >= monthStart && p.period_start <= monthEnd && p.is_closed
        );
        if (monthPeriods.length > 0) {
            return monthPeriods.reduce((s, p) => s + (p.total_to_pay || 0), 0);
        }
        // Otherwise estimate from base amounts
        return staffMembers.reduce((s, u) => s + (u.pay_base_amount || 0), 0);
    }, [staffMembers, payrollPeriods, monthStart, monthEnd]);

    // ─── Tendencia de asistencia semanal ───
    const weeklyData = useMemo(() => {
        if (!workShifts.length) return [];
        const mStart = startOfMonth(now);
        const mEnd = endOfMonth(now);
        const weeks = eachWeekOfInterval({ start: mStart, end: mEnd }, { weekStartsOn: 1 });

        return weeks.map((weekStart, idx) => {
            const wEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
            const clampEnd = isAfter(wEnd, mEnd) ? mEnd : wEnd;
            const clampStart = isBefore(weekStart, mStart) ? mStart : weekStart;

            // Count shifts for this week (excluding LIBRE)
            const weekShifts = workShifts.filter(s => {
                const d = s.shift_date;
                return d >= format(clampStart, 'yyyy-MM-dd') && d <= format(clampEnd, 'yyyy-MM-dd') && s.notes !== 'LIBRE';
            });

            // Count attendance records that matched a shift
            const presentCount = weekShifts.filter(s =>
                attendance.some(a => a.user_id === s.user_id && a.date === s.shift_date && a.check_in)
            ).length;

            const total = weekShifts.length;
            const pct = total > 0 ? Math.round((presentCount / total) * 100) : 0;

            // Late count
            const tolerance = personalConfig?.late_tolerance_minutes || 5;
            const lateCount = weekShifts.filter(s => {
                const rec = attendance.find(a => a.user_id === s.user_id && a.date === s.shift_date);
                if (!rec?.check_in) return false;
                const diff = (new Date(rec.check_in) - new Date(s.start_time)) / 60000;
                return diff > tolerance;
            }).length;

            return {
                name: `Sem ${idx + 1}`,
                asistencia: pct,
                atrasos: lateCount
            };
        });
    }, [workShifts, attendance, personalConfig]);

    // ─── Próximas vacaciones ───
    const upcomingVacations = useMemo(() => {
        const todayStr = format(now, 'yyyy-MM-dd');
        const abs = laborAbsences || [];
        // Vacations today or in the future
        const upcoming = abs
            .filter(a => a.type === 'vacation' && a.absence_date >= todayStr)
            .sort((a, b) => a.absence_date.localeCompare(b.absence_date));

        // Group by user + group_id
        const grouped = {};
        upcoming.forEach(a => {
            const key = a.group_id || `${a.user_id}_${a.absence_date}`;
            if (!grouped[key]) {
                grouped[key] = {
                    user_id: a.user_id,
                    name: a.name || 'Empleado',
                    start: a.absence_date,
                    end: a.absence_date,
                    days: 0
                };
            }
            grouped[key].days++;
            if (a.absence_date < grouped[key].start) grouped[key].start = a.absence_date;
            if (a.absence_date > grouped[key].end) grouped[key].end = a.absence_date;
        });

        // Add position from staffMembers
        return Object.values(grouped).map(v => {
            const user = staffMembers?.find(u => u.id === v.user_id);
            return { ...v, position: user?.labor_position || '' };
        }).slice(0, 5);
    }, [laborAbsences, staffMembers]);

    // ─── Top empleados con más atrasos ───
    const topLateEmployees = useMemo(() => {
        if (!attendance.length || !workShifts.length) return [];
        const tolerance = personalConfig?.late_tolerance_minutes || 5;
        const lateMap = {};
        for (const rec of attendance) {
            if (!rec.check_in) continue;
            const shift = workShifts.find(s => s.user_id === rec.user_id && s.shift_date === rec.date && s.notes !== 'LIBRE');
            if (!shift) continue;
            const diff = (new Date(rec.check_in) - new Date(shift.start_time)) / 60000;
            if (diff > tolerance) {
                if (!lateMap[rec.user_id]) lateMap[rec.user_id] = { name: rec.name, count: 0, totalMin: 0 };
                lateMap[rec.user_id].count++;
                lateMap[rec.user_id].totalMin += Math.round(diff);
            }
        }
        return Object.entries(lateMap)
            .map(([id, v]) => ({ userId: id, ...v }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [attendance, workShifts, personalConfig]);

    // ─── Ausencias por tipo (para gráfico) ───
    const absenceChartData = useMemo(() => {
        return Object.entries(absenceStats.byType).map(([type, count]) => ({
            name: ABSENCE_LABELS[type] || type,
            cantidad: count
        }));
    }, [absenceStats]);

    const formatCurrency = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0);

    const punctualityDiff = punctualityStats.current - punctualityStats.prev;

    const absenceSubtext = useMemo(() => {
        const parts = [];
        const bt = absenceStats.byType;
        if (bt.medical) parts.push(`${bt.medical} licencia${bt.medical > 1 ? 's' : ''}`);
        if (bt.vacation) parts.push(`${bt.vacation} vacaciones`);
        if (bt.unjustified) parts.push(`${bt.unjustified} injustificada${bt.unjustified > 1 ? 's' : ''}`);
        if (bt.permission) parts.push(`${bt.permission} permiso${bt.permission > 1 ? 's' : ''}`);
        return parts.join(', ') || 'Sin ausencias';
    }, [absenceStats]);

    const StatCard = ({ title, value, subtext, icon: Icon, colorClass }) => (
        <div className="glass-card p-4 flex items-center justify-between">
            <div>
                <p className="text-sm text-[var(--color-text-muted)] font-medium uppercase">{title}</p>
                <p className="text-2xl font-bold text-[var(--color-text)] mt-1">{value}</p>
                {subtext && <p className="text-xs text-[var(--color-text-muted)] mt-1">{subtext}</p>}
            </div>
            <div className={cn("p-3 rounded-xl bg-[var(--glass-bg)]", colorClass)}>
                <Icon size={24} />
            </div>
        </div>
    );

    if (loading) return <div className="p-10 text-center text-[var(--color-text-muted)]">Cargando reportes...</div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Puntualidad Global"
                    value={`${punctualityStats.current}%`}
                    subtext={punctualityDiff !== 0 ? `${punctualityDiff > 0 ? '+' : ''}${punctualityDiff}% vs mes anterior` : 'Igual al mes anterior'}
                    icon={Clock}
                    colorClass={punctualityStats.current >= 90 ? "text-green-400" : punctualityStats.current >= 70 ? "text-amber-400" : "text-red-400"}
                />
                <StatCard
                    title="Ausencias del Mes"
                    value={absenceStats.total}
                    subtext={absenceSubtext}
                    icon={AlertTriangle}
                    colorClass="text-orange-400"
                />
                <StatCard
                    title="Horas Extra Total"
                    value={`${extraHours} hrs`}
                    subtext="Acumulado este mes"
                    icon={TrendingUp}
                    colorClass="text-blue-400"
                />
                <StatCard
                    title="Costo Nómina Est."
                    value={formatCurrency(payrollCost)}
                    subtext={payrollPeriods?.some(p => p.period_start >= monthStart && p.is_closed) ? 'Periodos cerrados' : 'Proyección (bases)'}
                    icon={DollarSign}
                    colorClass="text-purple-400"
                />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Tendencia Asistencia */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <BarChart3 size={20} className="text-[var(--color-primary)]" />
                        Tendencia de Asistencia
                    </h3>
                    <div className="h-[300px] w-full">
                        {weeklyData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={weeklyData}>
                                    <defs>
                                        <linearGradient id="colorAsistencia" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" vertical={false} />
                                    <XAxis dataKey="name" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                                        formatter={(v, name) => [name === 'asistencia' ? `${v}%` : v, name === 'asistencia' ? 'Asistencia' : 'Atrasos']}
                                    />
                                    <Area type="monotone" dataKey="asistencia" stroke="#22c55e" fillOpacity={1} fill="url(#colorAsistencia)" strokeWidth={2} name="asistencia" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-[var(--color-text-muted)]">Sin datos de turnos para este mes</div>
                        )}
                    </div>
                </div>

                {/* Ausencias por tipo */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <CalendarDays size={20} className="text-[var(--color-primary)]" />
                        Ausencias por Tipo
                    </h3>
                    <div className="h-[300px] w-full">
                        {absenceChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={absenceChartData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" horizontal={false} />
                                    <XAxis type="number" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <YAxis type="category" dataKey="name" stroke="var(--color-text-muted)" fontSize={11} tickLine={false} axisLine={false} width={100} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                                    />
                                    <Bar dataKey="cantidad" fill="#f59e0b" radius={[0, 6, 6, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-[var(--color-text-muted)]">Sin ausencias este mes</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top atrasos */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <Activity size={20} className="text-amber-400" />
                        Top Atrasos del Mes
                    </h3>
                    <div className="space-y-3">
                        {topLateEmployees.length > 0 ? topLateEmployees.map((emp, i) => (
                            <div key={emp.userId} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                                    i === 0 ? "bg-red-500/20 text-red-400" : i === 1 ? "bg-amber-500/20 text-amber-400" : "bg-gray-500/20 text-gray-400"
                                )}>
                                    {i + 1}
                                </div>
                                <div className="flex-1">
                                    <p className="font-medium text-[var(--color-text)] text-sm">{emp.name}</p>
                                    <p className="text-xs text-[var(--color-text-muted)]">{emp.totalMin} min acumulados</p>
                                </div>
                                <div className="text-right">
                                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                        {emp.count} atraso{emp.count !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center py-6 text-[var(--color-text-muted)]">Sin atrasos este mes</div>
                        )}
                    </div>
                </div>

                {/* Próximas vacaciones */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <Users size={20} className="text-[var(--color-primary)]" />
                        Próximas Vacaciones
                    </h3>
                    <div className="space-y-3">
                        {upcomingVacations.length > 0 ? upcomingVacations.map((v, i) => (
                            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center text-purple-400 font-bold text-sm">
                                    {v.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="flex-1">
                                    <p className="font-bold text-[var(--color-text)] text-sm">{v.name}</p>
                                    <p className="text-xs text-[var(--color-text-muted)]">{v.position || 'Sin cargo'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-[var(--color-text)] text-sm">
                                        {format(parseISO(v.start), 'dd MMM', { locale: es })}
                                    </p>
                                    <p className="text-xs text-[var(--color-text-muted)]">{v.days} día{v.days !== 1 ? 's' : ''}</p>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center py-6 text-[var(--color-text-muted)]">Sin vacaciones próximas programadas</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportsDashboard;
