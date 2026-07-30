import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { dataApiCall, reportCall } from '../lib/dataApi';
import { Moon, Sun, Settings as SettingsIcon, FileText, Smartphone, Wrench, Building2, Save, CreditCard, Volume2, Play, ChefHat, Tv, Copy, Check, ExternalLink, Scale, Crown } from 'lucide-react';
import ScaleConfig from '../components/ScaleConfig';

import { recompressAllImages } from '../scripts/recompressImages';
import ReceiptSettings from '../components/settings/ReceiptSettings';
import PaymentMethodsSettings from '../components/settings/PaymentMethodsSettings';
import PermissionsSettings from '../components/settings/PermissionsSettings';
import StoreIntegrationSettings from '../components/settings/StoreIntegrationSettings';
import SiiSettings from '../components/settings/SiiSettings';
import PlanSettings from '../components/settings/PlanSettings';
import { Shield, Stamp } from 'lucide-react';
import { formatCurrency, getCurrencySymbol } from '../utils/formatCurrency';
import { usePermissions } from '../hooks/usePermissions';
import { PRODUCTION_SOUNDS, getProductionSound, setProductionSound, playProductionSound } from '../utils/productionSounds';
import { cn } from '../lib/utils';
import ThermalPrinterSettings from '../components/settings/ThermalPrinterSettings';

