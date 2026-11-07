// Pestaña Producción (Fase 1, 6-nov-2026): lo que se fabrica, cuánto cuesta según
// su receta, cuánto dice su ficha y cuánto se le gana. Y los insumos, con su
// costo por kilo, litro o unidad.
//
// No confundir con /production, que es Cocina (los encargos del día). Esta es
// /recetas porque lo que muestra son recetas y costos; en el menú dice Producción.
//
// Solo lee y abre fichas. No mueve stock: registrar una tanda es la Fase 2.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Factory, Search, AlertTriangle, CheckCircle2, RefreshCw, ChevronDown, Wheat, Pencil } from 'lucide-react';
import { useStore } from '../store/useStore';
import { dataApiCall } from '../lib/dataApi';
import { traerFotos } from '../lib/fotosProductos';
import ProductModal from '../components/ProductModal';
import {
    calcularReceta, costoNetoParaFicha, costoUnidadConImpuestos, medidaInsumo,
    plataFina, textoCantidad, nombreRinde, nombreRindeUno,
} from '../lib/produccion';
import { margenDesdePrecio, utilidadPorUnidad } from '../lib/impuestosProducto';
import { formatCurrency } from '../utils/formatCurrency';

// Diferencia a partir de la cual la ficha se considera desactualizada: un peso
// Y un 1%. Con menos es redondeo, no un insumo que subió.
const esDistinto = (a, b) => Math.abs(a - b) >= 1 && Math.abs(a - b) >= Math.abs(b) * 0.01;

function armar(producciones, productos) {
    const porId = {};
    for (const p of productos || []) porId[Number(p.id)] = p;
    const prodPorId = {};
    for (const pp of producciones || []) prodPorId[Number(pp.product_id)] = pp;
    const insumos = {};
    for (const p of productos || []) insumos[Number(p.id)] = { producto: p, produccion: prodPorId[Number(p.id)] || null };

    const fabricados = (producciones || []).filter((pp) => pp.recipe && porId[pp.product_id]).map((pp) => {
        const producto = porId[pp.product_id];
        const calculo = calcularReceta(pp.recipe, insumos);
        const costoFicha = costoUnidadConImpuestos(producto);
        const precio = Number(producto.price) || 0;
        const neto = calculo.porUnidad ? costoNetoParaFicha(calculo.porUnidad, producto.tax_rate, producto.extra_taxes) : 0;
        const margen = neto > 0 && precio > 0 ? margenDesdePrecio(precio, neto, producto.tax_rate, producto.extra_taxes) : null;
        const ganancia = neto > 0 && precio > 0 ? utilidadPorUnidad(precio, neto, producto.tax_rate, producto.extra_taxes) : null;
        let estado = 'al_dia';
        if (!calculo.porUnidad || calculo.errores > 0) estado = 'incompleta';
        else if (esDistinto(calculo.porUnidad, costoFicha)) estado = calculo.porUnidad > costoFicha ? 'subio' : 'bajo';
        return { producto, produccion: pp, calculo, costoFicha, precio, margen, ganancia, estado };
    }).sort((a, b) => a.producto.name.localeCompare(b.producto.name));

    const usos = {};
    for (const f of fabricados) for (const l of f.produccion.recipe.items || []) usos[l.product_id] = (usos[l.product_id] || 0) + 1;
    const listaInsumos = Object.values(insumos)
        .filter((x) => x.produccion?.is_input || usos[x.producto.id])
        .map((x) => ({ ...x, usos: usos[x.producto.id] || 0 }))
        .sort((a, b) => a.producto.name.localeCompare(b.producto.name));

    return { fabricados, insumos: listaInsumos };
}

