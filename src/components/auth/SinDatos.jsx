import React, { useState } from 'react';
import { DatabaseZap, RefreshCw } from 'lucide-react';
import { useStore } from '../../store/useStore';

/**
 * "No se pudieron cargar tus datos", que NO es lo mismo que "no tenés permiso".
 *
 * Cuando el arranque no logra hablar con el servidor, los permisos del rol quedan
 * vacíos y `hasPermission` niega todo. Hasta ahora eso terminaba en la pantalla de
 * "Acceso Denegado": una cajera con el candado rojo, sin poder vender, leyendo que
 * hable con su administrador — cuando el problema no tenía nada que ver con ella.
 *
 * Pasó el 23-ago-2026: Turso tardaba entre 9 y 24 segundos por consulta y todas
 * las cajas del local quedaron así.
 */
const SinDatos = () => {
    const fetchInitialData = useStore((s) => s.fetchInitialData);
    const [reintentando, setReintentando] = useState(false);

    const reintentar = async () => {
        setReintentando(true);
        try {
            await fetchInitialData();
        } finally {
            setReintentando(false);
        }
    };

    return (
        <div className="flex h-full min-h-[60vh] w-full items-center justify-center p-6">
            <div className="glass-card max-w-md w-full p-8 text-center rounded-2xl border border-[var(--glass-border)]">
                <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-5">
                    <DatabaseZap size={26} />
                </div>

                <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">
                    No se pudieron cargar tus datos
                </h2>
                <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                    El servidor no está respondiendo, así que todavía no sabemos qué podés hacer
                    en esta pantalla. <strong className="text-[var(--color-text)]">No es un problema
                    de permisos tuyos.</strong>
                </p>
                <p className="text-sm text-[var(--color-text-muted)] leading-relaxed mt-3">
                    Mientras tanto podés seguir vendiendo en el POS: las ventas se guardan en este
                    equipo y se envían solas cuando el sistema vuelva.
                </p>

                <button
                    onClick={reintentar}
                    disabled={reintentando}
                    className="btn-primary w-full mt-6 flex items-center justify-center gap-2 py-2.5 disabled:opacity-60"
                >
                    <RefreshCw size={18} className={reintentando ? 'animate-spin' : ''} />
                    {reintentando ? 'Reintentando…' : 'Reintentar'}
                </button>
            </div>
        </div>
    );
};

export default SinDatos;
