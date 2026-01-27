import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Trash2, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';

const ProductModal = ({ isOpen, onClose, onSave, productToEdit, isInline = false }) => {
    const { categories, suppliers } = useStore();
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
        price_ranges: []
    });
    const [marginPercentage, setMarginPercentage] = useState('');

    useEffect(() => {
        if (productToEdit) {
            setFormData({
                ...productToEdit,
                unit: productToEdit.unit || 'Und',
                price_ranges: productToEdit.price_ranges || []
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
            if (productToEdit.is_offer !== undefined) {
                setFormData(prev => ({ ...prev, is_offer: productToEdit.is_offer === 1 || productToEdit.is_offer === true, offer_price: productToEdit.offer_price || '' }));
            }
        } else {
            setFormData({ name: '', price: '', stock: '', unit: 'Und', category: '', sku: '', image: '', cost: '', supplier: '', tax_rate: 0, is_offer: false, offer_price: '' });
            setMarginPercentage('');
        }
    }, [productToEdit, isOpen]);

    const handleChange = (e) => {
        const { name, value } = e.target;
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

    const handleSubmit = (e) => {
        e.preventDefault();
        const dataToSave = {
            ...formData,
            price: parseFloat(formData.price) || 0,
            cost: parseFloat(formData.cost) || 0,
            stock: parseInt(formData.stock) || 0,
            tax_rate: parseFloat(formData.tax_rate) || 0,
            offer_price: parseFloat(formData.offer_price) || 0,
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
            <div className="flex items-center gap-4 mb-6 border-b border-white/10 pb-4">
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
                                        onChange={(e) => {
                                            const file = e.target.files[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onloadend = () => {
                                                    setFormData(prev => ({ ...prev, image: reader.result }));
                                                };
                                                reader.readAsDataURL(file);
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
                                <option value="0">Exento (0%)</option>
                                <option value="19">IVA (19%)</option>
                            </select>
                        </div>
                    </div>

                    <div className="text-right">
                        <label className="block text-xs text-gray-500 mb-1">Precio Neto Calc.</label>
                        <div className="text-lg font-mono text-gray-300">
                            ${(parseFloat(formData.cost || 0) * (1 + (parseFloat(marginPercentage || 0)) / 100)).toFixed(0)}
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
                                className="glass-input w-full text-3xl font-bold text-center pl-8 text-white h-16"
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
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-primary)] font-bold text-lg">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        name="offer_price"
                                        value={formData.offer_price}
                                        onChange={handleChange}
                                        className="glass-input w-full pl-8 text-xl font-bold text-[var(--color-primary)] border-[var(--color-primary)]/50 focus:border-[var(--color-primary)]"
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
