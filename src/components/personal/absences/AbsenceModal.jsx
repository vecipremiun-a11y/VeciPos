import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

const AbsenceModal = ({ isOpen, onClose, onSuccess }) => {
    const { createAbsence, staffMembers, fetchStaffMembers, currentUser } = useStore();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        user_id: '',
        type: 'medical', // medical, vacation, unjustified, permission, other
        start_date: format(new Date(), 'yyyy-MM-dd'),
        end_date: format(new Date(), 'yyyy-MM-dd'),
        reason: ''
    });

    useEffect(() => {
        if (isOpen) {
            fetchStaffMembers();
            setFormData({
                user_id: '',
                type: 'medical',
                start_date: format(new Date(), 'yyyy-MM-dd'),
                end_date: format(new Date(), 'yyyy-MM-dd'),
                reason: ''
            });
        }
    }, [isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const result = await createAbsence({
            user_id: formData.user_id,
            type: formData.type,
            start_date: formData.start_date,
            end_date: formData.end_date,
            reason: formData.reason,
            created_by: currentUser.username
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
                    <h2 className="text-lg font-bold text-[var(--color-text)]">Registrar Ausencia</h2>
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

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Tipo</label>
                        <select
                            className="glass-input w-full bg-[var(--color-surface)]"
                            value={formData.type}
                            onChange={e => setFormData({ ...formData, type: e.target.value })}
                        >
                            <option value="medical">Licencia Médica</option>
                            <option value="permission">Permiso Personal</option>
                            <option value="vacation">Vacaciones</option>
                            <option value="unjustified">Falta Injustificada</option>
                            <option value="other">Otro</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Motivo / Detalles</label>
                        <textarea
                            className="glass-input w-full min-h-[100px]"
                            value={formData.reason}
                            onChange={e => setFormData({ ...formData, reason: e.target.value })}
                            required
                            placeholder="Describa el motivo de la ausencia..."
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
                            Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AbsenceModal;
