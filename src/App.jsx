import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Register from './pages/Register';
import SelectPlan from './pages/SelectPlan';
import Login from './pages/Login';
import PaymentSuccess from './pages/PaymentSuccess';
import PaymentPending from './pages/PaymentPending';
import PaymentFailure from './pages/PaymentFailure';
import RenewSubscription from './pages/RenewSubscription';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import SalesHistory from './pages/SalesHistory';
import Inventory from './pages/Inventory';
import Taxes from './pages/Taxes';
import Invoices from './pages/Invoices';
import Categories from './pages/Categories';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import ProductProfile from './pages/ProductProfile';
import Users from './pages/Users';
import Personal from './pages/Personal';
import PersonalKiosk from './pages/PersonalKiosk';
import Reports from './pages/Reports';
import ExpiringProductsReport from './pages/ExpiringProductsReport';
import CashClosuresReport from './pages/CashClosuresReport';
import CashMovementsReport from './pages/CashMovementsReport';
import InvoicePaymentsReport from './pages/InvoicePaymentsReport';
import Settings from './pages/Settings';
import Clients from './pages/Clients';
import Orders from './pages/Orders';
import SupplierOrders from './pages/SupplierOrders';
import Preorders from './pages/Preorders';
import Production from './pages/Production';
import InventoryReconciliation from './pages/InventoryReconciliation';
import InventoryControl from './pages/InventoryControl';
import ProductCombos from './pages/ProductCombos';
import DocumentosSII from './pages/DocumentosSII';
import FolioSettings from './pages/FolioSettings';
import MainLayout from './layouts/MainLayout';
import AdminLayout from './layouts/AdminLayout';
import RequireAdmin from './components/RequireAdmin';
import ProtectedPage from './components/auth/ProtectedPage';
import FeatureGatePage from './components/auth/FeatureGatePage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCompanies from './pages/admin/AdminCompanies';
import SupportInbox from './pages/admin/SupportInbox';
import ProfitReport from './pages/admin/ProfitReport';
import SalesAnalytics from './pages/reports/SalesAnalytics';

import React, { useEffect } from 'react';
import { useStore } from './store/useStore';

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
  const { fetchInitialData, darkMode } = useStore();
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

  // 🛟 Procesar cola de ventas pendientes (failsafe offline)
  // - Al iniciar sesión
  // - Cuando vuelve la conexión
  // - Cada 60s mientras la app esté abierta
  useEffect(() => {
    if (!currentUser) return;
    const { processPendingSalesQueue } = useStore.getState();

    // Reintento inicial al arrancar
    processPendingSalesQueue();

    const handleOnline = () => {
      console.log('🌐 Conexión restaurada — reintentando ventas pendientes…');
      processPendingSalesQueue();
    };
    window.addEventListener('online', handleOnline);

    const interval = setInterval(() => {
      if (navigator.onLine) processPendingSalesQueue();
    }, 60000);

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [currentUser]);

  return (
    <Router>
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
    </Router>
  );
}

export default App;