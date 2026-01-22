import React, { useState } from 'react';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, ImageOff } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import PaymentModal from '../components/PaymentModal';
import CashOpeningModal from '../components/CashOpeningModal';
import CashStatusWidget from '../components/CashStatusWidget';

const POS = () => {
    const { products, cart, addToCart, removeFromCart, clearCart, addSale, currentUser, cashRegister, checkRegisterStatus } = useStore();
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

    const finalTotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
    const taxTotal = cart.reduce((total, item) => {
        const itemTotal = item.price * item.quantity;
        const itemTax = item.tax_rate ? (itemTotal - (itemTotal / (1 + item.tax_rate / 100))) : 0;
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
                <div className="glass-card p-4 space-y-4 shrink-0">
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
                    className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8 content-start pb-20"
                    onScroll={handleScroll}
                >
                    {visibleProducts.map((product) => (
                        <button
                            key={product.id}
                            onClick={() => addToCart(product)}
                            className="glass-card p-4 flex flex-col items-start text-left group hover:scale-[1.02] transition-transform relative overflow-hidden h-full min-h-[340px]"
                        >
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity">
                                <span className="text-[var(--color-primary)]">+</span>
                            </div>
                            <div className="w-full aspect-[4/3] rounded-lg bg-white/5 mb-3 flex items-center justify-center overflow-hidden relative shrink-0 border border-white/5">
                                {product.image && product.image !== '[object Object]' && (product.image.startsWith('http') || product.image.startsWith('data:')) ? (
                                    <img
                                        src={product.image}
                                        alt={product.name}
                                        className="w-full h-full object-contain p-3 transition-transform duration-500 group-hover:scale-110"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.parentElement.classList.add('flex', 'flex-col', 'gap-2');

                                            // Create fallback content dynamically
                                            const icon = document.createElement('div');
                                            icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-off text-gray-500 mb-2 opacity-50"><line x1="2" x2="22" y1="2" y2="22"/><path d="M10.41 6.26l2.15 2.15 3.44-3.44 5 5V20a2 2 0 0 1-2 2h-9"/><path d="M4 13.5V4a2 2 0 0 1 2-2h8.5"/><path d="M4 19.5l3-3"/><path d="M14 14l2-2 2.5 2.5"/></svg>';
                                            const text = document.createElement('span');
                                            text.className = 'text-xs text-gray-500 font-medium uppercase tracking-wider opacity-50';
                                            text.innerText = 'Sin Imagen';

                                            e.target.parentElement.appendChild(icon.firstChild);
                                            e.target.parentElement.appendChild(text);
                                        }}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-2 w-full h-full">
                                        <ImageOff className="text-gray-500 opacity-50" size={40} />
                                        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider opacity-50">Sin Imagen</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col flex-1 w-full">
                                <h3 className="text-white font-bold text-base line-clamp-2 leading-tight mb-1 group-hover:text-[var(--color-primary)] transition-colors">
                                    {product.name}
                                </h3>
                                <p className="text-xs text-gray-400 mb-3 font-mono opacity-70">
                                    {product.sku || 'N/A'}
                                </p>

                                <div className="mt-auto w-full flex justify-between items-end pt-3 border-t border-white/5">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-400 mb-0.5">Precio</span>
                                        <span className="text-[var(--color-primary)] font-bold text-lg tracking-tight">
                                            ${product.price.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-xs text-gray-400 mb-0.5">Stock</span>
                                        <span className={cn(
                                            "font-medium px-2 py-0.5 rounded text-xs",
                                            product.stock < 10
                                                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                                : "bg-green-500/20 text-green-400 border border-green-500/30"
                                        )}>
                                            {product.stock} un.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Right Side: Cart */}
            <div className="w-full lg:w-[400px] flex flex-col glass-card p-0 overflow-hidden">
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
                        cart.map((item) => (
                            <div key={item.id} className="flex gap-4 p-3 rounded-xl bg-white/5 border border-white/5">
                                <div className="flex-1">
                                    <h4 className="text-white font-medium text-sm line-clamp-1">{item.name}</h4>
                                    <p className="text-[var(--color-primary)] font-bold text-sm">${item.price.toFixed(2)}</p>
                                    <p className="text-xs text-gray-500">
                                        {item.tax_rate ? `IVA ${item.tax_rate}%` : 'Exento'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-[var(--color-primary)] hover:text-black transition-colors"
                                        onClick={() => addToCart(item)}
                                    >
                                        <Plus size={14} />
                                    </button>
                                    <span className="text-white font-bold w-4 text-center">{item.quantity}</span>
                                    <button className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-red-500 hover:text-white transition-colors"
                                        onClick={() => removeFromCart(item.id)}
                                    >
                                        <Minus size={14} />
                                    </button>
                                </div>
                            </div>
                        ))
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
