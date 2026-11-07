import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { usePermissions } from '../hooks/usePermissions';
import { formatCurrency } from '../utils/formatCurrency';
import { costoBase, costoConImpuestos, tasaExtra } from '../lib/impuestosProducto';

const CREAR = '__crear';
const ACTUAL = '__actual';
// Kevin, 6-nov-2026: "hasta 3 impuestos" = el IVA y dos más.
const MAX_OTROS = 2;
const ALTA_VACIA = { name: '', rate: '', error: '', guardando: false, indice: null };

const ROTULO = 'block text-sm text-[var(--color-text-muted)] mb-1';
const CAJA = 'min-h-[42px] flex items-center rounded-lg border border-dashed border-[var(--glass-border)] px-3 py-2 font-mono font-bold text-[var(--color-text)]';

/**
 * Los impuestos que el proveedor cobra además del IVA (el 5% del cerdo).
 *
 * Cada uno va en una fila igual a la del IVA: a la izquierda el impuesto y a la
 * derecha el costo acumulado (costo + IVA + este + los de arriba). Debajo queda
 * otra fila para agregar el siguiente, hasta MAX_OTROS.
 *
 * Se eligen del mismo catálogo de Impuestos; si falta uno, se puede crear desde
 * acá, sin salir de la ficha y sin perder lo que ya se escribió en ella.
 */
