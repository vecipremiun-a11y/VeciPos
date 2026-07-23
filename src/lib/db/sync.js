// Sincronización entre Turso (servidor) y Dexie (local).
//
// Funciones principales:
// - syncCatalogFromServer(companyId): descarga catálogo de la empresa activa.
// - syncPendingOpsToServer(companyId): procesa cola de operaciones offline.
//
// IMPORTANTE: Estas funciones NO modifican el store de Zustand. Solo escriben
// y leen Dexie y Turso. El store sigue siendo la fuente única de verdad para
// la UI online — Dexie es el respaldo para offline + arranque rápido.

import { localDb, pendingOpsApi, siiFoliosApi } from './localdb';
import { getTabUserId } from '../sessionGuard';

// Llama al endpoint autenticado de datos (sesión + membresía validadas server-side).
// Desde Fase 1 · Paso 6 el catálogo ya NO se lee con el token de Turso en el navegador.
async function dataApi(action, payload) {
  const r = await fetch('/api/data/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action, ...payload, expectedUserId: getTabUserId() }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data.data;
}

/**
 * Descarga el catálogo completo de una empresa desde Turso a Dexie.
 * Se ejecuta:
 *  - Al login (si hay internet).
 *  - Al cambiar de empresa (si hay internet).
 *  - Cada N minutos en background mientras hay internet.
 *
 * @param {string} companyId
 * @returns {Promise<{ok: boolean, counts?: object, error?: string}>}
 */
export async function syncCatalogFromServer(companyId) {
  if (!companyId) return { ok: false, error: 'companyId requerido' };
  if (!navigator.onLine) return { ok: false, error: 'offline' };

  try {
    // Lecturas vía API autenticada — el servidor filtra por company_id y
    // valida membresía. products llega SIN la columna image (carga bajo demanda).
    const { products, productLots, clients, categories, taxRates } =
      await dataApi('syncCatalog', { companyId });

    const stamp = (rows, extra = {}) =>
      rows.map((r) => ({ ...r, companyId, ...extra }));

    // Escribir todo en una transacción atómica de Dexie:
    // se purga el catálogo viejo de la empresa y se inserta el nuevo.
    await localDb.transaction(
      'rw',
      [
        localDb.products,
        localDb.productLots,
        localDb.clients,
        localDb.categories,
        localDb.taxRates,
        localDb.meta,
      ],
      async () => {
        await Promise.all([
          localDb.products.where('companyId').equals(companyId).delete(),
          localDb.productLots.where('companyId').equals(companyId).delete(),
          localDb.clients.where('companyId').equals(companyId).delete(),
          localDb.categories.where('companyId').equals(companyId).delete(),
          localDb.taxRates.where('companyId').equals(companyId).delete(),
        ]);

        await Promise.all([
          localDb.products.bulkPut(stamp(products)),
          localDb.productLots.bulkPut(
            stamp(productLots.map((r) => ({ ...r, productId: r.product_id })))
          ),
          localDb.clients.bulkPut(stamp(clients)),
          localDb.categories.bulkPut(stamp(categories)),
          localDb.taxRates.bulkPut(stamp(taxRates)),
        ]);

        await localDb.meta.put({
          key: `lastSync:${companyId}`,
          value: new Date().toISOString(),
        });
      }
    );

    const counts = {
      products: products.length,
      productLots: productLots.length,
      clients: clients.length,
      categories: categories.length,
      taxRates: taxRates.length,
    };

    console.log('[sync] Catálogo sincronizado:', counts);
    return { ok: true, counts };
  } catch (err) {
    console.error('[sync] Error sincronizando catálogo:', err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * FASE 8.1 + 8.3 — Sincronización incremental del catálogo.
 *
 * Trae solo las filas con `updated_at > lastSync` de las 5 tablas catálogo:
 * products + tax_rates (desde Fase 8.1, con updated_at de Fase 2.5) +
 * clients + categories + product_lots (desde Fase 8.3, con updated_at
 * añadido por la migration de Fase 8.2).
 *
 * Comportamiento:
 * - Si no hay `lastSync` registrado en Dexie → fallback a `syncCatalogFromServer`
 *   (primera vez en este browser/empresa).
 * - bulkPut de Dexie es upsert por PK (`&id`): actualiza si existe, inserta si no.
 *   No se borran filas — el full sync (login/switch) sigue siendo la fuente
 *   de verdad para purgar locales obsoletos (soft-delete diferido).
 * - `lastSync` se actualiza al MAX(updated_at) observado en las filas
 *   descargadas. Si no llegan filas (sin cambios), `lastSync` NO se mueve —
 *   la próxima pasada repite el mismo rango (idempotente, query barata).
 * - product_lots aquí NO filtra por `quantity > 0` (el full sí lo hace) —
 *   para incremental queremos también detectar lotes que llegan a 0
 *   (vencidos / agotados / consumidos por venta).
 *
 * Pensado para reemplazar el sync de cada polling (cada 60s/5min). Los
 * paths críticos (startup, cambio de empresa, refresh manual) deben seguir
 * llamando a `syncCatalogFromServer` (full).
 *
 * @param {string} companyId
 * @returns {Promise<{ok: boolean, counts?: object, mode?: 'incremental'|'full', lastSync?: string, error?: string}>}
 */
export async function syncCatalogIncremental(companyId) {
  if (!companyId) return { ok: false, error: 'companyId requerido' };
  if (!navigator.onLine) return { ok: false, error: 'offline' };

  const lastSyncRow = await localDb.meta.get(`lastSync:${companyId}`);
  const lastSync = lastSyncRow?.value;

  // Primera vez (sin checkpoint): cae al full sync para inicializar.
  if (!lastSync) {
    return syncCatalogFromServer(companyId);
  }

  try {
    // Incremental vía API autenticada (updated_at > lastSync, server-side)
    const { products, productLots, clients, categories, taxRates } =
      await dataApi('syncCatalog', { companyId, since: lastSync });

    const stamp = (rows, extra = {}) => rows.map((r) => ({ ...r, companyId, ...extra }));
    const allRows = [
      ...products,
      ...productLots,
      ...clients,
      ...categories,
      ...taxRates,
    ];

    // Avanzar checkpoint solo si efectivamente trajimos filas. Si quedó vacío,
    // no movemos lastSync — la próxima pasada repite la ventana (sin pérdida).
    const maxUpdatedAt = allRows.reduce((max, r) => {
      const t = r.updated_at;
      return t && String(t) > String(max) ? String(t) : max;
    }, lastSync);

    await localDb.transaction(
      'rw',
      [
        localDb.products,
        localDb.productLots,
        localDb.clients,
        localDb.categories,
        localDb.taxRates,
        localDb.meta,
      ],
      async () => {
        if (products.length) {
          await localDb.products.bulkPut(stamp(products));
        }
        if (productLots.length) {
          await localDb.productLots.bulkPut(
            stamp(productLots.map((r) => ({ ...r, productId: r.product_id })))
          );
        }
        if (clients.length) {
          await localDb.clients.bulkPut(stamp(clients));
        }
        if (categories.length) {
          await localDb.categories.bulkPut(stamp(categories));
        }
        if (taxRates.length) {
          await localDb.taxRates.bulkPut(stamp(taxRates));
        }
        if (maxUpdatedAt !== lastSync) {
          await localDb.meta.put({
            key: `lastSync:${companyId}`,
            value: maxUpdatedAt,
          });
        }
      }
    );

    const counts = {
      products: products.length,
      productLots: productLots.length,
      clients: clients.length,
      categories: categories.length,
      taxRates: taxRates.length,
    };

    if (allRows.length > 0) {
      console.log('[sync] Incremental:', counts, 'lastSync→', maxUpdatedAt);
    }
    return { ok: true, counts, mode: 'incremental', lastSync: maxUpdatedAt };
  } catch (err) {
    console.error('[sync] Error sincronización incremental:', err);
    return { ok: false, mode: 'incremental', error: String(err?.message || err) };
  }
}

/**
 * Procesa la cola de operaciones offline pendientes.
 * Por ahora solo soporta 'sale' (delegando al store.addSale).
 * Las demás operaciones (return, cash_open, etc.) se agregarán en Fase 2.
 *
 * @param {string} companyId
 * @param {object} storeApi - referencia al estado del store (useStore.getState())
 *                           necesario para reusar addSale sin import circular.
 * @returns {Promise<{processed: number, remaining: number, errors: number}>}
 */
export async function syncPendingOpsToServer(companyId, storeApi) {
  if (!companyId || !navigator.onLine) {
    return { processed: 0, remaining: 0, errors: 0, offline: !navigator.onLine };
  }

  const pending = await pendingOpsApi.list(companyId);
  const now = Date.now();

  // La venta se graba a nombre de quien tiene la sesión del navegador AHORA, no de
  // quien la encoló. Si son distintos (el cajero cerró sesión y entró otro), la venta
  // caería en la caja equivocada. Se dejan en espera —sin gastar reintentos— hasta que
  // vuelva a entrar su dueño. Ver src/lib/sessionGuard.js
  const sessionUserId = getTabUserId();
  const isForeign = (o) =>
    o.userId != null && sessionUserId != null && Number(o.userId) !== Number(sessionUserId);

  // Procesar:
  //  - 'queued' siempre
  //  - 'error' solo si pasó el backoff (nextAttemptAt) y no superó intentos
  const candidates = pending.filter((o) => {
    if (isForeign(o)) return false;
    if (o.status === 'queued') return true;
    if (o.status === 'error' && (o.attempts || 0) < 10) {
      if (!o.nextAttemptAt) return true;
      return new Date(o.nextAttemptAt).getTime() <= now;
    }
    return false;
  });

  const deferred = pending.filter(isForeign).length;
  if (deferred > 0) {
    console.warn(`[sync] ${deferred} venta(s) offline en espera: las encoló otro usuario. Se sincronizarán cuando vuelva a iniciar sesión.`);
  }

  let processed = 0;
  let errors = 0;

  for (const op of candidates) {
    if (op.attempts >= 10) {
      await pendingOpsApi.markError(op.tempId, 'Máximo de reintentos alcanzado (10)');
      errors++;
      continue;
    }

    await pendingOpsApi.markSyncing(op.tempId);
    try {
      if (op.type === 'sale' && storeApi?.addSale) {
        // Marcar payload como reintento offline para que addSale no entre de nuevo
        // a la rama _addSaleOffline aunque navigator esté momentáneamente offline.
        const result = await storeApi.addSale({ ...op.payload, _fromOfflineQueue: true });
        if (result?.success && !result.queued) {
          // Si la venta tenía folio offline reservado, emitir el DTE real ahora.
          const offlineFolio = op.payload?._offlineFolio;
          const offlineFolioId = op.payload?._offlineFolioId;
          const tipoDte = op.payload?._offlineFolioTipoDte || op.payload?.tipoDte;
          if (offlineFolio && tipoDte && result.saleId) {
            try {
              const emitRes = await fetch('/api/sii/emit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-company-id': companyId },
                body: JSON.stringify({
                  sale_id: result.saleId,
                  tipo_dte: tipoDte,
                  folio: offlineFolio,
                }),
              });
              const emitData = await emitRes.json().catch(() => ({}));
              if (emitRes.ok) {
                console.log(`[sii] DTE emitido para venta offline: folio ${emitData.folio} track ${emitData.track_id}`);
                // Limpiar el folio usado de Dexie (ya no se necesita)
                if (offlineFolioId) {
                  await siiFoliosApi.removeUsed(offlineFolioId).catch(() => {});
                }
              } else {
                console.warn(`[sii] Emisión DTE falló para venta ${result.saleId}:`, emitData);
                // Dejar el folio marcado como 'used' en Dexie para no reusarlo.
                // Se puede reintentar manualmente desde la UI de DTEs pendientes.
              }
            } catch (emitErr) {
              console.warn('[sii] Error emitiendo DTE post-sync:', emitErr);
            }
          }
          await pendingOpsApi.markSynced(op.tempId, result.saleId);
          processed++;
        } else if (result?.queued) {
          // Sigue offline: retornar a queued sin contar como error
          await pendingOpsApi.retry(op.tempId);
        } else {
          throw new Error(result?.error || 'addSale falló sin mensaje');
        }
      } else {
        throw new Error(`Tipo de operación no soportada aún: ${op.type}`);
      }
    } catch (err) {
      await pendingOpsApi.markError(op.tempId, err);
      errors++;
    }
  }

  const remaining = (await pendingOpsApi.list(companyId, 'queued')).length;
  return { processed, remaining, errors, deferred };
}

/**
 * Migra la cola legacy de localStorage ('poskem_pending_sales_v1') a Dexie.
 * Se llama una sola vez al inicio.
 */
export async function migrateLegacyQueueToDexie() {
  try {
    const raw = localStorage.getItem('poskem_pending_sales_v1');
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue) || queue.length === 0) {
      localStorage.removeItem('poskem_pending_sales_v1');
      return 0;
    }
    let migrated = 0;
    for (const entry of queue) {
      // Verificar que no esté ya en Dexie
      const existing = await localDb.pendingOps.get(entry.tempId);
      if (existing) continue;
      await localDb.pendingOps.put({
        tempId: entry.tempId,
        companyId: entry.companyId,
        userId: entry.userId,
        type: 'sale',
        payload: entry.sale,
        attempts: entry.attempts || 0,
        status: 'queued',
        lastError: entry.lastError || null,
        createdAt: entry.queuedAt || new Date().toISOString(),
        syncedAt: null,
      });
      migrated++;
    }
    if (migrated > 0) {
      console.log(`[sync] Migradas ${migrated} ventas legacy de localStorage a Dexie`);
    }
    // Limpiar localStorage tras migración exitosa
    localStorage.removeItem('poskem_pending_sales_v1');
    return migrated;
  } catch (err) {
    console.warn('[sync] Error migrando cola legacy:', err);
    return 0;
  }
}

