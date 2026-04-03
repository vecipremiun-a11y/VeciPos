import React, { useEffect, useState, useRef } from 'react';
import { Save, Upload, RefreshCw, AlertTriangle, CheckCircle, XCircle, FileText, Shield } from 'lucide-react';
import { useStore } from '../../store/useStore';

const SiiSettings = () => {
    const { activeCompanyId } = useStore();

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingCert, setIsUploadingCert] = useState(false);
    const [isRequestingCAF, setIsRequestingCAF] = useState(false);
    const [message, setMessage] = useState(null);
    const certInputRef = useRef(null);

    const [form, setForm] = useState({
        rut_emisor: '',
        razon_social: '',
        giro: '',
        direccion: '',
        comuna: '',
        ciudad: '',
        acteco: '',
        ambiente: 'certificacion',
        sii_resolution_number: '',
        sii_resolution_date: '',
        auto_emit: true,
        is_active: false,
    });

    const [hasCert, setHasCert] = useState(false);
    const [certPassword, setCertPassword] = useState('');
    const [folios, setFolios] = useState([]);
    const [cafTipo, setCafTipo] = useState(39);
    const [cafCantidad, setCafCantidad] = useState(50);

    const showMessage = (text, type = 'success') => {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 5000);
    };

    const apiHeaders = () => ({
        'Content-Type': 'application/json',
        'x-company-id': activeCompanyId,
    });

    // Load config
    useEffect(() => {
        if (!activeCompanyId) return;
        const load = async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/sii/config`, { headers: apiHeaders() });
                const data = await res.json();
                if (data.config) {
                    setForm({
                        rut_emisor: data.config.rut_emisor || '',
                        razon_social: data.config.razon_social || '',
                        giro: data.config.giro || '',
                        direccion: data.config.direccion || '',
                        comuna: data.config.comuna || '',
                        ciudad: data.config.ciudad || '',
                        acteco: data.config.acteco || '',
                        ambiente: data.config.ambiente || 'certificacion',
                        sii_resolution_number: data.config.sii_resolution_number || '',
                        sii_resolution_date: data.config.sii_resolution_date || '',
                        auto_emit: Boolean(data.config.auto_emit),
                        is_active: Boolean(data.config.is_active),
                    });
                    setHasCert(Boolean(data.config.has_cert));
                }
            } catch (e) {
                console.error('Error loading SII config:', e);
            } finally {
                setIsLoading(false);
            }
        };
        load();
        loadFolios();
    }, [activeCompanyId]);

    const loadFolios = async () => {
        try {
            const res = await fetch(`/api/sii/folios`, { headers: apiHeaders() });
            const data = await res.json();
            if (data.folios) setFolios(data.folios);
        } catch (e) {
            console.error('Error loading folios:', e);
        }
    };

    const handleSave = async () => {
        if (!form.rut_emisor || !form.razon_social || !form.giro) {
            showMessage('RUT, Razón Social y Giro son obligatorios', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const res = await fetch(`/api/sii/config`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (res.ok) {
                showMessage('Configuración SII guardada correctamente');
            } else {
                showMessage(data.error || 'Error al guardar', 'error');
            }
        } catch (e) {
            showMessage('Error de conexión', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleUploadCert = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!certPassword) {
            showMessage('Ingresa la contraseña del certificado', 'error');
            return;
        }

        setIsUploadingCert(true);
        try {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const res = await fetch(`/api/sii/upload-cert`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({ pfx_base64: base64, password: certPassword }),
            });
            const data = await res.json();
            if (res.ok) {
                setHasCert(true);
                setCertPassword('');
                showMessage('Certificado digital cargado correctamente');
            } else {
                showMessage(data.error || 'Error al cargar certificado', 'error');
            }
        } catch (e) {
            console.error('Upload cert error:', e);
            showMessage(`Error al procesar el certificado: ${e.message}`, 'error');
        } finally {
            setIsUploadingCert(false);
            if (certInputRef.current) certInputRef.current.value = '';
        }
    };

    const handleRequestCAF = async () => {
        setIsRequestingCAF(true);
        try {
            const res = await fetch(`/api/sii/request-caf`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({ tipo_dte: cafTipo, cantidad: cafCantidad }),
            });
            const data = await res.json();
            if (res.ok) {
                showMessage(`Folios solicitados: ${data.folio_desde} - ${data.folio_hasta}`);
                loadFolios();
            } else {
                showMessage(data.error || 'Error al solicitar folios', 'error');
            }
        } catch (e) {
            showMessage('Error de conexión al solicitar folios', 'error');
        } finally {
            setIsRequestingCAF(false);
        }
    };

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    if (isLoading) {
        return (
            <div className="glass-card animate-in fade-in p-8 flex items-center justify-center">
                <RefreshCw className="animate-spin mr-2" size={20} />
                <span className="text-[var(--color-text-muted)]">Cargando configuración SII...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Message */}
            {message && (
                <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${message.type === 'error'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-green-500/20 text-green-400 border border-green-500/30'
                    }`}>
                    {message.type === 'error' ? <XCircle size={16} /> : <CheckCircle size={16} />}
                    {message.text}
                </div>
            )}

            {/* Status Banner */}
            <div className={`glass-card p-4 flex items-center gap-3 ${form.is_active
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-yellow-500/30 bg-yellow-500/5'
                }`}>
                {form.is_active ? (
                    <>
                        <CheckCircle className="text-green-400" size={20} />
                        <span className="text-green-400 font-medium">Facturación electrónica activa</span>
                        <span className="text-[var(--color-text-muted)] text-sm ml-auto">
                            Ambiente: {form.ambiente === 'produccion' ? 'Producción' : 'Certificación'}
                        </span>
                    </>
                ) : (
                    <>
                        <AlertTriangle className="text-yellow-400" size={20} />
                        <span className="text-yellow-400 font-medium">Facturación electrónica inactiva</span>
                        <span className="text-[var(--color-text-muted)] text-sm ml-auto">
                            Configura los datos y sube tu certificado para activar
                        </span>
                    </>
                )}
            </div>

            {/* Company SII Data */}
            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                    <FileText size={20} />
                    Datos del Contribuyente
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">RUT Emisor *</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            placeholder="76.354.771-K"
                            value={form.rut_emisor}
                            onChange={(e) => handleChange('rut_emisor', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Razón Social *</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.razon_social}
                            onChange={(e) => handleChange('razon_social', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Giro *</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.giro}
                            onChange={(e) => handleChange('giro', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Código Actividad Económica</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            placeholder="Ej: 477310"
                            value={form.acteco}
                            onChange={(e) => handleChange('acteco', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Dirección</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.direccion}
                            onChange={(e) => handleChange('direccion', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Comuna</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.comuna}
                            onChange={(e) => handleChange('comuna', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Ciudad</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.ciudad}
                            onChange={(e) => handleChange('ciudad', e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Certificate */}
            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
                    <Shield size={20} />
                    Certificado Digital
                </h2>

                <div className="flex items-center gap-3 mb-4">
                    {hasCert ? (
                        <span className="flex items-center gap-2 text-green-400 text-sm">
                            <CheckCircle size={16} />
                            Certificado .pfx cargado
                        </span>
                    ) : (
                        <span className="flex items-center gap-2 text-yellow-400 text-sm">
                            <AlertTriangle size={16} />
                            Sin certificado — sube tu archivo .pfx para firmar documentos
                        </span>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="password"
                        className="flex-1 px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                        placeholder="Contraseña del certificado"
                        value={certPassword}
                        onChange={(e) => setCertPassword(e.target.value)}
                    />
                    <input
                        ref={certInputRef}
                        type="file"
                        accept=".pfx,.p12"
                        className="hidden"
                        onChange={handleUploadCert}
                    />
                    <button
                        onClick={() => certInputRef.current?.click()}
                        disabled={isUploadingCert || !certPassword}
                        className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white font-medium flex items-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
                    >
                        {isUploadingCert ? <RefreshCw className="animate-spin" size={16} /> : <Upload size={16} />}
                        {hasCert ? 'Reemplazar certificado' : 'Subir certificado .pfx'}
                    </button>
                </div>
            </div>

            {/* SII Config */}
            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Configuración SII</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Ambiente</label>
                        <select
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.ambiente}
                            onChange={(e) => handleChange('ambiente', e.target.value)}
                        >
                            <option value="certificacion">Certificación (pruebas)</option>
                            <option value="produccion">Producción</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Nro. Resolución SII</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            placeholder="0"
                            value={form.sii_resolution_number}
                            onChange={(e) => handleChange('sii_resolution_number', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Fecha Resolución SII</label>
                        <input
                            type="date"
                            className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={form.sii_resolution_date}
                            onChange={(e) => handleChange('sii_resolution_date', e.target.value)}
                        />
                    </div>
                </div>

                {/* Toggles */}
                <div className="space-y-3 border-t border-[var(--glass-border)] pt-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[var(--color-text)] font-medium">Auto-emisión</p>
                            <p className="text-xs text-[var(--color-text-muted)]">Emitir DTE automáticamente al completar cada venta</p>
                        </div>
                        <div
                            onClick={() => handleChange('auto_emit', !form.auto_emit)}
                            className={`w-12 h-6 rounded-full cursor-pointer transition-colors duration-300 flex items-center ${form.auto_emit ? 'bg-[var(--color-primary)] justify-end' : 'bg-gray-600 justify-start'}`}
                        >
                            <div className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[var(--color-text)] font-medium">Activar facturación electrónica</p>
                            <p className="text-xs text-[var(--color-text-muted)]">Requiere certificado, datos del contribuyente y folios activos</p>
                        </div>
                        <div
                            onClick={() => handleChange('is_active', !form.is_active)}
                            className={`w-12 h-6 rounded-full cursor-pointer transition-colors duration-300 flex items-center ${form.is_active ? 'bg-green-500 justify-end' : 'bg-gray-600 justify-start'}`}
                        >
                            <div className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
                        </div>
                    </div>
                </div>

                {/* Save button */}
                <div className="mt-6">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2 rounded-lg bg-[var(--color-primary)] text-white font-medium flex items-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
                    >
                        {isSaving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                        Guardar configuración
                    </button>
                </div>
            </div>

            {/* Folios / CAF */}
            <div className="glass-card">
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-4">Folios (CAF)</h2>

                {folios.length > 0 ? (
                    <div className="space-y-3 mb-4">
                        {folios.map((f, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                                <div>
                                    <span className="font-medium text-[var(--color-text)]">
                                        {f.tipo_dte === 39 ? 'Boleta Electrónica' : f.tipo_dte === 33 ? 'Factura Electrónica' : f.tipo_dte === 34 ? 'Factura Exenta' : `Tipo ${f.tipo_dte}`}
                                    </span>
                                    <span className="text-sm text-[var(--color-text-muted)] ml-3">
                                        Rango: {f.folio_desde} - {f.folio_hasta}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-medium ${f.available > 10 ? 'text-green-400' : f.available > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                                        {f.available} disponibles
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded ${f.estado === 'active'
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-red-500/20 text-red-400'
                                        }`}>
                                        {f.estado}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[var(--color-text-muted)] text-sm mb-4">
                        No hay folios cargados. Solicita folios al SII para comenzar a emitir documentos.
                    </p>
                )}

                <div className="flex flex-col sm:flex-row gap-3 items-end">
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Tipo DTE</label>
                        <select
                            className="px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={cafTipo}
                            onChange={(e) => setCafTipo(Number(e.target.value))}
                        >
                            <option value={39}>Boleta (39)</option>
                            <option value={33}>Factura (33)</option>
                            <option value={34}>Factura Exenta (34)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-[var(--color-text-muted)] mb-1">Cantidad</label>
                        <input
                            type="number"
                            min="1"
                            max="500"
                            className="w-24 px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
                            value={cafCantidad}
                            onChange={(e) => setCafCantidad(Number(e.target.value))}
                        />
                    </div>
                    <button
                        onClick={handleRequestCAF}
                        disabled={isRequestingCAF || !hasCert}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium flex items-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
                    >
                        {isRequestingCAF ? <RefreshCw className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                        Solicitar folios al SII
                    </button>
                </div>

                {!hasCert && (
                    <p className="text-yellow-400 text-xs mt-2">
                        Debes cargar tu certificado digital antes de solicitar folios
                    </p>
                )}
            </div>
        </div>
    );
};

export default SiiSettings;
