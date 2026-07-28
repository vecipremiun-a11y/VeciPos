import React, { useState, useEffect, useMemo } from 'react';
import { Search, Printer, Tag, Tags, Loader2, X, AlertTriangle, Plus, Minus, Trash2, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import { isThermalAvailable, getSavedPrinter } from '../lib/thermalPrint';
import LabelPreview from '../components/LabelPreview';
import {
    LABEL_TEMPLATES, DEFAULT_TEMPLATE, LABEL_STYLES, DEFAULT_STYLE, pickSymbology,
    renderBarcodeDataUrl, printThermalLabels, printWebLabels, todayText,
} from '../lib/thermalLabel';

// Datos de muestra para las miniaturas del selector de diseño.
const SAMPLE = { name: 'ARROZ 1 KG', priceText: '$1.250', oldPriceText: '$1.590' };

// Inventario → Etiquetas. Elige un diseño, arma un LOTE de productos (nombre +
// código de barra del SKU + precio) y lo imprime de una.
export default function LabelPrinting() {
    const { searchProductsForDropdown, currentCurrency } = useStore();

    const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
    const [styleId, setStyleId] = useState(() => {
        try { return localStorage.getItem('posveci_label_style') || DEFAULT_STYLE; } catch { return DEFAULT_STYLE; }
    });
    const changeStyle = (v) => { setStyleId(v); try { localStorage.setItem('posveci_label_style', v); } catch { /* noop */ } };
    const [lang, setLang] = useState(() => {
        try { return localStorage.getItem('posveci_label_lang') || 'tspl'; } catch { return 'tspl'; }
    });
    const changeLang = (v) => { setLang(v); try { localStorage.setItem('posveci_label_lang', v); } catch { /* noop */ } };

    const [term, setTerm] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [items, setItems] = useState([]);
    const [previewId, setPreviewId] = useState(null);
    const [printing, setPrinting] = useState(false);
    const [showStyles, setShowStyles] = useState(false);

    const native = isThermalAvailable();
    const tpl = LABEL_TEMPLATES[template];
    // Los diseños "continuos" solo aplican al rollo sin troquel, y viceversa.
    const availableStyles = Object.values(LABEL_STYLES)
        .filter(s => tpl?.continuous ? s.continuousOnly : !s.continuousOnly);
    const style = availableStyles.find(s => s.id === styleId) || availableStyles[0];

    // Al cambiar de formato, saltar a un diseño válido para ese formato.
    useEffect(() => {
        if (style && style.id !== styleId) changeStyle(style.id);
    }, [template]); // eslint-disable-line react-hooks/exhaustive-deps

    // Código de muestra para las miniaturas (una sola vez).
    const sampleBarcode = useMemo(() => renderBarcodeDataUrl('200000000001', 'ean13'), []);

    // Búsqueda con pequeño debounce.
    useEffect(() => {
        if (!term || term.trim().length < 2) { setResults([]); return; }
        let active = true;
        setSearching(true);
        const t = setTimeout(async () => {
            const r = await searchProductsForDropdown(term.trim());
            if (active) { setResults(r || []); setSearching(false); }
        }, 300);
        return () => { active = false; clearTimeout(t); };
    }, [term, searchProductsForDropdown]);

    const addProduct = (p) => {
        setItems(prev => {
            const existing = prev.find(x => x.id === p.id);
            if (existing) return prev.map(x => x.id === p.id ? { ...x, copies: x.copies + 1 } : x);
            const sku = p.sku || '';
            const onOffer = p.is_offer && p.offer_price;
            const unitPrice = onOffer ? p.offer_price : p.price;
            // Precio anterior (para el diseño con precio tachado): el precio normal
            // si está en oferta; si no, el precio original cuando es mayor.
            const oldPrice = onOffer ? p.price
                : (p.original_price && Number(p.original_price) > Number(p.price) ? p.original_price : null);
            return [...prev, {
                id: p.id, name: p.name, sku,
                priceText: formatCurrency(unitPrice, currentCurrency),
                oldPriceText: oldPrice ? formatCurrency(oldPrice, currentCurrency) : null,
                copies: 1,
                barcodeUrl: sku ? renderBarcodeDataUrl(sku, pickSymbology(sku)) : null,
                noSku: !sku,
            }];
        });
        setPreviewId(p.id);
        setTerm(''); setResults([]);
    };

    const changeCopies = (id, n) => setItems(prev => prev.map(x => x.id === id ? { ...x, copies: Math.max(1, n) } : x));
    const removeItem = (id) => setItems(prev => prev.filter(x => x.id !== id));

    // Si el diseño NO lleva código de barras, los productos sin SKU también sirven.
    const usable = items.filter(x => style.needsBarcode ? !x.noSku : true);
    // La fecha se estampa en el momento de imprimir (diseño con fecha).
    const printable = usable.map(x => ({
        name: x.name, code: x.sku, symbology: pickSymbology(x.sku || ''),
        priceText: x.priceText, oldPriceText: x.oldPriceText, dateText: todayText(),
        copies: x.copies, barcodeDataUrl: x.barcodeUrl,
    }));
    const totalLabels = printable.reduce((s, x) => s + x.copies, 0);
    const blocked = style.needsBarcode ? items.filter(x => x.noSku).length : 0;
    const preview = items.find(x => x.id === previewId) || items[items.length - 1] || null;

    const handlePrint = async () => {
        if (!printable.length) return;
        setPrinting(true);
        try {
            let r;
            if (native) {
                if (!getSavedPrinter()) { alert('Configura tu impresora en Configuración → General → Impresora térmica.'); return; }
                r = await printThermalLabels(printable, { template, lang, style: styleId });
            } else {
                r = printWebLabels(printable, { template, style: styleId });
            }
            if (!r?.ok) {
                if (r?.error === 'NO_PRINTER') alert('Configura tu impresora en Configuración → General → Impresora térmica.');
                else if (r?.error === 'POPUP_BLOCKED') alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.');
                else alert('No se pudo imprimir: ' + (r?.error || ''));
            }
        } finally {
            setPrinting(false);
        }
    };

    return (
        <div className="h-full flex flex-col gap-4 p-4 lg:p-6 overflow-y-auto">
            <div className="shrink-0">
                <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                    <Tags className="text-[var(--color-primary)]" /> Etiquetas
                </h1>
                <p className="text-[var(--color-text-muted)] text-xs lg:text-sm">
                    Elige un diseño, arma el lote y imprime. El código de barra usa el SKU del producto para escanearlo en el POS.
                </p>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
                {/* Panel izquierdo */}
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                    {/* Diseño */}
                    <div className="glass-card p-4">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Diseño de etiqueta</p>
                            <button onClick={() => setShowStyles(v => !v)} className="text-xs font-bold text-[var(--color-primary)]">
                                {showStyles ? 'Ocultar' : 'Cambiar diseño'}
                            </button>
                        </div>

                        {!showStyles ? (
                            <div className="flex items-center gap-3">
                                <div className="border border-[var(--glass-border)] rounded p-1 bg-white w-[45%] max-w-[170px] shrink-0">
                                    <LabelPreview styleId={styleId} responsive
                                        data={{ ...SAMPLE, barcodeUrl: sampleBarcode }} />
                                </div>
                                <p className="text-sm text-[var(--color-text)] font-bold min-w-0">{style.name}</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto">
                                {availableStyles.map(s => (
                                    <button key={s.id} onClick={() => { changeStyle(s.id); setShowStyles(false); }}
                                        className={`p-2 rounded-lg border-2 transition-all text-left ${styleId === s.id
                                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                                            : 'border-[var(--glass-border)] hover:border-[var(--color-primary)]/40'}`}>
                                        <div className="bg-white rounded p-1 w-full">
                                            <LabelPreview styleId={s.id} responsive
                                                data={{ ...SAMPLE, barcodeUrl: sampleBarcode }} />
                                        </div>
                                        <p className="text-[11px] mt-1.5 text-[var(--color-text)] leading-tight flex items-start gap-1">
                                            {styleId === s.id && <Check size={12} className="text-[var(--color-primary)] shrink-0 mt-0.5" />}
                                            {s.name}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Tamaño + tipo de impresora */}
                    <div className="glass-card p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Tamaño de etiqueta</p>
                        <div className="flex flex-wrap gap-2">
                            {Object.values(LABEL_TEMPLATES).map(t => (
                                <button key={t.id} onClick={() => setTemplate(t.id)}
                                    className={`px-3 py-2 rounded-lg text-sm font-bold border transition-all ${template === t.id
                                        ? 'bg-[var(--color-primary)] text-black border-[var(--color-primary)]'
                                        : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]'}`}>
                                    {t.name}
                                </button>
                            ))}
                        </div>

                        {native && tpl?.continuous && (
                            <p className="text-[11px] text-[var(--color-text-muted)] mt-3">
                                Rollo <strong>continuo</strong> (sin troquel): se imprime en modo recibo (ESC/POS)
                                avanzando el largo exacto de cada etiqueta.
                            </p>
                        )}
                        {native && !tpl?.continuous && (
                            <div className="mt-4">
                                <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Tipo de impresora</p>
                                <div className="flex gap-2">
                                    <button onClick={() => changeLang('tspl')}
                                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${lang === 'tspl'
                                            ? 'bg-[var(--color-primary)] text-black border-[var(--color-primary)]'
                                            : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]'}`}>
                                        Etiquetas (TSPL)
                                    </button>
                                    <button onClick={() => changeLang('escpos')}
                                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${lang === 'escpos'
                                            ? 'bg-[var(--color-primary)] text-black border-[var(--color-primary)]'
                                            : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)]'}`}>
                                        Recibo (ESC/POS)
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Buscador */}
                    <div className="glass-card p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Agregar producto</p>
                        <div className="relative">
                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                            <input type="text" value={term} onChange={e => setTerm(e.target.value)}
                                placeholder="Nombre o SKU…" className="glass-input w-full !pl-10 !pr-9" />
                            {term && (
                                <button onClick={() => setTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        {(searching || results.length > 0) && (
                            <div className="mt-2 border border-[var(--glass-border)] rounded-lg divide-y divide-[var(--glass-border)] max-h-56 overflow-y-auto">
                                {searching && (
                                    <div className="p-3 text-sm text-[var(--color-text-muted)] flex items-center gap-2">
                                        <Loader2 size={14} className="animate-spin" /> Buscando…
                                    </div>
                                )}
                                {results.map(p => (
                                    <button key={p.id} onClick={() => addProduct(p)}
                                        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-[var(--glass-bg)]">
                                        <div className="min-w-0">
                                            <p className="text-sm text-[var(--color-text)] truncate">{p.name}</p>
                                            <p className="text-[11px] text-[var(--color-text-muted)] font-mono">{p.sku ? `SKU: ${p.sku}` : 'Sin SKU'}</p>
                                        </div>
                                        <Plus size={16} className="text-[var(--color-primary)] shrink-0" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Lote */}
                    <div className="glass-card p-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                                Lote ({totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''})
                            </p>
                            {items.length > 0 && (
                                <button onClick={() => setItems([])} className="text-xs text-[var(--color-text-muted)] hover:text-red-400">Vaciar</button>
                            )}
                        </div>

                        {items.length === 0 ? (
                            <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">Busca productos y agrégalos al lote.</p>
                        ) : (
                            <div className="space-y-2">
                                {items.map(it => {
                                    const skip = style.needsBarcode && it.noSku;
                                    return (
                                        <div key={it.id} onClick={() => setPreviewId(it.id)}
                                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer ${previewId === it.id ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/5' : 'border-[var(--glass-border)]'}`}>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm text-[var(--color-text)] truncate">{it.name}</p>
                                                <p className="text-[11px] font-mono text-[var(--color-text-muted)]">
                                                    {skip ? <span className="text-amber-400">Sin SKU — este diseño lleva código</span> : `${it.sku ? 'SKU: ' + it.sku + ' · ' : ''}${it.priceText}`}
                                                </p>
                                            </div>
                                            {!skip && (
                                                <div className="flex items-center border border-[var(--glass-border)] rounded-lg overflow-hidden shrink-0" onClick={e => e.stopPropagation()}>
                                                    <button onClick={() => changeCopies(it.id, it.copies - 1)} className="px-2 py-1.5 hover:bg-[var(--glass-bg)] text-[var(--color-text)]"><Minus size={13} /></button>
                                                    <input type="number" min="1" value={it.copies}
                                                        onChange={e => changeCopies(it.id, parseInt(e.target.value, 10) || 1)}
                                                        className="w-10 text-center bg-transparent text-[var(--color-text)] text-sm outline-none" />
                                                    <button onClick={() => changeCopies(it.id, it.copies + 1)} className="px-2 py-1.5 hover:bg-[var(--glass-bg)] text-[var(--color-text)]"><Plus size={13} /></button>
                                                </div>
                                            )}
                                            <button onClick={e => { e.stopPropagation(); removeItem(it.id); }} className="p-1.5 text-[var(--color-text-muted)] hover:text-red-400 shrink-0"><Trash2 size={15} /></button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {blocked > 0 && (
                            <p className="text-xs text-amber-400 flex items-center gap-1 mt-3">
                                <AlertTriangle size={12} /> {blocked} sin SKU no se imprimirán con este diseño. Usa un diseño sin código o asígnales SKU.
                            </p>
                        )}
                        {style.needsOldPrice && usable.some(x => !x.oldPriceText) && (
                            <p className="text-xs text-amber-400 flex items-center gap-1 mt-3">
                                <AlertTriangle size={12} /> Algunos productos no están en oferta: saldrán sin el precio tachado.
                            </p>
                        )}

                        <button onClick={handlePrint} disabled={printing || totalLabels === 0}
                            className="btn-primary w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 mt-3">
                            <Printer size={18} />
                            {printing ? 'Imprimiendo…' : native ? `Imprimir ${totalLabels || ''} etiqueta${totalLabels !== 1 ? 's' : ''}` : 'Imprimir (navegador)'}
                        </button>
                    </div>
                </div>

                {/* Panel derecho: vista previa real */}
                <div className="lg:w-[340px] shrink-0">
                    <div className="glass-card p-4 lg:sticky lg:top-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                            Vista previa · {tpl?.name}
                        </p>
                        <div className="flex justify-center">
                            <div className={`shadow-lg rounded w-full max-w-[300px] ${preview ? '' : 'opacity-60'}`}>
                                <LabelPreview styleId={styleId} responsive
                                    data={preview
                                        ? { name: preview.name, priceText: preview.priceText, oldPriceText: preview.oldPriceText, barcodeUrl: preview.barcodeUrl }
                                        : { ...SAMPLE, barcodeUrl: sampleBarcode }} />
                            </div>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted)] text-center mt-2">
                            {preview ? style.name : 'Ejemplo — agrega un producto al lote'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
