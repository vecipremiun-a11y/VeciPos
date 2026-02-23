import React, { useState } from 'react';
import { BadgeDollarSign, Wallet, History, Calculator, Plus, User } from 'lucide-react';
import { cn } from '../../../lib/utils';
import AdvancesList from './AdvancesList';
import PeriodCalculator from './PeriodCalculator';
import PayrollHistory from './PayrollHistory';

const PayrollDashboard = () => {
    const [subTab, setSubTab] = useState('calculator'); // Default to calculator or overview

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex gap-1 p-1 bg-[var(--color-surface)] rounded-xl w-fit border border-[var(--glass-border)]">
                <button onClick={() => setSubTab('calculator')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2", subTab === 'calculator' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>
                    <Calculator size={16} /> Calculadora
                </button>
                <button onClick={() => setSubTab('advances')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2", subTab === 'advances' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>
                    <Wallet size={16} /> Adelantos
                </button>
                <button onClick={() => setSubTab('history')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2", subTab === 'history' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>
                    <History size={16} /> Historial
                </button>
            </div>

            <div className="min-h-[400px]">
                {subTab === 'calculator' && <PeriodCalculator />}
                {subTab === 'advances' && <AdvancesList />}
                {subTab === 'history' && <PayrollHistory />}
            </div>
        </div>
    );
};

export default PayrollDashboard;
