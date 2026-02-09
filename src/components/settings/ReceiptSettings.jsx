import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { turso } from '../../lib/turso';
import { FileText, Eye, Save, Building2 } from 'lucide-react';

const ReceiptSettings = ({ companyInfo }) => {
    const { activeCompanyId } = useStore();
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
        show_email: true
    });
    const [isSavingReceipt, setIsSavingReceipt] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    // Cargar configuración de boletas
    useEffect(() => {
        const loadReceiptConfig = async () => {
            try {
                const result = await turso.execute({
                    sql: `SELECT 
                            receipt_business_name,
                            receipt_address,
                            receipt_tax_id,
                            receipt_phone,
                            receipt_email,
                            receipt_header_message,
                            receipt_footer_message,
                            receipt_show_tax_id,
                            receipt_show_phone,
                            receipt_show_email
                          FROM companies WHERE id = ?`,
                    args: [activeCompanyId]
                });

                if (result.rows.length > 0) {
                    const data = result.rows[0];
                    setReceiptConfig({
                        business_name: data.receipt_business_name || '',
                        address: data.receipt_address || '',
                        tax_id: data.receipt_tax_id || '',
                        phone: data.receipt_phone || '',
                        email: data.receipt_email || '',
                        header_message: data.receipt_header_message || '',
                        footer_message: data.receipt_footer_message || '',
                        show_tax_id: data.receipt_show_tax_id === 1,
                        show_phone: data.receipt_show_phone === 1,
                        show_email: data.receipt_show_email === 1
                    });
                }
            } catch (e) {
                console.error('Error loading receipt config:', e);
            }
        };

        if (activeCompanyId) {
            loadReceiptConfig();
        }
    }, [activeCompanyId]);

    const handleSaveReceiptConfig = async () => {
        setIsSavingReceipt(true);
        try {
            await turso.execute({
                sql: `UPDATE companies SET 
                        receipt_business_name = ?,
                        receipt_address = ?,
                        receipt_tax_id = ?,
                        receipt_phone = ?,
                        receipt_email = ?,
                        receipt_header_message = ?,
                        receipt_footer_message = ?,
                        receipt_show_tax_id = ?,
                        receipt_show_phone = ?,
                        receipt_show_email = ?
                      WHERE id = ?`,
                args: [
                    receiptConfig.business_name,
                    receiptConfig.address,
                    receiptConfig.tax_id,
                    receiptConfig.phone,
                    receiptConfig.email,
                    receiptConfig.header_message,
                    receiptConfig.footer_message,
                    receiptConfig.show_tax_id ? 1 : 0,
                    receiptConfig.show_phone ? 1 : 0,
                    receiptConfig.show_email ? 1 : 0,
                    activeCompanyId
                ]
            });
            alert('✅ Configuración de boletas guardada correctamente');
        } catch (e) {
            console.error('Error saving receipt config:', e);
            alert('❌ Error al guardar configuración');
        } finally {
            setIsSavingReceipt(false);
        }
    };

    return (
        <div className="glass-card border border-blue-500/30">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                        <FileText className="text-blue-400" size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-blue-400">Configuración de Boletas</h2>
                        <p className="text-sm text-[var(--color-text-muted)]">Personaliza los datos que aparecen en tus boletas de venta (58mm)</p>
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
                            Vista previa aproximada • Formato 58mm
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReceiptSettings;