// =====================================================
// FOLIOS CAF PRE-RESERVADOS PARA EMISIÓN OFFLINE
// =====================================================

/**
 * Descarga del servidor los folios pre-reservados disponibles para esta empresa
 * y los guarda en Dexie. Idempotente (usa el id del servidor como PK).
 *
 * @param {string} companyId
 * @param {number} tipoDte (default 39 = boleta)
 * @param {string} userId opcional para filtrar reservas por usuario
 */
export async function syncReservedFoliosFromServer(companyId, tipoDte = 39, userId = null) {
  if (!companyId) return { ok: false, error: 'companyId requerido' };
  if (!navigator.onLine) return { ok: false, error: 'offline' };

  try {
    const params = new URLSearchParams({ tipo_dte: String(tipoDte) });
    if (userId) params.set('user_id', userId);
    const r = await fetch(`/api/sii/reserved-folios?${params}`, {
      headers: { 'x-company-id': companyId },
    });
    if (!r.ok) {
      // Si el endpoint no existe (404) o el SII no está activo, no es crítico
      if (r.status === 404) return { ok: false, skipped: true };
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    const data = await r.json();
    const folios = (data.folios || []).map((f) => ({
      id: f.id,
      companyId,
      tipoDte: f.tipo_dte,
      folio: f.folio,
      cafId: f.caf_id,
    }));
    const added = await siiFoliosApi.bulkPutAvailable(folios);
    console.log(`[sii] Folios offline sincronizados: ${added} (tipo ${tipoDte})`);
    return { ok: true, added };
  } catch (err) {
    console.warn('[sii] No se pudieron sincronizar folios:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Si quedan menos de `min` folios disponibles en Dexie, reserva `want` más
 * en el servidor y los descarga. Llamar periódicamente cuando hay internet.
 *
 * @param {string} companyId
 * @param {number} tipoDte (default 39)
 * @param {string|null} userId
 * @param {number} min umbral (default 30)
 * @param {number} want cantidad a reservar si se gatilla (default 100)
 */
export async function ensureMinimumFolios(companyId, tipoDte = 39, userId = null, min = 30, want = 100, opts = {}) {
  if (!companyId || !navigator.onLine) return { ok: false, skipped: true };
  try {
    await syncReservedFoliosFromServer(companyId, tipoDte, userId);
    const have = await siiFoliosApi.count(companyId, tipoDte, 'available');
    if (have >= min) return { ok: true, have, reserved: 0 };

    const r = await fetch('/api/sii/reserve-folios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-company-id': companyId },
      body: JSON.stringify({ tipo_dte: tipoDte, count: want, user_id: userId, force: opts.force === true }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    const data = await r.json();
    if (data.skipped) {
      return { ok: false, skipped: true, have, reserved: 0, reason: data.reason || data.message };
    }
    // Re-sincronizar para guardar los recién creados
    await syncReservedFoliosFromServer(companyId, tipoDte, userId);
    console.log(`[sii] Reservados ${data.reserved} folios (${data.folio_from}-${data.folio_to})`);
    return { ok: true, have, reserved: data.reserved };
  } catch (err) {
    console.warn('[sii] ensureMinimumFolios falló:', err.message);
    return { ok: false, error: err.message };
  }
}
