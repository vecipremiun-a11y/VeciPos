import React, { useState, useEffect } from 'react';
import { FileText, Trash2, ArrowLeft, Loader, Search, Filter } from 'lucide-react';
import { useStore } from '../store/useStore';
import { format } from 'date-fns';

const Invoices = () => {
    const { fetchPurchases, fetchPurchaseDetails, deletePurchase, activeCompanyId } = useStore();

    const [invoices, setInvoices] = useState([]);
    const [invoiceView, setInvoiceView] = useState('list'); // 'list' | 'detail'
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [offset, setOffset] = useState(0);

    useEffect(() => {
        loadInvoices(0, true);
    }, [activeCompanyId]);

    const loadInvoices = async (currentOffset, reset = false) => {
        setIsLoadingInvoices(true);
        const fetched = await fetchPurchases(currentOffset);
        if (reset) {
            setInvoices(fetched);
            setOffset(currentOffset + 50);
        } else {
            setInvoices(prev => [...prev, ...fetched]);
            setOffset(currentOffset + 50);
        }
        setIsLoadingInvoices(false);
    };

    const handleInvoiceClick = async (invoiceId) => {
        setIsLoadingDetails(true);
        const details = await fetchPurchaseDetails(invoiceId);
        if (details) {
            setSelectedInvoice(details);
            setInvoiceView('detail');
        }
        setIsLoadingDetails(false);
    };

    const handleBackToInvoices = () => {
        setSelectedInvoice(null);
        setInvoiceView('list');
    };

    const handleDeleteInvoice = async (e, id) => {
        e.stopPropagation();
        if (window.confirm('¿Estás seguro de eliminar esta factura?')) {
            await deletePurchase(id);
            loadInvoices(0, true);
            if (selectedInvoice?.id === id) {
                handleBackToInvoices();
            }
        }
    };

    return (
        <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 shrink-0">
                <div>
                    <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text">Facturas</h1>
                    <p className="text-[var(--color-text-muted)]">Historial de facturas recibidas</p>
                </div>
            </div>

            <div className="glass-card overflow-hidden p-0 flex-1 flex flex-col relative">
                {/* LIST VIEW */}
                {invoiceView === 'list' && (
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        {isLoadingInvoices && invoices.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader className="animate-spin text-[var(--color-primary)]" size={32} />
                            </div>
                        ) : (
                            <>
                                {/* Mobile List View */}
                                <div className="lg:hidden divide-y divide-[var(--glass-border)]">
                                    {invoices.map((inv) => (
                                        <div
                                            key={inv.id}
                                            onClick={() => handleInvoiceClick(inv.id)}
                                            className="p-4 hover:bg-[var(--glass-bg)] transition-colors cursor-pointer"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <FileText size={16} className="text-[var(--color-primary)]" />
                                                    <span className="font-bold text-[var(--color-text)]">
                                                        #{inv.invoice_number || 'S/N'}
                                                    </span>
                                                </div>
                                                <span className="font-bold text-[var(--color-primary)]">
                                                    ${inv.total?.toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-[var(--color-text-muted)]">
                                                    {inv.supplier_name || 'Desconocido'}
                                                </span>
                                                <span className="text-[var(--color-text-muted)]">
                                                    {inv.date ? format(new Date(inv.date), 'dd/MM/yyyy') : '-'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center mt-2">
                                                {inv.is_credit ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/20">
                                                        CRÉDITO
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/20">
                                                        PAGADO
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => handleDeleteInvoice(e, inv.id)}
                                                    className="p-1.5 text-red-400"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Desktop Table View */}
                                <table className="hidden lg:table w-full text-left">
                                    <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] uppercase text-sm font-semibold sticky top-0 backdrop-blur-md z-10">
                                        <tr>
                                            <th className="px-6 py-4">N° Factura</th>
                                            <th className="px-6 py-4">Proveedor</th>
                                            <th className="px-6 py-4">Fecha</th>
                                            <th className="px-6 py-4">Estado</th>
                                            <th className="px-6 py-4 text-right">Total</th>
                                            <th className="px-6 py-4 text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--glass-border)]">
                                        {invoices.map((inv) => (
                                            <tr
                                                key={inv.id}
                                                onClick={() => handleInvoiceClick(inv.id)}
                                                className="hover:bg-[var(--glass-bg)] transition-colors cursor-pointer group"
                                            >
                                                <td className="px-6 py-4 text-[var(--color-text)] font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <FileText size={16} className="text-[var(--color-primary)]" />
                                                        {inv.invoice_number || 'S/N'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-[var(--color-text-muted)]">{inv.supplier_name || 'Desconocido'}</td>
                                                <td className="px-6 py-4 text-[var(--color-text-muted)]">
                                                    {inv.date ? format(new Date(inv.date), 'dd/MM/yyyy') : '-'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {inv.is_credit ? (
                                                        <span className="px-2 py-1 rounded text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/20">
                                                            CRÉDITO
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-1 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/20">
                                                            PAGADO
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right text-[var(--color-text)] font-bold">
                                                    ${inv.total?.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <button
                                                        onClick={(e) => handleDeleteInvoice(e, inv.id)}
                                                        className="p-2 hover:bg-[var(--color-surface-hover)] rounded text-red-400 hover:text-red-300 transition-colors opacity-0 group-hover:opacity-100"
                                                        title="Eliminar Factura"
                                                    >
                                                        <Trash2 size={20} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </>
                        )}
                        {invoices.length === 0 && !isLoadingInvoices && (
                            <div className="p-10 text-center text-[var(--color-text-muted)]">
                                No se han registrado facturas.
                            </div>
                        )}
                    </div>
                )}

                {/* DETAIL OVERLAY / VIEW */}
                {invoiceView === 'detail' && (
                    <div className="absolute inset-0 bg-[var(--color-surface)] z-20 flex flex-col animate-in slide-in-from-right duration-300">
                        {isLoadingDetails && !selectedInvoice ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader className="animate-spin text-[var(--color-primary)]" size={32} />
                            </div>
                        ) : selectedInvoice ? (
                            <>
                                {/* Mobile Header */}
                                <div className="lg:hidden sticky top-0 bg-[var(--color-surface)] border-b border-[var(--glass-border)] p-4 flex items-center gap-3 z-10">
                                    <button onClick={handleBackToInvoices} className="text-[var(--color-primary)]">
                                        <ArrowLeft size={24} />
                                    </button>
                                    <h2 className="text-lg font-bold text-[var(--color-text)]">Facturas</h2>
                                </div>

                                {/* Mobile Content */}
                                <div className="lg:hidden flex-1 overflow-auto p-4 space-y-4">
                                    {/* Invoice Header Card */}
                                    <div className="glass-card p-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-xl font-bold text-[var(--color-text)]">
                                                    Factura #{selectedInvoice.invoice_number || 'S/N'}
                                                </h3>
                                                <p className="text-sm text-[var(--color-text-muted)]">
                                                    Proveedor: {selectedInvoice.supplier_name} | Fecha:{selectedInvoice.date}
                                                </p>
                                            </div>
                                            <div className="text-right flex items-center gap-3">
                                                <div>
                                                    <p className="text-xs text-[var(--color-text-muted)]">Total Factura</p>
                                                    <p className="text-xl font-bold text-[var(--color-primary)]">
                                                        ${selectedInvoice.total?.toLocaleString()}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={(e) => handleDeleteInvoice(e, selectedInvoice.id)}
                                                    className="p-2 text-red-400"
                                                >
                                                    <Trash2 size={20} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Products Section */}
                                    <div>
                                        <h3 className="text-base font-bold text-[var(--color-text)] mb-3">Productos Ingresados</h3>
                                        <div className="glass-card p-0 overflow-hidden">
                                            {/* Mobile Table Header */}
                                            <div className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-[10px] uppercase font-bold px-3 py-2">
                                                <div className="grid grid-cols-[80px_1fr_40px_60px_70px] gap-1 items-center">
                                                    <div>CÓDIGO</div>
                                                    <div>PRODUCTO</div>
                                                    <div className="text-center">CANT.</div>
                                                    <div className="text-right">COSTO U.</div>
                                                    <div className="text-right">TOTAL LÍNEA</div>
                                                </div>
                                            </div>
                                            {/* Mobile Table Body */}
                                            <div className="divide-y divide-[var(--glass-border)]">
                                                {selectedInvoice.items && selectedInvoice.items.map((item, idx) => (
                                                    <div key={idx} className="px-3 py-2.5">
                                                        <div className="grid grid-cols-[80px_1fr_40px_60px_70px] gap-1 items-center text-xs">
                                                            <div className="text-[var(--color-text-muted)] font-mono truncate">{item.sku}</div>
                                                            <div className="text-[var(--color-text)] font-medium truncate">{item.name}</div>
                                                            <div className="text-center text-[var(--color-text)]">{item.quantity}</div>
                                                            <div className="text-right text-[var(--color-text-muted)]">${parseFloat(item.cost).toLocaleString()}</div>
                                                            <div className="text-right text-[var(--color-text)] font-bold">${(item.quantity * item.cost).toLocaleString()}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Mobile Footer Cards */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="glass-card p-3">
                                            <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">PAGO</h4>
                                            <p className="text-sm text-[var(--color-text)]">Método: {selectedInvoice.payment_method}</p>
                                            <p className="text-sm text-[var(--color-text)]">Tipo: {selectedInvoice.is_credit ? 'Crédito' : 'Contado'}</p>
                                        </div>
                                        <div className="glass-card p-3">
                                            <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">REGISTRO</h4>
                                            <p className="text-sm text-[var(--color-text-muted)]">ID Interno: {selectedInvoice.id}</p>
                                            <p className="text-sm text-[var(--color-text-muted)]">Estado: {selectedInvoice.status}</p>
                                            <p className="text-xl font-bold text-[var(--color-primary)] mt-2">
                                                ${selectedInvoice.total?.toLocaleString()}
                                            </p>
                                        </div>
                                    </div>

                                    {selectedInvoice.is_credit && (
                                        <div className="glass-card p-3">
                                            <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mb-2">CRÉDITO</h4>
                                            <div className="grid grid-cols-3 gap-2 text-sm">
                                                <p className="text-[var(--color-text)]">Días: {selectedInvoice.credit_days}</p>
                                                <p className="text-[var(--color-text)]">Vence: {selectedInvoice.expiry_date}</p>
                                                <p className="text-[var(--color-text)]">Abono: ${selectedInvoice.deposit?.toLocaleString()}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Desktop Detail Header */}
                                <div className="hidden lg:flex p-4 border-b border-[var(--glass-border)] items-center gap-4 bg-[var(--glass-bg)]">
                                    <button
                                        onClick={handleBackToInvoices}
                                        className="p-2 hover:bg-[var(--color-surface-hover)] rounded text-[var(--color-text)]"
                                    >
                                        <ArrowLeft size={24} />
                                    </button>
                                    <div>
                                        <h2 className="text-xl font-bold text-[var(--color-text)]">
                                            Factura #{selectedInvoice.invoice_number || 'S/N'}
                                        </h2>
                                        <p className="text-sm text-[var(--color-text-muted)]">
                                            Proveedor: {selectedInvoice.supplier_name} | Fecha: {selectedInvoice.date}
                                        </p>
                                    </div>
                                    <div className="ml-auto flex gap-4 items-center">
                                        <div className="text-right">
                                            <p className="text-xs text-[var(--color-text-muted)]">Total Factura</p>
                                            <p className="text-2xl font-bold text-[var(--color-primary)] neon-text">
                                                ${selectedInvoice.total?.toLocaleString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={(e) => handleDeleteInvoice(e, selectedInvoice.id)}
                                            className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors flex items-center gap-2"
                                        >
                                            <Trash2 size={18} /> Eliminar
                                        </button>
                                    </div>
                                </div>

                                {/* Desktop Products List */}
                                <div className="hidden lg:block flex-1 overflow-auto custom-scrollbar p-6">
                                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">Productos Ingresados</h3>
                                    <div className="glass-card overflow-hidden">
                                        <table className="w-full text-left">
                                            <thead className="bg-[var(--glass-bg)] text-[var(--color-text-muted)] text-[13px] uppercase font-semibold">
                                                <tr>
                                                    <th className="px-6 py-3.5">Código</th>
                                                    <th className="px-6 py-3.5">Producto</th>
                                                    <th className="px-6 py-3.5 text-right">Cant.</th>
                                                    <th className="px-6 py-3.5 text-right">Costo U.</th>
                                                    <th className="px-6 py-3.5 text-right">Total Línea</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--glass-border)]">
                                                {selectedInvoice.items && selectedInvoice.items.map((item, idx) => (
                                                    <tr key={idx} className="hover:bg-[var(--glass-bg)]">
                                                        <td className="px-6 py-3.5 text-[var(--color-text-muted)] font-mono text-[13px]">{item.sku}</td>
                                                        <td className="px-6 py-3.5 text-[var(--color-text)] font-medium text-[14px]">{item.name}</td>
                                                        <td className="px-6 py-3.5 text-right text-[var(--color-text)] text-[14px]">{item.quantity}</td>
                                                        <td className="px-6 py-3.5 text-right text-[var(--color-text-muted)] text-[14px]">${parseFloat(item.cost).toLocaleString()}</td>
                                                        <td className="px-6 py-3.5 text-right text-[var(--color-text)] font-bold text-[14px]">
                                                            ${(item.quantity * item.cost).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Desktop Invoice Metadata Footer */}
                                    <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="glass-card p-4">
                                            <h4 className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase mb-2">Pago</h4>
                                            <p className="text-[var(--color-text)] text-[14px]">Método: {selectedInvoice.payment_method}</p>
                                            <p className="text-[var(--color-text)] text-[14px]">Tipo: {selectedInvoice.is_credit ? 'Crédito' : 'Contado'}</p>
                                        </div>
                                        {selectedInvoice.is_credit && (
                                            <div className="glass-card p-4">
                                                <h4 className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase mb-2">Crédito</h4>
                                                <p className="text-[var(--color-text)] text-[14px]">Días Plazo: {selectedInvoice.credit_days}</p>
                                                <p className="text-[var(--color-text)] text-[14px]">Vencimiento: {selectedInvoice.expiry_date}</p>
                                                <p className="text-[var(--color-text)] text-[14px]">Abono Inicial: ${selectedInvoice.deposit?.toLocaleString()}</p>
                                            </div>
                                        )}
                                        <div className="glass-card p-4">
                                            <h4 className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase mb-2">Registro</h4>
                                            <p className="text-[var(--color-text-muted)] text-[14px]">ID Interno: {selectedInvoice.id}</p>
                                            <p className="text-[var(--color-text-muted)] text-[14px]">Estado: {selectedInvoice.status}</p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center flex-1 text-red-400">
                                <p>Error al cargar detalles.</p>
                                <button onClick={handleBackToInvoices} className="mt-4 underline">Volver</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Invoices;
