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
        label: 'Manana',
        icon: Sunrise,
        chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    },
    afternoon: {
        label: 'Tarde',
        icon: Sunset,
        chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30'
    },
    night: {
        label: 'Noche',
        icon: MoonStar,
        chip: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
    },
    custom: {
        label: 'Turno',
        icon: MoveHorizontal,
        chip: 'bg-blue-500/15 text-blue-300 border-blue-500/30'
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
        fetchAttendanceByRange,
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
            fetchAttendanceByRange(startDate, endDate)
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
                                            className="p-1 border-l border-[var(--glass-border)] relative h-16"
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleDrop(e, user.id, dateStr)}
                                            onClick={() => handleCellClick(user, day)}
                                        >
                                            <div className={cn(
                                                "w-full h-full rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all border border-transparent",
                                                shift
                                                    ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 border-blue-500/20"
                                                    : realSchedule
                                                        ? "bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border-amber-500/20"
                                                        : "hover:bg-[var(--glass-bg)] hover:border-[var(--glass-border)]"
                                            )}>
                                                {shift || realSchedule ? (
                                                    <>
                                                        {shift && (
                                                            <>
                                                                <span className={cn(
                                                                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] leading-none mb-0.5",
                                                                    shiftMeta.chip
                                                                )}>
                                                                    <ShiftTypeIcon size={10} />
                                                                    {shiftMeta.label}
                                                                </span>

                                                                <span className="text-xs font-bold">
                                                                    {format(new Date(shift.start_time), 'HH:mm')}
                                                                </span>
                                                                <span className="text-[10px] opacity-70">
                                                                    {format(new Date(shift.end_time), 'HH:mm')}
                                                                </span>

                                                                <button
                                                                    type="button"
                                                                    draggable
                                                                    onDragStart={(e) => handleDragStart(e, shift, user.id, dateStr)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="text-[9px] mt-1 px-1.5 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                                                    title="Arrastra para mover/intercambiar"
                                                                >
                                                                    Arrastrar
                                                                </button>
                                                            </>
                                                        )}

                                                        <span className="text-[10px] opacity-80 mt-0.5">
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