const OtrosImpuestos = ({ extras, costo, iva, onChange }) => {
    const { taxRates, addTaxRate, currentCurrency, hasModule } = useStore();
    const { can } = usePermissions();
    const [alta, setAlta] = useState(null);

    const plata = (n) => formatCurrency(n, currentCurrency);
    const hayCosto = Number(costo) > 0;
    const puedeCrear = can('taxes.create') && hasModule('taxes');
    const ivaNum = Number(iva) || 0;
    const hayLugar = extras.length < MAX_OTROS;

    // No se ofrece el que ya es el IVA del producto ni los que ya están puestos.
    const libres = (taxRates || []).filter((t) => t && Number(t.rate) > 0
        && Number(t.rate) !== ivaNum
        && !extras.some((e) => e.name === t.name));

    // indice null = agregar al final; un número = reemplazar ese.
    const poner = (indice, nuevo) => onChange(indice == null
        ? [...extras, nuevo]
        : extras.map((e, j) => (j === indice ? nuevo : e)));

    const elegir = (indice) => (ev) => {
        const valor = ev.target.value;
        if (!valor || valor === ACTUAL) return;
        if (valor === CREAR) { setAlta({ ...ALTA_VACIA, indice }); return; }
        const tasa = libres.find((t) => String(t.id) === valor);
        if (tasa) poner(indice, { name: tasa.name, rate: Number(tasa.rate) });
    };

    const quitar = (indice) => {
        if (alta?.indice === indice) setAlta(null);
        onChange(extras.filter((_, j) => j !== indice));
    };

    const crear = async () => {
        const name = alta.name.trim();
        const rate = parseFloat(String(alta.rate).replace(',', '.'));
        if (!name) { setAlta({ ...alta, error: 'Ponle un nombre.' }); return; }
        if (!(rate > 0) || rate > 100) { setAlta({ ...alta, error: 'La tasa va entre 0 y 100.' }); return; }
        if (extras.some((e, j) => e.name === name && j !== alta.indice)) { setAlta({ ...alta, error: 'Ese impuesto ya está en este producto.' }); return; }
        setAlta({ ...alta, guardando: true, error: '' });
        const r = await addTaxRate({ name, rate, is_default: false }).catch((err) => ({ success: false, error: err?.message }));
        if (!r?.success) {
            setAlta({ ...alta, guardando: false, error: r?.error || 'No se pudo crear. Revisa tu conexión.' });
            return;
        }
        poner(alta.indice, { name, rate });
        setAlta(null);
    };

    // Enter acá no tiene que guardar la ficha entera.
    const sinEnviar = (e) => { if (e.key === 'Enter') { e.preventDefault(); crear(); } };

    const opciones = (
        <>
            {libres.map((t) => (
                <option key={t.id} value={t.id} className="bg-gray-900">{t.name} ({t.rate}%)</option>
            ))}
            {puedeCrear && <option value={CREAR} className="bg-gray-900">Crear uno nuevo…</option>}
        </>
    );

    return (
        <div className="space-y-4">
            {extras.map((e, i) => {
                const hasta = extras.slice(0, i + 1);
                const tasa = Number((ivaNum + tasaExtra(hasta)).toFixed(2));
                const id = `otro-impuesto-${i + 1}`;
                return (
                    // items-end: el rótulo de la derecha crece con cada impuesto y
                    // en un celular ocupa varios renglones.
                    <div key={e.name} className="grid grid-cols-2 gap-4 items-end">
                        <div>
                            <div className="flex items-center justify-between gap-1 mb-1">
                                <label htmlFor={id} className="min-w-0 truncate text-sm text-[var(--color-text-muted)]">Otro impuesto</label>
                                {/* Márgenes negativos: se toca cómodo con el dedo sin agrandar el
                                    renglón ni empujar el rótulo a dos líneas en un celular. */}
                                <button
                                    type="button"
                                    aria-label={`Quitar ${e.name}`}
                                    title={`Quitar ${e.name}`}
                                    onClick={() => quitar(i)}
                                    className="-my-2 -mr-3 shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-400/10"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <select id={id} value={ACTUAL} onChange={elegir(i)} className="glass-input w-full">
                                <option value={ACTUAL} className="bg-gray-900">{e.name} ({e.rate}%)</option>
                                {opciones}
                            </select>
                        </div>
                        <div>
                            <p data-prueba="rotulo-acumulado" className={`${ROTULO} break-words`}>
                                Costo + IVA + {hasta.map((x) => x.name).join(' + ')} ({tasa}%)
                            </p>
                            <div data-prueba="costo-acumulado" className={CAJA}>
                                {hayCosto ? plata(costoConImpuestos(costo, ivaNum, hasta)) : '—'}
                            </div>
                        </div>
                    </div>
                );
            })}

            {alta ? (
                <div className="rounded-xl border border-[var(--glass-border)] p-3 space-y-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                        <input
                            type="text"
                            autoFocus
                            maxLength={60}
                            aria-label="Nombre del impuesto"
                            placeholder="Ej: Impuesto cerdo"
                            value={alta.name}
                            onChange={(e) => setAlta({ ...alta, name: e.target.value, error: '' })}
                            onKeyDown={sinEnviar}
                            className="glass-input w-full"
                        />
                        <div className="relative">
                            <input
                                type="number"
                                step="any"
                                min="0"
                                aria-label="Tasa del impuesto"
                                placeholder="5"
                                value={alta.rate}
                                onChange={(e) => setAlta({ ...alta, rate: e.target.value, error: '' })}
                                onKeyDown={sinEnviar}
                                className="glass-input w-full !pr-7"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                        </div>
                    </div>
                    {alta.error && <p role="alert" className="text-xs text-red-400">{alta.error}</p>}
                    <div className="flex gap-2">
                        <button type="button" onClick={crear} disabled={alta.guardando} className="btn-primary flex-1 min-h-[40px] flex items-center justify-center gap-1 text-sm disabled:opacity-60">
                            <Plus size={16} /> {alta.guardando ? 'Creando…' : (alta.indice == null ? 'Crear y agregar' : 'Crear y cambiar')}
                        </button>
                        <button type="button" onClick={() => setAlta(null)} disabled={alta.guardando} className="min-h-[40px] px-4 rounded-lg border border-[var(--glass-border)] text-sm text-[var(--color-text-muted)]">
                            Cancelar
                        </button>
                    </div>
                </div>
            ) : hayLugar && (libres.length > 0 || puedeCrear) ? (
                <div className="grid grid-cols-2 gap-4 items-end">
                    {/* En el celular la media columna corta el texto: ahí va a lo ancho. */}
                    <div className="col-span-2 sm:col-span-1">
                        <label htmlFor="otros-impuestos" className={ROTULO}>
                            Otro impuesto <span className="text-xs">(opcional)</span>
                        </label>
                        <select id="otros-impuestos" value="" onChange={elegir(null)} className="glass-input w-full">
                            <option value="" className="bg-gray-900">+ Agregar otro impuesto</option>
                            {opciones}
                        </select>
                    </div>
                </div>
            ) : extras.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">No hay otros impuestos en la lista. Pídele a un administrador que los cree en Impuestos.</p>
            ) : null}

            {extras.length > 0 && hayCosto && (
                <p className="text-xs text-[var(--color-text-muted)]">
                    Los otros impuestos se suman al costo: la utilidad se calcula sobre {plata(costoBase(costo, extras))}.
                </p>
            )}
        </div>
    );
};

export default OtrosImpuestos;
