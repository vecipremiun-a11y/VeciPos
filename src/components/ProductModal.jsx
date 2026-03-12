import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Trash2, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { compressImage, validateImage } from '../lib/imageCompression';
import { formatCurrency } from '../utils/formatCurrency';

const ProductModal = ({ isOpen, onClose, onSave, productToEdit, isInline = false }) => {
    const { categories, suppliers, currentCurrency, taxRates } = useStore();
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        stock: '',
        unit: 'Und',
        category: '',
        sku: '',
        image: '',
        cost: '',
        supplier: '',
        tax_rate: 0,
        is_offer: false,
        offer_price: '',
        price_ranges: [],
        sale_mode: 'sale_only',
        allow_item_notes: false,
        preorder_unit: '',
        preorder_billing_unit: 'unit',
        preorder_price_per_kg: '',
        preorder_gram_per_unit: '',
        preorder_use_base_price: true
    });
    const [marginPercentage, setMarginPercentage] = useState('');

    useEffect(() => {
        if (productToEdit) {
            setFormData({
                ...productToEdit,
                unit: productToEdit.unit || 'Und',
                price_ranges: productToEdit.price_ranges || [],
                preorder_billing_unit: productToEdit.preorder_billing_unit || 'unit',
                preorder_price_per_kg: productToEdit.preorder_billing_unit === 'kg' ? (productToEdit.preorder_price_per_kg || '') : '',
                preorder_gram_per_unit: productToEdit.preorder_gram_per_unit || '',
                preorder_use_base_price: productToEdit.preorder_use_base_price !== undefined ? (productToEdit.preorder_use_base_price === 1) : true
            });

            // Calculate initial margin %
            if (productToEdit.price && productToEdit.cost) {
                const taxRate = parseFloat(productToEdit.tax_rate) || 0;
                const netPrice = parseFloat(productToEdit.price) / (1 + taxRate / 100);
                const cost = parseFloat(productToEdit.cost);
                if (cost > 0) {
                    const margin = ((netPrice - cost) / cost) * 100;
                    setMarginPercentage(margin.toFixed(2));
                }
            }
            // Handle is_offer boolean/integer conversion
            if (productToEdit.is_offer !== undefined) {
                setFormData(prev => ({ ...prev, is_offer: productToEdit.is_offer === 1 || productToEdit.is_offer === true, offer_price: productToEdit.offer_price || '' }));
            }
        } else {
            setFormData({ name: '', price: '', stock: '', unit: 'Und', category: '', sku: '', image: '', cost: '', supplier: '', tax_rate: 0, is_offer: false, offer_price: '', sale_mode: 'sale_only', allow_item_notes: false, preorder_unit: '', preorder_billing_unit: 'unit', preorder_price_per_kg: '', preorder_gram_per_unit: '', preorder_use_base_price: true });
            setMarginPercentage('');
        }
    }, [productToEdit, isOpen]);

    const handleChange = (e) => {
        const { name, value } = e.target;

        // Auto-calculate Margin if Price changes (keeping Cost constant)
        if (name === 'price') {
            const price = parseFloat(value);
            const cost = parseFloat(formData.cost); // Use current state cost
            const taxRate = parseFloat(formData.tax_rate) || 0;

            if (!isNaN(price) && !isNaN(cost) && cost > 0) {
                const netPrice = price / (1 + taxRate / 100);
                const margin = ((netPrice - cost) / cost) * 100;
                setMarginPercentage(margin.toFixed(2));
            }
        }

        setFormData(prev => {
            const newData = { ...prev, [name]: value };

            // Auto-calculate margin if cost or price changes directly (and both exist)
            if (name === 'cost' || name === 'price') {
                const cost = parseFloat(name === 'cost' ? value : prev.cost);
                const price = parseFloat(name === 'price' ? value : prev.price);
                const taxRate = parseFloat(prev.tax_rate) || 0;

                if (cost > 0 && price > 0) {
                    const netPrice = price / (1 + taxRate / 100);
                    const margin = ((netPrice - cost) / cost) * 100;
                    // We don't set margin state here to avoid circular jumps, 
                    // or maybe we should? Let's just update it if valid.
                    // setMarginPercentage(margin.toFixed(2)); 
                }
            }

            // Auto-calculate Price if Tax Rate Changes (keeping Cost and Margin constant)
            if (name === 'tax_rate') {
                const cost = parseFloat(prev.cost);
                // We need the current margin. Since marginPercentage is state, we can use it.
                // However, marginPercentage might be empty string.
                // If we have cost and price, we can calculate current margin?
                // Or just use the marginPercentage state if valid.

                // Let's rely on cost and existing margin logic.
                // If we have cost and a valid margin, we recalculate price.
                if (cost > 0 && marginPercentage && !isNaN(parseFloat(marginPercentage))) {
                    const margin = parseFloat(marginPercentage);
                    const basicPrice = cost * (1 + margin / 100);
                    const newTax = parseFloat(value) || 0;
                    const finalPrice = basicPrice * (1 + newTax / 100);
                    newData.price = finalPrice.toFixed(2);
                }
            }
            return newData;
        });
    };

    const handleMarginChange = (e) => {
        const margin = e.target.value;
        setMarginPercentage(margin);

        const cost = parseFloat(formData.cost);
        if (cost > 0 && margin !== '') {
            const marginVal = parseFloat(margin);
            const basicPrice = cost * (1 + marginVal / 100);
            const taxRate = parseFloat(formData.tax_rate) || 0;
            const finalPrice = basicPrice * (1 + taxRate / 100);

            setFormData(prev => ({ ...prev, price: finalPrice.toFixed(2) }));
        }
    };

    const toNum = (v) => parseFloat(String(v).replace(',', '.')) || 0;

    const handleSubmit = (e) => {
        e.preventDefault();
        const dataToSave = {
            ...formData,
            price: toNum(formData.price),
            cost: toNum(formData.cost),
            stock: Math.round(toNum(formData.stock) * 1000) / 1000,
            tax_rate: toNum(formData.tax_rate),
            offer_price: toNum(formData.offer_price),
            // Ensure price_ranges logic preserves numbers logic if needed, 
            // but they are usually strings in inputs. 
            // The map logic in implementation handles them. 
            // But let's be safe and ensure price_ranges numbers are numbers?
            // The store stringifies them anyway.
        };
        onSave(dataToSave);
    };

    if (!isOpen && !isInline) return null;

    const content = (
        <div className={cn(
            "w-full relative",
            isInline ? "bg-[#1a1a3d] p-6 rounded-xl border border-white/10" : "glass-card max-w-4xl my-auto animate-[float_0.5s_ease-out]"
        )}>
            <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                    >
                        {isInline ? <ArrowLeft size={24} /> : <X size={24} />}
                        {isInline && <span className="text-sm font-bold uppercase tracking-wider">Volver</span>}
                    </button>
                    <h2 className="text-2xl font-bold neon-text">
                        {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
                    </h2>
                </div>

                {/* Sale Mode Selector moved to Header */}
                <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                    {[
                        { value: 'sale_only', label: 'Solo Venta', emoji: '🛒' },
                        { value: 'preorder_only', label: 'Solo Encargo', emoji: '📋' },
                        { value: 'both', label: 'Ambos', emoji: '🔄' }
                    ].map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, sale_mode: opt.value }))}
                            className={cn(
                                "py-1.5 px-3 rounded-md text-xs font-bold transition-all flex items-center gap-2",
                                formData.sale_mode === opt.value
                                    ? "bg-[var(--color-primary)] text-black shadow-lg"
                                    : "text-gray-400 hover:text-white hover:bg-white/5"
                            )}
                        >
                            <span>{opt.emoji}</span>
                            <span className="hidden sm:inline">{opt.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* LEFT COLUMN: Product Details */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-1 h-6 bg-[var(--color-primary)] rounded-full"></span>
                        Detalles del Producto
                    </h3>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Nombre del Producto</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name || ''}
                            onChange={handleChange}
                            className="glass-input w-full"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Categoría</label>
                            <select
                                name="category"
                                value={formData.category || ''}
                                onChange={handleChange}
                                className="glass-input w-full"
                                required
                            >
                                <option value="" className="bg-gray-900">Seleccionar...</option>
                                {categories && categories.map(cat => (
                                    <option key={cat.id} value={cat.name} className="bg-gray-900">
                                        {cat.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Proveedor</label>
                            <select
                                name="supplier"
                                value={formData.supplier || ''}
                                onChange={handleChange}
                                className="glass-input w-full"
                            >
                                <option value="" className="bg-gray-900">Seleccionar...</option>
                                {suppliers && suppliers.map(sup => (
                                    <option key={sup.id} value={sup.name} className="bg-gray-900">
                                        {sup.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">SKU / Código</label>
                            <input
                                type="text"
                                name="sku"
                                value={formData.sku || ''}
                                onChange={handleChange}
                                className="glass-input w-full"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Stock Actual</label>
                            <input
                                type="number"
                                step="any"
                                name="stock"
                                value={formData.stock || ''}
                                onChange={handleChange}
                                className="glass-input w-full"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Unidad Medida</label>
                            <select
                                name="unit"
                                value={formData.unit || 'Und'}
                                onChange={handleChange}
                                className="glass-input w-full"
                            >
                                <option value="Und" className="bg-gray-900">Und (Unidad)</option>
                                <option value="Kg" className="bg-gray-900">Kg (Kilogramo)</option>
                                <option value="Caja" className="bg-gray-900">Caja</option>
                                <option value="Lt" className="bg-gray-900">Lt (Litro)</option>
                                <option value="Mt" className="bg-gray-900">Mt (Metro)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Imagen (URL o Archivo)</label>
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    name="image"
                                    placeholder="https://..."
                                    value={formData.image || ''}
                                    onChange={handleChange}
                                    className="glass-input flex-1"
                                />
                                <label className="cursor-pointer bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors flex items-center justify-center border border-white/10">
                                    <span className="text-xs">Subir</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={async (e) => {
                                            const file = e.target.files[0];
                                            if (!file) return;
                                            // Reset para permitir re-seleccionar el mismo archivo
                                            e.target.value = '';

                                            // Validar imagen
                                            const validation = validateImage(file);
                                            if (!validation.valid) {
                                                alert(validation.error);
                                                return;
                                            }

                                            try {
                                                console.log('📸 Comprimiendo imagen...', { name: file.name, type: file.type, size: file.size });
                                                console.time('⏱️ Compresión');

                                                // Comprimir imagen (max 200KB, 800x800px)
                                                const compressedBase64 = await compressImage(file, 200, 800, 800);

                                                console.timeEnd('⏱️ Compresión');

                                                // Guardar en el formulario
                                                setFormData(prev => ({
                                                    ...prev,
                                                    image: compressedBase64
                                                }));

                                                console.log('✅ Imagen comprimida y lista');

                                            } catch (error) {
                                                console.error('❌ Error al comprimir imagen:', error);
                                                alert('Error al procesar la imagen. Intenta con otra.');
                                            }
                                        }}
                                        className="hidden"
                                    />
                                </label>
                            </div>

                            {formData.image && (
                                <div className="mt-2 text-center bg-black/20 rounded-lg p-2 border border-white/5 h-32 flex items-center justify-center">
                                    <img src={formData.image} alt="Preview" className="max-h-full max-w-full object-contain rounded shadow-lg" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Pricing & Review */}
                <div className="space-y-4 bg-white/5 p-6 rounded-2xl border border-white/5 h-fit">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-1 h-6 bg-green-400 rounded-full"></span>
                        Precios y Margen
                    </h3>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Costo ($)</label>
                            <input
                                type="number"
                                step="0.01"
                                name="cost"
                                value={formData.cost || ''}
                                onChange={handleChange}
                                className="glass-input w-full"
                                placeholder="0.00"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Utilidad (%)</label>
                            <input
                                type="number"
                                step="any"
                                value={marginPercentage}
                                onChange={handleMarginChange}
                                className="glass-input w-full text-green-400 font-bold"
                                placeholder="30"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Impuesto / IVA</label>
                            <select
                                name="tax_rate"
                                value={formData.tax_rate || 0}
                                onChange={handleChange}
                                className="glass-input w-full"
                            >
                                {taxRates && taxRates.length > 0 ? (
                                    taxRates.map((tax, index) => {
                                        if (!tax) return null;
                                        const rate = tax.rate !== undefined && tax.rate !== null ? tax.rate : 0;
                                        const name = tax.name || 'Impuesto';
                                        return (
                                            <option key={tax.id || index} value={rate} className="bg-gray-900">
                                                {name} ({rate}%)
                                            </option>
                                        );
                                    })
                                ) : (
                                    <option value={0} className="bg-gray-900">Sin impuestos configurados</option>
                                )}
                            </select>
                        </div>
                    </div>

                    <div className="text-right">
                        <label className="block text-xs text-gray-500 mb-1">Precio Neto Calc.</label>
                        <div className="text-lg font-mono text-gray-300">
                            {formatCurrency(parseFloat(formData.cost || 0) * (1 + (parseFloat(marginPercentage || 0)) / 100), currentCurrency)}
                        </div>
                    </div>

                    <div className="my-6 border-t border-white/10"></div>

                    <div className="bg-black/20 p-4 rounded-xl border border-white/10 shadow-inner">
                        <label className="block text-sm text-[var(--color-primary)] font-bold mb-2 text-center uppercase tracking-wider">Precio Venta Final</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-xl font-bold">$</span>
                            <input
                                type="number"
                                step="0.01"
                                name="price"
                                value={formData.price}
                                onChange={handleChange}
                                style={{ fontSize: '42px' }}
                                className="glass-input w-full font-bold text-center pl-8 text-white h-16"
                                required
                            />
                        </div>
                        <p className="text-center text-xs text-gray-500 mt-2">IVA Incluido</p>
                    </div>

                    {/* OFFER SECTION */}
                    <div className={`p-4 rounded-xl border transition-all duration-300 ${formData.is_offer ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]' : 'bg-white/5 border-white/10'}`}>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-white font-bold flex items-center gap-2">
                                En Oferta
                                {formData.is_offer && <span className="text-[10px] bg-[var(--color-primary)] text-black px-2 py-0.5 rounded-full font-bold animate-pulse">ACTIVO</span>}
                            </label>
                            <button
                                type="button"
                                onClick={() => setFormData(prev => ({ ...prev, is_offer: !prev.is_offer }))}
                                className={`w-12 h-6 rounded-full flex items-center p-1 transition-all duration-300 ${formData.is_offer ? 'bg-[var(--color-primary)]' : 'bg-gray-600'}`}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${formData.is_offer ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {formData.is_offer && (
                            <div className="mt-4 animate-in slide-in-from-top-2 fade-in duration-300">
                                <label className="block text-sm text-[var(--color-primary)] font-bold mb-1">Precio Oferta</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-[var(--color-primary)] font-bold text-xl shrink-0">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        name="offer_price"
                                        value={formData.offer_price}
                                        onChange={handleChange}
                                        className="glass-input w-full text-xl font-bold text-[var(--color-primary)] border-[var(--color-primary)]/50 focus:border-[var(--color-primary)]"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="text-right mt-2 text-xs text-gray-400">
                                    Precio Normal: <span className="line-through text-red-400 decoration-red-400">${formData.price}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* SCALE GROUP ID */}
                    <div className="mt-4 bg-black/20 p-4 rounded-xl border border-white/10">
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            ID Grupo de Escala (Opcional)
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                name="scale_group_id"
                                value={formData.scale_group_id || ''}
                                onChange={handleChange}
                                placeholder="Ej: LIMPIADOR-500ML"
                                className="glass-input w-full"
                            />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                            Productos con el mismo ID sumarán sus cantidades para aplicar el precio mayorista.
                        </p>
                    </div>

                    {/* AVAILABILITY / PREORDERS SECTION (Only shows specific options if enabled) */}
                    {(formData.sale_mode === 'preorder_only' || formData.sale_mode === 'both') && (
                        <div className="mt-6 border-t border-white/10 pt-6">
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                <span className="w-1 h-6 bg-orange-400 rounded-full"></span>
                                Configuración de Encargos
                            </h3>

                            <div className="space-y-4">
                                {/* Se solicita en */}
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Se solicita en (producción)</label>
                                    <select
                                        name="preorder_unit"
                                        value={formData.preorder_unit || ''}
                                        onChange={handleChange}
                                        className="glass-input w-full"
                                    >
                                        <option value="" className="bg-gray-900">Usar unidad normal ({formData.unit || 'Und'})</option>
                                        <option value="Und" className="bg-gray-900">Unidades</option>
                                        <option value="Kg" className="bg-gray-900">Kg</option>
                                        <option value="Docena" className="bg-gray-900">Docena</option>
                                        <option value="Bandeja" className="bg-gray-900">Bandeja</option>
                                        <option value="Porción" className="bg-gray-900">Porción</option>
                                    </select>
                                    <p className="text-[10px] text-gray-500 mt-1">Cómo el cliente pide el producto (ej: "10 unidades").</p>
                                </div>

                                {/* Se cobra en */}
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Se cobra en (al entregar)</label>
                                    <div className="flex gap-2 mb-2">
                                        {[{ value: 'unit', label: 'Por unidad' }, { value: 'kg', label: 'Por kilo' }].map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setFormData(prev => ({ ...prev, preorder_billing_unit: opt.value }))}
                                                className={cn("flex-1 py-2 rounded-xl text-sm font-bold transition-all border",
                                                    formData.preorder_billing_unit === opt.value
                                                        ? "bg-orange-400/20 text-orange-300 border-orange-400/50"
                                                        : "bg-black/20 text-gray-400 border-white/10 hover:border-orange-400/30"
                                                )}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                        {formData.preorder_billing_unit === 'kg'
                                            ? "Se pesará el producto al momento de la entrega para cobrar el valor exacto."
                                            : "Se cobrará según la cantidad solicitada."}
                                    </p>
                                </div>

                                {/* Precio Base vs Especial */}
                                <div className="bg-black/20 p-3 rounded-xl border border-white/10 space-y-3">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <label className="text-white font-bold text-sm">Usar precio de venta</label>
                                            <p className="text-[10px] text-gray-500">
                                                Reutilizar el precio normal ({formatCurrency(
                                                    (formData.is_offer && formData.offer_price > 0) ? parseFloat(formData.offer_price) : parseFloat(formData.price || 0),
                                                    currentCurrency
                                                )})
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, preorder_use_base_price: !prev.preorder_use_base_price }))}
                                            className={`w-12 h-6 rounded-full flex items-center p-1 transition-all duration-300 ${formData.preorder_use_base_price ? 'bg-green-500' : 'bg-gray-600'}`}
                                        >
                                            <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${formData.preorder_use_base_price ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>

                                    {!formData.preorder_use_base_price && (
                                        <div className="animate-in slide-in-from-top-2 pt-2 border-t border-white/10">
                                            <label className="block text-sm text-gray-400 mb-1">
                                                Precio especial para encargo ({formData.preorder_billing_unit === 'kg' ? '$/kg' : '$/unidad'})
                                            </label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                                                <input
                                                    type="number"
                                                    name="preorder_price_per_kg"
                                                    value={formData.preorder_price_per_kg}
                                                    onChange={handleChange}
                                                    placeholder="0"
                                                    className="glass-input w-full pl-8"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Peso aproximado (Only if Request=Unit AND Billing=Kg) */}
                                {(formData.preorder_billing_unit === 'kg' && (!formData.preorder_unit || formData.preorder_unit === 'Und')) && (
                                    <div className="animate-in slide-in-from-top-2">
                                        <label className="block text-sm text-gray-400 mb-1">⚖️ Peso aproximado por unidad (gramos)</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                name="preorder_gram_per_unit"
                                                value={formData.preorder_gram_per_unit}
                                                onChange={handleChange}
                                                placeholder="Ej: 110"
                                                className="glass-input w-full pr-8"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">g</span>
                                        </div>
                                        <p className="text-[10px] text-orange-400 mt-1">Necesario para calcular el total aproximado (unidades × peso).</p>
                                    </div>
                                )}

                                {/* Allow Item Notes */}
                                <div className="flex justify-between items-center bg-black/20 p-3 rounded-xl border border-white/10">
                                    <div>
                                        <label className="text-white font-bold text-sm">Permitir notas por item</label>
                                        <p className="text-[10px] text-gray-500">Ej: "sin sal", "rebanado grueso"</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, allow_item_notes: !prev.allow_item_notes }))}
                                        className={`w-12 h-6 rounded-full flex items-center p-1 transition-all duration-300 ${formData.allow_item_notes ? 'bg-orange-400' : 'bg-gray-600'}`}
                                    >
                                        <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${formData.allow_item_notes ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PRICE RANGES SECTION (Wholesale) */}
                    <div className="mt-6 border-t border-white/10 pt-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                                Precios por Escala (Mayoreo)
                            </h3>
                            <button
                                type="button"
                                onClick={() => {
                                    setFormData(prev => ({
                                        ...prev,
                                        price_ranges: [
                                            ...(prev.price_ranges || []),
                                            { min: 1, max: '', margin: '', price: '' }
                                        ]
                                    }));
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg text-sm transition-colors border border-purple-500/30"
                            >
                                <Plus size={16} />
                                Agregar Rango
                            </button>
                        </div>

                        <div className="space-y-3">
                            {(formData.price_ranges || []).map((range, index) => (
                                <div key={index} className="grid grid-cols-12 gap-2 items-center bg-black/20 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                                    {/* Range */}
                                    <div className="col-span-4 flex items-center gap-2">
                                        <div className="flex-1">
                                            <label className="text-[10px] text-gray-500 block mb-0.5">Min</label>
                                            <input
                                                type="number"
                                                value={range.min}
                                                onChange={(e) => {
                                                    const newRanges = [...(formData.price_ranges || [])];
                                                    newRanges[index] = { ...newRanges[index], min: e.target.value };
                                                    setFormData(prev => ({ ...prev, price_ranges: newRanges }));
                                                }}
                                                className="glass-input w-full py-1 px-2 text-sm"
                                                placeholder="1"
                                            />
                                        </div>
                                        <span className="text-gray-600 mt-4">-</span>
                                        <div className="flex-1">
                                            <label className="text-[10px] text-gray-500 block mb-0.5">Máx</label>
                                            <input
                                                type="number"
                                                value={range.max}
                                                onChange={(e) => {
                                                    const newRanges = [...(formData.price_ranges || [])];
                                                    newRanges[index] = { ...newRanges[index], max: e.target.value };
                                                    setFormData(prev => ({ ...prev, price_ranges: newRanges }));
                                                }}
                                                className="glass-input w-full py-1 px-2 text-sm"
                                                placeholder="∞"
                                            />
                                        </div>
                                    </div>

                                    {/* Margin */}
                                    <div className="col-span-3">
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Utilidad %</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                step="any"
                                                value={range.margin}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    const newRanges = [...(formData.price_ranges || [])];
                                                    const cost = parseFloat(formData.cost);
                                                    const taxRate = parseFloat(formData.tax_rate) || 0;

                                                    let price = '';
                                                    if (cost > 0 && val !== '') {
                                                        const marginVal = parseFloat(val);
                                                        const basicPrice = cost * (1 + marginVal / 100);
                                                        price = (basicPrice * (1 + taxRate / 100)).toFixed(2);
                                                    }

                                                    newRanges[index] = { ...newRanges[index], margin: val, price: price };
                                                    setFormData(prev => ({ ...prev, price_ranges: newRanges }));
                                                }}
                                                className="glass-input w-full py-1 px-2 text-sm text-green-400 font-bold pr-6"
                                                placeholder="30"
                                            />
                                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">%</span>
                                        </div>
                                    </div>

                                    {/* Price */}
                                    <div className="col-span-4">
                                        <label className="text-[10px] text-gray-500 block mb-0.5">Precio Final (con IVA)</label>
                                        <div className="relative">
                                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={range.price}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    const newRanges = [...(formData.price_ranges || [])];
                                                    const cost = parseFloat(formData.cost);
                                                    const taxRate = parseFloat(formData.tax_rate) || 0;

                                                    let margin = '';
                                                    if (cost > 0 && val !== '') {
                                                        const priceVal = parseFloat(val);
                                                        const netPrice = priceVal / (1 + taxRate / 100);
                                                        margin = (((netPrice - cost) / cost) * 100).toFixed(2);
                                                    }

                                                    newRanges[index] = { ...newRanges[index], price: val, margin: margin };
                                                    setFormData(prev => ({ ...prev, price_ranges: newRanges }));
                                                }}
                                                className="glass-input w-full py-1 px-2 text-sm pl-5 font-bold text-white"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>

                                    {/* Delete */}
                                    <div className="col-span-1 flex items-end justify-center pb-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newRanges = (formData.price_ranges || []).filter((_, i) => i !== index);
                                                setFormData(prev => ({ ...prev, price_ranges: newRanges }));
                                            }}
                                            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 p-1.5 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(formData.price_ranges || []).length === 0 && (
                                <div className="text-center py-6 text-gray-600 text-sm border border-dashed border-white/5 rounded-xl">
                                    No hay precios mayoristas configurados
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3 justify-end mt-8">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 rounded-xl hover:bg-white/10 text-white transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn-primary py-3 px-8 text-lg shadow-lg hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all"
                        >
                            Guardar
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );

    if (isInline) return content;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            {content}
        </div>
    );
};

export default ProductModal;
