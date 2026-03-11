import React from 'react';
import { useCompanyFeatures } from '../../hooks/useCompanyFeatures';
import { getModuleByKey } from '../../constants/modules';
import { Sparkles, Lock, Crown, ArrowRight } from 'lucide-react';

const FeatureGatePage = ({ moduleKey, children }) => {
    const { isModuleLocked } = useCompanyFeatures();

    if (!isModuleLocked(moduleKey)) {
        return <>{children}</>;
    }

    const moduleInfo = getModuleByKey(moduleKey);

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

                {/* Badge PRO */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/30">
                    <Sparkles size={16} className="text-amber-400" />
                    <span className="text-amber-400 font-bold text-sm tracking-wider uppercase">Plan PRO</span>
                </div>

                {/* Title */}
                <div className="space-y-3">
                    <h1 className="text-3xl font-bold text-[var(--color-text)]">
                        {moduleInfo?.label || 'Este módulo'} es una función <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-500">Premium</span>
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-lg leading-relaxed max-w-md mx-auto">
                        {moduleInfo?.description || 'Este módulo requiere una actualización de plan para ser utilizado.'}
                    </p>
                </div>

                {/* Features */}
                <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 text-left space-y-3">
                    <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                        <Lock size={14} /> Incluido en el Plan PRO
                    </h3>
                    <ul className="space-y-2 text-[var(--color-text-muted)] text-sm">
                        <li className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
                            Acceso completo a {moduleInfo?.label || 'este módulo'}
                        </li>
                        <li className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
                            Todas las funciones avanzadas incluidas
                        </li>
                        <li className="flex items-center gap-2">
                            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
                            Soporte prioritario y actualizaciones
                        </li>
                    </ul>
                </div>

                {/* CTA */}
                <button
                    onClick={() => {
                        // Open support/contact - could be a whatsapp link, email, or in-app support
                        window.open('https://wa.me/56912345678?text=Hola%2C%20me%20interesa%20activar%20el%20módulo%20' + encodeURIComponent(moduleInfo?.label || 'Premium'), '_blank');
                    }}
                    className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-bold text-lg shadow-xl shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-105 transition-all duration-300"
                >
                    <Sparkles size={20} />
                    Contactar para activar
                </button>

                <p className="text-xs text-[var(--color-text-muted)] opacity-50">
                    Contacta a tu administrador para habilitar este módulo.
                </p>
            </div>
        </div>
    );
};

export default FeatureGatePage;
