// Página: Ventas Offline (sincronización)
// Muestra la cola de operaciones que se hicieron sin conexión y permite
// ver su estado, reintentar o anular individualmente.

import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { localDb, pendingOpsApi, getLocalCatalogStats, siiFoliosApi } from '../lib/db/localdb';
import { syncCatalogFromServer, syncPendingOpsToServer, ensureMinimumFolios, syncReservedFoliosFromServer } from '../lib/db/sync';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { createSmartInterval } from '../lib/smartPolling';
import {
  CloudUpload as CloudArrowUpIcon,
  Clock as ClockIcon,
  CheckCircle2 as CheckCircleIcon,
  AlertCircle as ExclamationCircleIcon,
  RefreshCw as ArrowPathIcon,
  Trash2 as TrashIcon,
  Wifi as WifiIcon,
  Database as CircleStackIcon,
} from 'lucide-react';

const TAB = {
  QUEUED: 'queued',
  ERROR: 'error',
  SYNCED: 'synced',
};

export default function OfflineSync() {
  const activeCompanyId = useStore((s) => s.activeCompanyId);
  const currentUser = useStore((s) => s.currentUser);
  const { online } = useOnlineStatus();

  const [tab, setTab] = useState(TAB.QUEUED);
  const [ops, setOps] = useState([]);
  const [stats, setStats] = useState(null);
  const [folioStats, setFolioStats] = useState({ available: 0, used: 0 });
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const reload = useCallback(async () => {
    if (!activeCompanyId) return;
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

  const filtered = ops.filter((o) => o.status === tab);
  const counts = {
    queued: ops.filter((o) => o.status === 'queued').length,
    error: ops.filter((o) => o.status === 'error').length,
    synced: ops.filter((o) => o.status === 'synced').length,
  };

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

  const handleRetry = async (tempId) => {
    await pendingOpsApi.retry(tempId);
    await reload();
  };

  const handleDelete = async (tempId) => {
    if (!window.confirm('¿Eliminar esta operación de la cola? Si era una venta, NO se sincronizará al servidor.')) return;
    await pendingOpsApi.remove(tempId);
    await reload();
  };

  const handleClearSynced = async () => {
    if (!window.confirm('¿Limpiar todas las operaciones ya sincronizadas? (Conserva las de los últimos 7 días)')) return;
    const removed = await pendingOpsApi.clearSynced(activeCompanyId, 0);
    setLastResult({ ok: true, removed });
    await reload();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <CloudArrowUpIcon className="h-6 w-6 text-cyan-500" />
            Ventas Offline
          </h1>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Operaciones realizadas sin conexión, esperando sincronizarse al servidor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full ${
              online
                ? 'bg-green-500/10 text-green-600 border border-green-500/30'
                : 'bg-red-500/10 text-red-600 border border-red-500/30'
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
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CircleStackIcon className="h-4 w-4 text-cyan-500" />
            Catálogo local (para vender offline)
          </h2>
          <button
            disabled={!online || busy}
            onClick={handleSyncCatalog}
            className="text-xs px-2 py-1 border border-cyan-500/40 text-cyan-600 hover:bg-cyan-500/10 rounded disabled:opacity-50"
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
          <p className="text-xs text-gray-500">Cargando...</p>
        )}
      </div>

      {/* Folios CAF offline (Boleta SII) */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CircleStackIcon className="h-4 w-4 text-amber-500" />
            Folios CAF para emisión offline (Boleta · DTE 39)
          </h2>
          <div className="flex gap-2">
            <button
              disabled={!online || busy}
              onClick={handleRefreshFolios}
              className="text-xs px-2 py-1 border border-amber-500/40 text-amber-600 hover:bg-amber-500/10 rounded disabled:opacity-50"
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
          <p className="mt-2 text-xs text-amber-600">
            Quedan pocos folios. Recomendamos reservar más mientras hay internet
            para asegurar emisión de boletas offline.
          </p>
        )}
      </div>

      {/* Resultado última operación */}
      {lastResult && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-md p-3 text-xs">
          <pre className="whitespace-pre-wrap">{JSON.stringify(lastResult, null, 2)}</pre>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <TabButton active={tab === TAB.QUEUED} onClick={() => setTab(TAB.QUEUED)} icon={ClockIcon} color="yellow" count={counts.queued}>
          En cola
        </TabButton>
        <TabButton active={tab === TAB.ERROR} onClick={() => setTab(TAB.ERROR)} icon={ExclamationCircleIcon} color="red" count={counts.error}>
          Con error
        </TabButton>
        <TabButton active={tab === TAB.SYNCED} onClick={() => setTab(TAB.SYNCED)} icon={CheckCircleIcon} color="green" count={counts.synced}>
          Sincronizadas
        </TabButton>
        <div className="ml-auto flex items-center">
          {tab === TAB.SYNCED && counts.synced > 0 && (
            <button
              onClick={handleClearSynced}
              className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1 px-2"
            >
              <TrashIcon className="h-3 w-3" /> Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">
          {tab === TAB.QUEUED && '✅ No hay operaciones pendientes de sincronizar.'}
          {tab === TAB.ERROR && '✅ No hay operaciones con error.'}
          {tab === TAB.SYNCED && 'Aún no hay operaciones sincronizadas.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((op) => (
            <OpRow key={op.tempId} op={op} onRetry={handleRetry} onDelete={handleDelete} canRetry={online && tab === TAB.ERROR} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, wide }) {
  return (
    <div className={`bg-gray-50 dark:bg-gray-800 rounded p-2 ${wide ? 'col-span-2 md:col-span-2' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, color, count, children }) {
  const colors = {
    yellow: active ? 'border-yellow-500 text-yellow-600' : 'text-gray-500 hover:text-yellow-600',
    red: active ? 'border-red-500 text-red-600' : 'text-gray-500 hover:text-red-600',
    green: active ? 'border-green-500 text-green-600' : 'text-gray-500 hover:text-green-600',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-2 text-sm border-b-2 transition-colors ${
        active ? colors[color] : 'border-transparent text-gray-500'
      } ${colors[color]}`}
    >
      <Icon className="h-4 w-4" />
      {children}
      {count > 0 && (
        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
          color === 'red' ? 'bg-red-500 text-white' :
          color === 'yellow' ? 'bg-yellow-500 text-white' :
          'bg-green-500 text-white'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

function OpRow({ op, onRetry, onDelete, canRetry }) {
  const sale = op.payload || {};
  const total = sale.total || 0;
  const itemCount = Array.isArray(sale.items) ? sale.items.length : 0;
  const created = new Date(op.createdAt).toLocaleString('es-CL');

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {op.type === 'sale' ? '🛒 Venta' : op.type}
            </span>
            <span className="text-xs text-gray-500">#{op.tempId.slice(-8)}</span>
            {op.attempts > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
                {op.attempts} intento{op.attempts > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">{created}</div>
          {op.type === 'sale' && (
            <div className="text-xs mt-1">
              {itemCount} producto{itemCount !== 1 ? 's' : ''} ·{' '}
              <span className="font-semibold">${total.toLocaleString('es-CL')}</span>
              {sale.paymentMethod && ` · ${sale.paymentMethod}`}
              {sale.client?.name && ` · ${sale.client.name}`}
            </div>
          )}
          {op.lastError && (
            <div className="text-xs text-red-500 mt-2 bg-red-500/10 border border-red-500/30 rounded p-2">
              ⚠️ {op.lastError}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
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
            className="text-xs px-2 py-1 border border-red-500/40 text-red-500 hover:bg-red-500/10 rounded flex items-center gap-1"
            title="Eliminar de la cola"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
