import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layers, Package, Trash2, Plus, RefreshCw, AlertTriangle, ChevronDown, Check } from 'lucide-react';
import { formatCurrency } from '../utils/formatCurrency';
import { desdeSiguiente, puedeAgregarTramo, encadenarHasta, erroresEscala, primerErrorEscala } from '../utils/escalaTramos';

/**
 * Escala de mayoreo y precios de las cajas de un renglón de la compra, en el
 * mismo panel donde se cargan costo y precio de venta.
 *
 * Cuando la compra cambia el costo, la escala y las cajas quedan descuadradas:
 * sus precios se calcularon con el costo viejo. Acá se ven con el costo que se
 * está escribiendo —la utilidad de cada tramo se recalcula al tipear— y se
 * corrigen antes de agregar el renglón.
 *
 * Si el producto todavía no tiene escala ni cajas, se le crean acá mismo, sin
 * ir a la ficha del producto: tramos nuevos y cajas/bandejas nuevas (nombre,
 * unidades, código de barras y precio).
 *
 * NADA se guarda desde acá: los cambios viajan con el renglón y se aplican
 * recién al guardar la compra (ver purchaseCreate).
 *
 * Mismas cuentas que la ficha: precio final = costo × (1 + utilidad%) × (1 + IVA%).
 * El PRECIO es el dato guardado; la utilidad se calcula contra el costo actual.
 */

