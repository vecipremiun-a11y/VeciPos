import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, Trash2 } from 'lucide-react';
import { format, startOfWeek, addWeeks, addDays } from 'date-fns';

const SHIFT_TEMPLATES = {
    morning: { label: 'Manana', start: '07:00', end: '15:00' },
    afternoon: { label: 'Tarde', start: '15:00', end: '23:00' },
    night: { label: 'Noche', start: '23:00', end: '07:00' },
    custom: { label: 'Personalizado', start: '09:00', end: '18:00' }
};

const DAY_OPTIONS = [
    { label: 'Lun', value: 1 },
    { label: 'Mar', value: 2 },
    { label: 'Mie', value: 3 },
    { label: 'Jue', value: 4 },
    { label: 'Vie', value: 5 },
    { label: 'Sab', value: 6 },
    { label: 'Dom', value: 0 }
];

const buildDefaultWeeklyConfig = () => {
    const config = {};
    DAY_OPTIONS.forEach((day) => {
        config[day.value] = {
            enabled: [1, 2, 3, 4, 5].includes(day.value),
            template: [1, 2, 3, 4, 5].includes(day.value) ? 'morning' : 'custom',
            start: [1, 2, 3, 4, 5].includes(day.value) ? SHIFT_TEMPLATES.morning.start : '09:00',
            end: [1, 2, 3, 4, 5].includes(day.value) ? SHIFT_TEMPLATES.morning.end : '18:00'
        };
    });
    return config;
};

const upsertDayConfig = (prev, dayValue, patch) => ({
    ...prev,
    [dayValue]: {
        ...prev[dayValue],
        ...patch
    }
});

const timeFromIso = (isoDate) => {
    if (!isoDate) return '09:00';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return '09:00';
    return format(date, 'HH:mm');
};

const buildShiftPayload = (shiftDate, userId, startTime, endTime) => {
    const startISO = `${shiftDate}T${startTime}:00`;

    const endBase = new Date(`${shiftDate}T${endTime}:00`);
    const startBase = new Date(`${shiftDate}T${startTime}:00`);

    if (endBase <= startBase) {
        endBase.setDate(endBase.getDate() + 1);
    }

    return {
        user_id: userId,
        shift_date: shiftDate,
        start_time: startISO,
        end_time: endBase.toISOString().slice(0, 19)
    };
};

