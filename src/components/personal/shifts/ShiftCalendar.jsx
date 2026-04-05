import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Sunrise, Sunset, MoonStar, MoveHorizontal } from 'lucide-react';
import { cn } from '../../../lib/utils';
import ShiftModal from './ShiftModal';

const getShiftType = (shift) => {
    if (!shift?.start_time) return 'custom';
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
        card: 'bg-gradient-to-br from-amber-100 via-amber-50 to-yellow-50 dark:from-amber-500/20 dark:via-amber-600/10 dark:to-yellow-700/5 border-amber-400 dark:border-amber-400/30 shadow-[0_4px_15px_rgba(245,158,11,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(245,158,11,0.15),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-amber-700 dark:text-amber-200',
        glow: 'hover:shadow-[0_6px_20px_rgba(245,158,11,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(245,158,11,0.25),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    afternoon: {
        label: 'Tarde',
        icon: Sunset,
        chip: 'bg-orange-500/25 text-orange-700 dark:text-orange-300 border-orange-500/50',
        card: 'bg-gradient-to-br from-orange-100 via-orange-50 to-rose-50 dark:from-orange-500/20 dark:via-rose-600/10 dark:to-red-700/5 border-orange-400 dark:border-orange-400/30 shadow-[0_4px_15px_rgba(249,115,22,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(249,115,22,0.15),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-orange-700 dark:text-orange-200',
        glow: 'hover:shadow-[0_6px_20px_rgba(249,115,22,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(249,115,22,0.25),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    night: {
        label: 'Noche',
        icon: MoonStar,
        chip: 'bg-indigo-500/25 text-indigo-700 dark:text-indigo-300 border-indigo-500/50',
        card: 'bg-gradient-to-br from-indigo-100 via-indigo-50 to-violet-50 dark:from-indigo-500/20 dark:via-purple-600/10 dark:to-violet-700/5 border-indigo-400 dark:border-indigo-400/30 shadow-[0_4px_15px_rgba(99,102,241,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(99,102,241,0.15),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-indigo-700 dark:text-indigo-200',
        glow: 'hover:shadow-[0_6px_20px_rgba(99,102,241,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(99,102,241,0.25),inset_0_1px_0_rgba(255,255,255,0.1)]',
    },
    custom: {
        label: 'Turno',
        icon: MoveHorizontal,
        chip: 'bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border-cyan-500/50',
        card: 'bg-gradient-to-br from-cyan-100 via-cyan-50 to-blue-50 dark:from-cyan-500/20 dark:via-blue-600/10 dark:to-blue-700/5 border-cyan-400 dark:border-cyan-400/30 shadow-[0_4px_15px_rgba(6,182,212,0.2),inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[0_4px_15px_rgba(6,182,212,0.15),inset_0_1px_0_rgba(255,255,255,0.08)]',
        text: 'text-cyan-700 dark:text-cyan-200',
        glow: 'hover:shadow-[0_6px_20px_rgba(6,182,212,0.3),inset_0_1px_0_rgba(255,255,255,0.6)] dark:hover:shadow-[0_6px_20px_rgba(6,182,212,0.25),inset_0_1px_0_rgba(255,255,255,0.1)]',
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
        createShift,
        deleteShift,
        staffMembers,
        fetchStaffMembers
    } = useStore();

    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(false);
    const [attendanceRange, setAttendanceRange] = useState([]);
    const [dragData, setDragData] = useState(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedShift, setSelectedShift] = useState(null);
    const [modalUser, setModalUser] = useState(null);
    const [modalDate, setModalDate] = useState(null);

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

        const [, attendance] = await Promise.all([
            fetchShifts(startDate, endDate),
            fetchAttendanceByRangeRaw(startDate, endDate)
        ]);

        setAttendanceRange(attendance || []);
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

        setSelectedShift(shift || null);
        setModalUser(user.id);
        setModalDate(dateStr);
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
                                    const shiftType = getShiftType(shift);
                                    const shiftMeta = shiftTypeStyles[shiftType] || shiftTypeStyles.custom;
                                    const ShiftTypeIcon = shiftMeta.icon;

                                    return (
                                        <td
                                            key={day.toISOString()}
                                            className="p-1 border-l border-[var(--glass-border)] relative"
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleDrop(e, user.id, dateStr)}
                                            onClick={() => handleCellClick(user, day)}
                                        >
                                            <div className={cn(
                                                "w-full rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 border",
                                                shift
                                                    ? cn(shiftMeta.card, shiftMeta.glow, "py-2 px-1")
                                                    : realSchedule
                                                        ? "bg-gradient-to-br from-emerald-500/15 to-teal-600/5 border-emerald-400/25 text-emerald-300 py-2 px-1 shadow-[0_4px_12px_rgba(16,185,129,0.1)] hover:shadow-[0_6px_18px_rgba(16,185,129,0.2)]"
                                                        : "hover:bg-[var(--glass-bg)] hover:border-[var(--glass-border)] border-transparent py-2 px-1 min-h-[80px]"
                                            )}>
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

                                                                <span className={cn("text-sm font-bold tracking-wide", shiftMeta.text)}>
                                                                    {format(new Date(shift.start_time), 'HH:mm')}
                                                                </span>
                                                                <span className="text-[10px] text-gray-600 dark:text-white/60 font-medium">
                                                                    {format(new Date(shift.end_time), 'HH:mm')}
                                                                </span>

                                                                <button
                                                                    type="button"
                                                                    draggable
                                                                    onDragStart={(e) => handleDragStart(e, shift, user.id, dateStr)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="text-[8px] mt-1 px-2 py-0.5 rounded-full border border-gray-300 dark:border-white/10 text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:border-gray-400 dark:hover:border-white/20 transition-colors"
                                                                    title="Arrastra para mover/intercambiar"
                                                                >
                                                                    Arrastrar
                                                                </button>
                                                            </>
                                                        )}

                                                        <span className="text-[9px] text-gray-500 dark:text-white/50 mt-1 font-mono">
                                                            Real: {firstEntry ? format(new Date(firstEntry.recorded_at), 'HH:mm') : '--:--'} / {displayExit ? format(new Date(displayExit.recorded_at), 'HH:mm') : '--:--'}
                                                        </span>
                                                    </>
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
            />
        </div>
    );
};

export default ShiftCalendar;
