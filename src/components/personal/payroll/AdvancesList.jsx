import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Plus, Trash2, Calendar, User, DollarSign } from 'lucide-react';
import { cn } from '../../../lib/utils';
import AdvanceModal from './AdvanceModal';

const AdvancesList = () => {
    const { fetchAdvances, deleteAdvance, staffMembers, fetchStaffMembers } = useStore();
    const [advances, setAdvances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

    useEffect(() => {
        fetchStaffMembers();
    }, []);

    useEffect(() => {
        loadAdvances();
    }, [startDate, endDate]);

    const loadAdvances = async () => {
        setLoading(true);
        // fetchAdvances params: userId, startDate, endDate
        const data = await fetchAdvances(null, startDate, endDate);
        setAdvances(data || []);
        setLoading(false);
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este adelanto?")) return;
        try {
            const result = await deleteAdvance(id);
            if (result.success) loadAdvances();
            else alert(result.error);
        } catch (e) {
            console.error(e);
            alert("Error al eliminar");
        }
    };

    const getUserName = (id) => {
        const user = staffMembers.find(u => u.id === id);
        return user ? user.name : 'Desconocido';
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
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
                    Nuevo Adelanto
                </button>
            </div>

            {/* List */}
            <div className="grid gap-4">
                {loading ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando adelantos...</div>
                ) : advances.length === 0 ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                        No hay adelantos registrados en este periodo.
                    </div>
                ) : (
                    advances.map(item => (
                        <div key={item.id} className="glass-card p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                                    <DollarSign size={20} />
                                </div>
                                <div>
                                    <p className="font-bold text-[var(--color-text)]">{getUserName(item.user_id)}</p>
                                    <p className="text-sm text-[var(--color-text-muted)]">{item.advance_date ? format(new Date(item.advance_date), 'dd/MM/yyyy') : '-'}</p>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row gap-8 md:items-center">
                                <span className="text-lg font-bold text-[var(--color-primary)]">
                                    {formatCurrency(item.amount)}
                                </span>

                                {item.is_deducted ? (
                                    <span className="text-xs font-medium bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/30">
                                        Descontado
                                    </span>
                                ) : (
                                    <span className="text-xs font-medium bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded border border-yellow-500/30">
                                        Pendiente
                                    </span>
                                )}

                                {item.reason && (
                                    <p className="text-sm text-[var(--color-text-muted)] italic max-w-xs truncate">
                                        "{item.reason}"
                                    </p>
                                )}
                            </div>

                            {!item.is_deducted && (
                                <button
                                    onClick={() => handleDelete(item.id)}
                                    className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors self-end md:self-center"
                                    title="Eliminar"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>

            <AdvanceModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={loadAdvances} />
        </div>
    );
};

export default AdvancesList;
