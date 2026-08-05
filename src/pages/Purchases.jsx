import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { Search, Plus, Save, Trash2, ShoppingCart, PackagePlus, Edit, X, ArrowLeft, Paperclip, ScanBarcode } from 'lucide-react';
import ProductModal from '../components/ProductModal';
import { usePermissions } from '../hooks/usePermissions';
import AsyncButton from '../components/AsyncButton';

const Purchases = () => {
    const { products, suppliers, addPurchase, addProduct, searchProductsForDropdown } = useStore();
    const { can } = usePermissions();
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const scannerRef = useRef(null);
    const scannerContainerId = 'purchases-barcode-scanner';

    useEffect(() => {
        if (!showCameraScanner) return;
        let scanner = null;
        (async () => {
            const { Html5Qrcode } = await import('html5-qrcode');
            scanner = new Html5Qrcode(scannerContainerId);
            scannerRef.current = scanner;
            await scanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 150 } },
                (decoded) => {
                    setSearchTerm(decoded);
                    setShowCameraScanner(false);
                },
                () => {}
            );
        })().catch(() => {});
        return () => {
            if (scanner && scanner.isScanning) scanner.stop().catch(() => {});
            scannerRef.current = null;
        };
    }, [showCameraScanner]);

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
        paymentMethod: 'Efectivo',
        observation: '',
        document: null
    });
    const [invoiceItems, setInvoiceItems] = useState([]);

    // Derived
    // Derived
    const [filteredProducts, setFilteredProducts] = useState([]);

    useEffect(() => {
        const search = async () => {
            if (searchTerm && !selectedProduct) {
                const results = await searchProductsForDropdown(searchTerm);
                setFilteredProducts(results);
            } else {
                setFilteredProducts([]);
            }
        };

        const timeoutId = setTimeout(search, 300);
        return () => clearTimeout(timeoutId);
    }, [searchTerm, selectedProduct, searchProductsForDropdown]);

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
        } else if (name === 'margin') {
            const margin = parseFloat(value) || 0;
            const cost = parseFloat(entryForm.cost) || 0;
            const tax = parseFloat(entryForm.tax) || 0;

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
            total: parseFloat(entryForm.quantity) * parseFloat(entryForm.cost),
            image: selectedProduct.image,
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

    const handleEditItem = (index) => {
        const itemToEdit = invoiceItems[index];

        const productForEdit = {
            id: itemToEdit.id,
            name: itemToEdit.name,
            sku: itemToEdit.sku,
            image: itemToEdit.image,
            cost: itemToEdit.cost,
            price: itemToEdit.price,
            tax_rate: itemToEdit.tax
        };

        let margin = '';
        if (itemToEdit.price && itemToEdit.cost > 0) {
            const netPrice = itemToEdit.price / (1 + itemToEdit.tax / 100);
            margin = (((netPrice - itemToEdit.cost) / itemToEdit.cost) * 100).toFixed(2);
        }

        setSelectedProduct(productForEdit);
        // We set searchTerm to the name so it fills the input, 
        // but we might want to avoid triggering a new search or just let it be.
        setSearchTerm(itemToEdit.name);

        setEntryForm({
            sku: itemToEdit.sku,
            cost: itemToEdit.cost,
            price: itemToEdit.price,
            quantity: itemToEdit.quantity,
            margin: margin,
            tax: itemToEdit.tax,
            expiryDate: itemToEdit.expiryDate || '',
            batchNumber: itemToEdit.batchNumber || ''
        });

        // Remove from list so it doesn't duplicate when re-added
        handleRemoveItem(index);
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

        // Convert document file to base64 if exists
        let documentBase64 = null;
        if (invoiceData.document) {
            try {
                documentBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(invoiceData.document);
                });
            } catch (err) {
                console.error('Error converting document to base64:', err);
            }
        }

        const purchase = {
            supplierId: parseInt(invoiceData.supplierId),
            supplierName: supplier ? supplier.name : 'Unknown',
            invoiceNumber: invoiceData.invoiceNumber,
            date: invoiceData.date,
            total: invoiceItems.reduce((sum, item) => sum + item.total + (item.total * (item.tax / 100)), 0),
            items: invoiceItems,
            isCredit: invoiceData.isCredit,
            creditDays: invoiceData.creditDays ? parseInt(invoiceData.creditDays) : null,
            expiryDate: invoiceData.expiryDate,
            deposit: invoiceData.deposit ? parseFloat(invoiceData.deposit) : 0,
            paymentMethod: invoiceData.paymentMethod,
            observation: invoiceData.observation || null,
            document: documentBase64
        };

        const success = await addPurchase(purchase);
        if (success) {
            alert('Compra guardada exitosamente');
            setInvoiceItems([]);
            setInvoiceData({ ...invoiceData, invoiceNumber: '', observation: '', document: null });
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

    const subtotal = invoiceItems.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
    const taxAmount = invoiceItems.reduce((sum, item) => sum + ((parseFloat(item.total) || 0) * ((parseFloat(item.tax) || 0) / 100)), 0);
    const totalAmount = subtotal + taxAmount;

    return (
        <>
            {/* Mobile View */}
            <div className="lg:hidden min-h-screen pb-24">
                {/* Mobile Header */}
                <div className="flex items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold text-[var(--color-text)]">Compras</h1>
                </div>

                {/* Mobile Product Entry */}
                <div className="glass-card">
                    <h2 className="text-lg font-bold text-[var(--color-text)] mb-4">Agregar Producto</h2>

                    {/* Search */}
                    <div className="relative mb-4 flex gap-2">
                        <button
                            onClick={() => setShowCameraScanner(true)}
                            className="lg:hidden glass p-3 rounded-xl text-[var(--color-primary)] border border-[var(--glass-border)]"
                            title="Escanear código"
                        >
                            <ScanBarcode size={20} />
                        </button>
                        <div className="relative flex-1">
                            <input
                                type="text"
                                placeholder="Buscar producto..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="glass-input w-full"
                            />
                            {searchTerm && !selectedProduct && filteredProducts.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                                    {filteredProducts.map(product => (
                                        <button
                                            key={product.id}
                                            onClick={() => handleSelectProduct(product)}
                                            className="w-full text-left p-3 hover:bg-[var(--glass-bg)] border-b border-[var(--glass-border)] last:border-0"
                                        >
                                            <div className="text-[var(--color-text)] font-medium text-sm">{product.name}</div>
                                            <div className="text-xs text-[var(--color-text-muted)]">{product.sku}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {can('products.create') && (
                            <button
                                onClick={() => setIsProductModalOpen(true)}
                                className="glass p-3 rounded-xl text-[var(--color-primary)] border border-[var(--glass-border)]"
                            >
                                <PackagePlus size={20} />
                            </button>
                        )}
                    </div>

                    {selectedProduct ? (
                        <form onSubmit={handleAddToInvoice} className="space-y-3">
                            {/* Selected Product Display */}
                            <div className="bg-[var(--glass-bg)] p-3 rounded-lg border border-[var(--glass-border)] flex gap-3 items-center">
                                <div className="w-14 h-14 bg-[var(--glass-bg)] rounded-md overflow-hidden flex-shrink-0 border border-[var(--glass-border)] flex items-center justify-center">
                                    {selectedProduct.image ? (
                                        <img src={selectedProduct.image} alt={selectedProduct.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="text-[10px] text-[var(--color-text-muted)] text-center">Sin Imagen</div>
                                    )}
                                </div>
                                <div>
                                    <span className="text-[var(--color-primary)] font-bold text-sm line-clamp-2">{selectedProduct.name}</span>
                                    <div className="text-xs text-[var(--color-text-muted)]">{entryForm.sku}</div>
                                </div>
                            </div>

                            {/* SKU and Cost */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">SKU / Código</label>
                                    <input type="text" name="sku" value={entryForm.sku} onChange={handleEntryChange} className="glass-input w-full text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Costo ($)</label>
                                    <input type="number" name="cost" value={entryForm.cost} onChange={handleEntryChange} className="glass-input w-full text-sm" required min="0" step="0.01" />
                                </div>
                            </div>

                            {/* IVA and Margin */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">IVA</label>
                                    <select name="tax" value={entryForm.tax} onChange={handleEntryChange} className="glass-input w-full text-sm">
                                        <option value="0">Exento (0%)</option>
                                        <option value="19">IVA (19%)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Utilidad (%)</label>
                                    <input type="number" name="margin" value={entryForm.margin} onChange={handleEntryChange} className="glass-input w-full text-sm" />
                                </div>
                            </div>

                            {/* Precio Venta */}
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Precio Venta ($)</label>
                                <input type="number" name="price" value={entryForm.price} onChange={handleEntryChange} className="glass-input w-full text-sm" />
                            </div>

                            {/* Quantity */}
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Cantidad a ingresar</label>
                                <input type="number" name="quantity" value={entryForm.quantity} onChange={handleEntryChange} className="glass-input w-full text-sm font-bold" min="0.001" step="any" />
                            </div>

                            {/* Batch and Expiry */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1"># Lote</label>
                                    <input type="text" name="batchNumber" value={entryForm.batchNumber || ''} onChange={handleEntryChange} className="glass-input w-full text-sm" placeholder="# de lote" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Fecha de Vencimiento</label>
                                    <input type="date" name="expiryDate" value={entryForm.expiryDate || ''} onChange={handleEntryChange} className="glass-input w-full text-sm" />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={handleCancel} className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-[var(--color-text)] rounded-lg text-sm">
                                    Cancelar
                                </button>
                                <button type="submit" className="flex-1 py-3 btn-primary flex items-center justify-center gap-2 text-sm">
                                    <Plus size={18} /> Agregar a Factura
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-[var(--color-text-muted)] border border-dashed border-[var(--glass-border)] rounded-xl">
                            <Search size={28} className="mb-2 opacity-50" />
                            <p className="text-sm">Busca y selecciona un producto</p>
                        </div>
                    )}
                </div>

                {/* Fixed Bottom Button */}
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-[var(--color-surface)]/95 backdrop-blur-md border-t border-[var(--glass-border)] z-40">
                    <button
                        onClick={() => setIsMobileDetailsOpen(true)}
                        className="w-full py-4 btn-primary text-base font-bold flex items-center justify-center gap-2"
                    >
                        <ShoppingCart size={20} />
                        Detalles de Compra {invoiceItems.length > 0 && `(${invoiceItems.length})`}
                    </button>
                </div>
            </div>

            {/* Mobile Details Modal */}
            {isMobileDetailsOpen && (
                <div className="lg:hidden fixed inset-0 bg-[var(--color-surface)] z-50 overflow-y-auto">
                    {/* Modal Header */}
                    <div className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--glass-border)] p-4 flex items-center gap-3 z-10">
                        <button onClick={() => setIsMobileDetailsOpen(false)} className="text-[var(--color-primary)]">
                            <ArrowLeft size={24} />
                        </button>
                        <h2 className="text-lg font-bold text-[var(--color-text)]">Detalles de la Compra</h2>
                    </div>

                    <div className="p-4 pb-32 space-y-4">
                        {/* Invoice Info Card */}
                        <div className="glass-card space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-[var(--color-text)] mb-2">Proveedor</label>
                                <select value={invoiceData.supplierId} onChange={(e) => setInvoiceData({ ...invoiceData, supplierId: e.target.value })} className="glass-input w-full">
                                    <option value="">Seleccionar Proveedor...</option>
                                    {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">N° Factura</label>
                                <input type="text" value={invoiceData.invoiceNumber} onChange={(e) => setInvoiceData({ ...invoiceData, invoiceNumber: e.target.value })} className="glass-input w-full" placeholder="#12345" />
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Método de Pago</label>
                                <select value={invoiceData.paymentMethod} onChange={(e) => setInvoiceData({ ...invoiceData, paymentMethod: e.target.value })} className="glass-input w-full">
                                    <option value="Efectivo">Efectivo / Cash</option>
                                    <option value="Tarjeta">Tarjeta</option>
                                    <option value="Transferencia">Transferencia</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Comprobante (opcional)</label>
                                <label className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-dashed border-[var(--glass-border)] rounded-lg cursor-pointer">
                                    <Paperclip size={16} className="text-[var(--color-text-muted)]" />
                                    <span className="text-sm text-[var(--color-text-muted)] truncate flex-1">
                                        {invoiceData.document ? invoiceData.document.name : 'Adjuntar imagen o documento'}
                                    </span>
                                    {invoiceData.document && (
                                        <button type="button" onClick={(e) => { e.preventDefault(); setInvoiceData({ ...invoiceData, document: null }); }} className="text-red-400">
                                            <X size={16} />
                                        </button>
                                    )}
                                    <input
                                        type="file"
                                        accept="image/*,.pdf"
                                        onChange={(e) => setInvoiceData({ ...invoiceData, document: e.target.files?.[0] || null })}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                            <div>
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Observación (opcional)</label>
                                <textarea
                                    value={invoiceData.observation}
                                    onChange={(e) => setInvoiceData({ ...invoiceData, observation: e.target.value })}
                                    placeholder="Notas de la compra..."
                                    className="glass-input w-full resize-none h-16 text-sm"
                                />
                            </div>
                        </div>

                        {/* Items Table - Mobile */}
                        <div className="glass-card p-0 overflow-hidden">
                            <div className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-[10px] uppercase font-bold px-3 py-2">
                                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-center">
                                    <div className="w-20">CÓDIGO</div>
                                    <div>PRODUCTO</div>
                                    <div className="w-10 text-center">CANT.</div>
                                    <div className="w-14 text-right">COSTO U.</div>
                                    <div className="w-10 text-center">IVA</div>
                                </div>
                            </div>
                            <div className="divide-y divide-[var(--glass-border)]">
                                {invoiceItems.length === 0 ? (
                                    <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">No hay productos en la factura.</div>
                                ) : (
                                    invoiceItems.map((item, index) => (
                                        <div key={index} className="px-3 py-3">
                                            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-center text-sm">
                                                <div className="w-20 text-[var(--color-text-muted)] text-xs truncate">{item.sku}</div>
                                                <div className="text-[var(--color-text)] font-medium truncate">{item.name}</div>
                                                <div className="w-10 text-center text-[var(--color-text-muted)]">{item.quantity}</div>
                                                <div className="w-14 text-right text-[var(--color-text-muted)]">${item.cost.toLocaleString()}</div>
                                                <div className="w-10 text-center text-[var(--color-text-muted)]">{item.tax}%</div>
                                            </div>
                                            <div className="flex justify-end gap-2 mt-2">
                                                <button onClick={() => { handleEditItem(index); setIsMobileDetailsOpen(false); }} className="p-1.5 text-blue-400"><Edit size={16} /></button>
                                                <button onClick={() => handleRemoveItem(index)} className="p-1.5 text-red-400"><Trash2 size={16} /></button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Fixed Footer with Totals */}
                    <div className="fixed bottom-0 left-0 right-0 bg-[var(--glass-bg)] border-t border-[var(--glass-border)] p-4">
                        <div className="text-right mb-3 space-y-1">
                            <div className="text-xs text-[var(--color-text-muted)]">Subtotal: ${subtotal.toLocaleString()}</div>
                            <div className="text-xs text-green-400">IVA 19%: ${taxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">Total Factura:</div>
                            <div className="text-2xl font-bold text-[var(--color-primary)]">${totalAmount.toLocaleString()}</div>
                        </div>
                        {can('purchases.create') && (
                            <AsyncButton
                                onClick={handleSavePurchase}
                                icon={<Save size={20} />}
                                loadingText="Guardando…"
                                className="w-full py-4 btn-primary flex items-center justify-center gap-2 text-base font-bold"
                            >
                                Guardar Compra
                            </AsyncButton>
                        )}
                    </div>
                </div>
            )}

            {/* Desktop View */}
            <div className="hidden lg:grid h-[calc(100vh-6rem)] grid-cols-12 gap-6">
                {/* Left Column: Product Entry (4 cols) */}
                <div className="col-span-4 glass-card h-full flex flex-col">
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
                                className="glass-input w-full !pl-10"
                            />
                            {searchTerm && !selectedProduct && filteredProducts.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] dark:bg-[#1a1c2e] border border-[var(--glass-border)] rounded-lg shadow-xl z-50 max-h-[400px] overflow-y-auto custom-scrollbar">
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
                        {can('products.create') && (
                            <button
                                onClick={() => setIsProductModalOpen(true)}
                                className="glass p-3 rounded-xl hover:bg-[var(--color-surface-hover)] text-[var(--color-primary)] border border-[var(--glass-border)]"
                                title="Crear Nuevo Producto"
                            >
                                <PackagePlus size={24} />
                            </button>
                        )}
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
                                        <select
                                            name="tax"
                                            value={entryForm.tax}
                                            onChange={handleEntryChange}
                                            className="glass-input w-full"
                                        >
                                            <option value="0">Exento (0%)</option>
                                            <option value="19">IVA (19%)</option>
                                        </select>

                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Utilidad (%)</label>
                                        <input
                                            type="number"
                                            name="margin"
                                            value={entryForm.margin}
                                            onChange={handleEntryChange}
                                            className="glass-input w-full"
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
                                <div className="flex gap-4 items-end">
                                    <div className="flex-1">
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
                                    <div>
                                        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Comprobante</label>
                                        <label className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-surface)] border border-dashed border-[var(--glass-border)] rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                                            <Paperclip size={18} className="text-[var(--color-text-muted)]" />
                                            <span className="text-sm text-[var(--color-text-muted)] truncate max-w-[150px]">
                                                {invoiceData.document ? invoiceData.document.name : 'Adjuntar'}
                                            </span>
                                            <input
                                                type="file"
                                                accept="image/*,.pdf"
                                                onChange={(e) => setInvoiceData({ ...invoiceData, document: e.target.files?.[0] || null })}
                                                className="hidden"
                                            />
                                        </label>
                                    </div>
                                    {invoiceData.document && (
                                        <button
                                            onClick={() => setInvoiceData({ ...invoiceData, document: null })}
                                            className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                            title="Quitar documento"
                                        >
                                            <X size={18} />
                                        </button>
                                    )}
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
                                        <th className="px-4 py-3 text-center">IVA</th>
                                        <th className="px-4 py-3 text-right">Subtotal</th>
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
                                                <td className="px-4 py-3 text-center text-[var(--color-text-muted)]">{item.tax}%</td>
                                                <td className="px-4 py-3 text-right font-bold text-[var(--color-primary)]">
                                                    ${item.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-4 py-3 text-center flex justify-center gap-2">
                                                    <button
                                                        onClick={() => handleEditItem(index)}
                                                        className="p-1 hover:bg-[var(--color-surface-hover)] rounded text-blue-400 hover:text-blue-300 transition-colors"
                                                        title="Editar"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleRemoveItem(index)}
                                                        className="p-1 hover:bg-[var(--color-surface-hover)] rounded text-red-400 hover:text-red-300 transition-colors"
                                                        title="Eliminar"
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
                        <div className="bg-[var(--glass-bg)] p-4 border-t border-[var(--glass-border)]">
                            {/* Observation Row */}
                            <div className="mb-4">
                                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Observación de la compra (opcional)</label>
                                <textarea
                                    value={invoiceData.observation}
                                    onChange={(e) => setInvoiceData({ ...invoiceData, observation: e.target.value })}
                                    placeholder="Notas adicionales sobre la compra..."
                                    className="glass-input w-full resize-none h-16 text-sm"
                                />
                            </div>
                            {/* Totals Row */}
                            <div className="flex justify-between items-center gap-4">
                                <div>
                                    <span className="text-[var(--color-text-muted)] text-sm">Items: {invoiceItems.length}</span>
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <div className="text-xs text-[var(--color-text-muted)]">Subtotal (Neto): ${subtotal.toLocaleString()}</div>
                                        <div className="text-xs text-green-400">Total IVA: ${taxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                                        <div className="text-sm text-[var(--color-text-muted)] mt-1">Total Factura</div>
                                        <div className="text-3xl font-bold text-[var(--color-text)] neon-text">
                                            ${totalAmount.toLocaleString()}
                                        </div>
                                    </div>
                                    {can('purchases.create') && (
                                        <AsyncButton
                                            onClick={handleSavePurchase}
                                            icon={<Save size={20} />}
                                            loadingText="Guardando…"
                                            className="btn-primary py-3 px-8 flex items-center gap-2 shadow-lg hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all"
                                        >
                                            Guardar Compra
                                        </AsyncButton>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ProductModal - shared by both views */}
            <ProductModal
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                onSave={handleSaveNewProduct}
            />

            {showCameraScanner && (
                <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-sm overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
                            <h3 className="font-bold text-[var(--color-text)]">Escanear Código</h3>
                            <button onClick={() => setShowCameraScanner(false)} className="text-[var(--color-text-muted)]">
                                <X size={20} />
                            </button>
                        </div>
                        <div id={scannerContainerId} className="w-full" />
                    </div>
                </div>
            )}
        </>
    );
};

export default Purchases;


