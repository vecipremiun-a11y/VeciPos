import React, { useState } from 'react';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, ImageOff } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import PaymentModal from '../components/PaymentModal';
import CashOpeningModal from '../components/CashOpeningModal';
import CashStatusWidget from '../components/CashStatusWidget';

const POS = () => {
    const { products, cart, addToCart, removeFromCart, clearCart, updateCartItem, addSale, currentUser, cashRegister, checkRegisterStatus } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('Todos');
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    const [displayedLimit, setDisplayedLimit] = useState(30);

    // Check register status on mount
    React.useEffect(() => {
        if (currentUser) {
            checkRegisterStatus(currentUser.id);
        }
    }, [currentUser, checkRegisterStatus]);

    // Reset displayed limit when search or category changes
    React.useEffect(() => {
        setDisplayedLimit(30);
    }, [searchTerm, selectedCategory]);

    const categories = ['Todos', ...new Set(products.map(p => p.category))];

    const filteredProducts = products.filter(product => {
        const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'Todos' || product.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const visibleProducts = filteredProducts.slice(0, displayedLimit);

    const handleScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 100) {
            if (displayedLimit < filteredProducts.length) {
                setDisplayedLimit(prev => prev + 30);
            }
        }
    };

    const finalTotal = cart.reduce((total, item) => {
        const itemTotal = item.price * item.quantity;
        const discountAmount = itemTotal * ((item.discountPercent || 0) / 100);
        return total + (itemTotal - discountAmount);
    }, 0);

    const taxTotal = cart.reduce((total, item) => {
        const itemTotal = item.price * item.quantity;
        const discountAmount = itemTotal * ((item.discountPercent || 0) / 100);
        const taxableAmount = itemTotal - discountAmount;

        const itemTax = item.tax_rate ? (taxableAmount - (taxableAmount / (1 + item.tax_rate / 100))) : 0;
        return total + itemTax;
    }, 0);
    const subTotal = finalTotal - taxTotal;

    const handleCheckoutClick = () => {
        if (cart.length === 0) return;
        setIsPaymentModalOpen(true);
    };

    const handlePaymentConfirm = (paymentData) => {
        addSale({
            items: cart,
            total: finalTotal,
            summary: `${cart.length} productos`,
            paymentMethod: paymentData.method,
            paymentDetails: paymentData
        });
        /* alert('¡Venta realizada con éxito!');  User flow suggests seamlessness, maybe a toast later? */
        clearCart();
        /* Modal closes automatically via its internal logic calling this handler then closing */
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-100px)]">
            <CashOpeningModal isOpen={!cashRegister && !!currentUser} />

            {/* Left Side: Product Grid */}
            <div className="flex-1 flex flex-col gap-4 overflow-hidden min-h-0">
                {/* Search & Categories */}
                <div className="glass-card p-4 space-y-4 shrink-0 relative z-50">
                    <div className="flex gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="text"
                                placeholder="Buscar productos..."
                                className="glass-input !pl-12 w-full"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <CashStatusWidget />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={cn(
                                    "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                                    selectedCategory === cat
                                        ? "bg-[var(--color-primary)] text-black shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                                        : "glass text-gray-300 hover:bg-white/10"
                                )}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Grid */}
                <div
                    className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 min-[1450px]:grid-cols-3 min-[1801px]:grid-cols-4 min-[2201px]:grid-cols-5 gap-4 content-start pb-20"
                    onScroll={handleScroll}
                >
                    {visibleProducts.map((product) => (
                        <div
                            key={product.id}
                            onClick={() => addToCart(product)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    addToCart(product);
                                }
                            }}
                            className="rounded-xl glass-card bg-card p-0 text-white shadow-sm cursor-pointer border border-white/10 hover:border-[var(--color-primary)] transition-all duration-150 flex flex-col h-auto hover:shadow-lg active:scale-95 touch-manipulation relative group"
                        >
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity z-10">
                                <span className={cn(
                                    "text-[var(--color-primary)] bg-black/50 rounded-full w-6 h-6 flex items-center justify-center text-sm",
                                    product.image ? "text-white" : "text-[var(--color-primary)]"
                                )}>+</span>
                            </div>

                            {/* Image Container - Full Width */}
                            <div className="w-full aspect-square bg-white/5 flex items-center justify-center overflow-hidden relative shrink-0 rounded-t-xl">
                                {product.image && product.image !== '[object Object]' && (product.image.startsWith('http') || product.image.startsWith('data:')) ? (
                                    <img
                                        src={product.image}
                                        alt={product.name}
                                        className="w-full h-full object-contain p-2 transition-transform duration-500 group-hover:scale-110"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.parentElement.classList.add('flex', 'flex-col', 'gap-2');

                                            // Create fallback content dynamically
                                            const icon = document.createElement('div');
                                            icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-off text-gray-500 mb-1 opacity-50"><line x1="2" x2="22" y1="2" y2="22"/><path d="M10.41 6.26l2.15 2.15 3.44-3.44 5 5V20a2 2 0 0 1-2 2h-9"/><path d="M4 13.5V4a2 2 0 0 1 2-2h8.5"/><path d="M4 19.5l3-3"/><path d="M14 14l2-2 2.5 2.5"/></svg>';
                                            const text = document.createElement('span');
                                            text.className = 'text-[10px] text-gray-500 font-medium uppercase tracking-wider opacity-50';
                                            text.innerText = 'Sin Imagen';

                                            e.target.parentElement.appendChild(icon.firstChild);
                                            e.target.parentElement.appendChild(text);
                                        }}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
                                        <ImageOff className="text-gray-500 opacity-50" size={40} />
                                        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider opacity-50">Sin Imagen</span>
                                    </div>
                                )}
                            </div>

                            {/* Content Wrapper - Padded */}
                            <div className="flex flex-col flex-1 w-full justify-between p-3">
                                <div>
                                    <h3 className="text-white font-bold text-sm line-clamp-2 leading-tight mb-1 group-hover:text-[var(--color-primary)] transition-colors">
                                        {product.name}
                                    </h3>

                                    <div className="mb-2">
                                        <span className="text-green-400 font-bold text-lg tracking-tight">
                                            ${product.price.toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                <div className="w-full flex justify-between items-center pt-2 border-t border-white/5">
                                    <span className={cn(
                                        "font-medium px-2 py-0.5 rounded text-[10px]",
                                        product.stock < 10
                                            ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                            : "bg-green-500/20 text-green-400 border border-green-500/30"
                                    )}>
                                        {product.stock} un.
                                    </span>
                                    <span className="text-[10px] text-gray-500 font-medium truncate max-w-[50%] text-right">
                                        {product.category || product.sku || 'General'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right Side: Cart */}
            <div className="w-full lg:w-[560px] flex flex-col glass-card p-0 overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-white/5">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <ShoppingCart size={20} className="text-[var(--color-primary)]" />
                        Ticket Actual
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                            <ShoppingCart size={48} className="opacity-20" />
                            <p>El carrito está vacío</p>
                        </div>
                    ) : (
                        cart.map((item) => {
                            const unitPrice = item.price;
                            const totalPrice = (unitPrice * item.quantity);
                            const discountPercent = item.discountPercent || 0;
                            const discountAmount = totalPrice * (discountPercent / 100);
                            const finalPrice = totalPrice - discountAmount;

                            const discountedUnitPrice = unitPrice * (1 - discountPercent / 100);

                            return (
                                <div key={item.id} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                                    {/* Row 1: Name and Remove */}
                                    <div className="flex justify-between items-start gap-2">
                                        <h4 className="text-white font-medium text-sm line-clamp-2">{item.name}</h4>
                                        <button
                                            className="text-gray-500 hover:text-red-400 transition-colors p-1"
                                            onClick={() => removeFromCart(item.id)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>

                                    {/* Row 2: Prices */}
                                    <div className="flex justify-between items-center text-xs text-gray-400">
                                        <div className="flex items-center gap-2">
                                            <span>Unit:</span>
                                            {discountPercent > 0 ? (
                                                <>
                                                    <span className="text-red-400 line-through text-[10px]">
                                                        ${unitPrice.toLocaleString('es-CL')}
                                                    </span>
                                                    <span className="text-green-400 font-bold">
                                                        ${discountedUnitPrice.toLocaleString('es-CL')}
                                                    </span>
                                                </>
                                            ) : (
                                                <span>${unitPrice.toLocaleString('es-CL')}</span>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-[var(--color-primary)] font-bold text-sm">
                                                Total: ${finalPrice.toLocaleString('es-CL')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Row 3: Controls */}
                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                                        {/* Discount Input */}
                                        <div className="flex items-center gap-1 bg-black/20 rounded-lg px-2 py-1.5 border border-white/5 w-24 group focus-within:border-[var(--color-primary)]/50 transition-colors">
                                            <span className="text-xs text-gray-500 font-bold group-focus-within:text-[var(--color-primary)]">%</span>
                                            <input
                                                type="number"
                                                placeholder="0"
                                                min="0"
                                                max="100"
                                                className="w-full bg-transparent text-sm text-white outline-none text-right font-bold"
                                                value={item.discountPercent || ''}
                                                onChange={(e) => {
                                                    let val = parseFloat(e.target.value);
                                                    if (isNaN(val)) val = 0;
                                                    if (val < 0) val = 0;
                                                    if (val > 100) val = 100;

                                                    updateCartItem(item.id, { discountPercent: val });
                                                }}
                                            />
                                        </div>

                                        {/* Quantity Controls */}
                                        <div className="flex items-center gap-4 bg-black/20 rounded-lg p-1.5 border border-white/5">
                                            <button
                                                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                                                onClick={() => {
                                                    if (item.quantity > 1) {
                                                        updateCartItem(item.id, { quantity: item.quantity - 1 });
                                                    } else {
                                                        removeFromCart(item.id);
                                                    }
                                                }}
                                            >
                                                <Minus size={18} />
                                            </button>
                                            <span className="text-white font-bold text-lg w-8 text-center">{item.quantity}</span>
                                            <button
                                                className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-black transition-colors"
                                                onClick={() => updateCartItem(item.id, { quantity: item.quantity + 1 })}
                                            >
                                                <Plus size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="p-4 border-t border-white/10 bg-black/20 space-y-4">
                    <div className="flex justify-between text-gray-400 text-sm">
                        <span>Subtotal (Neto)</span>
                        <span>${subTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-400 text-sm">
                        <span>Impuestos Total</span>
                        <span>${taxTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-white text-2xl font-bold pt-2 border-t border-white/10">
                        <span>Total</span>
                        <span className="neon-text">${finalTotal.toFixed(2)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button disabled={cart.length === 0} onClick={handleCheckoutClick} className="btn-primary col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl">
                            <Banknote size={20} />
                            Cobrar
                        </button>
                    </div>
                </div>
            </div>

            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                total={finalTotal}
                onConfirm={handlePaymentConfirm}
            />
        </div>
    );
};

export default POS;
