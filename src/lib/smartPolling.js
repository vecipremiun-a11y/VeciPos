// Smart polling — reemplazo de setInterval que respeta:
//   · Page Visibility API (pausa cuando la tab está oculta)
//   · navigator.onLine (pausa cuando no hay conexión)
//   · Actividad reciente (intervalo "active" vs "idle")
//   · Backoff exponencial ante errores
//   · Re-ejecución inmediata al volver a foco / online / actividad
//   · Sin overlapping (si la anterior aún corre, NO dispara otra)
//
// Drop-in replacement para `setInterval` en useEffects existentes:
//
//   useEffect(() => {
//     const stop = createSmartInterval(myFn, { activeMs: 60_000, idleMs: 300_000 });
//     return stop;
//   }, [dep]);
//
// Notas de compatibilidad:
//   · Es código de frontend puro, no toca Turso, Dexie, SII ni WooCommerce.
//   · Si no hay `document` (SSR / Node), degrada a setInterval simple.
//   · `markActivity()` se llama después de cada venta exitosa (ver useStore).
//     Esto reactiva todos los smart-intervals para refrescar al instante.

const state = {
  lastActivityAt: 0,
};

/** Listeners registrados que escuchan eventos de "wake" (markActivity). */
const wakeListeners = new Set();

/**
 * Marca que hubo actividad significativa (ej: venta, compra, mutación).
 * Mueve todos los intervals a modo "active" y dispara wake en los que pidieron
 * `runOnActivity: true`.
 */
export function markActivity() {
  state.lastActivityAt = Date.now();
  for (const cb of wakeListeners) {
    try {
      cb();
    } catch {
      // ignore
    }
  }
}

export function getLastActivity() {
  return state.lastActivityAt;
}

const DEFAULTS = {
  activeMs: 60_000,
  idleMs: 5 * 60_000,
  activeWindowMs: 5 * 60_000,
  pauseWhenHidden: true,
  pauseWhenOffline: true,
  runOnVisible: true,
  runOnOnline: true,
  runOnFocus: false,
  runOnActivity: false,
  runImmediately: false,
  maxBackoffMs: 5 * 60_000,
  backoffOnError: true,
  label: 'smart-poll',
};

/**
 * Crea un polling inteligente. Devuelve función `cancel()` para cleanup.
 *
 * @param {() => Promise<void> | void} callback Función a ejecutar.
 * @param {Partial<typeof DEFAULTS>} opts
 * @returns {() => void} cleanup
 */
export function createSmartInterval(callback, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  // Entorno sin window (SSR): fallback a setInterval simple.
  if (typeof window === 'undefined') {
    const id = setInterval(callback, cfg.idleMs);
    return () => clearInterval(id);
  }

  let cancelled = false;
  let timerId = null;
  let running = false;
  let consecutiveErrors = 0;

  function isActive() {
    return Date.now() - state.lastActivityAt < cfg.activeWindowMs;
  }

  function currentInterval() {
    let base = isActive() ? cfg.activeMs : cfg.idleMs;
    if (consecutiveErrors > 0 && cfg.backoffOnError) {
      base = Math.min(base * Math.pow(2, consecutiveErrors), cfg.maxBackoffMs);
    }
    return base;
  }

  async function tick() {
    if (cancelled) return;
    if (running) {
      schedule();
      return;
    }
    if (cfg.pauseWhenHidden && typeof document !== 'undefined' && document.hidden) {
      schedule();
      return;
    }
    if (cfg.pauseWhenOffline && typeof navigator !== 'undefined' && !navigator.onLine) {
      schedule();
      return;
    }
    running = true;
    try {
      await callback();
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors += 1;
      if (consecutiveErrors === 1 || consecutiveErrors % 5 === 0) {
        console.warn(`[smartPoll:${cfg.label}] error #${consecutiveErrors}:`, e?.message || e);
      }
    } finally {
      running = false;
      schedule();
    }
  }

  function schedule() {
    if (cancelled) return;
    clearTimeout(timerId);
    timerId = setTimeout(tick, currentInterval());
  }

  function runNow() {
    if (cancelled) return;
    clearTimeout(timerId);
    tick();
  }

  function onVisibility() {
    if (cancelled) return;
    if (!document.hidden && cfg.runOnVisible) runNow();
  }
  function onOnline() {
    if (cancelled) return;
    if (cfg.runOnOnline) runNow();
  }
  function onFocus() {
    if (cancelled) return;
    if (cfg.runOnFocus) runNow();
  }
  function onActivity() {
    if (cancelled) return;
    if (cfg.runOnActivity) runNow();
  }

  if (cfg.runImmediately) {
    tick();
  } else {
    schedule();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onFocus);
  wakeListeners.add(onActivity);

  return () => {
    cancelled = true;
    clearTimeout(timerId);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onFocus);
    wakeListeners.delete(onActivity);
  };
}
