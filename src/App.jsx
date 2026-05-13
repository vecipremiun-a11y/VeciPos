import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import React, { useEffect, Suspense, lazy } from 'react';

// FASE 10 · Páginas críticas (eager): bundle inicial, login flow + POS + layouts.
import Login from './pages/Login';
import Register from './pages/Register';
import SelectPlan from './pages/SelectPlan';
import POS from './pages/POS';
import Dashboard from './pages/Dashboard';
import MainLayout from './layouts/MainLayout';
import AdminLayout from './layouts/AdminLayout';
import RequireAdmin from './components/RequireAdmin';
import ProtectedPage from './components/auth/ProtectedPage';
import FeatureGatePage from './components/auth/FeatureGatePage';

// FASE 10 · Resto de páginas: lazy. Reduce dramáticamente el bundle inicial.
// Cada ruta solo descarga su chunk al navegar a ella.
const PaymentSuccess = lazy(() => import('./pages/PaymentSuccess'));
const PaymentPending = lazy(() => import('./pages/PaymentPending'));
const PaymentFailure = lazy(() => import('./pages/PaymentFailure'));
const RenewSubscription = lazy(() => import('./pages/RenewSubscription'));
const SalesHistory = lazy(() => import('./pages/SalesHistory'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Taxes = lazy(() => import('./pages/Taxes'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Categories = lazy(() => import('./pages/Categories'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Purchases = lazy(() => import('./pages/Purchases'));
const ProductProfile = lazy(() => import('./pages/ProductProfile'));
const Users = lazy(() => import('./pages/Users'));
const Personal = lazy(() => import('./pages/Personal'));
const PersonalKiosk = lazy(() => import('./pages/PersonalKiosk'));
const Reports = lazy(() => import('./pages/Reports'));
const ExpiringProductsReport = lazy(() => import('./pages/ExpiringProductsReport'));
const CashClosuresReport = lazy(() => import('./pages/CashClosuresReport'));
const CashMovementsReport = lazy(() => import('./pages/CashMovementsReport'));
const InvoicePaymentsReport = lazy(() => import('./pages/InvoicePaymentsReport'));
const Settings = lazy(() => import('./pages/Settings'));
const Clients = lazy(() => import('./pages/Clients'));
const Orders = lazy(() => import('./pages/Orders'));
const SupplierOrders = lazy(() => import('./pages/SupplierOrders'));
const Preorders = lazy(() => import('./pages/Preorders'));
const Production = lazy(() => import('./pages/Production'));
const InventoryReconciliation = lazy(() => import('./pages/InventoryReconciliation'));
const InventoryControl = lazy(() => import('./pages/InventoryControl'));
const ProductCombos = lazy(() => import('./pages/ProductCombos'));
const DocumentosSII = lazy(() => import('./pages/DocumentosSII'));
const FolioSettings = lazy(() => import('./pages/FolioSettings'));
const OfflineSync = lazy(() => import('./pages/OfflineSync'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminCompanies = lazy(() => import('./pages/admin/AdminCompanies'));
const SupportInbox = lazy(() => import('./pages/admin/SupportInbox'));
const ProfitReport = lazy(() => import('./pages/admin/ProfitReport'));
const SalesAnalytics = lazy(() => import('./pages/reports/SalesAnalytics'));
import { useStore } from './store/useStore';
import { migrateLegacyQueueToDexie, syncCatalogFromServer, syncPendingOpsToServer } from './lib/db/sync';
import { createSmartInterval } from './lib/smartPolling';

// Protected Route Component - ROBUST RESTORE
const ProtectedRoute = ({ children }) => {
  const currentUser = useStore(state => state.currentUser);
  const isLoading = useStore(state => state.isLoading);
  const [triedRestore, setTriedRestore] = React.useState(false);

  // Intentar restaurar sesión desde localStorage si Zustand persist falló
  React.useEffect(() => {
    if (!currentUser && !isLoading && !triedRestore) {
      console.log('🔍 No user in state, checking localStorage...');

      try {
        const stored = localStorage.getItem('pos-storage');
        if (stored) {
          const parsed = JSON.parse(stored);
          const storedUser = parsed?.state?.currentUser;

          if (storedUser) {
            console.log('🔄 Restoring user from localStorage:', storedUser.username);

            // Restaurar estado manualmente
            useStore.setState({
              currentUser: storedUser,
              activeCompanyId: parsed.state.activeCompanyId,
              availableCompanies: parsed.state.availableCompanies || [],
              currentCompanyTimezone: parsed.state.currentCompanyTimezone || 'America/Santiago',
              currentUserCompanyRole: parsed.state.currentUserCompanyRole,
              darkMode: parsed.state.darkMode,
              carts: parsed.state.carts || [{
                id: 1,
                name: 'Ticket 1',
                items: [],
                client: null,
                createdAt: Date.now()
              }],
              activeCartId: parsed.state.activeCartId || 1,
              nextCartId: parsed.state.nextCartId || 2
            });

            console.log('✅ User restored successfully');
          } else {
            console.log('❌ No user found in localStorage');
          }
        } else {
          console.log('❌ No pos-storage in localStorage');
        }
      } catch (e) {
        console.error('❌ Failed to restore from localStorage:', e);
      }

      setTriedRestore(true);
    }
  }, [currentUser, isLoading, triedRestore]);

  // Esperar a que intente restaurar
  if (!triedRestore && !currentUser) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#09090b] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
          <p className="text-sm">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  // Si hay usuario, renderizar
  if (currentUser) {
    console.log('✅ User authenticated:', currentUser.username);
    return children;
  }

  // Si está cargando (login manual), mostrar spinner
  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#09090b] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
          <p>Iniciando sesión...</p>
        </div>
      </div>
    );
  }

  // Si no hay usuario, ir a login
  console.log('❌ No user found, redirecting to login');
  return <Navigate to="/login" replace />;
};

function App() {
  // FASE 10 · selectores atómicos: re-render solo cuando ESTOS valores cambian,
  // no en cualquier mutación del store (que es 13k líneas).
  const fetchInitialData = useStore(state => state.fetchInitialData);
  const darkMode = useStore(state => state.darkMode);
  const currentUser = useStore(state => state.currentUser);

  // 1. Cargar datos SOLO una vez al montar, o cuando currentUser aparece (recarga)
  useEffect(() => {
    if (!currentUser) return;
    const { categories, isLoading } = useStore.getState();

    console.log('🚀 App.jsx effect', { hasUser: true, hasCategories: categories.length > 0 });

    // Solo cargar si hay usuario Y no se ha cargado antes Y no está ya cargando
    if (categories.length === 0 && !isLoading) {
      console.log('📊 Loading initial data...');
      fetchInitialData();
    }
  }, [currentUser]); // Proper reactive dependency

  useEffect(() => {
    console.log('🎨 Theme changed to:', darkMode ? 'dark' : 'light');

    if (darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // 🛟 Procesar cola de ventas pendientes (failsafe offline) + sync catálogo
  // - Al iniciar sesión
  // - Cuando vuelve la conexión
  // - Cada 60s mientras la app esté abierta
  useEffect(() => {
    if (!currentUser) return;
    const { processPendingSalesQueue } = useStore.getState();

    // Migrar cola legacy de localStorage a IndexedDB (se ejecuta una vez)
    migrateLegacyQueueToDexie();

    // Reintento inicial al arrancar (cola legacy localStorage)
    processPendingSalesQueue();

    // Sincronizar cola Dexie + descargar catálogo si hay internet
    const syncAll = async () => {
      if (!navigator.onLine) return;
      const state = useStore.getState();
      const cid = state.activeCompanyId;
      if (!cid) return;
      // Sync catálogo en background (no bloquear)
      syncCatalogFromServer(cid).catch((e) => console.warn('[sync] catálogo:', e));
      // NOTA: pre-reserva automática de folios DESACTIVADA.
      // Consumía CAFs completos al iniciar sesión y los marcaba como exhausted
      // sin emitir DTEs reales. Para offline, usar manualmente desde Configuración → Sincronización Offline.
      // ensureMinimumFolios(cid, 39, currentUser?.id || null, 30, 100)
      //   .catch((e) => console.warn('[sii] folios:', e));
      // Procesar cola Dexie
      try {
        const result = await syncPendingOpsToServer(cid, state);
        if (result?.processed > 0) {
          console.log(`✅ ${result.processed} venta(s) offline sincronizada(s)`);
        }
        // Refrescar contador unificado tras el sync
        const { processPendingSalesQueue: pp } = useStore.getState();
        if (pp) pp();
      } catch (e) {
        console.warn('[sync] cola:', e);
      }
    };

    syncAll();

    // FASE 9 · Sync inteligente con smart-polling:
    //   - 60s mientras hay actividad reciente (venta / mutación)
    //   - 5min cuando la app está idle
    //   - PAUSA total cuando la tab está oculta u offline
    //   - Re-ejecuta INMEDIATO al volver visible / online / actividad
    //   - Backoff exponencial si el servidor falla
    // Esto reemplaza el setInterval(60s) ciego anterior.
    const stop = createSmartInterval(
      () => {
        processPendingSalesQueue();
        return syncAll();
      },
      {
        label: 'app-sync',
        activeMs: 60_000,
        idleMs: 5 * 60_000,
        activeWindowMs: 5 * 60_000,
        pauseWhenHidden: true,
        pauseWhenOffline: true,
        runOnVisible: true,
        runOnOnline: true,
        runOnActivity: true,
        backoffOnError: true,
      }
    );

    return () => {
      stop();
    };
  }, [currentUser]);

  return (
    <Router>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500"></div>
            <p className="text-sm text-[var(--color-text-muted)]">Cargando…</p>
          </div>
        </div>
      }>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/select-plan" element={<SelectPlan />} />
        <Route path="/payment-success" element={<PaymentSuccess />} />
        <Route path="/payment-pending" element={<PaymentPending />} />
        <Route path="/payment-failure" element={<PaymentFailure />} />
        <Route path="/renew-subscription" element={<RenewSubscription />} />

        <Route path="/kiosk/asistencia" element={
          <ProtectedRoute>
            <ProtectedPage permission="personal.attendance">
              <FeatureGatePage moduleKey="personal">
                <PersonalKiosk />
              </FeatureGatePage>
            </ProtectedPage>
          </ProtectedRoute>
        } />

        {/* Protected Routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<ProtectedPage permission="dashboard.view"><Dashboard /></ProtectedPage>} />
          <Route path="pos" element={<ProtectedPage permission="pos.access"><POS /></ProtectedPage>} />
          <Route path="sales-history" element={<ProtectedPage permission="sales.view"><SalesHistory /></ProtectedPage>} />
          <Route path="inventory" element={<ProtectedPage permission="products.view"><Inventory /></ProtectedPage>} />
          <Route path="taxes" element={<ProtectedPage permission="taxes.view"><Taxes /></ProtectedPage>} />
          <Route path="invoices" element={<ProtectedPage permission="invoices.view"><Invoices /></ProtectedPage>} />
          <Route path="categories" element={<ProtectedPage permission="categories.view"><Categories /></ProtectedPage>} />
          <Route path="suppliers" element={<ProtectedPage permission="suppliers.view"><Suppliers /></ProtectedPage>} />
          <Route path="purchases" element={<ProtectedPage permission="purchases.view"><Purchases /></ProtectedPage>} />
          <Route path="product-profile" element={<ProtectedPage permission="product_profile.view"><ProductProfile /></ProtectedPage>} />
          <Route path="users" element={<ProtectedPage permission="users.view"><Users /></ProtectedPage>} />
          <Route path="personal" element={<ProtectedPage permission="personal.view"><FeatureGatePage moduleKey="personal"><Personal /></FeatureGatePage></ProtectedPage>} />
          <Route path="clients" element={<ProtectedPage permission="clients.view"><Clients /></ProtectedPage>} />
          <Route path="orders" element={<ProtectedPage permission="supplier_orders.create"><Orders /></ProtectedPage>} />
          <Route path="orders/history" element={<ProtectedPage permission="supplier_orders.view"><SupplierOrders /></ProtectedPage>} />
          <Route path="preorders" element={<ProtectedPage permission="preorders.view"><Preorders /></ProtectedPage>} />
          <Route path="production" element={<ProtectedPage permission="production.view"><Production /></ProtectedPage>} />
          <Route path="inventory/reconciliation" element={<ProtectedPage permission="products.adjust_stock"><InventoryReconciliation /></ProtectedPage>} />
          <Route path="inventory/control" element={<ProtectedPage permission="inventory_control.view"><InventoryControl /></ProtectedPage>} />
          <Route path="inventory/combos" element={<ProtectedPage permission="combos.view"><ProductCombos /></ProtectedPage>} />
          <Route path="documentos-sii" element={<ProtectedPage permission="sii.view"><DocumentosSII /></ProtectedPage>} />
          <Route path="sii/folios" element={<ProtectedPage permission="sii.folios"><FolioSettings /></ProtectedPage>} />

          {/* Reports */}
          <Route path="reports" element={<ProtectedPage permission="reports.sales"><Reports /></ProtectedPage>} />
          <Route path="reports/expiring" element={<ProtectedPage permission="reports.expiring"><ExpiringProductsReport /></ProtectedPage>} />
          <Route path="reports/closures" element={<ProtectedPage permission="reports.closures"><CashClosuresReport /></ProtectedPage>} />
          <Route path="reports/movements" element={<ProtectedPage permission="reports.movements"><CashMovementsReport /></ProtectedPage>} />
          <Route path="reports/invoice-payments" element={<ProtectedPage permission="reports.invoice_payments"><InvoicePaymentsReport /></ProtectedPage>} />
          <Route path="reports/profit" element={<ProtectedPage permission="reports.profit"><ProfitReport /></ProtectedPage>} />
          <Route path="reports/sales-analytics" element={<ProtectedPage permission="reports.sales_analytics"><SalesAnalytics /></ProtectedPage>} />

          <Route path="settings" element={<ProtectedPage permission="settings.view"><Settings /></ProtectedPage>} />
          <Route path="offline-sales" element={<ProtectedPage permission="pos.access"><OfflineSync /></ProtectedPage>} />
        </Route>

        {/* Super Admin Routes */}
        <Route path="/admin" element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="companies" element={<AdminCompanies />} />
          <Route path="soporte" element={<SupportInbox />} />
        </Route>
      </Routes>
      </Suspense>
    </Router>
  );
}

export default App;