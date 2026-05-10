import React, { useState, useEffect } from 'react';
import { AlertCircle, X, Package } from 'lucide-react';
import { useStore } from '../store/useStore';

const CriticalAlertsModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [alerts, setAlerts] = useState({ criticalProducts: [], lowProducts: [] });
    const { fetchAlertSummary } = useStore();

    useEffect(() => {
        // Check once on mount (after login)
        if (sessionStorage.getItem('poskem_login_alerts_shown')) return;

        fetchAlertSummary().then(data => {
            if (data && data.criticalProducts?.length > 0) {
                setAlerts(data);
                setIsOpen(true);
                sessionStorage.setItem('poskem_login_alerts_shown', '1');
            }
        });
    }, []);

    if (!isOpen || alerts.criticalProducts.length === 0) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-md glass-card border-2 border-red-500/50 animate-[float_0.4s_ease-out]">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-red-500/30 pb-3 mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-500/20 rounded-xl">
                            <AlertCircle size={24} className="text-red-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-red-400">Alertas Críticas</h2>
                            <p className="text-xs text-[var(--color-text-muted)]">
                                {alerts.criticalProducts.length} producto{alerts.criticalProducts.length !== 1 ? 's' : ''} en estado crítico
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-1.5 hover:bg-white/10 rounded-lg text-[var(--color-text-muted)] hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Critical Products List */}
                <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                    {alerts.criticalProducts.map(p => (
                        <div key={p.product_id} className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                            <div className="flex items-center gap-3 min-w-0">
                                <Package size={16} className="text-red-400 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-white truncate">{p.name}</p>
                                    <p className="text-[10px] text-[var(--color-text-muted)]">
                                        Mínimo crítico: {p.critical_stock} | SKU: {p.sku || 'N/A'}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <span className="text-lg font-bold text-red-400">{p.stock}</span>
                                <p className="text-[10px] text-red-500/60">und.</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Low stock summary */}
                {alerts.lowProducts?.length > 0 && (
                    <p className="text-xs text-amber-400/80 mb-4">
                        Además, {alerts.lowProducts.length} producto{alerts.lowProducts.length !== 1 ? 's' : ''} con stock bajo.
                    </p>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={() => setIsOpen(false)}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] transition-colors text-sm font-medium"
                    >
                        Entendido
                    </button>
                    <button
                        onClick={() => {
                            setIsOpen(false);
                            window.location.href = '/inventory';
                        }}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors text-sm font-bold"
                    >
                        Ir a Inventario
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CriticalAlertsModal;
