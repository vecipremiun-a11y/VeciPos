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
import Invoices from './pages/Invoices';
import Categories from './pages/Categories';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import ProductProfile from './pages/ProductProfile';
import Users from './pages/Users';
import Reports from './pages/Reports';
import ExpiringProductsReport from './pages/ExpiringProductsReport';
import CashClosuresReport from './pages/CashClosuresReport';
import CashMovementsReport from './pages/CashMovementsReport';
import InvoicePaymentsReport from './pages/InvoicePaymentsReport';
import Settings from './pages/Settings';
import Clients from './pages/Clients';
import Orders from './pages/Orders';
import SupplierOrders from './pages/SupplierOrders';
import MainLayout from './layouts/MainLayout';
import AdminLayout from './layouts/AdminLayout';
import RequireAdmin from './components/RequireAdmin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCompanies from './pages/admin/AdminCompanies';
import SupportInbox from './pages/admin/SupportInbox';
import ProfitReport from './pages/admin/ProfitReport';

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

  // 1. Cargar datos SOLO una vez al montar, o cuando currentUser aparece (recarga)
  useEffect(() => {
    const { currentUser, categories } = useStore.getState();
    const hasCategories = categories.length > 0;

    console.log('🚀 App.jsx effect', { hasUser: !!currentUser, hasCategories });

    // Solo cargar si hay usuario Y no se ha cargado antes
    if (currentUser && !hasCategories) {
      console.log('📊 Loading initial data...');
      fetchInitialData();
    }
  }, [useStore.getState().currentUser]); // Listen to user appearance

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

        {/* Protected Routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="pos" element={<POS />} />
          <Route path="sales-history" element={<SalesHistory />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="categories" element={<Categories />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="product-profile" element={<ProductProfile />} />
          <Route path="users" element={<Users />} />
          <Route path="clients" element={<Clients />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/history" element={<SupplierOrders />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/expiring" element={<ExpiringProductsReport />} />
          <Route path="reports/closures" element={<CashClosuresReport />} />
          <Route path="reports/movements" element={<CashMovementsReport />} />
          <Route path="reports/invoice-payments" element={<InvoicePaymentsReport />} />
          <Route path="reports/profit" element={<ProfitReport />} />
          <Route path="settings" element={<Settings />} />
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