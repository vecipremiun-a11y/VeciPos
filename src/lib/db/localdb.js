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

// v2: se cae el índice `barcode` de products.
//
// Nunca indexó nada: la tabla `products` de Turso NO tiene columna `barcode`
// —el código de barras se guarda en `sku`— así que el índice quedaba siempre
// vacío y la búsqueda offline que filtraba por `p.barcode` no matcheaba nunca.
// Dexie solo necesita las tablas que cambian; el resto queda igual que en v1.
// También entra la tabla de fotos guardadas: el catálogo viaja sin la columna
// `image` (base64, 161 MB en la empresa más grande), así que las fotos se
// guardan aparte y solo las que la app ya descargó. Ver imagenesLocal.js.
// El índice [companyId+ts] permite elegir las más viejas para borrar sin tener
// que cargar las fotos en memoria.
localDb.version(2).stores({
  products: '&id, companyId, sku, name, category',
  productImages: '&id, companyId, [companyId+ts]',
});

/**
 * Purga TODO el catálogo de una empresa específica.
 * Se llama al cambiar de empresa para evitar datos cruzados.
 * NO toca pendingOps (las ventas offline pendientes deben sobrevivir).
 */
export async function purgeCompanyData(companyId) {
  if (!companyId) return;
  const tables = ['products', 'productLots', 'clients', 'categories', 'taxRates', 'paymentMethods', 'siiFolios', 'productImages'];
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
  const tables = ['products', 'productLots', 'clients', 'categories', 'taxRates', 'paymentMethods', 'siiFolios', 'productImages'];
  await Promise.all(tables.map((t) => localDb[t].clear()));
  await localDb.meta.clear();
}

/**
 * Reporta tamaño aproximado del catálogo cargado en local para una empresa.
 * Útil para diagnóstico y para mostrar al usuario.
 */
