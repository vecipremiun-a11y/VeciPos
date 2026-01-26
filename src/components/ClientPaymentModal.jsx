import React, { useState, useEffect } from 'react';
import { X, Check, DollarSign, CreditCard, Calendar, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ClientPaymentModal = ({ isOpen, onClose, client, sales, onConfirm }) => {
    const [selectedSales, setSelectedSales] = useState([]);
    const [paymentMethod, setPaymentMethod] = useState('Efectivo');

    // Reset selection when opening
    useEffect(() => {
        if (isOpen) {
            setSelectedSales([]);
            setPaymentMethod('Efectivo');
        }
    }, [isOpen]);

    if (!isOpen || !client) return null;

    // Filter pending sales for this client
    const pendingSales = sales.filter(s =>
        s.clientId === client.id &&
        s.paymentMethod === 'Crédito' &&
        s.status !== 'paid' && s.status !== 'cancelled' // Ensure we filter out already paid/cancelled if statuses exist
    ).sort((a, b) => new Date(a.date) - new Date(b.date)); // Oldest first

    const toggleSale = (saleId) => {
        setSelectedSales(prev =>
            prev.includes(saleId)
                ? prev.filter(id => id !== saleId)
                : [...prev, saleId]
        );
    };

    const totalGlobalDebt = pendingSales.reduce((sum, s) => sum + parseFloat(s.total), 0);
    const totalToPay = pendingSales
        .filter(s => selectedSales.includes(s.id))
        .reduce((sum, s) => sum + parseFloat(s.total), 0);

    const remainingDebt = totalGlobalDebt - totalToPay;

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm(selectedSales, totalToPay, paymentMethod);
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl"
                >
                    {/* Neon Glow */}
                    <div className="absolute inset-0 bg-green-500/20 blur-3xl rounded-full opacity-30 pointer-events-none" />

                    <div className="relative glass-card bg-[#0f0f13] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">

                        {/* Header */}
                        <div className="p-6 border-b border-white/10 flex justify-between items-center relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500 to-transparent opacity-75" />
                            <div>
                                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-200 tracking-tight flex items-center gap-2">
                                    <CreditCard className="text-green-500" />
                                    Realizar Abono
                                </h2>
                                <p className="text-green-500/70 font-mono text-sm tracking-widest mt-1">
                                    {client.name}
                                </p>
                            </div>
                            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-white/50 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex flex-col md:flex-row h-full overflow-hidden">
                            {/* Left: List */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 border-r border-white/10 custom-scrollbar">
                                <div className="flex justify-between items-center mb-2 px-2">
                                    <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Pendientes ({pendingSales.length})</span>
                                    <button
                                        onClick={() => setSelectedSales(selectedSales.length === pendingSales.length ? [] : pendingSales.map(s => s.id))}
                                        className="text-xs text-green-400 hover:text-green-300 transition-colors"
                                    >
                                        {selectedSales.length === pendingSales.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                                    </button>
                                </div>

                                {pendingSales.length === 0 ? (
                                    <div className="text-center py-10 text-white/30 italic">
                                        No hay deudas pendientes.
                                    </div>
                                ) : (
                                    pendingSales.map(sale => {
                                        const isSelected = selectedSales.includes(sale.id);
                                        return (
                                            <div
                                                key={sale.id}
                                                onClick={() => toggleSale(sale.id)}
                                                className={`
                                                    p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 group
                                                    ${isSelected
                                                        ? 'bg-green-500/10 border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.1)]'
                                                        : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                                    }
                                                `}
                                            >
                                                <div className={`
                                                    w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0
                                                    ${isSelected ? 'bg-green-500 border-green-500 text-black' : 'border-white/30 group-hover:border-green-500/50'}
                                                `}>
                                                    {isSelected && <Check size={14} strokeWidth={4} />}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-start">
                                                        <span className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-white/70'}`}>
                                                            {new Date(sale.date).toLocaleDateString()}
                                                        </span>
                                                        <span className={`font-mono font-bold ${isSelected ? 'text-green-400' : 'text-white/50'}`}>
                                                            ${parseFloat(sale.total).toLocaleString('es-CL')}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-white/40 truncate mt-0.5">
                                                        {sale.summary}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Right: Totals & Action */}
                            <div className="w-full md:w-72 bg-black/20 p-6 flex flex-col gap-6 shrink-0">
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2 block">Resumen</label>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-white/60">Deuda Total</span>
                                                <span className="text-white font-mono">${totalGlobalDebt.toLocaleString('es-CL')}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-green-400 font-bold">Abono Seleccionado</span>
                                                <span className="text-green-400 font-mono font-bold">-${totalToPay.toLocaleString('es-CL')}</span>
                                            </div>
                                            <div className="border-t border-white/10 my-2 pt-2 flex justify-between text-sm">
                                                <span className="text-white/60">Restante</span>
                                                <span className="text-white font-mono opacity-80">${remainingDebt.toLocaleString('es-CL')}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2 block">Medio de Pago</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['Efectivo', 'Tarjeta', 'Transferencia'].map(method => (
                                                <button
                                                    key={method}
                                                    onClick={() => setPaymentMethod(method)}
                                                    className={`
                                                        px-3 py-2 rounded-lg text-xs font-bold transition-colors border
                                                        ${paymentMethod === method
                                                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                                                            : 'bg-white/5 text-white/50 border-transparent hover:bg-white/10'
                                                        }
                                                    `}
                                                >
                                                    {method}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-auto">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={totalToPay <= 0}
                                        className={`
                                            w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all
                                            ${totalToPay > 0
                                                ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:scale-[1.02]'
                                                : 'bg-white/10 text-white/20 cursor-not-allowed'
                                            }
                                        `}
                                    >
                                        <Check size={24} />
                                        Confirmar Abono
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ClientPaymentModal;
