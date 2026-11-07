// Producción en la ficha del producto (Fase 1, 6-nov-2026).
//
// Dos interruptores independientes:
//  - "Se usa como insumo": cuánto trae una unidad (el saco trae 25 kg) y cuánto
//    se pierde al usarlo. Con eso la receta sabe cuánto cuesta un gramo.
//  - "Lo fabrico yo": la receta. Calcula el costo de la tanda y por unidad, y
//    "Usar como costo" lo pasa al campo Costo de esta misma ficha.
// Un producto puede ser las dos cosas (una masa base que se usa en otras recetas).
import React from 'react';
import { Factory, RefreshCw } from 'lucide-react';
import RecetaEditor from './RecetaEditor';
import { UNIDADES, medidaInsumo, sugerirContenido, plataFina, textoCantidad } from '../../lib/produccion';
import { costoConImpuestos } from '../../lib/impuestosProducto';
import { formatCurrency } from '../../utils/formatCurrency';

const Interruptor = ({ activo, onClick, etiqueta, ayuda, prueba }) => (
    <button
        type="button"
        onClick={onClick}
        data-prueba={prueba}
        aria-pressed={activo}
        className="w-full flex items-center justify-between gap-3 text-left min-h-[44px]"
    >
        <span className="min-w-0">
            <span className="block text-sm font-bold text-[var(--color-text)]">{etiqueta}</span>
            <span className="block text-[11px] text-[var(--color-text-muted)] leading-snug">{ayuda}</span>
        </span>
        <span className={`w-12 h-6 shrink-0 rounded-full flex items-center p-1 transition-all duration-300 ${activo ? 'bg-[var(--color-primary)]' : 'bg-gray-600'}`}>
            <span className={`w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${activo ? 'translate-x-6' : 'translate-x-0'}`} />
        </span>
    </button>
);

/** "$17.374 la unidad → $695 el kg → $0,69 el g" */
function desglose(costoUnidad, medida, moneda) {
    const partes = [`${formatCurrency(costoUnidad, moneda)} ${medida.porSuUnidad ? `el ${medida.unidad}` : 'la unidad'}`];
    const util = medida.porUnidad * (1 - medida.merma / 100);
    if (!(util > 0)) return partes;
    const porBase = costoUnidad / util;
    if (medida.familia === 'peso') {
        if (!medida.porSuUnidad) partes.push(`${plataFina(porBase * 1000, moneda)} el kg`);
        partes.push(`${plataFina(porBase, moneda)} el g`);
    } else if (medida.familia === 'volumen') {
        if (!medida.porSuUnidad) partes.push(`${plataFina(porBase * 1000, moneda)} el L`);
        partes.push(`${plataFina(porBase, moneda)} el ml`);
    } else if (medida.porUnidad > 1) {
        partes.push(`${plataFina(porBase, moneda)} cada una`);
    }
    return partes;
}

const InsumoCampos = ({ valor, onChange, nombre, unidad, costo, iva, extras, moneda, sugerido }) => {
    const medida = medidaInsumo({ unit: unidad }, valor);
    const costoUnidad = costoConImpuestos(costo, iva, extras);
    const porSuUnidad = ['kg', 'lt', 'l'].includes(String(unidad || '').toLowerCase());
    const cambiar = (campo, v) => onChange({ ...valor, [campo]: v });

    return (
        <div className="space-y-3 pl-1" data-prueba="insumo-campos">
            {porSuUnidad ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                    Se vende por {String(unidad).toLowerCase() === 'kg' ? 'kilo: en las recetas se usa en g o kg' : 'litro: en las recetas se usa en ml o L'}.
                </p>
            ) : (
                <div>
                    <label htmlFor="insumo-contenido" className="block text-sm text-[var(--color-text-muted)] mb-1">
                        Una unidad trae
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="insumo-contenido"
                            type="number" step="any" min="0" inputMode="decimal"
                            value={valor.input_content ?? ''}
                            onChange={(e) => cambiar('input_content', e.target.value)}
                            placeholder="Ej: 25"
                            className="glass-input w-full min-w-0"
                        />
                        <select
                            aria-label="Unidad del contenido"
                            value={valor.input_unit || ''}
                            onChange={(e) => cambiar('input_unit', e.target.value)}
                            className="glass-input w-28 shrink-0"
                        >
                            <option value="" className="bg-gray-900">Unidad…</option>
                            {Object.keys(UNIDADES).map((u) => (
                                <option key={u} value={u} className="bg-gray-900">{UNIDADES[u].nombre}</option>
                            ))}
                        </select>
                    </div>
                    {sugerido && (
                        <p className="text-[11px] text-[var(--color-primary)] mt-1">Sacado del nombre: revisá que esté bien.</p>
                    )}
                    {!valor.input_content && (
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                            Por ejemplo, un saco de harina trae 25 kg; una bandeja de huevos, 30 und.
                            {sugerirContenido(nombre) ? '' : ' Sin esto se usa por unidad entera.'}
                        </p>
                    )}
                </div>
            )}

            <div className="flex items-end gap-3">
                <div className="w-28 shrink-0">
                    <label htmlFor="insumo-merma" className="block text-sm text-[var(--color-text-muted)] mb-1">Merma</label>
                    <div className="relative">
                        <input
                            id="insumo-merma"
                            type="number" step="any" min="0" max="95" inputMode="decimal"
                            value={valor.input_waste ?? ''}
                            onChange={(e) => cambiar('input_waste', e.target.value)}
                            placeholder="0"
                            className="glass-input w-full pr-7"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">%</span>
                    </div>
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)] leading-snug pb-1">
                    Lo que se pierde al usarlo (hueso, cáscara). Si no se pierde nada, dejalo en 0.
                </p>
            </div>

            <div data-prueba="insumo-desglose" className="rounded-lg border border-dashed border-[var(--glass-border)] px-3 py-2 text-xs">
                {costo > 0 ? (
                    <>
                        <span className="text-[var(--color-text-muted)]">Costo + IVA: </span>
                        <span className="font-mono font-bold text-[var(--color-text)]">{desglose(costoUnidad, medida, moneda).join('  →  ')}</span>
                        {medida.merma > 0 && <span className="text-[var(--color-text-muted)]"> (con {medida.merma}% de merma)</span>}
                        {medida.sinContenido && !porSuUnidad && (
                            <span className="block text-amber-400 mt-1">Indicá cuánto trae para poder usarlo por gramo o por litro.</span>
                        )}
                        {!medida.sinContenido && !medida.porSuUnidad && (
                            <span className="block text-[var(--color-text-muted)] mt-1">
                                Una unidad = {textoCantidad(medida.contenido, medida.unidad)}.
                            </span>
                        )}
                    </>
                ) : (
                    <span className="text-amber-400">Poné el costo (en Precios y Margen) para ver cuánto cuesta el gramo.</span>
                )}
            </div>
        </div>
    );
};

