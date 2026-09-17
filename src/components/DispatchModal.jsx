import React, { useState, useMemo } from 'react';
import { Truck, MapPin, X, AlertTriangle, Banknote, CreditCard, Store, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import { cn } from '../lib/utils';

/** "Videla 1430, La Cisterna" — una dirección en una línea. */
function lineaDireccion(dir) {
    if (!dir) return '';
    return [dir.address, dir.comuna].map(v => (v || '').trim()).filter(Boolean).join(', ');
}

/**
 * Enviar a domicilio una venta armada en el POS.
 *
 * Un despacho define DOS cosas independientes: a dónde va y cuándo se paga.
 *   · Paga ahora        → se cobra normal y el repartidor no lleva plata.
 *   · Paga al recibir   → la venta queda a Crédito del cliente; el repartidor
 *                         cobra y, al liquidar, la deuda se salda sola.
 *
 * LAS DIRECCIONES. Un cliente que viene de miniveci.cl trae su libreta: las
 * direcciones que él mismo cargó allá, con una marcada como principal. Acá se
 * eligen, no se editan. Si para ESTE envío va a otra parte, se escribe y vale
 * solo para este reparto: queda en el despacho (`deliveries.address`) y la ficha
 * no se toca. El cliente cambia sus direcciones en la tienda, y de ahí vuelven.
 *
 * Un cliente cargado en el POS no tiene quién le mantenga la dirección, así que
 * ahí sí se guarda en su ficha al despachar, como siempre.
 */
export default function DispatchModal({ isOpen, onClose, onConfirm, client, total }) {
    const { updateClient, currentCurrency, clients, clientAddresses } = useStore();

    // La ficha ACTUAL, no la copia que quedó guardada en el carrito: si al cliente
    // le cargaron la dirección después de seleccionarlo, esa copia sigue vacía.
    const ficha = useMemo(
        () => clients.find(c => c.id === client?.id) || client || null,
        [clients, client]
    );

    const direcciones = useMemo(
        () => (clientAddresses || []).filter(d => d.client_id === ficha?.id),
        [clientAddresses, ficha]
    );
    // Si el cliente tiene cuenta en la tienda, sus datos se mantienen allá: el POS
    // no le escribe la ficha aunque todavía no haya mandado ninguna dirección.
    const deLaTienda = Boolean(ficha?.external_id);

    const [elegida, setElegida] = useState(null);      // id de la libreta, u 'otra'
    const [address, setAddress] = useState('');
    const [notes, setNotes] = useState('');
    const [phone, setPhone] = useState('');
    const [fee, setFee] = useState('');
    const [payMode, setPayMode] = useState('on_delivery');   // on_delivery | now
    const [saving, setSaving] = useState(false);

    React.useEffect(() => {
        if (!isOpen) return;
        const principal = direcciones.find(d => d.is_default) || direcciones[0] || null;
        setElegida(principal ? principal.id : 'otra');
        setAddress(principal ? lineaDireccion(principal) : (ficha?.address || ''));
        setNotes(principal?.notes || '');
        setPhone(ficha?.phone || '');
        setFee(''); setPayMode('on_delivery');
        // `direcciones` se recalcula en cada render; la dependencia es la ficha.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ficha]);

    if (!isOpen) return null;

    const elegir = (dir) => {
        setElegida(dir.id);
        setAddress(lineaDireccion(dir));
        setNotes(dir.notes || '');
    };

    const elegirOtra = () => {
        setElegida('otra');
        setAddress('');
        setNotes('');
    };

    const feeNum = Number(fee) || 0;
    const grandTotal = Number(total || 0) + feeNum;

    const submit = async (e) => {
        e.preventDefault();
        if (!address.trim()) return;

        // Cliente de la tienda: su dirección y su teléfono se cambian allá. Acá no
        // se guarda nada — lo que se haya escrito vale solo para este reparto.
        if (!deLaTienda) {
            setSaving(true);
            try {
                const cambios = {};
                if (address.trim() !== (ficha.address || '')) cambios.address = address.trim();
                if (phone.trim() && phone.trim() !== (ficha.phone || '')) cambios.phone = phone.trim();
                if (Object.keys(cambios).length) await updateClient(ficha.id, { ...ficha, ...cambios });
            } catch { /* no bloquea el despacho */ }
            setSaving(false);
        }

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
                <p className="text-sm text-[var(--color-text-muted)] mb-5">{ficha?.name}</p>

                <div className="space-y-4">
                    {deLaTienda ? (
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] flex items-center gap-1 mb-2">
                                <MapPin size={13} /> Dirección de entrega *
                            </label>
                            <div className="space-y-2">
                                {direcciones.length === 0 && (
                                    <input required value={address} onChange={e => setAddress(e.target.value)} autoFocus
                                        className="glass-input w-full" placeholder="Calle, número, comuna" />
                                )}
                                {direcciones.map(dir => (
                                    <button key={dir.id} type="button" onClick={() => elegir(dir)}
                                        className={cn('w-full text-left p-3 rounded-xl border transition-all flex items-start gap-2',
                                            elegida === dir.id
                                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                                                : 'border-[var(--glass-border)] bg-[var(--glass-bg)]')}>
                                        <span className={cn('mt-0.5 shrink-0', elegida === dir.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]')}>
                                            {elegida === dir.id ? <Check size={16} /> : <MapPin size={16} />}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-bold text-[var(--color-text)]">
                                                {dir.label || 'Dirección'}
                                                {Boolean(dir.is_default) && (
                                                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-primary)]">Principal</span>
                                                )}
                                            </span>
                                            <span className="block text-xs text-[var(--color-text-muted)] break-words">{lineaDireccion(dir)}</span>
                                            {dir.notes && <span className="block text-[11px] text-[var(--color-text-muted)] break-words">{dir.notes}</span>}
                                        </span>
                                    </button>
                                ))}

                                {direcciones.length > 0 && (
                                    <>
                                        <button type="button" onClick={elegirOtra}
                                            className={cn('w-full text-left p-3 rounded-xl border transition-all',
                                                elegida === 'otra'
                                                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                                                    : 'border-dashed border-[var(--glass-border)] bg-transparent')}>
                                            <span className="block text-sm font-bold text-[var(--color-text)]">Otra dirección, solo para este envío</span>
                                            <span className="block text-xs text-[var(--color-text-muted)]">No cambia nada en su ficha</span>
                                        </button>

                                        {elegida === 'otra' && (
                                            <input required value={address} onChange={e => setAddress(e.target.value)} autoFocus
                                                className="glass-input w-full" placeholder="Calle, número, comuna" />
                                        )}
                                    </>
                                )}
                            </div>
                            <p className="text-[11px] text-[var(--color-text-muted)] flex items-start gap-1 mt-2">
                                <Store size={12} className="shrink-0 mt-0.5" />
                                {direcciones.length > 0
                                    ? 'Sus direcciones y su teléfono se cambian desde miniveci.cl. Lo que escribas acá vale solo para este reparto.'
                                    : 'Todavía no cargó ninguna dirección en miniveci.cl. Lo que escribas acá vale solo para este reparto.'}
                            </p>
                        </div>
                    ) : (
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] flex items-center gap-1">
                                <MapPin size={13} /> Dirección de entrega *
                            </label>
                            <input required value={address} onChange={e => setAddress(e.target.value)} autoFocus
                                className="glass-input w-full mt-1" placeholder="Calle, número, comuna" />
                            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                                Queda guardada en su ficha para la próxima vez.
                            </p>
                        </div>
                    )}

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
