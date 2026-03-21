import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { formatCurrency } from '../utils/formatCurrency';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    ClipboardCheck, Search, Package, BarChart3, AlertTriangle, CheckCircle2,
    TrendingDown, TrendingUp, X, Plus, ScanBarcode, ArrowLeft, Loader2,
    ChevronDown, History, Trash2, Edit3, XCircle, PackageCheck, Filter,
    Hash, Eye, Download, Share2
} from 'lucide-react';

// ─── Tiny beep via Web Audio API ───
const audioCtx = typeof window !== 'undefined' ? new (window.AudioContext || window.webkitAudioContext)() : null;
const playBeep = (freq = 880, duration = 0.12) => {
    if (!audioCtx) return;
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.value = 0.13;
        o.start(); o.stop(audioCtx.currentTime + duration);
    } catch (_) {}
};
const successBeep = () => playBeep(1100, 0.1);
const diffBeep = () => { playBeep(440, 0.08); setTimeout(() => playBeep(440, 0.08), 120); };
const vibrate = (pattern) => { try { navigator?.vibrate?.(pattern); } catch (_) {} };

// ─── Glass card component ───
const GlassCard = ({ children, className = '', onClick, gradient }) => (
    <div
        onClick={onClick}
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${gradient || 'from-white/[0.07] to-white/[0.02]'} backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)]' : ''} ${className}`}
    >
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10">{children}</div>
    </div>
);

// ─── Stat card ───
const StatCard = ({ icon: Icon, label, value, sub, color = 'blue' }) => {
    const colors = {
        blue: 'from-blue-500/20 to-blue-600/5 text-blue-400 shadow-blue-500/10',
        green: 'from-emerald-500/20 to-emerald-600/5 text-emerald-400 shadow-emerald-500/10',
        red: 'from-red-500/20 to-red-600/5 text-red-400 shadow-red-500/10',
        orange: 'from-orange-500/20 to-orange-600/5 text-orange-400 shadow-orange-500/10',
        purple: 'from-purple-500/20 to-purple-600/5 text-purple-400 shadow-purple-500/10',
    };
    const iconColors = { blue: 'text-blue-400', green: 'text-emerald-400', red: 'text-red-400', orange: 'text-orange-400', purple: 'text-purple-400' };
    return (
        <GlassCard gradient={colors[color]}>
            <div className="p-4 flex items-center gap-3">
                <div className={`p-2.5 rounded-xl bg-white/5 ${iconColors[color]}`}>
                    <Icon size={22} />
                </div>
                <div className="min-w-0">
                    <p className="text-lg font-bold text-white truncate">{value}</p>
                    <p className="text-xs text-zinc-400 truncate">{label}</p>
                    {sub && <p className={`text-xs ${iconColors[color]} truncate`}>{sub}</p>}
                </div>
            </div>
        </GlassCard>
    );
};

