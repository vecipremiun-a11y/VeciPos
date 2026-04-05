import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, AlertCircle, Clock, Coffee } from 'lucide-react';
import { format } from 'date-fns';

const ABSENCE_TYPES = [
    { value: 'medical',       label: 'Licencia Médica',           emoji: '🔴', color: 'bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300', payImpact: '⚠️ Depende' },
    { value: 'vacation',      label: 'Vacaciones',                emoji: '🟣', color: 'bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300', payImpact: '✅ Se paga' },
    { value: 'permission',    label: 'Permiso Personal',          emoji: '🟡', color: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300', payImpact: '❌ Puede descontar' },
    { value: 'administrative', label: 'Día Administrativo',       emoji: '🔵', color: 'bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300', payImpact: '✅ Se paga' },
    { value: 'unjustified',   label: 'Inasistencia Injustificada', emoji: '⚫', color: 'bg-gray-500/15 border-gray-500/40 text-gray-700 dark:text-gray-300', payImpact: '❌ Descuenta' },
    { value: 'unpaid_leave',  label: 'Permiso sin Goce de Sueldo', emoji: '🟢', color: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300', payImpact: '❌ Descuenta' },
    { value: 'other',         label: 'Otro',                      emoji: '⬜', color: 'bg-slate-500/15 border-slate-500/40 text-slate-700 dark:text-slate-300', payImpact: '—' },
];

const AbsenceModal = ({ isOpen, onClose, onSuccess, editData = null }) => {
    const { createAbsence, staffMembers, fetchStaffMembers, currentUser } = useStore();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        user_id: '',
        type: 'permission',
        start_date: format(new Date(), 'yyyy-MM-dd'),
        end_date: format(new Date(), 'yyyy-MM-dd'),
        reason: '',
        half_day: false,
        half_day_period: 'morning',
        by_hours: false,
        hours: '',
        status: 'approved',
    });

    useEffect(() => {
        if (isOpen) {
            fetchStaffMembers();
            setError('');
            if (editData) {
                setFormData({
                    user_id: editData.user_id || '',
                    type: editData.type || 'permission',
                    start_date: editData.absence_date || editData.start_date || format(new Date(), 'yyyy-MM-dd'),
                    end_date: editData.absence_date || editData.end_date || format(new Date(), 'yyyy-MM-dd'),
                    reason: editData.notes || editData.reason || '',
                    half_day: !!editData.half_day,
                    half_day_period: editData.half_day_period || 'morning',
                    by_hours: !!editData.hours,
                    hours: editData.hours || '',
                    status: editData.status || 'approved',
                });
            } else {
                setFormData({
                    user_id: '',
                    type: 'permission',
                    start_date: format(new Date(), 'yyyy-MM-dd'),
                    end_date: format(new Date(), 'yyyy-MM-dd'),
                    reason: '',
                    half_day: false,
                    half_day_period: 'morning',
                    by_hours: false,
                    hours: '',
                    status: 'approved',
                });
            }
        }
    }, [isOpen, editData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (!formData.user_id) {
            setError('Seleccione un empleado');
            setLoading(false);
            return;
        }

        if (formData.start_date > formData.end_date) {
            setError('La fecha de inicio no puede ser posterior a la fecha de fin');
            setLoading(false);
            return;
        }

        if (formData.by_hours && (!formData.hours || formData.hours <= 0)) {
            setError('Ingrese las horas de ausencia');
            setLoading(false);
            return;
        }

        const result = await createAbsence({
            user_id: formData.user_id,
            type: formData.type,
            start_date: formData.start_date,
            end_date: formData.half_day || formData.by_hours ? formData.start_date : formData.end_date,
            notes: formData.reason,
            half_day: formData.half_day,
            half_day_period: formData.half_day ? formData.half_day_period : null,
            hours: formData.by_hours ? parseFloat(formData.hours) : null,
            status: formData.status,
        });

        if (result.success) {
            onSuccess();
            onClose();
        } else {
            setError(result.error || 'Error al registrar ausencia');
        }
        setLoading(false);
    };

    const selectedType = ABSENCE_TYPES.find(t => t.value === formData.type);
    const isSingleDayMode = formData.half_day || formData.by_hours;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-card w-full max-w-lg p-0 flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center">
                    <h2 className="text-lg font-bold text-[var(--color-text)]">
                        {editData ? 'Editar Ausencia' : 'Registrar Ausencia'}
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded-full transition-colors">
                        <X size={20} className="text-[var(--color-text-muted)]" />
                    </button>
                </div>

                {error && (
                    <div className="mx-4 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-xs">
                        <AlertCircle size={14} className="flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
                    {/* Empleado */}
                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Empleado</label>
                        <select
                            className="glass-input w-full bg-[var(--color-surface)]"
                            value={formData.user_id}
                            onChange={e => setFormData({ ...formData, user_id: e.target.value })}
                            required
                        >
                            <option value="">Seleccione...</option>
                            {staffMembers.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Tipo — Cards */}
                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase">Tipo de Ausencia</label>
                        <div className="grid grid-cols-2 gap-2">
                            {ABSENCE_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type: t.value })}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                                        formData.type === t.value
                                            ? `${t.color} ring-1 ring-current`
                                            : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                    }`}
                                >
                                    <span>{t.emoji}</span>
                                    <span className="truncate">{t.label}</span>
                                </button>
                            ))}
                        </div>
                        {selectedType && (
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                                Impacto sueldo: {selectedType.payImpact}
                            </p>
                        )}
                    </div>

                    {/* Modalidad */}
                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase">Modalidad</label>
                        <div className="grid grid-cols-3 gap-2 p-1 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, half_day: false, by_hours: false })}
                                className={`px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                                    !formData.half_day && !formData.by_hours
                                        ? 'bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)]'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                }`}
                            >
                                Día Completo
                            </button>
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, half_day: true, by_hours: false })}
                                className={`px-2 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                    formData.half_day
                                        ? 'bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)]'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                }`}
                            >
                                <Coffee size={12} /> Medio Día
                            </button>
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, by_hours: true, half_day: false })}
                                className={`px-2 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                    formData.by_hours
                                        ? 'bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)]'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                }`}
                            >
                                <Clock size={12} /> Por Horas
                            </button>
                        </div>
                    </div>

                    {/* Medio día: mañana o tarde */}
                    {formData.half_day && (
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">¿Cuándo falta?</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, half_day_period: 'morning' })}
                                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                                        formData.half_day_period === 'morning'
                                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300'
                                            : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)]'
                                    }`}
                                >
                                    🌅 Falta en la Mañana
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, half_day_period: 'afternoon' })}
                                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                                        formData.half_day_period === 'afternoon'
                                            ? 'bg-orange-500/15 border-orange-500/40 text-orange-700 dark:text-orange-300'
                                            : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-[var(--color-text-muted)]'
                                    }`}
                                >
                                    🌇 Falta en la Tarde
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Por horas */}
                    {formData.by_hours && (
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Horas de ausencia</label>
                            <input
                                type="number"
                                min="0.5"
                                max="12"
                                step="0.5"
                                className="glass-input w-full"
                                value={formData.hours}
                                onChange={e => setFormData({ ...formData, hours: e.target.value })}
                                placeholder="Ej: 2, 4.5"
                                required
                            />
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                                Para llegadas tarde o salidas tempranas. Ej: 2 horas = llega 2 hrs tarde o sale 2 hrs antes.
                            </p>
                        </div>
                    )}

                    {/* Fechas */}
                    <div className={`grid gap-4 ${isSingleDayMode ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">
                                {isSingleDayMode ? 'Fecha' : 'Desde'}
                            </label>
                            <input
                                type="date"
                                className="glass-input w-full"
                                value={formData.start_date}
                                onChange={e => {
                                    const v = e.target.value;
                                    setFormData({ ...formData, start_date: v, ...(isSingleDayMode ? { end_date: v } : {}) });
                                }}
                                required
                            />
                        </div>
                        {!isSingleDayMode && (
                            <div>
                                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Hasta</label>
                                <input
                                    type="date"
                                    className="glass-input w-full"
                                    value={formData.end_date}
                                    onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                                    min={formData.start_date}
                                    required
                                />
                            </div>
                        )}
                    </div>

                    {/* Estado */}
                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Estado</label>
                        <select
                            className="glass-input w-full bg-[var(--color-surface)]"
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                        >
                            <option value="approved">Aprobada</option>
                            <option value="pending">Pendiente</option>
                            <option value="rejected">Rechazada</option>
                        </select>
                    </div>

                    {/* Motivo */}
                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Motivo / Detalles</label>
                        <textarea
                            className="glass-input w-full min-h-[80px]"
                            value={formData.reason}
                            onChange={e => setFormData({ ...formData, reason: e.target.value })}
                            placeholder="Describa el motivo de la ausencia..."
                        />
                    </div>

                    {/* Resumen */}
                    {formData.user_id && (
                        <div className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)] text-xs space-y-1">
                            <p className="font-bold text-[var(--color-text)]">Resumen</p>
                            <p className="text-[var(--color-text-muted)]">
                                {selectedType?.emoji} {selectedType?.label}
                                {formData.half_day && ` — Medio día (${formData.half_day_period === 'morning' ? 'Mañana' : 'Tarde'})`}
                                {formData.by_hours && ` — ${formData.hours || '?'} horas`}
                            </p>
                            <p className="text-[var(--color-text-muted)]">
                                📅 {formData.start_date === formData.end_date || isSingleDayMode
                                    ? formData.start_date
                                    : `${formData.start_date} al ${formData.end_date}`
                                }
                            </p>
                            <p className="text-[var(--color-text-muted)]">💰 {selectedType?.payImpact}</p>
                        </div>
                    )}
                </form>

                <div className="p-4 border-t border-[var(--glass-border)] flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl text-[var(--color-text)] bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] border border-[var(--glass-border)] transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || !formData.user_id}
                        className="px-4 py-2 rounded-xl font-bold bg-[var(--color-primary)] text-black hover:bg-cyan-400 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        <Save size={18} />
                        {loading ? 'Guardando...' : 'Registrar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export { ABSENCE_TYPES };
export default AbsenceModal;
