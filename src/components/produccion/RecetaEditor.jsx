// La receta de un producto que se fabrica: cuánto rinde una tanda, qué insumos
// lleva y otros costos (gas, luz, mano de obra). Calcula el costo de la tanda y
// por unidad con el Costo + IVA de cada insumo (src/lib/produccion.js).
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, Trash2, X, Calculator } from 'lucide-react';
import { dataApiCall } from '../../lib/dataApi';
import { toast } from '../../lib/toast';
import {
    UNIDADES, UNIDADES_POR_FAMILIA, calcularReceta, costoNetoParaFicha, costoUnidadConImpuestos,
    medidaInsumo, unidadSugerida, plataFina, textoCantidad, nombreRinde, nombreRindeUno,
} from '../../lib/produccion';
import { tasaExtra } from '../../lib/impuestosProducto';
import { formatCurrency } from '../../utils/formatCurrency';

const FAMILIA_TEXTO = { peso: 'g o kg', volumen: 'ml o L', unidad: 'unidades' };

/** "Saco de 25 kg a $17.374 · $695 el kg" */
function detalleInsumo(producto, produccion, moneda) {
    if (!producto) return '';
    const m = medidaInsumo(producto, produccion);
    const costo = costoUnidadConImpuestos(producto);
    const util = m.porUnidad * (1 - m.merma / 100);
    const porBase = util > 0 ? costo / util : 0;
    const merma = m.merma > 0 ? ` · ${m.merma}% merma` : '';
    if (m.porSuUnidad) {
        return `por ${m.unidad} · ${plataFina(porBase * 1000, moneda)} el ${m.unidad}${merma}`;
    }
    if (m.sinContenido) return `${formatCurrency(costo, moneda)} la unidad`;
    const grande = m.familia === 'peso' ? 'kg' : m.familia === 'volumen' ? 'L' : null;
    const porGrande = grande ? `${plataFina(porBase * 1000, moneda)} el ${grande}` : `${plataFina(porBase, moneda)} c/u`;
    return `${textoCantidad(m.contenido, m.unidad)} a ${formatCurrency(costo, moneda)} · ${porGrande}${merma}`;
}

/** Para un insumo que se cuenta por unidad: decirle cuánto trae, ahí mismo. */
const ContenidoEnLinea = ({ producto, companyId, onGuardado, onCancelar }) => {
    const [contenido, setContenido] = useState('');
    const [unidad, setUnidad] = useState('kg');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    const guardar = async () => {
        setError('');
        if (!(parseFloat(String(contenido).replace(',', '.')) > 0)) { setError('Poné cuánto trae.'); return; }
        setGuardando(true);
        const r = await dataApiCall('production.saveInput', { companyId, productId: producto.id, content: contenido, unit: unidad });
        setGuardando(false);
        if (!r?.success) { setError(r?.error || 'No se pudo guardar'); return; }
        onGuardado(r.produccion);
    };

    return (
        <div className="rounded-lg border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 p-2.5 space-y-2" data-prueba="contenido-en-linea">
            <p className="text-[11px] text-[var(--color-text-muted)]">
                ¿Cuánto trae una unidad de <b className="text-[var(--color-text)]">{producto.name}</b>? Se guarda en su ficha al instante.
            </p>
            <div className="flex gap-2">
                <input type="number" step="any" min="0" inputMode="decimal" value={contenido}
                    onChange={(e) => setContenido(e.target.value)} placeholder="Ej: 25"
                    aria-label="Cuánto trae"
                    className="glass-input w-full min-w-0 text-sm" />
                <select value={unidad} onChange={(e) => setUnidad(e.target.value)} aria-label="Unidad"
                    className="glass-input w-24 shrink-0 text-sm">
                    {Object.keys(UNIDADES).map((u) => <option key={u} value={u} className="bg-gray-900">{UNIDADES[u].nombre}</option>)}
                </select>
            </div>
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end">
                <button type="button" onClick={onCancelar} className="px-3 py-2 rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-white/5">
                    Cancelar
                </button>
                <button type="button" onClick={guardar} disabled={guardando}
                    className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--color-primary)] text-black disabled:opacity-50">
                    {guardando ? 'Guardando…' : 'Guardar'}
                </button>
            </div>
        </div>
    );
};

