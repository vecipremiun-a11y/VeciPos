import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import SalesHistory from './pages/SalesHistory';
import Inventory from './pages/Inventory';
import Categories from './pages/Categories';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import Users from './pages/Users';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import MainLayout from './layouts/MainLayout';



import React, { useEffect } from 'react';
import { useStore } from './store/useStore';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { currentUser, isLoading } = useStore();

  // Optional: show loading spinner while checking auth
  if (isLoading && !currentUser) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#09090b] text-white">
        Cargando sistema...
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

function App() {
  const { fetchInitialData } = useStore();

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

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
          <Route path="categories" element={<Categories />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="users" element={<Users />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