const precioDesdeUtilidad = (costo, utilidad, iva) => Math.round(costo * (1 + utilidad / 100) * (1 + iva / 100));
const utilidadDesdePrecio = (costo, precio, iva) => (costo > 0 ? ((precio / (1 + iva / 100)) - costo) / costo * 100 : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const normalizarEscala = (lista) => (lista || []).map(r => ({
    min: Number(r.min) || 0,
    // "Hasta" vacío o 0 = sin tope. Un 0 la tienda lo rechaza (exige >= 1) y
    // rechazaría el producto entero, stock incluido.
    max: Number(r.max) > 0 ? Number(r.max) : '',
    margin: r2(Number(r.margin) || 0),
    price: Math.round(Number(r.price) || 0),
})).filter(r => r.min > 0 && r.price > 0);

const NOMBRES_CAJA = ['Caja', 'Bandeja', 'Display', 'Pack'];
const MSG_NO_DIVIDE = 'Hay una caja con un precio que no se divide exacto por sus unidades: elegí uno de los sugeridos.';

export default function EscalaCompraEditor({ costo, iva, contexto, presentaciones = [], valor, onChange, currentCurrency, permiteCajas = true, precioUnidad = 0 }) {
    const costoAnterior = Number(contexto?.costoAnterior) || 0;
    const escalaOriginal = useMemo(() => (Array.isArray(contexto?.priceRanges) ? contexto.priceRanges : []), [contexto]);
    const plata = (n) => formatCurrency(Math.round(n || 0), currentCurrency);

    const [escala, setEscala] = useState(() => (Array.isArray(valor?.priceRanges) ? valor.priceRanges : escalaOriginal).map(r => ({
        min: r.min ?? '', max: r.max ?? '', price: Number(r.price) || 0,
        marginAnterior: Number(r.margin) || r2(utilidadDesdePrecio(costoAnterior, Number(r.price) || 0, iva)),
        texto: null,
    })));
    // Plegado por defecto: con escala de tres tramos y dos cajas son muchos
    // números juntos en el panel. El encabezado resume y avisa si hay que mirar.
    const [abierto, setAbierto] = useState(false);
    const [hayCambios, setHayCambios] = useState(!!valor);
    const [cajas, setCajas] = useState(() => presentaciones.map(p => {
        const cambio = (valor?.presentaciones || []).find(c => String(c.id) === String(p.id));
        return { id: p.id, name: p.name, units: Number(p.units), price: Number(cambio?.price ?? p.price), precioAnterior: Number(p.price) };
    }));
    // Cajas que todavía no existen: se crean al guardar la compra.
    const [nuevas, setNuevas] = useState(() => (valor?.nuevas || []).map((n, i) => ({
        key: `n${i}-${Date.now()}`, name: n.name || '', units: n.units ?? '', barcode: n.barcode || '', price: Number(n.price) || 0, precioTocado: true,
    })));

    // El contexto (escala actual) puede llegar después de abrir el panel.
    const inicializado = useRef(escalaOriginal.length > 0 || Array.isArray(valor?.priceRanges));
    useEffect(() => {
        if (inicializado.current || !escalaOriginal.length) return;
        inicializado.current = true;
        setEscala(escalaOriginal.map(r => ({
            min: r.min ?? '', max: r.max ?? '', price: Number(r.price) || 0,
            marginAnterior: Number(r.margin) || r2(utilidadDesdePrecio(costoAnterior, Number(r.price) || 0, iva)),
            texto: null,
        })));
    }, [escalaOriginal, costoAnterior, iva]);

    // Cada cambio se reporta al renglón; null si quedó igual que antes.
    useEffect(() => {
        const limpia = normalizarEscala(escala.map(r => ({ ...r, margin: utilidadDesdePrecio(costo, r.price, iva) })));
        const cambioEscala = JSON.stringify(limpia.map(({ margin, ...x }) => x)) !== JSON.stringify(normalizarEscala(escalaOriginal).map(({ margin, ...x }) => x));
        const cambiosCajas = cajas.filter(c => c.price !== c.precioAnterior).map(c => ({ id: c.id, price: c.price }));
        const nuevasLimpias = nuevas.map(n => ({ name: n.name.trim(), units: Number(n.units), barcode: n.barcode.trim(), price: Math.round(Number(n.price) || 0) }));
        // Un texto que dice qué falta, o false si todo está en orden.
        const incompleta = nuevasLimpias.some(n => !n.name || !(n.units >= 2) || !Number.isInteger(n.units) || !(n.price > 0));
        const noDivide = cajas.some(c => !(c.price > 0) || !Number.isInteger(c.price / c.units))
            || nuevasLimpias.some(n => n.units >= 2 && n.price > 0 && !Number.isInteger(n.price / n.units));
        const codigos = nuevasLimpias.map(n => n.barcode.toUpperCase()).filter(Boolean);
        const errorEscala = primerErrorEscala(escala);
        const invalidas = errorEscala || (incompleta
            ? 'Completá la caja nueva: nombre, unidades (2 o más, enteras) y precio.'
            : noDivide ? MSG_NO_DIVIDE
                : new Set(codigos).size !== codigos.length ? 'Dos cajas nuevas tienen el mismo código de barras.' : false);
        const hay = !!(cambioEscala || cambiosCajas.length || nuevasLimpias.length);
        setHayCambios(hay);
        onChange?.(hay
            ? { ...(cambioEscala ? { priceRanges: limpia } : {}), presentaciones: cambiosCajas, nuevas: nuevasLimpias, invalidas }
            : null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [escala, cajas, nuevas, costo, iva]);

    const cambioCosto = costoAnterior > 0 && costo > 0 ? ((costo - costoAnterior) / costoAnterior) * 100 : null;
    const tocar = (i, campo, v) => setEscala(prev => (campo === 'max' ? encadenarHasta(prev, i, v) : prev.map((r, k) => {
        if (k !== i) return r;
        if (campo === 'margin') return { ...r, texto: v, price: precioDesdeUtilidad(costo, Number(v) || 0, iva) };
        return { ...r, [campo]: campo === 'price' ? (Number(v) || 0) : v };
    })));
    const mantenerUtilidades = () => setEscala(prev => prev.map(r => ({ ...r, texto: null, price: precioDesdeUtilidad(costo, r.marginAnterior, iva) })));
    const costoCaja = (c) => costo * c.units;
    const margenCaja = (c) => utilidadDesdePrecio(costoCaja(c), c.price, iva);
    const margenCajaAnterior = (c) => utilidadDesdePrecio(costoAnterior * c.units, c.precioAnterior, iva);
    const mantenerCajas = () => setCajas(prev => prev.map(c => ({
        ...c, price: Math.round(precioDesdeUtilidad(costoCaja(c), margenCajaAnterior(c), iva) / c.units) * c.units,
    })));

    // El aviso "Costo ±x% · revisar" es para la escala y las cajas que YA tiene
    // el producto: sus precios se calcularon con el costo viejo. Si no tiene
    // ninguna, no hay nada que revisar y el aviso solo confunde.
    const costoCambio = cambioCosto !== null && Math.abs(cambioCosto) >= 0.5
        && (escalaOriginal.length > 0 || cajas.length > 0);
    const hayCajaInvalida = cajas.some(c => c.price > 0 && !Number.isInteger(c.price / c.units));
    const hayNuevaInvalida = nuevas.some(n => Number(n.units) >= 2 && Number(n.price) > 0 && !Number.isInteger(Number(n.price) / Number(n.units)));
    const errores = erroresEscala(escala);
    const sePuedeAgregarTramo = puedeAgregarTramo(escala);
    const tramosListos = escala.filter(r => Number(r.min) > 0 && Number(r.price) > 0).length;
    const resumen = [
        // Solo cuentan los tramos completos: uno recién agregado y vacío no es un tramo.
        tramosListos > 0 && `escala ${tramosListos} ${tramosListos === 1 ? 'tramo' : 'tramos'}`,
        cajas.length > 0 && cajas.map(c => `${c.name.toLowerCase()} ${c.units}`).join(', '),
        nuevas.length > 0 && `${nuevas.length} ${nuevas.length === 1 ? 'caja nueva' : 'cajas nuevas'}`,
    ].filter(Boolean).join(' · ');
    const agregarTramo = () => {
        setEscala(prev => {
            if (!puedeAgregarTramo(prev)) return prev;
            // "Desde" automático: 2 el primero, o el "hasta" anterior + 1. El resto, vacío.
            return [...prev, { min: desdeSiguiente(prev), max: '', price: 0, marginAnterior: 0, texto: null }];
        });
    };

    // Precio sugerido de una caja nueva: el de la unidad por las unidades. Ya
    // divide exacto; después se le baja lo que se quiera.
    const precioSugerido = (units) => (Number(units) >= 2 && precioUnidad > 0 ? Math.round(precioUnidad) * Number(units) : 0);
    const tocarNueva = (key, campo, v) => setNuevas(prev => prev.map(n => {
        if (n.key !== key) return n;
        if (campo === 'units') return { ...n, units: v, price: n.precioTocado ? n.price : precioSugerido(v) };
        if (campo === 'price') return { ...n, price: Number(v) || 0, precioTocado: true };
        return { ...n, [campo]: v };
    }));
    const agregarNueva = () => {
        const usados = new Set([...cajas, ...nuevas].map(c => String(c.name).toLowerCase()));
        const name = NOMBRES_CAJA.find(n => !usados.has(n.toLowerCase())) || '';
        const units = Number(contexto?.unitsPerBox) >= 2 && !cajas.length && !nuevas.length ? Number(contexto.unitsPerBox) : '';
        setNuevas(prev => [...prev, { key: `n${Date.now()}`, name, units, barcode: '', price: precioSugerido(units), precioTocado: false }]);
    };

    // Al cerrar, lo que se agregó y quedó en blanco se descarta: el panel vuelve
    // a quedar como si no se hubiera tocado.
    const abrirCerrar = () => {
        if (abierto) {
            setEscala(prev => prev.filter(r => Number(r.price) > 0));
            setNuevas(prev => prev.filter(n => n.units !== '' || n.barcode.trim() || n.precioTocado));
        }
        setAbierto(a => !a);
    };

    const botonesAgregar = (
        <div className="flex flex-wrap gap-2">
            <button type="button" onClick={agregarTramo} disabled={!sePuedeAgregarTramo}
                className="px-3 py-2 rounded-lg border border-dashed border-purple-500/40 text-xs font-bold text-purple-300 flex items-center gap-1 disabled:opacity-40">
                <Plus size={14} /> Tramo
            </button>
            {permiteCajas && (
                <button type="button" onClick={agregarNueva}
                    className="px-3 py-2 rounded-lg border border-dashed border-[var(--color-primary)]/40 text-xs font-bold text-[var(--color-primary)] flex items-center gap-1">
                    <Plus size={14} /> Caja o bandeja
                </button>
            )}
            {!sePuedeAgregarTramo && (
                <p className="w-full text-[10px] text-[var(--color-text-muted)]">Para otro tramo, poné "hasta" en el último.</p>
            )}
        </div>
    );

    return (
        <div className={`rounded-xl border bg-[var(--glass-bg)] ${hayCajaInvalida || hayNuevaInvalida ? 'border-amber-500/50' : 'border-[var(--glass-border)]'}`}>
            {/* Encabezado: siempre visible, abre y cierra */}
            <button type="button" onClick={abrirCerrar}
                className="w-full flex items-center gap-2 p-3 text-left">
                <Layers size={16} className="text-purple-400 shrink-0" />
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[var(--color-text)]">{permiteCajas || cajas.length ? 'Escala y cajas' : 'Escala'}</span>
                    {resumen && <span className="block text-[11px] text-[var(--color-text-muted)] truncate">{resumen}</span>}
                </span>
                {hayCambios ? (
                    <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold bg-green-500/15 border border-green-500/40 text-green-400 flex items-center gap-1">
                        <Check size={11} /> Modificado
                    </span>
                ) : costoCambio ? (
                    <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 border border-amber-500/40 text-amber-400">
                        Costo {cambioCosto > 0 ? '+' : ''}{cambioCosto.toFixed(1)}% · revisar
                    </span>
                ) : null}
                <ChevronDown size={16} className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${abierto ? 'rotate-180' : ''}`} />
            </button>

            <div className={abierto ? 'px-3 pb-3 space-y-3' : 'hidden'}>
            {escala.length > 0 && (
            <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5"><Layers size={15} className="text-purple-400" /> Escala de mayoreo</p>
                        {costoAnterior > 0 && escalaOriginal.length > 0 && (
                            <button type="button" onClick={mantenerUtilidades}
                                className="px-2 py-1 rounded-md text-[11px] font-bold border border-purple-500/40 bg-purple-500/10 text-purple-300 flex items-center gap-1">
                                <RefreshCw size={12} /> Mantener utilidades
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-[3.2rem_3.2rem_1fr_1fr_auto] gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                        <span>Desde</span><span>Hasta</span><span>Utilidad %</span><span>Precio c/IVA</span><span />
                    </div>
                    {escala.map((r, i) => {
                        const margen = utilidadDesdePrecio(costo, r.price, iva);
                        return (
                            <div key={i}>
                            <div className="grid grid-cols-[3.2rem_3.2rem_1fr_1fr_auto] gap-1.5 items-start">
                                <input type="number" className={`glass-input !py-1.5 !px-2 text-sm ${errores[i] ? '!border-red-500/70' : ''}`} value={r.min} onChange={e => tocar(i, 'min', e.target.value)} />
                                <input type="number" value={r.max} placeholder="∞" className={`glass-input !py-1.5 !px-2 text-sm ${errores[i] ? '!border-red-500/70' : ''}`} onChange={e => tocar(i, 'max', e.target.value)} />
                                <div>
                                    <input type="number" step="0.01" className={`glass-input w-full !py-1.5 !px-2 text-sm ${margen < 0 ? 'text-red-400' : 'text-green-400'}`}
                                        value={r.texto ?? (r.price > 0 ? r2(margen) : '')}
                                        onChange={e => tocar(i, 'margin', e.target.value)}
                                        onBlur={() => setEscala(prev => prev.map((x, k) => (k === i ? { ...x, texto: null } : x)))} />
                                    {costoAnterior > 0 && escalaOriginal[i] && <span className="block text-[10px] text-[var(--color-text-muted)]">antes {r2(r.marginAnterior)}%</span>}
                                </div>
                                <div>
                                    <input type="number" className="glass-input w-full !py-1.5 !px-2 text-sm font-bold" value={r.price || ''} onChange={e => tocar(i, 'price', e.target.value)} />
                                    {escalaOriginal[i] && Number(escalaOriginal[i].price) !== Number(r.price) && (
                                        <span className="block text-[10px] text-[var(--color-text-muted)]">antes {plata(escalaOriginal[i].price)}</span>
                                    )}
                                </div>
                                <button type="button" onClick={() => setEscala(prev => prev.filter((_, k) => k !== i))} className="p-1.5 text-red-400"><Trash2 size={14} /></button>
                            </div>
                            {errores[i] && <p className="text-[10px] text-red-400 mt-0.5">{errores[i]}</p>}
                            </div>
                        );
                    })}
            </div>
            )}

            {(cajas.length > 0 || nuevas.length > 0) && (
                <div className={`space-y-2 ${escala.length ? 'pt-2 border-t border-[var(--glass-border)]' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5"><Package size={15} className="text-[var(--color-primary)]" /> Cajas</p>
                        {costoAnterior > 0 && cajas.length > 0 && (
                            <button type="button" onClick={mantenerCajas}
                                className="px-2 py-1 rounded-md text-[11px] font-bold border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center gap-1">
                                <RefreshCw size={12} /> Mantener margen
                            </button>
                        )}
                    </div>
                    {cajas.map((c, i) => {
                        const divide = Number.isInteger(c.price / c.units);
                        return (
                            <div key={c.id} className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-[var(--color-text)] truncate">{c.name} · {c.units} und</p>
                                        {c.price !== c.precioAnterior && <p className="text-[10px] text-[var(--color-text-muted)]">antes {plata(c.precioAnterior)}</p>}
                                    </div>
                                    <div className="w-28 shrink-0">
                                        <input type="number" className="glass-input w-full !py-1.5 !px-2 text-sm font-bold" value={c.price}
                                            onChange={e => setCajas(prev => prev.map((x, k) => (k === i ? { ...x, price: Number(e.target.value) || 0 } : x)))} />
                                        <span className={`block text-[10px] ${margenCaja(c) >= 0 ? 'text-green-400' : 'text-red-400'}`}>margen {margenCaja(c).toFixed(1)}%</span>
                                    </div>
                                </div>
                                {!divide && c.price > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-400">
                                        <AlertTriangle size={11} /> No divide exacto en {c.units}:
                                        {[Math.floor(c.price / c.units) * c.units, Math.ceil(c.price / c.units) * c.units].filter(n => n > 0).map(n => (
                                            <button key={n} type="button" onClick={() => setCajas(prev => prev.map((x, k) => (k === i ? { ...x, price: n } : x)))}
                                                className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">{plata(n)}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {nuevas.map(n => {
                        const units = Number(n.units);
                        const price = Number(n.price) || 0;
                        const divide = units >= 2 && Number.isInteger(price / units);
                        const margen = units >= 2 ? utilidadDesdePrecio(costo * units, price, iva) : null;
                        return (
                            <div key={n.key} className="rounded-lg border border-dashed border-[var(--color-primary)]/40 p-2 space-y-2">
                                <div className="flex items-center gap-1">
                                    {NOMBRES_CAJA.map(nom => (
                                        <button key={nom} type="button" onClick={() => tocarNueva(n.key, 'name', nom)}
                                            className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${n.name === nom
                                                ? 'bg-[var(--color-primary)]/15 border-[var(--color-primary)]/50 text-[var(--color-primary)]'
                                                : 'border-[var(--glass-border)] text-[var(--color-text-muted)]'}`}>{nom}</button>
                                    ))}
                                    <button type="button" onClick={() => setNuevas(prev => prev.filter(x => x.key !== n.key))} className="ml-auto p-1.5 text-red-400" title="Quitar"><Trash2 size={14} /></button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="block">
                                        <span className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Unidades</span>
                                        <input type="number" inputMode="numeric" min="2" step="1" className="glass-input w-full !py-1.5 !px-2 text-sm" value={n.units} placeholder="30"
                                            onChange={e => tocarNueva(n.key, 'units', e.target.value)} />
                                    </label>
                                    <label className="block">
                                        <span className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Precio</span>
                                        <input type="number" inputMode="numeric" className="glass-input w-full !py-1.5 !px-2 text-sm font-bold" value={n.price || ''}
                                            onChange={e => tocarNueva(n.key, 'price', e.target.value)} />
                                        {margen !== null && price > 0 && costo > 0 && (
                                            <span className={`block text-[10px] ${margen >= 0 ? 'text-green-400' : 'text-red-400'}`}>margen {margen.toFixed(1)}%</span>
                                        )}
                                    </label>
                                </div>
                                <input type="text" className="glass-input w-full !py-1.5 !px-2 text-sm font-mono" value={n.barcode} placeholder="Código de barras (opcional)"
                                    onChange={e => tocarNueva(n.key, 'barcode', e.target.value)} />
                                {units >= 2 && price > 0 && !divide && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-400">
                                        <AlertTriangle size={11} /> No divide exacto en {units}:
                                        {[Math.floor(price / units) * units, Math.ceil(price / units) * units].filter(x => x > 0).map(x => (
                                            <button key={x} type="button" onClick={() => tocarNueva(n.key, 'price', x)}
                                                className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">{plata(x)}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                </div>
            )}

            {botonesAgregar}
            </div>
        </div>
    );
}
