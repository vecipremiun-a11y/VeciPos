import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Copy, Calendar, Plus, User } from 'lucide-react';
import { cn } from '../../../lib/utils';
import ShiftModal from './ShiftModal';

const ShiftCalendar = () => {
    const {
        workShifts,
        fetchShifts,
        staffMembers,
        fetchStaffMembers,
        copyPreviousWeekShifts
    } = useStore();

    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(false);

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
        // Ensure ISO strings cover the full days (start of first day to end of last day)
        // weekStart is 00:00:00, weekEnd is 23:59:59
        await fetchShifts(weekStart.toISOString(), weekEnd.toISOString());
        setLoading(false);
    };

    const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

    const handleCellClick = (user, day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const shift = workShifts.find(s =>
            s.user_id === user.id &&
            s.start_time.startsWith(dateStr)
        );

        setSelectedShift(shift || null);
        setModalUser(user.id);
        setModalDate(dateStr);
        setIsModalOpen(true);
    };

    const handleCopyWeek = async () => {
        if (!window.confirm("¿Copiar turnos de la semana pasada a esta semana? Se borrarán los turnos actuales de esta semana.")) return;
        setLoading(true);
        const result = await copyPreviousWeekShifts(weekStart.toISOString());
        if (result.success) {
            loadShifts();
        } else {
            alert(result.error);
        }
        setLoading(false);
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
                        onClick={handleCopyWeek}
                        className="flex-1 md:flex-none btn-secondary flex items-center justify-center gap-2 text-sm"
                    >
                        <Copy size={16} />
                        Copiar Semana Anterior
                    </button>
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
                        Nuevo Turno
                    </button>
                </div>
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
                                        s.start_time.startsWith(dateStr)
                                    );

                                    return (
                                        <td
                                            key={day.toISOString()}
                                            className="p-1 border-l border-[var(--glass-border)] relative h-16"
                                            onClick={() => handleCellClick(user, day)}
                                        >
                                            <div className={cn(
                                                "w-full h-full rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all border border-transparent",
                                                shift
                                                    ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 border-blue-500/20"
                                                    : "hover:bg-[var(--glass-bg)] hover:border-[var(--glass-border)]"
                                            )}>
                                                {shift ? (
                                                    <>
                                                        <span className="text-xs font-bold">
                                                            {format(new Date(shift.start_time), 'HH:mm')}
                                                        </span>
                                                        <span className="text-[10px] opacity-70">
                                                            {format(new Date(shift.end_time), 'HH:mm')}
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
