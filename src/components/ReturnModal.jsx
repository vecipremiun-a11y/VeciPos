import React, { useState, useMemo } from 'react';
import { X, RotateCcw, AlertTriangle, Plus, Minus, CheckCircle } from 'lucide-react';
import { formatCurrency } from '../utils/formatCurrency';
import { useStore } from '../store/useStore';

const ReturnModal = ({ sale, onClose, onSuccess }) => {
    const { processReturn, currentCurrency } = useStore();
    const [reason, setReason] = useState('');
    const [returnQtys, setReturnQtys] = useState({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const [alreadyReturned, setAlreadyReturned] = useState({});

    // Load existing returns on mount
    React.useEffect(() => {
        const loadReturns = async () => {
            const { fetchSaleReturns } = useStore.getState();
            const returns = await fetchSaleReturns(sale.id);
            const returned = {};
            for (const ret of returns) {
                for (const item of ret.items) {
                    returned[item.id] = (returned[item.id] || 0) + item.quantity;
                }
            }
            setAlreadyReturned(returned);
        };
        loadReturns();
    }, [sale.id]);

    const items = useMemo(() => {
        if (!sale.items) return [];
        const parsed = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;
        return parsed.map(item => ({
            ...item,
            previouslyReturned: alreadyReturned[item.id] || 0,
            maxReturnable: item.quantity - (alreadyReturned[item.id] || 0)
        }));
    }, [sale.items, alreadyReturned]);

    const updateQty = (itemId, delta, maxReturnable) => {
        setReturnQtys(prev => {
            const current = prev[itemId] || 0;
            const next = Math.max(0, Math.min(maxReturnable, current + delta));
            if (next === 0) {
                const { [itemId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: next };
        });
        setError('');
    };

    const setQty = (itemId, value, maxReturnable) => {
        const num = parseFloat(value) || 0;
        const clamped = Math.max(0, Math.min(maxReturnable, num));
        setReturnQtys(prev => {
            if (clamped === 0) {
                const { [itemId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: clamped };
        });
        setError('');
    };

    const selectedItems = useMemo(() => {
        return Object.entries(returnQtys)
            .filter(([_, qty]) => qty > 0)
            .map(([id, qty]) => {
                const item = items.find(i => String(i.id) === String(id));
                return item ? { ...item, returnQty: qty } : null;
            })
            .filter(Boolean);
    }, [returnQtys, items]);

    const returnTotal = useMemo(() => {
        return selectedItems.reduce((sum, item) => sum + (item.price * item.returnQty), 0);
    }, [selectedItems]);

    const handleConfirm = async () => {
        if (!reason.trim()) {
            setError('Debe indicar el motivo de la devolución');
            return;
        }
        if (selectedItems.length === 0) {
            setError('Seleccione al menos un producto para devolver');
            return;
        }

        setIsProcessing(true);
        setError('');

        const returnItems = selectedItems.map(item => ({
            id: item.id,
            quantity: item.returnQty
        }));

        const result = await processReturn(sale.id, returnItems, reason.trim());

        if (result?.success) {
            onSuccess?.(result.returnTotal);
        } else {
            setError(result?.error || 'Error al procesar la devolución');
            setIsProcessing(false);
        }
    };

    const allFullyReturned = items.every(i => i.maxReturnable <= 0);

    return (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-20 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface)] dark:bg-[#0f0f2d] border border-orange-500/20 rounded-2xl w-full max-w-lg shadow-2xl animate-[float_0.3s_ease-out] flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-5 border-b border-[var(--glass-border)] flex justify-between items-center shrink-0">
                    <h3 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <RotateCcw className="text-orange-400" size={22} />
                        Devolución de Productos
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Sale Info */}
                <div className="px-5 pt-4 pb-2 shrink-0">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-[var(--color-text-muted)]">Venta #{sale.id}</span>
                        <span className="text-[var(--color-text)] font-bold">{formatCurrency(sale.total, currentCurrency)}</span>
                    </div>
                </div>

                {allFullyReturned ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--color-text-muted)]">
                        <CheckCircle size={48} className="text-green-400 mb-3 opacity-60" />
                        <p className="text-sm font-medium">Todos los productos ya fueron devueltos</p>
                    </div>
                ) : (
                    <>
                        {/* Products List */}
                        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
                            <p className="text-xs text-[var(--color-text-muted)] uppercase font-bold mb-2">
                                Seleccione productos y cantidades a devolver
                            </p>
                            {items.map(item => {
                                const currentQty = returnQtys[item.id] || 0;
                                const isReturning = currentQty > 0;
                                const isFullyReturned = item.maxReturnable <= 0;

                                return (
                                    <div
                                        key={item.id}
                                        className={`p-3 rounded-xl border transition-all ${
                                            isFullyReturned
                                                ? 'border-[var(--glass-border)] opacity-40'
                                                : isReturning
                                                ? 'border-orange-500/40 bg-orange-500/5'
                                                : 'border-[var(--glass-border)] hover:border-[var(--glass-border)]/80'
                                        }`}
                                    >
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-[var(--color-text)] text-sm truncate">
                                                    {item.name}
                                                </p>
                                                <div className="flex gap-3 mt-0.5">
                                                    <span className="text-xs text-[var(--color-text-muted)]">
                                                        Vendido: {item.quantity} {item.unit || 'Und'}
                                                    </span>
                                                    {item.previouslyReturned > 0 && (
                                                        <span className="text-xs text-orange-400">
                                                            Devuelto: {item.previouslyReturned}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                                    {formatCurrency(item.price, currentCurrency)} c/u
                                                </p>
                                            </div>

                                            {!isFullyReturned && (
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        onClick={() => updateQty(item.id, -1, item.maxReturnable)}
                                                        disabled={currentQty <= 0}
                                                        className="w-8 h-8 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center text-[var(--color-text)] hover:bg-red-500/20 hover:border-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        <Minus size={14} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        value={currentQty || ''}
                                                        onChange={e => setQty(item.id, e.target.value, item.maxReturnable)}
                                                        placeholder="0"
                                                        min="0"
                                                        max={item.maxReturnable}
                                                        step={item.unit === 'Kg' || item.unit === 'Lt' ? '0.001' : '1'}
                                                        className="w-14 text-center bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg py-1.5 text-sm font-bold text-[var(--color-text)] focus:border-orange-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    />
                                                    <button
                                                        onClick={() => updateQty(item.id, 1, item.maxReturnable)}
                                                        disabled={currentQty >= item.maxReturnable}
                                                        className="w-8 h-8 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center text-[var(--color-text)] hover:bg-green-500/20 hover:border-green-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                            )}

                                            {isFullyReturned && (
                                                <span className="text-[10px] px-2 py-1 rounded-full bg-green-500/20 text-green-400 font-bold shrink-0">
                                                    DEVUELTO
                                                </span>
                                            )}
                                        </div>

                                        {isReturning && (
                                            <div className="mt-2 pt-2 border-t border-[var(--glass-border)]/50 flex justify-between text-xs">
                                                <span className="text-orange-400">Reembolso parcial</span>
                                                <span className="text-orange-400 font-bold">
                                                    {formatCurrency(item.price * currentQty, currentCurrency)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Reason */}
                        <div className="px-5 py-3 shrink-0 border-t border-[var(--glass-border)]">
                            <label className="block text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">
                                Motivo de Devolución (Requerido)
                            </label>
                            <textarea
                                className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-3 text-[var(--color-text)] text-sm focus:border-orange-500/50 focus:outline-none resize-none h-16"
                                placeholder="Ej: Producto defectuoso, cliente insatisfecho, error en la venta..."
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="px-5 pb-2 shrink-0">
                                <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center gap-2">
                                    <AlertTriangle size={14} />
                                    {error}
                                </div>
                            </div>
                        )}

                        {/* Footer */}
                        <div className="p-5 border-t border-[var(--glass-border)] shrink-0">
                            {/* Return Summary */}
                            {selectedItems.length > 0 && (
                                <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-[var(--color-text-muted)]">
                                            {selectedItems.length} producto{selectedItems.length > 1 ? 's' : ''} a devolver
                                        </span>
                                        <span className="text-lg font-bold text-orange-400">
                                            {formatCurrency(returnTotal, currentCurrency)}
                                        </span>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={onClose}
                                    className="flex-1 px-4 py-2.5 bg-[var(--glass-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] rounded-lg text-sm font-bold transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={isProcessing || selectedItems.length === 0 || !reason.trim()}
                                    className="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                                            Procesando...
                                        </>
                                    ) : (
                                        <>
                                            <RotateCcw size={16} />
                                            Confirmar Devolución
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ReturnModal;