// ─── Progress bar ───
const ProgressBar = ({ current, total }) => {
    const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
    return (
        <div className="w-full">
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
                <span>{current} de {total} productos</span>
                <span>{Math.round(pct)}%</span>
            </div>
            <div className="h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 shadow-[0_0_12px_rgba(99,102,241,0.4)]"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════
const InventoryControl = () => {
    const {
        createInventoryControl, fetchActiveInventoryControl, fetchControlProducts,
        saveControlItem, removeControlItem, completeInventoryControl,
        cancelInventoryControl, fetchControlReport, fetchControlHistory,
        getProductByBarcode, categories: storeCategories, currentCurrency,
        activeCompanyId
    } = useStore();

    // ─ View state ─
    const [view, setView] = useState('loading'); // 'loading' | 'home' | 'counting' | 'report'
    const [control, setControl] = useState(null);

    // ─ Home state ─
    const [history, setHistory] = useState([]);
    const [formName, setFormName] = useState('');
    const [formType, setFormType] = useState('complete');
    const [formCategory, setFormCategory] = useState('');
    const [creating, setCreating] = useState(false);
    const [showForm, setShowForm] = useState(false);

    // ─ Counting state ─
    const [products, setProducts] = useState([]);
    const [productOffset, setProductOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    const [scannedProduct, setScannedProduct] = useState(null);
    const [countedStock, setCountedStock] = useState('');
    const [saving, setSaving] = useState(false);
    const [loadingProducts, setLoadingProducts] = useState(false);

    // ─ Report state ─
    const [report, setReport] = useState(null);
    const [reportFilter, setReportFilter] = useState('all');
    const [reportControl, setReportControl] = useState(null);

    // ─ Confirmation modals ─
    const [confirmAction, setConfirmAction] = useState(null); // { type: 'cancel' | 'complete', message }

    const searchInputRef = useRef(null);
    const countInputRef = useRef(null);
    const PAGE_SIZE = 50;
    const observer = useRef();

    const categories = useMemo(() => (storeCategories || []).filter(c => c.status === 'active'), [storeCategories]);

    // ─── Init: check for active control ───
    useEffect(() => {
        (async () => {
            const active = await fetchActiveInventoryControl();
            if (active) {
                setControl(active);
                setView('counting');
            } else {
                const hist = await fetchControlHistory(20, 0);
                setHistory(hist);
                setView('home');
            }
        })();
    }, [activeCompanyId]);

    // ─── Debounce search ───
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // ─── Load products when counting ───
    const loadProducts = useCallback(async (offset = 0, reset = false) => {
        if (!control) return;
        setLoadingProducts(true);
        const rows = await fetchControlProducts(control.id, {
            limit: PAGE_SIZE, offset, search: debouncedSearch,
            filter: activeFilter, type: control.type, category: control.category
        });
        if (reset) {
            setProducts(rows);
        } else {
            setProducts(prev => [...prev, ...rows]);
        }
        setHasMore(rows.length === PAGE_SIZE);
        setProductOffset(offset + rows.length);
        setLoadingProducts(false);
    }, [control, debouncedSearch, activeFilter]);

    useEffect(() => {
        if (view === 'counting' && control) {
            loadProducts(0, true);
        }
    }, [view, control, debouncedSearch, activeFilter]);

    // ─── Infinite scroll ───
    const lastRef = useCallback(node => {
        if (loadingProducts) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) loadProducts(productOffset);
        });
        if (node) observer.current.observe(node);
    }, [loadingProducts, hasMore, productOffset, loadProducts]);

    // ─── Barcode scanner ───
    const handleBarcodeScan = useCallback(async (barcode) => {
        if (view !== 'counting') return;
        const product = await getProductByBarcode(barcode);
        if (product) {
            // check if already counted
            const existing = products.find(p => p.id === product.id && p.item_id);
            setScannedProduct({ ...product, alreadyCounted: !!existing, previousCount: existing?.counted_stock });
            setCountedStock('');
            setTimeout(() => countInputRef.current?.focus(), 100);
        }
    }, [view, products, getProductByBarcode]);
    useBarcodeScanner(handleBarcodeScan);

    // ─── Search click on product ───
    const handleProductClick = (product) => {
        const existing = product.item_id ? product : null;
        setScannedProduct({
            id: product.id, name: product.name, sku: product.sku,
            stock: existing ? existing.system_stock : product.stock,
            cost: product.cost, image: product.image, category: product.category,
            alreadyCounted: !!existing,
            previousCount: existing?.counted_stock
        });
        setCountedStock(existing ? String(existing.counted_stock) : '');
        setTimeout(() => countInputRef.current?.focus(), 100);
    };

    // ─── Save count ───
    const handleSave = async () => {
        if (!scannedProduct || countedStock === '') return;
        setSaving(true);
        const result = await saveControlItem(control.id, scannedProduct.id, parseFloat(countedStock));
        setSaving(false);
        if (result.success) {
            const item = result.item;
            if (Math.abs(item.difference) <= 0.001) {
                successBeep();
                vibrate(80);
            } else {
                diffBeep();
                vibrate([80, 50, 80]);
            }
            // Update control counter
            if (!item.reEdit) {
                setControl(prev => ({ ...prev, counted_products: (prev.counted_products || 0) + 1 }));
            }
            // Update product list
            setProducts(prev => prev.map(p =>
                p.id === scannedProduct.id
                    ? { ...p, item_id: true, system_stock: item.system_stock, counted_stock: item.counted_stock, difference: item.difference, counted_at: new Date().toISOString() }
                    : p
            ));
            setScannedProduct(null);
            setCountedStock('');
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    };

    // ─── Remove item ───
    const handleRemoveItem = async (productId) => {
        const result = await removeControlItem(control.id, productId);
        if (result.success) {
            setControl(prev => ({ ...prev, counted_products: Math.max((prev.counted_products || 1) - 1, 0) }));
            setProducts(prev => prev.map(p =>
                p.id === productId
                    ? { ...p, item_id: null, system_stock: undefined, counted_stock: undefined, difference: undefined, counted_at: undefined }
                    : p
            ));
        }
    };

    // ─── Create control ───
    const handleCreate = async () => {
        if (!formName.trim()) return;
        setCreating(true);
        const result = await createInventoryControl({
            name: formName.trim(),
            type: formType,
            category: formType === 'category' ? formCategory : null
        });
        setCreating(false);
        if (result.success) {
            setControl(result.control);
            setView('counting');
            setShowForm(false);
        } else {
            alert(result.error);
        }
    };

    // ─── Complete ───
    const handleComplete = async () => {
        setConfirmAction(null);
        const result = await completeInventoryControl(control.id);
        if (result.success) {
            const rep = await fetchControlReport(control.id);
            setReport(rep);
            setReportControl(control);
            setView('report');
        }
    };

    // ─── Cancel ───
    const handleCancel = async () => {
        setConfirmAction(null);
        await cancelInventoryControl(control.id);
        setControl(null);
        setView('home');
        const hist = await fetchControlHistory(20, 0);
        setHistory(hist);
    };

    // ─── View past report ───
    const handleViewReport = async (ctrl) => {
        const rep = await fetchControlReport(ctrl.id);
        setReport(rep);
        setReportControl(ctrl);
        setView('report');
    };

    // ─── Back to home ───
    const handleBackHome = async () => {
        setReport(null);
        setReportControl(null);
        setControl(null);
        const hist = await fetchControlHistory(20, 0);
        setHistory(hist);
        setView('home');
    };

    const fmt = (v) => formatCurrency(v, currentCurrency);
    const fmtNum = (v) => (Math.round(v * 1000) / 1000).toString();
    const typeLabel = (t) => t === 'complete' ? 'Completo' : t === 'category' ? 'Por Categoría' : 'Libre';

    // ─── PDF Download ───
    const downloadReportPDF = (ctrl, rep, items, fmtC, fmtN) => {
        const doc = new jsPDF('landscape', 'mm', 'letter');
        const pageW = doc.internal.pageSize.getWidth();
        const { stats } = rep;
        const date = new Date().toLocaleDateString('es-CL');

        // Header
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`Control de Inventario — ${ctrl.name}`, 14, 15);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Tipo: ${typeLabel(ctrl.type)}${ctrl.category ? ' — ' + ctrl.category : ''}  |  Responsable: ${ctrl.user_name}  |  Fecha: ${date}`, 14, 22);

        // Stats line
        doc.setFontSize(8);
        doc.text(
            `Contados: ${stats.totalCounted}  |  Cuadrados: ${stats.matched}  |  Faltantes: ${stats.missing} (${fmtC(stats.missingValue)})  |  Sobrantes: ${stats.surplus} (${fmtC(stats.surplusValue)})  |  Descuadre total: ${fmtC(stats.totalDifferenceValue)}`,
            14, 28
        );

        // Table
        const rows = items.map(i => {
            const absDiff = Math.abs(i.difference);
            const isMatch = absDiff <= 0.001;
            const label = isMatch ? '✓ Cuadrado' : i.difference < 0 ? `▼ ${fmtN(i.difference)}` : `▲ +${fmtN(i.difference)}`;
            return [
                i.product_name,
                i.product_sku || '—',
                fmtN(i.system_stock),
                fmtN(i.counted_stock),
                label,
                fmtC(i.cost || 0),
                isMatch ? '—' : fmtC(absDiff * (i.cost || 0))
            ];
        });

        autoTable(doc, {
            startY: 33,
            head: [['Producto', 'SKU', 'Stock Sistema', 'Stock Real', 'Diferencia', 'Costo Unit.', 'Valor Desc.']],
            body: rows,
            styles: { fontSize: 7, cellPadding: 1.8 },
            headStyles: { fillColor: [30, 30, 50], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
            columnStyles: {
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 4) {
                    const val = data.cell.raw;
                    if (val.startsWith('✓')) data.cell.styles.textColor = [30, 160, 70];
                    else if (val.startsWith('▼')) data.cell.styles.textColor = [220, 50, 50];
                    else data.cell.styles.textColor = [200, 130, 0];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            margin: { left: 14, right: 14 },
        });

        // Footer pages
        const pages = doc.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.text(`Página ${i} de ${pages}`, pageW - 30, doc.internal.pageSize.getHeight() - 8);
        }

        doc.save(`control-inventario-${ctrl.name.replace(/\s+/g, '-').toLowerCase()}-${date}.pdf`);
    };

    // ─── WhatsApp Share ───
    const shareReportWhatsApp = (ctrl, rep, fmtC, fmtN) => {
        const { stats } = rep;
        const date = new Date().toLocaleDateString('es-CL');
        let text = `📋 *CONTROL DE INVENTARIO*\n`;
        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `📝 *${ctrl.name}*\n`;
        text += `📅 ${date}\n`;
        text += `👤 ${ctrl.user_name}\n`;
        text += `🏷️ Tipo: ${typeLabel(ctrl.type)}${ctrl.category ? ' — ' + ctrl.category : ''}\n\n`;

        text += `📊 *RESUMEN*\n`;
        text += `✅ Contados: ${stats.totalCounted}\n`;
        text += `✓ Cuadrados: ${stats.matched}\n`;
        text += `🔻 Faltantes: ${stats.missing} (${fmtC(stats.missingValue)})\n`;
        text += `🔺 Sobrantes: ${stats.surplus} (${fmtC(stats.surplusValue)})\n`;
        text += `💰 Descuadre total: ${fmtC(stats.totalDifferenceValue)}\n`;

        // Only show items with differences (keep message manageable)
        const diffItems = rep.items.filter(i => Math.abs(i.difference) > 0.001);
        if (diffItems.length > 0) {
            text += `\n⚠️ *PRODUCTOS CON DESCUADRE (${diffItems.length})*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n`;
            diffItems.slice(0, 30).forEach(i => {
                const arrow = i.difference < 0 ? '🔻' : '🔺';
                text += `${arrow} ${i.product_name}\n`;
                text += `   Sistema: ${fmtN(i.system_stock)} → Real: ${fmtN(i.counted_stock)} (${i.difference > 0 ? '+' : ''}${fmtN(i.difference)})\n`;
            });
            if (diffItems.length > 30) {
                text += `\n... y ${diffItems.length - 30} productos más\n`;
            }
        }

        text += `\n_Generado por Posveci_`;
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    };

    const filteredReportItems = useMemo(() => {
        if (!report) return [];
        return report.items.filter(i => {
            if (reportFilter === 'all') return true;
            if (reportFilter === 'diff') return Math.abs(i.difference) > 0.001;
            if (reportFilter === 'missing') return i.difference < -0.001;
            if (reportFilter === 'surplus') return i.difference > 0.001;
            if (reportFilter === 'matched') return Math.abs(i.difference) <= 0.001;
            return true;
        });
    }, [report, reportFilter]);

    // ═══════════════════════════════════════
    //  LOADING
    // ═══════════════════════════════════════
    if (view === 'loading') return (
        <div className="flex items-center justify-center h-96">
            <Loader2 className="animate-spin text-blue-400" size={32} />
        </div>
    );

    // ═══════════════════════════════════════
    //  VIEW A: HOME
    // ═══════════════════════════════════════
    if (view === 'home') return (
        <div className="max-w-4xl mx-auto p-4 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/10 border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
                    <ClipboardCheck size={26} className="text-blue-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-white">Control de Inventario</h1>
                    <p className="text-sm text-zinc-400">Conteo físico y ajuste de stock en tiempo real</p>
                </div>
            </div>

            {/* New Control Button / Form */}
            {!showForm ? (
                <GlassCard className="group" onClick={() => setShowForm(true)} gradient="from-blue-500/10 to-purple-500/5">
                    <div className="p-6 flex items-center justify-center gap-3 text-blue-400 group-hover:text-blue-300">
                        <div className="p-3 rounded-full bg-blue-500/10 border border-blue-500/20 group-hover:bg-blue-500/20 transition-all">
                            <Plus size={24} />
                        </div>
                        <span className="text-lg font-semibold">Nuevo Control de Inventario</span>
                    </div>
                </GlassCard>
            ) : (
                <GlassCard gradient="from-blue-500/10 to-purple-500/5">
                    <div className="p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Plus size={20} className="text-blue-400" />
                                Nuevo Control
                            </h2>
                            <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Name */}
                        <div>
                            <label className="text-sm text-zinc-400 mb-1 block">Nombre del control</label>
                            <input
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                placeholder="Ej: Conteo marzo, Revisión rápida..."
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                                autoFocus
                            />
                        </div>

                        {/* Type */}
                        <div>
                            <label className="text-sm text-zinc-400 mb-2 block">Tipo de control</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { key: 'complete', label: 'Completo', icon: Package, desc: 'Todos los productos' },
                                    { key: 'category', label: 'Categoría', icon: Filter, desc: 'Una categoría' },
                                    { key: 'free', label: 'Libre', icon: ScanBarcode, desc: 'Escaneo libre' },
                                ].map(opt => (
                                    <button
                                        key={opt.key}
                                        onClick={() => setFormType(opt.key)}
                                        className={`p-3 rounded-xl border text-center transition-all ${formType === opt.key
                                            ? 'bg-blue-500/15 border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                                            : 'bg-white/3 border-white/8 hover:bg-white/5'
                                        }`}
                                    >
                                        <opt.icon size={20} className={`mx-auto mb-1 ${formType === opt.key ? 'text-blue-400' : 'text-zinc-500'}`} />
                                        <p className={`text-sm font-medium ${formType === opt.key ? 'text-white' : 'text-zinc-400'}`}>{opt.label}</p>
                                        <p className="text-[10px] text-zinc-500 mt-0.5">{opt.desc}</p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Category selector */}
                        {formType === 'category' && (
                            <div>
                                <label className="text-sm text-zinc-400 mb-1 block">Categoría</label>
                                <select
                                    value={formCategory}
                                    onChange={e => setFormCategory(e.target.value)}
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500/50 transition-all"
                                >
                                    <option value="">Seleccionar categoría...</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.name} className="bg-zinc-900">{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Create button */}
                        <button
                            onClick={handleCreate}
                            disabled={creating || !formName.trim() || (formType === 'category' && !formCategory)}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold
                                       hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed
                                       shadow-[0_4px_20px_rgba(59,130,246,0.3)] hover:shadow-[0_6px_25px_rgba(59,130,246,0.4)]
                                       transition-all active:scale-[0.98]"
                        >
                            {creating ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Iniciar Control'}
                        </button>
                    </div>
                </GlassCard>
            )}

            {/* History */}
            {history.length > 0 && (
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-zinc-400 flex items-center gap-2">
                        <History size={16} /> Historial de controles
                    </h3>
                    {history.map(h => (
                        <GlassCard key={h.id} onClick={() => handleViewReport(h)}>
                            <div className="p-4 flex items-center justify-between">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium text-white truncate">{h.name}</p>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${h.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                            {h.status === 'completed' ? 'Completado' : 'Cancelado'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
                                        <span>{typeLabel(h.type)}</span>
                                        <span>•</span>
                                        <span>{h.user_name}</span>
                                        <span>•</span>
                                        <span>{new Date(h.completed_at || h.started_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-semibold text-white">{h.counted_products}</p>
                                    <p className="text-[10px] text-zinc-500">contados</p>
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </div>
            )}
        </div>
    );

    // ═══════════════════════════════════════
    //  VIEW B: COUNTING
    // ═══════════════════════════════════════
    if (view === 'counting' && control) return (
        <div className="max-w-4xl mx-auto p-4 space-y-4">
            {/* Header */}
            <GlassCard gradient="from-blue-500/10 to-indigo-500/5">
                <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-xl bg-blue-500/15 border border-blue-500/25">
                                <ClipboardCheck size={20} className="text-blue-400" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="font-bold text-white truncate">{control.name}</h1>
                                <p className="text-xs text-zinc-500">
                                    {typeLabel(control.type)}{control.category ? ` — ${control.category}` : ''} • {control.user_name}
                                </p>
                            </div>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-1 bg-blue-500/10 px-3 py-1.5 rounded-full border border-blue-500/20">
                            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <span className="text-xs text-blue-400 font-medium">En progreso</span>
                        </div>
                    </div>

                    {/* Stats mini-row */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="py-2 px-3 bg-white/5 rounded-xl">
                            <p className="text-lg font-bold text-emerald-400">{control.counted_products || 0}</p>
                            <p className="text-[10px] text-zinc-500">Contados</p>
                        </div>
                        <div className="py-2 px-3 bg-white/5 rounded-xl">
                            <p className="text-lg font-bold text-amber-400">{control.type !== 'free' ? Math.max((control.total_products || 0) - (control.counted_products || 0), 0) : '∞'}</p>
                            <p className="text-[10px] text-zinc-500">Pendientes</p>
                        </div>
                        <div className="py-2 px-3 bg-white/5 rounded-xl">
                            <p className="text-lg font-bold text-white">{control.total_products || (control.type === 'free' ? '—' : 0)}</p>
                            <p className="text-[10px] text-zinc-500">Total</p>
                        </div>
                    </div>

                    {/* Progress bar for complete/category */}
                    {control.type !== 'free' && control.total_products > 0 && (
                        <ProgressBar current={control.counted_products || 0} total={control.total_products} />
                    )}
                </div>
            </GlassCard>

            {/* Scan input */}
            <div className="relative">
                <ScanBarcode size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Escanear código de barras o buscar producto..."
                    className="w-full pl-11 pr-10 py-3.5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-zinc-500
                               focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:bg-white/[0.07]
                               shadow-[0_4px_20px_rgba(0,0,0,0.2)] transition-all text-sm"
                    autoFocus
                />
                {searchTerm && (
                    <button onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 text-zinc-500">
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Scanned product card */}
            {scannedProduct && (
                <GlassCard gradient={scannedProduct.alreadyCounted ? 'from-amber-500/10 to-orange-500/5' : 'from-emerald-500/10 to-blue-500/5'}>
                    <div className="p-5 space-y-4">
                        {scannedProduct.alreadyCounted && (
                            <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/15 rounded-lg px-3 py-2">
                                <Edit3 size={14} />
                                <span>Este producto ya fue contado (stock: {fmtNum(scannedProduct.previousCount)}) — editando</span>
                            </div>
                        )}
                        <div className="flex items-start gap-4">
                            {scannedProduct.image ? (
                                <img src={scannedProduct.image} alt="" className="w-14 h-14 rounded-xl object-cover border border-white/10" />
                            ) : (
                                <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                    <Package size={24} className="text-zinc-600" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-white truncate">{scannedProduct.name}</p>
                                {scannedProduct.sku && (
                                    <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                                        <Hash size={12} /> {scannedProduct.sku}
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-2 mt-2">
                                    <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/15">
                                        Stock sistema: <strong>{fmtNum(scannedProduct.stock)}</strong>
                                    </span>
                                    {scannedProduct.cost > 0 && (
                                        <span className="text-xs px-2.5 py-1 rounded-lg bg-white/5 text-zinc-400 border border-white/8">
                                            Costo: {fmt(scannedProduct.cost)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => { setScannedProduct(null); setCountedStock(''); searchInputRef.current?.focus(); }} className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Count input */}
                        <div className="space-y-2">
                            <label className="text-sm text-zinc-400 font-medium">Stock real</label>
                            <input
                                ref={countInputRef}
                                type="number"
                                value={countedStock}
                                onChange={e => setCountedStock(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                                placeholder="Ingresa el stock real..."
                                className="w-full px-4 py-4 bg-white/5 border-2 border-white/10 rounded-xl text-white text-2xl font-bold text-center
                                           focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 transition-all
                                           placeholder:text-zinc-600 placeholder:text-lg placeholder:font-normal"
                                step="any"
                                min="0"
                                autoFocus
                            />
                            {/* Live difference */}
                            {countedStock !== '' && (
                                <div className="flex items-center justify-center gap-2 text-sm">
                                    {(() => {
                                        const diff = Math.round((parseFloat(countedStock) - scannedProduct.stock) * 1000) / 1000;
                                        if (Math.abs(diff) <= 0.001) return <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={16} /> Cuadrado</span>;
                                        if (diff < 0) return <span className="text-red-400 flex items-center gap-1"><TrendingDown size={16} /> Faltante: {fmtNum(Math.abs(diff))}</span>;
                                        return <span className="text-orange-400 flex items-center gap-1"><TrendingUp size={16} /> Sobrante: +{fmtNum(diff)}</span>;
                                    })()}
                                </div>
                            )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                            <button
                                onClick={handleSave}
                                disabled={saving || countedStock === ''}
                                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold
                                           hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed
                                           shadow-[0_4px_20px_rgba(59,130,246,0.3)] transition-all active:scale-[0.98]"
                            >
                                {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : 'Guardar'}
                            </button>
                            <button
                                onClick={() => { setScannedProduct(null); setCountedStock(''); searchInputRef.current?.focus(); }}
                                className="px-5 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 transition-all"
                            >
                                Saltar
                            </button>
                        </div>
                    </div>
                </GlassCard>
            )}

            {/* Filter tabs (for complete/category) */}
            {control.type !== 'free' && (
                <div className="flex gap-1.5 bg-white/3 p-1 rounded-xl border border-white/5">
                    {[
                        { key: 'all', label: 'Todos' },
                        { key: 'pending', label: 'Pendientes' },
                        { key: 'counted', label: 'Contados' },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setActiveFilter(f.key)}
                            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${activeFilter === f.key
                                ? 'bg-white/10 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Product list */}
            <div className="space-y-1.5">
                {products.map((p, idx) => {
                    const isCounted = !!p.item_id;
                    const isLast = idx === products.length - 1;
                    return (
                        <div
                            key={p.id}
                            ref={isLast ? lastRef : null}
                            onClick={() => !isCounted && handleProductClick(p)}
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isCounted
                                ? 'bg-emerald-500/5 border-emerald-500/10'
                                : 'bg-white/[0.02] border-white/5 hover:bg-white/5 cursor-pointer'
                            }`}
                        >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isCounted ? 'bg-emerald-500/15' : 'bg-white/5'}`}>
                                {isCounted ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Package size={16} className="text-zinc-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${isCounted ? 'text-emerald-300' : 'text-white'}`}>{p.name}</p>
                                <p className="text-[10px] text-zinc-500 truncate">{p.sku || 'Sin código'}{p.category ? ` • ${p.category}` : ''}</p>
                            </div>
                            {isCounted ? (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <div className="text-right">
                                        <p className="text-xs text-zinc-400">{fmtNum(p.system_stock)} → <span className="text-white font-semibold">{fmtNum(p.counted_stock)}</span></p>
                                        <p className={`text-[10px] font-medium ${Math.abs(p.difference) <= 0.001 ? 'text-emerald-400' : p.difference < 0 ? 'text-red-400' : 'text-orange-400'}`}>
                                            {Math.abs(p.difference) <= 0.001 ? '✓ Cuadrado' : p.difference < 0 ? `▼ ${fmtNum(Math.abs(p.difference))}` : `▲ +${fmtNum(p.difference)}`}
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <button onClick={(e) => { e.stopPropagation(); handleProductClick(p); }} className="p-1 rounded hover:bg-white/10 text-zinc-500" title="Editar"><Edit3 size={13} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleRemoveItem(p.id); }} className="p-1 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-400" title="Eliminar"><Trash2 size={13} /></button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-right flex-shrink-0">
                                    <p className="text-xs text-zinc-400">Stock: <span className="text-white">{fmtNum(p.stock)}</span></p>
                                </div>
                            )}
                        </div>
                    );
                })}
                {loadingProducts && (
                    <div className="flex justify-center py-4">
                        <Loader2 className="animate-spin text-blue-400" size={24} />
                    </div>
                )}
                {!loadingProducts && products.length === 0 && (
                    <div className="text-center py-10 text-zinc-500">
                        <Package size={40} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No se encontraron productos</p>
                    </div>
                )}
            </div>

            {/* Bottom action bar */}
            <div className="sticky bottom-0 pt-3 pb-2 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent">
                <div className="flex gap-2">
                    <button
                        onClick={() => setConfirmAction({ type: 'cancel', message: '¿Cancelar este control? Los ajustes de stock ya aplicados NO se revertirán.' })}
                        className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/15 text-red-400 font-medium hover:bg-red-500/15 transition-all"
                    >
                        Cancelar Control
                    </button>
                    <button
                        onClick={() => setConfirmAction({ type: 'complete', message: '¿Finalizar este control? Se generará el reporte de descuadre.' })}
                        disabled={!control.counted_products}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold
                                   hover:from-emerald-500 hover:to-teal-500 disabled:opacity-30 disabled:cursor-not-allowed
                                   shadow-[0_4px_20px_rgba(16,185,129,0.25)] transition-all active:scale-[0.98]"
                    >
                        Finalizar Control
                    </button>
                </div>
            </div>

            {/* Confirmation modal */}
            {confirmAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmAction(null)}>
                    <GlassCard className="max-w-sm w-full" gradient="from-white/[0.08] to-white/[0.03]" onClick={e => e.stopPropagation()}>
                        <div className="p-6 space-y-4 text-center">
                            <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${confirmAction.type === 'cancel' ? 'bg-red-500/15' : 'bg-emerald-500/15'}`}>
                                {confirmAction.type === 'cancel'
                                    ? <XCircle size={28} className="text-red-400" />
                                    : <PackageCheck size={28} className="text-emerald-400" />
                                }
                            </div>
                            <p className="text-white font-medium">{confirmAction.message}</p>
                            <div className="flex gap-2">
                                <button onClick={() => setConfirmAction(null)} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 transition-all">
                                    Volver
                                </button>
                                <button
                                    onClick={confirmAction.type === 'cancel' ? handleCancel : handleComplete}
                                    className={`flex-1 py-2.5 rounded-xl font-semibold transition-all active:scale-[0.98] ${confirmAction.type === 'cancel'
                                        ? 'bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30'
                                        : 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-[0_4px_15px_rgba(16,185,129,0.2)]'
                                    }`}
                                >
                                    {confirmAction.type === 'cancel' ? 'Sí, Cancelar' : 'Sí, Finalizar'}
                                </button>
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}
        </div>
    );

    // ═══════════════════════════════════════
    //  VIEW C: REPORT
    // ═══════════════════════════════════════
    if (view === 'report' && report) {
        const { stats } = report;
        return (
            <div className="max-w-4xl mx-auto p-4 space-y-5">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <button onClick={handleBackHome} className="p-2 rounded-xl hover:bg-white/5 text-zinc-400 transition-all">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-xl font-bold text-white truncate">Reporte — {reportControl?.name}</h1>
                        <p className="text-xs text-zinc-500">
                            {typeLabel(reportControl?.type)}{reportControl?.category ? ` — ${reportControl?.category}` : ''} • {reportControl?.user_name} • {new Date(reportControl?.completed_at || reportControl?.started_at).toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* Stats cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                    <StatCard icon={ClipboardCheck} label="Contados" value={stats.totalCounted} color="blue" />
                    <StatCard icon={CheckCircle2} label="Cuadrados" value={stats.matched} color="green" />
                    <StatCard icon={TrendingDown} label="Faltantes" value={stats.missing} sub={stats.missingValue > 0 ? `−${fmt(stats.missingValue)}` : null} color="red" />
                    <StatCard icon={TrendingUp} label="Sobrantes" value={stats.surplus} sub={stats.surplusValue > 0 ? `+${fmt(stats.surplusValue)}` : null} color="orange" />
                    <StatCard icon={BarChart3} label="Descuadre Total" value={fmt(stats.totalDifferenceValue)} color="purple" />
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1.5 bg-white/3 p-1 rounded-xl border border-white/5 overflow-x-auto">
                    {[
                        { key: 'all', label: 'Todos', count: stats.totalCounted },
                        { key: 'diff', label: 'Descuadrados', count: stats.withDifference },
                        { key: 'missing', label: 'Faltantes', count: stats.missing },
                        { key: 'surplus', label: 'Sobrantes', count: stats.surplus },
                        { key: 'matched', label: 'Cuadrados', count: stats.matched },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setReportFilter(f.key)}
                            className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${reportFilter === f.key
                                ? 'bg-white/10 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {f.label} <span className="opacity-60">({f.count})</span>
                        </button>
                    ))}
                </div>

                {/* Report table */}
                <GlassCard>
                    {/* Desktop header */}
                    <div className="hidden md:grid grid-cols-[1fr_80px_80px_80px_90px_90px] gap-2 px-4 py-3 text-xs text-zinc-500 font-medium border-b border-white/5">
                        <span>Producto</span>
                        <span className="text-right">Sistema</span>
                        <span className="text-right">Real</span>
                        <span className="text-right">Diferencia</span>
                        <span className="text-right">Costo</span>
                        <span className="text-right">Valor Desc.</span>
                    </div>
                    <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
                        {filteredReportItems.map(item => {
                            const absDiff = Math.abs(item.difference);
                            const isMatched = absDiff <= 0.001;
                            const isMissing = item.difference < -0.001;
                            return (
                                <div key={item.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                                    {/* Mobile */}
                                    <div className="md:hidden space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-white truncate">{item.product_name}</p>
                                                <p className="text-[10px] text-zinc-500">{item.product_sku || 'Sin código'}</p>
                                            </div>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${isMatched ? 'text-emerald-400 bg-emerald-500/10' : isMissing ? 'text-red-400 bg-red-500/10' : 'text-orange-400 bg-orange-500/10'}`}>
                                                {isMatched ? '✓' : isMissing ? `▼ ${fmtNum(absDiff)}` : `▲ +${fmtNum(absDiff)}`}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                                            <div><span className="text-zinc-500">Sistema</span><p className="text-zinc-300 font-medium">{fmtNum(item.system_stock)}</p></div>
                                            <div><span className="text-zinc-500">Real</span><p className="text-white font-bold">{fmtNum(item.counted_stock)}</p></div>
                                            <div><span className="text-zinc-500">Costo</span><p className="text-zinc-300">{fmt(item.cost)}</p></div>
                                            <div><span className="text-zinc-500">Valor</span><p className={isMatched ? 'text-zinc-500' : isMissing ? 'text-red-400 font-medium' : 'text-orange-400 font-medium'}>{isMatched ? '—' : fmt(absDiff * (item.cost || 0))}</p></div>
                                        </div>
                                    </div>
                                    {/* Desktop */}
                                    <div className="hidden md:grid grid-cols-[1fr_80px_80px_80px_90px_90px] gap-2 items-center">
                                        <div className="min-w-0">
                                            <p className="text-sm text-white truncate">{item.product_name}</p>
                                            <p className="text-[10px] text-zinc-500">{item.product_sku || 'Sin código'}</p>
                                        </div>
                                        <p className="text-sm text-zinc-400 text-right">{fmtNum(item.system_stock)}</p>
                                        <p className="text-sm text-white font-semibold text-right">{fmtNum(item.counted_stock)}</p>
                                        <p className={`text-sm font-bold text-right ${isMatched ? 'text-emerald-400' : isMissing ? 'text-red-400' : 'text-orange-400'}`}>
                                            {isMatched ? '✓' : isMissing ? fmtNum(item.difference) : `+${fmtNum(item.difference)}`}
                                        </p>
                                        <p className="text-sm text-zinc-400 text-right">{fmt(item.cost)}</p>
                                        <p className={`text-sm text-right font-medium ${isMatched ? 'text-zinc-600' : isMissing ? 'text-red-400' : 'text-orange-400'}`}>
                                            {isMatched ? '—' : fmt(absDiff * (item.cost || 0))}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredReportItems.length === 0 && (
                            <div className="text-center py-10 text-zinc-500 text-sm">Sin resultados para este filtro</div>
                        )}
                    </div>
                </GlassCard>

                {/* Action buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                        onClick={() => downloadReportPDF(reportControl, report, filteredReportItems, fmt, fmtNum)}
                        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-blue-600/80 to-blue-700/80 text-white font-medium
                                   hover:from-blue-500 hover:to-blue-600 shadow-[0_4px_20px_rgba(59,130,246,0.2)] transition-all active:scale-[0.98]"
                    >
                        <Download size={18} /> Descargar PDF
                    </button>
                    <button
                        onClick={() => shareReportWhatsApp(reportControl, report, fmt, fmtNum)}
                        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600/80 to-green-700/80 text-white font-medium
                                   hover:from-emerald-500 hover:to-green-600 shadow-[0_4px_20px_rgba(16,185,129,0.2)] transition-all active:scale-[0.98]"
                    >
                        <Share2 size={18} /> Enviar por WhatsApp
                    </button>
                    <button
                        onClick={handleBackHome}
                        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-400 font-medium hover:bg-white/10 transition-all"
                    >
                        <ArrowLeft size={18} /> Volver al Inicio
                    </button>
                </div>
            </div>
        );
    }

    return null;
};

export default InventoryControl;
