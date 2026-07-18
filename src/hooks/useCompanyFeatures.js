import { useStore } from '../store/useStore';

export const useCompanyFeatures = () => {
    const hasModule = useStore(state => state.hasModule);
    const hasApp = useStore(state => state.hasApp);
    // Suscribir a estos estados fuerza el re-render cuando cambian plan/apps.
    useStore(state => state.currentPlanLevel);
    useStore(state => state.companyApps);
    useStore(state => state.companyModules);

    return {
        hasModule, // app-aware: para módulos vendidos como App, refleja hasApp
        hasApp,
        isModuleLocked: (moduleKey) => !hasModule(moduleKey),
    };
};
