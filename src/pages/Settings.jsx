import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import { Moon, Sun } from 'lucide-react';

import { recompressAllImages } from '../scripts/recompressImages';

const Settings = () => {
    const { darkMode, toggleDarkMode, inventoryAdjustmentMode, toggleInventoryAdjustmentMode, activeCompanyId, currentCompanyTimezone, fetchInitialData } = useStore();
    const [selectedTimezone, setSelectedTimezone] = useState(currentCompanyTimezone);

    useEffect(() => {
        setSelectedTimezone(currentCompanyTimezone);
    }, [currentCompanyTimezone]);

    const timezones = [
        { value: 'America/Santiago', label: 'Chile (Santiago)' },
        { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
        { value: 'America/Mexico_City', label: 'México (Ciudad de México)' },
        { value: 'America/Bogota', label: 'Colombia (Bogotá)' },
        { value: 'America/Lima', label: 'Perú (Lima)' },
        { value: 'America/Caracas', label: 'Venezuela (Caracas)' },
        { value: 'America/Sao_Paulo', label: 'Brasil (São Paulo)' },
        { value: 'Europe/Madrid', label: 'España (Madrid)' },
        { value: 'America/New_York', label: 'USA (Nueva York)' },
    ];

    const handleTimezoneChange = async (newTimezone) => {
        try {
            await turso.execute({
                sql: 'UPDATE companies SET timezone = ? WHERE id = ?',
                args: [newTimezone, activeCompanyId]
            });
            setSelectedTimezone(newTimezone);
            await fetchInitialData(); // Reload to update store
            alert('Zona horaria actualizada correctamente');
        } catch (e) {
            console.error('Error updating timezone:', e);
            alert('Error al actualizar zona horaria');
        }
    };

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
                        <span className="text-[var(--color-text)]">POSVECI Dev</span>
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
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Zona Horaria de la Empresa</h2>
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-[var(--color-text-muted)]">
                        Configura la zona horaria para el registro correcto de ventas y reportes
                    </p>
                    <div className="flex items-center gap-4">
                        <select
                            value={selectedTimezone}
                            onChange={(e) => handleTimezoneChange(e.target.value)}
                            className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] w-full max-w-md focus:outline-none focus:border-[var(--color-primary)]"
                        >
                            {timezones.map(tz => (
                                <option key={tz.value} value={tz.value} className="bg-[#1a1a2e] text-white">
                                    {tz.label}
                                </option>
                            ))}
                        </select>
                        <span className="text-xs text-[var(--color-text-muted)]">
                            Actual: {currentCompanyTimezone}
                        </span>
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
                        onClick={async () => {
                            const result = await toggleInventoryAdjustmentMode();
                            if (!result.success) {
                                alert('Error al actualizar la configuración: ' + result.error);
                            }
                        }}
                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors duration-300 ${inventoryAdjustmentMode ? 'bg-yellow-500' : 'bg-gray-700'}`}
                    >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${inventoryAdjustmentMode ? 'right-1' : 'left-1'}`}></div>
                    </div>
                </div>
            </div>

            {/* OPTIMIZATION TOOLS */}
            <div className="glass-card border border-cyan-500/30">
                <h2 className="text-xl font-bold text-cyan-400 mb-4 flex items-center gap-2">
                    ⚡ Optimización de Sistema
                </h2>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[var(--color-text)] font-medium">Recompresión Masiva de Imágenes</p>
                        <p className="text-sm text-[var(--color-text-muted)] max-w-xl">
                            Escanea todos los productos y comprime imágenes antiguas que sean muy pesadas (&gt;200KB).
                            Ejecutar solo una vez si el sistema está lento.
                        </p>
                    </div>
                    <button
                        onClick={async () => {
                            if (window.confirm('¿Iniciar optimización de imágenes? Esto puede tardar unos minutos.')) {
                                await recompressAllImages();
                            }
                        }}
                        className="btn-primary flex items-center gap-2"
                    >
                        📸 Optimizar Imágenes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Settings;
