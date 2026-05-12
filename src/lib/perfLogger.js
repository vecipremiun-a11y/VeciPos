// Logger de performance TEMPORAL (Fase 1 del plan de optimización).
//
// OBJETIVO: medir queries lentas / sync / polling / búsqueda productos
// SIN modificar lógica de negocio. Es opt-in y no se ejecuta a menos que
// se active explícitamente (flag global o localStorage).
//
// Cómo activar en el navegador:
//   localStorage.setItem('perfLog', '1')          -> activa logs en consola
//   localStorage.setItem('perfLog.slowMs', '300') -> umbral de "query lenta" en ms
//   localStorage.removeItem('perfLog')            -> desactiva
//
// Cómo activar en Node (scripts):
//   process.env.PERF_LOG = '1'
//
// Esta capa NO altera el resultado de las queries. Si está inactiva,
// `time(label, fn)` simplemente devuelve `fn()` sin overhead extra notable.
//
// NOTA: este archivo es seguro de importar desde cualquier módulo. Si el entorno
// no tiene `localStorage` (Node), usa env var. Si no hay ninguno, está OFF.

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

function readFlag(key, fallback = null) {
  try {
    if (isBrowser) {
      const v = window.localStorage.getItem(key);
      if (v != null) return v;
    }
    if (typeof process !== 'undefined' && process.env) {
      const envKey = key.toUpperCase().replace(/\./g, '_');
      if (process.env[envKey] != null) return process.env[envKey];
    }
  } catch {}
  return fallback;
}

export function isEnabled() {
  return readFlag('perfLog') === '1' || readFlag('perfLog') === 'true';
}

export function slowThresholdMs() {
  const v = Number(readFlag('perfLog.slowMs', '250'));
  return Number.isFinite(v) && v > 0 ? v : 250;
}

// Acumulador en memoria (sirve para inspección desde DevTools: window.__perfStats)
const stats = {
  queries: [], // {label, ms, slow, ts}
  buckets: new Map(), // label -> { count, totalMs, maxMs, slowCount }
};

function record(label, ms) {
  const slow = ms >= slowThresholdMs();
  stats.queries.push({ label, ms, slow, ts: Date.now() });
  if (stats.queries.length > 500) stats.queries.shift(); // cap memoria
  let b = stats.buckets.get(label);
  if (!b) {
    b = { count: 0, totalMs: 0, maxMs: 0, slowCount: 0 };
    stats.buckets.set(label, b);
  }
  b.count += 1;
  b.totalMs += ms;
  b.maxMs = Math.max(b.maxMs, ms);
  if (slow) b.slowCount += 1;

  if (isEnabled()) {
    const prefix = slow ? '%c[perf SLOW]' : '%c[perf]';
    const css = slow ? 'color:#b00;font-weight:bold' : 'color:#888';
    try {
      // eslint-disable-next-line no-console
      console.log(prefix, css, label, `${ms} ms`);
    } catch {
      // eslint-disable-next-line no-console
      console.log('[perf]', label, ms + 'ms');
    }
  }
}

/**
 * Mide una función async. Devuelve EXACTAMENTE lo que devuelva `fn`.
 * Si el logger está OFF se mide igualmente (overhead despreciable) para tener
 * estadísticas si el usuario lo activa luego — los logs en consola sí se omiten.
 */
export async function time(label, fn) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    record(label, Date.now() - t0);
  }
}

/** Versión sync. */
export function timeSync(label, fn) {
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    record(label, Date.now() - t0);
  }
}

/** Snapshot de stats agregados (para inspección manual). */
export function getStats() {
  const buckets = {};
  for (const [k, v] of stats.buckets.entries()) {
    buckets[k] = {
      count: v.count,
      avgMs: Math.round(v.totalMs / v.count),
      maxMs: v.maxMs,
      slowCount: v.slowCount,
    };
  }
  return { recent: stats.queries.slice(-50), buckets };
}

export function resetStats() {
  stats.queries.length = 0;
  stats.buckets.clear();
}

// Exponer en window para inspección desde DevTools (no rompe nada si ya existe)
if (isBrowser) {
  try {
    window.__perf = { getStats, resetStats, isEnabled, slowThresholdMs };
  } catch {}
}
