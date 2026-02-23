import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Users, Settings, LogOut, Menu, FileText, History, ChevronDown, ChevronRight, Box, Tag, Truck, ClipboardList, Clock, DollarSign, ArrowLeftRight, ShoppingBag, Receipt, Clipboard, TrendingUp, CakeSlice, Percent, ChefHat, Briefcase } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import CompanySwitcher from '../components/CompanySwitcher';
import SupportWidget from '../components/SupportWidget';
import { usePermissions } from '../hooks/usePermissions';

const MainLayout = () => {
    // Helper to check window width strictly for initial state (avoid hydration mismatch if SSR, but this is SPA)
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile); // Closed by default on mobile, open on desktop
    const { currentUser, logout } = useStore();
    const navigate = useNavigate();
    const location = useLocation();

    const [openSubmenu, setOpenSubmenu] = useState(null);

    // Handle Resize
    React.useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);
            // Optional: Auto-close/open on breakpoint switch? 
            // Let's keep user state preference or default logic:
            if (!mobile && !isSidebarOpen) setIsSidebarOpen(true);
            if (mobile && isSidebarOpen) setIsSidebarOpen(false);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const { can } = usePermissions();

    // Static Navigation Items
    const allNavItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', permission: 'dashboard.view' },
        { icon: ShoppingCart, label: 'Ventas (POS)', path: '/pos', permission: 'pos.access' },
        { icon: Users, label: 'Clientes', path: '/clients', permission: 'clients.view' },
        { icon: History, label: 'Historial', path: '/sales-history', permission: 'sales.view' },
        {
            icon: ClipboardList,
            label: 'Pedidos',
            subItems: [
                { icon: CakeSlice, label: 'Encargos (Caja)', path: '/preorders', permission: 'preorders.view' },
                { icon: ChefHat, label: 'Producción', path: '/production', permission: 'production.view' }
            ]
        },
        {
            icon: ShoppingBag,
            label: 'Órdenes de Compra',
            subItems: [
                { icon: ClipboardList, label: 'Pedido', path: '/orders', permission: 'supplier_orders.create' },
                { icon: ClipboardList, label: 'Pedidos Realizados', path: '/orders/history', permission: 'supplier_orders.view' }
            ]
        },
        {
            icon: Package,
            label: 'Inventario',
            // Group visible if any child is visible
            subItems: [
                { icon: Box, label: 'Productos', path: '/inventory', permission: 'products.view' },
                { icon: Tag, label: 'Categorías', path: '/categories', permission: 'categories.view' },
                { icon: Truck, label: 'Proveedores', path: '/suppliers', permission: 'suppliers.view' },
                { icon: FileText, label: 'Facturas', path: '/invoices', permission: 'invoices.view' },
                { icon: ClipboardList, label: 'Compras', path: '/purchases', permission: 'purchases.view' },
                { icon: Percent, label: 'Impuestos', path: '/taxes', permission: 'products.create' },
                { icon: Clipboard, label: 'Perfil de Producto', path: '/product-profile', permission: 'product_profile.view' }
            ]
        },
        {
            icon: FileText,
            label: 'Reportes',
            subItems: [
                { icon: FileText, label: 'Ventas', path: '/reports', permission: 'reports.sales' },
                { icon: Clock, label: 'Vencimientos', path: '/reports/expiring', permission: 'reports.expiring' },
                { icon: DollarSign, label: 'Cierre de Caja', path: '/reports/closures', permission: 'reports.closures' },
                { icon: ArrowLeftRight, label: 'Movimientos de Caja', path: '/reports/movements', permission: 'reports.movements' },
                { icon: Receipt, label: 'Pagos Facturas', path: '/reports/invoice-payments', permission: 'reports.invoice_payments' },
                { icon: TrendingUp, label: 'Utilidad', path: '/reports/profit', permission: 'reports.profit' }
            ]
        },
        { icon: Briefcase, label: 'Personal', path: '/personal', permission: 'personal.view' },
        { icon: Users, label: 'Usuarios', path: '/users', permission: 'users.view' },
        { icon: Settings, label: 'Configuración', path: '/settings', permission: 'settings.view' },
    ];

    const navItems = allNavItems.filter(item => {
        // If item has subItems, check if AT LEAST ONE subItem is allowed
        if (item.subItems) {
            const visibleSubItems = item.subItems.filter(sub => can(sub.permission));
            if (visibleSubItems.length > 0) {
                item.subItems = visibleSubItems; // Only show allowed subitems
                return true;
            }
            return false;
        }
        // Normal item checking
        return can(item.permission);
    });

    const toggleSubmenu = (label) => {
        if (!isSidebarOpen) setIsSidebarOpen(true);
        setOpenSubmenu(prev => prev === label ? null : label);
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="flex h-screen overflow-hidden bg-[var(--color-background)] text-[var(--color-text)]">
            {/* Mobile Backdrop */}
            {isMobile && isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm transition-opacity"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={cn(
                    "glass border-r border-[var(--glass-border)] transition-all duration-300 flex flex-col z-50",
                    isMobile ? "fixed inset-y-0 left-0 h-full shadow-2xl" : "relative",
                    isSidebarOpen ? "w-[266px] translate-x-0" : (isMobile ? "-translate-x-full w-[266px]" : "w-20")
                )}
            >
                <div className="h-16 flex items-center justify-center border-b border-[var(--glass-border)] relative">
                    <h1 className={cn("font-bold text-2xl neon-text transition-opacity duration-300 text-[var(--color-text)]", !isSidebarOpen && !isMobile && "opacity-0 hidden")}>
                        POSVECI
                    </h1>
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className={cn(
                            "absolute bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-full p-1 hover:text-[var(--color-primary)] transition-colors text-[var(--color-text-muted)]",
                            isMobile ? "right-4 top-4" : "right-[-12px] top-6"
                        )}
                    >
                        {isMobile ? <Menu size={20} /> : <Menu size={16} />}
                    </button>
                </div>

                <nav className="flex-1 py-6 px-3 space-y-2">
                    {navItems.map((item) => {
                        if (item.subItems) {
                            const isExpanded = openSubmenu === item.label;
                            const isActiveParent = item.subItems.some(sub => location.pathname === sub.path);

                            return (
                                <div key={item.label} className="space-y-1">
                                    <button
                                        onClick={() => toggleSubmenu(item.label)}
                                        className={cn(
                                            "w-full flex items-center justify-between px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden text-left",
                                            isActiveParent || isExpanded
                                                ? "text-[var(--color-text)] bg-[var(--glass-bg)]"
                                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon size={20} className={cn("min-w-[20px]", !isSidebarOpen && "mx-auto")} />
                                            <span className={cn("whitespace-nowrap transition-all duration-300", !isSidebarOpen && "opacity-0 w-0 overflow-hidden")}>
                                                {item.label}
                                            </span>
                                        </div>
                                        {isSidebarOpen && (
                                            <ChevronDown
                                                size={16}
                                                className={cn("transition-transform duration-200", isExpanded ? "rotate-180" : "")}
                                            />
                                        )}
                                    </button>

                                    {/* Subitems */}
                                    <div className={cn(
                                        "overflow-hidden transition-all duration-300 space-y-1",
                                        isExpanded && isSidebarOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                                    )}>
                                        {item.subItems.map(subItem => (
                                            <NavLink
                                                key={subItem.path}
                                                to={subItem.path}
                                                end
                                                onClick={() => isMobile && setIsSidebarOpen(false)}
                                                className={({ isActive }) => cn(
                                                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 pl-11",
                                                    isActive
                                                        ? "text-[var(--color-primary)] font-bold"
                                                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                                )}
                                            >
                                                <subItem.icon size={16} />
                                                <span className="text-sm">{subItem.label}</span>
                                            </NavLink>
                                        ))}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                onClick={() => isMobile && setIsSidebarOpen(false)}
                                className={({ isActive }) => cn(
                                    "flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
                                    isActive
                                        ? "bg-[var(--color-primary)] text-white font-bold shadow-[0_0_15px_rgba(0,240,255,0.4)]"
                                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                                )}
                            >
                                <item.icon size={20} className={cn("min-w-[20px]", !isSidebarOpen && "mx-auto")} />
                                <span className={cn("whitespace-nowrap transition-all duration-300", !isSidebarOpen && "opacity-0 w-0 overflow-hidden")}>
                                    {item.label}
                                </span>
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-[var(--glass-border)]">
                    <button
                        onClick={handleLogout}
                        className={cn(
                            "flex items-center gap-3 px-3 py-3 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300 w-full transition-all",
                            !isSidebarOpen && "justify-center"
                        )}
                    >
                        <LogOut size={20} />
                        <span className={cn("whitespace-nowrap transition-all", !isSidebarOpen && "hidden")}>
                            Cerrar Sesión
                        </span>
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-background)] relative">
                <header className="h-16 glass border-b border-[var(--glass-border)] flex justify-between items-center px-4 md:px-6 z-10 shrink-0">
                    <div className="flex items-center gap-4">
                        {isMobile && (
                            <button
                                onClick={() => setIsSidebarOpen(true)}
                                className="p-2 -ml-2 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                            >
                                <Menu size={24} />
                            </button>
                        )}

                        {(() => {
                            const activeItem = navItems.find(item => item.path === location.pathname) ||
                                navItems.flatMap(item => item.subItems || []).find(sub => sub.path === location.pathname);

                            return (
                                <div className="flex items-center gap-2">
                                    {isMobile && activeItem?.icon && (
                                        <activeItem.icon size={20} className="text-[var(--color-primary)]" />
                                    )}
                                    <h2 className={cn(
                                        "font-bold text-[var(--color-text)]",
                                        isMobile ? "text-base hidden sm:block" : "text-xl"
                                    )}>
                                        {activeItem?.label || 'Bienvenido'}
                                    </h2>
                                </div>
                            );
                        })()}
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Company Switcher */}
                        <CompanySwitcher />

                        <div className="flex items-center gap-3 pl-4 border-l border-[var(--glass-border)]">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[var(--color-primary)] to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-[var(--color-primary)]/20">
                                {currentUser?.name?.[0] || 'U'}
                            </div>
                            <div className="hidden md:block">
                                <p className="text-sm font-medium text-[var(--color-text)]">{currentUser?.name}</p>
                                <p className="text-xs text-[var(--color-text-muted)] capitalize">{currentUser?.role}</p>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="p-2 hover:bg-[var(--color-surface-hover)] rounded-full text-[var(--color-text-muted)] hover:text-red-400 transition-colors ml-2"
                                title="Cerrar Sesión"
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    </div>
                </header>

                {/* Content Area */}
                <main className="flex-1 overflow-auto p-2 lg:p-6 relative">
                    <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] rounded-full bg-[var(--color-primary)] opacity-5 blur-[80px] pointer-events-none"></div>
                    <Outlet />
                </main>
            </main>

            {/* Widget de Soporte flotante */}
            <SupportWidget />
        </div>
    );
};

export default MainLayout;