const RecetaEditor = ({ receta, onChange, insumos, onInsumos, productId, unidad, iva, extras, moneda, companyId, onUsarCosto }) => {
    const [termino, setTermino] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [contenidoDe, setContenidoDe] = useState(null); // id del insumo al que se le está poniendo contenido
    const turnoRef = useRef(0);

    const calculo = calcularReceta(receta, insumos);
    const items = receta.items || [];
    const otros = receta.others || [];

    // Buscador de insumos: espera a que se deje de escribir.
    useEffect(() => {
        const t = termino.trim();
        if (t.length < 2) { setResultados([]); setBuscando(false); return; }
        const turno = ++turnoRef.current;
        setBuscando(true);
        const id = setTimeout(async () => {
            const r = await dataApiCall('production.search', { companyId, term: t, excludeId: productId || 0 });
            if (turno !== turnoRef.current) return;
            setBuscando(false);
            setResultados(r?.success ? r.insumos || [] : []);
        }, 300);
        return () => clearTimeout(id);
    }, [termino, companyId, productId]);

    const cambiarReceta = (campo, valor) => onChange({ ...receta, [campo]: valor });
    const cambiarLinea = (i, campo, valor) => cambiarReceta('items', items.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
    const quitarLinea = (i) => cambiarReceta('items', items.filter((_, j) => j !== i));
    const cambiarOtro = (i, campo, valor) => cambiarReceta('others', otros.map((o, j) => (j === i ? { ...o, [campo]: valor } : o)));
    const quitarOtro = (i) => cambiarReceta('others', otros.filter((_, j) => j !== i));

    const agregarInsumo = ({ producto, produccion }) => {
        const id = Number(producto.id);
        setTermino('');
        setResultados([]);
        if (items.some((l) => Number(l.product_id) === id)) {
            toast(`${producto.name} ya está en la receta.`, 'info');
            return;
        }
        onInsumos((m) => ({ ...m, [id]: { producto, produccion } }));
        cambiarReceta('items', [...items, { product_id: id, qty: '', unit: unidadSugerida(producto, produccion) }]);
    };

    const contenidoGuardado = (id, produccion) => {
        const actual = insumos[id];
        if (!actual) return;
        onInsumos((m) => ({ ...m, [id]: { ...m[id], produccion } }));
        // La línea pasa a la unidad que corresponde (de "und" a kg, por ejemplo).
        const unidadNueva = unidadSugerida(actual.producto, produccion);
        cambiarReceta('items', items.map((l) => (Number(l.product_id) === id ? { ...l, unit: unidadNueva } : l)));
        setContenidoDe(null);
        toast(`Listo: ${actual.producto.name} trae ${textoCantidad(produccion.input_content, produccion.input_unit)}. Revisá la cantidad.`, 'success');
    };

    const neto = calculo.porUnidad ? costoNetoParaFicha(calculo.porUnidad, iva, extras) : 0;
    const impuestosPropios = (Number(iva) || 0) + tasaExtra(extras);
    const uno = nombreRindeUno(unidad);

    return (
        <div className="space-y-4 pl-1" data-prueba="receta">
            {/* Rinde */}
            <div>
                <label htmlFor="receta-rinde" className="block text-sm text-[var(--color-text-muted)] mb-1">Una tanda rinde</label>
                <div className="flex items-center gap-2">
                    <input id="receta-rinde" type="number" step="any" min="0" inputMode="decimal"
                        value={receta.yield ?? ''} onChange={(e) => cambiarReceta('yield', e.target.value)}
                        placeholder="Ej: 100" className="glass-input w-32" />
                    <span className="text-sm text-[var(--color-text-muted)]">{nombreRinde(unidad)}</span>
                </div>
            </div>

            {/* Insumos */}
            <div className="space-y-2">
                <p className="text-sm text-[var(--color-text-muted)]">Insumos de la tanda</p>
                {items.length === 0 && (
                    <p className="text-xs text-[var(--color-text-muted)] italic">Todavía no hay insumos: buscalos abajo.</p>
                )}
                {calculo.lineas.map((l, i) => {
                    const ins = insumos[Number(l.product_id)];
                    const familia = l.medida?.familia;
                    const opciones = familia ? UNIDADES_POR_FAMILIA[familia] : Object.keys(UNIDADES);
                    const conActual = opciones.includes(l.unit) ? opciones : [l.unit, ...opciones];
                    return (
                        <div key={`${l.product_id}-${i}`} data-prueba="receta-linea"
                            className={`rounded-lg border p-2.5 space-y-2 bg-[var(--color-surface)] ${l.error && l.error !== 'cantidad' ? 'border-red-500/50' : 'border-[var(--glass-border)]'}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-[var(--color-text)] truncate">
                                        {ins?.producto?.name || `Producto borrado (#${l.product_id})`}
                                    </p>
                                    {ins?.producto && (
                                        <p className="text-[11px] text-[var(--color-text-muted)] truncate">{detalleInsumo(ins.producto, ins.produccion, moneda)}</p>
                                    )}
                                </div>
                                <button type="button" onClick={() => quitarLinea(i)} aria-label={`Quitar ${ins?.producto?.name || 'insumo'}`}
                                    className="-my-1 -mr-1 w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="number" step="any" min="0" inputMode="decimal" value={l.qty ?? ''}
                                    onChange={(e) => cambiarLinea(i, 'qty', e.target.value)}
                                    aria-label={`Cantidad de ${ins?.producto?.name || 'insumo'}`}
                                    placeholder="Cant." className="glass-input w-24 min-w-0 text-sm" />
                                <select value={l.unit} onChange={(e) => cambiarLinea(i, 'unit', e.target.value)}
                                    aria-label="Unidad" className="glass-input w-20 shrink-0 text-sm">
                                    {conActual.map((u) => (
                                        <option key={u} value={u} className="bg-gray-900">{UNIDADES[u]?.nombre || u}</option>
                                    ))}
                                </select>
                                <span data-prueba="linea-costo" className="ml-auto font-mono font-bold text-sm text-[var(--color-text)]">
                                    {l.error && l.error !== 'cantidad' ? '—' : plataFina(l.costo, moneda)}
                                </span>
                            </div>
                            {l.error === 'eliminado' && <p className="text-[11px] text-red-400">Este producto ya no existe: quitalo de la receta.</p>}
                            {l.error === 'unidad' && (
                                <p className="text-[11px] text-red-400">Esta unidad no sirve para este insumo: elegí {FAMILIA_TEXTO[familia] || 'otra'}.</p>
                            )}
                            {l.error === 'cantidad' && <p className="text-[11px] text-[var(--color-text-muted)]">Falta la cantidad.</p>}
                            {/* Estos dos se muestran aunque falte la cantidad: es justo
                                cuando se está por escribir "5" pensando en kilos. */}
                            {(!l.error || l.error === 'cantidad') && l.aviso === 'sinCosto' && (
                                <p className="text-[11px] text-red-400">Su ficha no tiene costo, así que suma $0. Cargale el costo.</p>
                            )}
                            {(!l.error || l.error === 'cantidad') && l.aviso === 'sinContenido' && contenidoDe !== Number(l.product_id) && (
                                <p className="text-[11px] text-amber-400">
                                    Se cuenta por unidad entera. ¿Viene en saco, bolsa o caja?{' '}
                                    <button type="button" onClick={() => setContenidoDe(Number(l.product_id))}
                                        className="underline font-bold">Indicar cuánto trae</button>
                                </p>
                            )}
                            {contenidoDe === Number(l.product_id) && ins?.producto && (
                                <ContenidoEnLinea producto={ins.producto} companyId={companyId}
                                    onGuardado={(p) => contenidoGuardado(Number(l.product_id), p)}
                                    onCancelar={() => setContenidoDe(null)} />
                            )}
                        </div>
                    );
                })}

                {/* Buscador */}
                <div className="relative">
                    {/* z-10: glass-input usa backdrop-filter y se pinta encima de lo que va antes. */}
                    <Search size={16} className="absolute z-10 left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                    <input type="search" value={termino} onChange={(e) => setTermino(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        placeholder="Agregar insumo: harina, levadura…" aria-label="Buscar insumo"
                        data-prueba="buscar-insumo"
                        className="glass-input w-full !pl-9 text-sm" />
                </div>
                {buscando && <p className="text-[11px] text-[var(--color-text-muted)] animate-pulse">Buscando…</p>}
                {!buscando && termino.trim().length >= 2 && resultados.length === 0 && (
                    <p className="text-[11px] text-[var(--color-text-muted)]">Nada con “{termino.trim()}”.</p>
                )}
                {resultados.length > 0 && (
                    <div className="rounded-lg border border-[var(--glass-border)] divide-y divide-[var(--glass-border)] overflow-hidden" data-prueba="resultados-insumo">
                        {resultados.map((x) => (
                            <button key={x.producto.id} type="button" onClick={() => agregarInsumo(x)}
                                className="w-full text-left px-3 py-2.5 min-h-[44px] hover:bg-[var(--color-primary)]/10 flex items-center gap-2">
                                <Plus size={14} className="text-[var(--color-primary)] shrink-0" />
                                <span className="min-w-0">
                                    <span className="block text-sm text-[var(--color-text)] truncate">{x.producto.name}</span>
                                    <span className="block text-[11px] text-[var(--color-text-muted)] truncate">
                                        {x.produccion?.is_input ? 'Insumo · ' : ''}{detalleInsumo(x.producto, x.produccion, moneda)}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Otros costos */}
            <div className="space-y-2">
                <div>
                    <p className="text-sm text-[var(--color-text-muted)]">Otros costos de la tanda</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">Gas, luz, mano de obra, envases: lo que gastás por tanda, en plata.</p>
                </div>
                {otros.map((o, i) => (
                    <div key={i} className="flex items-center gap-2" data-prueba="receta-otro">
                        <input type="text" value={o.name} onChange={(e) => cambiarOtro(i, 'name', e.target.value)}
                            placeholder="Gas y luz" aria-label="Qué es" maxLength={60}
                            className="glass-input flex-1 min-w-0 text-sm" />
                        <div className="relative w-28 shrink-0">
                            <span className="absolute z-10 left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)] pointer-events-none">$</span>
                            <input type="number" step="any" min="0" inputMode="decimal" value={o.amount ?? ''}
                                onChange={(e) => cambiarOtro(i, 'amount', e.target.value)}
                                aria-label={`Monto de ${o.name || 'otro costo'}`}
                                placeholder="0" className="glass-input w-full !pl-6 text-sm" />
                        </div>
                        <button type="button" onClick={() => quitarOtro(i)} aria-label={`Quitar ${o.name || 'otro costo'}`}
                            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10">
                            <X size={16} />
                        </button>
                    </div>
                ))}
                {otros.length < 10 && (
                    <button type="button" onClick={() => cambiarReceta('others', [...otros, { name: '', amount: '' }])}
                        className="w-full py-2.5 rounded-lg border border-dashed border-[var(--color-primary)]/50 text-[var(--color-primary)] text-sm font-bold flex items-center justify-center gap-1.5 hover:bg-[var(--color-primary)]/10">
                        <Plus size={16} /> Agregar otro costo
                    </button>
                )}
            </div>

            {/* Resumen */}
            <div data-prueba="receta-resumen" className="rounded-xl bg-black/20 border border-white/10 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3 text-[var(--color-text-muted)]">
                    <span>Insumos (con IVA)</span><span className="font-mono">{plataFina(calculo.totalInsumos, moneda)}</span>
                </div>
                {calculo.totalOtros > 0 && (
                    <div className="flex justify-between gap-3 text-[var(--color-text-muted)]">
                        <span>Otros costos</span><span className="font-mono">{plataFina(calculo.totalOtros, moneda)}</span>
                    </div>
                )}
                <div className="flex justify-between gap-3 font-bold text-[var(--color-text)]">
                    <span>Costo de la tanda</span><span data-prueba="costo-tanda" className="font-mono">{plataFina(calculo.total, moneda)}</span>
                </div>
                <div className="flex justify-between items-baseline gap-3 pt-1.5 border-t border-white/10">
                    <span className="text-[var(--color-text)]">Costo por {uno}</span>
                    <span data-prueba="costo-por-unidad" className="font-mono font-bold text-xl text-[var(--color-primary)]">
                        {calculo.porUnidad ? plataFina(calculo.porUnidad, moneda) : '—'}
                    </span>
                </div>
                {!calculo.rinde && (
                    <p className="text-[11px] text-amber-400">Poné cuánto rinde la tanda para saber el costo por {uno}.</p>
                )}
                {calculo.errores > 0 && (
                    <p className="text-[11px] text-red-400">
                        {calculo.errores === 1 ? 'Un insumo no se está sumando' : `${calculo.errores} insumos no se están sumando`}: revisalos arriba.
                    </p>
                )}
                <button type="button" data-prueba="usar-como-costo"
                    disabled={!calculo.porUnidad || calculo.errores > 0}
                    onClick={() => onUsarCosto(neto, calculo.porUnidad)}
                    className="mt-2 w-full py-3 rounded-xl bg-[var(--color-primary)] text-black font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                    <Calculator size={16} /> Usar como costo
                </button>
                {calculo.porUnidad > 0 && calculo.errores === 0 && (
                    <p className="text-[11px] text-[var(--color-text-muted)] leading-snug" data-prueba="usar-como-costo-ayuda">
                        {impuestosPropios > 0
                            ? <>Pone {plataFina(neto, moneda)} en Costo ($), que va sin IVA. Con el IVA ({impuestosPropios}%) queda en {plataFina(calculo.porUnidad, moneda)}, lo mismo que la receta. El precio de venta no cambia: ajustá la utilidad o el precio.</>
                            : <>Pone {plataFina(neto, moneda)} en Costo ($). El precio de venta no cambia: ajustá la utilidad o el precio.</>}
                    </p>
                )}
            </div>
        </div>
    );
};

export default RecetaEditor;
