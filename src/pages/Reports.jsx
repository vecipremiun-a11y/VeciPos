import React from 'react';
import { useStore } from '../store/useStore';
import { format } from 'date-fns';
import { BarChart, FileText } from 'lucide-react';

const Reports = () => {
    const { sales } = useStore();

    const activeSales = sales.filter(s => s.status !== 'cancelled');
    const totalRevenue = activeSales.reduce((acc, sale) => acc + sale.total, 0);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Reporte de Ventas</h1>
                    <p className="text-[var(--color-text-muted)]">Historial de transacciones</p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-[var(--color-text-muted)]">Ingresos Totales</p>
                    <p className="text-3xl font-bold text-[var(--color-primary)]">${totalRevenue.toFixed(2)}</p>
                </div>
            </div>

            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-4">ID Transacción</th>
                                <th className="px-6 py-4">Fecha</th>
                                <th className="px-6 py-4">Detalle</th>
                                <th className="px-6 py-4 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {activeSales.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="text-center py-10 text-[var(--color-text-muted)]">
                                        No hay ventas registradas aún.
                                    </td>
                                </tr>
                            ) : (
                                activeSales.map((sale) => (
                                    <tr key={sale.id} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="px-6 py-4 font-mono text-xs text-[var(--color-text-muted)]">#{sale.id}</td>
                                        <td className="px-6 py-4 text-[var(--color-text)]">
                                            {sale.date ? format(new Date(sale.date), 'dd/MM/yyyy HH:mm') : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-[var(--color-text)]">
                                            <span className="flex items-center gap-2">
                                                <FileText size={14} className="text-[var(--color-text-muted)]" />
                                                {sale.summary}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right font-bold text-[var(--color-primary)]">
                                            ${sale.total.toFixed(2)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Reports;
