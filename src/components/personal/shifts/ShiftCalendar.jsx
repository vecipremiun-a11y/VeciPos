import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    ChevronLeft, ChevronRight, Plus, Sunrise, Sunset, MoonStar, MoveHorizontal, Lock,
    Coffee, CheckCircle2, Clock, XCircle, AlertTriangle, Edit3, UserX, ArrowLeftRight, X
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import ShiftModal from './ShiftModal';
import AbsenceModal, { ABSENCE_TYPES } from '../absences/AbsenceModal';

const getShiftType = (shift) => {
    if (!shift?.start_time) return 'custom';
    // Day off detection
    if (shift.notes === 'LIBRE' || (shift.start_time.includes('T00:00') && shift.end_time.includes('T00:00'))) return 'dayoff';
    const startHour = new Date(shift.start_time).getHours();

    if (startHour >= 6 && startHour < 14) return 'morning';
    if (startHour >= 14 && startHour < 22) return 'afternoon';
    return 'night';
};

// Paisajes SVG de fondo por franja (incrustados como data URI: cero peso extra,
// sin requests). Amanecer, atardecer, noche estrellada y naturaleza para libre.
const svgBg = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const SHIFT_SCENES = {
    morning: svgBg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80' preserveAspectRatio='xMidYMid slice'>
        <defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stop-color='#33507e'/><stop offset='0.45' stop-color='#d97f38'/><stop offset='1' stop-color='#f6c76a'/>
        </linearGradient></defs>
        <rect width='200' height='80' fill='url(#s)'/>
        <circle cx='100' cy='72' r='34' fill='#ffd977' opacity='0.30'/>
        <circle cx='100' cy='72' r='20' fill='#ffe08a'/>
        <path d='M0 66 Q40 56 80 64 T 200 60 V80 H0 Z' fill='#25344a' opacity='0.9'/>
        <path d='M0 74 Q60 66 120 72 T 200 70 V80 H0 Z' fill='#1a2536'/>
    </svg>`),
    afternoon: svgBg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80' preserveAspectRatio='xMidYMid slice'>
        <defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stop-color='#472a6b'/><stop offset='0.5' stop-color='#c14468'/><stop offset='1' stop-color='#f2803f'/>
        </linearGradient></defs>
        <rect width='200' height='80' fill='url(#s)'/>
        <circle cx='140' cy='66' r='30' fill='#ffb45e' opacity='0.35'/>
        <circle cx='140' cy='66' r='16' fill='#ffcf78'/>
        <path d='M0 64 Q50 54 100 62 T 200 58 V80 H0 Z' fill='#2c1a42' opacity='0.9'/>
        <path d='M0 73 Q70 65 140 71 T 200 69 V80 H0 Z' fill='#1f1230'/>
    </svg>`),
    night: svgBg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80' preserveAspectRatio='xMidYMid slice'>
        <defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stop-color='#060b1d'/><stop offset='1' stop-color='#1c2c50'/>
        </linearGradient></defs>
        <rect width='200' height='80' fill='url(#s)'/>
        <circle cx='152' cy='24' r='13' fill='#f2edd8'/>
        <circle cx='158' cy='20' r='11' fill='#0b1329'/>
        <circle cx='152' cy='24' r='18' fill='#f2edd8' opacity='0.12'/>
        <circle cx='30' cy='16' r='1.4' fill='#fff' opacity='0.9'/>
        <circle cx='62' cy='30' r='1' fill='#fff' opacity='0.7'/>
        <circle cx='95' cy='14' r='1.2' fill='#fff' opacity='0.8'/>
        <circle cx='118' cy='40' r='0.9' fill='#fff' opacity='0.6'/>
        <circle cx='48' cy='48' r='0.9' fill='#fff' opacity='0.55'/>
        <circle cx='180' cy='50' r='1.1' fill='#fff' opacity='0.7'/>
        <circle cx='12' cy='36' r='1' fill='#fff' opacity='0.65'/>
        <path d='M0 70 Q60 62 120 68 T 200 66 V80 H0 Z' fill='#0a1122'/>
    </svg>`),
    custom: svgBg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80' preserveAspectRatio='xMidYMid slice'>
        <defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stop-color='#0e3a4f'/><stop offset='1' stop-color='#1d7a8c'/>
        </linearGradient></defs>
        <rect width='200' height='80' fill='url(#s)'/>
        <circle cx='55' cy='20' r='24' fill='#3ec5d8' opacity='0.18'/>
        <path d='M0 68 Q50 60 100 66 T 200 62 V80 H0 Z' fill='#0a2836' opacity='0.9'/>
    </svg>`),
    dayoff: svgBg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 80' preserveAspectRatio='xMidYMid slice'>
        <defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stop-color='#7fc8e8'/><stop offset='0.6' stop-color='#bfe3b4'/><stop offset='1' stop-color='#8fce8f'/>
        </linearGradient></defs>
        <rect width='200' height='80' fill='url(#s)'/>
        <circle cx='165' cy='18' r='11' fill='#ffe98a'/>
        <circle cx='165' cy='18' r='17' fill='#ffe98a' opacity='0.3'/>
        <path d='M0 58 Q45 44 90 56 T 200 50 V80 H0 Z' fill='#3e8e5a'/>
        <path d='M0 70 Q65 58 130 68 T 200 66 V80 H0 Z' fill='#2f6d46'/>
    </svg>`),
};

const shiftTypeStyles = {
    morning: {
        label: 'Mañana',
        icon: Sunrise,
        dot: 'bg-amber-400',
        chip: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40',
        card: 'border border-amber-400/50 shadow-[0_2px_14px_rgba(245,158,11,0.25)]',
    },
    afternoon: {
        label: 'Tarde',
        icon: Sunset,
        dot: 'bg-rose-400',
        chip: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
        card: 'border border-rose-400/50 shadow-[0_2px_14px_rgba(244,63,94,0.25)]',
    },
    night: {
        label: 'Noche',
        icon: MoonStar,
        dot: 'bg-indigo-400',
        chip: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/40',
        card: 'border border-indigo-400/50 shadow-[0_2px_14px_rgba(99,102,241,0.3)]',
    },
    custom: {
        label: 'Turno',
        icon: MoveHorizontal,
        dot: 'bg-cyan-400',
        chip: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40',
        card: 'border border-cyan-400/50 shadow-[0_2px_14px_rgba(6,182,212,0.25)]',
    },
    dayoff: {
        label: 'Libre',
        icon: Coffee,
        dot: 'bg-emerald-400',
        chip: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
        card: 'border border-emerald-400/50 shadow-[0_2px_14px_rgba(16,185,129,0.25)]',
    }
};

const remapShiftToCell = (shift, newUserId, newDate) => {
    const originalStart = new Date(shift.start_time);
    const originalEnd = new Date(shift.end_time);
    // Comparar fechas en hora LOCAL: con toISOString() (UTC) un turno que termina
    // 23:00 en UTC-4 parecía cruzar al día siguiente y se movía con +1 día.
    const overnight = originalEnd <= originalStart || format(originalEnd, 'yyyy-MM-dd') !== format(originalStart, 'yyyy-MM-dd');

    const startTime = format(originalStart, 'HH:mm:ss');
    const endTime = format(originalEnd, 'HH:mm:ss');
    const startISO = `${newDate}T${startTime}`;

    const endDate = new Date(`${newDate}T00:00:00`);
    if (overnight) endDate.setDate(endDate.getDate() + 1);
    const endDateStr = format(endDate, 'yyyy-MM-dd');
    const endISO = `${endDateStr}T${endTime}`;

    return {
        user_id: newUserId,
        shift_date: newDate,
        start_time: startISO,
        end_time: endISO,
        notes: shift.notes || '',
        branch: shift.branch || 'Principal'
    };
};

const ShiftCalendar = () => {
    const {
        workShifts,
        fetchShifts,
        fetchAttendanceByRangeRaw,
        fetchAbsences,
        createShift,
        deleteShift,
        staffMembers,
        fetchStaffMembers,
        hasPermission
    } = useStore();

    const canEditPast = hasPermission('personal.edit_past_shifts');

    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(false);
    const [attendanceRange, setAttendanceRange] = useState([]);
    const [absencesRange, setAbsencesRange] = useState([]);
    const [dragData, setDragData] = useState(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedShift, setSelectedShift] = useState(null);
    const [modalUser, setModalUser] = useState(null);
    const [modalDate, setModalDate] = useState(null);
    const [modalLockInfo, setModalLockInfo] = useState({ isLocked: false, isPast: false, isToday: false, hasRealAttendance: false });

    // Menú rápido de celda + ausencia precargada + diálogo de intercambio
    const [quickMenu, setQuickMenu] = useState(null);       // { user, dateStr, shift }
    const [absencePrefill, setAbsencePrefill] = useState(null); // { user_id, absence_date }
    const [swapSource, setSwapSource] = useState(null);     // { shift, userId, dateStr }
    const [swapTarget, setSwapTarget] = useState({ userId: '', dateStr: '' });

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

    useEffect(() => {
        fetchStaffMembers();
    }, []);

    useEffect(() => {
        loadShifts();
    }, [currentDate]);

    const loadShifts = async () => {
        setLoading(true);
        const startDate = format(weekStart, 'yyyy-MM-dd');
        const endDate = format(weekEnd, 'yyyy-MM-dd');

        const [, attendance, absences] = await Promise.all([
            fetchShifts(startDate, endDate),
            fetchAttendanceByRangeRaw(startDate, endDate),
            fetchAbsences(startDate, endDate)
        ]);

        setAttendanceRange(attendance || []);
        setAbsencesRange(absences || []);
        setLoading(false);
    };

    // Solo mostramos estados de asistencia (Falta/Atraso/Real) cuando hay al menos
    // un marcaje en la semana: si el kiosco no se usa, el calendario queda limpio.
    const weekHasAttendance = useMemo(
        () => attendanceRange.some(a => a.type === 'entry' || a.type === 'exit'),
        [attendanceRange]
    );

    // Cobertura por día: cuántas personas hay en cada franja
    const coverageByDay = useMemo(() => weekDays.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const counts = { morning: 0, afternoon: 0, night: 0, custom: 0, total: 0 };
        for (const shift of workShifts) {
            if (shift.shift_date !== dateStr) continue;
            const type = getShiftType(shift);
            if (type === 'dayoff') continue;
            counts[type] += 1;
            counts.total += 1;
        }
        return counts;
    }), [workShifts, weekDays.map(d => d.toISOString()).join()]);

    // Horas asignadas en la semana por empleado (excluye días libres)
    const weeklyHoursByUser = useMemo(() => {
        const startStr = format(weekStart, 'yyyy-MM-dd');
        const endStr = format(weekEnd, 'yyyy-MM-dd');
        const totals = new Map();
        for (const shift of workShifts) {
            if (shift.shift_date < startStr || shift.shift_date > endStr) continue;
            if (getShiftType(shift) === 'dayoff') continue;
            const hours = Math.max(0, (new Date(shift.end_time) - new Date(shift.start_time)) / 3600000);
            totals.set(shift.user_id, (totals.get(shift.user_id) || 0) + hours);
        }
        return totals;
    }, [workShifts, currentDate]);

    const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

    const openShiftEditor = (user, dateStr) => {
        const shift = workShifts.find(s =>
            s.user_id === user.id &&
            s.shift_date === dateStr
        );

        // Compute lock info for modal
        const today = format(new Date(), 'yyyy-MM-dd');
        const isPast = dateStr < today;
        const isToday = dateStr === today;

        const attendanceDay = attendanceRange.filter(a =>
            a.user_id === user.id && a.date === dateStr
        );
        const hasRealAttendance = attendanceDay.some(a => a.type === 'entry' || a.type === 'exit');

        const isLocked = canEditPast
            ? false
            : hasRealAttendance
                ? true
                : isPast;

        setSelectedShift(shift || null);
        setModalUser(user.id);
        setModalDate(dateStr);
        setModalLockInfo({ isLocked, isPast, isToday, hasRealAttendance });
        setIsModalOpen(true);
    };

    const handleCellClick = (user, day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const shift = workShifts.find(s => s.user_id === user.id && s.shift_date === dateStr);
        if (shift) {
            setQuickMenu({ user, dateStr, shift });
        } else {
            openShiftEditor(user, dateStr);
        }
    };

    // Mueve o intercambia un turno entre celdas (usado por drag&drop y por el diálogo)
    const applyShiftTransfer = async (sourceShift, sourceUserId, sourceDate, targetUserId, targetDate) => {
        const targetShift = workShifts.find((s) => s.user_id === targetUserId && s.shift_date === targetDate);
        const sourceUser = staffMembers.find((u) => u.id === sourceUserId);
        const targetUser = staffMembers.find((u) => u.id === targetUserId);
        const confirmMessage = targetShift
            ? `Se intercambiara el turno de ${sourceUser?.name || 'Empleado'} con ${targetUser?.name || 'Empleado'}. Esta accion queda como autorizada desde Gestion de Personal. Continuar?`
            : `Se movera el turno de ${sourceUser?.name || 'Empleado'} a ${targetUser?.name || 'Empleado'} en ${targetDate}. Continuar?`;

        if (!window.confirm(confirmMessage)) return false;

        setLoading(true);
        try {
            const sourceToTarget = remapShiftToCell(sourceShift, targetUserId, targetDate);
            const sourceWrite = await createShift(sourceToTarget);

            if (!sourceWrite.success) {
                throw new Error(sourceWrite.error || 'No se pudo mover/intercambiar el turno origen.');
            }

            if (targetShift) {
                const targetToSource = remapShiftToCell(targetShift, sourceUserId, sourceDate);
                const targetWrite = await createShift(targetToSource);
                if (!targetWrite.success) {
                    throw new Error(targetWrite.error || 'No se pudo completar el intercambio.');
                }
            } else {
                await deleteShift(sourceShift.id);
            }

            await loadShifts();
            return true;
        } catch (error) {
            alert(error.message || 'No fue posible aplicar el cambio de turno.');
            return false;
        } finally {
            setLoading(false);
        }
    };

    const handleDragStart = (e, shift, userId, dateStr) => {
        e.stopPropagation();
        setDragData({
            sourceShiftId: shift.id,
            sourceUserId: userId,
            sourceDate: dateStr
        });
    };

    const handleDrop = async (e, targetUserId, targetDate) => {
        e.preventDefault();
        e.stopPropagation();

        if (!dragData) return;

        // Block drops on past dates and today (unless admin override)
        const today = format(new Date(), 'yyyy-MM-dd');
        if (targetDate <= today && !canEditPast) {
            setDragData(null);
            return;
        }

        const { sourceShiftId, sourceUserId, sourceDate } = dragData;

        if (sourceUserId === targetUserId && sourceDate === targetDate) {
            setDragData(null);
            return;
        }

        const sourceShift = workShifts.find((s) => s.id === sourceShiftId);
        if (!sourceShift) {
            setDragData(null);
            return;
        }

        await applyShiftTransfer(sourceShift, sourceUserId, sourceDate, targetUserId, targetDate);
        setDragData(null);
    };

    // Convierte la celda en día libre (LIBRE 00:00-00:00, mismo criterio que getShiftType)
    const markDayOff = async (userId, dateStr) => {
        if (!window.confirm('¿Marcar este día como libre/descanso?')) return;
        setLoading(true);
        const result = await createShift({
            user_id: userId,
            shift_date: dateStr,
            start_time: `${dateStr}T00:00:00`,
            end_time: `${dateStr}T00:00:00`,
            notes: 'LIBRE',
            branch: 'Principal',
        });
        if (!result.success) alert(result.error || 'No se pudo marcar el día libre.');
        await loadShifts();
        setLoading(false);
    };

    const confirmSwap = async () => {
        if (!swapSource || !swapTarget.userId || !swapTarget.dateStr) return;
        const done = await applyShiftTransfer(
            swapSource.shift, swapSource.userId, swapSource.dateStr,
            Number(swapTarget.userId), swapTarget.dateStr
        );
        if (done) setSwapSource(null);
    };

    const todayStr = format(new Date(), 'yyyy-MM-dd');

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-[var(--color-surface)] p-1 rounded-lg border border-[var(--glass-border)]">
                        <button onClick={handlePrevWeek} className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <ChevronLeft size={20} />
                        </button>
                        <span className="font-bold text-[var(--color-text)] px-2 min-w-[140px] text-center capitalize">
                            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d', { locale: es })}
                        </span>
                        <button onClick={handleNextWeek} className="p-1 hover:bg-[var(--glass-bg)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                    <button onClick={() => setCurrentDate(new Date())} className="text-xs font-medium text-[var(--color-primary)] hover:underline">
                        Hoy
                    </button>
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                    <button
                        onClick={() => {
                            setSelectedShift(null);
                            setModalUser(null);
                            setModalDate(format(new Date(), 'yyyy-MM-dd'));
                            setIsModalOpen(true);
                        }}
                        className="flex-1 md:flex-none btn-primary flex items-center justify-center gap-2 text-sm"
                    >
                        <Plus size={16} />
                        Asignar Horario Fijo
                    </button>
                </div>
            </div>

            {/* Leyenda + ayuda */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
                {['morning', 'afternoon', 'night', 'dayoff'].map(type => {
                    const meta = shiftTypeStyles[type];
                    const Icon = meta.icon;
                    return (
                        <span key={type} className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium', meta.chip)}>
                            <Icon size={11} /> {meta.label}
                        </span>
                    );
                })}
                <span className="text-[var(--color-text-muted)] ml-2">
                    Click en un turno = editar, ausencia o intercambio · Arrastra una tarjeta para mover rápido.
                </span>
            </div>

            {/* Calendar Grid */}
            <div className="glass-card p-0 overflow-x-auto">
                <table className="w-full min-w-[800px] border-collapse">
                    <thead>
                        <tr className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                            <th className="p-4 w-40 text-left text-xs font-bold text-[var(--color-text-muted)] uppercase sticky left-0 bg-[var(--glass-bg)] z-10 border-r border-[var(--glass-border)]">
                                Empleado
                            </th>
                            {weekDays.map(day => (
                                <th key={day.toISOString()} className={cn(
                                    "p-3 text-center text-xs font-bold uppercase min-w-[100px] border-l border-[var(--glass-border)]",
                                    isSameDay(day, new Date()) ? "text-[var(--color-primary)] bg-[var(--color-primary)]/5" : "text-[var(--color-text-muted)]"
                                )}>
                                    <div className="mb-1">{format(day, 'EEE', { locale: es })}</div>
                                    <div className="text-lg">{format(day, 'd')}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--glass-border)]">
                        {staffMembers.map(user => (
                            <tr key={user.id} className="hover:bg-[var(--color-surface)]/30 transition-colors">
                                <td className="p-4 sticky left-0 bg-[var(--color-background)] z-10 border-r border-[var(--glass-border)]">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-[var(--color-primary)] font-bold text-xs ring-1 ring-[var(--glass-border)]">
                                            {user.name[0]}
                                        </div>
                                        <div>
                                            <p className="font-medium text-sm text-[var(--color-text)]">{user.name}</p>
                                            <p className="text-[10px] text-[var(--color-text-muted)]">
                                                {user.labor_position || 'Sin cargo'}
                                                {weeklyHoursByUser.has(user.id) && (
                                                    <span className="ml-1.5 text-[var(--color-primary)] font-semibold">
                                                        · {Math.round(weeklyHoursByUser.get(user.id))} h/sem
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                {weekDays.map(day => {
                                    const dateStr = format(day, 'yyyy-MM-dd');
                                    const shift = workShifts.find(s =>
                                        s.user_id === user.id &&
                                        s.shift_date === dateStr
                                    );

                                    const attendanceDay = attendanceRange.filter(a =>
                                        a.user_id === user.id &&
                                        a.date === dateStr
                                    );

                                    const sortedAttendance = [...attendanceDay].sort((a, b) =>
                                        new Date(a.recorded_at) - new Date(b.recorded_at)
                                    );

                                    const firstEntry = sortedAttendance.find(a => a.type === 'entry');
                                    const lastExit = [...sortedAttendance].reverse().find(a => a.type === 'exit');

                                    const isOvernightShift = shift
                                        ? format(new Date(shift.end_time), 'yyyy-MM-dd') !== shift.shift_date
                                        : false;

                                    let overnightExit = null;
                                    if (isOvernightShift && !lastExit) {
                                        const nextDay = addDays(day, 1);
                                        const nextDayStr = format(nextDay, 'yyyy-MM-dd');
                                        const nextDayAttendance = attendanceRange
                                            .filter(a => a.user_id === user.id && a.date === nextDayStr && a.type === 'exit')
                                            .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

                                        overnightExit = nextDayAttendance[0] || null;
                                    }

                                    const displayExit = lastExit || overnightExit;

                                    const realSchedule = firstEntry || displayExit;
                                    const hasRealAttendance = !!(firstEntry || displayExit);
                                    const shiftType = getShiftType(shift);

                                    // Absence for this user on this date
                                    const absence = absencesRange.find(a =>
                                        a.user_id === user.id && a.absence_date === dateStr
                                    );
                                    const absenceMeta = absence ? ABSENCE_TYPES.find(t => t.value === absence.type) : null;
                                    const shiftMeta = shiftTypeStyles[shiftType] || shiftTypeStyles.custom;

                                    // Lock logic
                                    const isPast = dateStr < todayStr;
                                    const isToday = dateStr === todayStr;
                                    const isFuture = dateStr > todayStr;

                                    // PRO rule: real attendance = always locked (unless admin)
                                    const isLocked = canEditPast
                                        ? false
                                        : hasRealAttendance
                                            ? true
                                            : isPast;

                                    const isDraggable = !!shift && !isLocked && isFuture;

                                    // --- Attendance status ---
                                    // Falta/Atraso solo se evalúan si la semana tiene marcajes reales;
                                    // sin kiosco activo el calendario no acusa faltas falsas.
                                    const isDayOff = shiftType === 'dayoff';
                                    let attendanceStatus = null; // null = no status (future / no shift)
                                    if (absence && absence.status === 'approved') {
                                        attendanceStatus = 'justified'; // approved absence overrides any check
                                    } else if (isDayOff) {
                                        attendanceStatus = 'dayoff';
                                    } else if (shift && (isPast || isToday) && weekHasAttendance) {
                                        if (firstEntry && displayExit) {
                                            const entryTime = new Date(firstEntry.recorded_at);
                                            const shiftStart = new Date(shift.start_time);
                                            attendanceStatus = (entryTime - shiftStart) > 5 * 60 * 1000 ? 'late' : 'present';
                                        } else if (firstEntry && !displayExit) {
                                            attendanceStatus = 'incomplete';
                                        } else if (!firstEntry && isPast) {
                                            attendanceStatus = absence ? 'justified' : 'absent';
                                        }
                                    }

                                    // onImage: variante clara para badges sobre el paisaje de fondo
                                    const statusConfig = {
                                        present:    { icon: CheckCircle2,   label: 'Asistió',      color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15', onImage: 'text-emerald-300' },
                                        late:       { icon: Clock,          label: 'Atraso',       color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/15',   onImage: 'text-amber-300' },
                                        absent:     { icon: XCircle,        label: 'Falta',        color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/15',     onImage: 'text-red-300' },
                                        incomplete: { icon: AlertTriangle,  label: 'Incompleto',   color: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-500/15',  onImage: 'text-orange-300' },
                                        dayoff:     { icon: Coffee,         label: 'Descanso',     color: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-500/10',    onImage: 'text-gray-200' },
                                        justified:  { icon: CheckCircle2,   label: absenceMeta?.label || 'Ausencia', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/15', onImage: 'text-purple-300' },
                                    };
                                    const statusMeta = attendanceStatus ? statusConfig[attendanceStatus] : null;
                                    const StatusIcon = statusMeta?.icon;

                                    // Tooltip
                                    const cellTitle = canEditPast && (isPast || hasRealAttendance)
                                        ? '✏️ Edición habilitada por permisos de admin'
                                        : isPast && isLocked
                                            ? '🔒 Turno bloqueado (fecha pasada)'
                                            : isToday && hasRealAttendance && isLocked
                                                ? '🔒 No editable, ya tiene asistencia'
                                                : '';

                                    return (
                                        <td
                                            key={day.toISOString()}
                                            className="p-1 border-l border-[var(--glass-border)] relative"
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleDrop(e, user.id, dateStr)}
                                            onClick={() => handleCellClick(user, day)}
                                        >
                                            <div
                                                draggable={isDraggable}
                                                onDragStart={(e) => isDraggable && handleDragStart(e, shift, user.id, dateStr)}
                                                title={cellTitle}
                                                style={shift ? {
                                                    backgroundImage: SHIFT_SCENES[shiftType] || SHIFT_SCENES.custom,
                                                    backgroundSize: 'cover',
                                                    backgroundPosition: 'center',
                                                } : undefined}
                                                className={cn(
                                                "w-full rounded-lg flex flex-col items-center justify-center transition-colors border relative overflow-hidden min-h-[64px] py-2 px-1",
                                                isToday && "ring-2 ring-yellow-400/50",
                                                shift
                                                    ? cn(
                                                        shiftMeta.card,
                                                        isLocked
                                                            ? "opacity-50 cursor-not-allowed"
                                                            : isFuture ? "cursor-grab active:cursor-grabbing hover:brightness-110" : "cursor-pointer hover:brightness-110"
                                                    )
                                                    : realSchedule
                                                        ? cn(
                                                            "bg-emerald-500/10 border-l-4 border-l-emerald-400 border-y border-r border-emerald-500/20 text-emerald-600 dark:text-emerald-300",
                                                            isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                                                        )
                                                        : absence
                                                            ? "bg-purple-500/10 border-purple-400/30 cursor-pointer"
                                                            : "hover:bg-[var(--glass-bg)] hover:border-[var(--glass-border)] border-transparent cursor-pointer"
                                            )}>
                                                {/* Velo sutil para que el texto se lea sobre el paisaje */}
                                                {shift && (
                                                    <span className="absolute inset-0 bg-black/20 pointer-events-none" aria-hidden="true" />
                                                )}
                                                {/* Lock icon for locked shifts */}
                                                {isLocked && shift && (
                                                    <Lock size={10} className="absolute top-1 right-1 text-gray-400 dark:text-white/30" />
                                                )}
                                                {shift || realSchedule ? (
                                                    <>
                                                        {shift && (
                                                            shiftType === 'dayoff' ? (
                                                                <span className="relative text-xs font-bold flex items-center gap-1 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                                                                    <Coffee size={12} /> Descanso
                                                                </span>
                                                            ) : (
                                                                <span className="relative text-sm font-bold tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                                                                    {format(new Date(shift.start_time), 'HH:mm')}
                                                                    <span className="text-white/80 font-medium">–{format(new Date(shift.end_time), 'HH:mm')}</span>
                                                                </span>
                                                            )
                                                        )}

                                                        {/* Marcaje real: solo cuando existe */}
                                                        {hasRealAttendance && shiftType !== 'dayoff' && (
                                                            <span className={cn(
                                                                "relative text-[9px] mt-0.5 font-mono",
                                                                shift ? "text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" : "text-gray-500 dark:text-white/50"
                                                            )}>
                                                                Real: {firstEntry ? format(new Date(firstEntry.recorded_at), 'HH:mm') : '--:--'} / {displayExit ? format(new Date(displayExit.recorded_at), 'HH:mm') : '--:--'}
                                                            </span>
                                                        )}

                                                        {/* Attendance status badge */}
                                                        {statusMeta && attendanceStatus !== 'dayoff' && (
                                                            <span className={cn(
                                                                "relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold leading-none mt-1",
                                                                shift ? cn("bg-black/40 backdrop-blur-sm", statusMeta.onImage) : cn(statusMeta.bg, statusMeta.color)
                                                            )}>
                                                                <StatusIcon size={8} />
                                                                {statusMeta.label}
                                                                {attendanceStatus === 'late' && firstEntry && (
                                                                    <span className="font-mono ml-0.5">
                                                                        {format(new Date(firstEntry.recorded_at), 'HH:mm')}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        )}
                                                    </>
                                                ) : absence ? (
                                                    <div className="flex flex-col items-center gap-1 py-1">
                                                        <span className="text-lg">{absenceMeta?.emoji || '📋'}</span>
                                                        <span className={cn("text-[9px] font-bold leading-tight text-center", absenceMeta ? absenceMeta.color.split(' ')[1] || 'text-purple-600 dark:text-purple-400' : '')}>
                                                            {absenceMeta?.label || 'Ausencia'}
                                                        </span>
                                                        {absence.half_day ? (
                                                            <span className="text-[8px] text-[var(--color-text-muted)]">½ {absence.half_day_period === 'morning' ? 'AM' : 'PM'}</span>
                                                        ) : absence.hours ? (
                                                            <span className="text-[8px] text-[var(--color-text-muted)]">{absence.hours}h</span>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <Plus className="text-[var(--color-text-muted)] opacity-0 hover:opacity-100 transition-opacity" size={14} />
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                    {/* Cobertura por día */}
                    {staffMembers.length > 0 && (
                        <tfoot>
                            <tr className="bg-[var(--glass-bg)] border-t-2 border-[var(--glass-border)]">
                                <td className="p-3 sticky left-0 bg-[var(--glass-bg)] z-10 border-r border-[var(--glass-border)] text-[10px] font-bold text-[var(--color-text-muted)] uppercase">
                                    Cobertura
                                </td>
                                {coverageByDay.map((counts, index) => (
                                    <td key={index} className="p-2 border-l border-[var(--glass-border)] text-center">
                                        {counts.total === 0 ? (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-red-500 dark:text-red-400">
                                                <AlertTriangle size={10} /> Sin cobertura
                                            </span>
                                        ) : (
                                            <div className="flex items-center justify-center gap-2 text-[10px] font-semibold">
                                                {['morning', 'afternoon', 'night', 'custom'].map(type => (
                                                    counts[type] > 0 && (
                                                        <span key={type} className="inline-flex items-center gap-1 text-[var(--color-text)]">
                                                            <i className={cn('w-2 h-2 rounded-full inline-block', shiftTypeStyles[type].dot)} />
                                                            {counts[type]}
                                                        </span>
                                                    )
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    )}
                </table>
                {staffMembers.length === 0 && (
                    <div className="p-8 text-center text-[var(--color-text-muted)]">
                        No hay personal registrado para asignar turnos.
                    </div>
                )}
            </div>

            {loading && (
                <div className="text-sm text-[var(--color-text-muted)]">Cargando turnos y asistencias...</div>
            )}

            {/* Menú rápido de celda */}
            {quickMenu && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setQuickMenu(null)}>
                    <div className="glass-card w-full max-w-xs p-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
                            <div>
                                <p className="font-bold text-sm text-[var(--color-text)]">{quickMenu.user.name}</p>
                                <p className="text-[11px] text-[var(--color-text-muted)] capitalize">
                                    {format(new Date(`${quickMenu.dateStr}T12:00:00`), "EEEE d 'de' MMMM", { locale: es })}
                                </p>
                            </div>
                            <button onClick={() => setQuickMenu(null)} className="p-1 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-2">
                            <button
                                onClick={() => { openShiftEditor(quickMenu.user, quickMenu.dateStr); setQuickMenu(null); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--glass-bg)] text-sm text-[var(--color-text)] text-left"
                            >
                                <Edit3 size={16} className="text-cyan-400" /> Editar turno
                            </button>
                            <button
                                onClick={() => { setAbsencePrefill({ user_id: quickMenu.user.id, absence_date: quickMenu.dateStr }); setQuickMenu(null); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--glass-bg)] text-sm text-[var(--color-text)] text-left"
                            >
                                <UserX size={16} className="text-purple-400" /> Marcar ausencia / enfermedad
                            </button>
                            {(quickMenu.dateStr > todayStr || canEditPast) && (
                                <button
                                    onClick={() => {
                                        setSwapSource({ shift: quickMenu.shift, userId: quickMenu.user.id, dateStr: quickMenu.dateStr });
                                        setSwapTarget({ userId: '', dateStr: quickMenu.dateStr });
                                        setQuickMenu(null);
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--glass-bg)] text-sm text-[var(--color-text)] text-left"
                                >
                                    <ArrowLeftRight size={16} className="text-amber-400" /> Intercambiar / mover turno
                                </button>
                            )}
                            {getShiftType(quickMenu.shift) !== 'dayoff' && (quickMenu.dateStr >= todayStr || canEditPast) && (
                                <button
                                    onClick={() => { markDayOff(quickMenu.user.id, quickMenu.dateStr); setQuickMenu(null); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--glass-bg)] text-sm text-[var(--color-text)] text-left"
                                >
                                    <Coffee size={16} className="text-emerald-400" /> Marcar día libre
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Diálogo de intercambio / movimiento */}
            {swapSource && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSwapSource(null)}>
                    <div className="glass-card w-full max-w-sm p-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
                            <h3 className="font-bold text-sm text-[var(--color-text)] flex items-center gap-2">
                                <ArrowLeftRight size={16} className="text-amber-400" /> Intercambiar / mover turno
                            </h3>
                            <button onClick={() => setSwapSource(null)} className="p-1 rounded-full hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-4 space-y-4 text-sm">
                            <p className="text-xs text-[var(--color-text-muted)]">
                                Turno de <strong className="text-[var(--color-text)]">{staffMembers.find(u => u.id === swapSource.userId)?.name}</strong> el {swapSource.dateStr}.
                                Si el destino ya tiene turno, se intercambian; si está vacío, se mueve.
                            </p>
                            <label className="block space-y-1.5">
                                <span className="text-xs text-[var(--color-text-muted)] uppercase font-medium">Con quién</span>
                                <select
                                    className="glass-input w-full bg-[var(--color-surface)]"
                                    value={swapTarget.userId}
                                    onChange={e => setSwapTarget({ ...swapTarget, userId: e.target.value })}
                                >
                                    <option value="">Seleccione empleado...</option>
                                    {staffMembers.map(u => (
                                        <option key={u.id} value={u.id}>{u.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block space-y-1.5">
                                <span className="text-xs text-[var(--color-text-muted)] uppercase font-medium">Qué día</span>
                                <select
                                    className="glass-input w-full bg-[var(--color-surface)]"
                                    value={swapTarget.dateStr}
                                    onChange={e => setSwapTarget({ ...swapTarget, dateStr: e.target.value })}
                                >
                                    {weekDays
                                        .map(day => format(day, 'yyyy-MM-dd'))
                                        .filter(ds => canEditPast || ds > todayStr)
                                        .map(ds => (
                                            <option key={ds} value={ds}>
                                                {format(new Date(`${ds}T12:00:00`), 'EEEE d MMM', { locale: es })}
                                            </option>
                                        ))}
                                </select>
                            </label>
                        </div>
                        <div className="p-4 border-t border-[var(--glass-border)] flex justify-end gap-2">
                            <button onClick={() => setSwapSource(null)} className="px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] text-sm">
                                Cancelar
                            </button>
                            <button
                                onClick={confirmSwap}
                                disabled={!swapTarget.userId || !swapTarget.dateStr || loading}
                                className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-bold text-sm disabled:opacity-40"
                            >
                                Aplicar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AbsenceModal
                isOpen={!!absencePrefill}
                onClose={() => setAbsencePrefill(null)}
                onSuccess={loadShifts}
                editData={absencePrefill}
            />

            <ShiftModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                shiftData={selectedShift}
                selectedDate={modalDate}
                selectedUser={modalUser}
                onSuccess={loadShifts}
                isLocked={modalLockInfo.isLocked}
                isPast={modalLockInfo.isPast}
                isToday={modalLockInfo.isToday}
                hasRealAttendance={modalLockInfo.hasRealAttendance}
            />
        </div>
    );
};

export default ShiftCalendar;
