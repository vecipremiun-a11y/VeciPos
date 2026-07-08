import React, { useEffect, useState, useRef } from 'react';
import { Scale, Plug, Unplug, RefreshCw, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { scaleService } from '../lib/scale/scaleService';
import { PROTOCOL_OPTIONS } from '../lib/scale/protocols';

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const PARITIES = ['none', 'even', 'odd'];

// Sección "Báscula" dentro de Configuración. Permite emparejar la báscula con
// la PC (una vez), elegir protocolo, ver el peso en vivo y probar lectura
// estable.
const ScaleConfig = () => {
    const [config, setConfig] = useState(scaleService.getConfig());
    const [connected, setConnected] = useState(scaleService.isConnected());
    const [liveReading, setLiveReading] = useState(null);
    const [busy, setBusy] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [rawLog, setRawLog] = useState('');
    const supported = scaleService.isSupported();
    const lastRawRef = useRef('');

    useEffect(() => {
        if (!supported) return;
        // Si hay un puerto recordado de una sesión previa, reconectarlo solo.
        if (!scaleService.isConnected()) {
            scaleService.connectRemembered().then(ok => setConnected(!!ok)).catch(() => { });
        } else {
            setConnected(true);
        }
        const unsub = scaleService.subscribe(reading => {
            setLiveReading(reading);
            lastRawRef.current = reading.raw;
        });
        // Diagnóstico: acumular datos crudos (con \r \n visibles), capado a ~3000 chars
        const unsubRaw = scaleService.subscribeRaw(chunk => {
            setRawLog(prev => {
                const escaped = chunk.replace(/\r/g, '\\r').replace(/\n/g, '\\n\n');
                const next = prev + escaped;
                return next.length > 3000 ? next.slice(-3000) : next;
            });
        });
        return () => { unsub(); unsubRaw(); };
    }, [supported]);

    const updateConfig = (partial) => {
        const next = { ...config, ...partial };
        setConfig(next);
        scaleService.saveConfig(partial);
    };

    const setPoll = (cmd) => {
        scaleService.setPollCommand(cmd);
        setConfig(c => ({ ...c, pollCommand: cmd }));
        setRawLog('');
    };

    const handleConnect = async () => {
        setErrorMsg('');
        setBusy(true);
        try {
            await scaleService.requestAndConnect();
            setConnected(true);
        } catch (e) {
            setErrorMsg(e?.message || 'No se pudo conectar la báscula.');
        } finally {
            setBusy(false);
        }
    };

    const handleDisconnect = async () => {
        setBusy(true);
        try {
            await scaleService.disconnect();
            setConnected(false);
            setLiveReading(null);
        } finally {
            setBusy(false);
        }
    };

    const handleTest = async () => {
        setErrorMsg('');
        setTestResult(null);
        setBusy(true);
        try {
            const reading = await scaleService.readStable({ timeoutMs: 6000 });
            setTestResult(reading);
        } catch (e) {
            setErrorMsg(e?.message || 'Falló la lectura.');
        } finally {
            setBusy(false);
        }
    };

    if (!supported) {
        return (
            <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                    <Scale size={22} className="text-[var(--color-primary)]" />
                    <h2 className="text-xl font-bold text-[var(--color-text)]">Báscula</h2>
                </div>
                <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200">
                    <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                    <div className="text-sm">
                        Tu navegador no soporta Web Serial. Para conectar la báscula, abre POSVECI
                        en <b>Google Chrome</b> o <b>Microsoft Edge</b> (versión 89 o superior).
                    </div>
                </div>
            </div>
        );
    }

    const liveKg = liveReading?.weight ?? null;
    const liveStable = liveReading?.stable;

    return (
        <div className="glass-card p-6 space-y-6">
            <div className="flex items-center gap-3">
                <Scale size={22} className="text-[var(--color-primary)]" />
                <h2 className="text-xl font-bold text-[var(--color-text)]">Báscula</h2>
                {connected
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">Conectada</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--glass-border)] text-[var(--color-text-muted)]">Desconectada</span>}
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[var(--color-text-muted)] text-xs">
                <Info size={16} className="shrink-0 mt-0.5 text-blue-400" />
                <div>
                    Se configura <b>una sola vez por PC</b>. POSVECI recordará el puerto para próximas
                    sesiones. Cualquier báscula con salida ASCII por USB o RS-232 (con adaptador USB-Serial)
                    debería funcionar.
                </div>
            </div>

            {/* Conectar / Desconectar */}
            <div className="flex flex-wrap items-center gap-3">
                {!connected ? (
                    <button
                        disabled={busy}
                        onClick={handleConnect}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                        <Plug size={16} /> Conectar báscula
                    </button>
                ) : (
                    <button
                        disabled={busy}
                        onClick={handleDisconnect}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
                    >
                        <Unplug size={16} /> Desconectar
                    </button>
                )}
                <button
                    disabled={!connected || busy}
                    onClick={handleTest}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
                >
                    <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Probar lectura
                </button>
            </div>

            {errorMsg && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{errorMsg}</div>
            )}

            {/* Peso en vivo */}
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] p-5">
                <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Peso en vivo</p>
                <div className="flex items-baseline gap-3">
                    <span className="text-4xl font-bold text-[var(--color-text)] font-mono">
                        {liveKg !== null ? liveKg.toFixed(3) : '—'}
                    </span>
                    <span className="text-lg text-[var(--color-text-muted)]">kg</span>
                    {liveStable === true && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 inline-flex items-center gap-1">
                            <CheckCircle2 size={12} /> Estable
                        </span>
                    )}
                </div>
                {liveReading?.raw && (
                    <p className="mt-3 text-[11px] text-[var(--color-text-muted)] font-mono break-all">
                        Frame: {liveReading.raw}
                    </p>
                )}
                {testResult && (
                    <div className="mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-200 text-sm">
                        ✅ Lectura estable: <b>{testResult.weight.toFixed(3)} kg</b>
                    </div>
                )}
            </div>

            {/* Parámetros */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Protocolo de la báscula</label>
                    <select
                        value={config.protocolId}
                        onChange={(e) => updateConfig({ protocolId: e.target.value })}
                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    >
                        {PROTOCOL_OPTIONS.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                        {PROTOCOL_OPTIONS.find(p => p.id === config.protocolId)?.description}
                    </p>
                </div>
                <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Baud rate</label>
                    <select
                        value={config.baudRate}
                        onChange={(e) => updateConfig({ baudRate: Number(e.target.value) })}
                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    >
                        {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">9600 es el valor más común.</p>
                </div>
                <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Data bits</label>
                    <select
                        value={config.dataBits}
                        onChange={(e) => updateConfig({ dataBits: Number(e.target.value) })}
                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    >
                        <option value={7}>7</option>
                        <option value={8}>8</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Stop bits</label>
                    <select
                        value={config.stopBits}
                        onChange={(e) => updateConfig({ stopBits: Number(e.target.value) })}
                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Paridad</label>
                    <select
                        value={config.parity}
                        onChange={(e) => updateConfig({ parity: e.target.value })}
                        className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    >
                        {PARITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
            </div>

            <div className="text-[11px] text-[var(--color-text-muted)]">
                Si cambias parámetros con la báscula conectada, desconéctala y vuelve a conectarla para aplicar.
            </div>

            {/* Diagnóstico: datos crudos del puerto */}
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                        Datos crudos (diagnóstico)
                    </p>
                    <button
                        onClick={() => setRawLog('')}
                        className="text-[11px] px-2 py-1 rounded border border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                    >Limpiar</button>
                </div>

                {/* Selector de sondeo: si la báscula no transmite sola, prueba estos */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-[11px] text-[var(--color-text-muted)]">Sondeo:</span>
                    {[
                        { cmd: '', label: 'Sin sondeo' },
                        { cmd: '\x05', label: 'ENQ' },
                        { cmd: 'W\r', label: 'W' },
                        { cmd: 'P\r', label: 'P' },
                    ].map(opt => (
                        <button
                            key={opt.label}
                            disabled={!connected}
                            onClick={() => setPoll(opt.cmd)}
                            className={`text-[11px] px-2.5 py-1 rounded border transition-colors disabled:opacity-40 ${(config.pollCommand || '') === opt.cmd
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold'
                                : 'border-[var(--glass-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
                                }`}
                        >{opt.label}</button>
                    ))}
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                        Si no aparece nada, prueba ENQ → W → P (uno a la vez).
                    </span>
                </div>
                <pre className="text-[11px] font-mono text-green-300/90 bg-black/40 rounded-lg p-3 max-h-44 overflow-auto whitespace-pre-wrap break-all">
{rawLog || 'Esperando datos… pon peso en la báscula.\n\nSi NO aparece nada: tu báscula no está transmitiendo sola — prueba los botones "Solicitar" de arriba, o revisa baud rate / puerto.\nSi aparecen datos pero el peso sigue en "—": cópialos y mándamelos para ajustar el lector.'}
                </pre>
            </div>
        </div>
    );
};

export default ScaleConfig;
