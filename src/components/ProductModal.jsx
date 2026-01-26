import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';

const ProductModal = ({ isOpen, onClose, onSave, productToEdit }) => {
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
        offer_price: ''
    });
    const [marginPercentage, setMarginPercentage] = useState('');

    useEffect(() => {
        if (productToEdit) {
            setFormData({ ...productToEdit, unit: productToEdit.unit || 'Und' });
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

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === 'price') {
            const newPrice = parseFloat(value) || 0;
            const cost = parseFloat(formData.cost) || 0;
            const taxRate = parseFloat(formData.tax_rate) || 0;
            const netPrice = newPrice / (1 + taxRate / 100);

            if (cost > 0) {
                const newMargin = ((netPrice - cost) / cost) * 100;
                setMarginPercentage(newMargin.toFixed(2));
            }
            setFormData(prev => ({ ...prev, [name]: value }));

        } else if (name === 'cost') {
            const newCost = parseFloat(value) || 0;
            const margin = parseFloat(marginPercentage) || 0;
            const taxRate = parseFloat(formData.tax_rate) || 0;

            if (newCost > 0) {
                const netPrice = newCost * (1 + margin / 100);
                const finalPrice = netPrice * (1 + taxRate / 100);
                setFormData(prev => ({ ...prev, [name]: value, price: finalPrice.toFixed(2) }));
            } else {
                setFormData(prev => ({ ...prev, [name]: value }));
            }

        } else if (name === 'tax_rate') {
            const newTax = parseFloat(value) || 0;
            const cost = parseFloat(formData.cost) || 0;
            const margin = parseFloat(marginPercentage) || 0;

            if (cost > 0) {
                const netPrice = cost * (1 + margin / 100);
                const finalPrice = netPrice * (1 + newTax / 100);
                setFormData(prev => ({ ...prev, [name]: value, price: finalPrice.toFixed(2) }));
            } else {
                setFormData(prev => ({ ...prev, [name]: value }));
            }

        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleMarginChange = (e) => {
        const value = e.target.value;
        setMarginPercentage(value);

        const margin = parseFloat(value) || 0;
        const cost = parseFloat(formData.cost) || 0;
        const taxRate = parseFloat(formData.tax_rate) || 0;

        if (cost > 0) {
            const netPrice = cost * (1 + margin / 100);
            const finalPrice = netPrice * (1 + taxRate / 100);
            setFormData(prev => ({ ...prev, price: finalPrice.toFixed(2) }));
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave({
            ...formData,
            price: parseFloat(formData.price),
            stock: parseInt(formData.stock),
            cost: parseFloat(formData.cost) || 0,
            cost: parseFloat(formData.cost) || 0,
            tax_rate: parseFloat(formData.tax_rate) || 0,
            supplier: formData.supplier,
            is_offer: formData.is_offer,
            offer_price: parseFloat(formData.offer_price) || 0
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="glass-card w-full max-w-4xl relative animate-[float_0.5s_ease-out] my-auto">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors z-10"
                >
                    <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-6 neon-text border-b border-white/10 pb-4">
                    {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
                </h2>

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
                                value={formData.name}
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
                                    value={formData.category}
                                    onChange={handleChange}
                                    className="glass-input w-full"
                                    required
                                >
                                    <option value="" className="bg-gray-900">Seleccionar...</option>
                                    {categories && categories.length > 0 ? (
                                        categories.map(cat => (
                                            <option key={cat.id} value={cat.name} className="bg-gray-900">
                                                {cat.name}
                                            </option>
                                        ))
                                    ) : (
                                        <>
                                            <option value="Bebidas" className="bg-gray-900">Bebidas</option>
                                            <option value="Snacks" className="bg-gray-900">Snacks</option>
                                            <option value="Limpieza" className="bg-gray-900">Limpieza</option>
                                            <option value="Alcohol" className="bg-gray-900">Alcohol</option>
                                            <option value="Varios" className="bg-gray-900">Varios</option>
                                        </>
                                    )}
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
                                    {suppliers && suppliers.length > 0 && suppliers.map(sup => (
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
                                    value={formData.sku}
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
                                    value={formData.stock}
                                    onChange={handleChange}
                                    className="glass-input w-full"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Unidad Medida</label>
                                <select
                                    name="unit"
                                    value={formData.unit}
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
        </div>
    );
};

export default ProductModal;
