// FASE 5.5 · Auto-update PWA controlado.
//
// Problema que esto resuelve:
//   En Fase 4 se detectaron 223 ventas sin mirror porque un usuario seguía
//   ejecutando un bundle JS antiguo cacheado por el Service Worker. El SW
//   nuevo se descarga pero NO toma control de la pestaña activa hasta que
//   el usuario cierre y reabra. Resultado: usuarios corriendo código viejo
//   por horas o días.
//
// Estrategia:
//   1) `registerSW` con auto-update — descarga el nuevo SW en segundo plano.
//   2) Polling periódico (cada 10 min) para detectar nuevos deploys aunque
//      el usuario no recargue.
//   3) Cuando hay nueva versión:
//        · Mostrar banner discreto al usuario ("Nueva versión disponible").
//        · Usuario puede aplicar ahora.
//        · Si el usuario no hace nada en 30 min de inactividad → auto-aplica.
//        · Last-resort: aplicar tras 24h sin importar (refresh suave).
//   4) Persistir estado en localStorage para no perder el aviso entre
//      navegaciones, y evitar recargar dos veces seguidas en pocos segundos.
//
// SAFETY:
//   · NUNCA recargar durante una transacción activa (venta en curso).
//   · NUNCA recargar si hay operaciones offline encoladas pendientes.
//   · Si la app está offline, esperar a que vuelva online para refrescar.
//   · Ofrecer "Aplicar más tarde" siempre.

const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;      // 10 min
const AUTO_APPLY_AFTER_IDLE_MS = 30 * 60 * 1000;     // 30 min sin actividad
const AUTO_APPLY_HARD_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 h máximo
const LS_KEY_FIRST_SEEN = 'pwa_update_first_seen';
const LS_KEY_DISMISSED = 'pwa_update_dismissed_at';

let updateState = {
  needRefresh: false,
  updateSW: null,
  registration: null,
  firstSeen: null,
  lastActivity: Date.now(),
  callbacks: new Set(),
  hardTimer: null,
  idleTimer: null,
};

/**
 * Registra callbacks UI que reciben { needRefresh, applyUpdate, dismiss }.
 */
export function subscribePwaUpdate(cb) {
  updateState.callbacks.add(cb);
  // Disparar el estado actual de inmediato
  cb(getPublicState());
  return () => updateState.callbacks.delete(cb);
}

function getPublicState() {
  return {
    needRefresh: updateState.needRefresh,
    firstSeen: updateState.firstSeen,
    applyUpdate: applyUpdate,
    dismiss: dismiss,
  };
}

function emit() {
  const s = getPublicState();
  updateState.callbacks.forEach(cb => {
    try { cb(s); } catch (e) { console.error('[pwaUpdate] callback', e); }
  });
}

/**
 * Forzar refresh aplicando el nuevo SW. Se ejecuta cuando el usuario lo
 * acepta o cuando vence el hard-limit / idle-timeout.
 *
 * SAFETY:
 *   - Verifica que no haya operaciones offline encoladas. Si las hay,
 *     posterga 2 min y reintenta.
 *   - Verifica online status; si offline, agenda check cada 60s.
 */
export async function applyUpdate({ reason = 'user' } = {}) {
  try {
    // 1. Si offline → esperar
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      console.warn('[pwaUpdate] offline, posponiendo refresh');
      setTimeout(() => applyUpdate({ reason }), 60_000);
      return;
    }

    // 2. Si hay ops offline pendientes → esperar
    try {
      const { pendingOpsApi } = await import('./db/localdb.js');
      const companyId = window.__POSKEM_ACTIVE_COMPANY_ID__;
      if (companyId) {
        const pending = await pendingOpsApi.count(companyId, 'queued');
        if (pending > 0) {
          console.warn(`[pwaUpdate] ${pending} ops offline pendientes, posponiendo refresh 2min`);
          setTimeout(() => applyUpdate({ reason }), 2 * 60_000);
          return;
        }
      }
    } catch { /* localdb opcional */ }

    // 3. Aplicar
    console.log(`[pwaUpdate] aplicando refresh (motivo=${reason})`);
    cleanupTimers();
    try { localStorage.removeItem(LS_KEY_FIRST_SEEN); } catch {}
    try { localStorage.removeItem(LS_KEY_DISMISSED); } catch {}

    if (typeof updateState.updateSW === 'function') {
      // vite-plugin-pwa: updateSW(true) hace skipWaiting + reload
      updateState.updateSW(true);
    } else {
      // Fallback: reload normal
      window.location.reload();
    }
  } catch (e) {
    console.error('[pwaUpdate] error aplicando refresh', e);
  }
}

