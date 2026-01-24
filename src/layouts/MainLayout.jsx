import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Users, Settings, LogOut, Menu, FileText, History, ChevronDown, ChevronRight, Box, Tag, Truck, ClipboardList, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const MainLayout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const { currentUser, logout } = useStore();
    const navigate = useNavigate();
    const location = useLocation();

    const [openSubmenu, setOpenSubmenu] = useState(null);

    const allNavItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', roles: ['Administrador', 'Vendedor', 'Bodeguero', 'Supervisor'] },
        { icon: ShoppingCart, label: 'Ventas (POS)', path: '/pos', roles: ['Administrador', 'Vendedor'] },
        { icon: History, label: 'Historial', path: '/sales-history', roles: ['Administrador', 'Vendedor', 'Supervisor'] },
        {
            icon: Package,
            label: 'Inventario',
            // Removed path to make it a parent
            roles: ['Administrador', 'Bodeguero'],
            subItems: [
                { icon: Box, label: 'Productos', path: '/inventory', roles: ['Administrador', 'Bodeguero'] },
                { icon: Tag, label: 'Categorías', path: '/categories', roles: ['Administrador', 'Bodeguero'] },
                { icon: Truck, label: 'Proveedores', path: '/suppliers', roles: ['Administrador', 'Bodeguero'] },
                { icon: ClipboardList, label: 'Compras', path: '/purchases', roles: ['Administrador', 'Bodeguero'] }
            ]
        },
        {
            icon: FileText,
            label: 'Reportes',
            // path removed
            roles: ['Administrador', 'Supervisor'],
            subItems: [
                { icon: FileText, label: 'Ventas', path: '/reports', roles: ['Administrador', 'Supervisor'] },
                { icon: Clock, label: 'Vencimientos', path: '/reports/expiring', roles: ['Administrador', 'Supervisor'] }
            ]
        },
        { icon: Users, label: 'Usuarios', path: '/users', roles: ['Administrador'] },
        { icon: Settings, label: 'Configuración', path: '/settings', roles: ['Administrador'] },
    ];

    // If no user is logged in, show all (dev mode) or minimal? 
    // For proper auth flow, we should redirect in useEffect if no user, but lets keep it simple for now and just show allowed if user exists
    const navItems = allNavItems.filter(item =>
        !currentUser || !item.roles || item.roles.includes(currentUser.role)
    );

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
            {/* Sidebar */}
            <aside
                className={cn(
                    "glass border-r border-[var(--glass-border)] transition-all duration-300 flex flex-col z-20",
                    isSidebarOpen ? "w-64" : "w-20"
                )}
            >
                <div className="h-16 flex items-center justify-center border-b border-[var(--glass-border)] relative">
                    <h1 className={cn("font-bold text-2xl neon-text transition-opacity duration-300 text-[var(--color-text)]", !isSidebarOpen && "opacity-0 hidden")}>
                        POSKEM
                    </h1>
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="absolute right-[-12px] top-6 bg-[var(--color-surface)] border border-[var(--glass-border)] rounded-full p-1 hover:text-[var(--color-primary)] transition-colors text-[var(--color-text-muted)]"
                    >
                        <Menu size={16} />
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
                                        isExpanded && isSidebarOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
                                    )}>
                                        {item.subItems.map(subItem => (
                                            <NavLink
                                                key={subItem.path}
                                                to={subItem.path}
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

            {/* Main Content */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                {/* Header */}
                <header className="h-16 glass border-b border-[var(--glass-border)] flex items-center justify-between px-6 z-10">
                    <h2 className="text-xl font-semibold text-[var(--color-text)]">Panel de Control</h2>
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[var(--color-primary)] to-[var(--color-secondary)] flex items-center justify-center font-bold text-white border-2 border-[var(--glass-border)]">
                            {currentUser?.username?.charAt(0).toUpperCase() || 'G'}
                        </div>
                        <div className="hidden md:block">
                            <p className="text-sm font-medium text-[var(--color-text)]">{currentUser?.name || 'Invitado'}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{currentUser?.role || 'Solo lectura'}</p>
                        </div>
                    </div>
                </header>

                {/* Content Area */}
                <main className="flex-1 overflow-auto p-6 relative">
                    <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] rounded-full bg-[var(--color-primary)] opacity-5 blur-[80px] pointer-events-none"></div>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
