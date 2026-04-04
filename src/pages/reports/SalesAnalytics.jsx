import React, { useState, useEffect } from 'react';
import { Calendar, Filter, Users, DollarSign, ShoppingCart, CreditCard, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils/formatCurrency';
import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const PAYMENT_COLORS = {
    'Efectivo': '#00f0ff',
    'Tarjeta': '#a855f7',
    'Transferencia': '#22c55e',
    'Mixto': '#f59e0b',
    'Crédito': '#ef4444',
    'Otro': '#6b7280'
};

const PAYMENT_ICONS = {
    'Efectivo': '💵',
    'Tarjeta': '💳',
    'Transferencia': '🏦',
    'Mixto': '🔀',
    'Crédito': '📝'
};

const SalesAnalytics = () => {
    const {
        activeCompanyId,
        currentCurrency,
        users,
        getSalesByPaymentMethod,
        getVendorTopProducts,
        getVendorSalesSummary
    } = useStore();

    const [dateRange, setDateRange] = useState('today');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedVendor, setSelectedVendor] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Data
    const [paymentData, setPaymentData] = useState({ methods: [], totalAmount: 0, totalCount: 0 });
    const [vendorProducts, setVendorProducts] = useState([]);
    const [vendorsSummary, setVendorsSummary] = useState([]);

    useEffect(() => {
        setDefaultDates();
    }, [dateRange]);

    useEffect(() => {
        if (startDate && endDate) loadData();
    }, [startDate, endDate, selectedVendor]);

    const setDefaultDates = () => {
        const today = new Date();
        const end = today.toLocaleDateString('en-CA');
        let start;
        switch (dateRange) {
            case 'today':
                start = end;
                break;
            case 'week': {
                const d = new Date(today);
                d.setDate(d.getDate() - 7);
                start = d.toLocaleDateString('en-CA');
                break;
            }
            case 'month': {
                const d = new Date(today);
                d.setMonth(d.getMonth() - 1);
                start = d.toLocaleDateString('en-CA');
                break;
            }
            default:
                return; // custom
        }
        setStartDate(start);
        setEndDate(end);
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            const userId = selectedVendor || undefined;
            const result = await getSalesByPaymentMethod(startDate, endDate, activeCompanyId, userId);
            if (result.success) {
                setPaymentData(result);
            }

            // Always load vendor summary
            const vendorsResult = await getVendorSalesSummary(startDate, endDate, activeCompanyId);
            if (vendorsResult.success) {
                setVendorsSummary(vendorsResult.vendors);
            }

            if (selectedVendor) {
                const prodResult = await getVendorTopProducts(startDate, endDate, selectedVendor, activeCompanyId, 10);
                if (prodResult.success) {
                    setVendorProducts(prodResult.products);
                }
            } else {
                setVendorProducts([]);
            }
        } catch (e) {
            console.error('Error loading analytics:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const pieData = paymentData.methods.map(m => ({
        name: m.method,
        value: m.amount
    }));

    const avgTicket = paymentData.totalCount > 0
        ? paymentData.totalAmount / paymentData.totalCount
        : 0;

    const selectedVendorName = selectedVendor
        ? users.find(u => String(u.id) === String(selectedVendor))?.name || 'Vendedor'
        : '';

    const vendorList = users.filter(u => u.role !== 'super_admin');

    const renderCustomLabel = ({ name, percent, cx, x }) => {
        const anchor = x > cx ? 'start' : 'end';
        return (
            <text x={x} y={undefined} fill="#fff" textAnchor={anchor} fontSize={12}>
                {`${name} ${(percent * 100).toFixed(1)}%`}
            </text>
        );
    };

    return (
        <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
            {/* Header */}
            <h1 className="neon-text" style={{ fontSize: '1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CreditCard size={24} />
                Análisis de Ventas por Método de Pago
            </h1>

            {/* Filtros */}
            <div className="glass-card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
                {/* Período */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={14} /> Período
                    </label>
                    <div style={{ display: 'flex', gap: 4 }}>
                        {[
                            { key: 'today', label: 'Hoy' },
                            { key: 'week', label: 'Semana' },
                            { key: 'month', label: 'Mes' },
                            { key: 'custom', label: 'Personalizado' }
                        ].map(opt => (
                            <button
                                key={opt.key}
                                onClick={() => setDateRange(opt.key)}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: 8,
                                    border: dateRange === opt.key ? '1px solid var(--primary)' : '1px solid var(--border)',
                                    background: dateRange === opt.key ? 'var(--primary-alpha, rgba(0,240,255,0.15))' : 'transparent',
                                    color: dateRange === opt.key ? 'var(--primary)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: dateRange === opt.key ? 600 : 400
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Fechas custom */}
                {dateRange === 'custom' && (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Desde</label>
                            <input
                                type="date"
                                className="glass-input"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Hasta</label>
                            <input
                                type="date"
                                className="glass-input"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            />
                        </div>
                    </>
                )}

                {/* Vendedor */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Users size={14} /> Vendedor
                    </label>
                    <select
                        className="glass-input"
                        value={selectedVendor}
                        onChange={e => setSelectedVendor(e.target.value)}
                        style={{ padding: '6px 10px', fontSize: '0.85rem', minWidth: 160 }}
                    >
                        <option value="">Todos</option>
                        {vendorList.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Tarjetas métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <MetricCard
                    icon={<DollarSign size={20} />}
                    label="Total Ventas"
                    value={formatCurrency(paymentData.totalAmount, currentCurrency)}
                    color="#00f0ff"
                />
                <MetricCard
                    icon={<ShoppingCart size={20} />}
                    label="Transacciones"
                    value={paymentData.totalCount}
                    color="#a855f7"
                />
                <MetricCard
                    icon={<CreditCard size={20} />}
                    label="Ticket Promedio"
                    value={formatCurrency(avgTicket, currentCurrency)}
                    color="#22c55e"
                />
            </div>

            {isLoading && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    Cargando datos...
                </div>
            )}

            {/* Gráfico circular + Tabla */}
            {!isLoading && paymentData.methods.length > 0 && (
                <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                        {selectedVendorName ? `Desglose de ${selectedVendorName}` : 'Desglose por Método de Pago'}
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'center' }}>
                        {/* Pie Chart */}
                        <div style={{ height: 300 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={true}
                                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                                        outerRadius={110}
                                        innerRadius={50}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {pieData.map((entry, index) => (
                                            <Cell key={index} fill={PAYMENT_COLORS[entry.name] || PAYMENT_COLORS['Otro']} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value) => formatCurrency(value, currentCurrency)}
                                        contentStyle={{
                                            backgroundColor: 'var(--surface, #0f0f2d)',
                                            borderColor: 'var(--border, #1e293b)',
                                            color: '#fff',
                                            borderRadius: 8
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Tabla desglose */}
                        <div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <th style={{ textAlign: 'left', padding: '8px 4px' }}>Método</th>
                                        <th style={{ textAlign: 'right', padding: '8px 4px' }}>Monto</th>
                                        <th style={{ textAlign: 'right', padding: '8px 4px' }}>%</th>
                                        <th style={{ textAlign: 'right', padding: '8px 4px' }}>Txns</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paymentData.methods.map((m, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.05))' }}>
                                            <td style={{ padding: '10px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{
                                                    width: 10, height: 10, borderRadius: '50%',
                                                    backgroundColor: PAYMENT_COLORS[m.method] || PAYMENT_COLORS['Otro'],
                                                    display: 'inline-block', flexShrink: 0
                                                }} />
                                                <span>{PAYMENT_ICONS[m.method] || '💰'} {m.method}</span>
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 4px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                {formatCurrency(m.amount, currentCurrency)}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 4px', color: PAYMENT_COLORS[m.method] || '#6b7280' }}>
                                                {m.percentage.toFixed(1)}%
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 4px', color: 'var(--text-secondary)' }}>
                                                {m.count}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--primary, #00f0ff)', fontWeight: 700 }}>
                                        <td style={{ padding: '10px 4px' }}>Total</td>
                                        <td style={{ textAlign: 'right', padding: '10px 4px', color: 'var(--primary)' }}>
                                            {formatCurrency(paymentData.totalAmount, currentCurrency)}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '10px 4px' }}>100%</td>
                                        <td style={{ textAlign: 'right', padding: '10px 4px', color: 'var(--text-secondary)' }}>
                                            {paymentData.totalCount}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {!isLoading && paymentData.methods.length === 0 && (
                <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No hay ventas en el período seleccionado
                </div>
            )}

            {/* Tabla de ventas por vendedor */}
            {!isLoading && vendorsSummary.length > 0 && (
                <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Users size={18} />
                        Ventas por Vendedor
                    </h2>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Vendedor</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>Ventas</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>Total</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>💵 Efectivo</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>💳 Tarjeta</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>🏦 Transfer.</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>🔀 Mixto</th>
                                    <th style={{ textAlign: 'right', padding: '8px 6px' }}>📝 Crédito</th>
                                    <th style={{ textAlign: 'center', padding: '8px 6px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {vendorsSummary.map((v, i) => {
                                    const isSelected = String(selectedVendor) === String(v.user_id);
                                    return (
                                        <tr
                                            key={v.user_id}
                                            onClick={() => setSelectedVendor(isSelected ? '' : String(v.user_id))}
                                            style={{
                                                borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.05))',
                                                cursor: 'pointer',
                                                background: isSelected ? 'rgba(0,240,255,0.08)' : 'transparent',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            <td style={{ padding: '10px 6px', fontWeight: 600, color: isSelected ? 'var(--primary)' : 'var(--text-primary)' }}>
                                                {v.user_name}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', color: 'var(--text-secondary)' }}>
                                                {v.total_sales}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                {formatCurrency(v.total_amount, currentCurrency)}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', color: v.cash > 0 ? '#00f0ff' : 'var(--text-secondary)' }}>
                                                {v.cash > 0 ? formatCurrency(v.cash, currentCurrency) : '-'}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', color: v.card > 0 ? '#a855f7' : 'var(--text-secondary)' }}>
                                                {v.card > 0 ? formatCurrency(v.card, currentCurrency) : '-'}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', color: v.transfer > 0 ? '#22c55e' : 'var(--text-secondary)' }}>
                                                {v.transfer > 0 ? formatCurrency(v.transfer, currentCurrency) : '-'}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', color: v.mixed > 0 ? '#f59e0b' : 'var(--text-secondary)' }}>
                                                {v.mixed > 0 ? formatCurrency(v.mixed, currentCurrency) : '-'}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 6px', color: v.credit > 0 ? '#ef4444' : 'var(--text-secondary)' }}>
                                                {v.credit > 0 ? formatCurrency(v.credit, currentCurrency) : '-'}
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 6px', color: isSelected ? 'var(--primary)' : 'var(--text-secondary)' }}>
                                                <ChevronRight size={16} style={{ transform: isSelected ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--primary, #00f0ff)', fontWeight: 700 }}>
                                    <td style={{ padding: '10px 6px' }}>Total</td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px' }}>
                                        {vendorsSummary.reduce((s, v) => s + v.total_sales, 0)}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px', color: 'var(--primary)' }}>
                                        {formatCurrency(vendorsSummary.reduce((s, v) => s + v.total_amount, 0), currentCurrency)}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px', color: '#00f0ff' }}>
                                        {formatCurrency(vendorsSummary.reduce((s, v) => s + v.cash, 0), currentCurrency)}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px', color: '#a855f7' }}>
                                        {formatCurrency(vendorsSummary.reduce((s, v) => s + v.card, 0), currentCurrency)}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px', color: '#22c55e' }}>
                                        {formatCurrency(vendorsSummary.reduce((s, v) => s + v.transfer, 0), currentCurrency)}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px', color: '#f59e0b' }}>
                                        {formatCurrency(vendorsSummary.reduce((s, v) => s + v.mixed, 0), currentCurrency)}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '10px 6px', color: '#ef4444' }}>
                                        {formatCurrency(vendorsSummary.reduce((s, v) => s + v.credit, 0), currentCurrency)}
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 8 }}>
                        Haz clic en un vendedor para ver su desglose detallado y productos más vendidos
                    </div>
                </div>
            )}

            {/* Sección vendedor: Top productos */}
            {!isLoading && selectedVendor && vendorProducts.length > 0 && (
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                        🏆 Top Productos de {selectedVendorName}
                    </h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                <th style={{ textAlign: 'left', padding: '8px 4px' }}>#</th>
                                <th style={{ textAlign: 'left', padding: '8px 4px' }}>Producto</th>
                                <th style={{ textAlign: 'right', padding: '8px 4px' }}>Cantidad</th>
                                <th style={{ textAlign: 'right', padding: '8px 4px' }}>Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vendorProducts.map((p, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.05))' }}>
                                    <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{i + 1}</td>
                                    <td style={{ padding: '10px 4px', color: 'var(--text-primary)' }}>{p.name}</td>
                                    <td style={{ textAlign: 'right', padding: '10px 4px', color: 'var(--primary)' }}>{p.quantity}</td>
                                    <td style={{ textAlign: 'right', padding: '10px 4px', fontWeight: 600 }}>
                                        {formatCurrency(p.amount, currentCurrency)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!isLoading && selectedVendor && vendorProducts.length === 0 && paymentData.methods.length > 0 && (
                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No se encontraron productos para este vendedor en el período seleccionado
                </div>
            )}

            {/* Responsive: mobile grid override */}
            <style>{`
                @media (max-width: 768px) {
                    .payment-grid { grid-template-columns: 1fr !important; }
                }
            `}</style>
        </div>
    );
};

const MetricCard = ({ icon, label, value, color }) => (
    <div className="glass-card" style={{ padding: '1rem 1.2rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `${color}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color
        }}>
            {icon}
        </div>
        <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
        </div>
    </div>
);

export default SalesAnalytics;