export function dismiss() {
  try { localStorage.setItem(LS_KEY_DISMISSED, String(Date.now())); } catch {}
  // No quitamos needRefresh — el banner sigue visible pero menos intrusivo.
  emit();
}

function cleanupTimers() {
  if (updateState.hardTimer) { clearTimeout(updateState.hardTimer); updateState.hardTimer = null; }
  if (updateState.idleTimer) { clearTimeout(updateState.idleTimer); updateState.idleTimer = null; }
}

function scheduleAutoApply() {
  cleanupTimers();
  const now = Date.now();
  const firstSeen = updateState.firstSeen || now;
  const hardDeadline = firstSeen + AUTO_APPLY_HARD_LIMIT_MS;
  const msUntilHard = Math.max(60_000, hardDeadline - now);

  updateState.hardTimer = setTimeout(() => {
    console.log('[pwaUpdate] hard limit 24h alcanzado → aplicar refresh');
    applyUpdate({ reason: 'hard_limit' });
  }, msUntilHard);

  // Idle auto-apply: tras 30 min sin actividad detectada
  const idleCheck = () => {
    const sinceActivity = Date.now() - updateState.lastActivity;
    if (sinceActivity >= AUTO_APPLY_AFTER_IDLE_MS) {
      console.log('[pwaUpdate] idle 30min → aplicar refresh');
      applyUpdate({ reason: 'idle' });
    } else {
      updateState.idleTimer = setTimeout(idleCheck, AUTO_APPLY_AFTER_IDLE_MS - sinceActivity + 1000);
    }
  };
  updateState.idleTimer = setTimeout(idleCheck, AUTO_APPLY_AFTER_IDLE_MS);
}

function markActivity() {
  updateState.lastActivity = Date.now();
}

/**
 * Llama una sola vez desde main.jsx (después de createRoot).
 * Si el browser no soporta SW o estamos en dev sin PWA, no hace nada.
 */
export async function initPwaUpdate() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Capturar actividad del usuario para idle-detection
  ['click', 'keydown', 'pointerdown', 'visibilitychange'].forEach(ev => {
    window.addEventListener(ev, markActivity, { passive: true });
  });

  try {
    // Import dinámico — vite-plugin-pwa expone este módulo virtual
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        const now = Date.now();
        let firstSeen = null;
        try {
          const stored = localStorage.getItem(LS_KEY_FIRST_SEEN);
          firstSeen = stored ? Number(stored) : null;
        } catch {}
        if (!firstSeen) {
          firstSeen = now;
          try { localStorage.setItem(LS_KEY_FIRST_SEEN, String(firstSeen)); } catch {}
        }
        updateState.needRefresh = true;
        updateState.firstSeen = firstSeen;
        scheduleAutoApply();
        emit();
        console.log('[pwaUpdate] nueva versión disponible');
      },
      onOfflineReady() {
        console.log('[pwaUpdate] app lista para offline');
      },
      onRegisteredSW(swUrl, r) {
        if (r) updateState.registration = r;
        // Chequea servidor periódicamente para detectar nuevos deploys
        // sin esperar a que el usuario navegue/recargue.
        if (r) {
          setInterval(() => {
            try { r.update(); } catch (e) { /* noop */ }
          }, UPDATE_CHECK_INTERVAL_MS);
        }
      },
      onRegisterError(err) {
        console.error('[pwaUpdate] error registrando SW', err);
      },
    });
    updateState.updateSW = updateSW;
  } catch (e) {
    // En dev sin PWA, virtual:pwa-register no existe — es OK
    if (!String(e?.message || '').includes('virtual:pwa-register')) {
      console.error('[pwaUpdate] init error', e);
    }
  }
}
