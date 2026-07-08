// FASE 5.5 · Telemetría de fallback de queries analíticas.
//
// Objetivo:
//   Detectar cuándo y por qué las queries normalizadas caen al fallback
//   JSON. Si supera ~1%, hay un problema sistémico que debemos investigar.
//
// Diseño:
//   · Buffer en memoria + flush periódico para evitar saturar Turso.
//   · NUNCA bloquea el thread principal: todo en background, fire-and-forget.
//   · NUNCA propaga errores: si la telemetría falla, la app sigue normal.
//   · Buffer máximo 50 eventos — si se desborda, se descartan los más viejos.
//   · Flush automático cada 60s + al cerrar tab + al cumplir 20 eventos.
//
// Tabla destino: analytics_telemetry (creada por scripts/optim/phase5_5/01-create-telemetry.mjs)

import { dataApiCall } from './dataApi';

const MAX_BUFFER = 50;
const FLUSH_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 60_000;

let buffer = [];
let flushTimer = null;
let flushing = false;

function getCompanyId() {
  if (typeof window === 'undefined') return null;
  return window.__POSKEM_ACTIVE_COMPANY_ID__ || null;
}

function getUserAgent() {
  if (typeof navigator === 'undefined') return null;
  // Resumir: solo la primera parte hasta evitar PII y reducir tamaño
  const ua = navigator.userAgent || '';
  return ua.slice(0, 200);
}

/**
 * Registra un evento de fallback / error / gap.
 * Llamar libremente — nunca espera, nunca falla.
 *
 * @param {object} evt
 *   - event_type: 'fallback' | 'error' | 'gap_detected'
 *   - query_name: string (ej. 'productSalesHistory')
 *   - error_msg: string opcional
 *   - duration_ms: number opcional
 *   - company_id: string opcional (si no, se toma de window)
 */
export function logAnalyticsEvent(evt) {
  try {
    if (!evt?.event_type || !evt?.query_name) return;
    if (buffer.length >= MAX_BUFFER) {
      buffer.shift(); // descartar el más viejo
    }
    buffer.push({
      company_id: evt.company_id || getCompanyId(),
      event_type: String(evt.event_type).slice(0, 32),
      query_name: String(evt.query_name).slice(0, 64),
      error_msg: evt.error_msg ? String(evt.error_msg).slice(0, 500) : null,
      duration_ms: Number.isFinite(evt.duration_ms) ? Math.round(evt.duration_ms) : null,
      user_agent: getUserAgent(),
      created_at: new Date().toISOString(),
    });
    if (buffer.length >= FLUSH_THRESHOLD) {
      scheduleFlush(0);
    } else {
      scheduleFlush(FLUSH_INTERVAL_MS);
    }
  } catch { /* nunca propagar */ }
}

function scheduleFlush(delay) {
  if (flushTimer || flushing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, delay);
}

export async function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  // Tomar snapshot del buffer y vaciarlo (pero conservar si falla)
  const toFlush = buffer.splice(0, buffer.length);
  try {
    // El servidor fuerza company_id (endpoint autenticado). Sin empresa activa
    // no se puede autenticar → se descarta el lote (telemetría no es crítica).
    const companyId = toFlush[0]?.company_id || getCompanyId();
    if (!companyId) return;
    const r = await dataApiCall('telemetryFlush', { companyId, events: toFlush });
    if (!r?.success) throw new Error(r?.error || 'telemetryFlush falló');
  } catch (e) {
    // Re-encolar (al inicio) para reintentar más tarde, pero limitado
    // a MAX_BUFFER para no acumular indefinidamente.
    buffer = [...toFlush.slice(-MAX_BUFFER + buffer.length), ...buffer];
    console.warn('[telemetry] flush falló, reencolado:', e?.message || e);
  } finally {
    flushing = false;
  }
}

// Flush al cerrar tab — best-effort al endpoint autenticado
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Intento best-effort, no podemos esperar Promise en beforeunload
    if (buffer.length > 0) flush().catch(() => {});
  });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && buffer.length > 0) {
      flush().catch(() => {});
    }
  });
}
