import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { format } from 'date-fns';
import { Check, X, Clock, User, MessageSquare, AlertCircle, ArrowRight, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import CorrectionRequestModal from './CorrectionRequestModal';

const CorrectionsInbox = () => {
    const {
        pendingCorrections,
        fetchPendingCorrections,
        fetchCorrectionsByStatus,
        approveCorrection,
        rejectCorrection,
        currentUser
    } = useStore();

    const [activeTab, setActiveTab] = useState('pending');
    const [historyData, setHistoryData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Action Modal State
    const [selectedCorrection, setSelectedCorrection] = useState(null);
    const [actionType, setActionType] = useState(null); // 'approve' | 'reject'
    const [notes, setNotes] = useState('');
    const [showRequestModal, setShowRequestModal] = useState(false);

    useEffect(() => {
        if (activeTab === 'pending') {
            fetchPendingCorrections();
        } else {
            loadHistory(activeTab);
        }
    }, [activeTab]);

    const loadHistory = async (status) => {
        setLoading(true);
        const data = await fetchCorrectionsByStatus(status);
        setHistoryData(data);
        setLoading(false);
    };

    const handleAction = (correction, action) => {
        setSelectedCorrection(correction);
        setActionType(action);
        setNotes('');
    };

    const confirmAction = async () => {
        if (!selectedCorrection) return;

        const result = actionType === 'approve'
            ? await approveCorrection(selectedCorrection.id, notes, currentUser.username)
            : await rejectCorrection(selectedCorrection.id, notes, currentUser.username);

        if (result && result.success) {
            setSelectedCorrection(null);
            setActionType(null);
            if (activeTab === 'pending') fetchPendingCorrections();
            else loadHistory(activeTab);
        } else {
            alert(result?.error || 'Error al procesar la solicitud');
        }
    };

    const getTranslation = (type) => {
        const types = {
            'add_entry': 'Agregar Entrada',
            'add_exit': 'Agregar Salida',
            'edit_time': 'Corregir Hora',
            'delete': 'Eliminar Marca'
        };
        return types[type] || type;
    };

    const displayedData = activeTab === 'pending' ? pendingCorrections : historyData;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Actions */}
            <div className="flex justify-between items-center">
                {/* Tabs */}
                <div className="flex gap-2 p-1 bg-[var(--color-surface)] rounded-xl w-fit border border-[var(--glass-border)]">
                    {['pending', 'approved', 'rejected'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={cn(
                                "px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize relative",
                                activeTab === tab
                                    ? "bg-[var(--glass-bg)] shadow text-[var(--color-text)]"
                                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                            )}
                        >
                            {tab === 'pending' ? 'Pendientes' : tab === 'approved' ? 'Aprobadas' : 'Rechazadas'}
                            {tab === 'pending' && pendingCorrections.length > 0 && (
                                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">
                                    {pendingCorrections.length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => setShowRequestModal(true)}
                    className="btn-primary flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
                >
                    <Plus size={16} />
                    Nueva Solicitud
                </button>
            </div>

            {showRequestModal && (
                <CorrectionRequestModal
                    onClose={() => setShowRequestModal(false)}
                    onSuccess={() => {
                        if (activeTab === 'pending') fetchPendingCorrections();
                    }}
                />
            )}

            {/* List */}
            <div className="grid gap-4">
                {loading ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando...</div>
                ) : displayedData.length === 0 ? (
                    <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                        No hay solicitudes {activeTab === 'pending' ? 'pendientes' : activeTab === 'approved' ? 'aprobadas' : 'rechazadas'}.
                    </div>
                ) : (
                    displayedData.map(item => (
                        <div key={item.id} className="glass-card p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-[var(--color-primary)] font-bold">
                                    {item.name ? item.name[0] : 'U'}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <p className="font-bold text-[var(--color-text)]">{item.name}</p>
                                        <span className="text-xs text-[var(--color-text-muted)]">• {format(new Date(item.created_at), 'dd/MM/yyyy HH:mm')}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                                            <span className="font-medium bg-[var(--glass-bg)] px-2 py-0.5 rounded text-xs border border-[var(--glass-border)]">
                                                {getTranslation(item.correction_type)}
                                            </span>
                                            <span className="text-[var(--color-text-muted)]">para el</span>
                                            <span className="font-medium">{format(new Date(item.requested_date), 'dd/MM/yyyy')}</span>
                                        </div>
                                        {item.requested_at && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Clock size={14} className="text-[var(--color-text-muted)]" />
                                                <span className="text-[var(--color-text-muted)]">Hora solicitada:</span>
                                                <span className="font-bold text-[var(--color-primary)]">{format(new Date(item.requested_at), 'HH:mm')}</span>
                                            </div>
                                        )}
                                        <div className="flex items-start gap-2 text-sm mt-1 bg-[var(--glass-bg)] p-2 rounded-lg max-w-md">
                                            <MessageSquare size={14} className="text-[var(--color-text-muted)] mt-0.5 shrink-0" />
                                            <p className="text-[var(--color-text-muted)] italic">"{item.reason}"</p>
                                        </div>

                                        {activeTab !== 'pending' && item.reviewer_notes && (
                                            <div className="mt-2 text-xs text-[var(--color-text-muted)] border-t border-[var(--glass-border)] pt-2">
                                                <span className="font-bold">Revisor:</span> {item.reviewer_notes}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {activeTab === 'pending' && (
                                <div className="flex gap-2 self-end md:self-center">
                                    <button
                                        onClick={() => handleAction(item, 'reject')}
                                        className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all flex items-center gap-2"
                                    >
                                        <X size={18} />
                                        <span className="text-sm font-medium">Rechazar</span>
                                    </button>
                                    <button
                                        onClick={() => handleAction(item, 'approve')}
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
                                    item.status === 'approved' ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
                                )}>
                                    {item.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Confirmation Modal */}
            {selectedCorrection && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-card w-full max-w-md p-6 relative animate-in fade-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold mb-4 text-[var(--color-text)]">
                            {actionType === 'approve' ? 'Aprobar Solicitud' : 'Rechazar Solicitud'}
                        </h3>
                        <p className="text-sm text-[var(--color-text-muted)] mb-4">
                            {actionType === 'approve'
                                ? 'Se aplicarán los cambios en el registro de asistencia.'
                                : 'La solicitud será rechazada y el usuario será notificado.'}
                        </p>

                        <div className="mb-4">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase">
                                Notas del Revisor (Opcional)
                            </label>
                            <textarea
                                className="glass-input w-full min-h-[80px]"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="Escribe un comentario..."
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setSelectedCorrection(null)}
                                className="flex-1 px-4 py-2 rounded-xl text-[var(--color-text)] bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] border border-[var(--glass-border)] transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmAction}
                                className={cn(
                                    "flex-1 px-4 py-2 rounded-xl font-bold transition-colors",
                                    actionType === 'approve' ? "btn-primary" : "bg-red-500 text-white hover:bg-red-600"
                                )}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CorrectionsInbox;
