import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { Search, X, Plus, Package } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';
import { toast } from '../lib/toast';

// Agregar un producto a un pedido YA creado (se olvidó alguno al armarlo).
//
// Mismo comportamiento que "Realizar Pedido": costo, cantidad y total ligados
// entre sí, IVA elegible y precio de venta sugerido según el margen. El margen
// arranca en el que ese producto tiene hoy (calculado con su precio y su costo),
// no en un 30% fijo: si el producto se vende con 45%, eso es lo que hay que ver.

const d2 = (n) => Math.round(n * 100) / 100;
const TRIO = ['costo', 'cantidad', 'total'];

const AgregarProductoPedidoModal = ({ orderId, onClose, onAgregado }) => {
    const { searchProductsForDropdown, taxRates, addItemsToSupplierOrder, currentCurrency } = useStore();

    const [termino, setTermino] = useState('');
    const [resultados, setResultados] = useState([]);
    const [producto, setProducto] = useState(null);
    const [guardando, setGuardando] = useState(false);

    const [costo, setCosto] = useState('');       // neto
    const [cantidad, setCantidad] = useState('1');
    const [total, setTotal] = useState('');       // costo con IVA × cantidad
    const [tasa, setTasa] = useState(0);
    const [margen, setMargen] = useState('30');

    // Los dos últimos editados mandan; el tercero se calcula.
    const [fijados, setFijados] = useState(['costo', 'cantidad']);
    const calculado = TRIO.find(c => !fijados.includes(c));

    const costoBruto = d2((parseFloat(costo) || 0) * (1 + (Number(tasa) || 0) / 100));

    useEffect(() => {
        if (!termino.trim() || producto) { setResultados([]); return; }
        const t = setTimeout(async () => {
            setResultados(await searchProductsForDropdown(termino.trim()));
        }, 300);
        return () => clearTimeout(t);
    }, [termino, producto, searchProductsForDropdown]);

    const impuestos = useMemo(() => {
        const base = (taxRates || [])
            .filter(t => t && t.status !== 'inactive')
            .map(t => ({ key: String(t.id), name: t.name || 'Impuesto', rate: Number(t.rate) || 0 }));
        const actual = Number(tasa) || 0;
        if (!base.some(t => t.rate === actual)) {
            base.push({ key: `actual-${actual}`, name: actual === 0 ? 'Sin impuesto' : 'Del producto', rate: actual });
        }
        return base.sort((a, b) => a.rate - b.rate);
    }, [taxRates, tasa]);

    const elegir = (p) => {
        setProducto(p);
        setTermino(p.name);
        setResultados([]);
        const t = Number(p.tax_rate) || 0;
        const c = Number(p.cost) || 0;
        setTasa(t);
        setCosto(c ? String(c) : '');
        setCantidad('1');
        setTotal(c ? String(d2(c * (1 + t / 100))) : '');
        setFijados(['costo', 'cantidad']);
        // Margen actual del producto, no un 30% inventado.
        if (c > 0 && Number(p.price) > 0) {
            const neto = Number(p.price) / (1 + t / 100);
            setMargen((((neto - c) / c) * 100).toFixed(1));
        } else {
            setMargen('30');
        }
    };

    const recalcular = (campo, vals) => {
        const nuevos = [campo, ...fijados.filter(c => c !== campo)].slice(0, 2);
        setFijados(nuevos);
        const aCalcular = TRIO.find(c => !nuevos.includes(c));
        const iva = 1 + (Number(vals.tasa ?? tasa) || 0) / 100;
        const bruto = d2((parseFloat(vals.costo) || 0) * iva);
        const q = parseFloat(vals.cantidad) || 0;
        const t = parseFloat(vals.total) || 0;

        if (aCalcular === 'total') setTotal(bruto && q ? String(d2(bruto * q)) : '');
        else if (aCalcular === 'cantidad') setCantidad(t && bruto > 0 ? String(Math.round((t / bruto) * 1000) / 1000) : '');
        else setCosto(t && q > 0 ? String(d2((t / q) / iva)) : '');
    };

    const cambiarCosto = (v) => { setCosto(v); recalcular('costo', { costo: v, cantidad, total }); };
    const cambiarCantidad = (v) => { setCantidad(v); recalcular('cantidad', { costo, cantidad: v, total }); };
    const cambiarTotal = (v) => { setTotal(v); recalcular('total', { costo, cantidad, total: v }); };
    const cambiarTasa = (v) => {
        const r = Number(v) || 0;
        setTasa(r);
        // El impuesto cambia el costo bruto, así que arrastra al campo calculado.
        recalcular('costo', { costo, cantidad, total, tasa: r });
    };

    const sugerido = () => {
        const c = parseFloat(costo) || 0;
        const m = parseFloat(margen);
        if (!(c > 0)) return formatCurrency(0, currentCurrency);
        return formatCurrency(c * (1 + (isNaN(m) ? 0 : m) / 100) * (1 + (Number(tasa) || 0) / 100), currentCurrency);
    };

    const chip = (campo) => calculado === campo ? (
        <span className="ml-1 px-1 py-px rounded bg-[var(--color-primary)]/20 text-[var(--color-primary)] text-[9px] font-bold align-middle">
            se calcula
        </span>
    ) : null;

    const agregar = async () => {
        if (!producto) return toast('Elegí un producto primero.', 'error');
        const c = parseFloat(costo) || 0;
        const q = parseFloat(cantidad) || 0;
        if (c <= 0) return toast('Falta el costo del producto.', 'error');
        if (q <= 0) return toast('Indicá cuántas unidades vas a pedir.', 'error');

        setGuardando(true);
        const r = await addItemsToSupplierOrder(orderId, [{
            id: producto.id,
            name: producto.name,
            sku: producto.sku || '',
            cost: c,
            costWithTax: costoBruto,
            quantity: q,
            taxRate: Number(tasa) || 0,
        }]);
        setGuardando(false);

        if (!r?.success) return toast(r?.error || 'No se pudo agregar el producto.', 'error');
        toast(`${producto.name} agregado al pedido #${orderId}.`, 'success');
        onAgregado?.(r);
        onClose();
    };

    const unidad = producto?.unit && !/^und$/i.test(producto.unit) ? producto.unit.toLowerCase() : 'unidad';

    return createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between sticky top-0 bg-[var(--color-surface)] z-10">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--color-text)]">Agregar producto</h3>
                        <p className="text-xs text-[var(--color-text-muted)]">al pedido #{orderId}</p>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Buscador */}
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                        <input
                            value={termino}
                            onChange={(e) => { setTermino(e.target.value); if (producto) setProducto(null); }}
                            placeholder="Buscar producto por nombre o código..."
                            className="glass-input w-full pl-10"
                            autoFocus
                        />
                        {resultados.length > 0 && (
                            <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-xl shadow-2xl">
                                {resultados.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => elegir(p)}
                                        className="w-full text-left px-3 py-2 hover:bg-[var(--glass-bg)] border-b border-[var(--glass-border)] last:border-0"
                                    >
                                        <p className="text-sm font-medium text-[var(--color-text)]">{p.name}</p>
                                        <p className="text-[11px] text-[var(--color-text-muted)]">
                                            {p.sku} · stock {p.stock} · costo {formatCurrency(p.cost, currentCurrency)}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {!producto ? (
                        <div className="py-10 text-center text-[var(--color-text-muted)]">
                            <Package size={36} className="mx-auto mb-2 opacity-20" />
                            <p className="text-sm">Buscá y elegí un producto</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                <p className="font-bold text-[var(--color-primary)]">{producto.name}</p>
                                <p className="text-[11px] text-[var(--color-text-muted)]">{producto.sku}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                                        Costo por {unidad}{chip('costo')}
                                    </label>
                                    <input type="number" inputMode="decimal" value={costo}
                                        onChange={(e) => cambiarCosto(e.target.value)}
                                        className="glass-input w-full" placeholder="0" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Impuesto</label>
                                    <select value={tasa} onChange={(e) => cambiarTasa(e.target.value)} className="glass-input w-full">
                                        {impuestos.map(t => (
                                            <option key={t.key} value={t.rate} className="bg-gray-900">{t.name} ({t.rate}%)</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Utilidad (%)</label>
                                    <input type="number" inputMode="decimal" value={margen}
                                        onChange={(e) => setMargen(e.target.value)}
                                        className="glass-input w-full" placeholder="30" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Precio de venta sugerido</label>
                                    <div className="w-full bg-[var(--color-primary)]/15 border border-[var(--color-primary)] rounded-lg px-3 py-2 text-[var(--color-primary)] font-bold">
                                        {sugerido()}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                                        Cantidad ({unidad}){chip('cantidad')}
                                    </label>
                                    <input type="number" inputMode="decimal" value={cantidad}
                                        onChange={(e) => cambiarCantidad(e.target.value)}
                                        min="0" step="any" className="glass-input w-full font-bold" placeholder="1" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                                        Total del pedido{chip('total')}
                                    </label>
                                    <input type="number" inputMode="decimal" value={total}
                                        onChange={(e) => cambiarTotal(e.target.value)}
                                        min="0" step="any"
                                        className="glass-input w-full font-bold text-[var(--color-primary)]" placeholder="0" />
                                </div>
                            </div>

                            <p className="text-[10px] text-[var(--color-text-muted)]">
                                Costo con impuesto: <strong>{formatCurrency(costoBruto, currentCurrency)}</strong> ·
                                Editá dos de: costo, cantidad y total. El otro se calcula.
                            </p>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-[var(--glass-border)] flex gap-2 sticky bottom-0 bg-[var(--color-surface)]">
                    <button onClick={onClose}
                        className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] font-bold hover:bg-[var(--glass-bg)]">
                        Cancelar
                    </button>
                    <button
                        onClick={agregar}
                        disabled={!producto || guardando}
                        className={cn(
                            'flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 transition-all',
                            !producto || guardando
                                ? 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] cursor-not-allowed'
                                : 'bg-[var(--color-primary)] text-black hover:brightness-110'
                        )}
                    >
                        <Plus size={18} />
                        {guardando ? 'Agregando…' : 'Agregar al pedido'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default AgregarProductoPedidoModal;
