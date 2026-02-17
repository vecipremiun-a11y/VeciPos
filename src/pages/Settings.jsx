import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { turso } from '../lib/turso';
import { Moon, Sun, Settings as SettingsIcon, FileText, Smartphone, Wrench, Building2, Save, CreditCard } from 'lucide-react';

import { recompressAllImages } from '../scripts/recompressImages';
import ReceiptSettings from '../components/settings/ReceiptSettings';
import PaymentMethodsSettings from '../components/settings/PaymentMethodsSettings';
import PermissionsSettings from '../components/settings/PermissionsSettings';
import { Shield } from 'lucide-react';
import { formatCurrency, getCurrencySymbol } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';

const Settings = () => {
    const { darkMode, toggleDarkMode, inventoryAdjustmentMode, toggleInventoryAdjustmentMode, activeCompanyId, currentCompanyTimezone, fetchInitialData, updateCurrency } = useStore();
    const { can } = usePermissions();
    const [selectedTimezone, setSelectedTimezone] = useState(currentCompanyTimezone);

    // Estados para información de la empresa
    const [companyInfo, setCompanyInfo] = useState({
        legal_name: '',
        full_address: '',
        tax_id_legal: '',
        phone_main: '',
        email_main: '',
        city: '',
        country: 'Chile',
        postal_code: '',
        website: '',
        business_type: '',
        currency: 'CLP'
    });
    const [isSavingCompanyInfo, setIsSavingCompanyInfo] = useState(false);

    const [activeTab, setActiveTab] = useState('general');

    useEffect(() => {
        setSelectedTimezone(currentCompanyTimezone);
    }, [currentCompanyTimezone]);

    // Cargar información de la empresa
    useEffect(() => {
        const loadCompanyInfo = async () => {
            try {
                const result = await turso.execute({
                    sql: `SELECT 
                            legal_name,
                            full_address,
                            tax_id_legal,
                            phone_main,
                            email_main,
                            city,
                            country,
                            postal_code,
                            website,
                            business_type,
                            currency
                          FROM companies WHERE id = ?`,
                    args: [activeCompanyId]
                });

                if (result.rows.length > 0) {
                    const data = result.rows[0];
                    setCompanyInfo({
                        legal_name: data.legal_name || '',
                        full_address: data.full_address || '',
                        tax_id_legal: data.tax_id_legal || '',
                        phone_main: data.phone_main || '',
                        email_main: data.email_main || '',
                        city: data.city || '',
                        country: data.country || 'Chile',
                        postal_code: data.postal_code || '',
                        website: data.website || '',
                        business_type: data.business_type || '',
                        currency: data.currency || 'CLP'
                    });
                }
            } catch (e) {
                console.error('Error loading company info:', e);
            }
        };

        if (activeCompanyId) {
            loadCompanyInfo();
        }
    }, [activeCompanyId]);

    const timezones = [
        { value: 'America/Santiago', label: 'Chile (Santiago)' },
        { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
        { value: 'America/Mexico_City', label: 'México (Ciudad de México)' },
        { value: 'America/Bogota', label: 'Colombia (Bogotá)' },
        { value: 'America/Lima', label: 'Perú (Lima)' },
        { value: 'America/Caracas', label: 'Venezuela (Caracas)' },
        { value: 'America/Sao_Paulo', label: 'Brasil (São Paulo)' },
        { value: 'Europe/Madrid', label: 'España (Madrid)' },
        { value: 'America/New_York', label: 'USA (Nueva York)' },
    ];

    const handleTimezoneChange = async (newTimezone) => {
        try {
            await turso.execute({
                sql: 'UPDATE companies SET timezone = ? WHERE id = ?',
                args: [newTimezone, activeCompanyId]
            });
            setSelectedTimezone(newTimezone);
            await fetchInitialData(); // Reload to update store
            alert('Zona horaria actualizada correctamente');
        } catch (e) {
            console.error('Error updating timezone:', e);
            alert('Error al actualizar zona horaria');
        }
    };

    const handleSaveCompanyInfo = async () => {
        setIsSavingCompanyInfo(true);
        try {
            await turso.execute({
                sql: `UPDATE companies SET 
                        legal_name = ?,
                        full_address = ?,
                        tax_id_legal = ?,
                        phone_main = ?,
                        email_main = ?,
                        city = ?,
                        country = ?,
                        postal_code = ?,
                        website = ?,
                        business_type = ?,
                        currency = ?
                      WHERE id = ?`,
                args: [
                    companyInfo.legal_name,
                    companyInfo.full_address,
                    companyInfo.tax_id_legal,
                    companyInfo.phone_main,
                    companyInfo.email_main,
                    companyInfo.city,
                    companyInfo.country,
                    companyInfo.postal_code,
                    companyInfo.website,
                    companyInfo.business_type,
                    companyInfo.currency,
                    activeCompanyId
                ]
            });
            alert('✅ Información de la empresa guardada correctamente');
        } catch (e) {
            console.error('Error saving company info:', e);
            alert('❌ Error al guardar información de la empresa');
        } finally {
            setIsSavingCompanyInfo(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text mb-6">Configuración</h1>

            <div className="flex flex-col md:flex-row gap-6">
                {/* SIDEBAR NAVIGATION */}
                <div className="w-full md:w-64 flex-shrink-0">
                    <div className="glass-card p-2 space-y-1">
                        {[
                            { id: 'general', label: 'General', icon: SettingsIcon, permission: null },
                            { id: 'company', label: 'Empresa', icon: Building2, permission: 'settings.company' },
                            { id: 'receipts', label: 'Boletas', icon: FileText, permission: 'settings.receipts' },
                            { id: 'payments', label: 'Medios de Pago', icon: CreditCard, permission: 'settings.payments' },
                            { id: 'permissions', label: 'Permisos', icon: Shield, permission: 'settings.manage_permissions' },
                            { id: 'system', label: 'Sistema', icon: Wrench, permission: 'settings.system' },
                        ].filter(item => !item.permission || can(item.permission)).map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveTab(item.id)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${activeTab === item.id
                                        ? 'bg-[var(--color-primary)] text-white shadow-lg'
                                        : 'text-[var(--color-text-muted)] hover:bg-[var(--glass-border)] hover:text-[var(--color-text)]'
                                        }`}
                                >
                                    <Icon size={18} />
                                    <span className="font-medium">{item.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* CONTENT AREA */}
                <div className="flex-1 space-y-6">
                    {activeTab === 'general' && (
                        <>
                            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Información del Sistema</h2>
                                <div className="space-y-4">
                                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                                        <span className="text-[var(--color-text-muted)]">Versión</span>
                                        <span className="text-[var(--color-text)] font-mono">1.2.1 (Futuristic Build)</span>
                                    </div>
                                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                                        <span className="text-[var(--color-text-muted)]">Desarrollador</span>
                                        <span className="text-[var(--color-text)]">POSVECI Dev</span>
                                    </div>
                                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                                        <span className="text-[var(--color-text-muted)]">Estado de Licencia</span>
                                        <span className="text-[var(--color-primary)] font-bold">Activa</span>
                                    </div>
                                </div>
                            </div>



                            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Apariencia</h2>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {darkMode ? <Moon className="text-[var(--color-primary)]" /> : <Sun className="text-yellow-500" />}
                                        <span className="text-[var(--color-text)]">Modo {darkMode ? 'Oscuro (Neón)' : 'Claro'}</span>
                                    </div>
                                    <div
                                        onClick={toggleDarkMode}
                                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors duration-300 ${darkMode ? 'bg-[var(--color-primary)]' : 'bg-gray-300'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${darkMode ? 'right-1' : 'left-1'}`}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
                                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Zona Horaria de la Empresa</h2>
                                <div className="flex flex-col gap-4">
                                    <p className="text-sm text-[var(--color-text-muted)]">
                                        Configura la zona horaria para el registro correcto de ventas y reportes
                                    </p>
                                    <div className="flex items-center gap-4">
                                        <select
                                            value={selectedTimezone}
                                            onChange={(e) => handleTimezoneChange(e.target.value)}
                                            className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] w-full max-w-md focus:outline-none focus:border-[var(--color-primary)]"
                                        >
                                            {timezones.map(tz => (
                                                <option key={tz.value} value={tz.value} className="bg-[#1a1a2e] text-white">
                                                    {tz.label}
                                                </option>
                                            ))}
                                        </select>
                                        <span className="text-xs text-[var(--color-text-muted)]">
                                            Actual: {currentCompanyTimezone}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === 'company' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* INFORMACIÓN DE LA EMPRESA */}
                            <div className="glass-card border border-blue-500/30">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-blue-500/20 rounded-lg">
                                        <Building2 className="text-blue-400" size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-blue-400">Información de la Empresa</h2>
                                        <p className="text-sm text-[var(--color-text-muted)]">Datos legales y corporativos de tu negocio</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Nombre Legal */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Nombre Legal de la Empresa *
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.legal_name}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, legal_name: e.target.value })}
                                            placeholder="Ej: VECI Distribuidora SPA"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* RUT/NIT */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            RUT / NIT / RFC *
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.tax_id_legal}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, tax_id_legal: e.target.value })}
                                            placeholder="Ej: 76.XXX.XXX-X"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Dirección Completa */}
                                    <div className="lg:col-span-2">
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Dirección Completa *
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.full_address}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, full_address: e.target.value })}
                                            placeholder="Ej: Av. Principal 1234, Oficina 501"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Ciudad */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Ciudad / Comuna
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.city}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, city: e.target.value })}
                                            placeholder="Ej: Iquique"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* País */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            País
                                        </label>
                                        <select
                                            value={companyInfo.country}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, country: e.target.value })}
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        >
                                            <option value="Chile">Chile</option>
                                            <option value="Argentina">Argentina</option>
                                            <option value="México">México</option>
                                            <option value="Colombia">Colombia</option>
                                            <option value="Perú">Perú</option>
                                            <option value="Venezuela">Venezuela</option>
                                            <option value="Brasil">Brasil</option>
                                            <option value="España">España</option>
                                            <option value="Estados Unidos">Estados Unidos</option>
                                            <option value="Otro">Otro</option>
                                        </select>
                                    </div>

                                    {/* Código Postal */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Código Postal
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.postal_code}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, postal_code: e.target.value })}
                                            placeholder="Ej: 1100000"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Teléfono */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Teléfono Principal
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.phone_main}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, phone_main: e.target.value })}
                                            placeholder="Ej: +56 9 1234 5678"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Email */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Email Principal
                                        </label>
                                        <input
                                            type="email"
                                            value={companyInfo.email_main}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, email_main: e.target.value })}
                                            placeholder="Ej: contacto@miempresa.cl"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Sitio Web */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Sitio Web
                                        </label>
                                        <input
                                            type="url"
                                            value={companyInfo.website}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, website: e.target.value })}
                                            placeholder="Ej: https://www.miempresa.cl"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Giro/Rubro */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Giro / Rubro del Negocio
                                        </label>
                                        <input
                                            type="text"
                                            value={companyInfo.business_type}
                                            onChange={(e) => setCompanyInfo({ ...companyInfo, business_type: e.target.value })}
                                            placeholder="Ej: Comercio al por menor"
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        />
                                    </div>

                                    {/* Moneda */}
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                                            Moneda
                                        </label>
                                        <select
                                            value={companyInfo.currency}
                                            onChange={async (e) => {
                                                const newCurrency = e.target.value;
                                                setCompanyInfo({ ...companyInfo, currency: newCurrency });

                                                // Actualizar en la base de datos y store inmediatamente
                                                const result = await updateCurrency(newCurrency);
                                                if (result.success) {
                                                    console.log('✅ Moneda actualizada en el sistema');
                                                }
                                            }}
                                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                                        >
                                            <option value="CLP">CLP - Peso Chileno ($)</option>
                                            <option value="ARS">ARS - Peso Argentino ($)</option>
                                            <option value="MXN">MXN - Peso Mexicano ($)</option>
                                            <option value="COP">COP - Peso Colombiano ($)</option>
                                            <option value="PEN">PEN - Sol Peruano (S/)</option>
                                            <option value="VES">VES - Bolívar Venezolano (Bs)</option>
                                            <option value="BRL">BRL - Real Brasileño (R$)</option>
                                            <option value="EUR">EUR - Euro (€)</option>
                                            <option value="USD">USD - Dólar Americano ($)</option>
                                        </select>
                                        <p className="text-xs text-[var(--color-text-muted)] mt-2">
                                            💡 Al cambiar la moneda, todos los precios del sistema se mostrarán con el nuevo formato automáticamente.
                                        </p>
                                    </div>
                                </div>

                                {/* Botón Guardar */}
                                <div className="mt-6">
                                    <button
                                        onClick={handleSaveCompanyInfo}
                                        disabled={isSavingCompanyInfo || !companyInfo.legal_name || !companyInfo.full_address}
                                        className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Save size={16} />
                                        {isSavingCompanyInfo ? 'Guardando...' : 'Guardar Información de Empresa'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'receipts' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <ReceiptSettings companyInfo={companyInfo} />
                        </div>
                    )}

                    {activeTab === 'payments' && (
                        <PaymentMethodsSettings />
                    )}

                    {activeTab === 'permissions' && (
                        <PermissionsSettings />
                    )}

                    {activeTab === 'system' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="glass-card">
                                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Inventario y Ajustes</h2>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[var(--color-text)] font-medium">Modo Ajuste de Inventario</span>
                                            <span className="bg-yellow-500/20 text-yellow-500 text-xs px-2 py-0.5 rounded border border-yellow-500/30">Precaución</span>
                                        </div>
                                        <p className="text-sm text-[var(--color-text-muted)] max-w-xl">
                                            Permite vender productos sin stock o con stock negativo para regularización inicial.
                                            No permite vender lotes vencidos.
                                        </p>
                                    </div>
                                    <div
                                        onClick={async () => {
                                            const result = await toggleInventoryAdjustmentMode();
                                            if (!result.success) {
                                                alert('Error al actualizar la configuración: ' + result.error);
                                            }
                                        }}
                                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors duration-300 ${inventoryAdjustmentMode ? 'bg-yellow-500' : 'bg-gray-700'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${inventoryAdjustmentMode ? 'right-1' : 'left-1'}`}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="glass-card border border-cyan-500/30">
                                <h2 className="text-xl font-bold text-cyan-400 mb-4 flex items-center gap-2">
                                    ⚡ Optimización de Sistema
                                </h2>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <p className="text-[var(--color-text)] font-medium">Recompresión Masiva de Imágenes</p>
                                        <p className="text-sm text-[var(--color-text-muted)] max-w-xl">
                                            Escanea todos los productos y comprime imágenes antiguas que sean muy pesadas (&gt;200KB).
                                            Ejecutar solo una vez si el sistema está lento.
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (window.confirm('¿Iniciar optimización de imágenes? Esto puede tardar unos minutos.')) {
                                                await recompressAllImages();
                                            }
                                        }}
                                        className="btn-primary flex items-center gap-2"
                                    >
                                        📸 Optimizar Imágenes
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );


};

export default Settings;
