import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { onSessionTakeover } from '../lib/sessionGuard';
import { RefreshCw } from 'lucide-react';

/**
 * Mantiene la pestaña alineada con la sesión real del navegador.
 *
 * La cookie de sesión es del navegador entero, no de la pestaña. Si alguien entra
 * con otra cuenta en otra pestaña, esta seguiría mostrando al usuario anterior y
 * grabando a su nombre — que fue cómo las ventas de una cajera acabaron en la caja
 * del administrador.
 *
 * En vez de dejar la pestaña bloqueada pidiendo que alguien vuelva a entrar, se
 * adopta la cuenta que realmente tiene la sesión (o se cierra, si cerraron sesión).
 * Se dispara por dos vías: el aviso instantáneo entre pestañas y, para las pestañas
 * que se lo perdieron, el rechazo SESSION_MISMATCH en su primera llamada.
 */
const SessionTakeoverModal = () => {
    const { sessionTakeover, flagSessionTakeover } = useStore(
        useShallow(s => ({
            sessionTakeover: s.sessionTakeover,
            flagSessionTakeover: s.flagSessionTakeover,
        }))
    );

    useEffect(() => onSessionTakeover(msg => flagSessionTakeover(msg)), [flagSessionTakeover]);

    if (!sessionTakeover) return null;

    // Cortina mientras se resuelve: evita que se siga usando la cuenta anterior
    // durante el instante que tarda en adoptarse la nueva.
    return createPortal(
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="glass-card w-full max-w-sm p-6 !bg-[#0f0f2d]/98 border border-[var(--glass-border)] shadow-2xl rounded-2xl text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/40 flex items-center justify-center text-[var(--color-primary)] mb-4">
                    <RefreshCw size={22} className="animate-spin" />
                </div>
                <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">
                    La sesión cambió en otra pestaña
                </h2>
                <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                    {sessionTakeover.previousUserName
                        ? <>Esta pestaña tenía la cuenta de <strong className="text-[var(--color-text)]">{sessionTakeover.previousUserName}</strong>. </>
                        : null}
                    Actualizando a la cuenta activa…
                </p>
            </div>
        </div>,
        document.body
    );
};

export default SessionTakeoverModal;
