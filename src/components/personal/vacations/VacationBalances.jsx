import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { User, RefreshCw, Plus, Minus } from 'lucide-react';
import { cn } from '../../../lib/utils'; // Keep inconsistent path if it works, or check standard. Standard seems to be ../../../lib/utils

const VacationBalances = () => {
    const { vacationBalances, fetchVacationBalances, updateVacationBalance } = useStore();
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadBalances();
    }, []);

    const loadBalances = async () => {
        setLoading(true);
        await fetchVacationBalances();
        setLoading(false);
    };

    const handleAdjustment = async (userId, currentTotal, amount) => {
        const newTotal = parseFloat(currentTotal) + amount;
        if (newTotal < 0) return; // Prevent negative total days? Or allow.

        // This is a manual adjustment of TOTAL accrued days.
        // Usually HR adds days yearly.
        // Or we can add an adjustment record.
        // Store implementation: updateVacationBalance(userId, { total_days: newTotal })

        // To be safe, maybe ask confirmation or show input.
        // For simplicity: +/- 1 day buttons.
        try {
            await updateVacationBalance(userId, { total_days: newTotal });
            loadBalances(); // Refresh
        } catch (e) {
            alert("Error al actualizar saldo");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex justify-between items-center bg-[var(--glass-bg)] p-4 rounded-xl border border-[var(--glass-border)]">
                <h2 className="font-bold text-[var(--color-text)]">Saldos de Vacaciones</h2>
                <button
                    onClick={loadBalances}
                    className="p-2 hover:bg-[var(--glass-bg)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    title="Actualizar"
                >
                    <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                </button>
            </div>

            {/* List */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {vacationBalances.map(user => (
                    <div key={user.user_id} className="glass-card p-4 flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center text-purple-400 font-bold text-lg">
                                {user.name ? user.name[0] : 'U'}
                            </div>
                            <div>
                                <p className="font-bold text-[var(--color-text)] text-lg">{user.name}</p>
                                <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Empleado</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 bg-[var(--glass-bg)] rounded-xl p-3 border border-[var(--glass-border)]">
                            <div className="text-center">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Total</p>
                                <p className="text-lg font-bold text-[var(--color-text)]">{user.total_days}</p>
                            </div>
                            <div className="text-center border-x border-[var(--glass-border)]">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Usados</p>
                                <p className="text-lg font-bold text-orange-400">{user.taken_days}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase">Restante</p>
                                <p className="text-lg font-bold text-green-400">{user.remaining_days}</p>
                            </div>
                        </div>

                        <div className="flex justify-between items-center text-xs text-[var(--color-text-muted)]">
                            <span>Ajustar días totales:</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => handleAdjustment(user.user_id, user.total_days, -1)}
                                    className="p-1 hover:bg-[var(--glass-bg)] rounded hover:text-red-400 transition-colors"
                                >
                                    <Minus size={14} />
                                </button>
                                <button
                                    onClick={() => handleAdjustment(user.user_id, user.total_days, 1)}
                                    className="p-1 hover:bg-[var(--glass-bg)] rounded hover:text-green-400 transition-colors"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {vacationBalances.length === 0 && !loading && (
                <div className="text-center p-10 text-[var(--color-text-muted)] glass-card">
                    No hay registros de saldos. Asegúrese de que el personal tenga perfil laboral activo.
                </div>
            )}
        </div>
    );
};

export default VacationBalances;
