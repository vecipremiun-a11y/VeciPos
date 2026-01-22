import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

const ProductModal = ({ isOpen, onClose, onSave, productToEdit }) => {
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        stock: '',
        unit: 'Und',
        category: '',
        sku: '',
        image: '',
        cost: '',
        tax_rate: 0
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
        } else {
            setFormData({ name: '', price: '', stock: '', unit: 'Und', category: '', sku: '', image: '', cost: '', tax_rate: 0 });
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
            tax_rate: parseFloat(formData.tax_rate) || 0
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="glass-card w-full max-w-lg relative animate-[float_0.5s_ease-out]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-6 neon-text">
                    {productToEdit ? 'Editar Producto' : 'Nuevo Producto'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
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

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Precio ($) (Auto)</label>
                            <input
                                type="number"
                                step="0.01"
                                name="price"
                                value={formData.price}
                                onChange={handleChange}
                                className="glass-input w-full opacity-50"
                                readOnly
                                title="Use Cost + Margin to set this"
                            />
                        </div>
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

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Categoría</label>
                            <select
                                name="category"
                                value={formData.category}
                                onChange={handleChange}
                                className="glass-input w-full" /* Tailwind forms plugin might be needed for select styling reset, but custom class works ok usually */
                                required
                            >
                                <option value="" className="bg-gray-900">Seleccionar...</option>
                                <option value="Bebidas" className="bg-gray-900">Bebidas</option>
                                <option value="Snacks" className="bg-gray-900">Snacks</option>
                                <option value="Limpieza" className="bg-gray-900">Limpieza</option>
                                <option value="Alcohol" className="bg-gray-900">Alcohol</option>
                                <option value="Varios" className="bg-gray-900">Varios</option>
                            </select>
                        </div>
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
                            <label className="block text-sm text-gray-400 mb-1">Margen Utilidad (%)</label>
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

                    <div className="grid grid-cols-2 gap-4 items-end">
                        <div className="flex-1">
                            <label className="block text-sm text-gray-400 mb-1">Impuesto / IVA (%)</label>
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
                        <div className="text-right pb-2">
                            <span className="block text-xs text-gray-400">Precio Neto (Calc):</span>
                            <span className="text-white font-medium">
                                ${(parseFloat(formData.cost || 0) * (1 + (parseFloat(marginPercentage || 0)) / 100)).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                        <label className="block text-sm text-[var(--color-primary)] font-bold mb-1">Precio Venta Final (IVA Incluido)</label>
                        <input
                            type="number"
                            step="0.01"
                            name="price"
                            value={formData.price}
                            onChange={handleChange}
                            className="glass-input w-full text-xl font-bold text-center"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Imagen del Producto (URL o Archivo)</label>
                        <div className="flex flex-col gap-2">
                            <input
                                type="text"
                                name="image"
                                placeholder="https://..."
                                value={formData.image || ''}
                                onChange={handleChange}
                                className="glass-input w-full"
                            />
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
                                className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[var(--color-primary)] file:text-black hover:file:bg-[var(--color-primary-dark)] cursor-pointer"
                            />
                        </div>
                        {formData.image && (
                            <div className="mt-2 text-center bg-white/5 rounded-lg p-2">
                                <img src={formData.image} alt="Preview" className="h-20 mx-auto object-contain rounded" />
                            </div>
                        )}
                    </div>

                    <div className="pt-4 flex gap-3 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn-primary"
                        >
                            Guardar Producto
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProductModal;
