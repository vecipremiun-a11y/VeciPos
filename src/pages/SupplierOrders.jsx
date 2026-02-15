import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { usePermissions } from '../hooks/usePermissions'; // Import usePermissions
import { Search, Filter, Calendar, Eye, Package, ArrowLeft, Trash2, Share2, Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrency } from '../utils/formatCurrency';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const SupplierOrders = () => {
    const { fetchSupplierOrders, deleteSupplierOrder, suppliers, currentCurrency } = useStore(); // Add deleteSupplierOrder
    const { can } = usePermissions(); // Helper for permissions
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Detail Modal State
    const [selectedOrder, setSelectedOrder] = useState(null);

    useEffect(() => {
        loadOrders();
    }, [selectedSupplier, statusFilter]);



    const handleDelete = async (id) => {
        if (!confirm('¿Estás seguro de eliminar este pedido? Esta acción no se puede deshacer.')) return;

        const res = await deleteSupplierOrder(id);
        if (res.success) {
            loadOrders(); // Refresh list
        } else {
            alert('Error al eliminar el pedido: ' + (res.error || 'Desconocido'));
        }
    };

    const handleDownloadPDF = (order) => {
        const doc = new jsPDF();

        // Header
        doc.setFontSize(18);
        doc.text('Orden de Compra', 14, 22);

        doc.setFontSize(10);
        doc.text(`ID Pedido: #${order.id}`, 14, 30);
        doc.text(`Fecha: ${formatDate(order.created_at)}`, 14, 35);
        doc.text(`Estado: ${order.status.toUpperCase()}`, 14, 40);

        // Supplier Info
        doc.setFontSize(12);
        doc.text('Proveedor:', 14, 50);
        doc.setFontSize(10);
        doc.text(order.supplier_name || 'N/A', 14, 56);
        if (order.seller_name) doc.text(`Vendedor: ${order.seller_name}`, 14, 61);

        // Items Table
        const tableColumn = ["Producto", "SKU", "Cant.", "Costo", "Total"];
        const tableRows = [];

        order.items.forEach(item => {
            const itemData = [
                item.name,
                item.sku,
                item.quantity,
                formatCurrency(item.cost, currentCurrency),
                formatCurrency(item.total, currentCurrency)
            ];
            tableRows.push(itemData);
        });

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 70,
        });

        // Totals
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.text(`Total: ${formatCurrency(order.total_amount, currentCurrency)}`, 14, finalY);

        // Save
        doc.save(`Pedido_${order.id}_${order.supplier_name}.pdf`);
    };

    const handleShareWhatsApp = (order) => {
        const itemsList = order.items.map(i => `- ${i.quantity}x ${i.name}`).join('%0A');
        const text = `*Orden de Compra #${order.id}*%0A%0A` +
            `*Proveedor:* ${order.supplier_name}%0A` +
            `*Fecha:* ${formatDate(order.created_at)}%0A` +
            `*Total:* ${formatCurrency(order.total_amount, currentCurrency)}%0A%0A` +
            `*Productos Solicitados:*%0A${itemsList}`;

        window.open(`https://wa.me/?text=${text}`, '_blank');
    };

    const loadOrders = async () => {
        setIsLoading(true);
        const filters = {};
        if (selectedSupplier) filters.supplier_id = Number(selectedSupplier);
        if (statusFilter) filters.status = statusFilter;

        const data = await fetchSupplierOrders(filters);
        setOrders(data);
        setIsLoading(false);
    };

    const filteredOrders = orders.filter(order => {
        if (!searchTerm) return true;
        const searchLower = searchTerm.toLowerCase();
        return (
            order.supplier_name?.toLowerCase().includes(searchLower) ||
            order.id.toString().includes(searchLower)
        );
    });



    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: es });
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'pending':
                return <span className="px-2 py-1 rounded bg-yellow-500/20 text-yellow-400 text-xs font-bold uppercase">Pendiente</span>;
            case 'received':
                return <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-bold uppercase">Recibido</span>;
            case 'cancelled':
                return <span className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs font-bold uppercase">Cancelado</span>;
            default:
                return <span className="px-2 py-1 rounded bg-gray-500/20 text-gray-400 text-xs font-bold uppercase">{status}</span>;
        }
    };

    return (
        <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold neon-text">Pedidos Realizados</h1>
                    <p className="text-[var(--color-text-muted)]">Historial de órdenes de compra a proveedores</p>
                </div>
            </div>

            {/* Filters */}
            <div className="glass p-4 rounded-xl flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por proveedor o ID..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] transition-all"
                    />
                </div>

                <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="p-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] min-w-[200px]"
                >
                    <option value="">Todos los Proveedores</option>
                    {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="p-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] min-w-[150px]"
                >
                    <option value="">Todos los Estados</option>
                    <option value="pending">Pendiente</option>
                    <option value="received">Recibido</option>
                    <option value="cancelled">Cancelado</option>
                </select>
            </div>

            {/* Orders List */}
            <div className="flex-1 glass rounded-xl overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                            <tr>
                                <th className="p-4 text-left font-semibold text-[var(--color-text-muted)]">ID</th>
                                <th className="p-4 text-left font-semibold text-[var(--color-text-muted)]">Proveedor</th>
                                <th className="p-4 text-left font-semibold text-[var(--color-text-muted)]">Vendedor</th>
                                <th className="p-4 text-left font-semibold text-[var(--color-text-muted)]">Fecha Creación</th>
                                <th className="p-4 text-left font-semibold text-[var(--color-text-muted)]">Fecha Llegada</th>
                                <th className="p-4 text-right font-semibold text-[var(--color-text-muted)]">Total</th>
                                <th className="p-4 text-center font-semibold text-[var(--color-text-muted)]">Estado</th>
                                <th className="p-4 text-center font-semibold text-[var(--color-text-muted)]">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="8" className="p-8 text-center">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)] mx-auto mb-3"></div>
                                        <p className="text-[var(--color-text-muted)]">Cargando pedidos...</p>
                                    </td>
                                </tr>
                            ) : filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="p-8 text-center text-[var(--color-text-muted)]">
                                        <Package className="mx-auto mb-3 opacity-20" size={48} />
                                        <p>No se encontraron pedidos</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredOrders.map((order) => (
                                    <tr key={order.id} className="hover:bg-[var(--glass-bg)] transition-colors">
                                        <td className="p-4 text-[var(--color-text-muted)]">#{order.id}</td>
                                        <td className="p-4 font-medium">{order.supplier_name}</td>
                                        <td className="p-4 text-sm">{order.seller_name || '-'}</td>
                                        <td className="p-4 text-sm">{formatDate(order.created_at)}</td>
                                        <td className="p-4 text-sm">{order.expected_delivery_date ? format(new Date(order.expected_delivery_date), 'dd/MM/yyyy') : '-'}</td>
                                        <td className="p-4 text-right font-bold text-[var(--color-primary)]">{formatCurrency(order.total_amount, currentCurrency)}</td>
                                        <td className="p-4 text-center">{getStatusBadge(order.status)}</td>
                                        <td className="p-4 flex justify-center gap-2">
                                            <button
                                                onClick={() => setSelectedOrder(order)}
                                                className="p-2 hover:bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded-lg transition-colors"
                                                title="Ver Detalle"
                                            >
                                                <Eye size={18} />
                                            </button>

                                            {can('supplier_orders.delete') && (
                                                <button
                                                    onClick={() => handleDelete(order.id)}
                                                    className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                                                    title="Eliminar Pedido"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Order Detail Modal */}
            {selectedOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-[var(--glass-border)] animate-in zoom-in-50 duration-200">
                        {/* Header */}
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-[var(--color-text)]">Detalle Pedido #{selectedOrder.id}</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">{selectedOrder.supplier_name}</p>
                            </div>
                            <button
                                onClick={() => setSelectedOrder(null)}
                                className="p-2 hover:bg-[var(--glass-bg)] rounded-lg transition-colors"
                            >
                                <span className="text-2xl text-[var(--color-text-muted)]">×</span>
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* Info Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                    <p className="text-[var(--color-text-muted)] text-xs mb-1">Estado</p>
                                    <div>{getStatusBadge(selectedOrder.status)}</div>
                                </div>
                                <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                    <p className="text-[var(--color-text-muted)] text-xs mb-1">Fecha Llegada</p>
                                    <p className="font-medium">{selectedOrder.expected_delivery_date ? format(new Date(selectedOrder.expected_delivery_date), 'dd/MM/yyyy') : '-'}</p>
                                </div>
                                <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                    <p className="text-[var(--color-text-muted)] text-xs mb-1">Vendedor</p>
                                    <p className="font-medium">{selectedOrder.seller_name || '-'}</p>
                                </div>
                                <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                    <p className="text-[var(--color-text-muted)] text-xs mb-1">Total</p>
                                    <p className="font-bold text-[var(--color-primary)]">{formatCurrency(selectedOrder.total_amount, currentCurrency)}</p>
                                </div>
                            </div>

                            {/* Items Table */}
                            <div>
                                <h3 className="font-bold mb-3 text-[var(--color-text)]">Productos Solicitados</h3>
                                <div className="overflow-hidden rounded-xl border border-[var(--glass-border)]">
                                    <table className="w-full text-sm">
                                        <thead className="bg-[var(--glass-bg)]">
                                            <tr>
                                                <th className="p-3 text-left font-medium text-[var(--color-text-muted)]">Producto</th>
                                                <th className="p-3 text-center font-medium text-[var(--color-text-muted)]">Cant.</th>
                                                <th className="p-3 text-right font-medium text-[var(--color-text-muted)]">Costo</th>
                                                <th className="p-3 text-right font-medium text-[var(--color-text-muted)]">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--glass-border)]">
                                            {selectedOrder.items.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-[var(--glass-bg)]">
                                                    <td className="p-3">
                                                        <p className="font-medium">{item.name}</p>
                                                        <p className="text-xs text-[var(--color-text-muted)]">{item.sku}</p>
                                                    </td>
                                                    <td className="p-3 text-center font-bold">{item.quantity}</td>
                                                    <td className="p-3 text-right text-[var(--color-text-muted)]">{formatCurrency(item.cost, currentCurrency)}</td>
                                                    <td className="p-3 text-right font-bold">{formatCurrency(item.total, currentCurrency)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-[var(--glass-bg)]">
                                            <tr>
                                                <td colSpan="3" className="p-3 text-right font-bold">Total Pedido</td>
                                                <td className="p-3 text-right font-bold text-[var(--color-primary)]">{formatCurrency(selectedOrder.total_amount, currentCurrency)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] flex justify-end">
                            <button
                                onClick={() => handleShareWhatsApp(selectedOrder)}
                                className="px-4 py-2 bg-green-500/20 text-green-500 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors flex items-center gap-2 mr-auto"
                            >
                                <Share2 size={18} />
                                <span className="hidden sm:inline">WhatsApp</span>
                            </button>
                            <button
                                onClick={() => handleDownloadPDF(selectedOrder)}
                                className="px-4 py-2 bg-blue-500/20 text-blue-500 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors flex items-center gap-2 mr-2"
                            >
                                <Download size={18} />
                                <span className="hidden sm:inline">Descargar PDF</span>
                            </button>
                            <button
                                onClick={() => setSelectedOrder(null)}
                                className="px-6 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg font-bold hover:bg-[var(--color-surface)] transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupplierOrders;
