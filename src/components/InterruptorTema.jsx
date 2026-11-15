import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * Día o noche, a un clic desde la barra de arriba (Kevin, 9-nov-2026: "acceso
 * rápido" para no ir hasta Configuración → General). Es el mismo `darkMode` del
 * store que usa Ajustes, así que los dos quedan siempre iguales y se recuerda
 * al volver a entrar.
 *
 * Solo en pantallas de escritorio: en el celular la barra ya va justa.
 */
const InterruptorTema = () => {
    const darkMode = useStore((s) => s.darkMode);
    const toggleDarkMode = useStore((s) => s.toggleDarkMode);
    const accion = darkMode ? 'Pasar a modo claro (día)' : 'Pasar a modo oscuro (noche)';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={darkMode}
            aria-label={accion}
            title={accion}
            onClick={toggleDarkMode}
            data-prueba="interruptor-tema"
            className="hidden md:inline-flex relative items-center w-[68px] h-9 shrink-0 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] hover:border-[var(--color-primary)]/60 transition-colors"
        >
            {/* Los dos íconos fijos de fondo; la perilla tapa el que está activo y lo resalta. */}
            <Sun size={15} className="absolute left-2.5 text-amber-400/70" />
            <Moon size={15} className="absolute right-2.5 text-[var(--color-text-muted)]" />
            <span
                className={`absolute top-1 left-1 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-transform duration-300 ${darkMode
                    ? 'translate-x-[32px] bg-[var(--color-primary)] text-black'
                    : 'translate-x-0 bg-amber-400 text-white'}`}
            >
                {darkMode ? <Moon size={15} /> : <Sun size={15} />}
            </span>
        </button>
    );
};

export default InterruptorTema;
