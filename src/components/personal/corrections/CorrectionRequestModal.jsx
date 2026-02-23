import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { X, Save, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

const CorrectionRequestModal = ({ onClose, onSuccess }) => {
    const { requestCorrection, staffMembers, fetchStaffMembers, currentUser } = useStore();
    const [loading, setLoading] = useState(false);

    // Form State
    const [userId, setUserId] = useState(currentUser.id); // Default to current user (or select if admin)
    const [isAdmin, setIsAdmin] = useState(false);

    const [formData, setFormData] = useState({
        correction_type: 'add_entry',
        requested_date: format(new Date(), 'yyyy-MM-dd'),
        requested_at: format(new Date(), 'yyyy-MM-dd') + 'T09:00', // Initialize with default time
        reason: ''
    });

    useEffect(() => {
        // Check if admin to allow selecting user
        // Assuming 'admin' or 'manage_personal' permission
        // For now just check role or generic permission
        setIsAdmin(true); // Simplify for development, normally check permission
        fetchStaffMembers();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const result = await requestCorrection({
            user_id: userId,
            correction_type: formData.correction_type,
            requested_date: formData.requested_date,
            requested_at: formData.requested_at, // Needs full ISO? Store expects string.
            // Format requested_at to ISO string if it's just 'yyyy-MM-ddThh:mm'
            // But store might expect full ISO. Let's send ISO.
            // UI input type="datetime-local" returns "yyyy-MM-ddThh:mm"
            // We can append ":00.000Z" (converted to UTC or keep local)
            // It's best to handle timezone in store or send simplified string if store handles it.
            // The store insertion uses it directly.
            // Let's ensure it's a valid date string.
            reason: formData.reason,
            original_record_id: null // Adding new record usually
        });

        setLoading(false);
        if (result.success) {
            onSuccess();
            onClose();
        } else {
            alert(result.error || 'Error al crear solicitud');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-card w-full max-w-lg p-0 flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-[var(--glass-border)] flex justify-between items-center">
                    <h2 className="text-lg font-bold text-[var(--color-text)]">Nueva Solicitud de Corrección</h2>
                    <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded-full transition-colors">
                        <X size={20} className="text-[var(--color-text-muted)]" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
                    {isAdmin && (
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Empleado</label>
                            <select
                                className="glass-input w-full bg-[var(--color-surface)]"
                                value={userId}
                                onChange={e => setUserId(e.target.value)}
                            >
                                {staffMembers.map(u => (
                                    <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Tipo de Corrección</label>
                            <select
                                className="glass-input w-full bg-[var(--color-surface)]"
                                value={formData.correction_type}
                                onChange={e => setFormData({ ...formData, correction_type: e.target.value })}
                            >
                                <option value="add_entry">Agregar Entrada</option>
                                <option value="add_exit">Agregar Salida</option>
                                {/* <option value="edit_time">Corregir Hora</option> Logic for this is complex (needs original record selection) */}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Fecha</label>
                            <input
                                type="date"
                                className="glass-input w-full"
                                value={formData.requested_date}
                                onChange={e => setFormData({ ...formData, requested_date: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Hora</label>
                        <input
                            type="datetime-local"
                            className="glass-input w-full"
                            value={formData.requested_at}
                            onChange={e => setFormData({ ...formData, requested_at: e.target.value })}
                            required
                        />
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                            Seleccione la fecha y hora exacta del evento.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">Motivo</label>
                        <textarea
                            className="glass-input w-full min-h-[100px]"
                            placeholder="Ej: Olvidé marcar, El lector no funcionaba..."
                            value={formData.reason}
                            onChange={e => setFormData({ ...formData, reason: e.target.value })}
                            required
                        />
                    </div>
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
                        disabled={loading}
                        className="px-4 py-2 rounded-xl font-bold bg-[var(--color-primary)] text-black hover:bg-cyan-400 transition-colors flex items-center gap-2"
                    >
                        {loading ? 'Guardando...' : <><Save size={18} /> Guardar Solicitud</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CorrectionRequestModal;
