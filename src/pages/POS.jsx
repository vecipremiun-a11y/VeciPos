import React, { useState } from 'react';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote } from 'lucide-react';
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

    const [displayedLimit, setDisplayedLimit] = useState(200);

    // Check register status on mount
    React.useEffect(() => {
        if (currentUser) {
            checkRegisterStatus(currentUser.id);
        }
    }, [currentUser, checkRegisterStatus]);

    // Reset displayed limit when search or category changes
    React.useEffect(() => {
        setDisplayedLimit(200);
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
                setDisplayedLimit(prev => prev + 50);
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
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                {/* Search & Categories */}
                <div className="glass-card p-4 space-y-4">
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
                    className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 content-start"
                    onScroll={handleScroll}
                >
                    {visibleProducts.map((product) => (
                        <button
                            key={product.id}
                            onClick={() => addToCart(product)}
                            className="glass-card p-4 flex flex-col items-start text-left group hover:scale-[1.02] transition-transform relative overflow-hidden h-auto"
                        >
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity">
                                <span className="text-[var(--color-primary)]">+</span>
                            </div>
                            <div className="w-full aspect-square rounded-lg bg-black/20 mb-3 flex items-center justify-center overflow-hidden relative">
                                {product.image ? (
                                    <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                ) : (
                                    <span className="text-2xl font-bold text-gray-600">{product.name.charAt(0)}</span>
                                )}
                            </div>
                            <h3 className="text-white font-medium line-clamp-2 leading-tight mb-1">{product.name}</h3>
                            <p className="text-xs text-gray-400 mb-2">{product.sku}</p>
                            <div className="mt-auto w-full flex justify-between items-end">
                                <span className="text-[var(--color-primary)] font-bold text-lg">${product.price.toFixed(2)}</span>
                                <span className={cn("text-xs", product.stock < 10 ? "text-red-400" : "text-gray-500")}>
                                    Msg: {product.stock}
                                </span>
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
