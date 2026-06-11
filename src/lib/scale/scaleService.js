// Servicio singleton de báscula. Lee del puerto serie/USB via Web Serial API
// (Chrome/Edge ≥89). Sin instalar nada extra en la PC.
//
// API pública:
//   scaleService.isSupported()                   → boolean
//   scaleService.isConnected()                   → boolean
//   scaleService.getConfig()                     → { protocolId, baudRate, dataBits, stopBits, parity }
//   scaleService.saveConfig(partial)             → persiste en localStorage
//   scaleService.requestAndConnect()             → pide al usuario un puerto y abre
//   scaleService.connectRemembered()             → abre el último puerto autorizado (si hay)
//   scaleService.disconnect()                    → cierra
//   scaleService.subscribe(cb)                   → cb({ weight, unit, stable, raw }) en cada lectura. Devuelve unsubscribe
//   scaleService.readStable({timeoutMs})         → Promise<{weight, unit}> — espera estable y resuelve
//
// Cuando el protocolo trae bandera de estabilidad, se usa esa. Si no, se hace
// detección por repetición (N lecturas seguidas dentro de ±5g) — robusta y
// suficientemente rápida para cualquier báscula.

import { parsers } from './protocols';

const STORAGE_KEY = 'posveci_scale_config';
const DEFAULT_CONFIG = {
    protocolId: 'generic',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
};

class ScaleService {
    constructor() {
        this.port = null;
        this.reader = null;
        this.listeners = new Set();
        this.lastReading = null;
        this.config = this._loadConfig();
    }

    _loadConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_CONFIG };
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    isSupported() {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    getConfig() {
        return { ...this.config };
    }

    saveConfig(partial) {
        this.config = { ...this.config, ...partial };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config)); } catch { /* noop */ }
    }

    isConnected() {
        return !!this.port;
    }

    async requestAndConnect() {
        if (!this.isSupported()) throw new Error('Web Serial no soportado en este navegador. Usa Chrome o Edge.');
        const port = await navigator.serial.requestPort();
        await this._openAndStart(port);
    }

    async connectRemembered() {
        if (!this.isSupported()) return false;
        const ports = await navigator.serial.getPorts();
        if (!ports.length) return false;
        await this._openAndStart(ports[0]);
        return true;
    }

    async _openAndStart(port) {
        if (this.port) await this.disconnect();
        await port.open({
            baudRate: this.config.baudRate,
            dataBits: this.config.dataBits,
            stopBits: this.config.stopBits,
            parity: this.config.parity,
            flowControl: 'none',
        });
        this.port = port;
        this._startReadingLoop();
    }

    async disconnect() {
        const port = this.port;
        const reader = this.reader;
        this.port = null;
        this.reader = null;
        this.lastReading = null;
        try { await reader?.cancel(); } catch { /* noop */ }
        try { reader?.releaseLock(); } catch { /* noop */ }
        try { await port?.close(); } catch { /* noop */ }
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    // Loop interno. Lee bytes, los acumula y los pasa al parser linea por línea
    // (la mayoría de protocolos delimitan con \r o \n).
    async _startReadingLoop() {
        const decoder = new TextDecoder();
        let buffer = '';
        const parser = parsers[this.config.protocolId] || parsers.generic;

        while (this.port?.readable) {
            this.reader = this.port.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split(/[\r\n]+/);
                    buffer = parts.pop() || '';
                    for (const line of parts) {
                        if (!line.trim()) continue;
                        const reading = parser.parse(line);
                        if (reading) {
                            this.lastReading = reading;
                            this.listeners.forEach(cb => { try { cb(reading); } catch { /* noop */ } });
                        }
                    }
                }
            } catch (e) {
                console.warn('[scale] read loop error:', e?.message || e);
                break;
            } finally {
                try { this.reader?.releaseLock(); } catch { /* noop */ }
                this.reader = null;
            }
        }
    }

    // Espera un peso estable y lo devuelve. Usa la bandera del protocolo cuando
    // existe; si no, considera estable si N lecturas seguidas no varían más de
    // 5g entre sí y el peso es > 0.
    readStable({ timeoutMs = 6000, stableFrames = 4, toleranceKg = 0.005 } = {}) {
        if (!this.isConnected()) {
            return Promise.reject(new Error('Báscula no conectada.'));
        }
        return new Promise((resolve, reject) => {
            const recent = [];
            const timer = setTimeout(() => {
                unsub();
                reject(new Error('Tiempo agotado esperando peso estable.'));
            }, timeoutMs);
            const unsub = this.subscribe(reading => {
                if (reading.stable === true && reading.weight > 0) {
                    clearTimeout(timer); unsub();
                    resolve(reading);
                    return;
                }
                if (reading.stable === undefined) {
                    recent.push(reading.weight);
                    if (recent.length > stableFrames) recent.shift();
                    if (recent.length === stableFrames) {
                        const max = Math.max(...recent);
                        const min = Math.min(...recent);
                        if (max > 0 && max - min < toleranceKg) {
                            clearTimeout(timer); unsub();
                            resolve({ ...reading, weight: max });
                        }
                    }
                }
            });
        });
    }
}

export const scaleService = new ScaleService();
