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
    pollCommand: '',   // '' = la báscula transmite sola; si no, comando a enviar (ej. '\x05', 'W\r')
    pollIntervalMs: 400,
};

class ScaleService {
    constructor() {
        this.port = null;
        this.reader = null;
        this.listeners = new Set();
        this.rawListeners = new Set();
        this.lastReading = null;
        this._reading = false;
        this.pollTimer = null;
        this.config = this._loadConfig();
        // Cierra el puerto al recargar/cerrar la pestaña para no dejarlo "abierto"
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', () => { try { this.port?.close(); } catch { /* noop */ } });
        }
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
        // Si veníamos manejando otro puerto, ciérralo primero
        if (this.port && this.port !== port) {
            try { await this.disconnect(); } catch { /* noop */ }
        }

        // Abrir el puerto. Si ya estaba abierto (recarga/HMR/otra sesión), lo adoptamos
        // en vez de fallar con "The port is already open".
        const alreadyOpen = !!(port.readable || port.writable);
        if (!alreadyOpen) {
            try {
                await port.open({
                    baudRate: this.config.baudRate,
                    dataBits: this.config.dataBits,
                    stopBits: this.config.stopBits,
                    parity: this.config.parity,
                    flowControl: 'none',
                });
            } catch (e) {
                if (!/already open/i.test(e?.message || '')) throw e;
                // ya estaba abierto → continuamos y lo adoptamos
            }
        }

        this.port = port;
        this._startReadingLoop();
        this._startPolling();
    }

    async disconnect() {
        const port = this.port;
        const reader = this.reader;
        this._stopPolling();
        this.port = null;
        this.reader = null;
        this.lastReading = null;
        this._reading = false;
        try { await reader?.cancel(); } catch { /* noop */ }
        try { reader?.releaseLock(); } catch { /* noop */ }
        try { await port?.close(); } catch { /* noop */ }
    }

    // Sondeo: si la báscula no transmite sola, le mandamos el comando cada N ms
    _startPolling() {
        this._stopPolling();
        const cmd = this.config.pollCommand;
        if (!cmd) return;
        const interval = this.config.pollIntervalMs || 400;
        this.pollTimer = setInterval(() => { this.sendCommand(cmd); }, interval);
    }

    _stopPolling() {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    }

    // Cambia el comando de sondeo en caliente (lo persiste y reinicia el timer)
    setPollCommand(cmd) {
        this.saveConfig({ pollCommand: cmd });
        if (this.isConnected()) this._startPolling();
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    // Diagnóstico: recibe CADA fragmento de texto crudo que llega del puerto,
    // se parsee o no. Sirve para ver qué envía realmente la báscula.
    subscribeRaw(callback) {
        this.rawListeners.add(callback);
        return () => this.rawListeners.delete(callback);
    }

    // Envía un comando de texto a la báscula (para básculas que solo responden
    // cuando se les solicita el peso, ej. "W\r", ENQ, etc.).
    async sendCommand(text) {
        if (!this.port?.writable) return false;
        const writer = this.port.writable.getWriter();
        try {
            await writer.write(new TextEncoder().encode(text));
            return true;
        } catch (e) {
            console.warn('[scale] write error:', e?.message || e);
            return false;
        } finally {
            try { writer.releaseLock(); } catch { /* noop */ }
        }
    }

    // Loop interno. Lee bytes, los acumula y los pasa al parser linea por línea
    // (la mayoría de protocolos delimitan con \r o \n).
    async _startReadingLoop() {
        if (this._reading) return; // evita dos loops simultáneos (HMR/remount)
        this._reading = true;
        const decoder = new TextDecoder();
        let buffer = '';
        const parser = parsers[this.config.protocolId] || parsers.generic;

        try {
        while (this.port?.readable) {
            try {
                this.reader = this.port.readable.getReader();
            } catch (e) {
                // El stream ya está bloqueado por otro lector (instancia previa)
                console.warn('[scale] getReader bloqueado:', e?.message || e);
                break;
            }
            try {
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;
                    // Diagnóstico: notificar el texto crudo (con escape visible de \r \n)
                    if (chunk && this.rawListeners.size) {
                        this.rawListeners.forEach(cb => { try { cb(chunk); } catch { /* noop */ } });
                    }
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
        } finally {
            this._reading = false;
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
