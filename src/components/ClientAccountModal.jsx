import React, { useState, useEffect } from 'react';
import { X, Calendar, DollarSign, FileText, ArrowRight, Check } from 'lucide-react';
import { useStore } from '../store/useStore';

const ClientAccountModal = ({ isOpen, onClose, client }) => {
    const { sales } = useStore(); // Ensure we have latest sales
    const [clientSales, setClientSales] = useState([]);

    useEffect(() => {
        if (isOpen && client) {
            // Filter sales for this client that are marked as 'Crédito'
            const debts = sales.filter(s =>
                s.clientId === client.id &&
                s.paymentMethod === 'Crédito'
            ).sort((a, b) => new Date(b.date) - new Date(a.date));
            setClientSales(debts);
        }
    }, [isOpen, client, sales]);

    if (!isOpen || !client) return null;

    const totalDebt = clientSales.reduce((sum, sale) => sum + parseFloat(sale.total), 0);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div
                className="bg-[#18181b] border border-[var(--glass-border)] rounded-xl w-full max-w-2xl p-0 overflow-hidden flex flex-col max-h-[85vh] shadow-2xl relative"
            >
                {/* Header */}
                <div className="p-6 border-b border-[var(--glass-border)] flex justify-between items-center bg-[var(--glass-bg)]">
                    <div>
                        <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                            <FileText className="text-[var(--color-primary)]" />
                            Estado de Cuenta
                        </h2>
                        <p className="text-[var(--color-text-muted)] text-sm">{client.name}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors p-2 hover:bg-white/5 rounded-full"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Summary */}
                <div className="p-6 bg-red-500/5 border-b border-[var(--glass-border)] flex justify-between items-center">
                    <div>
                        <p className="text-[var(--color-text-muted)] text-sm font-medium uppercase tracking-wider">Deuda Total</p>
                        <p className="text-4xl font-bold text-red-500 mt-1">${totalDebt.toLocaleString('es-CL')}</p>
                    </div>
                    {/* Placeholder for Pay Debt button */}
                    <button className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-bold cursor-not-allowed opacity-70" title="Próximamente">
                        Pagar Deuda
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-0">
                    {clientSales.length > 0 ? (
                        <div className="divide-y divide-[var(--glass-border)]">
                            {clientSales.map(sale => (
                                <div key={sale.id} className="p-4 hover:bg-white/5 transition-colors flex justify-between items-center group">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-xs">
                                            <Calendar size={12} />
                                            {new Date(sale.date).toLocaleString()}
                                        </div>
                                        <p className="font-medium text-[var(--color-text)]">{sale.summary}</p>
                                        <p className="text-xs text-[var(--color-text-muted)] italic">{sale.observation || 'Sin observaciones'}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-red-400 text-lg">-${parseFloat(sale.total).toLocaleString('es-CL')}</p>
                                        <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">Crédito</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-12 text-center text-[var(--color-text-muted)] flex flex-col items-center gap-3">
                            <Check size={48} className="text-green-500/50" />
                            <p>Este cliente no tiene deudas pendientes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ClientAccountModal;
