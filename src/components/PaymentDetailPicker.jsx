import React from 'react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { CreditCard, ArrowLeftRight } from 'lucide-react';

// Selector compacto de datáfono (Tarjeta) o cuenta (Transferencia) para los
// flujos de cobro de encargo (createPreorder · addPreorderPayment · deliverPreorder).
// No renderiza nada para Efectivo. Lee paymentTerminals / bankAccounts del
// store (ya cargados via fetchPaymentMethodsSettings al iniciar sesión).
//
// Props:
//   method: 'Efectivo' | 'Tarjeta' | 'Transferencia'
//   terminalId, bankAccountId: ids actuales (number o null)
//   onChange({ terminalId?, bankAccountId? }): callback al cambiar
const PaymentDetailPicker = ({ method, terminalId, bankAccountId, onChange }) => {
    const { paymentTerminals, bankAccounts } = useStore(useShallow(s => ({
        paymentTerminals: s.paymentTerminals,
        bankAccounts: s.bankAccounts,
    })));

    if (method === 'Tarjeta') {
        return (
            <div className="space-y-1.5 animate-in fade-in duration-200">
                <label className="text-[11px] text-[var(--color-text-muted)] font-bold flex items-center gap-1.5">
                    <CreditCard size={12} className="text-blue-400" /> Datáfono
                </label>
                {(!paymentTerminals || paymentTerminals.length === 0) ? (
                    <p className="text-[11px] text-orange-400 italic">
                        Sin datáfonos configurados (Configuración → Medios de Pago)
                    </p>
                ) : (
                    <select
                        value={terminalId ?? ''}
                        onChange={e => onChange({ terminalId: e.target.value ? Number(e.target.value) : null })}
                        className="glass-input w-full text-sm"
                    >
                        <option value="">Selecciona datáfono…</option>
                        {paymentTerminals.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                )}
            </div>
        );
    }

    if (method === 'Transferencia') {
        return (
            <div className="space-y-1.5 animate-in fade-in duration-200">
                <label className="text-[11px] text-[var(--color-text-muted)] font-bold flex items-center gap-1.5">
                    <ArrowLeftRight size={12} className="text-purple-400" /> Cuenta bancaria
                </label>
                {(!bankAccounts || bankAccounts.length === 0) ? (
                    <p className="text-[11px] text-orange-400 italic">
                        Sin cuentas configuradas (Configuración → Medios de Pago)
                    </p>
                ) : (
                    <select
                        value={bankAccountId ?? ''}
                        onChange={e => onChange({ bankAccountId: e.target.value ? Number(e.target.value) : null })}
                        className="glass-input w-full text-sm"
                    >
                        <option value="">Selecciona cuenta…</option>
                        {bankAccounts.map(a => (
                            <option key={a.id} value={a.id}>
                                {a.bank_name || 'Banco'}{a.account_number ? ` · ${a.account_number}` : ''}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        );
    }

    return null;
};

export default PaymentDetailPicker;
