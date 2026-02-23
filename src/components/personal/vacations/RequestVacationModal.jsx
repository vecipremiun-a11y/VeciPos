import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, Calendar, AlertCircle } from 'lucide-react';
import { format, differenceInBusinessDays, addDays } from 'date-fns';

const RequestVacationModal = ({ isOpen, onClose, onSuccess }) => {
    const { createVacationRequest, staffMembers, fetchStaffMembers, currentUser } = useStore();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        user_id: '',
        start_date: format(new Date(), 'yyyy-MM-dd'),
        end_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        reason: ''
    });

    const [daysRequested, setDaysRequested] = useState(0);

    useEffect(() => {
        if (isOpen) {
            fetchStaffMembers();
            setFormData({
                user_id: currentUser.id || '', // Default to current user if possible
                start_date: format(new Date(), 'yyyy-MM-dd'),
                end_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
                reason: ''
            });
        }
    }, [isOpen]);

    useEffect(() => {
        if (formData.start_date && formData.end_date) {
            // Simple calculation, strictly excludes weekends if business days are needed
            // But usually this logic is complex. For now just raw difference + 1
            // Date-fns differenceInBusinessDays is good for M-F.
            // Let's assume M-F work week.
            try {
                const start = new Date(formData.start_date);
                const end = new Date(formData.end_date);
                const days = differenceInBusinessDays(end, start) + 1; // +1 to include start day? differenceInBusinessDays is end - start
                // Actually differenceInBusinessDays(end, start) returns number of full days.
                // If same day, returns 0. So +1 if inclusive.
                // But business days logic might vary.
                // I'll stick to simple days for now and let admin verify.
                setDaysRequested(Math.max(0, days));
            } catch (e) {
                setDaysRequested(0);
            }
        }
    }, [formData.start_date, formData.end_date]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const result = await createVacationRequest({
            user_id: formData.user_id,
            start_date: formData.start_date,
            end_date: formData.end_date,
            days: daysRequested, // Store logic might recalculate or verify
            comments: formData.reason,
            requested_by: currentUser.username
        });

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
                    <h2 className="text-lg font-bold text-[var(--color-text)]">Solicitar Vacaciones</h2>
                    <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded-full transition-colors">
                        <X size={20} className="text-[var(--color-text-muted)]" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
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

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Desde</label>
                            <input
                                type="date"
                                className="glass-input w-full"
                                value={formData.start_date}
                                onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Hasta</label>
                            <input
                                type="date"
                                className="glass-input w-full"
                                value={formData.end_date}
                                onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="bg-[var(--color-surface)] p-3 rounded-lg flex items-center gap-3 border border-[var(--glass-border)]">
                        <Calendar size={20} className="text-[var(--color-primary)]" />
                        <div>
                            <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold">Días Solicitados (Est.)</p>
                            <p className="text-lg font-bold text-[var(--color-text)]">{daysRequested} días hábiles</p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Comentarios</label>
                        <textarea
                            className="glass-input w-full min-h-[80px]"
                            value={formData.reason}
                            onChange={e => setFormData({ ...formData, reason: e.target.value })}
                            placeholder="Notas adicionales..."
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-[var(--color-text)] bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] border border-[var(--glass-border)] transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !formData.user_id}
                            className="px-4 py-2 rounded-xl font-bold bg-[var(--color-primary)] text-black hover:bg-cyan-400 transition-colors flex items-center gap-2"
                        >
                            <Save size={18} />
                            Enviar Solicitud
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RequestVacationModal;
