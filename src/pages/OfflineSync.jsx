// Página: Ventas Offline (sincronización)
// Muestra la cola de operaciones que se hicieron sin conexión y permite
// ver su estado, reintentar o anular individualmente.
//
// COLORES: esta pantalla usa las variables del tema (--color-text, --glass-bg,
// etc.), NO las clases `dark:` de Tailwind. En Tailwind v4 el prefijo `dark:`
// sigue al sistema operativo salvo que se declare `@custom-variant dark`, y acá
// no está declarado: con el celular en claro y la app en oscuro, las tarjetas
// salían blancas sobre fondo negro y no se leía nada.

import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { pendingOpsApi, getLocalCatalogStats, siiFoliosApi } from '../lib/db/localdb';
import { syncCatalogFromServer, syncPendingOpsToServer, ensureMinimumFolios, syncReservedFoliosFromServer } from '../lib/db/sync';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { createSmartInterval } from '../lib/smartPolling';
import {
  CloudUpload as CloudArrowUpIcon,
  Clock as ClockIcon,
  RefreshCw as ArrowPathIcon,
  Trash2 as TrashIcon,
  Wifi as WifiIcon,
  Database as CircleStackIcon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
} from 'lucide-react';

/**
 * La hora en que se COBRÓ, que es la que importa mostrar y por la que hay que
 * ordenar. `createdAt` es cuándo entró el sobre a la bandeja de salida y puede
 * ser posterior (un reenvío automático nace después que el cobro).
 */
const fechaCobro = (op) => op?.payload?._offlineCreatedAt || op?.createdAt;

/**
 * Con qué documento se cobró. La Nota de Venta es interna y no va al SII; la
 * boleta y las facturas sí, y hasta que su DTE no esté emitido la venta no se
 * da por terminada.
 */
const nombreDocumento = (tipoDte) => ({
  0: 'Nota de Venta',
  33: 'Factura',
  34: 'Factura exenta',
  39: 'Boleta',
}[Number(tipoDte ?? 0)] || 'Nota de Venta');

/**
 * Por qué no pasó esta venta, en castellano y con qué hacer al respecto.
 *
 * El servidor contesta con códigos y frases sueltas —"CREDIT_LIMIT_EXCEEDED",
 * "Stock insuficiente para: Ajo", "SERVER_ERROR: HTTP 502"— que mirados en una
 * lista de treinta ventas no dicen ni qué falló ni qué hacer. Acá se traducen a
 * un titular corto, el detalle que mandó el servidor, y la salida concreta.
 *
 * Devuelve `null` cuando la venta simplemente está esperando su turno: no hay
 * problema que contar.
 */