const ShiftModal = ({ isOpen, onClose, shiftData, selectedDate, selectedUser, onSuccess }) => {
    const { createShift, deleteShift, deleteShiftByDate, staffMembers } = useStore();
    const [loading, setLoading] = useState(false);

    // Form State
    const [userId, setUserId] = useState(selectedUser || '');
    const [date, setDate] = useState(selectedDate || format(new Date(), 'yyyy-MM-dd'));
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('18:00');
    const [scheduleMode, setScheduleMode] = useState('fixed'); // single | fixed
    const [repeatWeeks, setRepeatWeeks] = useState(52);
    const [weeklyConfig, setWeeklyConfig] = useState(buildDefaultWeeklyConfig());

    useEffect(() => {
        if (shiftData) {
            setUserId(shiftData.user_id);
            setDate(shiftData.start_time.split('T')[0]);
            setStartTime(timeFromIso(shiftData.start_time));
            setEndTime(timeFromIso(shiftData.end_time));
            setScheduleMode('single');
            setWeeklyConfig(buildDefaultWeeklyConfig());
        } else {
            // New shift defaults
            if (selectedUser) setUserId(selectedUser);
            if (selectedDate) setDate(selectedDate);
            setStartTime('09:00');
            setEndTime('18:00');
            setScheduleMode('fixed');
            setRepeatWeeks(52);
            setWeeklyConfig(buildDefaultWeeklyConfig());
        }
    }, [shiftData, selectedDate, selectedUser, isOpen]);

    const toggleDayEnabled = (dayValue) => {
        setWeeklyConfig((prev) => upsertDayConfig(prev, dayValue, { enabled: !prev[dayValue].enabled }));
    };

    const setDayTemplate = (dayValue, template) => {
        const templateConfig = SHIFT_TEMPLATES[template];
        setWeeklyConfig((prev) => upsertDayConfig(prev, dayValue, {
            template,
            start: templateConfig.start,
            end: templateConfig.end
        }));
    };

    const setDayTime = (dayValue, key, value) => {
        setWeeklyConfig((prev) => upsertDayConfig(prev, dayValue, {
            template: 'custom',
            [key]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        if (scheduleMode === 'fixed' && !shiftData) {
            const activeDays = DAY_OPTIONS
                .filter((day) => weeklyConfig[day.value]?.enabled)
                .map((day) => day.value);

            if (!activeDays.length) {
                alert('Selecciona al menos un dia para el horario rotativo/fijo.');
                setLoading(false);
                return;
            }

            const baseWeekStart = startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 1 });
            let successCount = 0;
            let failedCount = 0;

            // Get disabled days to delete existing shifts
            const disabledDays = DAY_OPTIONS
                .filter((day) => !weeklyConfig[day.value]?.enabled)
                .map((day) => day.value);

            for (let w = 0; w < repeatWeeks; w += 1) {
                const weekDate = addWeeks(baseWeekStart, w);

                // Delete shifts for disabled days
                for (const dayIndex of disabledDays) {
                    const dayOffset = dayIndex === 0 ? 6 : dayIndex - 1;
                    const shiftDay = addDays(weekDate, dayOffset);
                    const shiftDate = format(shiftDay, 'yyyy-MM-dd');
                    await deleteShiftByDate(userId, shiftDate);
                }

                // Create shifts for active days
                for (const dayIndex of activeDays) {
                    const dayConfig = weeklyConfig[dayIndex];
                    if (!dayConfig?.start || !dayConfig?.end) {
                        failedCount += 1;
                        continue;
                    }

                    const dayOffset = dayIndex === 0 ? 6 : dayIndex - 1;
                    const shiftDay = addDays(weekDate, dayOffset);
                    const shiftDate = format(shiftDay, 'yyyy-MM-dd');

                    const result = await createShift(
                        buildShiftPayload(shiftDate, userId, dayConfig.start, dayConfig.end)
                    );

                    if (result.success) {
                        successCount += 1;
                    } else {
                        failedCount += 1;
                    }
                }
            }

            onSuccess();
            onClose();
            alert(`Horario guardado. Turnos generados: ${successCount}${failedCount > 0 ? ` | Fallidos: ${failedCount}` : ''}`);
        } else {
            const result = await createShift(buildShiftPayload(date, userId, startTime, endTime));

            if (result.success) {
                onSuccess();
                onClose();
            } else {
                alert(result.error || 'Error al guardar turno');
            }
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

                <form id="shift-form" onSubmit={handleSubmit} className="p-6 space-y-4">
                    {!shiftData && (
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Modo de Asignacion</label>
                            <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                                <button
                                    type="button"
                                    onClick={() => setScheduleMode('fixed')}
                                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${scheduleMode === 'fixed' ? 'bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                                >
                                    Horario Fijo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScheduleMode('single')}
                                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${scheduleMode === 'single' ? 'bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                                >
                                    Turno Unico
                                </button>
                            </div>
                        </div>
                    )}

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
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">
                            {scheduleMode === 'fixed' && !shiftData ? 'Semana Base' : 'Fecha'}
                        </label>
                        <input
                            type="date"
                            className="glass-input w-full"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            disabled={!!shiftData} // Lock date on edit? usually yes for calendar cell click
                        />
                    </div>

                    {(shiftData || scheduleMode === 'single') && (
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
                    )}

                    {!shiftData && scheduleMode === 'fixed' && (
                        <>
                            <div>
                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase">Turnos por Dia (Rotativo/Fijo)</label>
                                <div className="space-y-3 max-h-64 overflow-auto pr-1">
                                    {DAY_OPTIONS.map((day) => {
                                        const cfg = weeklyConfig[day.value] || { enabled: false, template: 'custom', start: '09:00', end: '18:00' };

                                        return (
                                            <div key={day.value} className="rounded-lg border border-[var(--glass-border)] bg-[var(--color-surface)] p-3 space-y-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleDayEnabled(day.value)}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-colors ${cfg.enabled ? 'bg-[var(--color-primary)]/20 border-[var(--color-primary)] text-[var(--color-primary)]' : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)]'}`}
                                                    >
                                                        {day.label}
                                                    </button>

                                                    <select
                                                        value={cfg.template}
                                                        onChange={(e) => setDayTemplate(day.value, e.target.value)}
                                                        disabled={!cfg.enabled}
                                                        className="glass-input text-xs w-40"
                                                    >
                                                        <option value="morning">Manana 07:00-15:00</option>
                                                        <option value="afternoon">Tarde 15:00-23:00</option>
                                                        <option value="night">Noche 23:00-07:00</option>
                                                        <option value="custom">Personalizado</option>
                                                    </select>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2">
                                                    <input
                                                        type="time"
                                                        value={cfg.start}
                                                        onChange={(e) => setDayTime(day.value, 'start', e.target.value)}
                                                        disabled={!cfg.enabled}
                                                        className="glass-input"
                                                    />
                                                    <input
                                                        type="time"
                                                        value={cfg.end}
                                                        onChange={(e) => setDayTime(day.value, 'end', e.target.value)}
                                                        disabled={!cfg.enabled}
                                                        className="glass-input"
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Semanas a Generar</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={104}
                                    value={repeatWeeks}
                                    onChange={e => setRepeatWeeks(Math.max(1, Math.min(104, Number(e.target.value) || 1)))}
                                    className="glass-input w-full"
                                />
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                    Recomendado: 52 semanas (1 anio). Soporta turnos nocturnos cruzando al dia siguiente.
                                </p>
                            </div>
                        </>
                    )}
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
                            type="submit"
                            form="shift-form"
                            disabled={loading || !userId}
                            className="px-4 py-2 rounded-xl font-bold bg-[var(--color-primary)] text-black hover:bg-cyan-400 transition-colors flex items-center gap-2"
                        >
                            <Save size={18} />
                            {loading ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShiftModal;
