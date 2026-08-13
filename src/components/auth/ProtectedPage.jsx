import React from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import { useStore } from '../../store/useStore';
import AccessDenied from './AccessDenied';

// `soloAdmin` deja la página fuera del alcance de los roles operativos (Caja,
// Vendedor, Repartidor) aunque tengan el permiso suelto. Se agregó para el
// Asistente IA, que muestra márgenes, sueldos y liquidaciones: eso no es
// información de mostrador. El gate de verdad está igual en el servidor — esto
// solo evita que la pantalla llegue a mostrarse.
const ProtectedPage = ({ permission, soloAdmin = false, children }) => {
    const { can, isSuperAdmin } = usePermissions();
    const isLoading = useStore(state => state.isLoading);

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[var(--color-bg)]">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-primary)] border-t-transparent"></div>
                    <p className="text-[var(--color-text-muted)] animate-pulse">Cargando permisos...</p>
                </div>
            </div>
        );
    }

    if (soloAdmin && !isSuperAdmin) {
        return <AccessDenied />;
    }

    if (!can(permission)) {
        return <AccessDenied />;
    }

    return <>{children}</>;
};

export default ProtectedPage;
