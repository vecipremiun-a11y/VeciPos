import React, { useState } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { formatCurrency } from '../utils/formatCurrency';

const QuickPreorderProductModal = ({ isOpen, onClose, onSuccess }) => {
    const { addProduct, addToPreorderCart, currentCurrency, activeCompanyId } = useStore();
    const [formData, setFormData] = useState({
        name: '',
        price_per_kg: '',
        gram_per_unit: '',
        allow_notes: false
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!formData.name.trim()) {
            setError('El nombre es obligatorio');
            return;
        }
        const price = parseFloat(formData.price_per_kg);
        if (isNaN(price) || price <= 0) {
            setError('El precio por kilo es obligatorio y debe ser mayor a 0');
            return;
        }

        setIsLoading(true);

        try {
            // Create product object for store
            const grams = formData.gram_per_unit ? parseFloat(formData.gram_per_unit) : 0;

            const newProduct = {
                name: formData.name,
                price: 0, // Base price 0
                is_offer: false,
                offer_price: 0,
                unit: 'Und', // Request in units
                preorder_unit: 'Und',
                preorder_billing_unit: 'kg', // Charge in Kg
                preorder_price_per_kg: price,
                preorder_gram_per_unit: grams,
                preorder_use_base_price: false, // Don't use base price
                sale_mode: 'preorder_only',
                allow_item_notes: formData.allow_notes,
                stock: 0,
                category: 'Rápidos',
                sku: `QUICK-${Date.now()}`
            };

            const result = await addProduct(newProduct);

            if (result && result.success) {
                // Add to cart immediately
                // result.product is the returned row
                const productToCart = result.product || { ...newProduct, id: result.id }; // Fallback
                addToPreorderCart(productToCart);
                onSuccess && onSuccess();
                onClose();
                // Reset form
                setFormData({ name: '', price_per_kg: '', gram_per_unit: '', allow_notes: false });
            } else {
                setError(result?.error || 'Error al crear producto');
            }
        } catch (err) {
            console.error(err);
            setError('Error al procesar: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/40">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="text-orange-400">⚡</span> Producto Rápido (Encargo)
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Nombre del producto *</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            className="glass-input w-full font-bold text-white placeholder-gray-600"
                            placeholder="Ej: Pan especial completo"
                            autoFocus
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {/* Price per Kg */}
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Precio por Kilo *</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                                <input
                                    type="number"
                                    value={formData.price_per_kg}
                                    onChange={(e) => setFormData(prev => ({ ...prev, price_per_kg: e.target.value }))}
                                    className="glass-input w-full pl-7"
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        {/* Grams per Unit (Optional) */}
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">
                                Peso unit (g)
                                <span className="ml-1 text-[10px] text-gray-500 border border-gray-700 px-1 rounded">Opcional</span>
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={formData.gram_per_unit}
                                    onChange={(e) => setFormData(prev => ({ ...prev, gram_per_unit: e.target.value }))}
                                    className="glass-input w-full pr-8"
                                    placeholder="Ej: 110"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">g</span>
                            </div>
                        </div>
                    </div>

                    <p className="text-[10px] text-gray-500 italic">
                        * Si no ingresas peso unitario, el total aproximado quedará como <strong>PENDIENTE</strong>.
                    </p>

                    {/* Options */}
                    <div className="flex items-center gap-2 pt-2">
                        <input
                            type="checkbox"
                            id="allow_notes"
                            checked={formData.allow_notes}
                            onChange={(e) => setFormData(prev => ({ ...prev, allow_notes: e.target.checked }))}
                            className="w-4 h-4 rounded border-gray-600 bg-black/40 text-orange-500 focus:ring-orange-500"
                        />
                        <label htmlFor="allow_notes" className="text-sm text-gray-300 select-none cursor-pointer">
                            Permitir notas en este producto
                        </label>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 mt-6 pt-2 border-t border-white/5">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-pink-600 text-white rounded-xl font-bold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Save className="w-4 h-4" />
                                    <span>Crear y Agregar</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default QuickPreorderProductModal;
