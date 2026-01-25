import React from 'react';
import { useStore } from '../store/useStore';
import { Moon, Sun } from 'lucide-react';

const Settings = () => {
    const { darkMode, toggleDarkMode, inventoryAdjustmentMode, toggleInventoryAdjustmentMode } = useStore();

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Configuración</h1>

            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Información del Sistema</h2>
                <div className="space-y-4">
                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                        <span className="text-[var(--color-text-muted)]">Versión</span>
                        <span className="text-[var(--color-text)] font-mono">1.0.0 (Futuristic Build)</span>
                    </div>
                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                        <span className="text-[var(--color-text-muted)]">Desarrollador</span>
                        <span className="text-[var(--color-text)]">POSKEM Dev</span>
                    </div>
                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                        <span className="text-[var(--color-text-muted)]">Estado de Licencia</span>
                        <span className="text-[var(--color-primary)] font-bold">Activa</span>
                    </div>
                </div>
            </div>

            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Apariencia</h2>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {darkMode ? <Moon className="text-[var(--color-primary)]" /> : <Sun className="text-yellow-500" />}
                        <span className="text-[var(--color-text)]">Modo {darkMode ? 'Oscuro (Neón)' : 'Claro'}</span>
                    </div>
                    <div
                        onClick={toggleDarkMode}
                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors duration-300 ${darkMode ? 'bg-[var(--color-primary)]' : 'bg-gray-300'}`}
                    >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${darkMode ? 'right-1' : 'left-1'}`}></div>
                    </div>
                </div>
            </div>

            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Inventario y Ajustes</h2>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-text)] font-medium">Modo Ajuste de Inventario</span>
                            <span className="bg-yellow-500/20 text-yellow-500 text-xs px-2 py-0.5 rounded border border-yellow-500/30">Precaución</span>
                        </div>
                        <p className="text-sm text-[var(--color-text-muted)] max-w-xl">
                            Permite vender productos sin stock o con stock negativo para regularización inicial.
                            No permite vender lotes vencidos.
                        </p>
                    </div>
                    <div
                        onClick={toggleInventoryAdjustmentMode}
                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors duration-300 ${inventoryAdjustmentMode ? 'bg-yellow-500' : 'bg-gray-700'}`}
                    >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${inventoryAdjustmentMode ? 'right-1' : 'left-1'}`}></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
