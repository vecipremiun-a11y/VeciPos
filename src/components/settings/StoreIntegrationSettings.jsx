import React, { useEffect, useState } from 'react';
import { RefreshCw, Save, Webhook, Store } from 'lucide-react';
import { useStore } from '../../store/useStore';

const StoreIntegrationSettings = () => {
    const { activeCompanyId, syncAllStockWithStore } = useStore();

    const [form, setForm] = useState({
        tienda_url: '',
        api_key: '',
        api_secret: '',
        webhook_secret: '',
    });

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isConfigured, setIsConfigured] = useState(false);
    const [isSyncingAllStock, setIsSyncingAllStock] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ processed: 0, total: 0, message: '' });
    const [syncSummary, setSyncSummary] = useState(null);

    const safeReadJson = async (response) => {
        const raw = await response.text();
        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return { success: false, error: `Respuesta no JSON del servidor (${response.status})`, raw };
        }
    };

    const requestIntegrationApi = async ({ method, companyId, body }) => {
        const endpoint = `/api/integration/config?company_id=${encodeURIComponent(companyId)}`;

        const response = await fetch(endpoint, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await safeReadJson(response);
        return { response, data };
    };

    useEffect(() => {
        const loadConfig = async () => {
            if (!activeCompanyId) return;

            setIsLoading(true);
            try {
                const { response, data } = await requestIntegrationApi({
                    method: 'GET',
                    companyId: activeCompanyId,
                });

                if (!data) {
                    throw new Error('El servidor respondió vacío');
                }

                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'No se pudo cargar configuración');
                }

                if (data.success && data.config) {
                    setIsConfigured(Boolean(data.config));
                    setForm({
                        tienda_url: data.config.tienda_url || '',
                        api_key: data.config.api_key || '',
                        api_secret: data.config.api_secret || '',
                        webhook_secret: data.config.webhook_secret || '',
                    });
                }
            } catch (error) {
                console.error('Error loading integration config:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadConfig();
    }, [activeCompanyId]);

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        if (!form.tienda_url || !form.api_key || !form.api_secret || !form.webhook_secret) {
            alert('Completa todos los campos obligatorios');
            return;
        }

        setIsSaving(true);
        try {
            const { response, data } = await requestIntegrationApi({
                method: 'POST',
                companyId: activeCompanyId,
                body: {
                    tienda_url: form.tienda_url,
                    api_key: form.api_key,
                    api_secret: form.api_secret,
                    webhook_secret: form.webhook_secret,
                    is_active: true,
                },
            });

            if (!data) {
                throw new Error('El servidor respondió vacío');
            }

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'No se pudo guardar la configuración');
            }

            setIsConfigured(true);
            setForm(prev => ({
                ...prev,
                api_key: '***',
                api_secret: '***',
                webhook_secret: '***',
            }));
            alert('✅ Integración guardada correctamente');
        } catch (error) {
            console.error('Error saving integration config:', error);
            alert(`❌ ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSyncAllStock = async () => {
        setSyncSummary(null);
        setSyncProgress({ processed: 0, total: 0, message: '' });
        setIsSyncingAllStock(true);

        try {
            const result = await syncAllStockWithStore((progress) => {
                setSyncProgress(progress);
            });

            setSyncSummary(result);

            if (result?.success) {
                alert(`✅ Sincronización completa: ${result.updated}/${result.total} productos actualizados`);
            } else if (result?.error) {
                alert(`❌ Error al sincronizar stock: ${result.error}`);
            } else {
                alert(`⚠️ Sincronización finalizada con errores: ${result?.updated || 0} exitosos, ${result?.failed || 0} fallidos`);
            }
        } catch (error) {
            console.error('Error syncing all stock:', error);
            alert(`❌ Error al sincronizar stock: ${error.message}`);
        } finally {
            setIsSyncingAllStock(false);
        }
    };

    return (
        <div className="glass-card border border-indigo-500/30 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                    <Store className="text-indigo-400" size={22} />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-indigo-400">Integración Tienda Online (WooCommerce)</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">Conecta la API REST y configura el token para validar webhooks</p>
                </div>
            </div>

            {isLoading ? (
                <p className="text-sm text-[var(--color-text-muted)]">Cargando configuración...</p>
            ) : (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            URL de la Tienda
                        </label>
                        <input
                            type="url"
                            value={form.tienda_url}
                            onChange={(e) => handleChange('tienda_url', e.target.value)}
                            placeholder="https://mitienda.com"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            API Consumer Key
                        </label>
                        <input
                            type="text"
                            value={form.api_key}
                            onChange={(e) => handleChange('api_key', e.target.value)}
                            placeholder="ck_xxxxxxxxxxxxxxxxx"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                            API Consumer Secret
                        </label>
                        <input
                            type="password"
                            value={form.api_secret}
                            onChange={(e) => handleChange('api_secret', e.target.value)}
                            placeholder="cs_xxxxxxxxxxxxxxxxx"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-2 flex items-center gap-2">
                            <Webhook size={14} />
                            Webhook Secret
                        </label>
                        <input
                            type="password"
                            value={form.webhook_secret}
                            onChange={(e) => handleChange('webhook_secret', e.target.value)}
                            placeholder="Tu secreto para validar HMAC"
                            className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                        />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <span className={`text-xs ${isConfigured ? 'text-green-400' : 'text-[var(--color-text-muted)]'}`}>
                            {isConfigured ? 'Configuración guardada' : 'Sin configuración guardada'}
                        </span>

                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="btn-primary flex items-center gap-2 disabled:opacity-50"
                        >
                            <Save size={16} />
                            {isSaving ? 'Guardando...' : 'Guardar Integración'}
                        </button>
                    </div>

                    <div className="pt-3 border-t border-[var(--glass-border)] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-[var(--color-text)] font-medium">Sincronización global de stock</span>
                            <button
                                onClick={handleSyncAllStock}
                                disabled={isSyncingAllStock || !isConfigured}
                                className="btn-primary flex items-center gap-2 disabled:opacity-50"
                            >
                                <RefreshCw size={16} className={isSyncingAllStock ? 'animate-spin' : ''} />
                                {isSyncingAllStock ? 'Sincronizando...' : 'Sincronizar Todo el Stock con la Tienda'}
                            </button>
                        </div>

                        {isSyncingAllStock && (
                            <div className="space-y-1">
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    {syncProgress.message || `Sincronizando ${syncProgress.processed} productos...`}
                                </p>
                                <div className="w-full h-2 bg-[var(--glass-bg)] rounded-full overflow-hidden border border-[var(--glass-border)]">
                                    <div
                                        className="h-full bg-[var(--color-primary)] transition-all duration-300"
                                        style={{ width: `${syncProgress.total > 0 ? (syncProgress.processed / syncProgress.total) * 100 : 0}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {syncSummary && !isSyncingAllStock && (
                            <p className="text-xs text-[var(--color-text-muted)]">
                                Resultado: {syncSummary.updated || 0} exitosos / {syncSummary.failed || 0} fallidos (Total: {syncSummary.total || 0})
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StoreIntegrationSettings;