const ProduccionFicha = ({
    productId, nombre, unidad, costo, iva, extras, moneda,
    produccion, onUsarCosto, companyId,
}) => {
    const { valor, setValor, insumos, setInsumos, estado, error, recargar } = produccion;
    const [sugerido, setSugerido] = React.useState(false);

    const alternarInsumo = () => {
        if (valor.is_input) { setValor({ ...valor, is_input: false }); return; }
        const nuevo = { ...valor, is_input: true };
        // Al prenderlo, si no tiene contenido, se propone el del nombre.
        const porSuUnidad = ['kg', 'lt', 'l'].includes(String(unidad || '').toLowerCase());
        const s = !porSuUnidad && !valor.input_content ? sugerirContenido(nombre) : null;
        if (s) { nuevo.input_content = s.content; nuevo.input_unit = s.unit; }
        setSugerido(!!s);
        setValor(nuevo);
    };

    const alternarReceta = () => {
        setValor((v) => (v.recipe ? { ...v, recipe: null } : { ...v, recipe: { yield: '', items: [], others: [] } }));
    };

    // Si se apaga la receta habiendo cargado insumos, se pide confirmación: se pierde todo.
    const pedirApagarReceta = () => {
        const r = valor.recipe;
        const tieneAlgo = r && (r.items?.length || r.others?.length);
        if (tieneAlgo && !window.confirm('¿Quitar la receta? Se borran sus insumos al guardar el producto.')) return;
        alternarReceta();
    };

    return (
        <div data-prueba="produccion" className="rounded-xl p-4 border border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-3">
            <div>
                <p className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                    <Factory size={16} className="text-[var(--color-primary)]" /> Producción
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Para saber cuánto te cuesta fabricar lo que vendés, con los insumos de tu inventario.
                </p>
            </div>

            {estado === 'cargando' && (
                <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Cargando…</p>
            )}

            {estado === 'error' && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-2">
                    <p>No se pudo cargar la receta ({error}). Mientras tanto no se cambia nada de producción al guardar.</p>
                    <button type="button" onClick={recargar}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/40 font-bold hover:bg-red-500/10">
                        <RefreshCw size={14} /> Reintentar
                    </button>
                </div>
            )}

            {estado === 'listo' && (
                <>
                    <Interruptor
                        prueba="interruptor-insumo"
                        activo={valor.is_input}
                        onClick={alternarInsumo}
                        etiqueta="Se usa como insumo"
                        ayuda="Harina, levadura, carne: lo que entra en lo que fabricás."
                    />
                    {valor.is_input && (
                        <InsumoCampos
                            valor={valor}
                            onChange={(v) => { setSugerido(false); setValor(v); }}
                            nombre={nombre}
                            unidad={unidad}
                            costo={Number(costo) || 0}
                            iva={iva}
                            extras={extras}
                            moneda={moneda}
                            sugerido={sugerido}
                        />
                    )}

                    <div className="border-t border-[var(--glass-border)]" />

                    <Interruptor
                        prueba="interruptor-receta"
                        activo={!!valor.recipe}
                        onClick={valor.recipe ? pedirApagarReceta : alternarReceta}
                        etiqueta="Lo fabrico yo (tiene receta)"
                        ayuda="Pan, empanadas, queques: cargás sus insumos y se calcula el costo."
                    />
                    {valor.recipe && (
                        <RecetaEditor
                            receta={valor.recipe}
                            onChange={(recipe) => setValor((v) => ({ ...v, recipe }))}
                            insumos={insumos}
                            onInsumos={setInsumos}
                            productId={productId}
                            unidad={unidad}
                            iva={iva}
                            extras={extras}
                            moneda={moneda}
                            companyId={companyId}
                            onUsarCosto={onUsarCosto}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default ProduccionFicha;