export async function getLocalCatalogStats(companyId) {
  if (!companyId) return null;
  const [products, productLots, clients, categories, taxRates, paymentMethods, siiFolios, productImages] = await Promise.all([
    localDb.products.where('companyId').equals(companyId).count(),
    localDb.productLots.where('companyId').equals(companyId).count(),
    localDb.clients.where('companyId').equals(companyId).count(),
    localDb.categories.where('companyId').equals(companyId).count(),
    localDb.taxRates.where('companyId').equals(companyId).count(),
    localDb.paymentMethods.where('companyId').equals(companyId).count(),
    localDb.siiFolios.where('companyId').equals(companyId).count(),
    localDb.productImages.where('companyId').equals(companyId).count(),
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
    productImages,
    lastSync: lastSync?.value || null,
  };
}

/**
 * Helpers de pendingOps (cola de operaciones offline).
 */
// Cuánto se espera antes de volver a intentar una venta que falló.
//
// Antes era una escalera: 30 s, 1 min, 2 min, 4 min… hasta 1 hora. La escalera
// tiene sentido contra un servidor que se cae un segundo, pero no contra lo que
// pasa de verdad acá: cuando la base deja de aceptar escrituras, el problema
// dura minutos u horas. Reintentar a los 30 segundos no arregla nada y encima
// suma carga al servidor que ya está mal — el 3-sep-2026 fue justamente el
// exceso de intentos lo que agravó el bloqueo.
//
// Diez minutos parejo: diez intentos cubren casi dos horas, sin machacar. Y si
// la conexión vuelve antes, `despertarTodas` cancela la espera y sube todo en
// el momento: la espera protege al servidor caído, no al que ya se recuperó.
const ESPERA_REINTENTO_MS = 10 * 60_000;

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

  // Una vez arriba, la operación se BORRA de la cola.
  //
  // La cola es una bandeja de salida: lo que ya salió no tiene por qué seguir
  // ahí. Antes quedaba como "sincronizada" para siempre y la lista crecía sin
  // techo —419 filas en un equipo, la mayoría reenvíos de ventas que ya
  // estaban—, tapando lo único que importa mirar: lo que TODAVÍA no subió.
  //
  // El registro de la venta no se pierde: vive en el servidor y se ve en
  // Historial de Ventas, que es donde hay que buscarla.
  async markSynced(tempId, serverId = null) {
    console.log(`[cola] Venta sincronizada (${tempId} → venta #${serverId ?? '?'}). Se saca de la cola.`);
    await localDb.pendingOps.delete(tempId);
  },

  // La venta subió pero le falta el documento (boleta o factura).
  //
  // No se saca de la cola: una venta sin su documento no está terminada. Queda
  // a la vista con el motivo y se reintenta —solo el documento, porque la venta
  // ya está guardada y el servidor la reconoce por su código—. No gasta
  // intentos: quedarse sin folios o sin CAF no se arregla reintentando rápido.
  async markDocPendiente(tempId, serverId, motivo) {
    await localDb.pendingOps.update(tempId, {
      status: 'error',
      bloqueo: true,
      docPendiente: true,
      serverId: serverId ?? null,
      lastError: String(motivo || 'Falta emitir el documento de esta venta'),
      nextAttemptAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    });
  },

  // Rechazo de negocio: el servidor contestó bien y dijo que NO.
  //
  // Es distinto de un fallo de envío y hay que tratarlo distinto. "Stock
  // insuficiente para: Ajo" no se arregla reintentando más rápido: se arregla
  // cuando llega mercadería o cuando se prende "Modo Ajuste de Inventario". Por
  // eso NO gasta intentos —si no, la venta llegaría a los 10 y quedaría
  // congelada sin que nadie hiciera nada mal— y reintenta cada 10 minutos por
  // si la situación cambió.
  async markBlocked(tempId, motivo) {
    await localDb.pendingOps.update(tempId, {
      status: 'error',
      bloqueo: true,
      docPendiente: false,
      lastError: String(motivo?.message || motivo || 'El servidor rechazó la venta'),
      nextAttemptAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  },

  async markError(tempId, error) {
    const op = await localDb.pendingOps.get(tempId);
    if (!op) return;
    const attempts = (op.attempts || 0) + 1;
    await localDb.pendingOps.update(tempId, {
      status: 'error',
      docPendiente: false,
      bloqueo: false, // fallo de envío, no rechazo del servidor
      lastError: String(error?.message || error || 'Error desconocido'),
      attempts,
      nextAttemptAt: new Date(Date.now() + ESPERA_REINTENTO_MS).toISOString(),
    });
  },

  // Vuelve a poner en carrera todo lo que estaba esperando su turno.
  //
  // Se llama cuando VUELVE la conexión. La espera de 10 minutos existe para no
  // machacar un servidor que está mal; que vuelva el internet es información
  // nueva y la espera deja de tener sentido: hay que intentar ya, no dentro de
  // ocho minutos. No toca los intentos ni los motivos, solo la espera.
  async despertarTodas(companyId) {
    const todas = await localDb.pendingOps.where('companyId').equals(companyId).toArray();
    const dormidas = todas.filter((o) => o.status === 'error' && o.nextAttemptAt);
    await Promise.all(dormidas.map((o) => localDb.pendingOps.update(o.tempId, { nextAttemptAt: null })));
    return dormidas.length;
  },

  async retry(tempId) {
    // Reintento: limpia error, backoff Y el contador de intentos.
    //
    // El contador es lo que importa. syncPendingOpsToServer descarta las
    // operaciones con 10 intentos o más, así que una venta que llegó al tope
    // quedaba congelada para siempre: la sincronización automática la salteaba
    // y el botón "Reintentar" tampoco servía —la devolvía a la cola con los 10
    // intentos intactos y el siguiente barrido la mandaba de vuelta al rojo con
    // "Máximo de reintentos alcanzado".
    //
    // Pasó de verdad el 3-sep-2026: 29 ventas de la caída de Turso quedaron
    // trabadas sin manera de subirlas desde la interfaz.
    //
    // Volver a cero es seguro: cada venta lleva su clave anti-duplicado
    // (clientSaleId) y el servidor la rechaza si ya está guardada, así que
    // reintentar no puede cobrar dos veces.
    await localDb.pendingOps.update(tempId, {
      status: 'queued',
      lastError: null,
      nextAttemptAt: null,
      attempts: 0,
      bloqueo: false,
      docPendiente: false,
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
