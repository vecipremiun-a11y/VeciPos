import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, DollarSign } from 'lucide-react';
import { format } from 'date-fns';

const AdvanceModal = ({ isOpen, onClose, onSuccess }) => {
    const { createAdvance, staffMembers, fetchStaffMembers, currentUser } = useStore();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        user_id: '',
        amount: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        notes: ''
    });

    useEffect(() => {
        if (isOpen) {
            fetchStaffMembers();
            setFormData({
                user_id: '',
                amount: '',
                date: format(new Date(), 'yyyy-MM-dd'),
                notes: ''
            });
        }
    }, [isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const result = await createAdvance({
            user_id: formData.user_id,
            amount: parseFloat(formData.amount),
            date: formData.date,
            notes: formData.notes,
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
                    <h2 className="text-lg font-bold text-[var(--color-text)]">Nuevo Adelanto</h2>
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

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Monto</label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                            <input
                                type="number"
                                className="glass-input w-full pl-9"
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                required
                                min="0"
                                step="1000"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Fecha</label>
                        <input
                            type="date"
                            className="glass-input w-full"
                            value={formData.date}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Notas</label>
                        <textarea
                            className="glass-input w-full min-h-[80px]"
                            value={formData.notes}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            placeholder="Motivo del adelanto..."
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
                            disabled={loading || !formData.user_id || !formData.amount}
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

export default AdvanceModal;
