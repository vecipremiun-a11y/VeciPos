import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { onSessionTakeover } from '../lib/sessionGuard';
import { AlertTriangle, LogIn } from 'lucide-react';

/**
 * Bloquea la pestaña cuando la sesión del navegador pasó a ser de otro usuario.
 *
 * La cookie de sesión es del navegador entero, no de la pestaña. Si alguien inicia
 * sesión con otro usuario en otra pestaña, esta seguiría mostrando al usuario anterior
 * pero grabando a nombre del nuevo — que fue exactamente cómo las ventas de una cajera
 * terminaron sumando en la caja del administrador.
 *
 * Se levanta por dos vías: el aviso instantáneo entre pestañas (BroadcastChannel) o el
 * rechazo SESSION_MISMATCH del servidor, que es el que garantiza que no se grabó nada.
 */
const SessionTakeoverModal = () => {
    const { sessionTakeover, flagSessionTakeover, logout } = useStore(
        useShallow(s => ({
            sessionTakeover: s.sessionTakeover,
            flagSessionTakeover: s.flagSessionTakeover,
            logout: s.logout,
        }))
    );

    // Aviso instantáneo: otra pestaña inició sesión con un usuario distinto.
    useEffect(() => onSessionTakeover(msg => flagSessionTakeover(msg)), [flagSessionTakeover]);

    if (!sessionTakeover) return null;

    const handleRelogin = () => {
        logout();
        window.location.replace('/login');
    };

    const previous = sessionTakeover.previousUserName;

    return createPortal(
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="glass-card w-full max-w-md p-6 !bg-[#0f0f2d]/98 border border-red-500/40 shadow-2xl rounded-2xl text-center">
                <div className="w-14 h-14 mx-auto rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center text-red-400 mb-4">
                    <AlertTriangle size={28} />
                </div>

                <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">
                    Esta pestaña ya no puede vender
                </h2>

                <p className="text-sm text-[var(--color-text-muted)] mb-4 leading-relaxed">
                    Se inició sesión con <strong className="text-[var(--color-text)]">otro usuario</strong> en
                    esta misma ventana del navegador.
                    {previous && (
                        <> Esta pestaña todavía mostraba la cuenta de{' '}
                            <strong className="text-[var(--color-text)]">{previous}</strong>.</>
                    )}
                </p>

                <div className="text-left text-xs text-[var(--color-text-muted)] bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-3 mb-5 leading-relaxed">
                    Si sigues vendiendo aquí, las ventas se guardarían en la caja del otro
                    usuario. Vuelve a iniciar sesión para continuar.
                    <br /><br />
                    <strong className="text-[var(--color-text)]">¿Necesitas dos cuentas a la vez?</strong>{' '}
                    Usa una ventana normal y otra de incógnito, o dos navegadores distintos.
                </div>

                <button
                    onClick={handleRelogin}
                    className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-black font-bold text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                    <LogIn size={16} />
                    Volver a iniciar sesión
                </button>
            </div>
        </div>,
        document.body
    );
};

export default SessionTakeoverModal;
