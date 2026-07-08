import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { dataApiCall } from '../../lib/dataApi';
import { FileText, Eye, Save, Building2, Package } from 'lucide-react';

const ReceiptSettings = ({ companyInfo }) => {
    const { activeCompanyId } = useStore();
    const [activeTab, setActiveTab] = useState('boleta');
    const [receiptConfig, setReceiptConfig] = useState({
        business_name: '',
        address: '',
        tax_id: '',
        phone: '',
        email: '',
        header_message: '',
        footer_message: '',
        show_tax_id: true,
        show_phone: true,
        show_email: true,
        format: '58mm'
    });
    const [preventaConfig, setPreventaConfig] = useState({
        business_name: '',
        address: '',
        phone: '',
        header_message: '',
        footer_message: '',
        show_phone: true,
        show_address: true,
        format: '80mm'
    });
    const [isSavingReceipt, setIsSavingReceipt] = useState(false);
    const [isSavingPreventa, setIsSavingPreventa] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    // Cargar configuración de boletas
    useEffect(() => {
        const loadReceiptConfig = async () => {
            try {
                const r = await dataApiCall('receiptSettingsLoad', { companyId: activeCompanyId });
                const data = r?.config;
                if (data) {
                    setReceiptConfig({
                        business_name: data.business_name || '',
                        address: data.address || '',
                        tax_id: data.tax_id || '',
                        phone: data.phone || '',
                        email: data.email || '',
                        header_message: data.header_message || '',
                        footer_message: data.footer_message || '',
                        show_tax_id: data.show_tax_id === 1,
                        show_phone: data.show_phone === 1,
                        show_email: data.show_email === 1,
                        format: data.format || '58mm'
                    });
                }
            } catch (e) {
                console.error('Error loading receipt config:', e);
            }
        };

        const loadPreventaConfig = async () => {
            try {
                const r = await dataApiCall('preventaSettingsLoad', { companyId: activeCompanyId });
                const data = r?.config;
                if (data) {
                    setPreventaConfig({
                        business_name: data.business_name || '',
                        address: data.address || '',
                        phone: data.phone || '',
                        header_message: data.header_message || '',
                        footer_message: data.footer_message || '',
                        show_phone: data.show_phone !== 0,
                        show_address: data.show_address !== 0,
                        format: data.format || '80mm'
                    });
                }
            } catch (e) {
                // Columns may not exist yet
                console.warn('Preventa config not available yet:', e.message);
            }
        };

        if (activeCompanyId) {
            loadReceiptConfig();
            loadPreventaConfig();
        }
    }, [activeCompanyId]);

    const handleSaveReceiptConfig = async () => {
        setIsSavingReceipt(true);
        try {
            const r = await dataApiCall('receiptSettingsSave', { companyId: activeCompanyId, config: receiptConfig });
            if (!r?.success) throw new Error(r?.error || 'Error');
            alert('✅ Configuración de boletas guardada correctamente');
        } catch (e) {
            console.error('Error saving receipt config:', e);
            alert('❌ Error al guardar configuración');
        } finally {
            setIsSavingReceipt(false);
        }
    };

    const handleSavePreventaConfig = async () => {
        setIsSavingPreventa(true);
        try {
            const r = await dataApiCall('preventaSettingsSave', { companyId: activeCompanyId, config: preventaConfig });
            if (!r?.success) throw new Error(r?.error || 'Error');
            alert('✅ Configuración de preventa guardada correctamente');
        } catch (e) {
            console.error('Error saving preventa config:', e);
            alert('❌ Error al guardar configuración');
        } finally {
            setIsSavingPreventa(false);
        }
    };

    return (
        <div className="glass-card border border-blue-500/30">
            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-[var(--glass-bg)] rounded-xl p-1 border border-[var(--glass-border)]">
                <button
                    onClick={() => { setActiveTab('boleta'); setShowPreview(false); }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${activeTab === 'boleta'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5'
                    }`}
                >
                    <FileText size={16} />
                    Boleta
                </button>
                <button
                    onClick={() => { setActiveTab('preventa'); setShowPreview(false); }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${activeTab === 'preventa'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5'
                    }`}
                >
                    <Package size={16} />
                    Preventa
                </button>
            </div>

            {/* ===== TAB BOLETA ===== */}
            {activeTab === 'boleta' && (
                <>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                        <FileText className="text-blue-400" size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-blue-400">Configuración de Boletas</h2>
                        <p className="text-sm text-[var(--color-text-muted)]">Personaliza los datos que aparecen en tus boletas de venta</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="btn-secondary flex items-center gap-2"
                >
                    <Eye size={16} />
                    {showPreview ? 'Ocultar' : 'Vista Previa'}
                </button>
            </div>

            {/* Selector de formato */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Formato de impresión</label>
                <div className="flex gap-2">
                    {[{ value: '58mm', label: '58mm', desc: 'Térmica angosta' }, { value: '80mm', label: '80mm', desc: 'Térmica ancha' }, { value: 'a4', label: 'A4', desc: 'Carta / Hoja completa' }].map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setReceiptConfig({ ...receiptConfig, format: opt.value })}
                            className={`flex-1 py-2.5 px-3 rounded-lg text-center transition-all border ${receiptConfig.format === opt.value
                                ? 'bg-blue-500/20 text-blue-400 border-blue-500/50 font-bold'
                                : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)] hover:border-blue-500/30'
                            }`}
                        >
                            <div className="text-sm font-bold">{opt.label}</div>
                            <div className="text-[10px] opacity-70">{opt.desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {companyInfo && (
                <div className="mb-4">
                    <button
                        onClick={() => {
                            setReceiptConfig({
                                ...receiptConfig,
                                business_name: companyInfo.legal_name || '',
                                address: companyInfo.full_address || '',
                                tax_id: companyInfo.tax_id_legal || '',
                                phone: companyInfo.phone_main || '',
                                email: companyInfo.email_main || ''
                            });
                        }}
                        className="btn-secondary flex items-center gap-2 text-sm"
                    >
                        <Building2 size={14} />
                        Copiar desde Información de Empresa
                    </button>
                    <p className="text-xs text-[var(--color-text-muted)] mt-2">
                        Esto copiará los datos de tu empresa a la configuración de boletas. Puedes editarlos después si quieres mostrar algo diferente en las boletas.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* FORMULARIO */}
                <div className="space-y-4">
                    {/* Nombre del Negocio */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            Nombre del Negocio *
                        </label>
                        <input
                            type="text"
                            value={receiptConfig.business_name}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, business_name: e.target.value })}
                            placeholder="Ej: VECI - Minimarket"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    {/* Dirección */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            Dirección *
                        </label>
                        <input
                            type="text"
                            value={receiptConfig.address}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, address: e.target.value })}
                            placeholder="Ej: Sotomayor 1460-A, Iquique"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    {/* RUT/NIT */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2 flex items-center justify-between">
                            <span>RUT / NIT / RFC</span>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={receiptConfig.show_tax_id}
                                    onChange={(e) => setReceiptConfig({ ...receiptConfig, show_tax_id: e.target.checked })}
                                    className="w-4 h-4"
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">Mostrar</span>
                            </label>
                        </label>
                        <input
                            type="text"
                            value={receiptConfig.tax_id}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, tax_id: e.target.value })}
                            placeholder="Ej: 76.XXX.XXX-X"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    {/* Teléfono */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2 flex items-center justify-between">
                            <span>Teléfono</span>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={receiptConfig.show_phone}
                                    onChange={(e) => setReceiptConfig({ ...receiptConfig, show_phone: e.target.checked })}
                                    className="w-4 h-4"
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">Mostrar</span>
                            </label>
                        </label>
                        <input
                            type="text"
                            value={receiptConfig.phone}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, phone: e.target.value })}
                            placeholder="Ej: +56 9 1234 5678"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2 flex items-center justify-between">
                            <span>Email</span>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={receiptConfig.show_email}
                                    onChange={(e) => setReceiptConfig({ ...receiptConfig, show_email: e.target.checked })}
                                    className="w-4 h-4"
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">Mostrar</span>
                            </label>
                        </label>
                        <input
                            type="email"
                            value={receiptConfig.email}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, email: e.target.value })}
                            placeholder="Ej: contacto@minegocio.cl"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    {/* Mensaje Cabecera */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            Mensaje Cabecera (Opcional)
                        </label>
                        <textarea
                            value={receiptConfig.header_message}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, header_message: e.target.value })}
                            placeholder="Ej: ¡Bienvenido a VECI!"
                            rows={2}
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] resize-none"
                        />
                    </div>

                    {/* Mensaje Pie */}
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            Mensaje Pie (Opcional)
                        </label>
                        <textarea
                            value={receiptConfig.footer_message}
                            onChange={(e) => setReceiptConfig({ ...receiptConfig, footer_message: e.target.value })}
                            placeholder="Ej: ¡Gracias por su compra! Vuelva pronto"
                            rows={2}
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] resize-none"
                        />
                    </div>

                    {/* Botón Guardar */}
                    <button
                        onClick={handleSaveReceiptConfig}
                        disabled={isSavingReceipt || !receiptConfig.business_name || !receiptConfig.address}
                        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save size={16} />
                        {isSavingReceipt ? 'Guardando...' : 'Guardar Configuración'}
                    </button>
                </div>

                {/* VISTA PREVIA */}
                {showPreview && (
                    <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-4">
                        <div className="bg-white text-black p-4 rounded font-mono text-xs max-w-[240px] mx-auto shadow-lg">
                            {/* Simulación de boleta 58mm */}
                            <div className="text-center border-b border-dashed border-gray-400 pb-2 mb-2">
                                <div className="font-bold text-sm">{receiptConfig.business_name || 'NOMBRE NEGOCIO'}</div>
                                <div className="text-[10px] mt-1">{receiptConfig.address || 'Dirección del negocio'}</div>
                                {receiptConfig.show_tax_id && receiptConfig.tax_id && (
                                    <div className="text-[10px]">RUT: {receiptConfig.tax_id}</div>
                                )}
                                {receiptConfig.show_phone && receiptConfig.phone && (
                                    <div className="text-[10px]">Tel: {receiptConfig.phone}</div>
                                )}
                                {receiptConfig.show_email && receiptConfig.email && (
                                    <div className="text-[10px]">{receiptConfig.email}</div>
                                )}
                                {receiptConfig.header_message && (
                                    <div className="text-[10px] mt-2 italic">{receiptConfig.header_message}</div>
                                )}
                            </div>

                            <div className="text-[10px] space-y-1 mb-2">
                                <div className="flex justify-between">
                                    <span>Boleta:</span>
                                    <span>T-001234</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Fecha:</span>
                                    <span>{new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Vend:</span>
                                    <span>Vendedor</span>
                                </div>
                            </div>

                            <div className="border-t border-dashed border-gray-400 pt-2 mb-2 text-[10px]">
                                <div className="flex justify-between font-bold">
                                    <span>DESCRIPCIÓN</span>
                                    <span>TOTAL</span>
                                </div>
                            </div>

                            <div className="text-[10px] space-y-2 mb-2">
                                <div>
                                    <div>Coca Cola 1.5L</div>
                                    <div className="flex justify-between">
                                        <span>2 x $1.500</span>
                                        <span>$3.000</span>
                                    </div>
                                </div>
                                <div>
                                    <div>Pan Molde</div>
                                    <div className="flex justify-between">
                                        <span>1 x $2.200</span>
                                        <span>$2.200</span>
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-dashed border-gray-400 pt-2 mb-2">
                                <div className="flex justify-between font-bold text-sm">
                                    <span>TOTAL</span>
                                    <span>$5.200</span>
                                </div>
                                <div className="flex justify-between text-[10px] mt-1">
                                    <span>Medio Pago:</span>
                                    <span>Efectivo</span>
                                </div>
                            </div>

                            {receiptConfig.footer_message && (
                                <div className="text-center text-[10px] border-t border-dashed border-gray-400 pt-2 mt-2">
                                    {receiptConfig.footer_message}
                                </div>
                            )}
                        </div>
                        <p className="text-center text-xs text-[var(--color-text-muted)] mt-4">
                            Vista previa aproximada • Formato {receiptConfig.format === 'a4' ? 'A4' : receiptConfig.format}
                        </p>
                    </div>
                )}
            </div>
                </>
            )}

            {/* ===== TAB PREVENTA ===== */}
            {activeTab === 'preventa' && (
                <>
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-500/20 rounded-lg">
                                <Package className="text-purple-400" size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-purple-400">Configuración de Preventa</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">Personaliza los datos que aparecen en el ticket de preventa</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className="btn-secondary flex items-center gap-2"
                        >
                            <Eye size={16} />
                            {showPreview ? 'Ocultar' : 'Vista Previa'}
                        </button>
                    </div>

                    {/* Selector de formato */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">Formato de impresión</label>
                        <div className="flex gap-2">
                            {[{ value: '58mm', label: '58mm', desc: 'Térmica angosta' }, { value: '80mm', label: '80mm', desc: 'Térmica ancha' }, { value: 'a4', label: 'A4', desc: 'Carta / Hoja completa' }].map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setPreventaConfig({ ...preventaConfig, format: opt.value })}
                                    className={`flex-1 py-2.5 px-3 rounded-lg text-center transition-all border ${preventaConfig.format === opt.value
                                        ? 'bg-purple-500/20 text-purple-400 border-purple-500/50 font-bold'
                                        : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] border-[var(--glass-border)] hover:border-purple-500/30'
                                    }`}
                                >
                                    <div className="text-sm font-bold">{opt.label}</div>
                                    <div className="text-[10px] opacity-70">{opt.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {companyInfo && (
                        <div className="mb-4">
                            <button
                                onClick={() => {
                                    setPreventaConfig({
                                        ...preventaConfig,
                                        business_name: companyInfo.legal_name || '',
                                        address: companyInfo.full_address || '',
                                        phone: companyInfo.phone_main || ''
                                    });
                                }}
                                className="btn-secondary flex items-center gap-2 text-sm"
                            >
                                <Building2 size={14} />
                                Copiar desde Información de Empresa
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* FORMULARIO PREVENTA */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                    Nombre del Negocio *
                                </label>
                                <input
                                    type="text"
                                    value={preventaConfig.business_name}
                                    onChange={(e) => setPreventaConfig({ ...preventaConfig, business_name: e.target.value })}
                                    placeholder="Ej: VECI - Minimarket"
                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-2 flex items-center justify-between">
                                    <span>Dirección</span>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={preventaConfig.show_address}
                                            onChange={(e) => setPreventaConfig({ ...preventaConfig, show_address: e.target.checked })}
                                            className="w-4 h-4"
                                        />
                                        <span className="text-xs text-[var(--color-text-muted)]">Mostrar</span>
                                    </label>
                                </label>
                                <input
                                    type="text"
                                    value={preventaConfig.address}
                                    onChange={(e) => setPreventaConfig({ ...preventaConfig, address: e.target.value })}
                                    placeholder="Ej: Sotomayor 1460-A, Iquique"
                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-2 flex items-center justify-between">
                                    <span>Teléfono / Celular</span>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={preventaConfig.show_phone}
                                            onChange={(e) => setPreventaConfig({ ...preventaConfig, show_phone: e.target.checked })}
                                            className="w-4 h-4"
                                        />
                                        <span className="text-xs text-[var(--color-text-muted)]">Mostrar</span>
                                    </label>
                                </label>
                                <input
                                    type="text"
                                    value={preventaConfig.phone}
                                    onChange={(e) => setPreventaConfig({ ...preventaConfig, phone: e.target.value })}
                                    placeholder="Ej: +56 9 1234 5678"
                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                    Mensaje Cabecera (Opcional)
                                </label>
                                <textarea
                                    value={preventaConfig.header_message}
                                    onChange={(e) => setPreventaConfig({ ...preventaConfig, header_message: e.target.value })}
                                    placeholder="Ej: ¡Gracias por su preferencia!"
                                    rows={2}
                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                    Mensaje Pie (Opcional)
                                </label>
                                <textarea
                                    value={preventaConfig.footer_message}
                                    onChange={(e) => setPreventaConfig({ ...preventaConfig, footer_message: e.target.value })}
                                    placeholder="Ej: Presentar este ticket en caja • www.minegocio.cl"
                                    rows={2}
                                    className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] resize-none"
                                />
                            </div>

                            <button
                                onClick={handleSavePreventaConfig}
                                disabled={isSavingPreventa || !preventaConfig.business_name}
                                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={16} />
                                {isSavingPreventa ? 'Guardando...' : 'Guardar Configuración'}
                            </button>
                        </div>

                        {/* VISTA PREVIA PREVENTA */}
                        {showPreview && (
                            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-4">
                                <div className="bg-white text-black p-4 rounded font-sans text-xs max-w-[280px] mx-auto shadow-lg">
                                    <div className="text-center border-b-2 border-black pb-2 mb-2">
                                        <div className="font-black text-base tracking-wide">{preventaConfig.business_name || 'NOMBRE NEGOCIO'}</div>
                                        <div className="bg-black text-white font-black text-lg tracking-[3px] inline-block px-3 py-0.5 my-1">PREVENTA</div>
                                        {preventaConfig.show_address && preventaConfig.address && (
                                            <div className="text-[9px] text-gray-500">{preventaConfig.address}</div>
                                        )}
                                        {preventaConfig.show_phone && preventaConfig.phone && (
                                            <div className="text-[9px] text-gray-500">Tel: {preventaConfig.phone}</div>
                                        )}
                                        {preventaConfig.header_message && (
                                            <div className="text-[9px] mt-1 italic text-gray-600">{preventaConfig.header_message}</div>
                                        )}
                                    </div>

                                    <div className="flex justify-between text-[9px] border-b border-dashed border-gray-400 pb-1 mb-2">
                                        <div><b>Atendido por:</b> Diana</div>
                                        <div><b>Fecha:</b> {new Date().toLocaleDateString('es-CL')} {new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>

                                    <div className="font-black text-[11px] tracking-wide border-b border-black pb-0.5 mb-1">DETALLE DE PRODUCTOS</div>
                                    <table className="w-full text-[10px] mb-1">
                                        <thead>
                                            <tr className="border-b border-gray-300">
                                                <th className="text-left py-0.5 font-bold text-[8px] text-gray-500">PRODUCTO</th>
                                                <th className="text-right py-0.5 font-bold text-[8px] text-gray-500">CANT.</th>
                                                <th className="text-right py-0.5 font-bold text-[8px] text-gray-500">PRECIO</th>
                                                <th className="text-right py-0.5 font-bold text-[8px] text-gray-500">SUBTOTAL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="border-b border-dotted border-gray-200">
                                                <td className="py-1 font-bold">Coca Cola 1.5L</td>
                                                <td className="text-right py-1 font-semibold">2</td>
                                                <td className="text-right py-1 text-gray-500">$1.500</td>
                                                <td className="text-right py-1 font-bold">$3.000</td>
                                            </tr>
                                            <tr className="border-b border-dotted border-gray-200">
                                                <td className="py-1 font-bold">Pan Molde</td>
                                                <td className="text-right py-1 font-semibold">1</td>
                                                <td className="text-right py-1 text-gray-500">$2.200</td>
                                                <td className="text-right py-1 font-bold">$2.200</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <div className="border-t-2 border-black pt-1 mb-2">
                                        <div className="flex justify-between items-center">
                                            <span className="font-black text-sm">TOTAL A PAGAR</span>
                                            <span className="font-black text-lg">$5.200</span>
                                        </div>
                                        <div className="text-[8px] text-gray-400">3 artículos</div>
                                    </div>

                                    <div className="text-center border-t border-dashed border-gray-400 pt-2 mb-1">
                                        <div className="bg-gray-200 h-10 flex items-center justify-center text-[8px] text-gray-400 rounded">
                                            [ Código de barras ]
                                        </div>
                                        <div className="font-bold text-[10px] tracking-[2px] mt-1">PV26041113003985</div>
                                    </div>

                                    <div className="text-center text-[9px] font-bold border-t border-dashed border-gray-400 pt-1 mt-1">
                                        {preventaConfig.footer_message || 'Presentar este ticket en caja para pago'}
                                    </div>
                                    <div className="text-center text-[7px] text-gray-400 mt-0.5">
                                        Este documento no es válido como boleta o factura
                                    </div>
                                </div>
                                <p className="text-center text-xs text-[var(--color-text-muted)] mt-4">
                                    Vista previa aproximada • Formato {preventaConfig.format === 'a4' ? 'A4' : preventaConfig.format}
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default ReceiptSettings;
