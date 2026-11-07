import { costoConImpuestos, margenDesdePrecio } from '../lib/impuestosProducto';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, Check, AlertCircle, ScanBarcode } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import AsyncButton from './AsyncButton';

/**
 * Agregar o editar una unidad de medida del producto: "Caja de 30", "Display de
 * 24", "Pack de 6".
 *
 * Es la misma cuenta que hace la ventana de Combo, pero de un solo producto: se
 * ve el costo de lo que trae la caja, el margen contra el precio que se le pone,
 * y cuántas cajas se pueden armar con el stock que hay. El stock no se toca:
 * sigue en unidades.
 */
export default function PresentacionModal({ isOpen, onClose, product, presentation = null }) {
    const { savePresentation, currentCurrency } = useStore();
    const [nombre, setNombre] = useState('Caja');
    const [codigo, setCodigo] = useState('');
    const [unidades, setUnidades] = useState('');
    const [precio, setPrecio] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setNombre(presentation?.name || 'Caja');
        setCodigo(presentation?.barcode || '');
        setUnidades(presentation?.units ? String(presentation.units) : '');
        setPrecio(presentation?.price ? String(presentation.price) : '');
        setError('');
    }, [isOpen, presentation]);

    if (!isOpen || !product) return null;

    const plata = (n) => formatCurrency(Math.round(n || 0), currentCurrency);
    const u = Number(unidades) || 0;
    const p = Number(precio) || 0;
    const tasa = Number(product.tax_rate) || 0;
    const costoUnidad = Number(product.cost) || 0;

    // Mismas cuentas que la ventana de Combo (ProductCombos.jsx): el margen va
    // del precio neto contra el costo neto.
    const costoNeto = costoUnidad * u;
    const costoConIva = costoConImpuestos(costoNeto, tasa, product.extra_taxes);
    const margen = costoNeto > 0 && p > 0 ? margenDesdePrecio(p, costoNeto, tasa, product.extra_taxes) : null;
    const stock = Number(product.stock) || 0;
    const armadas = u > 0 ? Math.floor(stock / u) : 0;
    const precioUnidadEnCaja = u > 0 ? p / u : 0;
    const precioSuelto = Number(product.price) || 0;

    // Desde el 6-nov-2026 el precio ya no tiene que dividirse exacto por las
    // unidades: la boleta lleva el precio unitario con decimales
    // (api/sii/_sii.js → precioSii) y una caja de 12 a $18.500 cuadra.

    const guardar = async () => {
        setError('');
        const r = await savePresentation({
            id: presentation?.id || null,
            product_id: product.id,
            name: nombre,
            barcode: codigo,
            units: u,
            price: p,
        });
        if (!r?.success) { setError(r?.error || 'No se pudo guardar'); return; }
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-card modal-solido w-full max-w-lg max-h-full overflow-y-auto animate-[float_0.25s_ease-out]">
                <div className="flex items-start justify-between mb-4 gap-3">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                            <Package className="text-[var(--color-primary)] shrink-0" size={20} />
                            {presentation ? 'Editar unidad de medida' : 'Nueva unidad de medida'}
                        </h3>
                        <p className="text-sm text-[var(--color-text-muted)] truncate">{product.name}</p>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 shrink-0">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-[var(--color-text-muted)]">Nombre</label>
                            <input className="glass-input w-full" value={nombre} placeholder="Caja, Display, Pack…"
                                onChange={e => setNombre(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-[var(--color-text-muted)]">Unidades que trae</label>
                            <input className="glass-input w-full" type="number" inputMode="numeric" min="2" step="1"
                                value={unidades} placeholder="Ej: 30" onChange={e => setUnidades(e.target.value)} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[var(--color-text-muted)] flex items-center gap-1.5">
                            <ScanBarcode size={13} /> Código de barras <span className="font-normal opacity-70">(opcional)</span>
                        </label>
                        <input className="glass-input w-full" value={codigo} placeholder="El código de la caja, distinto al de la unidad"
                            onChange={e => setCodigo(e.target.value)} />
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                            Escanear este código en el POS vende directo la caja. El código del producto sigue vendiendo por unidad.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[var(--color-text-muted)]">Precio de venta {nombre ? `de la ${nombre.toLowerCase()}` : ''}</label>
                        <input className="glass-input w-full text-lg font-bold" type="number" inputMode="decimal" min="0"
                            value={precio} placeholder="IVA incluido" onChange={e => setPrecio(e.target.value)} />
                        {u > 0 && p > 0 && (
                            <p className="text-[11px] text-[var(--color-text-muted)]">
                                Sale a {plata(precioUnidadEnCaja)} cada unidad
                                {precioSuelto > 0 && ` · suelta: ${plata(precioSuelto)}`}
                                {precioSuelto > precioUnidadEnCaja && precioUnidadEnCaja > 0 &&
                                    ` · ahorra ${plata((precioSuelto - precioUnidadEnCaja) * u)} por ${nombre.toLowerCase() || 'caja'}`}
                            </p>
                        )}
                    </div>

                    {/* Las tres tarjetas de la ventana de Combo */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-center">
                            <p className="text-[10px] text-[var(--color-text-muted)]">Costo con IVA</p>
                            <p className="font-bold text-[var(--color-text)] text-sm">{u > 0 ? plata(costoConIva) : '—'}</p>
                            {u > 0 && <p className="text-[10px] text-[var(--color-text-muted)]">neto {plata(costoNeto)}</p>}
                        </div>
                        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-center">
                            <p className="text-[10px] text-[var(--color-text-muted)]">Margen</p>
                            <p className={`font-bold text-sm ${margen === null ? 'text-[var(--color-text)]' : margen >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {margen === null ? '—' : `${margen.toFixed(1)}%`}
                            </p>
                        </div>
                        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-center">
                            <p className="text-[10px] text-[var(--color-text-muted)]">{nombre ? `${nombre}s` : 'Cajas'} armadas</p>
                            <p className="font-bold text-sm text-[var(--color-primary)]">{u > 0 ? armadas : '—'}</p>
                            <p className="text-[10px] text-[var(--color-text-muted)]">de {stock} und</p>
                        </div>
                    </div>

                    {error && (
                        <p className="text-[11px] text-red-400 flex items-start gap-1">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" /> {error}
                        </p>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            Cancelar
                        </button>
                        <AsyncButton onClick={guardar} icon={<Check size={16} />} loadingText="Guardando…"
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold btn-primary flex items-center justify-center gap-1.5 disabled:opacity-50">
                            {presentation ? 'Guardar cambios' : 'Agregar'}
                        </AsyncButton>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
