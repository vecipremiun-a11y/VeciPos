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
import ToastHost from './components/ToastHost';
import AvisoSinConexion from './components/AvisoSinConexion';
import { installAlertBridge } from './lib/toast';

// Los alert() nativos ("app.posveci.com dice...") pasan a ser notificaciones
// del sistema. Se instala al cargar el módulo, antes de montar cualquier página.
installAlertBridge();

// FASE 10 · Resto de páginas: lazy. Reduce dramáticamente el bundle inicial.
// Cada ruta solo descarga su chunk al navegar a ella.
const PaymentSuccess = lazy(() => import('./pages/PaymentSuccess'));
const PaymentPending = lazy(() => import('./pages/PaymentPending'));
const PaymentFailure = lazy(() => import('./pages/PaymentFailure'));
const RenewSubscription = lazy(() => import('./pages/RenewSubscription'));
const PrivacyPolicy = lazy(() => import('./pages/legal/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/legal/TermsOfService'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
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
const Administration = lazy(() => import('./pages/Administration'));
const PersonalKiosk = lazy(() => import('./pages/PersonalKiosk'));
const Reports = lazy(() => import('./pages/Reports'));
const ExpiringProductsReport = lazy(() => import('./pages/ExpiringProductsReport'));
const CashClosuresReport = lazy(() => import('./pages/CashClosuresReport'));
const CashMovementsReport = lazy(() => import('./pages/CashMovementsReport'));
const InvoicePaymentsReport = lazy(() => import('./pages/InvoicePaymentsReport'));
const PaymentReconciliation = lazy(() => import('./pages/reports/PaymentReconciliation'));
const Settings = lazy(() => import('./pages/Settings'));
const Clients = lazy(() => import('./pages/Clients'));
const Orders = lazy(() => import('./pages/Orders'));
const SupplierOrders = lazy(() => import('./pages/SupplierOrders'));
const Preorders = lazy(() => import('./pages/Preorders'));
const StoreOrders = lazy(() => import('./pages/StoreOrders'));
const Production = lazy(() => import('./pages/Production'));
const PreorderHistory = lazy(() => import('./pages/PreorderHistory'));
const InventoryReconciliation = lazy(() => import('./pages/InventoryReconciliation'));
const InventoryControl = lazy(() => import('./pages/InventoryControl'));
const ProductCombos = lazy(() => import('./pages/ProductCombos'));
const LabelPrinting = lazy(() => import('./pages/LabelPrinting'));
const Asistente = lazy(() => import('./pages/Asistente'));
const DeliveryCouriers = lazy(() => import('./pages/delivery/Couriers'));
const DeliveryShipments = lazy(() => import('./pages/delivery/Shipments'));
const DeliveryTracking = lazy(() => import('./pages/delivery/Tracking'));
const CourierMode = lazy(() => import('./pages/delivery/CourierMode'));
const DocumentosSII = lazy(() => import('./pages/DocumentosSII'));
const FolioSettings = lazy(() => import('./pages/FolioSettings'));
const OfflineSync = lazy(() => import('./pages/OfflineSync'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminCompanies = lazy(() => import('./pages/admin/AdminCompanies'));
const AdminClients = lazy(() => import('./pages/admin/AdminClients'));
const AdminActivity = lazy(() => import('./pages/admin/AdminActivity'));
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'));
const SupportInbox = lazy(() => import('./pages/admin/SupportInbox'));
const ProfitReport = lazy(() => import('./pages/admin/ProfitReport'));
const SalesAnalytics = lazy(() => import('./pages/reports/SalesAnalytics'));
const Sorteos = lazy(() => import('./pages/Sorteos'));
import { useStore } from './store/useStore';
import { migrateLegacyQueueToDexie, syncCatalogFromServer, syncCatalogIncremental, syncPendingOpsToServer } from './lib/db/sync';
import { createSmartInterval } from './lib/smartPolling';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import SessionTakeoverModal from './components/SessionTakeoverModal';
import { setTabUserId } from './lib/sessionGuard';
import { alCambiarConexion } from './lib/conectividad';

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

// Destino de "/" según el rol. El Repartidor no tiene acceso al Dashboard, así
// que se le manda a sus entregas (si no, vería un "sin permiso").
const HomeRedirect = () => {
  const role = useStore(state => state.currentUser?.role);
  return <Navigate to={role === 'Repartidor' ? '/delivery/me' : '/dashboard'} replace />;
};

function App() {
  // FASE 10 · selectores atómicos: re-render solo cuando ESTOS valores cambian,
  // no en cualquier mutación del store (que es 13k líneas).
  const fetchInitialData = useStore(state => state.fetchInitialData);
  const darkMode = useStore(state => state.darkMode);
  const currentUser = useStore(state => state.currentUser);
  const activeCompanyId = useStore(state => state.activeCompanyId);

  // Esta pestaña actúa a nombre de `currentUser`. Se mantiene sincronizado aquí
  // —y no solo al rehidratar el store— porque la cookie de sesión es del navegador
  // entero: sin esto, las pestañas que quedaron con otra cuenta no se detectan.
  // Va el primero para que quede fijado antes de las cargas de datos.
  useEffect(() => {
    setTabUserId(currentUser?.id ?? null);
  }, [currentUser]);

  // FASE 5.5 · Exponer activeCompanyId a la capa lib (pwaUpdate) para que
  // pueda verificar ops offline pendientes antes de aplicar un refresh.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__POSKEM_ACTIVE_COMPANY_ID__ = activeCompanyId || null;
    }
  }, [activeCompanyId]);

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

    // Sincronizar cola Dexie + descargar catálogo si hay internet.
    // FASE 8.1 · El polling usa sync incremental (solo trae rows con
    // updated_at > lastSync de products y tax_rates). El startup y los
    // refresh manuales siguen siendo full sync. Si no hay lastSync,
    // syncCatalogIncremental cae automáticamente a full.
    const syncAll = async ({ incremental = false } = {}) => {
      if (!navigator.onLine) return;
      const state = useStore.getState();
      const cid = state.activeCompanyId;
      if (!cid) return;
      // Sync catálogo en background (no bloquear)
      const catalogFn = incremental ? syncCatalogIncremental : syncCatalogFromServer;
      catalogFn(cid).catch((e) => console.warn('[sync] catálogo:', e));
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

    // Startup: full sync (limpia stale y purga rows borradas server-side).
    syncAll({ incremental: false });

    // Apenas el monitor confirma que volvió el internet, se manda lo que quedó
    // pendiente. No alcanza con el evento 'online' del navegador: ese se dispara
    // al reconectar el WiFi, aunque el internet siga caído.
    const dejarDeEscuchar = alCambiarConexion((online) => {
      if (!online) return;
      processPendingSalesQueue();
      syncAll({ incremental: true });
    });

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
        // Polling: incremental (Fase 8.1)
        return syncAll({ incremental: true });
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
      dejarDeEscuchar();
    };
  }, [currentUser]);

  return (
    <Router>
      <PWAUpdatePrompt />
      <ToastHost />
      <AvisoSinConexion />
      <SessionTakeoverModal />
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
        <Route path="/privacidad" element={<PrivacyPolicy />} />
        <Route path="/terminos" element={<TermsOfService />} />
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
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<ProtectedPage permission="dashboard.view"><Dashboard /></ProtectedPage>} />
          <Route path="pos" element={<ProtectedPage permission="pos.access"><POS /></ProtectedPage>} />
          <Route path="sales-history" element={<ProtectedPage permission="sales.view"><SalesHistory /></ProtectedPage>} />
          <Route path="inventory" element={<ProtectedPage permission="products.view"><Inventory /></ProtectedPage>} />
          <Route path="taxes" element={<ProtectedPage permission="taxes.view"><FeatureGatePage moduleKey="taxes"><Taxes /></FeatureGatePage></ProtectedPage>} />
          <Route path="invoices" element={<ProtectedPage permission="invoices.view"><FeatureGatePage moduleKey="purchases"><Invoices /></FeatureGatePage></ProtectedPage>} />
          <Route path="categories" element={<ProtectedPage permission="categories.view"><Categories /></ProtectedPage>} />
          <Route path="suppliers" element={<ProtectedPage permission="suppliers.view"><FeatureGatePage moduleKey="purchases"><Suppliers /></FeatureGatePage></ProtectedPage>} />
          <Route path="purchases" element={<ProtectedPage permission="purchases.view"><FeatureGatePage moduleKey="purchases"><Purchases /></FeatureGatePage></ProtectedPage>} />
          <Route path="product-profile" element={<ProtectedPage permission="product_profile.view"><FeatureGatePage moduleKey="product_profile"><ProductProfile /></FeatureGatePage></ProtectedPage>} />
          <Route path="users" element={<ProtectedPage permission="users.view"><Users /></ProtectedPage>} />
          <Route path="personal" element={<ProtectedPage permission="personal.view"><FeatureGatePage moduleKey="personal"><Personal /></FeatureGatePage></ProtectedPage>} />
          <Route path="administration" element={<ProtectedPage permission="finance.view"><FeatureGatePage moduleKey="finance"><Administration /></FeatureGatePage></ProtectedPage>} />
          <Route path="clients" element={<ProtectedPage permission="clients.view"><Clients /></ProtectedPage>} />
          <Route path="orders" element={<ProtectedPage permission="supplier_orders.create"><FeatureGatePage moduleKey="supplier_orders"><Orders /></FeatureGatePage></ProtectedPage>} />
          <Route path="orders/history" element={<ProtectedPage permission="supplier_orders.view"><FeatureGatePage moduleKey="supplier_orders"><SupplierOrders /></FeatureGatePage></ProtectedPage>} />
          <Route path="preorders" element={<ProtectedPage permission="preorders.view"><FeatureGatePage moduleKey="preorders"><Preorders /></FeatureGatePage></ProtectedPage>} />
          <Route path="preorders/history" element={<ProtectedPage permission="preorders.view"><FeatureGatePage moduleKey="preorders"><PreorderHistory /></FeatureGatePage></ProtectedPage>} />
          <Route path="store-orders" element={<ProtectedPage permission="preorders.view"><FeatureGatePage moduleKey="web"><StoreOrders /></FeatureGatePage></ProtectedPage>} />
          <Route path="production" element={<ProtectedPage permission="production.view"><FeatureGatePage moduleKey="production"><Production /></FeatureGatePage></ProtectedPage>} />
          <Route path="inventory/reconciliation" element={<ProtectedPage permission="products.adjust_stock"><FeatureGatePage moduleKey="inventory_control"><InventoryReconciliation /></FeatureGatePage></ProtectedPage>} />
          <Route path="inventory/control" element={<ProtectedPage permission="inventory_control.view"><FeatureGatePage moduleKey="inventory_control"><InventoryControl /></FeatureGatePage></ProtectedPage>} />
          <Route path="inventory/combos" element={<ProtectedPage permission="combos.view"><FeatureGatePage moduleKey="combos"><ProductCombos /></FeatureGatePage></ProtectedPage>} />
          {/* Asistente IA (App del Marketplace). El gate visual es FeatureGatePage;
              el que cuida el gasto es la verificación server-side del endpoint.
              `ai.use` ya trae adentro la regla completa: los administradores lo
              tienen sin configurar nada, y cualquier otro rol solo si el dueño se
              lo activó en Permisos. */}
          <Route path="asistente" element={<ProtectedPage permission="ai.use"><FeatureGatePage moduleKey="ai"><Asistente /></FeatureGatePage></ProtectedPage>} />
          <Route path="inventory/labels" element={<ProtectedPage permission="products.view"><FeatureGatePage moduleKey="labels"><LabelPrinting /></FeatureGatePage></ProtectedPage>} />
          {/* App Delivery */}
          <Route path="delivery/shipments" element={<ProtectedPage permission="delivery.view"><FeatureGatePage moduleKey="delivery"><DeliveryShipments /></FeatureGatePage></ProtectedPage>} />
          <Route path="delivery/couriers" element={<ProtectedPage permission="delivery.view"><FeatureGatePage moduleKey="delivery"><DeliveryCouriers /></FeatureGatePage></ProtectedPage>} />
          <Route path="delivery/tracking" element={<ProtectedPage permission="delivery.view"><FeatureGatePage moduleKey="delivery"><DeliveryTracking /></FeatureGatePage></ProtectedPage>} />
          <Route path="delivery/me" element={<ProtectedPage permission="delivery.courier"><FeatureGatePage moduleKey="delivery"><CourierMode /></FeatureGatePage></ProtectedPage>} />
          <Route path="documentos-sii" element={<ProtectedPage permission="sii.view"><FeatureGatePage moduleKey="sii"><DocumentosSII /></FeatureGatePage></ProtectedPage>} />
          <Route path="sii/folios" element={<ProtectedPage permission="sii.folios"><FeatureGatePage moduleKey="sii"><FolioSettings /></FeatureGatePage></ProtectedPage>} />

          {/* Reports */}
          <Route path="reports" element={<ProtectedPage permission="reports.sales"><Reports /></ProtectedPage>} />
          <Route path="reports/expiring" element={<ProtectedPage permission="reports.expiring"><FeatureGatePage moduleKey="vencimientos"><ExpiringProductsReport /></FeatureGatePage></ProtectedPage>} />
          <Route path="reports/closures" element={<ProtectedPage permission="reports.closures"><CashClosuresReport /></ProtectedPage>} />
          <Route path="reports/movements" element={<ProtectedPage permission="reports.movements"><CashMovementsReport /></ProtectedPage>} />
          <Route path="reports/invoice-payments" element={<ProtectedPage permission="reports.invoice_payments"><FeatureGatePage moduleKey="invoice_payments"><InvoicePaymentsReport /></FeatureGatePage></ProtectedPage>} />
          <Route path="reports/payment-reconciliation" element={<ProtectedPage permission="reports.closures"><FeatureGatePage moduleKey="reports_advanced"><PaymentReconciliation /></FeatureGatePage></ProtectedPage>} />
          <Route path="reports/profit" element={<ProtectedPage permission="reports.profit"><FeatureGatePage moduleKey="reports_advanced"><ProfitReport /></FeatureGatePage></ProtectedPage>} />
          <Route path="reports/sales-analytics" element={<ProtectedPage permission="reports.sales_analytics"><FeatureGatePage moduleKey="reports_advanced"><SalesAnalytics /></FeatureGatePage></ProtectedPage>} />

          <Route path="sorteos" element={<ProtectedPage permission="sorteos.view"><FeatureGatePage moduleKey="sorteos"><Sorteos /></FeatureGatePage></ProtectedPage>} />

          <Route path="marketplace" element={<ProtectedPage permission="settings.company"><Marketplace /></ProtectedPage>} />

          <Route path="settings" element={<ProtectedPage permission="settings.view"><Settings /></ProtectedPage>} />
          <Route path="settings/:tab" element={<ProtectedPage permission="settings.view"><Settings /></ProtectedPage>} />
          <Route path="offline-sales" element={<ProtectedPage permission="pos.access"><FeatureGatePage moduleKey="offline_sales"><OfflineSync /></FeatureGatePage></ProtectedPage>} />
        </Route>

        {/* Super Admin Routes */}
        <Route path="/admin" element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="companies" element={<AdminCompanies />} />
          <Route path="clients" element={<AdminClients />} />
          <Route path="actividad" element={<AdminActivity />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="soporte" element={<SupportInbox />} />
        </Route>
      </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
