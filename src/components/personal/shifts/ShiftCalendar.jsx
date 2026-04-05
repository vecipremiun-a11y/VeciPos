import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Sunrise, Sunset, MoonStar, MoveHorizontal, Lock, Coffee, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import ShiftModal from './ShiftModal';
import { ABSENCE_TYPES } from '../absences/AbsenceModal';

const getShiftType = (shift) => {
    if (!shift?.start_time) return 'custom';
    // Day off detection
    if (shift.notes === 'LIBRE' || (shift.start_time.includes('T00:00') && shift.end_time.includes('T00:00'))) return 'dayoff';
    const startHour = new Date(shift.start_time).getHours();

    if (startHour >= 6 && startHour < 14) return 'morning';
    if (startHour >= 14 && startHour < 22) return 'afternoon';
    return 'night';
};

const shiftTypeStyles = {
    morning: {
        label: 'Mañana',
        icon: Sunrise,
        chip: 'bg-amber-500/25 text-amber-700 dark:text-amber-300 border-amber-500/50',
        card: 'bg-gradient-to-br from-amber-100 via-amber-50 to-yellow-50 dark:from-yellow-500/25 dark:via-amber-500/15 dark:to-yellow-600/5 border-amber-400 dark:border-yellow-400/40 shadow-[0_4px_15px_rgba(245,158,11,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(234,179,8,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-amber-700 dark:text-yellow-300',
        glow: 'hover:shadow-[0_6px_20px_rgba(245,158,11,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(234,179,8,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    afternoon: {
        label: 'Tarde',
        icon: Sunset,
        chip: 'bg-rose-500/25 text-rose-700 dark:text-rose-300 border-rose-500/50',
        card: 'bg-gradient-to-br from-orange-100 via-orange-50 to-rose-50 dark:from-rose-500/25 dark:via-pink-500/15 dark:to-rose-600/5 border-orange-400 dark:border-rose-400/40 shadow-[0_4px_15px_rgba(249,115,22,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(244,63,94,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-orange-700 dark:text-rose-300',
        glow: 'hover:shadow-[0_6px_20px_rgba(249,115,22,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(244,63,94,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    night: {
        label: 'Noche',
        icon: MoonStar,
        chip: 'bg-indigo-500/25 text-indigo-700 dark:text-indigo-300 border-indigo-500/50',
        card: 'bg-gradient-to-br from-indigo-100 via-indigo-50 to-violet-50 dark:from-indigo-500/25 dark:via-purple-500/15 dark:to-violet-600/5 border-indigo-400 dark:border-indigo-400/40 shadow-[0_4px_15px_rgba(99,102,241,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(99,102,241,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-indigo-700 dark:text-indigo-300',
        glow: 'hover:shadow-[0_6px_20px_rgba(99,102,241,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(99,102,241,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    custom: {
        label: 'Turno',
        icon: MoveHorizontal,
        chip: 'bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border-cyan-500/50',
        card: 'bg-gradient-to-br from-cyan-100 via-cyan-50 to-blue-50 dark:from-cyan-500/25 dark:via-teal-500/15 dark:to-cyan-600/5 border-cyan-400 dark:border-cyan-400/40 shadow-[0_4px_15px_rgba(6,182,212,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(6,182,212,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-cyan-700 dark:text-cyan-300',
        glow: 'hover:shadow-[0_6px_20px_rgba(6,182,212,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(6,182,212,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    dayoff: {
        label: 'Libre',
        icon: Coffee,
        chip: 'bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 border-emerald-500/50',
        card: 'bg-gradient-to-br from-emerald-100 via-green-50 to-emerald-50 dark:from-emerald-500/20 dark:via-green-500/10 dark:to-emerald-600/5 border-emerald-400 dark:border-emerald-400/40 shadow-[0_4px_15px_rgba(16,185,129,0.15),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(16,185,129,0.15),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-emerald-700 dark:text-emerald-300',
        glow: 'hover:shadow-[0_6px_20px_rgba(16,185,129,0.25),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(16,185,129,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]',
    }
};

