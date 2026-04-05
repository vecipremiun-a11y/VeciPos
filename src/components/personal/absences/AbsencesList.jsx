import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Plus, Trash2, Calendar, Clock, Coffee } from 'lucide-react';
import { cn } from '../../../lib/utils';
import AbsenceModal, { ABSENCE_TYPES } from './AbsenceModal';

const AbsencesList = () => {
    const { fetchAbsences, deleteAbsence, deleteAbsenceGroup, staffMembers, fetchStaffMembers } = useStore();
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
        // Group by group_id for display
        const grouped = [];
        const seen = new Set();
        for (const a of (data || [])) {
            const key = a.group_id || `single_${a.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const groupItems = a.group_id ? data.filter(x => x.group_id === a.group_id) : [a];
            const dates = groupItems.map(x => x.absence_date).sort();
            grouped.push({
                ...a,
                dateStart: dates[0],
                dateEnd: dates[dates.length - 1],
                dayCount: dates.length,
            });
        }
        setAbsences(grouped);
        setLoading(false);
    };

    const handleDelete = async (absence) => {
        const msg = absence.dayCount > 1
            ? `¿Eliminar las ${absence.dayCount} ausencias de este registro (${absence.dateStart} al ${absence.dateEnd})?`
            : '¿Eliminar este registro de ausencia?';
        if (!window.confirm(msg)) return;
        setLoading(true);
        const result = absence.group_id
            ? await deleteAbsenceGroup(absence.group_id)
            : await deleteAbsence(absence.id);
        if (result.success) loadAbsences();
        else alert(result.error);
        setLoading(false);
    };

    const getUserName = (id) => {
        const user = staffMembers.find(u => u.id === id);
        return user ? user.name : 'Desconocido';
    };

    const getTypeMeta = (type) => ABSENCE_TYPES.find(t => t.value === type) || ABSENCE_TYPES[ABSENCE_TYPES.length - 1];

    return (
        <div className="space-y-4 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-end bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <div className="flex gap-4 items-end">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Desde</label>
                        <input type="date" className="glass-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Hasta</label>
                        <input type="date" className="glass-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                </div>
                <button onClick={() => setIsModalOpen(true)} className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm whitespace-nowrap">
                    <Plus size={16} /> Registrar Ausencia
                </button>
            </div>

            {/* Cards */}
            <div className="grid gap-3">
                {loading ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando ausencias...</div>
                ) : absences.length === 0 ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">No hay ausencias registradas en este periodo.</div>
                ) : (
                    absences.map(absence => {
                        const meta = getTypeMeta(absence.type);
                        return (
                            <div key={absence.group_id || absence.id} className={cn("glass-card p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center border-l-4", meta.color.split(' ')[0].replace('/15', '/40'))}>
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0", meta.color.split(' ')[0])}>
                                        {meta.emoji}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-[var(--color-text)] truncate">{getUserName(absence.user_id)}</p>
                                        <p className="text-sm text-[var(--color-text-muted)]">
                                            {meta.emoji} {meta.label}
                                            {absence.half_day ? (
                                                <span className="ml-1 inline-flex items-center gap-0.5 text-xs">
                                                    <Coffee size={10} /> Medio día ({absence.half_day_period === 'morning' ? 'Mañana' : 'Tarde'})
                                                </span>
                                            ) : absence.hours ? (
                                                <span className="ml-1 inline-flex items-center gap-0.5 text-xs">
                                                    <Clock size={10} /> {absence.hours}h
                                                </span>
                                            ) : null}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-col md:flex-row gap-3 md:items-center text-sm flex-shrink-0">
                                    <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                                        <Calendar size={14} />
                                        <span>
                                            {absence.dateStart === absence.dateEnd
                                                ? format(new Date(absence.dateStart + 'T12:00:00'), 'dd/MM/yyyy')
                                                : `${format(new Date(absence.dateStart + 'T12:00:00'), 'dd/MM')} - ${format(new Date(absence.dateEnd + 'T12:00:00'), 'dd/MM/yyyy')}`
                                            }
                                            {absence.dayCount > 1 && ` (${absence.dayCount} días)`}
                                        </span>
                                    </div>
                                    {absence.notes && (
                                        <p className="text-[var(--color-text-muted)] max-w-[200px] truncate italic text-xs">"{absence.notes}"</p>
                                    )}
                                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold uppercase",
                                        absence.status === 'approved' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                                        absence.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                                        'bg-red-500/15 text-red-600 dark:text-red-400'
                                    )}>
                                        {absence.status === 'approved' ? 'Aprobada' : absence.status === 'pending' ? 'Pendiente' : 'Rechazada'}
                                    </span>
                                </div>

                                <button
                                    onClick={() => handleDelete(absence)}
                                    className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors self-end md:self-center flex-shrink-0"
                                    title="Eliminar"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            <AbsenceModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadAbsences} />
        </div>
    );
};
export default AbsencesList;
