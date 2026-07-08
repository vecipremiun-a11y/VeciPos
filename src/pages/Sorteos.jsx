import React, { useEffect, useState, useCallback } from 'react';
import {
    Trophy, ExternalLink, Save, Download, Shuffle, Calendar,
    Image as ImageIcon, Users, Copy, Check, Trash2, X, Loader2
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { dataApiCall } from '../lib/dataApi';
import { cn } from '../lib/utils';
import { compressImage, validateImage } from '../lib/imageCompression';

// Campos opcionales que la empresa puede pedir en la inscripción.
const FIELD_DEFS = [
    { key: 'name', col: 'field_name', label: 'Nombre completo', hint: null },
    { key: 'phone', col: 'field_phone', label: 'Celular', hint: null },
    { key: 'rut', col: 'field_rut', label: 'RUT', hint: null },
    { key: 'email', col: 'field_email', label: 'Correo electrónico', hint: null },
    { key: 'boleta', col: 'field_boleta', label: 'N° de boleta', hint: 'La que entregas en el local' },
    { key: 'address', col: 'field_address', label: 'Dirección', hint: null },
];

const DEFAULT_FORM = {
    name: '',
    draw_date: '',
    active: 1,
    bg_image: null,
    field_name: 1,
    field_phone: 1,
    field_rut: 0,
    field_email: 0,
    field_boleta: 1,
    field_address: 0,
    boleta_min_amount: 0,
    boleta_from_date: '',
};


// Toggle reutilizable (estilo del resto de la app).
const Toggle = ({ checked, onChange }) => (
    <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
            'relative w-12 h-6 rounded-full transition-colors duration-200 shrink-0',
            checked ? 'bg-emerald-500' : 'bg-[var(--color-surface-hover)] border border-[var(--glass-border)]'
        )}
    >
        <span className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
            checked && 'translate-x-6'
        )} />
    </button>
);