const Settings = () => {
    const { darkMode, toggleDarkMode, inventoryAdjustmentMode, toggleInventoryAdjustmentMode, activeCompanyId, currentCompanyTimezone, fetchInitialData, updateCurrency, checkSubscriptionStatus, currentUser, currentUserCompanyRole, hasModule } = useStore();
    const canPreorders = hasModule('preorders');

    // Contratar/gestionar el plan es SOLO del dueño (owner), no del personal (aunque sea Administrador).
    const isOwner = currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin' || currentUser?.role === 'super_admin';
    const { can } = usePermissions();
    const [selectedTimezone, setSelectedTimezone] = useState(currentCompanyTimezone);

    // Suscripción / Plan (para mostrar plan y vencimiento en "Información del Sistema")
    const [subInfo, setSubInfo] = useState(null);
    useEffect(() => {
        if (activeCompanyId && checkSubscriptionStatus) {
            checkSubscriptionStatus(activeCompanyId).then(setSubInfo).catch(() => setSubInfo(null));
        }
    }, [activeCompanyId, checkSubscriptionStatus]);

    const formatSubDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const SUB_STATUS = {
        trial: { label: 'Prueba', color: 'text-blue-400' },
        active: { label: 'Activa', color: 'text-[var(--color-primary)]' },
        past_due: { label: 'Vencida', color: 'text-red-400' },
        suspended: { label: 'Suspendida', color: 'text-red-400' },
        cancelled: { label: 'Cancelada', color: 'text-red-400' },
        pending_payment: { label: 'Pago pendiente', color: 'text-yellow-400' },
    };
    const subStatus = SUB_STATUS[subInfo?.status] || { label: 'Activa', color: 'text-[var(--color-primary)]' };

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

    // Pantalla de Cocina (TV) — link con token secreto por empresa
    const [kdsToken, setKdsToken] = useState('');
    const [kdsCopied, setKdsCopied] = useState(false);
    const kdsUrl = kdsToken
        ? `${window.location.origin}/kds.html?token=${kdsToken}`
        : '';
    const handleCopyKds = async () => {
        if (!kdsUrl) return;
        try {
            await navigator.clipboard.writeText(kdsUrl);
        } catch {
            // Fallback para navegadores viejos / sin permiso de clipboard
            const ta = document.createElement('textarea');
            ta.value = kdsUrl;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* noop */ }
            document.body.removeChild(ta);
        }
        setKdsCopied(true);
        setTimeout(() => setKdsCopied(false), 2000);
    };

    // La sección activa viene de la URL (/settings/:tab); el menú vive en la barra lateral.
    const { tab } = useParams();
    const TAB_PERMISSIONS = {
        general: 'settings.view',
        plan: 'settings.company',
        company: 'settings.company',
        receipts: 'settings.receipts',
        payments: 'settings.payments',
        integrations: 'settings.system',
        scale: 'settings.system',
        sii: 'settings.system',
        permissions: 'settings.manage_permissions',
        system: 'settings.system',
    };
    const requested = tab && TAB_PERMISSIONS[tab] ? tab : 'general';
    // 'plan' requiere ser dueño (no basta el permiso settings.company que tiene el Administrador).
    const canOpenTab = (t) => t === 'general' ? true : (t === 'plan' ? isOwner : can(TAB_PERMISSIONS[t]));
    const activeTab = canOpenTab(requested) ? requested : 'general';

    // Sonido de nuevos pedidos en Producción
    const [productionSoundId, setProductionSoundId] = useState(getProductionSound());
    const [savedSoundId, setSavedSoundId] = useState(getProductionSound());
    const handleSaveProductionSound = async () => {
        setProductionSound(productionSoundId); // localStorage (pantalla Producción)
        setSavedSoundId(productionSoundId);
        // Persistir también en la empresa para que la pantalla KDS (TV) use el
        // mismo sonido (la TV no comparte localStorage con el POS).
        try {
            if (activeCompanyId) {
                await dataApiCall('companyFieldsUpdate', { companyId: activeCompanyId, fields: { kds_sound: productionSoundId } });
            }
        } catch (e) {
            console.error('Error guardando sonido KDS en empresa:', e);
        }
    };

    useEffect(() => {
        setSelectedTimezone(currentCompanyTimezone);
    }, [currentCompanyTimezone]);

    // Cargar información de la empresa
    useEffect(() => {
        const loadCompanyInfo = async () => {
            try {
                const result = { rows: await reportCall(activeCompanyId, 'companyInfo', {}) };

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
                    // Si la empresa aún no tiene token de Pantalla de Cocina, se
                    // genera al vuelo (antes se quedaba "Cargando…" para siempre).
                    let token = data.kds_token || '';
                    if (!token) {
                        try {
                            const ensured = await dataApiCall('kdsTokenEnsure', { companyId: activeCompanyId });
                            if (ensured?.success && ensured.kds_token) token = ensured.kds_token;
                        } catch { /* si falla, queda vacío y se reintenta al recargar */ }
                    }
                    setKdsToken(token);
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
            await dataApiCall('companyFieldsUpdate', { companyId: activeCompanyId, fields: { timezone: newTimezone } });
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
            // Se revisa la respuesta: antes se avisaba "guardado" sin mirarla, así que
            // un fallo del servidor pasaba desapercibido y los datos se perdían al
            // recargar.
            const r = await dataApiCall('companyFieldsUpdate', {
                companyId: activeCompanyId,
                fields: {
                    legal_name: companyInfo.legal_name,
                    full_address: companyInfo.full_address,
                    tax_id_legal: companyInfo.tax_id_legal,
                    phone_main: companyInfo.phone_main,
                    email_main: companyInfo.email_main,
                    city: companyInfo.city,
                    country: companyInfo.country,
                    postal_code: companyInfo.postal_code,
                    website: companyInfo.website,
                    business_type: companyInfo.business_type,
                    currency: companyInfo.currency,
                },
            });
            if (!r?.success) {
                alert('❌ No se pudo guardar: ' + (r?.error || 'el servidor rechazó el cambio'));
                return;
            }
            alert('✅ Información de la empresa guardada correctamente');
        } catch (e) {
            console.error('Error saving company info:', e);
            alert('❌ Error al guardar información de la empresa');
        } finally {
            setIsSavingCompanyInfo(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-[var(--color-text)] neon-text mb-6">Configuración</h1>

            <div className="flex flex-col gap-6">
                {/* CONTENT AREA (el menú de secciones vive en la barra lateral izquierda) */}
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
                                        <span className={cn("font-bold", subStatus.color)}>{subStatus.label}</span>
                                    </div>
                                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                                        <span className="text-[var(--color-text-muted)]">Plan</span>
                                        <span className="text-[var(--color-text)] font-bold">{subInfo?.planLabel || '—'}</span>
                                    </div>
                                    <div className="flex justify-between border-b border-[var(--glass-border)] pb-2">
                                        <span className="text-[var(--color-text-muted)]">
                                            {subInfo?.status === 'trial' ? 'Prueba vence' : 'Vencimiento'}
                                        </span>
                                        <span className="text-[var(--color-text)]">
                                            {formatSubDate(subInfo?.expiresAt)}
                                            {subInfo?.status === 'trial' && Number.isFinite(subInfo?.daysRemaining) && (
                                                <span className="text-[var(--color-text-muted)] ml-2">
                                                    ({subInfo.daysRemaining} días)
                                                </span>
                                            )}
                                        </span>
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

                            {/* ===== SONIDO DE NUEVOS PEDIDOS (PRODUCCIÓN) — solo con módulo Pedidos (Medium+) ===== */}
                            {canPreorders && (<>
                            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
                                <div className="flex items-start gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/25 shrink-0">
                                        <ChefHat size={20} className="text-white" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                                            Sonido de Nuevos Pedidos
                                            <Volume2 size={18} className="text-[var(--color-primary)]" />
                                        </h2>
                                        <p className="text-sm text-[var(--color-text-muted)]">
                                            Sonido que se reproducirá en la pantalla de Producción y en la pantalla de Cocina (TV) cuando ingrese un nuevo pedido del día.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">
                                    {PRODUCTION_SOUNDS.map(s => {
                                        const isSelected = productionSoundId === s.id;
                                        const isSaved = savedSoundId === s.id;
                                        return (
                                            <div key={s.id}
                                                onClick={() => setProductionSoundId(s.id)}
                                                className={cn(
                                                    "rounded-xl border p-3 cursor-pointer transition-all flex items-center gap-3",
                                                    isSelected
                                                        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] shadow-md shadow-[var(--color-primary)]/20"
                                                        : "bg-[var(--glass-bg)] border-[var(--glass-border)] hover:border-[var(--color-primary)]/40"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                                                    isSelected ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--glass-border)]"
                                                )}>
                                                    {isSelected && <div className="w-2 h-2 rounded-full bg-black" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-bold text-[var(--color-text)] truncate">{s.label}</p>
                                                        {isSaved && (
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 uppercase tracking-wider">
                                                                Activo
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-[var(--color-text-muted)] truncate">{s.description}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); playProductionSound(s.id); }}
                                                    title="Escuchar"
                                                    className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/25 hover:bg-[var(--color-primary)]/25 transition-all flex items-center gap-1.5 shrink-0 active:scale-95"
                                                >
                                                    <Play size={12} />
                                                    Escuchar
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-xs text-[var(--color-text-muted)]">
                                        {productionSoundId !== savedSoundId
                                            ? '⚠️ Tienes cambios sin guardar.'
                                            : 'Sonido actual guardado correctamente.'}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSaveProductionSound}
                                        disabled={productionSoundId === savedSoundId}
                                        className={cn(
                                            "px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all active:scale-95",
                                            productionSoundId === savedSoundId
                                                ? "bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] cursor-not-allowed"
                                                : "bg-gradient-to-r from-[var(--color-primary)] to-emerald-500 text-black shadow-lg shadow-[var(--color-primary)]/25 hover:shadow-xl"
                                        )}
                                    >
                                        <Save size={16} />
                                        Guardar Sonido
                                    </button>
                                </div>
                            </div>

                            {/* ===== PANTALLA DE COCINA (TV / KDS) — solo con módulo Pedidos (Medium+) ===== */}
                            <div className="glass-card animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
                                <div className="flex items-start gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/25 shrink-0">
                                        <Tv size={20} className="text-white" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-bold text-[var(--color-text)]">
                                            Pantalla de Cocina (TV)
                                        </h2>
                                        <p className="text-sm text-[var(--color-text-muted)]">
                                            Abre este link en el navegador de tu TV para mostrar los pedidos del día en cocina. Solo lectura, se actualiza solo. No pide login.
                                        </p>
                                    </div>
                                </div>

                                {kdsUrl ? (
                                    <>
                                        <div className="flex items-center gap-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-2.5">
                                            <input
                                                type="text"
                                                readOnly
                                                value={kdsUrl}
                                                onClick={(e) => e.target.select()}
                                                className="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none min-w-0 font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleCopyKds}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all active:scale-95 shrink-0",
                                                    kdsCopied
                                                        ? "bg-emerald-500 text-black"
                                                        : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25 hover:shadow-lg"
                                                )}
                                            >
                                                {kdsCopied ? <Check size={16} /> : <Copy size={16} />}
                                                {kdsCopied ? 'Copiado' : 'Copiar'}
                                            </button>
                                            <a
                                                href={kdsUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="Abrir pantalla de cocina"
                                                className="px-3 py-2 rounded-lg text-sm font-bold bg-[var(--glass-bg)] text-[var(--color-text-muted)] border border-[var(--glass-border)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]/40 transition-all flex items-center gap-1.5 shrink-0"
                                            >
                                                <ExternalLink size={16} />
                                                Abrir
                                            </a>
                                        </div>
                                        <div className="mt-3 text-xs text-[var(--color-text-muted)] space-y-1">
                                            <p>💡 Guárdalo como favorito o página de inicio en la TV para no escribirlo cada vez.</p>
                                            <p>🔒 Este link es secreto y único de tu empresa. No lo compartas fuera de tu negocio.</p>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-[var(--color-text-muted)] italic">
                                        Cargando link de la pantalla de cocina…
                                    </p>
                                )}
                            </div>
                            </>)}

                            {/* Impresora térmica Bluetooth — solo se muestra en la app nativa */}
                            <ThermalPrinterSettings />
                        </>
                    )}

                    {activeTab === 'plan' && (
                        <PlanSettings />
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

                    {activeTab === 'integrations' && (
                        <StoreIntegrationSettings />
                    )}

                    {activeTab === 'scale' && (
                        <ScaleConfig />
                    )}

                    {activeTab === 'sii' && (
                        <SiiSettings />
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
