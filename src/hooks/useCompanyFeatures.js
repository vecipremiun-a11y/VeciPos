import { useStore } from '../store/useStore';

export const useCompanyFeatures = () => {
    const hasModule = useStore(state => state.hasModule);

    return {
        hasModule,
        isModuleLocked: (moduleKey) => !hasModule(moduleKey),
    };
};
