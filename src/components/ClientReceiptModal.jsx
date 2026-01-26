import React from 'react';
import { X, Receipt, Calendar, User, DollarSign, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ClientReceiptModal = ({ isOpen, onClose, sale, client }) => {
    if (!isOpen || !sale) return null;

    const receiptItems = sale.items || [];
    const totalAmount = parseFloat(sale.total);

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative w-full max-w-md"
                >
                    {/* Neon Glow Behind */}
                    <div className="absolute inset-0 bg-cyan-500/20 blur-3xl rounded-full opacity-50 pointer-events-none" />

                    {/* Ticket Container */}
                    <div className="relative bg-[#0f0f13] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        {/* Header with Neon Effect */}
                        <div className="p-6 pb-4 border-b border-white/10 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-75" />

                            <div className="flex justify-between items-start relative z-10">
                                <div>
                                    <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-cyan-200 tracking-tight" style={{ textShadow: '0 0 20px rgba(34, 211, 238, 0.5)' }}>
                                        BOLETA
                                    </h2>
                                    <p className="text-cyan-500/70 font-mono text-sm tracking-widest mt-1">
                                        DETALLE #{sale.id.toString().slice(-6)}
                                    </p>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-full hover:bg-white/5 text-white/50 hover:text-white transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Content Scroll */}
                        <div className="overflow-y-auto p-6 space-y-6 custom-scrollbar">
                            {/* Info Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                                    <div className="flex items-center gap-2 text-xs text-white/40 mb-1 uppercase tracking-wider">
                                        <Calendar size={12} /> Fecha
                                    </div>
                                    <p className="text-white font-medium text-sm">
                                        {new Date(sale.date).toLocaleDateString()}
                                    </p>
                                    <p className="text-white/40 text-xs">
                                        {new Date(sale.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                                    <div className="flex items-center gap-2 text-xs text-white/40 mb-1 uppercase tracking-wider">
                                        <User size={12} /> Cliente
                                    </div>
                                    <p className="text-white font-medium text-sm truncate">
                                        {client?.name || 'Cliente'}
                                    </p>
                                    <p className="text-white/40 text-xs truncate">
                                        {client?.rut || 'Sin RUT'}
                                    </p>
                                </div>
                            </div>

                            {/* Items List */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-bold text-cyan-500/80 uppercase tracking-wider mb-2">
                                    <Package size={12} /> Productos ({receiptItems.length})
                                </div>

                                <div className="space-y-2">
                                    {receiptItems.map((item, index) => (
                                        <div key={index} className="flex justify-between items-center p-3 rounded-lg hover:bg-white/5 transition-colors group">
                                            <div className="flex-1 min-w-0 pr-4">
                                                <p className="text-white/90 font-medium text-sm truncate">{item.name}</p>
                                                <p className="text-white/40 text-xs">
                                                    {item.quantity} x ${parseFloat(item.price).toLocaleString('es-CL')}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-white font-bold tabular-nums">
                                                    ${(item.quantity * item.price).toLocaleString('es-CL')}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Footer Totals */}
                        <div className="p-6 bg-white/5 border-t border-white/10 relative">
                            {/* Decorative Bottom Glow */}
                            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-1 bg-cyan-500 blur-sm opacity-50" />

                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-sm text-white/50">
                                    <span>Subtotal</span>
                                    <span>${totalAmount.toLocaleString('es-CL')}</span>
                                </div>

                                <div className="border-t border-dashed border-white/10 my-2" />

                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">Total a Pagar</p>
                                        <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 px-2 py-1 rounded-md">
                                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                            Pendiente (Crédito)
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-3xl font-black text-white tracking-tight tabular-nums" style={{ textShadow: '0 0 30px rgba(34, 211, 238, 0.3)' }}>
                                            ${totalAmount.toLocaleString('es-CL')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ClientReceiptModal;
