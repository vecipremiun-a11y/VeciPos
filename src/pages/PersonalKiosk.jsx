import React from 'react';
import { Minimize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import KioskView from '../components/personal/attendance/KioskView';

const PersonalKiosk = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)] p-4 md:p-6">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-lg md:text-xl font-semibold text-[var(--color-text)]">
                        Modo Kiosco de Asistencia
                    </h1>
                    <button
                        onClick={() => navigate('/personal')}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
                    >
                        <Minimize2 size={16} />
                        Salir del kiosco
                    </button>
                </div>

                <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                    <KioskView />
                </div>
            </div>
        </div>
    );
};

export default PersonalKiosk;