const ESTADOS = {
    al_dia: { texto: 'Costo al día', clase: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', Icono: CheckCircle2 },
    subio: { texto: 'La receta subió', clase: 'text-red-300 bg-red-500/10 border-red-500/30', Icono: AlertTriangle },
    bajo: { texto: 'La receta bajó', clase: 'text-amber-300 bg-amber-500/10 border-amber-500/30', Icono: AlertTriangle },
    incompleta: { texto: 'Receta incompleta', clase: 'text-amber-300 bg-amber-500/10 border-amber-500/30', Icono: AlertTriangle },
};

const Dato = ({ etiqueta, children, prueba, fuerte }) => (
    <div className="min-w-0">
        <p className="text-[11px] text-[var(--color-text-muted)]">{etiqueta}</p>
        <p data-prueba={prueba} className={`font-mono truncate ${fuerte ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-text-soft)]'}`}>{children}</p>
    </div>
);

const TarjetaFabricado = ({ f, moneda, onAbrir }) => {
    const e = ESTADOS[f.estado];
    const uno = nombreRindeUno(f.producto.unit);
    return (
        <div data-prueba="fabricado" className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-bold text-[var(--color-text)] truncate">{f.producto.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                        {f.calculo.rinde ? `Una tanda rinde ${textoCantidad(f.calculo.rinde, '')} ${nombreRinde(f.producto.unit)}` : 'Sin rendimiento'}
                        {' · '}{(f.produccion.recipe.items || []).length === 1 ? '1 insumo' : `${(f.produccion.recipe.items || []).length} insumos`}
                    </p>
                </div>
                <span data-prueba="estado" className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold ${e.clase}`}>
                    <e.Icono size={12} /> {e.texto}
                </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Dato etiqueta={`Receta, por ${uno}`} prueba="costo-receta" fuerte>
                    {f.calculo.porUnidad ? plataFina(f.calculo.porUnidad, moneda) : '—'}
                </Dato>
                <Dato etiqueta="Ficha (costo + IVA)" prueba="costo-ficha">{plataFina(f.costoFicha, moneda)}</Dato>
                <Dato etiqueta="Precio de venta" prueba="precio">{f.precio > 0 ? formatCurrency(f.precio, moneda) : '—'}</Dato>
                <div className="min-w-0">
                    <p className="text-[11px] text-[var(--color-text-muted)]">Utilidad real</p>
                    <p data-prueba="margen" className={`font-mono font-bold truncate ${f.margen == null ? 'text-[var(--color-text-muted)]' : f.margen < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {f.margen == null ? '—' : `${f.margen.toFixed(1).replace('.', ',')}%`}
                    </p>
                    {f.ganancia != null && (
                        <p className="text-[11px] text-[var(--color-text-muted)] truncate">{plataFina(f.ganancia, moneda)} por {uno}</p>
                    )}
                </div>
            </div>

            {f.estado === 'subio' && (
                <p className="text-xs text-red-300">
                    Según la receta cuesta {plataFina(f.calculo.porUnidad, moneda)} y la ficha dice {plataFina(f.costoFicha, moneda)}: estás ganando menos de lo que creés.
                </p>
            )}
            {f.estado === 'bajo' && (
                <p className="text-xs text-amber-300">
                    Según la receta cuesta {plataFina(f.calculo.porUnidad, moneda)} y la ficha dice {plataFina(f.costoFicha, moneda)}.
                </p>
            )}
            {f.estado === 'incompleta' && (
                <p className="text-xs text-amber-300">
                    {!f.calculo.rinde ? 'Falta decir cuánto rinde la tanda.' : 'Hay insumos que no se están sumando (borrados o con una unidad que no corresponde).'}
                </p>
            )}

            <button type="button" onClick={() => onAbrir(f.producto)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-[var(--glass-border)] text-sm font-bold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] inline-flex items-center justify-center gap-2">
                <Pencil size={14} /> {f.estado === 'subio' || f.estado === 'bajo' ? 'Abrir ficha y actualizar el costo' : 'Abrir ficha'}
            </button>
        </div>
    );
};

const Recetas = () => {
    const { activeCompanyId, currentCurrency, updateProduct } = useStore();
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [cargando, setCargando] = useState(true);
    const [filtro, setFiltro] = useState('');
    const [verInsumos, setVerInsumos] = useState(false);
    const [editando, setEditando] = useState(null);

    const cargar = useCallback(async () => {
        if (!activeCompanyId) return;
        setCargando(true);
        setError('');
        const r = await dataApiCall('production.overview', { companyId: activeCompanyId });
        setCargando(false);
        if (!r?.success) { setError(r?.error || 'No se pudo cargar'); return; }
        setDatos(armar(r.producciones, r.productos));
    }, [activeCompanyId]);

    useEffect(() => { cargar(); }, [cargar]);

    const fabricados = useMemo(() => {
        const t = filtro.trim().toLowerCase();
        const lista = datos?.fabricados || [];
        return t ? lista.filter((f) => f.producto.name.toLowerCase().includes(t)) : lista;
    }, [datos, filtro]);

    const cuenta = useMemo(() => {
        const l = datos?.fabricados || [];
        return {
            total: l.length,
            desactualizados: l.filter((f) => f.estado === 'subio' || f.estado === 'bajo').length,
            incompletas: l.filter((f) => f.estado === 'incompleta').length,
        };
    }, [datos]);

    // La ficha se abre acá mismo, como en Inventario. La foto llega aparte: si
    // se abriera sin ella, la ficha mostraría el recuadro vacío.
    const abrir = async (producto) => {
        let p = producto;
        if (Number(producto.has_image) === 1 && !producto.image) {
            let foto = null;
            await traerFotos(activeCompanyId, [producto.id], (mapa) => { if (mapa[producto.id]) foto = mapa[producto.id]; });
            if (foto) p = { ...producto, image: foto };
        }
        setEditando(p);
        window.scrollTo?.(0, 0);
    };

    const guardar = async (data) => {
        const r = await updateProduct(editando.id, data);
        if (!r?.success) { alert('Error al guardar el producto: ' + (r?.message || r?.error || 'Error desconocido')); return; }
        if (r.avisoProduccion) alert(r.avisoProduccion);
        setEditando(null);
        cargar();
    };

    if (editando) {
        return (
            <div className="space-y-6">
                <ProductModal isOpen isInline productToEdit={editando} onClose={() => setEditando(null)} onSave={guardar} />
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl lg:text-3xl font-bold text-[var(--color-text)] neon-text flex items-center gap-2">
                        <Factory className="text-[var(--color-primary)]" /> Producción
                    </h1>
                    <p className="text-xs lg:text-base text-[var(--color-text-muted)]">
                        Lo que fabricás: cuánto te cuesta según su receta y cuánto le ganás.
                    </p>
                </div>
                <button type="button" onClick={cargar} disabled={cargando}
                    className="self-start sm:self-auto px-3 py-2 rounded-lg border border-[var(--glass-border)] text-sm text-[var(--color-text)] inline-flex items-center gap-2 hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
                    <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar
                </button>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                    No se pudo cargar Producción: {error}
                </div>
            )}

            {cargando && !datos && <p className="text-sm text-[var(--color-text-muted)] animate-pulse">Cargando…</p>}

            {datos && cuenta.total === 0 && (
                <div data-prueba="vacio" className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 space-y-3 text-sm text-[var(--color-text-soft)]">
                    <p className="font-bold text-[var(--color-text)]">Todavía no hay recetas.</p>
                    <ol className="list-decimal pl-5 space-y-1.5">
                        <li>En <b>Inventario → Productos</b>, abrí la ficha de un insumo (la harina) y activá <b>Se usa como insumo</b>: decile cuánto trae el saco.</li>
                        <li>Abrí la ficha de lo que fabricás (el pan de completo), activá <b>Lo fabrico yo</b> y cargá sus insumos y cuánto rinde la tanda.</li>
                        <li>Apretá <b>Usar como costo</b>, poné la utilidad y guardá. Acá vas a ver su costo y su margen.</li>
                    </ol>
                </div>
            )}

            {datos && cuenta.total > 0 && (
                <>
                    <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2.5 py-1 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-soft)]">
                            {cuenta.total} {cuenta.total === 1 ? 'producto fabricado' : 'productos fabricados'}
                        </span>
                        {cuenta.desactualizados > 0 && (
                            <span data-prueba="cuenta-desactualizados" className="px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 font-bold">
                                {cuenta.desactualizados} con el costo desactualizado
                            </span>
                        )}
                        {cuenta.incompletas > 0 && (
                            <span className="px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                {cuenta.incompletas} {cuenta.incompletas === 1 ? 'receta incompleta' : 'recetas incompletas'}
                            </span>
                        )}
                    </div>

                    {cuenta.total > 4 && (
                        <div className="relative">
                            <Search size={16} className="absolute z-10 left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                            <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)}
                                placeholder="Buscar producto fabricado…" className="glass-input w-full !pl-9" />
                        </div>
                    )}

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {fabricados.map((f) => (
                            <TarjetaFabricado key={f.producto.id} f={f} moneda={currentCurrency} onAbrir={abrir} />
                        ))}
                    </div>
                </>
            )}

            {datos && datos.insumos.length > 0 && (
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                    <button type="button" onClick={() => setVerInsumos((v) => !v)} data-prueba="ver-insumos"
                        className="w-full flex items-center justify-between gap-3 p-4 text-left min-h-[48px]">
                        <span className="font-bold text-[var(--color-text)] flex items-center gap-2">
                            <Wheat size={16} className="text-[var(--color-primary)]" /> Insumos ({datos.insumos.length})
                        </span>
                        <ChevronDown size={18} className={`text-[var(--color-text-muted)] transition-transform ${verInsumos ? 'rotate-180' : ''}`} />
                    </button>
                    {verInsumos && (
                        <div className="border-t border-[var(--glass-border)] divide-y divide-[var(--glass-border)]" data-prueba="lista-insumos">
                            {datos.insumos.map(({ producto, produccion, usos }) => {
                                const m = medidaInsumo(producto, produccion);
                                const costo = costoUnidadConImpuestos(producto);
                                const util = m.porUnidad * (1 - m.merma / 100);
                                const porBase = util > 0 ? costo / util : 0;
                                const grande = m.familia === 'peso' ? 'kg' : m.familia === 'volumen' ? 'L' : 'und';
                                const porGrande = grande === 'und' ? porBase : porBase * 1000;
                                return (
                                    <div key={producto.id} data-prueba="insumo" className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                                        <div className="min-w-0 sm:flex-1">
                                            <p className="text-sm font-bold text-[var(--color-text)] truncate">{producto.name}</p>
                                            <p className="text-[11px] text-[var(--color-text-muted)]">
                                                {m.porSuUnidad ? `Por ${m.unidad}` : m.sinContenido ? 'Se cuenta por unidad' : `Trae ${textoCantidad(m.contenido, m.unidad)}`}
                                                {m.merma > 0 ? ` · ${m.merma}% merma` : ''}
                                                {' · '}{usos === 0 ? 'no está en ninguna receta' : usos === 1 ? 'en 1 receta' : `en ${usos} recetas`}
                                            </p>
                                        </div>
                                        <div className="flex items-baseline gap-4 text-sm font-mono">
                                            <span className="text-[var(--color-text-muted)]">{formatCurrency(costo, currentCurrency)} c/u</span>
                                            <span className="font-bold text-[var(--color-text)]">{costo > 0 ? `${plataFina(porGrande, currentCurrency)} el ${grande}` : 'sin costo'}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Recetas;
