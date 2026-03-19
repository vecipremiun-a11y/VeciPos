import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { formatInCompanyTime } from '../lib/dateHelpers';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    AlertTriangle,
    CheckCircle,
    XCircle,
    Box,
    Search,
    Clock,
    Download,
    ChevronDown,
    ChevronUp,
    ShoppingCart,
    Copy,
    Trash2,
    History,
    ArrowLeft
} from 'lucide-react';

const ExpiringProductsReport = () => {
    const {
        fetchProductLotsReport, fetchProductLotsGlobalStats, currentCompanyTimezone,
        writeOffExpiredLot, writeOffAllExpiredLots,
        fetchInventoryLosses, fetchInventoryLossesStats
    } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Report data - accumulated lots from paginated product fetches
    const [reportData, setReportData] = useState([]);
    const [productOffset, setProductOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const PRODUCTS_PER_PAGE = 20;

    // Global Stats State (for the cards)
    const [globalStats, setGlobalStats] = useState({
        validLots: 0,
        nearExpiryLots: 0,
        expiredLots: 0,
        totalLots: 0,
        totalItems: 0,
        expiryValueLost: 0
    });

    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().split('T')[0];
    });
    const [expandedProduct, setExpandedProduct] = useState(null);

    // Write-off state
    const [writeOffConfirm, setWriteOffConfirm] = useState(null); // { type: 'lot'|'product', lot?, lots?, productName? }
    const [writeOffNotes, setWriteOffNotes] = useState('');
    const [writeOffReason, setWriteOffReason] = useState('expired'); // 'expired' | 'supplier_exchange'
    const [isWritingOff, setIsWritingOff] = useState(false);

    // Losses history tab
    const [activeTab, setActiveTab] = useState('report'); // 'report' | 'losses'
    const [losses, setLosses] = useState([]);
    const [lossesStats, setLossesStats] = useState({ total_records: 0, total_units: 0, total_value: 0, total_products: 0, total_exchanged_units: 0, total_exchanges: 0 });
    const [isLoadingLosses, setIsLoadingLosses] = useState(false);

    // Infinite scroll observer for product list
    const observer = useRef();
    const lastProductRef = useCallback(node => {
        if (isLoading || isLoadingMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                loadMore();
            }
        });
        if (node) observer.current.observe(node);
    }, [isLoading, isLoadingMore, hasMore]);

    // Initial Load
    React.useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            if (fetchProductLotsGlobalStats) {
                const stats = await fetchProductLotsGlobalStats();
                if (stats) setGlobalStats(stats);
            }

            const result = await fetchProductLotsReport(PRODUCTS_PER_PAGE, 0);
            setReportData(result.products);
            setProductOffset(PRODUCTS_PER_PAGE);
            setHasMore(result.hasMore);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const loadMore = async () => {
        if (!hasMore || isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            const result = await fetchProductLotsReport(PRODUCTS_PER_PAGE, productOffset);
            if (result.products.length > 0) {
                setReportData(prev => [...prev, ...result.products]);
                setProductOffset(prev => prev + PRODUCTS_PER_PAGE);
            }
            setHasMore(result.hasMore);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Filter Logic to group loaded rows into products
    const groupedProducts = useMemo(() => {
        const productMap = {};
        const today = new Date().toISOString().split('T')[0];

        // First: group ALL lots by product
        reportData.forEach(row => {
            const expiry = row.expiry_date;

            let status = 'valid';
            if (expiry) {
                if (expiry < today) {
                    status = 'expired';
                } else if (expiry <= endDate) {
                    status = 'near_expiry';
                }
            }

            if (!productMap[row.product_id]) {
                productMap[row.product_id] = {
                    id: row.product_id,
                    name: row.product_name,
                    sku: row.product_sku,
                    image: row.product_image,
                    stock: row.product_stock,
                    unit: row.product_unit,
                    price: row.product_price,
                    lots: []
                };
            }

            productMap[row.product_id].lots.push({
                ...row,
                status
            });
        });

        // Then: filter products — show product if it has AT LEAST one lot within the date range
        const products = Object.values(productMap).filter(p => {
            const matchesSearch = p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.sku?.toLowerCase().includes(searchTerm.toLowerCase());
            if (!matchesSearch) return false;

            // Hide products where stock is 0 and ALL lots are expired
            const allExpired = p.lots.length > 0 && p.lots.every(l => l.status === 'expired');
            if (allExpired && (p.stock <= 0)) return false;

            // Date filter: product must have at least one lot with expiry in [startDate, endDate]
            const hasLotInRange = p.lots.some(l =>
                l.expiry_date && l.expiry_date >= startDate && l.expiry_date <= endDate
            );
            if (!hasLotInRange) return false;

            return true;
        });

        // Ensure sorting by earliest expiry date (handling nulls as last)
        return products.sort((a, b) => {
            const getMinExpiry = (lots) => {
                const dates = lots
                    .map(l => l.expiry_date)
                    .filter(d => d); // Filter out null/undefined
                if (dates.length === 0) return '9999-99-99'; // Max date if all are null
                return dates.sort()[0]; // Min date
            };

            const minA = getMinExpiry(a.lots);
            const minB = getMinExpiry(b.lots);

            if (minA < minB) return -1;
            if (minA > minB) return 1;
            return 0;
        });
    }, [reportData, startDate, endDate, searchTerm]);

    const toggleExpand = (id) => {
        setExpandedProduct(expandedProduct === id ? null : id);
    };

    const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(val);

    // Download PDF
    const downloadPDF = () => {
        const doc = new jsPDF('landscape', 'mm', 'letter');
        const pageW = doc.internal.pageSize.getWidth();

        // Title
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Reporte de Productos por Vencer', 14, 15);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Rango: ${startDate} a ${endDate}`, 14, 21);
        doc.text(`Generado: ${new Date().toLocaleDateString('es-CO')}`, 14, 26);

        // Stats summary
        doc.text(`Vigentes: ${globalStats.validLots}  |  Próximos a vencer: ${globalStats.nearExpiryLots}  |  Vencidos: ${globalStats.expiredLots}  |  Total lotes: ${globalStats.totalLots}  |  Pérdida: ${formatCurrency(globalStats.expiryValueLost)}`, 14, 32);

        // Build table rows from the SAME grouped & filtered data shown on screen
        const tableRows = [];
        groupedProducts.forEach(product => {
            product.lots.forEach(lot => {
                const statusLabel = lot.status === 'expired' ? 'Vencido' : lot.status === 'near_expiry' ? 'Por Vencer' : 'Vigente';
                tableRows.push([
                    product.name,
                    product.sku || '',
                    lot.batch_number || 'S/L',
                    lot.created_at ? lot.created_at.split('T')[0] : 'N/A',
                    lot.invoice_number || 'N/A',
                    lot.expiry_date || 'N/A',
                    lot.initial_quantity ?? lot.quantity,
                    lot.quantity,
                    formatCurrency(lot.cost || 0),
                    formatCurrency((lot.cost || 0) * (lot.quantity || 0)),
                    statusLabel
                ]);
            });
        });

        autoTable(doc, {
            startY: 36,
            head: [['Producto', 'SKU', 'Lote', 'Ingreso', 'Factura', 'Vencimiento', 'Cant. Ingresada', 'Cant. Restante', 'Costo Unit.', 'Costo Total', 'Estado']],
            body: tableRows,
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [30, 30, 50], textColor: 255, fontSize: 7, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 40 },
                6: { halign: 'right' },
                7: { halign: 'right' },
                8: { halign: 'right' },
                9: { halign: 'right' },
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 10) {
                    const val = data.cell.raw;
                    if (val === 'Vencido') data.cell.styles.textColor = [220, 50, 50];
                    else if (val === 'Por Vencer') data.cell.styles.textColor = [200, 150, 0];
                    else data.cell.styles.textColor = [30, 160, 70];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            margin: { left: 14, right: 14 },
        });

        // Footer
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text(`Página ${i} de ${pageCount}`, pageW - 30, doc.internal.pageSize.getHeight() - 8);
        }

        doc.save(`reporte-vencimientos-${startDate}-a-${endDate}.pdf`);
    };

    // Write-off handlers
    const handleWriteOffLot = (lot) => {
        setWriteOffConfirm({ type: 'lot', lot });
        setWriteOffNotes('');
        setWriteOffReason('expired');
    };

    const handleWriteOffAllExpired = (product) => {
        const expiredLots = product.lots.filter(l => l.status === 'expired' && l.quantity > 0);
        if (expiredLots.length === 0) return;
        setWriteOffConfirm({ type: 'product', lots: expiredLots, productName: product.name });
        setWriteOffNotes('');
        setWriteOffReason('expired');
    };

    const confirmWriteOff = async () => {
        if (!writeOffConfirm) return;
        setIsWritingOff(true);
        try {
            let result;
            if (writeOffConfirm.type === 'lot') {
                result = await writeOffExpiredLot(writeOffConfirm.lot, writeOffNotes, writeOffReason);
            } else {
                result = await writeOffAllExpiredLots(writeOffConfirm.lots, writeOffNotes, writeOffReason);
            }
            if (result.success) {
                // Remove written-off lots from reportData
                if (writeOffConfirm.type === 'lot') {
                    setReportData(prev => prev.filter(r => r.id !== writeOffConfirm.lot.id));
                } else {
                    const ids = new Set(writeOffConfirm.lots.map(l => l.id));
                    setReportData(prev => prev.filter(r => !ids.has(r.id)));
                }
                // Refresh global stats
                if (fetchProductLotsGlobalStats) {
                    const stats = await fetchProductLotsGlobalStats();
                    if (stats) setGlobalStats(stats);
                }
            }
        } catch (e) {
            console.error('Write-off error:', e);
        } finally {
            setIsWritingOff(false);
            setWriteOffConfirm(null);
        }
    };

    // Load losses tab
    const loadLosses = async () => {
        setIsLoadingLosses(true);
        try {
            const [data, stats] = await Promise.all([
                fetchInventoryLosses(200, 0),
                fetchInventoryLossesStats()
            ]);
            setLosses(data || []);
            setLossesStats(stats || { total_records: 0, total_units: 0, total_value: 0, total_products: 0 });
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingLosses(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[var(--color-background)] min-h-screen font-sans">
            {/* Mobile Header */}
            <div className="lg:hidden sticky top-0 z-30 bg-[var(--color-surface)] border-b border-[var(--glass-border)] p-4">
                <h1 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                    <Clock size={20} className="text-blue-500" />
                    Reporte de productos por vencer
                </h1>
            </div>

            {/* Desktop Header */}
            <div className="hidden lg:flex justify-between items-center p-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Clock size={28} className="text-blue-600" />
                        Reporte de productos por vencer
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)]">Panel reporte de productos por vencer</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => { setActiveTab('losses'); loadLosses(); }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${activeTab === 'losses' ? 'bg-red-600 text-white' : 'bg-[var(--glass-bg)] text-[var(--color-text)] hover:bg-[var(--glass-bg)]'}`}
                    >
                        <History size={18} /> Pérdidas
                    </button>
                    <button
                        onClick={() => setActiveTab('report')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${activeTab === 'report' ? 'bg-blue-600 text-white' : 'bg-[var(--glass-bg)] text-[var(--color-text)] hover:bg-[var(--glass-bg)]'}`}
                    >
                        <Clock size={18} /> Reporte
                    </button>
                    <button onClick={downloadPDF} className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-lg hover:bg-[var(--glass-bg)] transition">
                        <Download size={18} /> Descargar
                    </button>
                </div>
            </div>

            {/* Main Content - Scrollable */}
            <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4 lg:space-y-6 pb-24 lg:pb-6">

                {/* ============ LOSSES TAB ============ */}
                {activeTab === 'losses' && (
                    <>
                        {/* Losses Summary Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                            <div className="bg-red-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                                <h3 className="text-[10px] lg:text-xs font-bold uppercase">Pérdidas Reales</h3>
                                <p className="text-xl lg:text-2xl font-bold">{formatCurrency(lossesStats.total_value || 0)}</p>
                                <p className="text-red-200 text-[10px]">Productos no recuperados</p>
                            </div>
                            <div className="bg-orange-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                                <h3 className="text-[10px] lg:text-xs font-bold uppercase">Unidades Perdidas</h3>
                                <p className="text-xl lg:text-2xl font-bold">{(lossesStats.total_units || 0) - (lossesStats.total_exchanged_units || 0)}</p>
                                <p className="text-orange-200 text-[10px]">Sin cambio proveedor</p>
                            </div>
                            <div className="bg-blue-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                                <h3 className="text-[10px] lg:text-xs font-bold uppercase">Cambios Proveedor</h3>
                                <p className="text-xl lg:text-2xl font-bold">{lossesStats.total_exchanges || 0}</p>
                                <p className="text-blue-200 text-[10px]">{lossesStats.total_exchanged_units || 0} unidades cambiadas</p>
                            </div>
                            <div className="bg-gray-600 text-white p-3 lg:p-4 rounded-xl shadow-lg">
                                <h3 className="text-[10px] lg:text-xs font-bold uppercase">Total Registros</h3>
                                <p className="text-xl lg:text-2xl font-bold">{lossesStats.total_records || 0}</p>
                                <p className="text-gray-300 text-[10px]">{lossesStats.total_products || 0} productos</p>
                            </div>
                        </div>

                        {isLoadingLosses ? (
                            <div className="text-center py-12 text-[var(--color-text-muted)] animate-pulse">Cargando historial de pérdidas...</div>
                        ) : losses.length === 0 ? (
                            <div className="text-center py-12 text-[var(--color-text-muted)]">
                                <CheckCircle size={48} className="mx-auto mb-3 opacity-50 text-green-400" />
                                <p>No hay pérdidas registradas. Los lotes vencidos se pueden dar de baja desde el reporte.</p>
                            </div>
                        ) : (
                            <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--glass-border)] overflow-hidden">
                                {/* Mobile losses */}
                                <div className="lg:hidden space-y-2 p-3">
                                    {losses.map((loss) => (
                                        <div key={loss.id} className="bg-[var(--glass-bg)] p-3 rounded-lg border border-[var(--glass-border)]">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-sm text-[var(--color-text)]">{loss.product_name}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${loss.reason === 'supplier_exchange' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                                                    {loss.reason === 'supplier_exchange' ? 'Cambio Prov.' : 'Pérdida'}
                                                </span>
                                            </div>
                                            <div className="text-[10px] space-y-0.5 text-[var(--color-text-muted)]">
                                                <div className="flex justify-between"><span>SKU:</span> <span>{loss.product_sku || 'N/A'}</span></div>
                                                <div className="flex justify-between"><span>Lote:</span> <span>{loss.batch_number || 'S/L'}</span></div>
                                                <div className="flex justify-between"><span>Vencimiento:</span> <span>{loss.expiry_date || 'N/A'}</span></div>
                                                <div className="flex justify-between"><span>Cantidad:</span> <span>{loss.quantity}</span></div>
                                                <div className="flex justify-between"><span>Valor:</span> <span className={loss.reason === 'supplier_exchange' ? 'text-blue-400' : 'text-red-400'}>{loss.reason === 'supplier_exchange' ? '$0 (cambio)' : `-${formatCurrency(loss.total_loss)}`}</span></div>
                                                <div className="flex justify-between"><span>Fecha baja:</span> <span>{loss.created_at ? loss.created_at.split('T')[0] : 'N/A'}</span></div>
                                                {loss.notes && <div className="flex justify-between"><span>Notas:</span> <span>{loss.notes}</span></div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {/* Desktop losses table */}
                                <div className="hidden lg:block overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-[var(--color-text-muted)] uppercase bg-[var(--color-background)]">
                                            <tr>
                                                <th className="px-4 py-3">Producto</th>
                                                <th className="px-4 py-3">SKU</th>
                                                <th className="px-4 py-3">Lote</th>
                                                <th className="px-4 py-3">Vencimiento</th>
                                                <th className="px-4 py-3">Cantidad</th>
                                                <th className="px-4 py-3">Costo Unit.</th>
                                                <th className="px-4 py-3">Motivo</th>
                                                <th className="px-4 py-3">Pérdida</th>
                                                <th className="px-4 py-3">Fecha Baja</th>
                                                <th className="px-4 py-3">Usuario</th>
                                                <th className="px-4 py-3">Notas</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {losses.map(loss => (
                                                <tr key={loss.id} className="border-b border-[var(--glass-border)]">
                                                    <td className="px-4 py-2 font-medium text-[var(--color-text)]">{loss.product_name}</td>
                                                    <td className="px-4 py-2 text-[var(--color-text-muted)]">{loss.product_sku || 'N/A'}</td>
                                                    <td className="px-4 py-2">{loss.batch_number || 'S/L'}</td>
                                                    <td className="px-4 py-2">{loss.expiry_date || 'N/A'}</td>
                                                    <td className="px-4 py-2">{loss.quantity}</td>
                                                    <td className="px-4 py-2">{formatCurrency(loss.cost_per_unit)}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${loss.reason === 'supplier_exchange' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                                                            {loss.reason === 'supplier_exchange' ? 'Cambio Prov.' : 'Pérdida'}
                                                        </span>
                                                    </td>
                                                    <td className={`px-4 py-2 font-bold ${loss.reason === 'supplier_exchange' ? 'text-blue-400' : 'text-red-400'}`}>
                                                        {loss.reason === 'supplier_exchange' ? '$0' : formatCurrency(loss.total_loss)}
                                                    </td>
                                                    <td className="px-4 py-2 text-[var(--color-text-muted)]">{loss.created_at ? loss.created_at.split('T')[0] : 'N/A'}</td>
                                                    <td className="px-4 py-2 text-[var(--color-text-muted)]">{loss.user_name || 'N/A'}</td>
                                                    <td className="px-4 py-2 text-[var(--color-text-muted)] max-w-[200px] truncate">{loss.notes || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ============ REPORT TAB ============ */}
                {activeTab === 'report' && (
                <>
                {/* Stats Cards - Using Global Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                    <div className="bg-green-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">PRODUCTOS VIGENTES</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.validLots}</p>
                            <p className="text-green-100 text-[10px] lg:text-sm">Lotes vigentes</p>
                        </div>
                        <CheckCircle size={32} className="text-green-200 opacity-80 hidden lg:block" />
                        <CheckCircle size={24} className="text-green-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-yellow-500 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">PRÓXIMOS A VENCER</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.nearExpiryLots}</p>
                            <p className="text-yellow-100 text-[10px] lg:text-sm">Próximos 30 días</p>
                        </div>
                        <AlertTriangle size={32} className="text-yellow-200 opacity-80 hidden lg:block" />
                        <AlertTriangle size={24} className="text-yellow-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-red-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">VENCIDOS</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.expiredLots}</p>
                            <p className="text-red-100 text-[10px] lg:text-sm">Pérdida: {formatCurrency(globalStats.expiryValueLost)}</p>
                        </div>
                        <XCircle size={32} className="text-red-200 opacity-80 hidden lg:block" />
                        <XCircle size={24} className="text-red-200 opacity-80 lg:hidden" />
                    </div>
                    <div className="bg-blue-600 text-white p-3 lg:p-4 rounded-xl shadow-lg flex items-center justify-between">
                        <div>
                            <h3 className="text-[10px] lg:text-lg font-bold uppercase">TOTAL DE LOTES</h3>
                            <p className="text-2xl lg:text-3xl font-bold">{globalStats.totalLots}</p>
                            <p className="text-blue-100 text-[10px] lg:text-sm">{globalStats.totalItems} productos</p>
                        </div>
                        <Box size={32} className="text-blue-200 opacity-80 hidden lg:block" />
                        <Box size={24} className="text-blue-200 opacity-80 lg:hidden" />
                    </div>
                </div>

                {/* Filters */}
                <div className="lg:flex bg-[var(--color-surface)] p-4 rounded-xl shadow-sm gap-4 items-center hidden">
                    <div className="flex-1 min-w-[300px] relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o código (en items cargados)..."
                            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* Date filters technically affect "near expiry" status logic, kept for visual consistency, though global stats use fixed 30 days */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Inicio</span>
                        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded">Fecha Fin</span>
                        <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                </div>

                {/* Products List */}
                <div className="space-y-3 lg:space-y-4">
                    {/* Mobile Search */}
                    <div className="lg:hidden relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="w-full pl-10 pr-4 py-3 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {groupedProducts.map((product, index) => {
                        const isLast = index === groupedProducts.length - 1;
                        return (
                            <div
                                key={product.id}
                                ref={isLast ? lastProductRef : null}
                                className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--glass-border)] overflow-hidden"
                            >
                                {/* Product Row Content (Same as before) */}
                                <div
                                    className="p-3 lg:p-4 flex items-center gap-3 lg:gap-4 cursor-pointer hover:bg-[var(--glass-bg)] transition"
                                    onClick={() => toggleExpand(product.id)}
                                >
                                    <div className="p-1 border rounded-lg bg-[var(--glass-bg)] shrink-0">
                                        {product.image ? (
                                            <img src={product.image} alt={product.name} className="w-10 h-10 lg:w-12 lg:h-12 object-cover rounded" />
                                        ) : (
                                            <Box className="w-10 h-10 lg:w-12 lg:h-12 text-gray-300 p-2" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-[var(--color-text)] text-sm lg:text-lg truncate">{product.name}</h3>
                                        <p className="text-[10px] lg:text-sm text-[var(--color-text-muted)] truncate">
                                            SKU: {product.sku} - Stock: {product.stock} {product.unit}
                                        </p>
                                        <div className="flex gap-1 mt-1 flex-wrap">
                                            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] lg:text-xs font-bold">
                                                {product.lots.length} Lote{product.lots.length !== 1 ? 's' : ''}
                                            </span>
                                            {product.lots.some(l => l.status === 'expired') && (
                                                <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] lg:text-xs font-bold">
                                                    Vencido
                                                </span>
                                            )}
                                            {/* Duplicate lot indicator */}
                                            {(() => {
                                                const seen = new Set();
                                                const hasDupes = product.lots.some(l => {
                                                    const key = `${l.batch_number || ''}|${l.expiry_date || ''}`;
                                                    if (seen.has(key)) return true;
                                                    seen.add(key);
                                                    return false;
                                                });
                                                return hasDupes ? (
                                                    <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px] lg:text-xs font-bold flex items-center gap-0.5">
                                                        <Copy size={10} /> Posibles duplicados
                                                    </span>
                                                ) : null;
                                            })()}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-bold text-[var(--color-text)] text-sm lg:text-lg">{formatCurrency(product.price)}</p>
                                        {expandedProduct === product.id ? <ChevronUp className="ml-auto text-gray-400" size={20} /> : <ChevronDown className="ml-auto text-gray-400" size={20} />}
                                    </div>
                                </div>

                                {/* Expanded Content (Lots) */}
                                {expandedProduct === product.id && (
                                    <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 lg:p-4 animate-in slide-in-from-top-2">
                                        <div className="lg:hidden space-y-2">
                                            {product.lots.map((lot) => (
                                                <div key={lot.id} className="bg-[var(--color-surface)] p-3 rounded-lg border border-[var(--glass-border)]">
                                                    <div className="flex justify-between mb-2">
                                                        <span className="font-bold text-sm text-[var(--color-text)]">{lot.batch_number || 'S/L'}</span>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${lot.status === 'expired' ? 'bg-red-500/20 text-red-400' : lot.status === 'near_expiry' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
                                                            {lot.status === 'expired' ? 'Vencido' : lot.status === 'near_expiry' ? 'Por Vencer' : 'Vigente'}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] space-y-1 text-[var(--color-text-muted)]">
                                                        <div className="flex justify-between"><span>Ingreso:</span> <span className="text-[var(--color-text)]">{lot.created_at ? lot.created_at.split('T')[0] : 'N/A'}</span></div>
                                                        <div className="flex justify-between"><span>Factura:</span> <span className="text-[var(--color-text)]">{lot.invoice_number || 'N/A'}</span></div>
                                                        <div className="flex justify-between"><span>Vence:</span> <span className="text-[var(--color-text)]">{lot.expiry_date || 'N/A'}</span></div>
                                                        <div className="flex justify-between"><span>Cant. Ingresada:</span> <span className="text-[var(--color-text)]">{lot.initial_quantity ?? lot.quantity}</span></div>
                                                        <div className="flex justify-between"><span>Cant. Restante:</span> <span className={`text-[var(--color-text)] font-bold ${lot.quantity <= 0 ? 'text-red-400' : ''}`}>{lot.quantity}</span></div>
                                                        <div className="flex justify-between"><span>Costo:</span> <span className="text-[var(--color-text)]">{formatCurrency(lot.cost)}</span></div>
                                                    </div>
                                                    {lot.status === 'expired' && lot.quantity > 0 && (
                                                        <button
                                                            onClick={() => handleWriteOffLot(lot)}
                                                            className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold transition"
                                                        >
                                                            <Trash2 size={12} /> Dar de Baja
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        <div className="hidden lg:block overflow-x-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="text-xs text-[var(--color-text-muted)] uppercase bg-[var(--color-background)]">
                                                    <tr>
                                                        <th className="px-4 py-2">Lote</th>
                                                        <th className="px-4 py-2">Fecha Ingreso</th>
                                                        <th className="px-4 py-2">Factura #</th>
                                                        <th className="px-4 py-2">Vencimiento</th>
                                                        <th className="px-4 py-2">Cant. Ingresada</th>
                                                        <th className="px-4 py-2">Cant. Restante</th>
                                                        <th className="px-4 py-2">Costo</th>
                                                        <th className="px-4 py-2">Estado</th>
                                                        <th className="px-4 py-2">Acciones</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {product.lots.map(lot => {
                                                        // Check if this lot is a potential duplicate
                                                        const isDuplicate = product.lots.filter(l =>
                                                            l.batch_number === lot.batch_number &&
                                                            l.expiry_date === lot.expiry_date &&
                                                            l.id !== lot.id
                                                        ).length > 0;

                                                        return (
                                                            <tr key={lot.id} className={`border-b border-[var(--glass-border)] ${isDuplicate ? 'bg-yellow-500/5' : ''}`}>
                                                                <td className="px-4 py-2 font-medium">
                                                                    <span className="flex items-center gap-1">
                                                                        {lot.batch_number || 'S/L'}
                                                                        {isDuplicate && <AlertTriangle size={14} className="text-yellow-400" title="Posible lote duplicado" />}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2 text-[var(--color-text-muted)]">{lot.created_at ? lot.created_at.split('T')[0] : 'N/A'}</td>
                                                                <td className="px-4 py-2">
                                                                    {lot.invoice_number ? (
                                                                        <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs">{lot.invoice_number}</span>
                                                                    ) : (
                                                                        <span className="text-[var(--color-text-muted)]">N/A</span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-2">{lot.expiry_date || 'N/A'}</td>
                                                                <td className="px-4 py-2 text-[var(--color-text-muted)]">{lot.initial_quantity ?? lot.quantity}</td>
                                                                <td className={`px-4 py-2 font-bold ${lot.quantity <= 0 ? 'text-red-400' : ''}`}>{lot.quantity}</td>
                                                                <td className="px-4 py-2">{formatCurrency(lot.cost)}</td>
                                                                <td className="px-4 py-2">
                                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${lot.status === 'expired' ? 'text-red-400' : lot.status === 'near_expiry' ? 'text-yellow-400' : 'text-green-400'}`}>
                                                                        {lot.status === 'expired' ? 'Vencido' : lot.status === 'near_expiry' ? 'Por Vencer' : 'Vigente'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    {lot.status === 'expired' && lot.quantity > 0 && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); handleWriteOffLot(lot); }}
                                                                            className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold transition"
                                                                        >
                                                                            <Trash2 size={12} /> Dar de Baja
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* Write Off All Expired button */}
                                        {product.lots.filter(l => l.status === 'expired' && l.quantity > 0).length > 1 && (
                                            <div className="mt-3 flex justify-end">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleWriteOffAllExpired(product); }}
                                                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition"
                                                >
                                                    <Trash2 size={16} /> Dar de Baja Todos los Vencidos ({product.lots.filter(l => l.status === 'expired' && l.quantity > 0).length} lotes)
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {isLoadingMore && (
                        <div className="text-center py-4 text-[var(--color-text-muted)] animate-pulse">
                            Cargando más productos...
                        </div>
                    )}

                    {!isLoading && groupedProducts.length === 0 && (
                        <div className="text-center py-12 text-[var(--color-text-muted)]">
                            <Box size={48} className="mx-auto mb-3 opacity-50" />
                            <p>No se encontraron productos.</p>
                        </div>
                    )}
                </div>
                </>)}
            </div>

            {/* Mobile Footer Actions */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--glass-border)] p-4 flex gap-3 z-40">
                <button
                    onClick={() => setActiveTab('report')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${activeTab === 'report' ? 'bg-blue-600 text-white' : 'bg-[var(--glass-bg)] text-[var(--color-text)]'}`}
                >
                    <Clock size={18} /> Reporte
                </button>
                <button
                    onClick={() => { setActiveTab('losses'); loadLosses(); }}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${activeTab === 'losses' ? 'bg-red-600 text-white' : 'bg-[var(--glass-bg)] text-[var(--color-text)]'}`}
                >
                    <History size={18} /> Pérdidas
                </button>
            </div>

            {/* Write-Off Confirmation Modal */}
            {writeOffConfirm && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl max-w-md w-full p-6 border border-[var(--glass-border)]">
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`p-2 rounded-full ${writeOffReason === 'supplier_exchange' ? 'bg-blue-500/20' : 'bg-red-500/20'}`}>
                                <AlertTriangle size={24} className={writeOffReason === 'supplier_exchange' ? 'text-blue-400' : 'text-red-400'} />
                            </div>
                            <h3 className="text-lg font-bold text-[var(--color-text)]">Dar de Baja por Vencimiento</h3>
                        </div>

                        {/* Reason selector */}
                        <div className="mb-4">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-2">Motivo de la baja</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setWriteOffReason('expired')}
                                    className={`p-3 rounded-lg border-2 text-left transition ${writeOffReason === 'expired' ? 'border-red-500 bg-red-500/10' : 'border-[var(--glass-border)] bg-[var(--glass-bg)] opacity-60'}`}
                                >
                                    <span className="block text-sm font-bold text-red-400">Pérdida</span>
                                    <span className="block text-[10px] text-[var(--color-text-muted)]">Producto no recuperable</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setWriteOffReason('supplier_exchange')}
                                    className={`p-3 rounded-lg border-2 text-left transition ${writeOffReason === 'supplier_exchange' ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--glass-border)] bg-[var(--glass-bg)] opacity-60'}`}
                                >
                                    <span className="block text-sm font-bold text-blue-400">Cambio Proveedor</span>
                                    <span className="block text-[10px] text-[var(--color-text-muted)]">Se devuelve al proveedor</span>
                                </button>
                            </div>
                        </div>

                        <div className="mb-4 text-sm text-[var(--color-text-muted)]">
                            {writeOffConfirm.type === 'lot' ? (
                                <>
                                    <p>Se dará de baja el lote <strong className="text-[var(--color-text)]">{writeOffConfirm.lot.batch_number || 'S/L'}</strong> del producto <strong className="text-[var(--color-text)]">{writeOffConfirm.lot.product_name}</strong></p>
                                    <div className={`mt-2 p-3 rounded-lg border ${writeOffReason === 'supplier_exchange' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                                        <div className="flex justify-between"><span>Cantidad:</span> <span className="font-bold">{writeOffConfirm.lot.quantity}</span></div>
                                        <div className="flex justify-between"><span>Costo unitario:</span> <span>{formatCurrency(writeOffConfirm.lot.cost)}</span></div>
                                        {writeOffReason === 'expired' ? (
                                            <div className="flex justify-between text-red-400 font-bold"><span>Pérdida total:</span> <span>{formatCurrency((writeOffConfirm.lot.cost || 0) * (writeOffConfirm.lot.quantity || 0))}</span></div>
                                        ) : (
                                            <div className="flex justify-between text-blue-400 font-bold"><span>Pérdida:</span> <span>$0 (cambio proveedor)</span></div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p>Se darán de baja <strong className="text-[var(--color-text)]">{writeOffConfirm.lots.length} lotes vencidos</strong> de <strong className="text-[var(--color-text)]">{writeOffConfirm.productName}</strong></p>
                                    <div className={`mt-2 p-3 rounded-lg border ${writeOffReason === 'supplier_exchange' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                                        <div className="flex justify-between"><span>Cantidad total:</span> <span className="font-bold">{writeOffConfirm.lots.reduce((s, l) => s + l.quantity, 0)}</span></div>
                                        {writeOffReason === 'expired' ? (
                                            <div className="flex justify-between text-red-400 font-bold"><span>Pérdida total:</span> <span>{formatCurrency(writeOffConfirm.lots.reduce((s, l) => s + (l.cost || 0) * (l.quantity || 0), 0))}</span></div>
                                        ) : (
                                            <div className="flex justify-between text-blue-400 font-bold"><span>Pérdida:</span> <span>$0 (cambio proveedor)</span></div>
                                        )}
                                    </div>
                                </>
                            )}
                            <p className="mt-2 text-xs">
                                {writeOffReason === 'supplier_exchange'
                                    ? 'Se descontará del stock pero NO se registrará como pérdida financiera.'
                                    : 'Esta acción descontará del stock y registrará la pérdida. No se puede deshacer.'}
                            </p>
                        </div>

                        <div className="mb-4">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Notas (opcional)</label>
                            <textarea
                                value={writeOffNotes}
                                onChange={(e) => setWriteOffNotes(e.target.value)}
                                placeholder={writeOffReason === 'supplier_exchange' ? 'Ej: Nota de crédito #123, cambio acordado...' : 'Ej: Producto dañado, vencido, etc.'}
                                className={`w-full px-3 py-2 border rounded-lg text-sm bg-[var(--color-background)] text-[var(--color-text)] outline-none focus:ring-2 ${writeOffReason === 'supplier_exchange' ? 'focus:ring-blue-500' : 'focus:ring-red-500'}`}
                                rows={2}
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setWriteOffConfirm(null)}
                                disabled={isWritingOff}
                                className="flex-1 py-2.5 px-4 bg-[var(--glass-bg)] text-[var(--color-text)] rounded-lg font-bold hover:opacity-80 transition"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmWriteOff}
                                disabled={isWritingOff}
                                className={`flex-1 py-2.5 px-4 text-white rounded-lg font-bold transition flex items-center justify-center gap-2 ${writeOffReason === 'supplier_exchange' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`}
                            >
                                {isWritingOff ? 'Procesando...' : <><Trash2 size={16} /> {writeOffReason === 'supplier_exchange' ? 'Confirmar Cambio' : 'Confirmar Baja'}</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpiringProductsReport;
