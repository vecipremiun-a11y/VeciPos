import React, { useState } from 'react';
import SalesReports from '../components/reports/SalesReports';
import PreorderReports from '../components/reports/PreorderReports';
import { ShoppingBag, TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';

const Reports = () => {
    const [activeTab, setActiveTab] = useState('sales');

    return (
        <div className="p-4 space-y-6 pb-20 md:pb-4 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] bg-clip-text text-transparent">
                        Reportes y Estadísticas
                    </h1>
                    <p className="text-[var(--text-secondary)] text-sm">
                        {activeTab === 'sales'
                            ? 'Análisis detallado de ventas, costos y utilidad.'
                            : 'Seguimiento de pedidos, estados y clientes.'}
                    </p>
                </div>

                {/* Tab Switcher */}
                <div className="flex p-1 bg-[var(--surface-light)] rounded-xl border border-[var(--glass-border)]">
                    <button
                        onClick={() => setActiveTab('sales')}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
                            activeTab === 'sales'
                                ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/20"
                                : "text-[var(--text-muted)] hover:text-white"
                        )}
                    >
                        <TrendingUp size={18} />
                        Ventas
                    </button>
                    <button
                        onClick={() => setActiveTab('preorders')}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
                            activeTab === 'preorders'
                                ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/20"
                                : "text-[var(--text-muted)] hover:text-white"
                        )}
                    >
                        <ShoppingBag size={18} />
                        Encargos
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="min-h-[500px]">
                {activeTab === 'sales' ? <SalesReports /> : <PreorderReports />}
            </div>
        </div>
    );
};

export default Reports;
