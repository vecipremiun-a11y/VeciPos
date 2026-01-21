import React from 'react';

const Settings = () => {
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-white neon-text">Configuración</h1>

            <div className="glass-card">
                <h2 className="text-xl font-bold text-white mb-4">Información del Sistema</h2>
                <div className="space-y-4">
                    <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-gray-400">Versión</span>
                        <span className="text-white font-mono">1.0.0 (Futuristic Build)</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-gray-400">Desarrollador</span>
                        <span className="text-white">POSKEM Dev</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-gray-400">Estado de Licencia</span>
                        <span className="text-[var(--color-primary)] font-bold">Activa</span>
                    </div>
                </div>
            </div>

            <div className="glass-card">
                <h2 className="text-xl font-bold text-white mb-4">Apariencia</h2>
                <div className="flex items-center justify-between">
                    <span className="text-gray-300">Modo Neón</span>
                    <div className="w-12 h-6 rounded-full bg-[var(--color-primary)] relative cursor-pointer">
                        <div className="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
