import React, { useState } from 'react';
import { Truck, MapPin, X, AlertTriangle, Banknote, CreditCard } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import { cn } from '../lib/utils';

/**
 * Enviar a domicilio una venta armada en el POS.
 *
 * Un despacho define DOS cosas independientes: a dónde va y cuándo se paga.
 *   · Paga ahora        → se cobra normal y el repartidor no lleva plata.
 *   · Paga al recibir   → la venta queda a Crédito del cliente; el repartidor
 *                         cobra y, al liquidar, la deuda se salda sola.
 * La dirección se guarda en la ficha del cliente para no repetirla cada vez.
 */
export default function DispatchModal({ isOpen, onClose, onConfirm, client, total }) {
    const { updateClient, currentCurrency } = useStore();
    const [address, setAddress] = useState(client?.address || '');
    const [notes, setNotes] = useState('');
    const [phone, setPhone] = useState(client?.phone || '');
    const [fee, setFee] = useState('');
    const [payMode, setPayMode] = useState('on_delivery');   // on_delivery | now
    const [saving, setSaving] = useState(false);

    React.useEffect(() => {
        if (!isOpen) return;
        setAddress(client?.address || '');
        setPhone(client?.phone || '');
        setNotes(''); setFee(''); setPayMode('on_delivery');
    }, [isOpen, client]);

    if (!isOpen) return null;

    const feeNum = Number(fee) || 0;
    const grandTotal = Number(total || 0) + feeNum;

    const submit = async (e) => {
        e.preventDefault();
        if (!address.trim()) return;
        setSaving(true);
        // Guardar dirección/teléfono en la ficha si cambiaron: así la próxima vez
        // ya vienen puestos.
        try {
            const cambios = {};
            if (address.trim() !== (client.address || '')) cambios.address = address.trim();
            if (phone.trim() && phone.trim() !== (client.phone || '')) cambios.phone = phone.trim();
            if (Object.keys(cambios).length) await updateClient(client.id, { ...client, ...cambios });
        } catch { /* no bloquea el despacho */ }
        setSaving(false);
        onConfirm({
            address: address.trim(),
            addressNotes: notes.trim(),
            clientPhone: phone.trim(),
            deliveryFee: feeNum,
            payMode,
        });
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <form onSubmit={submit} className="glass-card modal-solido w-full max-w-md p-6 max-h-full overflow-y-auto relative">
                <button type="button" onClick={onClose} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <X size={20} />
                </button>
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-1 flex items-center gap-2">
                    <Truck className="text-[var(--color-primary)]" size={20} /> Enviar a domicilio
                </h2>
                <p className="text-sm text-[var(--color-text-muted)] mb-5">{client?.name}</p>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)] flex items-center gap-1">
                            <MapPin size={13} /> Dirección de entrega *
                        </label>
                        <input required value={address} onChange={e => setAddress(e.target.value)} autoFocus
                            className="glass-input w-full mt-1" placeholder="Calle, número, comuna" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)]">Teléfono</label>
                            <input value={phone} onChange={e => setPhone(e.target.value)}
                                className="glass-input w-full mt-1" placeholder="+569…" />
                        </div>
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)]">Costo de envío</label>
                            <input type="number" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)}
                                className="glass-input w-full mt-1" placeholder="0" />
                        </div>
                    </div>
                    <div>
                        <label className="text-sm text-[var(--color-text-muted)]">Referencia</label>
                        <input value={notes} onChange={e => setNotes(e.target.value)}
                            className="glass-input w-full mt-1" placeholder="Casa azul, portón negro…" />
                    </div>

                    {/* Cuándo se paga */}
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">¿Cuándo paga?</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setPayMode('on_delivery')}
                                className={cn('p-3 rounded-xl border text-left transition-all',
                                    payMode === 'on_delivery'
                                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                        : 'border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text-muted)]')}>
                                <Banknote size={16} />
                                <p className="text-sm font-bold mt-1">Al recibir</p>
                                <p className="text-[10px] leading-tight">El repartidor cobra</p>
                            </button>
                            <button type="button" onClick={() => setPayMode('now')}
                                className={cn('p-3 rounded-xl border text-left transition-all',
                                    payMode === 'now'
                                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                        : 'border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text-muted)]')}>
                                <CreditCard size={16} />
                                <p className="text-sm font-bold mt-1">Ahora</p>
                                <p className="text-[10px] leading-tight">Cobras aquí</p>
                            </button>
                        </div>
                        {payMode === 'on_delivery' && (
                            <p className="text-[11px] text-amber-400 flex items-start gap-1 mt-2">
                                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                La venta queda a crédito del cliente. Cuando el repartidor rinda, se salda sola.
                            </p>
                        )}
                    </div>

                    <div className="flex justify-between items-center pt-3 border-t border-[var(--glass-border)]">
                        <span className="text-[var(--color-text-muted)]">Total {feeNum > 0 && '(con envío)'}</span>
                        <span className="text-xl font-black text-[var(--color-primary)]">
                            {formatCurrency(grandTotal, currentCurrency)}
                        </span>
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose}
                        className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] font-bold">
                        Cancelar
                    </button>
                    <button type="submit" disabled={saving || !address.trim()}
                        className="flex-1 btn-primary py-2.5 rounded-lg font-bold disabled:opacity-50">
                        {payMode === 'now' ? 'Cobrar y despachar' : 'Enviar a reparto'}
                    </button>
                </div>
            </form>
        </div>
    );
}
