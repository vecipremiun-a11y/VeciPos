// IndexedDB local para soporte offline del POS.
// Usa Dexie (wrapper liviano de IndexedDB).
//
// Diseño:
// - Cada empresa tiene su catálogo aislado: las tablas guardan companyId y
//   se filtra siempre por activeCompanyId.
// - Al cambiar de empresa se purga el contenido de todas las tablas catálogo
//   (ver `purgeCompanyData`) para mantener tamaño chico y evitar datos cruzados.
// - La tabla `pendingOps` mantiene la cola de operaciones por sincronizar
//   (ventas offline, devoluciones, aperturas/cierres de caja, etc.).
// - La tabla `meta` guarda timestamps de última sincronización por empresa.
//
// IMPORTANTE: Esta capa es AISLADA. NO interfiere con Turso ni con el flujo
// online. Solo se usa cuando navigator.onLine === false o como caché para
// arranque rápido.

import Dexie from 'dexie';

export const localDb = new Dexie('posveci_local_v1');

// v1: schema inicial
localDb.version(1).stores({
  // Catálogo por empresa (todos llevan companyId como índice principal)
  products: '&id, companyId, sku, barcode, name, category',
  productLots: '&id, companyId, productId, expirationDate',
  clients: '&id, companyId, rut, name',
  categories: '&id, companyId, name',
  taxRates: '&id, companyId, name',
  paymentMethods: '&id, companyId, name',
  // Folios CAF pre-asignados para ventas offline (Fase 4 SII)
  // Estructura: { id, companyId, tipoDte, folioActual, folioHasta, cafXml }
  siiFolios: '&id, companyId, tipoDte',

  // Cola de operaciones pendientes de sincronizar
  // Estructura: { tempId, companyId, userId, type, payload, attempts,
  //              status: 'queued'|'syncing'|'synced'|'error', lastError,
  //              createdAt, syncedAt }
  pendingOps: '&tempId, companyId, status, type, createdAt',

  // Metadatos: última sincronización por empresa
  // Estructura: { key: `lastSync:${companyId}`, value: ISO date }
  meta: '&key',
});

/**
 * Purga TODO el catálogo de una empresa específica.
 * Se llama al cambiar de empresa para evitar datos cruzados.
 * NO toca pendingOps (las ventas offline pendientes deben sobrevivir).
 */
export async function purgeCompanyData(companyId) {
  if (!companyId) return;
  const tables = ['products', 'productLots', 'clients', 'categories', 'taxRates', 'paymentMethods', 'siiFolios'];
  await Promise.all(
    tables.map((t) => localDb[t].where('companyId').equals(companyId).delete())
  );
  await localDb.meta.delete(`lastSync:${companyId}`);
}

/**
 * Purga TODO el catálogo de TODAS las empresas (ej: al hacer logout).
 * NO toca pendingOps.
 */
export async function purgeAllCatalog() {
  const tables = ['products', 'productLots', 'clients', 'categories', 'taxRates', 'paymentMethods', 'siiFolios'];
  await Promise.all(tables.map((t) => localDb[t].clear()));
  await localDb.meta.clear();
}

/**
 * Reporta tamaño aproximado del catálogo cargado en local para una empresa.
 * Útil para diagnóstico y para mostrar al usuario.
 */
export async function getLocalCatalogStats(companyId) {
  if (!companyId) return null;
  const [products, productLots, clients, categories, taxRates, paymentMethods, siiFolios] = await Promise.all([
    localDb.products.where('companyId').equals(companyId).count(),
    localDb.productLots.where('companyId').equals(companyId).count(),
    localDb.clients.where('companyId').equals(companyId).count(),
    localDb.categories.where('companyId').equals(companyId).count(),
    localDb.taxRates.where('companyId').equals(companyId).count(),
    localDb.paymentMethods.where('companyId').equals(companyId).count(),
    localDb.siiFolios.where('companyId').equals(companyId).count(),
  ]);
  const lastSync = await localDb.meta.get(`lastSync:${companyId}`);
  return {
    companyId,
    products,
    productLots,
    clients,
    categories,
    taxRates,
    paymentMethods,
    siiFolios,
    lastSync: lastSync?.value || null,
  };
}

/**
 * Helpers de pendingOps (cola de operaciones offline).
 */
