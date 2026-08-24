import React from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import { useStore } from '../../store/useStore';
import AccessDenied from './AccessDenied';
import SinDatos from './SinDatos';

const ProtectedPage = ({ permission, children }) => {
    const { can, isSuperAdmin } = usePermissions();
    const isLoading = useStore(state => state.isLoading);
    const rolePermissions = useStore(state => state.rolePermissions);

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

    if (!can(permission)) {
        // Permisos vacíos = nunca se pudieron cargar, porque el arranque no logró
        // hablar con el servidor. Eso NO es falta de permisos, y decirle "Acceso
        // Denegado" a una cajera la deja mirando un candado —sin poder vender ni
        // pasar a offline— cuando el problema es que la base no contesta.
        // Pasó el 23-ago-2026 con Turso degradado.
        if (!isSuperAdmin && (!rolePermissions || rolePermissions.length === 0)) {
            return <SinDatos />;
        }
        return <AccessDenied />;
    }

    return <>{children}</>;
};

export default ProtectedPage;
