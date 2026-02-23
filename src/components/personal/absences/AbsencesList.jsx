import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Plus, Trash2, Calendar, User, FileText } from 'lucide-react';
import { cn } from '../../../lib/utils';
import AbsenceModal from './AbsenceModal';

const AbsencesList = () => {
    const { fetchAbsences, deleteAbsence, staffMembers, fetchStaffMembers } = useStore();
    const [absences, setAbsences] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

    useEffect(() => {
        fetchStaffMembers();
    }, []);

    useEffect(() => {
        loadAbsences();
    }, [startDate, endDate]);

    const loadAbsences = async () => {
        setLoading(true);
        const data = await fetchAbsences(startDate, endDate);
        setAbsences(data || []);
        setLoading(false);
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este registro de ausencia?")) return;
        setLoading(true);
        const result = await deleteAbsence(id);
        if (result.success) loadAbsences();
        else alert(result.error);
        setLoading(false);
    };

    const getUserName = (id) => {
        const user = staffMembers.find(u => u.id === id);
        return user ? user.name : 'Desconocido';
    };

    const getTypeLabel = (type) => {
        const types = {
            'medical': 'Licencia Médica',
            'permission': 'Permiso Personal',
            'vacation': 'Vacaciones',
            'unjustified': 'Falta Injustificada',
            'other': 'Otro'
        };
        return types[type] || type;
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-500">
            {/* Header with Filters & Add Button */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-end bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <div className="flex gap-4 items-end">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Desde</label>
                        <input
                            type="date"
                            className="glass-input"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Hasta</label>
                        <input
                            type="date"
                            className="glass-input"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                        />
                    </div>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm whitespace-nowrap"
                >
                    <Plus size={16} />
                    Registrar Ausencia
                </button>
            </div>

            {/* List */}
            <div className="grid gap-4">
                {loading ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando ausencias...</div>
                ) : absences.length === 0 ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                        No hay ausencias registradas en este periodo.
                    </div>
                ) : (
                    absences.map(absence => (
                        <div key={absence.id} className="glass-card p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <p className="font-bold text-[var(--color-text)]">{getUserName(absence.user_id)}</p>
                                    <p className="text-sm text-[var(--color-text-muted)]">{getTypeLabel(absence.type)}</p>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row gap-4 md:items-center text-sm">
                                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                                    <Calendar size={14} />
                                    <span>{format(new Date(absence.start_date), 'dd/MM/yyyy')} - {format(new Date(absence.end_date), 'dd/MM/yyyy')}</span>
                                </div>
                                <div className="hidden md:block w-px h-4 bg-[var(--glass-border)]"></div>
                                <p className="text-[var(--color-text-muted)] max-w-xs truncate italic">"{absence.reason}"</p>
                            </div>

                            <button
                                onClick={() => handleDelete(absence.id)}
                                className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors self-end md:self-center"
                                title="Eliminar"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    ))
                )}
            </div>

            <AbsenceModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadAbsences} />
        </div>
    );
};
export default AbsencesList;
