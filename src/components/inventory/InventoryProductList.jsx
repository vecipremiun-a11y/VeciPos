import React from 'react';
import { Edit, Trash2 } from 'lucide-react';
import OptimizedImage from '../OptimizedImage';
import { cn } from '../../lib/utils';

const InventoryProductList = ({
    products,
    formatCurrency,
    currentCurrency,
    onEdit,
    onDelete,
    can,
    handleScroll
}) => {
    return (
        <div className="glass-card overflow-hidden p-0 flex-1 flex flex-col">
            {/* Mobile Card View */}
            <div className="lg:hidden flex-1 overflow-y-auto pb-20" onScroll={handleScroll}>
                {products.map((product) => (
                    <div
                        key={product.id}
                        className={cn(
                            "p-3 border-b border-[var(--glass-border)] flex items-center gap-3",
                            (product.is_offer === 1 || product.is_offer === true) ? "bg-yellow-500/5" : ""
                        )}
                    >
                        {/* Image */}
                        <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center justify-center">
                            <OptimizedImage
                                src={product.image}
                                alt={product.name}
                                className="w-full h-full object-cover"
                                priority={false}
                                fallback={
                                    <span className="text-xs text-[var(--color-text-muted)] font-medium">Img</span>
                                }
                            />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-2 mb-0.5">
                                {(product.is_offer === 1 || product.is_offer === true) && (
                                    <span className="text-[8px] bg-yellow-500 text-black px-1.5 py-0.5 rounded-full font-bold">OFERTA</span>
                                )}
                                <h3 className="text-sm font-bold text-[var(--color-text)] line-clamp-1">{product.name}</h3>
                            </div>
                            <p className="text-xs text-[var(--color-text-muted)] font-mono mb-1">{product.sku}</p>
                            <div className="flex items-center gap-3">
                                <span className="text-base font-bold text-green-400">{formatCurrency(product.price, currentCurrency)}</span>
                                <span className="text-xs text-[var(--color-text-muted)]">Costo: {formatCurrency(product.cost || 0, currentCurrency)}</span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1 shrink-0">
                            {can('products.edit') && (
                                <button
                                    onClick={() => onEdit(product)}
                                    className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg text-blue-400 transition-colors"
                                >
                                    <Edit size={18} />
                                </button>
                            )}
                            {can('products.delete') && (
                                <button
                                    onClick={() => onDelete(product.id)}
                                    className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg text-red-400 transition-colors"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                {products.length === 0 && (
                    <div className="p-10 text-center text-[var(--color-text-muted)]">
                        No se encontraron productos
                    </div>
                )}
            </div>

            {/* Desktop Table View */}
            <div
                className="hidden lg:block overflow-x-auto overflow-y-auto flex-1 custom-scrollbar"
                onScroll={handleScroll}
            >
                <table className="w-full text-left">
                    <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-sm font-semibold sticky top-0 backdrop-blur-md z-10">
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
                    <tbody className="divide-y divide-[var(--glass-border)]">
                        {products.map((product) => (
                            <tr key={product.id} className={cn(
                                "hover:bg-[var(--glass-bg)] transition-colors group",
                                (product.is_offer === 1 || product.is_offer === true) ? "bg-yellow-500/5 hover:bg-yellow-500/10" : ""
                            )}>
                                <td className="px-6 py-5 font-medium text-[var(--color-text)] text-lg flex items-center gap-2">
                                    {(product.is_offer === 1 || product.is_offer === true) && (
                                        <span className="text-[10px] bg-yellow-500 text-black px-2 py-0.5 rounded-full font-bold animate-pulse">
                                            OFERTA
                                        </span>
                                    )}
                                    {product.name}
                                </td>
                                <td className="px-6 py-5">
                                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center justify-center">
                                        <OptimizedImage
                                            src={product.image}
                                            alt={product.name}
                                            className="w-full h-full object-cover"
                                            priority={false}
                                            fallback={
                                                <span className="text-xs text-[var(--color-text-muted)] font-medium">Img</span>
                                            }
                                        />
                                    </div>
                                </td>
                                <td className="px-6 py-5">
                                    <span className="px-3 py-1.5 rounded-full text-sm font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                                        {product.category}
                                    </span>
                                </td>
                                <td className="px-6 py-5 text-[var(--color-text-muted)] font-mono text-base">{product.sku}</td>
                                <td className="px-6 py-5 text-[var(--color-text)] font-bold text-xl">{formatCurrency(product.price, currentCurrency)}</td>
                                <td className="px-6 py-5 text-[var(--color-text-muted)] text-lg">{formatCurrency(product.cost || 0, currentCurrency)}</td>
                                <td className="px-6 py-5 text-[var(--color-text-muted)] text-sm">
                                    {product.tax_rate > 0 ? `IVA(${product.tax_rate} %)` : 'Exento (0%)'}
                                </td>
                                <td className="px-6 py-5">
                                    {(() => {
                                        const taxRate = parseFloat(product.tax_rate) || 0;
                                        const netPrice = parseFloat(product.price) / (1 + taxRate / 100);
                                        const cost = parseFloat(product.cost) || 0;
                                        if (cost <= 0) return <span className="text-[var(--color-text-muted)] text-lg">-</span>;

                                        const margin = ((netPrice - cost) / cost) * 100;
                                        const marginValue = netPrice - cost;

                                        return (
                                            <div className="flex flex-col">
                                                <span className={cn("font-bold text-base", margin > 0 ? "text-green-400" : "text-red-400")}>
                                                    {margin.toFixed(1)}%
                                                </span>
                                                <span className="text-sm text-[var(--color-text-muted)]">
                                                    {formatCurrency(marginValue, currentCurrency)}
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
                                        {can('products.edit') && (
                                            <button
                                                onClick={() => onEdit(product)}
                                                className="p-3 hover:bg-[var(--color-surface-hover)] rounded-lg text-blue-400 transition-colors"
                                            >
                                                <Edit size={24} />
                                            </button>
                                        )}
                                        {can('products.delete') && (
                                            <button
                                                onClick={() => onDelete(product.id)}
                                                className="p-3 hover:bg-[var(--color-surface-hover)] rounded-lg text-red-400 transition-colors"
                                            >
                                                <Trash2 size={24} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {products.length === 0 && (
                    <div className="p-10 text-center text-[var(--color-text-muted)]">
                        No se encontraron productos
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(InventoryProductList);