function explicarProblema(op, sale) {
  if (op.status !== 'error') return null;
  const crudo = String(op.lastError || '');
  const doc = nombreDocumento(sale.tipoDte).toLowerCase();

  if (op.docPendiente) {
    return {
      titulo: `Falta emitir ${doc === 'nota de venta' ? 'el documento' : `la ${doc}`}`,
      detalle: crudo,
      queHacer: `La venta ya está guardada${op.serverId ? ` (venta #${op.serverId})` : ''}, pero sin su documento no está terminada. ` +
        'Revisá que haya folios CAF disponibles en Documentos SII. Reintenta sola cada 2 minutos.',
    };
  }

  if (/stock/i.test(crudo)) {
    return {
      titulo: 'Falta stock de un producto',
      detalle: crudo,
      queHacer: 'Entra sola cuando llegue mercadería. Si querés que entre igual, prendé ' +
        '“Modo Ajuste de Inventario” en Configuración: permite vender con stock en cero.',
    };
  }

  if (/límite de crédito|limite de credito|CREDIT_LIMIT/i.test(crudo)) {
    return {
      titulo: 'El fiado supera el límite del cliente',
      detalle: crudo,
      queHacer: `Offline no se puede sumar la deuda del cliente, por eso se dejó fiar. ` +
        'Subile el límite en la ficha del cliente, o que abone algo, y entra sola.',
    };
  }

  if (/no tiene habilitado el crédito|CREDIT_NOT_ALLOWED/i.test(crudo)) {
    return {
      titulo: 'El cliente no tiene fiado habilitado',
      detalle: crudo,
      queHacer: 'Habilitale el crédito en su ficha, o cambiá el medio de pago de esta venta.',
    };
  }

  if (/bloqueado|CLIENT_BLOCKED/i.test(crudo)) {
    return {
      titulo: 'El cliente está bloqueado',
      detalle: crudo,
      queHacer: 'Desbloquealo en su ficha si corresponde, o borrá esta venta y volvé a cobrarla sin cliente.',
    };
  }

  const agotada = (op.attempts || 0) >= 10;
  return {
    titulo: agotada ? 'Se rindió después de 10 intentos' : 'No pudo llegar al servidor',
    detalle: crudo,
    queHacer: agotada
      ? 'No lo vuelve a intentar solo. Tocá “Reintentar” para destrabarla.'
      : 'Es un problema de conexión o del servidor, no de la venta. Reintenta sola.',
  };
}

export default function OfflineSync() {
  const activeCompanyId = useStore((s) => s.activeCompanyId);
  const currentUser = useStore((s) => s.currentUser);
  const { online } = useOnlineStatus();

  const [ops, setOps] = useState([]);
  const [stats, setStats] = useState(null);
  const [folioStats, setFolioStats] = useState({ available: 0, used: 0 });
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const reload = useCallback(async () => {
    if (!activeCompanyId) return;
    // Limpieza de lo que quedó de la versión anterior.
    //
    // Antes las operaciones sincronizadas se guardaban para siempre: un equipo
    // llegó a tener 419 filas verdes de ventas que hacía rato estaban en el
    // servidor. Ahora se borran al subir, pero las viejas siguen ocupando lugar
    // en el navegador, así que se barren acá una vez. Son ventas YA guardadas:
    // borrarlas no pierde nada, están en Historial de Ventas.
    await pendingOpsApi.clearSynced(activeCompanyId, 0).catch(() => {});
    const [items, s, available, used] = await Promise.all([
      pendingOpsApi.list(activeCompanyId),
      getLocalCatalogStats(activeCompanyId),
      siiFoliosApi.count(activeCompanyId, 39, 'available'),
      siiFoliosApi.count(activeCompanyId, 39, 'used'),
    ]);
    setOps(items);
    setStats(s);
    setFolioStats({ available, used });
  }, [activeCompanyId]);

  useEffect(() => {
    reload();
    // FASE 9 · Refresh inteligente: 5s mientras la pestaña esté visible,
    // 30s idle, pausa cuando se oculta. Antes corría 5s siempre.
    const stop = createSmartInterval(reload, {
      label: 'offline-sync',
      activeMs: 5_000,
      idleMs: 30_000,
      pauseWhenHidden: true,
      pauseWhenOffline: false, // queremos seguir refrescando counts locales aunque no haya red
      runOnVisible: true,
      runOnActivity: true,
    });
    return stop;
  }, [reload]);

  // La cola son las que faltan subir, más viejas primero: así se leen en el
  // orden en que se cobraron.
  const filtered = [...ops]
    .filter((o) => o.status !== 'synced')
    .sort((a, b) => new Date(fechaCobro(a)) - new Date(fechaCobro(b)));
  const conProblema = filtered.filter((o) => o.status === 'error').length;

  // ── Quién creó cada fila, y qué significa que dos compartan código ──
  //
  // Cada fila es un ENVÍO al servidor, y hay dos maneras de que nazca una:
  //
  //   COBRO      (tempId `offline_…`) — lo hizo una persona en la caja, sin
  //              conexión. Cada cobro es una venta independiente. Dos cobros
  //              son dos ventas, aunque sean del mismo producto y del mismo
  //              precio, uno atrás del otro.
  //
  //   REENVÍO    (tempId `pending_…`) — lo generó el sistema solo, cuando un
  //              envío falló o no volvió la respuesta. Es la MISMA venta
  //              mandada otra vez, y por eso lleva el mismo código.
  //
  // La distinción no es cosmética, es la diferencia entre "todo bien" y "se
  // perdió una venta":
  //
  //   cobro + reenvío con el mismo código  → normal, una sola venta, sin
  //                                          doble cobro. Es el código
  //                                          haciendo su trabajo.
  //   cobro + COBRO con el mismo código    → GRAVE. Son dos ventas distintas
  //                                          y el servidor solo registró una;
  //                                          la segunda se perdió en silencio.
  //
  // El segundo caso no debería existir nunca. Si aparece, la pantalla lo grita
  // en rojo en vez de dejarlo pasar como si fuera lo mismo que el primero.
  const esCobro = (o) => !String(o.tempId || '').startsWith('pending_');

  const porCodigo = new Map();
  for (const o of [...ops].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    const cod = o.payload?.clientSaleId;
    if (!cod) continue;
    if (!porCodigo.has(cod)) porCodigo.set(cod, []);
    porCodigo.get(cod).push(o);
  }
  const hermanos = (o) => porCodigo.get(o.payload?.clientSaleId) || [o];
  const esReenvio = (o) => hermanos(o)[0]?.tempId !== o.tempId;
  // Dos cobros humanos con el mismo código: una venta se perdió.
  const esColision = (o) => {
    const g = hermanos(o);
    return g.length > 1 && g.filter(esCobro).length > 1;
  };
  const colisiones = new Set(
    [...porCodigo.values()].filter((g) => g.filter(esCobro).length > 1).map((g) => g[0].payload.clientSaleId)
  );
  const ventasDistintas = new Set(filtered.map((o) => o.payload?.clientSaleId || o.tempId)).size;

  const handleSyncNow = async () => {
    if (!online || !activeCompanyId || busy) return;
    setBusy(true);
    try {
      const storeApi = useStore.getState();
      const r = await syncPendingOpsToServer(activeCompanyId, storeApi);
      setLastResult(r);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleSyncCatalog = async () => {
    if (!online || !activeCompanyId || busy) return;
    setBusy(true);
    try {
      const r = await syncCatalogFromServer(activeCompanyId);
      setLastResult(r);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleReserveFolios = async () => {
    if (!online || !activeCompanyId || busy) return;
    setBusy(true);
    try {
      const r = await ensureMinimumFolios(activeCompanyId, 39, currentUser?.id || null, 30, 100, { force: true });
      setLastResult(r);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshFolios = async () => {
    if (!online || !activeCompanyId || busy) return;
    setBusy(true);
    try {
      const r = await syncReservedFoliosFromServer(activeCompanyId, 39, currentUser?.id || null);
      setLastResult(r);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  // Reintentar = devolver a la cola Y subirla ahora mismo. Antes solo la
  // devolvía a la cola y había que acordarse de apretar "Sincronizar ahora"
  // aparte; quien tocaba el botón veía que no pasaba nada.
  const handleRetry = async (tempId) => {
    if (busy) return;
    setBusy(true);
    try {
      await pendingOpsApi.retry(tempId);
      if (online && activeCompanyId) {
        const r = await syncPendingOpsToServer(activeCompanyId, useStore.getState());
        setLastResult(r);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  // Una caída del servidor deja decenas de ventas en rojo a la vez. Reintentarlas
  // de a una no es viable: el 3-sep-2026 quedaron 29 juntas.
  const handleRetryAll = async () => {
    const pendientes = ops.filter((o) => o.status === 'error');
    if (!pendientes.length || busy) return;
    if (!window.confirm(
      `¿Reintentar las ${pendientes.length} operaciones con error?\n\n` +
      'Es seguro: cada venta lleva su código único y el servidor la rechaza si ya estaba guardada, ' +
      'así que no se puede cobrar dos veces.'
    )) return;
    setBusy(true);
    try {
      for (const o of pendientes) await pendingOpsApi.retry(o.tempId);
      if (online && activeCompanyId) {
        const r = await syncPendingOpsToServer(activeCompanyId, useStore.getState());
        setLastResult(r);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tempId) => {
    if (!window.confirm('¿Eliminar esta operación de la cola? Si era una venta, NO se sincronizará al servidor.')) return;
    await pendingOpsApi.remove(tempId);
    await reload();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 text-[var(--color-text)]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 text-[var(--color-text)]">
            <CloudArrowUpIcon className="h-6 w-6 text-cyan-400" />
            Ventas Offline
          </h1>
          <p className="text-xs md:text-sm text-[var(--color-text-muted)] mt-1">
            Operaciones realizadas sin conexión, esperando sincronizarse al servidor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${
              online
                ? 'bg-green-500/15 text-green-400 border-green-500/40'
                : 'bg-red-500/15 text-red-400 border-red-500/40'
            }`}
          >
            <WifiIcon className="h-3 w-3" />
            {online ? 'Conectado' : 'Sin conexión'}
          </span>
          <button
            disabled={!online || busy}
            onClick={handleSyncNow}
            className="px-3 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md disabled:opacity-50 flex items-center gap-1"
          >
            <ArrowPathIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            Sincronizar ahora
          </button>
        </div>
      </div>

      {/* Catálogo local */}
      <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--color-text)]">
            <CircleStackIcon className="h-4 w-4 text-cyan-400" />
            Catálogo local (para vender offline)
          </h2>
          <button
            disabled={!online || busy}
            onClick={handleSyncCatalog}
            className="text-xs px-2 py-1 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 rounded disabled:opacity-50"
          >
            Re-descargar catálogo
          </button>
        </div>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Productos" value={stats.products} />
            <Stat label="Lotes" value={stats.productLots} />
            <Stat label="Clientes" value={stats.clients} />
            <Stat label="Categorías" value={stats.categories} />
            <Stat label="Tasas IVA" value={stats.taxRates} />
            <Stat label="Folios SII" value={stats.siiFolios} />
            <Stat label="Fotos guardadas" value={stats.productImages} />
            <Stat
              label="Última sync"
              value={
                stats.lastSync
                  ? new Date(stats.lastSync).toLocaleString('es-CL')
                  : 'Nunca'
              }
              wide
            />
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">Cargando...</p>
        )}
      </div>

      {/* Folios CAF offline (Boleta SII) */}
      <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--color-text)]">
            <CircleStackIcon className="h-4 w-4 text-amber-400" />
            Folios CAF para emisión offline (Boleta · DTE 39)
          </h2>
          <div className="flex gap-2">
            <button
              disabled={!online || busy}
              onClick={handleRefreshFolios}
              className="text-xs px-2 py-1 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 rounded disabled:opacity-50"
            >
              Refrescar
            </button>
            <button
              disabled={!online || busy}
              onClick={handleReserveFolios}
              className="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
            >
              Reservar más folios
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Stat label="Disponibles offline" value={folioStats.available} />
          <Stat label="Usados (esperando sync)" value={folioStats.used} />
          <Stat
            label="Estado"
            value={
              folioStats.available >= 30
                ? 'OK'
                : folioStats.available > 0
                ? 'Bajo'
                : 'Agotado'
            }
          />
        </div>
        {folioStats.available < 30 && (
          <p className="mt-2 text-xs text-amber-400">
            Quedan pocos folios. Recomendamos reservar más mientras hay internet
            para asegurar emisión de boletas offline.
          </p>
        )}
      </div>

      {/* Resultado última operación */}
      {lastResult && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-md p-3 text-xs text-[var(--color-text)]">
          <pre className="whitespace-pre-wrap">{JSON.stringify(lastResult, null, 2)}</pre>
        </div>
      )}

      {/* Una sola lista.
          Antes había tres pestañas (en cola / con error / sincronizadas) y la
          verde acumulaba para siempre: 419 filas en un equipo, casi todas de
          ventas que ya estaban arriba. Lo único que hace falta mirar acá es qué
          FALTA subir. Lo que ya subió se borra de la cola y se consulta donde
          corresponde, en Historial de Ventas. */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--glass-border)] pb-2">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--color-text)]">
          <ClockIcon className="h-4 w-4 text-amber-400" />
          Ventas por subir
          {filtered.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white bg-amber-500">
              {filtered.length}
            </span>
          )}
        </h2>
        {conProblema > 0 && (
          <button
            disabled={!online || busy}
            onClick={handleRetryAll}
            className="text-xs px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded flex items-center gap-1 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
            Reintentar las {conProblema} que fallaron
          </button>
        )}
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-[var(--color-text-muted)]">
          ✅ No queda ninguna venta por subir. Todo está en el servidor.
        </div>
      ) : (
        <div className="space-y-2">
          {/* Lo primero que hay que poder leer: cuántas ventas hay de verdad.
              Con 419 filas y 400 ventas, las 19 de diferencia son reenvíos —
              ruido de la pantalla, no plata cobrada dos veces. */}
          <div className="text-xs text-[var(--color-text-muted)] px-1">
            {filtered.length} envío{filtered.length !== 1 ? 's' : ''}
            {conProblema > 0 && (
              <>
                {' · '}
                <span className="font-bold text-amber-400">
                  {conProblema} con problema
                </span>
              </>
            )}
            {ventasDistintas !== filtered.length && (
              <>
                {' · '}
                <span className="font-semibold text-[var(--color-text)]">
                  {ventasDistintas} código{ventasDistintas !== 1 ? 's' : ''} de venta
                </span>
                {' — los que repiten código son reenvíos del sistema, no cobros tuyos'}
              </>
            )}
          </div>
          {colisiones.size > 0 && (
            <div className="text-xs bg-red-500/10 border border-red-500/40 text-red-400 rounded p-3">
              <div className="font-bold">
                ⚠️ {colisiones.size} código{colisiones.size !== 1 ? 's' : ''} de venta con DOS cobros distintos
              </div>
              <div className="mt-1 text-[var(--color-text-muted)]">
                Son ventas separadas que salieron con el mismo código. El servidor guardó
                una sola y la otra se perdió. Avisá: hay que revisarlas una por una.
              </div>
            </div>
          )}
          {filtered.map((op) => (
            <OpRow
              key={op.tempId}
              op={op}
              esCobro={esCobro(op)}
              esReenvio={esReenvio(op)}
              esColision={esColision(op)}
              onRetry={handleRetry}
              onDelete={handleDelete}
              canRetry={online && op.status === 'error' && !busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, wide }) {
  return (
    <div className={`bg-[var(--color-surface-hover)] border border-[var(--glass-border)] rounded p-2 ${wide ? 'col-span-2 md:col-span-2' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="font-semibold mt-0.5 text-[var(--color-text)]">{value}</div>
    </div>
  );
}


// Una fila = una venta que todavía no subió.
//
// Plegada muestra lo justo para reconocerla de un vistazo —cuánto, cuándo,
// quién, con qué documento y en qué estado— y el detalle completo queda detrás
// del botón "Detalles". Con la cola llena, tener todos los productos abiertos
// obligaba a scrollear metros para encontrar la venta trabada.
function OpRow({ op, esCobro, esReenvio, esColision, onRetry, onDelete, canRetry }) {
  const [abierto, setAbierto] = useState(false);
  const sale = op.payload || {};
  const total = sale.total || 0;
  const items = Array.isArray(sale.items) ? sale.items : [];
  const unidades = items.reduce((n, it) => n + (Number(it.quantity) || 0), 0);
  // La hora del COBRO, no la de la bandeja de salida.
  const cobrada = new Date(fechaCobro(op)).toLocaleString('es-CL');
  const vendedor = sale._offlineUserName || op.userName || null;
  const aFiado = sale.paymentMethod === 'Crédito';
  const problema = explicarProblema(op, sale);

  const marco = esColision ? 'border-red-500/50'
    : problema ? 'border-amber-500/50'
    : 'border-[var(--glass-border)]';

  return (
    <div className={`bg-[var(--glass-bg)] border ${marco} rounded-md p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* ── Lo básico, siempre a la vista ───────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-[var(--color-text)]">
              {op.type !== 'sale' ? op.type : esCobro ? '🛒 Cobro en caja' : '📨 Reenvío del sistema'}
            </span>
            <span className="font-semibold text-sm text-[var(--color-text)]">
              ${total.toLocaleString('es-CL')}
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">{cobrada}</span>

            {problema ? (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/40 text-amber-400 rounded font-semibold">
                {problema.titulo}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 bg-cyan-500/15 border border-cyan-500/40 text-cyan-400 rounded font-semibold">
                Esperando subir
              </span>
            )}

            {/* Una venta fiada es la que más importa que suba: hasta que no
                entre, esa deuda no figura en la cuenta del cliente. */}
            {aFiado && (
              <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/15 border border-purple-500/40 text-purple-300 rounded font-semibold">
                Fiado{sale.client?.name ? ` · ${sale.client.name}` : ''}
              </span>
            )}

            {esColision && (
              <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 border border-red-500/50 text-red-400 rounded font-bold">
                ⚠️ DOS COBROS CON EL MISMO CÓDIGO — una venta se perdió
              </span>
            )}
            {!esColision && esReenvio && (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/40 text-amber-400 rounded">
                La misma venta mandada de nuevo · NO se cobró dos veces
              </span>
            )}
          </div>

          <div className="text-xs mt-1 text-[var(--color-text-muted)]">
            {vendedor && <>Vendió: <span className="text-[var(--color-text)]">{vendedor}</span> · </>}
            {sale.paymentMethod || 'sin medio de pago'}
            {' · '}
            <span className="text-[var(--color-text)]">{nombreDocumento(sale.tipoDte)}</span>
            {' · '}
            {items.length} producto{items.length !== 1 ? 's' : ''}
            {unidades > items.length ? ` (${unidades} unidades)` : ''}
          </div>

          {/* El motivo va SIEMPRE afuera y en ámbar: con la cola llena, lo
              primero que hay que poder leer de un vistazo es cuáles tienen
              problema y cuál es. No debería hacer falta abrir nada para eso. */}
          {problema && (
            <div className="text-xs mt-2 bg-amber-500/10 border border-amber-500/40 rounded p-2">
              <div className="font-bold text-amber-400">⚠️ {problema.titulo}</div>
              {problema.detalle && (
                <div className="mt-0.5 text-amber-300/90 break-words">{problema.detalle}</div>
              )}
              <div className="mt-1 text-[var(--color-text-muted)]">{problema.queHacer}</div>
            </div>
          )}

          {/* ── El detalle, detrás del botón ────────────────────── */}
          {abierto && (
            <div className="mt-3 space-y-2">
              <div className="border border-[var(--glass-border)] rounded overflow-hidden">
                {items.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                    Esta venta no tiene productos guardados.
                  </div>
                ) : items.map((it, i) => (
                  <div
                    key={`${it.id}-${i}`}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs odd:bg-[var(--color-surface-hover)]"
                  >
                    <span className="truncate text-[var(--color-text)]">
                      {it.quantity} × {it.name}
                    </span>
                    <span className="shrink-0 text-[var(--color-text-muted)]">
                      ${(Number(it.price) * Number(it.quantity)).toLocaleString('es-CL')}
                    </span>
                  </div>
                ))}
              </div>

              <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <Dato k="Total" v={`$${total.toLocaleString('es-CL')}`} destacado />
                <Dato k="Cobrada" v={cobrada} />
                <Dato k="Vendedor" v={vendedor || '—'} />
                <Dato k="Medio de pago" v={sale.paymentMethod || '—'} />
                <Dato k="Documento" v={nombreDocumento(sale.tipoDte)} />
                {sale._offlineFolio && <Dato k="Folio reservado" v={String(sale._offlineFolio)} />}
                {sale.client?.name && <Dato k="Cliente" v={sale.client.name} />}
                {aFiado && (
                  <Dato
                    k="Fiado"
                    v={op.status === 'error' && op.serverId
                      ? 'Ya cargado a su cuenta'
                      : 'Se carga a su cuenta al subir'}
                  />
                )}
                {sale.invoiceData?.rut_receptor && <Dato k="RUT receptor" v={sale.invoiceData.rut_receptor} />}
                {op.serverId && <Dato k="Nº de venta" v={`#${op.serverId}`} />}
                <Dato k="Intentos" v={String(op.attempts || 0)} />
                {op.nextAttemptAt && (
                  <Dato k="Próximo intento" v={new Date(op.nextAttemptAt).toLocaleString('es-CL')} />
                )}
                <Dato k="En la cola desde" v={new Date(op.createdAt).toLocaleString('es-CL')} />
              </dl>

              {/* El código es lo que distingue un reenvío de una venta nueva. */}
              {sale.clientSaleId && (
                <div className="text-[10px] font-mono text-[var(--color-text-muted)] break-all">
                  código de venta: {sale.clientSaleId}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {canRetry && (
            <button
              onClick={() => onRetry(op.tempId)}
              className="text-xs px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded flex items-center gap-1"
            >
              <ArrowPathIcon className="h-3 w-3" /> Reintentar
            </button>
          )}
          <button
            onClick={() => onDelete(op.tempId)}
            className="text-xs px-2 py-1 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded flex items-center justify-center"
            title="Eliminar de la cola"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
          <button
            onClick={() => setAbierto(v => !v)}
            aria-expanded={abierto}
            className="text-xs px-2 py-1 border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded flex items-center gap-1 whitespace-nowrap"
          >
            {abierto ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
            Detalles
          </button>
        </div>
      </div>
    </div>
  );
}

/** Una línea del detalle: etiqueta a la izquierda, valor a la derecha. */
function Dato({ k, v, destacado }) {
  return (
    <>
      <dt className="text-[var(--color-text-muted)]">{k}</dt>
      <dd className={destacado ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-text)]'}>{v}</dd>
    </>
  );
}
