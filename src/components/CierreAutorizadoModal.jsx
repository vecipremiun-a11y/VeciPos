// Llave de supervisor para cerrar una caja con ventas offline sin subir.
//
// Por qué existe: el POS no deja cerrar con ventas del cajero todavía en el
// equipo, porque esa plata ya está en el cajón y tiene que entrar en el cierre.
// Pero hay ventas que no entran por causas ajenas al cajero —falta stock con el
// modo ajuste apagado, se acabaron los folios CAF— y el turno igual tiene que
// terminar. Sin esta salida, el cajero quedaba encerrado.
//
// La clave se verifica EN EL SERVIDOR (api/_lib/registerActions.js). Acá solo se
// escribe y se manda: el hash de la contraseña no sale del servidor, y una
// comprobación en el navegador la saltea cualquiera con la consola abierta.
//
// Todo cierre autorizado queda en la auditoría y en las observaciones de la
// caja, con quién lo autorizó, cuántas ventas quedaban afuera y por qué.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, ShieldCheck, Loader2 } from 'lucide-react';

export default function CierreAutorizadoModal({ datos, onCancel, onConfirm }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);

    if (!datos) return null;
    const { pendientes } = datos;

    const confirmar = async (e) => {
        e.preventDefault();
        if (enviando) return;
        if (!username.trim() || !password) {
            setError('Escribí el usuario y la contraseña del supervisor.');
            return;
        }
        setEnviando(true);
        setError(null);
        try {
            const r = await onConfirm({ username: username.trim(), password, reason });
            // `true` = cerró. Cualquier otra cosa trae el motivo y el diálogo se
            // queda abierto para reintentar sin perder el cierre.
            if (r !== true) setError(r?.error || 'No se pudo cerrar la caja.');
        } catch (err) {
            setError(err?.message || 'No se pudo cerrar la caja.');
        } finally {
            setEnviando(false);
            setPassword('');
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
            <div className="glass-card modal-solido w-full max-w-md relative p-5">
                <button
                    onClick={onCancel}
                    className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    aria-label="Cerrar"
                >
                    <X size={18} />
                </button>

                <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--color-text)]">
                    <ShieldCheck className="text-amber-400" size={20} />
                    Cierre con autorización
                </h2>

                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <div className="flex items-center gap-2 font-bold text-amber-400">
                        <AlertTriangle size={14} />
                        Quedan {pendientes} venta{pendientes === 1 ? '' : 's'} sin subir
                    </div>
                    <p className="mt-1 text-[var(--color-text-muted)]">
                        Esa plata ya está en el cajón pero el sistema todavía no la
                        registró, así que el cuadre va a salir distinto. Cerrar igual
                        necesita la clave de un supervisor o administrador, y queda
                        registrado quién lo autorizó.
                    </p>
                </div>

                <form onSubmit={confirmar} className="mt-4 space-y-3">
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Usuario del supervisor</label>
                        <input
                            className="glass-input w-full"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="off"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Contraseña</label>
                        <input
                            type="password"
                            className="glass-input w-full"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="off"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                            Motivo <span className="opacity-70">(queda en el registro)</span>
                        </label>
                        <input
                            className="glass-input w-full"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Ej: sin folios CAF, se sube mañana"
                            maxLength={300}
                        />
                    </div>

                    {error && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-sm font-semibold"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={enviando}
                            className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {enviando && <Loader2 size={14} className="animate-spin" />}
                            Autorizar y cerrar
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
