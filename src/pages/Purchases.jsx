import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Search, Plus, Save, Trash2, ShoppingCart, PackagePlus } from 'lucide-react';
import ProductModal from '../components/ProductModal';

const Purchases = () => {
    const { products, suppliers, addPurchase, addProduct } = useStore();
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);

    // Left Column: Product Entry
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [entryForm, setEntryForm] = useState({
        cost: '',
        price: '',
        quantity: '1',
        margin: '',
        sku: '',
        tax: 0,
        expiryDate: '',
        batchNumber: ''
    });

    // Right Column: Invoice Details
    const [invoiceData, setInvoiceData] = useState({
        supplierId: '',
        invoiceNumber: '',
        date: new Date().toISOString().split('T')[0],
        isCredit: false,
        creditDays: '',
        expiryDate: '',
        deposit: '',
        paymentMethod: 'Efectivo'
    });
    const [invoiceItems, setInvoiceItems] = useState([]);

    // Derived
    const filteredProducts = searchTerm
        ? products.filter(p =>
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()))
        ).slice(0, 5) // Limit results
        : [];

    const handleSelectProduct = (product) => {
        setSelectedProduct(product);
        setSearchTerm(product.name);

        // Calculate margin if possible using tax
        let margin = '';
        const taxRate = parseFloat(product.tax_rate) || 0;

        if (product.price && product.cost > 0) {
            const netPrice = parseFloat(product.price) / (1 + taxRate / 100);
            margin = (((netPrice - product.cost) / product.cost) * 100).toFixed(2);
        }

        setEntryForm({
            cost: product.cost || '',
            price: product.price || '',
            quantity: '1',
            margin: margin,
            sku: product.sku || '',
            tax: taxRate,
            expiryDate: '',
            batchNumber: ''
        });
    };

    const handleEntryChange = (e) => {
        const { name, value } = e.target;

        if (name === 'cost') {
            const cost = parseFloat(value) || 0;
            const margin = parseFloat(entryForm.margin) || 0;
            const tax = parseFloat(entryForm.tax) || 0;

            if (cost > 0 && margin) {
                const netPrice = cost * (1 + margin / 100);
                const finalPrice = netPrice * (1 + tax / 100);
                setEntryForm(prev => ({ ...prev, [name]: value, price: finalPrice.toFixed(0) }));
            } else {
                setEntryForm(prev => ({ ...prev, [name]: value }));
            }
        } else if (name === 'price') {
            const price = parseFloat(value) || 0;
            const cost = parseFloat(entryForm.cost) || 0;
            const tax = parseFloat(entryForm.tax) || 0;

            if (cost > 0 && price > 0) {
                const netPrice = price / (1 + tax / 100);
                const newMargin = ((netPrice - cost) / cost) * 100;
                setEntryForm(prev => ({ ...prev, [name]: value, margin: newMargin.toFixed(2) }));
            } else {
                setEntryForm(prev => ({ ...prev, [name]: value }));
            }
        } else if (name === 'tax') {
            const tax = parseFloat(value) || 0;
            const cost = parseFloat(entryForm.cost) || 0;
            const margin = parseFloat(entryForm.margin) || 0;

            if (cost > 0) {
                const netPrice = cost * (1 + margin / 100);
                const finalPrice = netPrice * (1 + tax / 100);
                setEntryForm(prev => ({ ...prev, [name]: value, price: finalPrice.toFixed(0) }));
            } else {
                setEntryForm(prev => ({ ...prev, [name]: value }));
            }
        } else {
            setEntryForm(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleAddToInvoice = (e) => {
        e.preventDefault();
        if (!selectedProduct) return;

        const newItem = {
            id: selectedProduct.id,
            name: selectedProduct.name,
            sku: entryForm.sku,
            quantity: parseFloat(entryForm.quantity),
            cost: parseFloat(entryForm.cost),
            price: parseFloat(entryForm.price),
            tax: parseFloat(entryForm.tax),
            tax: parseFloat(entryForm.tax),
            total: parseFloat(entryForm.quantity) * parseFloat(entryForm.cost),
            total: parseFloat(entryForm.quantity) * parseFloat(entryForm.cost),
            expiryDate: entryForm.expiryDate || null,
            batchNumber: entryForm.batchNumber || null
        };

        setInvoiceItems([...invoiceItems, newItem]);

        // Reset Left
        setSelectedProduct(null);
        setSearchTerm('');
        setEntryForm({ cost: '', price: '', quantity: '1', margin: '', sku: '', tax: 0, expiryDate: '', batchNumber: '' });
    };

    const handleRemoveItem = (index) => {
        setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
    };

    const handleSavePurchase = async () => {
        if (!invoiceData.supplierId) {
            alert('Por favor selecciona un proveedor.');
            return;
        }
        if (invoiceItems.length === 0) {
            alert('Agrega productos a la compra.');
            return;
        }

        const supplier = suppliers.find(s => s.id === parseInt(invoiceData.supplierId));

        const purchase = {
            supplierId: parseInt(invoiceData.supplierId),
            supplierName: supplier ? supplier.name : 'Unknown',
            invoiceNumber: invoiceData.invoiceNumber,
            date: invoiceData.date,
            total: invoiceItems.reduce((sum, item) => sum + item.total, 0),
            items: invoiceItems,
            isCredit: invoiceData.isCredit,
            creditDays: invoiceData.creditDays ? parseInt(invoiceData.creditDays) : null,
            expiryDate: invoiceData.expiryDate,
            deposit: invoiceData.deposit ? parseFloat(invoiceData.deposit) : 0,
            paymentMethod: invoiceData.paymentMethod
        };

        const success = await addPurchase(purchase);
        if (success) {
            alert('Compra guardada exitosamente');
            setInvoiceItems([]);
            setInvoiceData({ ...invoiceData, invoiceNumber: '' });
        } else {
            alert('Error al guardar la compra');
        }
    };

    const handleCancel = () => {
        setSelectedProduct(null);
        setSearchTerm('');
        setEntryForm({ cost: '', price: '', quantity: '1', margin: '', sku: '', tax: 0, expiryDate: '', batchNumber: '' });
    };

    const handleSaveNewProduct = async (productData) => {
        await addProduct(productData);
        // Optionally auto-select the new product if needed, 
        // by finding it in the updated product list (might need a smarter way or just let user search it)
        // For now, just close modal and maybe set search term
        setSearchTerm(productData.name);
        setIsProductModalOpen(false);
    };

    const totalAmount = invoiceItems.reduce((sum, item) => sum + item.total, 0);

    return (
        <div className="h-[calc(100vh-6rem)] grid grid-cols-12 gap-6">
            <ProductModal
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                onSave={handleSaveNewProduct}
            />

            {/* Left Column: Product Entry (4 cols) */}
            <div className="col-span-12 lg:col-span-4 glass-card h-full flex flex-col">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4 border-b border-[var(--glass-border)] pb-2">Agregar Producto</h2>

                {/* Search */}
                <div className="relative mb-6 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar producto por nombre o código..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="glass-input w-full pl-10"
                        />
                        {searchTerm && !selectedProduct && filteredProducts.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] dark:bg-[#1a1c2e] border border-[var(--glass-border)] rounded-lg shadow-xl z-50 overflow-hidden">
                                {filteredProducts.map(product => (
                                    <button
                                        key={product.id}
                                        onClick={() => handleSelectProduct(product)}
                                        className="w-full text-left p-3 hover:bg-[var(--glass-bg)] flex justify-between items-center transition-colors border-b border-[var(--glass-border)] last:border-0"
                                    >
                                        <div>
                                            <div className="text-[var(--color-text)] font-medium">{product.name}</div>
                                            <div className="text-xs text-[var(--color-text-muted)]">{product.sku}</div>
                                        </div>
                                        <div className="text-[var(--color-primary)] font-bold">
                                            Stock: {product.stock}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setIsProductModalOpen(true)}
                        className="glass p-3 rounded-xl hover:bg-[var(--color-surface-hover)] text-[var(--color-primary)] border border-[var(--glass-border)]"
                        title="Crear Nuevo Producto"
                    >
                        <PackagePlus size={24} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleAddToInvoice} className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {selectedProduct ? (
                        <>
                            <div className="bg-[var(--glass-bg)] p-3 rounded-lg mb-4 border border-[var(--glass-border)] flex gap-3 items-center">
                                {/* Image Display */}
                                <div className="w-16 h-16 bg-[var(--glass-bg)] rounded-md overflow-hidden flex-shrink-0 border border-[var(--glass-border)] flex items-center justify-center">
                                    {selectedProduct.image ? (
                                        <img src={selectedProduct.image} alt={selectedProduct.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="text-xs text-[var(--color-text-muted)] text-center p-1 leading-tight">Sin Imagen</div>
                                    )}
                                </div>

                                <div>
                                    <span className="text-lg text-[var(--color-primary)] font-bold leading-tight line-clamp-2">
                                        {selectedProduct.name}
                                    </span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">SKU / Código</label>
                                <input
                                    type="text"
                                    name="sku"
                                    value={entryForm.sku}
                                    onChange={handleEntryChange}
                                    className="glass-input w-full"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Costo ($)</label>
                                    <input
                                        type="number"
                                        name="cost"
                                        value={entryForm.cost}
                                        onChange={handleEntryChange}
                                        className="glass-input w-full"
                                        required
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">IVA (%)</label>
                                    <input
                                        type="number"
                                        name="tax"
                                        value={entryForm.tax}
                                        onChange={handleEntryChange}
                                        className="glass-input w-full"
                                        placeholder="0"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Utilidad (%)</label>
                                    <input
                                        type="number"
                                        readOnly
                                        value={entryForm.margin}
                                        className="glass-input w-full bg-[var(--glass-bg)] text-[var(--color-text-muted)] cursor-not-allowed"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Precio Venta ($)</label>
                                    <input
                                        type="number"
                                        name="price"
                                        value={entryForm.price}
                                        onChange={handleEntryChange}
                                        className="glass-input w-full"
                                        required
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad a ingresar</label>
                                <input
                                    type="number"
                                    name="quantity"
                                    value={entryForm.quantity}
                                    onChange={handleEntryChange}
                                    className="glass-input w-full text-lg font-bold"
                                    required
                                    min="0.001"
                                    step="any"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1"># Lote</label>
                                    <input
                                        type="text"
                                        name="batchNumber"
                                        value={entryForm.batchNumber || ''}
                                        onChange={handleEntryChange}
                                        className="glass-input w-full"
                                        placeholder="# de lote"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Fecha de Vencimiento</label>
                                    <input
                                        type="date"
                                        name="expiryDate"
                                        value={entryForm.expiryDate || ''}
                                        onChange={handleEntryChange}
                                        className="glass-input w-full"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2 mt-4">
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="px-4 py-3 bg-white/10 hover:bg-white/20 text-[var(--color-text)] rounded-lg transition-colors flex-1"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary py-3 flex items-center justify-center gap-2 flex-1"
                                >
                                    <Plus size={20} /> Agregar a Factura
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-[var(--color-text-muted)] border border-dashed border-[var(--glass-border)] rounded-xl">
                            <Search size={32} className="mb-2 opacity-50" />
                            <p>Busca y selecciona un producto</p>
                        </div>
                    )}
                </form>
            </div>

            {/* Right Column: Invoice Details (8 cols) */}
            <div className="col-span-12 lg:col-span-8 h-full flex flex-col gap-4">
                {/* Header Info */}
                <div className="glass-card p-4">
                    <h2 className="text-lg font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                        <ShoppingCart size={20} className="text-[var(--color-primary)]" />
                        Detalles de la Compra
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Proveedor</label>
                            <select
                                value={invoiceData.supplierId}
                                onChange={(e) => setInvoiceData({ ...invoiceData, supplierId: e.target.value })}
                                className="glass-input w-full"
                            >
                                <option value="">Seleccionar Proveedor...</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id} className="bg-gray-200 text-gray-800 dark:bg-gray-900 dark:text-gray-200">{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">N° Factura</label>
                            <input
                                type="text"
                                value={invoiceData.invoiceNumber}
                                onChange={(e) => setInvoiceData({ ...invoiceData, invoiceNumber: e.target.value })}
                                className="glass-input w-full"
                                placeholder="#12345"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Fecha</label>
                            <input
                                type="date"
                                value={invoiceData.date}
                                onChange={(e) => setInvoiceData({ ...invoiceData, date: e.target.value })}
                                className="glass-input w-full"
                            />
                        </div>
                    </div>
                    {/* Payment Details */}
                    <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
                        <div className="flex items-center gap-4 mb-4">
                            <label className="flex items-center cursor-pointer gap-2">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        className="sr-only p-2"
                                        checked={invoiceData.isCredit}
                                        onChange={(e) => setInvoiceData({ ...invoiceData, isCredit: e.target.checked })}
                                    />
                                    <div className={`w-10 h-6 rounded-full transition-colors ${invoiceData.isCredit ? 'bg-[var(--color-primary)]' : 'bg-gray-600'}`}></div>
                                    <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${invoiceData.isCredit ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                </div>
                                <span className="text-[var(--color-text)] font-medium">¿Compra a Crédito?</span>
                            </label>
                        </div>

                        {invoiceData.isCredit ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Días de Plazo</label>
                                    <input
                                        type="number"
                                        value={invoiceData.creditDays}
                                        onChange={(e) => {
                                            const days = parseInt(e.target.value) || 0;
                                            const newDate = new Date(invoiceData.date);
                                            newDate.setDate(newDate.getDate() + days);
                                            setInvoiceData({
                                                ...invoiceData,
                                                creditDays: e.target.value,
                                                expiryDate: newDate.toISOString().split('T')[0]
                                            });
                                        }}
                                        className="glass-input w-full"
                                        placeholder="#"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Fecha de Caducidad</label>
                                    <input
                                        type="date"
                                        value={invoiceData.expiryDate}
                                        onChange={(e) => setInvoiceData({ ...invoiceData, expiryDate: e.target.value })}
                                        className="glass-input w-full"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Abono Inicial ($)</label>
                                    <input
                                        type="number"
                                        value={invoiceData.deposit}
                                        onChange={(e) => setInvoiceData({ ...invoiceData, deposit: e.target.value })}
                                        className="glass-input w-full"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Método de Pago</label>
                                <select
                                    value={invoiceData.paymentMethod}
                                    onChange={(e) => setInvoiceData({ ...invoiceData, paymentMethod: e.target.value })}
                                    className="glass-input w-full"
                                >
                                    <option value="Efectivo">Efectivo in Cash</option>
                                    <option value="Tarjeta">Tarjeta Débito/Crédito</option>
                                    <option value="Transferencia">Transferencia Bancaria</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Items Table */}
                <div className="glass-card flex-1 overflow-hidden flex flex-col p-0">
                    <div className="overflow-x-auto flex-1 custom-scrollbar">
                        <table className="w-full text-left">
                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-xs uppercase font-semibold sticky top-0 backdrop-blur-md">
                                <tr>
                                    <th className="px-4 py-3">Código</th>
                                    <th className="px-4 py-3">Producto</th>
                                    <th className="px-4 py-3 text-right">Cant.</th>
                                    <th className="px-4 py-3 text-right">Costo U.</th>
                                    <th className="px-4 py-3 text-right">Total</th>
                                    <th className="px-4 py-3 text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {invoiceItems.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-10 text-[var(--color-text-muted)]">
                                            No hay productos en la factura.
                                        </td>
                                    </tr>
                                ) : (
                                    invoiceItems.map((item, index) => (
                                        <tr key={index} className="hover:bg-[var(--glass-bg)] transition-colors">
                                            <td className="px-4 py-3 text-[var(--color-text-muted)] text-sm">{item.sku}</td>
                                            <td className="px-4 py-3 text-[var(--color-text)] font-medium">{item.name}</td>
                                            <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">{item.quantity}</td>
                                            <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">${item.cost.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right font-bold text-[var(--color-primary)]">
                                                ${item.total.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    onClick={() => handleRemoveItem(index)}
                                                    className="p-1 hover:bg-[var(--color-surface-hover)] rounded text-red-400 hover:text-red-300 transition-colors"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer Totals */}
                    <div className="bg-[var(--glass-bg)] p-4 border-t border-[var(--glass-border)] flex justify-between items-center">
                        <div>
                            <span className="text-[var(--color-text-muted)] text-sm">Items: {invoiceItems.length}</span>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="text-right">
                                <div className="text-sm text-[var(--color-text-muted)]">Total Factura</div>
                                <div className="text-3xl font-bold text-[var(--color-text)] neon-text">
                                    ${totalAmount.toLocaleString()}
                                </div>
                            </div>
                            <button
                                onClick={handleSavePurchase}
                                className="btn-primary py-3 px-8 flex items-center gap-2 shadow-lg hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all"
                            >
                                <Save size={20} /> Guardar Compra
                            </button>
                        </div>
                    </div>
                </div>
            </div >
        </div >
    );
};

export default Purchases;
