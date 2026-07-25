import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { dataApiCall } from '../lib/dataApi';
import { Receipt, FileText, ToggleLeft, ToggleRight, Save, Loader2, Info } from 'lucide-react';

const DTE_TYPES = [
    { tipo: 0, label: 'Nota de Venta', icon: Receipt, color: 'green', description: 'Documento interno sin envío al SII — no se declara la venta' },
    { tipo: 39, label: 'Boleta Electrónica', icon: Receipt, color: 'blue', description: 'Documento para ventas a consumidor final sin RUT' },
    { tipo: 33, label: 'Factura Electrónica', icon: FileText, color: 'purple', description: 'Documento tributario con IVA para clientes con RUT' },
    { tipo: 34, label: 'Factura Exenta Electrónica', icon: FileText, color: 'amber', description: 'Documento sin IVA para productos/servicios exentos' },
];

const FolioSettings = () => {
    const { activeCompanyId } = useStore();
    const [enabledDtes, setEnabledDtes] = useState([0]);
    const [defaultDte, setDefaultDte] = useState(0);
    const [folioInfo, setFolioInfo] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!activeCompanyId) return;
        loadSettings();
    }, [activeCompanyId]);

    const loadSettings = async () => {
        setLoading(true);

        // 1) Config (tipos habilitados / predeterminado) — best-effort. Si esta llamada
        //    falla, quedan los valores por defecto, pero NO impide leer los folios.
        try {
            const _fs = await dataApiCall('folioSettingsLoad', { companyId: activeCompanyId });
            const cfg = _fs?.success ? _fs.config : null;
            if (cfg && cfg.enabled_dtes) {
                try { setEnabledDtes(JSON.parse(cfg.enabled_dtes)); } catch { setEnabledDtes([0]); }
            } else {
                setEnabledDtes([0]);
            }
            setDefaultDte(cfg && cfg.default_dte != null ? Number(cfg.default_dte) : 0);
        } catch (err) {
            console.warn('folioSettingsLoad falló:', err?.message);
            setEnabledDtes([0]);
            setDefaultDte(0);
        }

        // 2) Disponibilidad de folios — SIEMPRE desde /api/sii/folios, INDEPENDIENTE de
        //    lo anterior. Es la fuente confiable (agrega todos los CAF activos por tipo)
        //    y evita el bug donde un tipo con folios aparecía como "Sin folios cargados".
        try {
            const info = {};
            const res = await fetch('/api/sii/folios', { headers: { 'x-company-id': activeCompanyId } });
            const data = await res.json();
            for (const f of (data.folios || [])) {
                const disp = f.disponibles != null ? f.disponibles : (Number(f.folio_hasta) - Number(f.folio_actual) + 1);
                if (!info[f.tipo_dte]) info[f.tipo_dte] = { folioActual: f.folio_actual, folioHasta: f.folio_hasta, disponibles: 0 };
                info[f.tipo_dte].folioActual = f.folio_actual;
                info[f.tipo_dte].folioHasta = f.folio_hasta;
                info[f.tipo_dte].disponibles += disp > 0 ? disp : 0;
            }
            setFolioInfo(info);
        } catch (err) {
            console.warn('/api/sii/folios falló:', err?.message);
        }

        setLoading(false);
    };

    const toggleDte = (tipo) => {
        // Block activating DTE types without folios (except Nota de Venta)
        if (!enabledDtes.includes(tipo) && tipo !== 0 && !folioInfo[tipo]) {
            alert(`No puedes activar ${DTE_TYPES.find(d => d.tipo === tipo)?.label || 'este tipo'} porque no tienes folios (CAF) cargados. Sube los folios primero desde Documentos SII.`);
            return;
        }
        setEnabledDtes(prev => {
            if (prev.includes(tipo)) {
                // Don't allow disabling all
                if (prev.length <= 1) return prev;
                const next = prev.filter(t => t !== tipo);
                // If we're disabling the default, switch default to first remaining
                if (tipo === defaultDte) {
                    setDefaultDte(next[0]);
                }
                return next;
            }
            return [...prev, tipo].sort((a, b) => a - b);
        });
        setSaved(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Strip DTE types without folios (safety check)
            const validDtes = enabledDtes.filter(tipo => tipo === 0 || !!folioInfo[tipo]);
            if (validDtes.length === 0) validDtes.push(0);
            setEnabledDtes(validDtes);
            if (!validDtes.includes(defaultDte)) {
                setDefaultDte(validDtes[0]);
            }
            const saveDefault = validDtes.includes(defaultDte) ? defaultDte : validDtes[0];

            const _sv = await dataApiCall('folioSettingsSave', { companyId: activeCompanyId, enabledDtes: validDtes, defaultDte: saveDefault });
            if (!_sv?.success) throw new Error(_sv?.error || 'Error');
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err) {
            console.error('Error saving folio settings:', err);
            alert('Error al guardar la configuración');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-400" size={32} />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">Activar / Desactivar Folios</h1>
            <p className="text-[var(--color-text-muted)] mb-6">
                Selecciona qué tipos de documento estarán disponibles en el punto de venta.
            </p>

            <div className="space-y-4">
                {DTE_TYPES.map(({ tipo, label, icon: Icon, color, description }) => {
                    const enabled = enabledDtes.includes(tipo);
                    const folio = folioInfo[tipo];
                    // Un tipo ya habilitado (enabled_dtes) siempre es operable, aunque
                    // la carga de disponibilidad falle. Así Boleta 39 (activa por
                    // debajo) no aparece como "Sin folios cargados".
                    const canActivate = tipo === 0 || !!folio || enabled;
                    const colorMap = {
                        green: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', shadow: 'shadow-green-500/10' },
                        blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', shadow: 'shadow-blue-500/10' },
                        purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', shadow: 'shadow-purple-500/10' },
                        amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', shadow: 'shadow-amber-500/10' },
                    };
                    const c = colorMap[color];

                    return (
                        <div
                            key={tipo}
                            className={`glass-card p-5 rounded-xl border transition-all ${
                                enabled
                                    ? `${c.border} ${c.bg} shadow-lg ${c.shadow}`
                                    : 'border-[var(--glass-border)] opacity-60'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-lg ${enabled ? c.bg : 'bg-[var(--glass-bg)]'}`}>
                                        <Icon size={24} className={enabled ? c.text : 'text-[var(--color-text-muted)]'} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-[var(--color-text)]">
                                            {tipo === 0 ? label : `Tipo ${tipo} — ${label}`}
                                        </h3>
                                        <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
                                        {folio && (
                                            <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                                Folio actual: <span className="font-mono">{folio.folioActual}</span> · 
                                                Disponibles: <span className={`font-bold ${folio.disponibles < 10 ? 'text-red-400' : 'text-green-400'}`}>
                                                    {folio.disponibles}
                                                </span>
                                            </p>
                                        )}
                                        {!folio && !enabled && tipo !== 0 && (
                                            <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                                                <Info size={12} /> Sin folios cargados (CAF) — no se puede activar
                                            </p>
                                        )}
                                        {!folio && enabled && tipo !== 0 && (
                                            <p className="text-xs text-green-400 mt-1">Activado</p>
                                        )}
                                        {tipo === 0 && (
                                            <p className="text-xs text-green-400 mt-1">No requiere folios</p>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={() => toggleDte(tipo)}
                                    disabled={!canActivate && !enabled}
                                    className={`flex-shrink-0 transition-transform ${canActivate || enabled ? 'hover:scale-110' : 'opacity-30 cursor-not-allowed'}`}
                                    title={!canActivate && !enabled ? 'Necesitas cargar folios (CAF) primero' : enabled ? 'Desactivar' : 'Activar'}
                                >
                                    {enabled ? (
                                        <ToggleRight size={40} className={c.text} />
                                    ) : (
                                        <ToggleLeft size={40} className="text-gray-500" />
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    Guardar
                </button>
                {saved && (
                    <span className="text-green-400 text-sm font-medium animate-in fade-in">
                        ✓ Configuración guardada
                    </span>
                )}
            </div>

            {/* Default DTE selector */}
            <div className="mt-6 glass-card p-5 rounded-xl border border-[var(--glass-border)]">
                <label className="block text-sm font-bold text-[var(--color-text)] mb-3">Documento predeterminado en POS</label>
                <select
                    value={defaultDte}
                    onChange={(e) => { setDefaultDte(Number(e.target.value)); setSaved(false); }}
                    className="w-full py-2.5 px-3 rounded-lg text-sm font-semibold bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--glass-border)] focus:outline-none focus:border-blue-500"
                >
                    {enabledDtes.includes(0) && <option value={0}>📝 Nota de Venta (sin SII)</option>}
                    {enabledDtes.includes(39) && <option value={39}>📄 Boleta Electrónica (39)</option>}
                    {enabledDtes.includes(33) && <option value={33}>📋 Factura Electrónica (33)</option>}
                    {enabledDtes.includes(34) && <option value={34}>📋 Factura Exenta (34)</option>}
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">Este documento se seleccionará automáticamente al cargar el POS.</p>
            </div>

            <div className="mt-6 glass-card p-4 rounded-lg border border-[var(--glass-border)]">
                <p className="text-xs text-[var(--color-text-muted)]">
                    <strong>Nota:</strong> Solo los tipos de documento activados aparecerán como opción en el punto de venta (POS).
                    Debes tener al menos un tipo activado. Los folios (CAF) se cargan desde la página de Documentos SII.
                </p>
            </div>
        </div>
    );
};

export default FolioSettings;
