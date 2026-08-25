import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { LogIn, ShoppingCart } from 'lucide-react';

/**
 * Cartel de "tu sesión expiró".
 *
 * Antes, cuando la sesión moría, el servidor contestaba 401 y nadie lo escuchaba:
 * la app seguía mostrando al usuario —ese dato sale de localStorage— con todas
 * las pantallas vacías. El cajero veía "No se pudo cargar el inventario" y no
 * tenía manera de saber que solo hacía falta volver a entrar.
 *
 * No cierra la sesión solo: el cajero tiene que ver qué pasó antes de que la
 * pantalla cambie. Y si tenía un carrito armado se le avisa ANTES, porque cerrar
 * sesión lo vacía.
 */
const SesionExpiradaModal = () => {
    const { sesionExpirada, logout, itemsEnCarrito } = useStore(
        useShallow((s) => ({
            sesionExpirada: s.sesionExpirada,
            logout: s.logout,
            itemsEnCarrito: s.carts?.reduce((n, c) => n + (c.items?.length || 0), 0) || 0,
        }))
    );

    if (!sesionExpirada) return null;

    const volverAEntrar = () => {
        logout();
        // Recarga completa a propósito: la sesión murió y con ella cualquier dato
        // a medio cargar. Arrancar limpio es más barato que ir apagando incendios.
        window.location.replace('/login');
    };

    return createPortal(
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="glass-card w-full max-w-sm p-6 !bg-[#0f0f2d]/98 border border-[var(--glass-border)] shadow-2xl rounded-2xl text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4">
                    <LogIn size={22} />
                </div>

                <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">
                    Tu sesión expiró
                </h2>
                <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                    Por seguridad la sesión se cierra sola después de un tiempo sin usar el
                    sistema. No se perdió nada: volvé a entrar y seguís donde estabas.
                </p>

                {itemsEnCarrito > 0 && (
                    <div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2 text-left">
                        <ShoppingCart size={16} className="shrink-0 mt-0.5 text-amber-400" />
                        <p className="text-xs text-amber-200/90 leading-relaxed">
                            Tenés <strong>{itemsEnCarrito}</strong> producto{itemsEnCarrito === 1 ? '' : 's'} en
                            el carrito. Al volver a entrar el carrito arranca vacío, así que anotá lo que
                            tenías antes de continuar.
                        </p>
                    </div>
                )}

                <button
                    onClick={volverAEntrar}
                    className="btn-primary w-full mt-5 flex items-center justify-center gap-2 py-2.5"
                >
                    <LogIn size={18} /> Volver a iniciar sesión
                </button>
            </div>
        </div>,
        document.body
    );
};

export default SesionExpiradaModal;
