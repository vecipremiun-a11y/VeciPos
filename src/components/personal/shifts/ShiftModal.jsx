import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, Trash2, Clock, Repeat } from 'lucide-react';
import { format } from 'date-fns';

const ShiftModal = ({ isOpen, onClose, shiftData, selectedDate, selectedUser, onSuccess }) => {
    const { createShift, deleteShift, staffMembers } = useStore();
    const [loading, setLoading] = useState(false);

    // Form State
    const [userId, setUserId] = useState(selectedUser || '');
    const [date, setDate] = useState(selectedDate || format(new Date(), 'yyyy-MM-dd'));
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('18:00');
    const [breakDuration, setBreakDuration] = useState(60); // minutes
    const [repeatDays, setRepeatDays] = useState([]); // Array of day indexes [1,2,3,4,5]

    useEffect(() => {
        if (shiftData) {
            setUserId(shiftData.user_id);
            setDate(shiftData.start_time.split('T')[0]);
            setStartTime(format(new Date(shiftData.start_time), 'HH:mm'));
            setEndTime(format(new Date(shiftData.end_time), 'HH:mm'));
            setBreakDuration(shiftData.break_minutes || 60);
        } else {
            // New shift defaults
            if (selectedUser) setUserId(selectedUser);
            if (selectedDate) setDate(selectedDate);
            setStartTime('09:00');
            setEndTime('18:00');
        }
    }, [shiftData, selectedDate, selectedUser, isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const startISO = `${date}T${startTime}:00`;
        const endISO = `${date}T${endTime}:00`;

        // Validation: End must be after Start (handle overnight later if needed, assume one day for now)
        if (endTime <= startTime) {
            alert('La hora de fin debe ser posterior a la hora de inicio');
            setLoading(false);
            return;
        }

        const result = await createShift({
            user_id: userId,
            start_time: startISO,
            end_time: endISO,
            break_minutes: parseInt(breakDuration)
        });

        if (result.success) {
            onSuccess();
            onClose();
        } else {
            alert(result.error || 'Error al guardar turno');
        }
        setLoading(false);
    };

    const handleDelete = async () => {
        if (!window.confirm("¿Eliminar este turno?")) return;
        setLoading(true);
        const result = await deleteShift(shiftData.id);
        if (result.success) {
            onSuccess();
            onClose();
        } else {
            alert(result.error);
        }
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-card w-full max-w-md p-0 flex flex-col">
                <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center">
                    <h2 className="text-lg font-bold text-[var(--color-text)]">
                        {shiftData ? 'Editar Turno' : 'Nuevo Turno'}
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded-full transition-colors">
                        <X size={20} className="text-[var(--color-text-muted)]" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Empleado</label>
                        <select
                            className="glass-input w-full bg-[var(--color-surface)]"
                            value={userId}
                            onChange={e => setUserId(e.target.value)}
                            disabled={!!shiftData} // Lock user on edit logic for simplicity? or allow change
                        >
                            <option value="">Seleccione...</option>
                            {staffMembers.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Fecha</label>
                        <input
                            type="date"
                            className="glass-input w-full"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            disabled={!!shiftData} // Lock date on edit? usually yes for calendar cell click
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Inicio</label>
                            <input
                                type="time"
                                className="glass-input w-full"
                                value={startTime}
                                onChange={e => setStartTime(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Fin</label>
                            <input
                                type="time"
                                className="glass-input w-full"
                                value={endTime}
                                onChange={e => setEndTime(e.target.value)}
                            />
                        </div>
                    </div>
                </form>

                <div className="p-4 border-t border-[var(--glass-border)] flex justify-between gap-3">
                    {shiftData && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="px-4 py-2 rounded-xl text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                        >
                            <Trash2 size={18} />
                        </button>
                    )}
                    <div className="flex gap-3 flex-1 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-[var(--color-text)] bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] border border-[var(--glass-border)] transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !userId}
                            className="px-4 py-2 rounded-xl font-bold bg-[var(--color-primary)] text-black hover:bg-cyan-400 transition-colors flex items-center gap-2"
                        >
                            <Save size={18} />
                            Guardar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShiftModal;
