import { useStore } from '../store/useStore';

export const usePermissions = () => {
    const hasPermission = useStore(state => state.hasPermission);
    const currentUser = useStore(state => state.currentUser);
    const role = useStore(state => state.currentUserCompanyRole);

    return {
        can: hasPermission,
        role,
        user: currentUser,
        isSuperAdmin: currentUser?.role === 'super_admin' || role === 'owner' || role === 'super_admin' || role === 'Administrador'
    };
};
