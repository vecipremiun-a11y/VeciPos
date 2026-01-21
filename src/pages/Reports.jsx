import React from 'react';
import { useStore } from '../store/useStore';
import { format } from 'date-fns';
import { BarChart, FileText } from 'lucide-react';

const Reports = () => {
    const { sales } = useStore();

    const totalRevenue = sales.reduce((acc, sale) => acc + sale.total, 0);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white neon-text">Reporte de Ventas</h1>
                    <p className="text-gray-400">Historial de transacciones</p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-gray-400">Ingresos Totales</p>
                    <p className="text-3xl font-bold text-[var(--color-primary)]">${totalRevenue.toFixed(2)}</p>
                </div>
            </div>

            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-gray-300 uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-4">ID Transacción</th>
                                <th className="px-6 py-4">Fecha</th>
                                <th className="px-6 py-4">Detalle</th>
                                <th className="px-6 py-4 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {sales.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="text-center py-10 text-gray-500">
                                        No hay ventas registradas aún.
                                    </td>
                                </tr>
                            ) : (
                                sales.map((sale) => (
                                    <tr key={sale.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4 font-mono text-xs text-gray-400">#{sale.id}</td>
                                        <td className="px-6 py-4 text-white">
                                            {sale.date ? format(new Date(sale.date), 'dd/MM/yyyy HH:mm') : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-white">
                                            <span className="flex items-center gap-2">
                                                <FileText size={14} className="text-gray-400" />
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