export const pendingOpsApi = {
  async list(companyId, status = null) {
    let q = localDb.pendingOps.where('companyId').equals(companyId);
    const all = await q.toArray();
    return status ? all.filter((o) => o.status === status) : all;
  },

  async count(companyId, status = null) {
    const items = await this.list(companyId, status);
    return items.length;
  },

  async add(op) {
    // op: { tempId?, companyId, userId, type, payload }
    const tempId = op.tempId || `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const entry = {
      tempId,
      companyId: op.companyId,
      userId: op.userId || null,
      type: op.type, // 'sale' | 'return' | 'cash_open' | 'cash_close' | etc.
      payload: op.payload,
      attempts: 0,
      status: 'queued',
      lastError: null,
      createdAt: new Date().toISOString(),
      syncedAt: null,
    };
    await localDb.pendingOps.put(entry);
    return entry;
  },

  async markSyncing(tempId) {
    await localDb.pendingOps.update(tempId, { status: 'syncing' });
  },

  async markSynced(tempId, serverId = null) {
    await localDb.pendingOps.update(tempId, {
      status: 'synced',
      syncedAt: new Date().toISOString(),
      serverId,
    });
  },

  async markError(tempId, error) {
    const op = await localDb.pendingOps.get(tempId);
    if (!op) return;
    const attempts = (op.attempts || 0) + 1;
    // Backoff exponencial: 30s, 1min, 2min, 4min, ... cap 1h
    const backoffMs = Math.min(30_000 * Math.pow(2, attempts - 1), 60 * 60_000);
    await localDb.pendingOps.update(tempId, {
      status: 'error',
      lastError: String(error?.message || error || 'Error desconocido'),
      attempts,
      nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
    });
  },

  async retry(tempId) {
    // Reintento manual: limpia error y backoff
    await localDb.pendingOps.update(tempId, {
      status: 'queued',
      lastError: null,
      nextAttemptAt: null,
    });
  },

  async remove(tempId) {
    await localDb.pendingOps.delete(tempId);
  },

  async clearSynced(companyId, olderThanDays = 7) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const all = await localDb.pendingOps.where('companyId').equals(companyId).toArray();
    const toDelete = all.filter(
      (o) => o.status === 'synced' && o.syncedAt && new Date(o.syncedAt).getTime() < cutoff
    );
    if (toDelete.length) {
      await Promise.all(toDelete.map((o) => localDb.pendingOps.delete(o.tempId)));
    }
    return toDelete.length;
  },
};

/**
 * Helpers de folios offline (CAF pre-reservados para emisión sin internet).
 *
 * Estructura por fila en `siiFolios`:
 *   { id, companyId, tipoDte, folio, cafId, status: 'available'|'used',
 *     saleTempId?: string, takenAt?: ISO }
 *
 * El `id` viene del servidor (sii_offline_folios.id) — usarlo evita duplicados
 * al re-sincronizar.
 */
export const siiFoliosApi = {
  async count(companyId, tipoDte = 39, status = 'available') {
    const items = await localDb.siiFolios
      .where('companyId').equals(companyId)
      .filter((f) => f.tipoDte === tipoDte && (!status || f.status === status))
      .toArray();
    return items.length;
  },

  async list(companyId, tipoDte = 39, status = null) {
    const items = await localDb.siiFolios
      .where('companyId').equals(companyId)
      .filter((f) => f.tipoDte === tipoDte && (!status || f.status === status))
      .toArray();
    return items.sort((a, b) => a.folio - b.folio);
  },

  async bulkPutAvailable(folios) {
    // folios: [{ id, companyId, tipoDte, folio, cafId }]
    if (!folios?.length) return 0;
    const rows = folios.map((f) => ({
      id: f.id,
      companyId: f.companyId,
      tipoDte: f.tipoDte,
      folio: f.folio,
      cafId: f.cafId,
      status: 'available',
    }));
    await localDb.siiFolios.bulkPut(rows);
    return rows.length;
  },

  /**
   * Toma el folio disponible más bajo y lo marca como 'used'.
   * Retorna { id, folio, tipoDte, cafId } o null si no hay disponibles.
   */
  async takeOne(companyId, tipoDte = 39, saleTempId = null) {
    return await localDb.transaction('rw', localDb.siiFolios, async () => {
      const candidates = await localDb.siiFolios
        .where('companyId').equals(companyId)
        .filter((f) => f.tipoDte === tipoDte && f.status === 'available')
        .toArray();
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => a.folio - b.folio);
      const taken = candidates[0];
      await localDb.siiFolios.update(taken.id, {
        status: 'used',
        saleTempId,
        takenAt: new Date().toISOString(),
      });
      return { id: taken.id, folio: taken.folio, tipoDte: taken.tipoDte, cafId: taken.cafId };
    });
  },

  async releaseFolio(id) {
    const f = await localDb.siiFolios.get(id);
    if (!f) return;
    await localDb.siiFolios.update(id, { status: 'available', saleTempId: null, takenAt: null });
  },

  async removeUsed(id) {
    await localDb.siiFolios.delete(id);
  },
};