const Sorteos = () => {
    const activeCompanyId = useStore(s => s.activeCompanyId);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [token, setToken] = useState('');
    const [form, setForm] = useState(DEFAULT_FORM);
    const [participants, setParticipants] = useState([]);
    const [status, setStatus] = useState(null); // { type: 'ok'|'err', text }
    const [copied, setCopied] = useState(false);
    const [winner, setWinner] = useState(null);
    const [uploadingImg, setUploadingImg] = useState(false);

    const publicUrl = token ? `${window.location.origin}/sorteo.html?token=${token}` : '';

    const flash = (type, text) => {
        setStatus({ type, text });
        setTimeout(() => setStatus(null), 3500);
    };

    const loadParticipants = useCallback(async () => {
        if (!activeCompanyId) return;
        const pr = await dataApiCall('sorteoParticipants', { companyId: activeCompanyId });
        if (pr?.success) setParticipants(pr.rows);
    }, [activeCompanyId]);

    const loadAll = useCallback(async () => {
        if (!activeCompanyId) return;
        setLoading(true);
        try {
            // Token (generado server-side si no existe) + configuración del sorteo
            const res = await dataApiCall('sorteoLoad', { companyId: activeCompanyId });
            if (!res?.success) throw new Error(res?.error || 'Error');
            setToken(res.token);
            const sr = { rows: res.config ? [res.config] : [] };
            if (sr.rows.length) {
                const r = sr.rows[0];
                setForm({
                    name: r.name || '',
                    draw_date: r.draw_date || '',
                    active: Number(r.active),
                    bg_image: r.bg_image || null,
                    field_name: Number(r.field_name),
                    field_phone: Number(r.field_phone),
                    field_rut: Number(r.field_rut),
                    field_email: Number(r.field_email),
                    field_boleta: Number(r.field_boleta),
                    field_address: Number(r.field_address),
                    boleta_min_amount: Number(r.boleta_min_amount) || 0,
                    boleta_from_date: r.boleta_from_date || '',
                });
            } else {
                setForm(DEFAULT_FORM);
            }

            // 3) Participantes.
            await loadParticipants();
        } catch (e) {
            console.error('Sorteos load error:', e);
            flash('err', 'No se pudo cargar el sorteo.');
        } finally {
            setLoading(false);
        }
    }, [activeCompanyId, loadParticipants]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

    const handleImage = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const v = validateImage(file);
        if (!v.valid) { flash('err', v.error); return; }
        setUploadingImg(true);
        try {
            // Fondo: algo más grande que un thumbnail, pero comprimido para no
            // inflar la fila ni la carga de la página pública.
            const b64 = await compressImage(file, 400, 1280, 1280);
            setField('bg_image', b64);
        } catch (err) {
            console.error(err);
            flash('err', 'No se pudo procesar la imagen.');
        } finally {
            setUploadingImg(false);
        }
    };

    const handleSave = async () => {
        if (!activeCompanyId) return;
        if (!form.name.trim()) { flash('err', 'El nombre del sorteo es obligatorio.'); return; }
        setSaving(true);
        try {
            const saveRes = await dataApiCall('sorteoSave', { companyId: activeCompanyId, form });
            if (!saveRes?.success) throw new Error(saveRes?.error || 'Error guardando');
            flash('ok', 'Configuración guardada.');

            // Empujar la config a miniveci (best-effort, no bloquea el guardado).
            // Si la tienda no está integrada, el endpoint responde skipped y no pasa nada.
            try {
                const r = await fetch(`/api/integration/push-sorteo?company_id=${encodeURIComponent(activeCompanyId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-company-id': activeCompanyId },
                });
                const j = await r.json().catch(() => null);
                if (j?.ok && !j.skipped) {
                    flash('ok', 'Configuración guardada y sincronizada con la web.');
                }
            } catch (err) {
                console.warn('[sorteo] push a miniveci falló (no crítico):', err);
            }
        } catch (e) {
            console.error('Sorteos save error:', e);
            flash('err', 'No se pudo guardar.');
        } finally {
            setSaving(false);
        }
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch { flash('err', 'No se pudo copiar.'); }
    };

    const drawWinner = () => {
        if (!participants.length) { flash('err', 'No hay participantes para sortear.'); return; }
        const w = participants[Math.floor(Math.random() * participants.length)];
        setWinner(w);
    };

    const exportCSV = () => {
        if (!participants.length) { flash('err', 'No hay participantes para exportar.'); return; }
        const cols = [
            { k: 'ticket_number', h: 'N°' },
            ...FIELD_DEFS.filter(f => form[f.col] === 1).map(f => ({ k: f.key, h: f.label })),
            { k: 'created_at', h: 'Fecha' },
        ];
        // Separador `;` — es el que espera Excel en español (Chile, España, etc.).
        // Con coma Excel mete todo en una sola columna.
        const SEP = ';';
        const escCsv = (v) => {
            const s = String(v ?? '');
            return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        // La línea "sep=;" es una directiva no estándar que Excel reconoce y
        // garantiza que abra el archivo con el separador correcto sin depender
        // de la config regional del usuario. Otras herramientas (Google Sheets,
        // LibreOffice) la ignoran y auto-detectan.
        const lines = ['sep=' + SEP];
        lines.push(cols.map(c => c.h).join(SEP));
        for (const p of participants) {
            lines.push(cols.map(c => escCsv(c.k === 'created_at' ? fmtDate(p[c.k]) : p[c.k])).join(SEP));
        }
        // BOM UTF-8 (BOM) → tildes y ñ se muestran bien en Excel.
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sorteo_${(form.name || 'participantes').replace(/\s+/g, '_').toLowerCase()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const clearParticipants = async () => {
        if (!activeCompanyId) return;
        if (!window.confirm('¿Vaciar la lista de participantes? Esto elimina TODOS los inscritos del sorteo actual y no se puede deshacer.')) return;
        try {
            const clr = await dataApiCall('sorteoClearParticipants', { companyId: activeCompanyId });
            if (!clr?.success) throw new Error(clr?.error || 'Error');
            await loadParticipants();
            flash('ok', 'Participantes eliminados.');
        } catch (e) {
            console.error(e);
            flash('err', 'No se pudo vaciar.');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">
                <Loader2 className="animate-spin mr-2" size={20} /> Cargando sorteo…
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-10">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-start gap-3">
                    <Trophy className="text-amber-500 mt-1" size={30} />
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--color-text)]">Sorteo de temporada</h1>
                        <p className="text-sm text-[var(--color-text-muted)]">
                            Configura qué datos pide la inscripción y revisa los participantes registrados.
                        </p>
                    </div>
                </div>
                <a
                    href={publicUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors text-sm font-medium shrink-0"
                >
                    <ExternalLink size={16} /> Ver página pública
                </a>
            </div>

            {/* Toast inline */}
            {status && (
                <div className={cn(
                    'px-4 py-2.5 rounded-xl text-sm font-medium border',
                    status.type === 'ok'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                        : 'bg-red-500/10 border-red-500/30 text-red-500'
                )}>
                    {status.text}
                </div>
            )}

            {/* Link público (multiempresa) */}
            <div className="glass border border-[var(--glass-border)] rounded-2xl p-4">
                <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                    Link de inscripción de esta empresa
                </label>
                <div className="flex items-center gap-2 mt-2">
                    <input
                        readOnly value={publicUrl}
                        className="flex-1 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] font-mono truncate"
                    />
                    <button
                        onClick={copyLink}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Copiado' : 'Copiar'}
                    </button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                    Cada empresa tiene su propio link. Compártelo por WhatsApp, redes o un QR en el local.
                </p>
            </div>

            {/* Configuración */}
            <div className="glass border border-[var(--glass-border)] rounded-2xl p-5 space-y-5">
                <h2 className="font-bold text-lg text-[var(--color-text)]">Configuración</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Nombre del sorteo *</label>
                        <input
                            value={form.name}
                            onChange={e => setField('name', e.target.value)}
                            placeholder="Ej: Día del padre"
                            className="w-full bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                            <Calendar size={14} className="inline mr-1 -mt-0.5" />
                            Fecha del sorteo (opcional)
                        </label>
                        <input
                            type="datetime-local"
                            value={form.draw_date}
                            onChange={e => setField('draw_date', e.target.value)}
                            className="w-full bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none"
                        />
                    </div>
                </div>

                {/* Sorteo activo */}
                <div className="flex items-center justify-between gap-4 border border-[var(--glass-border)] rounded-xl px-4 py-3">
                    <div>
                        <p className="font-medium text-[var(--color-text)]">Sorteo activo</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            Si está activo, la página pública muestra el formulario. Si no, muestra “No hay sorteo activo”.
                        </p>
                    </div>
                    <Toggle checked={form.active === 1} onChange={v => setField('active', v ? 1 : 0)} />
                </div>

                {/* Imagen de fondo */}
                <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
                        <ImageIcon size={14} className="inline mr-1 -mt-0.5" />
                        Imagen de fondo (opcional)
                    </label>
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">
                        Se muestra detrás del formulario en la página pública. Máx 5MB (se comprime automáticamente).
                    </p>
                    <div className="flex items-center gap-3">
                        <label className="relative cursor-pointer">
                            <div className={cn(
                                'w-44 h-28 rounded-xl border-2 border-dashed border-[var(--glass-border)] flex items-center justify-center overflow-hidden bg-[var(--color-surface)] hover:border-[var(--color-primary)] transition-colors',
                            )}>
                                {uploadingImg ? (
                                    <Loader2 className="animate-spin text-[var(--color-text-muted)]" size={22} />
                                ) : form.bg_image ? (
                                    <img src={form.bg_image} alt="fondo" className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-xs text-[var(--color-text-muted)] flex flex-col items-center gap-1">
                                        <ImageIcon size={20} /> Subir imagen
                                    </span>
                                )}
                            </div>
                            <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
                        </label>
                        {form.bg_image && (
                            <button
                                onClick={() => setField('bg_image', null)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-500/10 text-sm"
                            >
                                <Trash2 size={15} /> Quitar
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Campos de inscripción */}
            <div className="glass border border-[var(--glass-border)] rounded-2xl p-5 space-y-3">
                <div>
                    <h2 className="font-bold text-lg text-[var(--color-text)]">Campos que pide la inscripción</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">
                        Marca los datos que el cliente debe completar. Los campos marcados se muestran y son obligatorios.
                    </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {FIELD_DEFS.map(f => (
                        <div key={f.key} className="flex items-center justify-between gap-4 border border-[var(--glass-border)] rounded-xl px-4 py-3">
                            <div>
                                <p className="font-medium text-[var(--color-text)]">{f.label}</p>
                                {f.hint && <p className="text-xs text-[var(--color-text-muted)]">{f.hint}</p>}
                            </div>
                            <Toggle checked={form[f.col] === 1} onChange={v => setField(f.col, v ? 1 : 0)} />
                        </div>
                    ))}
                </div>

                {/* Regla de validación de boleta (solo si se pide N° de boleta) */}
                {form.field_boleta === 1 && (
                    <div className="border border-[var(--glass-border)] rounded-xl p-4 space-y-4 bg-[var(--color-surface)]/40">
                        <div>
                            <p className="font-semibold text-[var(--color-text)]">Verificación de boleta (opcional)</p>
                            <p className="text-xs text-[var(--color-text-muted)]">
                                Comprobamos el N° contra la venta real (folio SII o N° de ticket). Solo se aceptan boletas reales que cumplan estas reglas.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Monto mínimo de la boleta</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">$</span>
                                    <input
                                        type="number" min="0" step="100"
                                        value={form.boleta_min_amount || ''}
                                        onChange={e => setField('boleta_min_amount', Number(e.target.value) || 0)}
                                        placeholder="0 = sin verificar"
                                        className="w-full bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg pl-7 pr-3 py-2.5 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none"
                                    />
                                </div>
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">Deja en 0 para inscribir sin comprobar el monto.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                                    <Calendar size={14} className="inline mr-1 -mt-0.5" />
                                    Boletas válidas desde
                                </label>
                                <input
                                    type="date"
                                    value={form.boleta_from_date}
                                    onChange={e => setField('boleta_from_date', e.target.value)}
                                    className="w-full bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-lg px-3 py-2.5 text-[var(--color-text)] focus:border-[var(--color-primary)] outline-none"
                                />
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">Solo cuentan boletas emitidas desde esta fecha.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Guardar */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                    {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    Guardar
                </button>
            </div>

            {/* Participantes */}
            <div className="glass border border-[var(--glass-border)] rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Users size={20} className="text-[var(--color-primary)]" />
                        <h2 className="font-bold text-lg text-[var(--color-text)]">Participantes</h2>
                        <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] text-sm font-semibold">
                            {participants.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={exportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] text-sm">
                            <Download size={15} /> Exportar CSV
                        </button>
                        <button onClick={drawWinner} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white hover:opacity-90 text-sm font-medium">
                            <Shuffle size={15} /> Sortear al azar
                        </button>
                        {participants.length > 0 && (
                            <button onClick={clearParticipants} title="Vaciar participantes" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 text-sm">
                                <Trash2 size={15} />
                            </button>
                        )}
                    </div>
                </div>

                {participants.length === 0 ? (
                    <div className="text-center py-10 text-[var(--color-text-muted)]">
                        Aún no hay inscritos. Comparte el link para empezar a recibir participantes.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--glass-border)]">
                                    <th className="py-2 pr-4 font-semibold">N°</th>
                                    {form.field_name === 1 && <th className="py-2 pr-4 font-semibold">Nombre completo</th>}
                                    {form.field_phone === 1 && <th className="py-2 pr-4 font-semibold">Celular</th>}
                                    {form.field_rut === 1 && <th className="py-2 pr-4 font-semibold">RUT</th>}
                                    {form.field_email === 1 && <th className="py-2 pr-4 font-semibold">Correo</th>}
                                    {form.field_boleta === 1 && <th className="py-2 pr-4 font-semibold">N° de boleta</th>}
                                    {form.field_address === 1 && <th className="py-2 pr-4 font-semibold">Dirección</th>}
                                    <th className="py-2 pr-4 font-semibold">Fecha</th>
                                </tr>
                            </thead>
                            <tbody>
                                {participants.map(p => (
                                    <tr key={p.id} className="border-b border-[var(--glass-border)]/50">
                                        <td className="py-2.5 pr-4 font-bold text-[var(--color-primary)]">{p.ticket_number}</td>
                                        {form.field_name === 1 && <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.name || '—'}</td>}
                                        {form.field_phone === 1 && <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.phone || '—'}</td>}
                                        {form.field_rut === 1 && <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.rut || '—'}</td>}
                                        {form.field_email === 1 && <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.email || '—'}</td>}
                                        {form.field_boleta === 1 && <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.boleta || '—'}</td>}
                                        {form.field_address === 1 && <td className="py-2.5 pr-4 text-[var(--color-text)]">{p.address || '—'}</td>}
                                        <td className="py-2.5 pr-4 text-[var(--color-text-muted)]">{fmtDate(p.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal ganador */}
            {winner && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setWinner(null)}>
                    <div className="glass border border-[var(--glass-border)] rounded-2xl p-8 max-w-sm w-full text-center relative" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setWinner(null)} className="absolute top-3 right-3 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            <X size={20} />
                        </button>
                        <div className="text-5xl mb-2">🎉</div>
                        <p className="text-sm text-[var(--color-text-muted)] uppercase tracking-wide font-semibold">¡Ganador del sorteo!</p>
                        <div className="my-4 inline-block px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-purple-500/20 border-2 border-dashed border-amber-500">
                            <div className="text-4xl font-black text-amber-500">{winner.ticket_number}</div>
                        </div>
                        <p className="text-lg font-bold text-[var(--color-text)]">{winner.name || 'Participante'}</p>
                        {winner.phone && <p className="text-sm text-[var(--color-text-muted)]">{winner.phone}</p>}
                        {winner.boleta && <p className="text-sm text-[var(--color-text-muted)]">Boleta: {winner.boleta}</p>}
                        <button
                            onClick={drawWinner}
                            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] text-sm"
                        >
                            <Shuffle size={15} /> Sortear de nuevo
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export default Sorteos;
