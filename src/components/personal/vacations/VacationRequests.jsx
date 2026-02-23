import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format } from 'date-fns';
import { Check, X, Calendar, User, MessageSquare, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import RequestVacationModal from './RequestVacationModal';

const VacationRequests = () => {
    const {
        vacationRequests,
        fetchVacationRequests,
        approveVacation,
        rejectVacation,
        currentUser
    } = useStore();

    const [activeTab, setActiveTab] = useState('pending');
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadRequests();
    }, [activeTab]);

    const loadRequests = async () => {
        setLoading(true);
        await fetchVacationRequests(activeTab);
        setLoading(false);
    };

    const handleApprove = async (id) => {
        if (!window.confirm("¿Aprobar solicitud de vacaciones?")) return;
        const result = await approveVacation(id, currentUser.username);
        if (result.success) loadRequests();
        else alert(result.error);
    };

    const handleReject = async (id) => {
        // Maybe open a modal for rejection reason? For now simple confirm
        if (!window.confirm("¿Rechazar solicitud de vacaciones?")) return;
        const result = await rejectVacation(id, currentUser.username);
        if (result.success) loadRequests();
        else alert(result.error);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex justify-between items-center bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <div className="flex gap-2 p-1 bg-[var(--color-surface)] rounded-xl w-fit border border-[var(--glass-border)]">
                    {['pending', 'approved', 'rejected'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={cn(
                                "px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize",
                                activeTab === tab
                                    ? "bg-[var(--glass-bg)] shadow text-[var(--color-text)]"
                                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                            )}
                        >
                            {tab === 'pending' ? 'Pendientes' : tab === 'approved' ? 'Aprobadas' : 'Rechazadas'}
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => setIsModalOpen(true)}
                    className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
                >
                    <Plus size={16} />
                    Nueva Solicitud
                </button>
            </div>

            {/* List */}
            <div className="grid gap-4">
                {loading ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando solicitudes...</div>
                ) : vacationRequests.length === 0 ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                        No hay solicitudes {activeTab === 'pending' ? 'pendientes' : activeTab === 'approved' ? 'aprobadas' : 'rechazadas'}.
                    </div>
                ) : (
                    vacationRequests.map(req => (
                        <div key={req.id} className="glass-card p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 font-bold">
                                    {req.name ? req.name[0] : 'U'}
                                </div>
                                <div>
                                    <p className="font-bold text-[var(--color-text)]">{req.name}</p>
                                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                        <Calendar size={14} />
                                        <span>{format(new Date(req.start_date), 'dd/MM/yyyy')} - {format(new Date(req.end_date), 'dd/MM/yyyy')}</span>
                                        <span className="bg-[var(--glass-bg)] px-2 py-0.5 rounded text-xs font-bold text-[var(--color-text)] border border-[var(--glass-border)]">
                                            {req.days} días
                                        </span>
                                    </div>
                                    {req.comments && (
                                        <p className="text-xs text-[var(--color-text-muted)] mt-1 italic">"{req.comments}"</p>
                                    )}
                                </div>
                            </div>

                            {activeTab === 'pending' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleReject(req.id)}
                                        className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all"
                                        title="Rechazar"
                                    >
                                        <X size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleApprove(req.id)}
                                        className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-black font-medium hover:bg-cyan-400 transition-all flex items-center gap-2"
                                    >
                                        <Check size={18} />
                                        Aprobar
                                    </button>
                                </div>
                            )}

                            {activeTab !== 'pending' && (
                                <div className={cn(
                                    "px-3 py-1 rounded-full text-xs font-medium border",
                                    req.status === 'approved' ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
                                )}>
                                    {req.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <RequestVacationModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={loadRequests}
            />
        </div>
    );
};

export default VacationRequests;
