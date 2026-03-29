import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';
import { compressImage } from '../lib/imageCompression';
import { cn } from '../lib/utils';
import { Plus, Search, Edit2, Trash2, Power, Package, X, ImagePlus, Gift, AlertCircle, ChevronDown } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';

const GlassCard = ({ children, className = '' }) => (
    <div className={cn("bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] rounded-2xl", className)}>
        {children}
    </div>
);

const ProductCombos = () => {
    const {
        combos, fetchCombos, createCombo, updateCombo, deleteCombo, toggleComboActive,
        searchProductsForDropdown, taxRates, fetchTaxRates, currentCurrency
    } = useStore();
    const { can } = usePermissions();

    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingCombo, setEditingCombo] = useState(null);
    const [loading, setLoading] = useState(true);

    // Form state
    const [form, setForm] = useState({
        name: '', sku: '', price: '', description: '', tax_rate: '0',
        image: null, has_dates: false, start_date: '', end_date: '', items: []
    });
    const [productSearch, setProductSearch] = useState('');
    const [productResults, setProductResults] = useState([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            await Promise.all([fetchCombos(), fetchTaxRates()]);
            setLoading(false);
        };
        load();
    }, []);

    // Product search debounce
    useEffect(() => {
        if (!productSearch || productSearch.length < 2) {
            setProductResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            const results = await searchProductsForDropdown(productSearch);
            // Exclude products already in combo
            const existingIds = form.items.map(i => i.product_id);
            setProductResults(results.filter(p => !existingIds.includes(p.id)));
        }, 300);
        return () => clearTimeout(timer);
    }, [productSearch, form.items]);

    const totalCost = form.items.reduce((sum, it) => sum + (parseFloat(it.cost) || 0) * (parseFloat(it.quantity) || 1), 0);
    const price = parseFloat(form.price) || 0;
    const taxRate = parseFloat(form.tax_rate) || 0;
    const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;
    const margin = totalCost > 0 ? ((netPrice - totalCost) / totalCost * 100).toFixed(1) : '—';

    // Available stock calculation
    const availableStock = form.items.length > 0
        ? Math.min(...form.items.map(it => {
            const stock = parseFloat(it.current_stock) || 0;
            const qty = parseFloat(it.quantity) || 1;
            return Math.floor(stock / qty);
        }))
        : 0;

    const openNew = () => {
        setEditingCombo(null);
        setForm({ name: '', sku: '', price: '', description: '', tax_rate: '0', image: null, has_dates: false, start_date: '', end_date: '', items: [] });
        setProductSearch('');
        setProductResults([]);
        setShowModal(true);
    };

    const openEdit = (combo) => {
        setEditingCombo(combo);
        setForm({
            name: combo.name,
            sku: combo.sku || '',
            price: String(combo.price),
            description: combo.description || '',
            tax_rate: String(combo.tax_rate || 0),
            image: combo.image || null,
            has_dates: !!combo.has_dates,
            start_date: combo.start_date || '',
            end_date: combo.end_date || '',
            items: (combo.items || []).map(it => ({
                product_id: it.product_id,
                product_name: it.product_name,
                product_sku: it.product_sku || '',
                quantity: it.quantity,
                cost: it.cost,
                current_stock: it.current_stock || 0
            }))
        });
        setProductSearch('');
        setProductResults([]);
        setShowModal(true);
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const compressed = await compressImage(file);
            setForm(f => ({ ...f, image: compressed }));
        } catch (err) {
            console.error('Image compression failed:', err);
        }
    };

    const addProduct = (product) => {
        setForm(f => ({
            ...f,
            items: [...f.items, {
                product_id: product.id,
                product_name: product.name,
                product_sku: product.sku || '',
                quantity: 1,
                cost: parseFloat(product.cost) || 0,
                current_stock: parseFloat(product.stock) || 0
            }]
        }));
        setProductSearch('');
        setProductResults([]);
    };

    const removeProduct = (idx) => {
        setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
    };

    const updateItemQty = (idx, qty) => {
        const val = parseFloat(qty);
        if (isNaN(val) || val < 0.001) return;
        setForm(f => ({
            ...f,
            items: f.items.map((it, i) => i === idx ? { ...it, quantity: val } : it)
        }));
    };

    const handleSave = async () => {
        if (!form.name || !form.price || form.items.length === 0) return;
        setSaving(true);
        const payload = { ...form, price: parseFloat(form.price), tax_rate: parseFloat(form.tax_rate) || 0 };
        const result = editingCombo
            ? await updateCombo(editingCombo.id, payload)
            : await createCombo(payload);
        setSaving(false);
        if (result.success) setShowModal(false);
    };

    const handleDelete = async (combo) => {
        if (!confirm(`¿Eliminar el combo "${combo.name}"?`)) return;
        await deleteCombo(combo.id);
    };

    const handleSearch = useCallback(async (term) => {
        setSearch(term);
        await fetchCombos(term);
    }, []);

    const getComboAvailableStock = (items) => {
        if (!items || items.length === 0) return 0;
        return Math.min(...items.map(it => {
            const stock = parseFloat(it.current_stock) || 0;
            const qty = parseFloat(it.quantity) || 1;
            return Math.floor(stock / qty);
        }));
    };

    const today = new Date().toISOString().split('T')[0];

    return (
        <div className="min-h-screen p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-text)] flex items-center gap-3">
                        <Gift className="text-[var(--color-primary)]" size={28} />
                        Combos / Packs
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-sm mt-1">
                        Agrupa productos con precio especial
                    </p>
                </div>
                <button onClick={openNew} className="flex items-center gap-2 px-5 py-2.5 bg-[var(--color-primary)] text-black rounded-xl font-bold hover:brightness-110 transition-all shadow-lg shadow-[var(--color-primary)]/20" style={{ display: can('combos.create') ? '' : 'none' }}>
                    <Plus size={18} /> Nuevo Combo
                </button>
            </div>

            {/* Search */}
            <GlassCard className="p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar combos..."
                        className="glass-input !pl-10 w-full"
                        value={search}
                        onChange={e => handleSearch(e.target.value)}
                    />
                </div>
            </GlassCard>

            {/* Combos Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500" />
                </div>
            ) : combos.length === 0 ? (
                <GlassCard className="p-12 text-center">
                    <Gift size={48} className="mx-auto mb-4 text-[var(--color-text-muted)] opacity-30" />
                    <p className="text-[var(--color-text-muted)]">No hay combos creados</p>
                    <button onClick={openNew} className="mt-4 text-[var(--color-primary)] font-bold hover:underline">Crear el primero</button>
                </GlassCard>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {combos.map(combo => {
                        const comboStock = getComboAvailableStock(combo.items);
                        const isExpired = combo.has_dates && combo.end_date && combo.end_date < today;
                        const isActive = combo.is_active && !isExpired;
                        const comboTaxRate = parseFloat(combo.tax_rate) || 0;
                        const comboNetPrice = comboTaxRate > 0 ? combo.price / (1 + comboTaxRate / 100) : combo.price;
                        const comboMargin = combo.cost > 0 ? ((comboNetPrice - combo.cost) / combo.cost * 100).toFixed(1) : '—';

                        return (
                            <GlassCard key={combo.id} className={cn("p-4 space-y-3 transition-all", !isActive && "opacity-60")}>
                                <div className="flex items-start gap-3">
                                    {/* Image */}
                                    <div className="w-16 h-16 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center overflow-hidden shrink-0">
                                        {combo.image ? (
                                            <img src={combo.image} alt={combo.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Package size={24} className="text-[var(--color-text-muted)] opacity-30" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-[var(--color-text)] truncate">{combo.name}</h3>
                                            {!combo.is_active && (
                                                <span className="px-2 py-0.5 text-[10px] font-bold bg-red-500/20 text-red-400 rounded-full">INACTIVO</span>
                                            )}
                                            {isExpired && (
                                                <span className="px-2 py-0.5 text-[10px] font-bold bg-yellow-500/20 text-yellow-400 rounded-full">VENCIDO</span>
                                            )}
                                        </div>
                                        {combo.sku && <p className="text-xs text-[var(--color-text-muted)]">SKU: {combo.sku}</p>}
                                    </div>
                                </div>

                                {/* Price & Cost */}
                                <div className="grid grid-cols-4 gap-2 text-center">
                                    <div className="bg-[var(--glass-bg)] rounded-lg p-2 border border-[var(--glass-border)]">
                                        <p className="text-[10px] text-[var(--color-text-muted)]">Precio</p>
                                        <p className="font-bold text-[var(--color-primary)] text-sm">{formatCurrency(combo.price, currentCurrency)}</p>
                                    </div>
                                    <div className="bg-[var(--glass-bg)] rounded-lg p-2 border border-[var(--glass-border)]">
                                        <p className="text-[10px] text-[var(--color-text-muted)]">Costo</p>
                                        <p className="font-bold text-[var(--color-text)] text-sm">{formatCurrency(combo.cost, currentCurrency)}</p>
                                    </div>
                                    <div className="bg-[var(--glass-bg)] rounded-lg p-2 border border-[var(--glass-border)]">
                                        <p className="text-[10px] text-[var(--color-text-muted)]">Impuesto</p>
                                        <p className="font-bold text-yellow-400 text-sm">{comboTaxRate > 0 ? `${comboTaxRate}%` : '—'}</p>
                                    </div>
                                    <div className="bg-[var(--glass-bg)] rounded-lg p-2 border border-[var(--glass-border)]">
                                        <p className="text-[10px] text-[var(--color-text-muted)]">Margen</p>
                                        <p className={cn("font-bold text-sm", parseFloat(comboMargin) > 0 ? "text-green-400" : "text-red-400")}>
                                            {comboMargin}%
                                        </p>
                                    </div>
                                </div>

                                {/* Stock badge */}
                                <div className="flex items-center justify-between">
                                    <span className={cn(
                                        "px-3 py-1 rounded-full text-xs font-bold",
                                        comboStock > 5 ? "bg-green-500/20 text-green-400" :
                                        comboStock > 0 ? "bg-yellow-500/20 text-yellow-400" :
                                        "bg-red-500/20 text-red-400"
                                    )}>
                                        Stock: {comboStock} {comboStock === 1 ? 'unidad' : 'unidades'}
                                    </span>
                                    {combo.has_dates && (
                                        <span className="text-[10px] text-[var(--color-text-muted)]">
                                            {combo.start_date} → {combo.end_date}
                                        </span>
                                    )}
                                </div>

                                {/* Component products */}
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Productos ({combo.items?.length || 0})</p>
                                    {(combo.items || []).map((it, idx) => (
                                        <div key={idx} className="flex justify-between items-center text-xs text-[var(--color-text-muted)]">
                                            <span className="truncate flex-1">{it.product_name}</span>
                                            <span className="font-mono ml-2">×{it.quantity}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 pt-2 border-t border-[var(--glass-border)]">
                                    {can('combos.edit') && (
                                    <button onClick={() => openEdit(combo)} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-all text-xs font-medium">
                                        <Edit2 size={14} /> Editar
                                    </button>
                                    )}
                                    {can('combos.edit') && (
                                    <button onClick={() => toggleComboActive(combo.id)} className={cn("flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border text-xs font-medium transition-all", combo.is_active ? "bg-[var(--glass-bg)] border-[var(--glass-border)] text-yellow-400 hover:border-yellow-400" : "bg-green-500/10 border-green-500/30 text-green-400 hover:border-green-400")}>
                                        <Power size={14} /> {combo.is_active ? 'Desactivar' : 'Activar'}
                                    </button>
                                    )}
                                    {can('combos.delete') && (
                                    <button onClick={() => handleDelete(combo)} className="p-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-red-400 hover:border-red-400 transition-all">
                                        <Trash2 size={14} />
                                    </button>
                                    )}
                                </div>
                            </GlassCard>
                        );
                    })}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowModal(false)}>
                    <div className="bg-[var(--color-bg)] border border-[var(--glass-border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-5 border-b border-[var(--glass-border)]">
                            <h2 className="text-lg font-bold text-[var(--color-text)]">
                                {editingCombo ? 'Editar Combo' : 'Nuevo Combo'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-white/10 text-[var(--color-text-muted)]">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-5">
                            {/* Image + Name Row */}
                            <div className="flex gap-4">
                                <label className="w-20 h-20 rounded-xl bg-[var(--glass-bg)] border border-dashed border-[var(--glass-border)] flex items-center justify-center cursor-pointer hover:border-[var(--color-primary)] transition-all shrink-0 overflow-hidden">
                                    {form.image ? (
                                        <img src={form.image} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <ImagePlus size={24} className="text-[var(--color-text-muted)]" />
                                    )}
                                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                                </label>
                                <div className="flex-1 space-y-3">
                                    <input
                                        type="text"
                                        placeholder="Nombre del combo *"
                                        className="glass-input w-full"
                                        value={form.name}
                                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    />
                                    <input
                                        type="text"
                                        placeholder="SKU (opcional)"
                                        className="glass-input w-full"
                                        value={form.sku}
                                        onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                                    />
                                </div>
                            </div>

                            {/* Price, Tax, Description */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Precio de venta *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0"
                                        className="glass-input w-full"
                                        value={form.price}
                                        onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Impuesto</label>
                                    <select
                                        className="glass-input w-full"
                                        value={form.tax_rate}
                                        onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))}
                                    >
                                        <option value="0">Sin impuesto</option>
                                        {taxRates.map(t => (
                                            <option key={t.id} value={t.rate}>{t.name} ({t.rate}%)</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Cost & Margin (read-only) */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-[var(--glass-bg)] rounded-xl p-3 border border-[var(--glass-border)] text-center">
                                    <p className="text-[10px] text-[var(--color-text-muted)]">Costo Total</p>
                                    <p className="font-bold text-[var(--color-text)]">{formatCurrency(totalCost, currentCurrency)}</p>
                                </div>
                                <div className="bg-[var(--glass-bg)] rounded-xl p-3 border border-[var(--glass-border)] text-center">
                                    <p className="text-[10px] text-[var(--color-text-muted)]">Margen</p>
                                    <p className={cn("font-bold", parseFloat(margin) > 0 ? "text-green-400" : margin === '—' ? "text-[var(--color-text-muted)]" : "text-red-400")}>
                                        {margin}%
                                    </p>
                                </div>
                                <div className="bg-[var(--glass-bg)] rounded-xl p-3 border border-[var(--glass-border)] text-center">
                                    <p className="text-[10px] text-[var(--color-text-muted)]">Stock Disponible</p>
                                    <p className={cn("font-bold", availableStock > 0 ? "text-green-400" : "text-red-400")}>
                                        {form.items.length > 0 ? availableStock : '—'}
                                    </p>
                                </div>
                            </div>

                            <textarea
                                placeholder="Descripción (opcional)"
                                className="glass-input w-full"
                                rows={2}
                                value={form.description}
                                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            />

                            {/* Vigencia */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.has_dates}
                                        onChange={e => setForm(f => ({ ...f, has_dates: e.target.checked }))}
                                        className="accent-[var(--color-primary)] w-4 h-4"
                                    />
                                    <span className="text-sm text-[var(--color-text)]">Combo con fecha de vigencia</span>
                                </label>
                                {form.has_dates && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Desde</label>
                                            <input type="date" className="glass-input w-full" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Hasta</label>
                                            <input type="date" className="glass-input w-full" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Products Section */}
                            <div className="space-y-3">
                                <h3 className="font-bold text-[var(--color-text)] text-sm flex items-center gap-2">
                                    <Package size={16} /> Productos del Combo
                                </h3>

                                {/* Search products */}
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={16} />
                                    <input
                                        type="text"
                                        placeholder="Buscar producto para agregar..."
                                        className="glass-input !pl-9 w-full text-sm"
                                        value={productSearch}
                                        onChange={e => setProductSearch(e.target.value)}
                                    />
                                    {productResults.length > 0 && (
                                        <div className="absolute z-50 left-0 right-0 top-full mt-1 border border-[var(--glass-border)] rounded-xl shadow-2xl max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--color-background)' }}>
                                            {productResults.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => addProduct(p)}
                                                    className="w-full px-4 py-2.5 text-left hover:bg-[var(--glass-bg)] transition-colors flex items-center justify-between text-sm border-b border-[var(--glass-border)] last:border-0"
                                                >
                                                    <div>
                                                        <span className="text-[var(--color-text)]">{p.name}</span>
                                                        {p.sku && <span className="text-[var(--color-text-muted)] ml-2 text-xs">{p.sku}</span>}
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[var(--color-primary)] font-mono text-xs">{formatCurrency(p.price, currentCurrency)}</span>
                                                        <span className="text-[var(--color-text-muted)] ml-2 text-xs">Stock: {p.stock}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Items list */}
                                {form.items.length === 0 ? (
                                    <div className="border border-dashed border-[var(--glass-border)] rounded-xl p-6 text-center">
                                        <AlertCircle size={24} className="mx-auto mb-2 text-[var(--color-text-muted)] opacity-30" />
                                        <p className="text-sm text-[var(--color-text-muted)]">Agrega productos al combo</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {form.items.map((it, idx) => (
                                            <div key={idx} className="flex items-center gap-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-3">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm text-[var(--color-text)] font-medium truncate">{it.product_name}</p>
                                                    <p className="text-xs text-[var(--color-text-muted)]">
                                                        Costo: {formatCurrency(it.cost, currentCurrency)} · Stock: {it.current_stock}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <label className="text-xs text-[var(--color-text-muted)]">Cant:</label>
                                                    <input
                                                        type="number"
                                                        step="0.001"
                                                        min="0.001"
                                                        className="glass-input w-20 text-center text-sm"
                                                        value={it.quantity}
                                                        onChange={e => updateItemQty(idx, e.target.value)}
                                                    />
                                                </div>
                                                <div className="text-right shrink-0 w-20">
                                                    <p className="text-xs text-[var(--color-text-muted)]">Subtotal</p>
                                                    <p className="text-sm font-bold text-[var(--color-text)]">
                                                        {formatCurrency((parseFloat(it.cost) || 0) * (parseFloat(it.quantity) || 1), currentCurrency)}
                                                    </p>
                                                </div>
                                                <button onClick={() => removeProduct(idx)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition-all">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex justify-end gap-3 p-5 border-t border-[var(--glass-border)]">
                            <button onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text-muted)] font-medium hover:bg-white/10 transition-all">
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !form.name || !form.price || form.items.length === 0}
                                className="px-6 py-2.5 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[var(--color-primary)]/20"
                            >
                                {saving ? 'Guardando...' : editingCombo ? 'Actualizar' : 'Crear Combo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductCombos;