const remapShiftToCell = (shift, newUserId, newDate) => {
    const originalStart = new Date(shift.start_time);
    const originalEnd = new Date(shift.end_time);
    const overnight = originalEnd <= originalStart || originalEnd.toISOString().slice(0, 10) !== originalStart.toISOString().slice(0, 10);

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

    const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

    const handleCellClick = (user, day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
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
        const targetShift = workShifts.find((s) => s.user_id === targetUserId && s.shift_date === targetDate);

        if (!sourceShift) {
            setDragData(null);
            return;
        }

        const sourceUser = staffMembers.find((u) => u.id === sourceUserId);
        const targetUser = staffMembers.find((u) => u.id === targetUserId);
        const confirmMessage = targetShift
            ? `Se intercambiara el turno de ${sourceUser?.name || 'Empleado'} con ${targetUser?.name || 'Empleado'}. Esta accion queda como autorizada desde Gestion de Personal. Continuar?`
            : `Se movera el turno de ${sourceUser?.name || 'Empleado'} a ${targetUser?.name || 'Empleado'} en ${targetDate}. Continuar?`;

        if (!window.confirm(confirmMessage)) {
            setDragData(null);
            return;
        }

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
        } catch (error) {
            alert(error.message || 'No fue posible aplicar el cambio de turno.');
        } finally {
            setLoading(false);
            setDragData(null);
        }
    };

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

            <div className="text-sm text-[var(--color-text-muted)]">
                Configura turnos rotativos, identifica manana/tarde/noche y arrastra una celda con turno para mover o intercambiar con otra trabajadora.
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
                                            <p className="text-[10px] text-[var(--color-text-muted)]">{user.labor_position || 'Sin cargo'}</p>
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
                                        ? new Date(shift.end_time).toISOString().slice(0, 10) !== shift.shift_date
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
                                    const ShiftTypeIcon = shiftMeta.icon;

                                    // Lock logic
                                    const today = format(new Date(), 'yyyy-MM-dd');
                                    const isPast = dateStr < today;
                                    const isToday = dateStr === today;
                                    const isFuture = dateStr > today;

                                    // PRO rule: real attendance = always locked (unless admin)
                                    const isLocked = canEditPast
                                        ? false
                                        : hasRealAttendance
                                            ? true
                                            : isPast;

                                    const isDraggable = !!shift && !isLocked && isFuture;

                                    // --- Attendance status ---
                                    const isDayOff = shiftType === 'dayoff';
                                    let attendanceStatus = null; // null = no status (future / no shift)
                                    if (absence && absence.status === 'approved') {
                                        attendanceStatus = 'justified'; // approved absence overrides any check
                                    } else if (isDayOff) {
                                        attendanceStatus = 'dayoff';
                                    } else if (shift && (isPast || isToday)) {
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

                                    const statusConfig = {
                                        present:    { icon: CheckCircle2,   label: 'Asistió',      color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
                                        late:       { icon: Clock,          label: 'Atraso',       color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/15' },
                                        absent:     { icon: XCircle,        label: 'Falta',        color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/15' },
                                        incomplete: { icon: AlertTriangle,  label: 'Incompleto',   color: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-500/15' },
                                        dayoff:     { icon: Coffee,         label: 'Descanso',     color: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-500/10' },
                                        justified:  { icon: CheckCircle2,   label: absenceMeta?.label || 'Ausencia', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/15' },
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
                                                className={cn(
                                                "w-full rounded-xl flex flex-col items-center justify-center transition-all duration-300 border relative",
                                                // Today ring
                                                isToday && "ring-2 ring-yellow-400/60",
                                                shift
                                                    ? cn(
                                                        shiftMeta.card,
                                                        isLocked
                                                            ? "opacity-50 grayscale cursor-not-allowed"
                                                            : cn(shiftMeta.glow, isFuture ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"),
                                                        "py-2 px-1"
                                                    )
                                                    : realSchedule
                                                        ? cn(
                                                            "bg-gradient-to-br from-emerald-500/15 to-teal-600/5 border-emerald-400/25 text-emerald-300 py-2 px-1 shadow-[0_4px_12px_rgba(16,185,129,0.1)]",
                                                            isLocked ? "opacity-50 grayscale cursor-not-allowed" : "hover:shadow-[0_6px_18px_rgba(16,185,129,0.2)]"
                                                        )
                                                        : absence
                                                            ? "bg-gradient-to-br from-purple-500/10 to-violet-500/5 border-purple-400/30 py-2 px-1 cursor-pointer"
                                                            : "hover:bg-[var(--glass-bg)] hover:border-[var(--glass-border)] border-transparent py-2 px-1 min-h-[80px] cursor-pointer"
                                            )}>
                                                {/* Lock icon for locked shifts */}
                                                {isLocked && shift && (
                                                    <Lock size={10} className="absolute top-1 right-1 text-gray-400 dark:text-white/30" />
                                                )}
                                                {shift || realSchedule ? (
                                                    <>
                                                        {shift && (
                                                            <>
                                                                <span className={cn(
                                                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-semibold leading-none mb-1 backdrop-blur-sm",
                                                                    shiftMeta.chip
                                                                )}>
                                                                    <ShiftTypeIcon size={10} />
                                                                    {shiftMeta.label}
                                                                </span>

                                                                {shiftType === 'dayoff' ? (
                                                                    <span className={cn("text-xs font-medium mt-0.5", shiftMeta.text)}>☕ Descanso</span>
                                                                ) : (
                                                                    <>
                                                                        <span className={cn("text-sm font-bold tracking-wide", shiftMeta.text)}>
                                                                            {format(new Date(shift.start_time), 'HH:mm')}
                                                                        </span>
                                                                        <span className="text-[10px] text-gray-600 dark:text-white/60 font-medium">
                                                                            {format(new Date(shift.end_time), 'HH:mm')}
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </>
                                                        )}

                                                        {shiftType !== 'dayoff' && (
                                                            <span className="text-[9px] text-gray-500 dark:text-white/50 mt-1 font-mono">
                                                                Real: {firstEntry ? format(new Date(firstEntry.recorded_at), 'HH:mm') : '--:--'} / {displayExit ? format(new Date(displayExit.recorded_at), 'HH:mm') : '--:--'}
                                                            </span>
                                                        )}

                                                        {/* Attendance status badge */}
                                                        {statusMeta && (
                                                            <span className={cn(
                                                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold leading-none mt-1",
                                                                statusMeta.bg, statusMeta.color
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
