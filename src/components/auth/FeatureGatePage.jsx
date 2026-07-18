import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompanyFeatures } from '../../hooks/useCompanyFeatures';
import { getModuleByKey } from '../../constants/modules';
import { getAppByKey } from '../../constants/apps';
import { Sparkles, Lock, Crown, ArrowRight, Store } from 'lucide-react';

// Nivel mínimo de módulo → nombre del plan que lo desbloquea
const PLAN_BY_LEVEL = { 1: 'Standard', 2: 'Profesional' };

const FeatureGatePage = ({ moduleKey, children }) => {
    const { isModuleLocked } = useCompanyFeatures();
    const navigate = useNavigate();

    if (!isModuleLocked(moduleKey)) {
        return <>{children}</>;
    }

    const moduleInfo = getModuleByKey(moduleKey);

    // Módulo vendido como App → upsell de complemento (lleva al Marketplace).
    if (moduleInfo?.appKey) {
        const app = getAppByKey(moduleInfo.appKey);
        return (
            <div className="min-h-[70vh] flex items-center justify-center p-4 animate-in fade-in duration-500">
                <div className="max-w-lg w-full text-center space-y-8">
                    <div className="relative inline-block">
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/30 via-blue-400/30 to-cyan-500/30 blur-3xl rounded-full scale-150" />
                        <div className="relative w-24 h-24 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center shadow-2xl">
                            <Store size={40} className="text-cyan-400" />
                        </div>
                    </div>
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30">
                        <Sparkles size={16} className="text-cyan-400" />
                        <span className="text-cyan-400 font-bold text-sm tracking-wider uppercase">Complemento</span>
                    </div>
                    <div className="space-y-3">
                        <h1 className="text-3xl font-bold text-[var(--color-text)]">
                            {app?.name || moduleInfo.label} es un complemento del <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Marketplace</span>
                        </h1>
                        <p className="text-[var(--color-text-muted)] text-lg leading-relaxed max-w-md mx-auto">
                            {app?.description || moduleInfo.description}
                        </p>
                        <p className="text-sm text-[var(--color-text-muted)]">Actívalo con <strong>30 días de prueba gratis</strong> desde el Marketplace.</p>
                    </div>
                    <button
                        onClick={() => navigate('/marketplace')}
                        className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-bold text-lg shadow-xl shadow-cyan-500/20 hover:scale-105 transition-all duration-300"
                    >
                        <Store size={20} />
                        Ver en el Marketplace
                    </button>
                </div>
            </div>
        );
    }

    const planName = PLAN_BY_LEVEL[moduleInfo?.minLevel] || 'superior';

    return (
        <div className="min-h-[70vh] flex items-center justify-center p-4 animate-in fade-in duration-500">
            <div className="max-w-lg w-full text-center space-y-8">
                {/* Glow Effect */}
                <div className="relative inline-block">
                    <div className="absolute inset-0 bg-gradient-to-r from-amber-500/30 via-yellow-400/30 to-amber-500/30 blur-3xl rounded-full scale-150" />
                    <div className="relative w-24 h-24 mx-auto rounded-2xl bg-gradient-to-br from-amber-500/20 to-yellow-600/20 border border-amber-500/30 flex items-center justify-center shadow-2xl shadow-amber-500/10">
                        <Crown size={40} className="text-amber-400" />
                    </div>
                </div>

                {/* Badge del plan requerido */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/30">
                    <Sparkles size={16} className="text-amber-400" />
                    <span className="text-amber-400 font-bold text-sm tracking-wider uppercase">Plan {planName}</span>
                </div>

                {/* Title */}
                <div className="space-y-3">
                    <h1 className="text-3xl font-bold text-[var(--color-text)]">
                        {moduleInfo?.label || 'Este módulo'} está disponible desde el plan <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-500">{planName}</span>
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-lg leading-relaxed max-w-md mx-auto">
                        {moduleInfo?.description || 'Esta función requiere una actualización de plan para ser utilizada.'}
                    </p>
                </div>

                {/* Features */}
                <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 text-left space-y-3">
                    <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                        <Lock size={14} /> Incluido en el Plan {planName}
                    </h3>
                    <ul className="space-y-2 text-[var(--color-text-muted)] text-sm">
                        <li className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
                            Acceso completo a {moduleInfo?.label || 'esta función'}
                        </li>
                        <li className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
                            Todas las funciones del plan incluidas
                        </li>
                        <li className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
                            Actualiza en segundos desde tu cuenta
                        </li>
                    </ul>
                </div>

                {/* CTA → checkout in-app */}
                <button
                    onClick={() => navigate('/settings/plan')}
                    className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold text-lg shadow-xl shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-105 transition-all duration-300"
                >
                    <Sparkles size={20} />
                    Mejorar mi plan
                </button>

                <p className="text-xs text-[var(--color-text-muted)] opacity-50">
                    Si crees que esto es un error, contacta a tu administrador.
                </p>
            </div>
        </div>
    );
};

export default FeatureGatePage;
