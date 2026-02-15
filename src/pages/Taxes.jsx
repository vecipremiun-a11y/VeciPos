
import React from 'react';
import TaxSettings from '../components/inventory/TaxSettings';

const Taxes = () => {
    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div>
                    <h1 className="text-xl lg:text-3xl font-bold text-[var(--color-text)] neon-text">Impuestos</h1>
                    <p className="text-xs lg:text-base text-[var(--color-text-muted)]">Gestión de tasas impositivas</p>
                </div>
            </div>

            <div className="flex-1 min-h-0">
                <TaxSettings />
            </div>
        </div>
    );
};

export default Taxes;
