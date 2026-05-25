import React, { useState } from 'react';
import { CakeSlice, Check, X, Eye, Clock } from 'lucide-react';
import { formatCurrency } from '../utils/formatCurrency';

// Tarjeta de "Encargo amasandería": aviso de un encargo que entró desde la web.
// Se usa igual en el toast (abajo-izquierda) y dentro de la campanita.
// Props:
//   order        { id, public_code, client_name, items_summary, due_date, due_time, total }
//   currency     código de moneda activo (ej. 'CLP')
//   onAccept(id) confirmar el encargo
//   onReject(id) rechazar el encargo
//   onView(id)   ir a Encargos a ver detalles
//   onClose(id)  cerrar (X) — solo en el toast; en la campanita se omite
const WebOrderCard = ({ order, currency = 'CLP', onAccept, onReject, onView, onClose }) => {
    const [busy, setBusy] = useState(false);

    const run = async (fn) => {
        if (busy) return;
        setBusy(true);
        try { await fn?.(order.id); } finally { setBusy(false); }
    };

    const dateLabel = [order.due_date, order.due_time].filter(Boolean).join(' · ');

    return (
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] overflow-hidden">
            {/* Header */}
            <div className="flex items-start gap-3 px-4 pt-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
                    <CakeSlice size={18} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-[var(--color-text)]">Encargo amasandería</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Web
                        </span>
                    </div>
                    <p className="text-sm text-[var(--color-text)] truncate mt-0.5">{order.client_name}</p>
                </div>
                {onClose && (
                    <button
                        onClick={() => onClose(order.id)}
                        className="p-1 -mr-1 -mt-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
                        title="Cerrar aviso"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Body */}
            <div className="px-4 py-2">
                <p className="text-xs text-[var(--color-text-muted)] leading-snug">
                    {order.items_summary || 'Sin detalle de productos'}
                </p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-[var(--color-text-muted)]">
                    {dateLabel && (
                        <span className="inline-flex items-center gap-1">
                            <Clock size={12} /> {dateLabel}
                        </span>
                    )}
                    {order.total > 0 && (
                        <span className="ml-auto font-semibold text-[var(--color-text)]">
                            {formatCurrency(order.total, currency)}
                        </span>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--glass-border)] bg-[var(--color-background)]/40">
                <button
                    onClick={() => run(onView)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
                >
                    <Eye size={14} /> Ver detalles
                </button>
                <button
                    onClick={() => run(onReject)}
                    disabled={busy}
                    className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                    <X size={14} /> Rechazar
                </button>
                <button
                    onClick={() => run(onAccept)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    <Check size={14} /> Aceptar
                </button>
            </div>
        </div>
    );
};

export default WebOrderCard;
