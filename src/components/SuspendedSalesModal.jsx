import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, User, ShoppingCart, Trash2, RotateCcw, Loader } from 'lucide-react';
import { useStore } from '../store/useStore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrency } from '../utils/formatCurrency';

const SuspendedSalesModal = ({ isOpen, onClose }) => {
    const { fetchSuspendedSales, recoverSale, deleteSuspendedSale, currentCurrency } = useStore();
    const [sales, setSales] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [recoveringId, setRecoveringId] = useState(null);

    useEffect(() => {
        if (isOpen) {
            loadSales();
        }
    }, [isOpen]);

    const loadSales = async () => {
        setIsLoading(true);
        const data = await fetchSuspendedSales();
        setSales(data);
        setIsLoading(false);
    };

    const handleRecover = async (saleId) => {
        setRecoveringId(saleId);
        const success = await recoverSale(saleId);
        if (success) {
            onClose();
        } else {
            setRecoveringId(null);
        }
    };

    const handleDelete = async (saleId) => {
        if (!confirm('¿Eliminar esta venta suspendida?')) return;

        await deleteSuspendedSale(saleId);
        loadSales(); // Recargar lista
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-card w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <div>
                        <h2 className="text-xl font-bold text-white">Ventas Suspendidas</h2>
                        <p className="text-sm text-gray-400">Recupera o elimina ventas pendientes</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Lista de ventas */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                    {isLoading ? (
                        <div className="text-center text-gray-400 py-12">
                            <Loader className="animate-spin mx-auto mb-2" size={32} />
                            <p>Cargando ventas...</p>
                        </div>
                    ) : sales.length === 0 ? (
                        <div className="text-center text-gray-400 py-12">
                            <ShoppingCart size={48} className="mx-auto mb-3 opacity-50" />
                            <p className="text-lg font-medium">No hay ventas suspendidas</p>
                            <p className="text-sm">Las ventas suspendidas aparecerán aquí</p>
                        </div>
                    ) : (
                        sales.map(sale => (
                            <div
                                key={sale.id}
                                className="bg-white/5 rounded-lg p-4 flex items-center justify-between border border-white/10 hover:bg-white/10 transition-colors"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="text-white font-bold text-xl">
                                            {formatCurrency(sale.total, currentCurrency)}
                                        </span>
                                        <span className="text-gray-400 text-sm flex items-center gap-1 bg-white/5 px-2 py-1 rounded">
                                            <ShoppingCart size={14} />
                                            {sale.items_count} items
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-400">
                                        <span className="flex items-center gap-1">
                                            <User size={12} />
                                            {sale.user_name || 'Usuario'}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock size={12} />
                                            {format(new Date(sale.suspended_at), "dd/MM/yy HH:mm", { locale: es })}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleRecover(sale.id)}
                                        disabled={recoveringId === sale.id}
                                        className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-500/50 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2 font-medium transition-colors"
                                    >
                                        {recoveringId === sale.id ? (
                                            <>
                                                <Loader className="animate-spin" size={16} />
                                                Recuperando...
                                            </>
                                        ) : (
                                            <>
                                                <RotateCcw size={16} />
                                                Recuperar
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleDelete(sale.id)}
                                        className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                                        title="Eliminar venta"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-black/20">
                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default SuspendedSalesModal;
