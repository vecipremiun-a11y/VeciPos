import React, { useState } from 'react';
import { Search, Plus, Edit, Trash2, Filter } from 'lucide-react';
import { useStore } from '../store/useStore';
import ProductModal from '../components/ProductModal';

const Inventory = () => {
    const { products, addProduct, updateProduct, deleteProduct } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [displayLimit, setDisplayLimit] = useState(50);

    const filteredProducts = products.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Reset limit when search/filter changes
    React.useEffect(() => {
        setDisplayLimit(50);
    }, [searchTerm]);

    // Infinite Scroll Listener - Attached to MainLayout container
    React.useEffect(() => {
        const scrollContainer = document.querySelector('main');

        if (!scrollContainer) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

            // Check if user has scrolled near the bottom (100px buffer)
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                if (displayLimit < filteredProducts.length) {
                    setDisplayLimit(prev => prev + 50);
                }
            }
        };

        scrollContainer.addEventListener('scroll', handleScroll);
        return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }, [displayLimit, filteredProducts.length]);

    const visibleProducts = filteredProducts.slice(0, displayLimit);

    const handleEdit = (product) => {
        setEditingProduct(product);
        setIsModalOpen(true);
    };

    const handleDelete = (id) => {
        if (window.confirm('¿Estás seguro de eliminar este producto?')) {
            deleteProduct(id);
        }
    };

    const handleSaveProduct = (productData) => {
        if (editingProduct) {
            updateProduct(editingProduct.id, productData);
        } else {
            addProduct(productData);
        }
        setEditingProduct(null);
    };

    const handleNewProduct = () => {
        setEditingProduct(null);
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white neon-text">Inventario</h1>
                    <p className="text-gray-400">Gestión de productos y existencias</p>
                </div>
                <button onClick={handleNewProduct} className="btn-primary flex items-center gap-2">
                    <Plus size={20} /> Nuevo Producto
                </button>
            </div>

            {/* Filters & Search */}
            <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, SKU o categoría..."
                        className="glass-input pl-10 w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button className="glass px-4 py-3 rounded-lg hover:bg-white/10 transition-colors">
                    <Filter size={20} className="text-gray-300" />
                </button>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-gray-300 uppercase text-sm font-semibold">
                            <tr>
                                <th className="px-6 py-5">Producto</th>
                                <th className="px-6 py-5">Imagen</th>
                                <th className="px-6 py-5">Categoría</th>
                                <th className="px-6 py-5">SKU</th>
                                <th className="px-6 py-5">Precio</th>
                                <th className="px-6 py-5">Costo</th>
                                <th className="px-6 py-5">IVA</th>
                                <th className="px-6 py-5">Margen</th>
                                <th className="px-6 py-5">Stock</th>
                                <th className="px-6 py-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {visibleProducts.map((product) => (
                                <tr key={product.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-5 font-medium text-white text-lg">{product.name}</td>
                                    <td className="px-6 py-5">
                                        {product.image ? (
                                            <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/10">
                                                <img src={product.image} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className="w-16 h-16 rounded-lg bg-white/5 flex items-center justify-center text-sm text-gray-500">
                                                Img
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-5">
                                        <span className="px-3 py-1.5 rounded-full text-sm font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                                            {product.category}
                                        </span>
                                    </td>
                                    <td className="px-6 py-5 text-gray-400 font-mono text-base">{product.sku}</td>
                                    <td className="px-6 py-5 text-white font-bold text-xl">${product.price.toFixed(2)}</td>
                                    <td className="px-6 py-5 text-gray-400 text-lg">${(product.cost || 0).toFixed(2)}</td>
                                    <td className="px-6 py-5 text-gray-400 text-sm">
                                        {product.tax_rate > 0 ? `IVA (${product.tax_rate}%)` : 'Exento (0%)'}
                                    </td>
                                    <td className="px-6 py-5">
                                        {/* Margin Calculation Logic: (Net Price - Cost) / Cost */}
                                        {(() => {
                                            const taxRate = parseFloat(product.tax_rate) || 0;
                                            const netPrice = parseFloat(product.price) / (1 + taxRate / 100);
                                            const cost = parseFloat(product.cost) || 0;
                                            if (cost <= 0) return <span className="text-gray-500 text-lg">-</span>;

                                            const margin = ((netPrice - cost) / cost) * 100;
                                            const marginValue = netPrice - cost;

                                            return (
                                                <div className="flex flex-col">
                                                    <span className={cn("font-bold text-base", margin > 0 ? "text-green-400" : "text-red-400")}>
                                                        {margin.toFixed(1)}%
                                                    </span>
                                                    <span className="text-sm text-gray-500">
                                                        ${marginValue.toFixed(2)}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                    </td>
                                    <td className="px-6 py-5">
                                        <span className={cn(
                                            "font-bold text-lg",
                                            product.stock < 10 ? "text-red-400" : "text-green-400"
                                        )}>
                                            {product.stock}
                                        </span>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleEdit(product)}
                                                className="p-3 hover:bg-white/10 rounded-lg text-blue-400 transition-colors"
                                            >
                                                <Edit size={24} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(product.id)}
                                                className="p-3 hover:bg-white/10 rounded-lg text-red-400 transition-colors"
                                            >
                                                <Trash2 size={24} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredProducts.length === 0 && (
                        <div className="p-10 text-center text-gray-500">
                            No se encontraron productos
                        </div>
                    )}
                </div>
            </div>

            <ProductModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveProduct}
                productToEdit={editingProduct}
            />
        </div>
    );
};

// Simple utility for internal class merging if not imported from utils
function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}

export default Inventory;
