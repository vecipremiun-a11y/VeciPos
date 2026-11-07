import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { subscribeToasts } from '../lib/toast';

// Host global de notificaciones del sistema (ver src/lib/toast.js).
// Se monta una sola vez en App; apila hasta 5 tarjetas arriba a la derecha.

const STYLES = {
    success: { icon: CheckCircle2, ring: 'border-emerald-500/40', iconColor: 'text-emerald-400', bar: 'bg-emerald-500' },
    error:   { icon: AlertTriangle, ring: 'border-red-500/40',     iconColor: 'text-red-400',     bar: 'bg-red-500' },
    info:    { icon: Info,          ring: 'border-cyan-500/40',    iconColor: 'text-cyan-400',    bar: 'bg-cyan-500' },
};

const DURATION_MS = 4200;

const ToastHost = () => {
    const [toasts, setToasts] = useState([]);

    useEffect(() => subscribeToasts((t) => {
        setToasts(prev => [...prev.slice(-4), t]);
        setTimeout(() => {
            setToasts(prev => prev.filter(x => x.id !== t.id));
        }, t.ms || DURATION_MS);
    }), []);

    if (!toasts.length) return null;

    // Debajo de la barra del teléfono (--safe-top vale 0 en el navegador).
    return (
        <div role="status" aria-live="polite" style={{ top: 'calc(var(--safe-top, 0px) + 1rem)' }}
            className="fixed right-4 z-[20000] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))] pointer-events-none">
            {toasts.map(t => {
                const s = STYLES[t.type] || STYLES.info;
                const Icon = s.icon;
                return (
                    <div
                        key={t.id}
                        className={`pointer-events-auto relative overflow-hidden rounded-xl border ${t.fuerte ? 'border-emerald-300 bg-emerald-600' : `${s.ring} bg-[var(--color-surface)]`} shadow-2xl p-3.5 pr-9 flex items-start gap-3 animate-in slide-in-from-top-2 fade-in duration-200`}
                    >
                        {!t.fuerte && <span className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} aria-hidden="true" />}
                        <Icon size={t.fuerte ? 22 : 18} className={`${t.fuerte ? 'text-white' : s.iconColor} flex-shrink-0 mt-0.5`} />
                        <p className={`${t.fuerte ? 'text-[15px] font-bold text-white' : 'text-sm text-[var(--color-text)]'} leading-snug whitespace-pre-line break-words min-w-0`}>
                            {t.message}
                        </p>
                        <button
                            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                            className={`absolute top-2.5 right-2.5 ${t.fuerte ? 'text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'} transition-colors`}
                            aria-label="Cerrar"
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export default ToastHost;
