import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Users, Settings, LogOut, Menu, FileText, History, ChevronDown, ChevronRight, Box, Tag, Tags, Truck, ClipboardList, Clock, DollarSign, ArrowLeftRight, ShoppingBag, Receipt, Clipboard, TrendingUp, CakeSlice, Percent, ChefHat, Briefcase, ShieldCheck, ClipboardCheck, Gift, Stamp, PieChart as PieChartIcon, CloudOff, Trophy, CreditCard, Crown, Building2, Smartphone, Scale, Wrench, WalletCards, Store, Bike, MapPin, Navigation, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../lib/utils';
import CompanySwitcher from '../components/CompanySwitcher';
import BotonModoOffline from '../components/BotonModoOffline';
import { pendingOpsApi } from '../lib/db/localdb';
import NotificationBell from '../components/NotificationBell';
import SupportWidget from '../components/SupportWidget';
import WebOrderToast from '../components/WebOrderToast';
import { usePermissions } from '../hooks/usePermissions';
import { useCompanyFeatures } from '../hooks/useCompanyFeatures';
import { getModuleByKey } from '../constants/modules';
import { createSmartInterval } from '../lib/smartPolling';

// Badge de bloqueo del menú: corona dorada = requiere plan Profesional;
// "APP" = complemento del Marketplace. Compacto para no cortar el label.
const LockBadge = ({ moduleKey }) => {
    const mod = getModuleByKey(moduleKey);
    if (mod?.appKey) {
        return (
            <span
                title="Complemento del Marketplace"
                className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[9px] font-bold tracking-wider uppercase flex-shrink-0"
            >
                App
            </span>
        );
    }
    return <Crown size={15} fill="currentColor" title="Plan Profesional" className="text-amber-400 flex-shrink-0" />;
};

// Al pasar el mouse con la barra lateral contraída: el nombre del menú, y si
// tiene submenú, sus opciones. Ahí solo se ven iconos y no hay forma de saber
// qué es cada uno ni de llegar a lo de adentro sin desplegar la barra.
//
// Se dibuja fuera del árbol (portal, posición fija). Los items llevan
// `overflow-hidden` por el efecto de fondo y la barra tiene scroll propio: un
// panel dentro del item quedaría cortado por los dos lados.
const EtiquetaMenu = ({ label, activa, subItems, onNavegar, children }) => {
    const [pos, setPos] = useState(null);
    const cierreRef = React.useRef(null);

    const abrir = (e) => {
        clearTimeout(cierreRef.current);
        const r = e.currentTarget.getBoundingClientRect();
        // Los submenús largos se anclan arriba y se limitan en alto para no
        // salirse de la pantalla; la etiqueta simple va centrada con el icono.
        setPos({ top: r.top, medio: r.top + r.height / 2, left: r.right + 10 });
    };
    // Pequeña demora al salir: sin esto, mover el mouse del icono al panel
    // (hay un hueco de 10 px) lo cerraba antes de llegar.
    const cerrar = () => {
        clearTimeout(cierreRef.current);
        cierreRef.current = setTimeout(() => setPos(null), 140);
    };

    React.useEffect(() => () => clearTimeout(cierreRef.current), []);

    if (!activa) return children;

    const conSubmenu = Array.isArray(subItems) && subItems.length > 0;
    // Los subgrupos se aplanan: en un panel al vuelo, obligar a abrir otro nivel
    // sería peor que mostrarlo todo.
    const filas = conSubmenu
        ? subItems.flatMap(s => s.isSubgroup
            ? [{ tipo: 'grupo', label: s.label }, ...s.children.map(c => ({ tipo: 'hijo', ...c }))]
            : [{ tipo: 'item', ...s }])
        : [];

    return (
        <div className="relative" onMouseEnter={abrir} onMouseLeave={cerrar}>
            {children}
            {pos && createPortal(
                conSubmenu ? (
                    <div
                        style={{ top: Math.min(pos.top, window.innerHeight - 60), left: pos.left, maxHeight: 'calc(100vh - 24px)' }}
                        onMouseEnter={() => clearTimeout(cierreRef.current)}
                        onMouseLeave={cerrar}
                        className="fixed z-[9999] min-w-[210px] overflow-y-auto rounded-xl bg-[var(--color-surface)] border border-[var(--glass-border)] shadow-2xl py-2 animate-in fade-in slide-in-from-left-2 duration-150"
                    >
                        <p className="px-3 pb-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--glass-border)]">
                            {label}
                        </p>
                        {filas.map((f, i) => f.tipo === 'grupo' ? (
                            <p key={`g${i}`} className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                                {f.label}
                            </p>
                        ) : (
                            <NavLink
                                key={f.path || `i${i}`}
                                to={f.path}
                                end
                                onClick={() => { setPos(null); onNavegar?.(); }}
                                className={({ isActive }) => cn(
                                    'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                                    f.tipo === 'hijo' && 'pl-6',
                                    isActive
                                        ? 'text-[var(--color-primary)] font-bold bg-[var(--color-primary)]/10'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'
                                )}
                            >
                                {f.icon && <f.icon size={15} className="shrink-0" />}
                                <span className="whitespace-nowrap">{f.label}</span>
                            </NavLink>
                        ))}
                    </div>
                ) : (
                    <div
                        style={{ top: pos.medio, left: pos.left }}
                        className="fixed z-[9999] -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)] text-xs font-medium text-[var(--color-text)] shadow-2xl whitespace-nowrap pointer-events-none animate-in fade-in slide-in-from-left-2 duration-150"
                    >
                        {label}
                    </div>
                ),
                document.body
            )}
        </div>
    );
};

// Solo estas dos. Se comparan exactas a propósito: /orders/history es una
// lista donde recargar no cuesta nada, y ahí el gesto sirve.
const RUTAS_SIN_GESTO_RECARGA = ['/orders', '/purchases'];

const MainLayout = () => {
    // Helper to check window width strictly for initial state (avoid hydration mismatch if SSR, but this is SPA)
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile); // Closed by default on mobile, open on desktop
    // FASE 10 · re-render solo cuando estas claves cambian, no con todo el store.
    const { currentUser, currentUserCompanyRole, logout, inventoryAdjustmentMode, fetchRolePermissions, activeCompanyId } = useStore(
        useShallow(s => ({
            currentUser: s.currentUser,
            currentUserCompanyRole: s.currentUserCompanyRole,
            logout: s.logout,
            inventoryAdjustmentMode: s.inventoryAdjustmentMode,
            fetchRolePermissions: s.fetchRolePermissions,
            activeCompanyId: s.activeCompanyId,
        }))
    );

    // Contratar/gestionar plan = solo el dueño (no el personal, aunque sea Administrador).
    const isOwner = currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin' || currentUser?.role === 'super_admin';
    const navigate = useNavigate();
    const location = useLocation();

    // Pantallas donde "tirar para actualizar" recargaría la app y se llevaría
    // trabajo a medio hacer: el pedido a proveedor que se está armando y la
    // compra que se está cargando. En el resto el gesto queda habilitado.
    React.useEffect(() => {
        const hayQueCortar = RUTAS_SIN_GESTO_RECARGA.includes(location.pathname);
        document.documentElement.classList.toggle('sin-gesto-recarga', hayQueCortar);
    }, [location.pathname]);

    const [openSubmenu, setOpenSubmenu] = useState(null);
    const [openSubgroup, setOpenSubgroup] = useState(null);

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

    // FASE 9 · Refresh inteligente de permisos: 5min activo, 15min idle,
    // pausa cuando tab oculta o offline, re-ejecuta al volver al foco.
    // Antes era setInterval(5min) ciego + listener de focus separado.
    React.useEffect(() => {
        const stop = createSmartInterval(fetchRolePermissions, {
            label: 'permissions',
            activeMs: 5 * 60_000,
            idleMs: 15 * 60_000,
            pauseWhenHidden: true,
            pauseWhenOffline: true,
            runOnVisible: true,
            runOnFocus: true,
        });
        return stop;
    }, [fetchRolePermissions]);

    const { can } = usePermissions();
    const { isModuleLocked } = useCompanyFeatures();

    // Static Navigation Items
    const allNavItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', permission: 'dashboard.view', moduleKey: 'dashboard' },
        { icon: ShoppingCart, label: 'Ventas (POS)', path: '/pos', permission: 'pos.access', moduleKey: 'pos' },
        { icon: CloudOff, label: 'Ventas Offline', path: '/offline-sales', permission: 'pos.access', moduleKey: 'offline_sales' },
        { icon: Users, label: 'Clientes', path: '/clients', permission: 'clients.view', moduleKey: 'clients' },
        { icon: History, label: 'Historial', path: '/sales-history', permission: 'sales.view', moduleKey: 'sales_history' },
        {
            icon: ClipboardList,
            label: 'Pedidos',
            moduleKey: 'preorders',
            subItems: [
                { icon: CakeSlice, label: 'Encargos (Caja)', path: '/preorders', permission: 'preorders.view' },
                { icon: ChefHat, label: 'Producción', path: '/production', permission: 'production.view' },
                { icon: TrendingUp, label: 'Historial', path: '/preorders/history', permission: 'preorders.view' }
            ]
        },
        {
            icon: ShoppingBag,
            label: 'Órdenes de Compra',
            moduleKey: 'supplier_orders',
            subItems: [
                { icon: ClipboardList, label: 'Pedido', path: '/orders', permission: 'supplier_orders.create' },
                { icon: ClipboardList, label: 'Pedidos Realizados', path: '/orders/history', permission: 'supplier_orders.view' },
                // Movida desde Inventario: una compra es el final del circuito de
                // una orden de compra, no un dato del catálogo.
                { icon: ClipboardList, label: 'Compras', path: '/purchases', permission: 'purchases.view', moduleKey: 'purchases' }
            ]
        },
        {
            icon: Package,
            label: 'Inventario',
            moduleKey: 'inventory',
            subItems: [
                { icon: Box, label: 'Productos', path: '/inventory', permission: 'products.view' },
                { icon: Tags, label: 'Etiquetas', path: '/inventory/labels', permission: 'products.view', moduleKey: 'labels' },
                { icon: Tag, label: 'Categorías', path: '/categories', permission: 'categories.view' },
                { icon: Truck, label: 'Proveedores', path: '/suppliers', permission: 'suppliers.view', moduleKey: 'purchases' },
                { icon: FileText, label: 'Facturas', path: '/invoices', permission: 'invoices.view', moduleKey: 'purchases' },
                { icon: Percent, label: 'Impuestos', path: '/taxes', permission: 'taxes.view', moduleKey: 'taxes' },
                { icon: Clipboard, label: 'Perfil de Producto', path: '/product-profile', permission: 'product_profile.view', moduleKey: 'product_profile' },
                { icon: ShieldCheck, label: 'Conciliación', path: '/inventory/reconciliation', permission: 'products.adjust_stock', moduleKey: 'inventory_control' },
                { icon: ClipboardCheck, label: 'Control de Inventario', path: '/inventory/control', permission: 'inventory_control.view', moduleKey: 'inventory_control' },
                { icon: Gift, label: 'Combos / Packs', path: '/inventory/combos', permission: 'combos.view', moduleKey: 'combos' }
            ]
        },
        {
            icon: FileText,
            label: 'Reportes',
            moduleKey: 'reports',
            subItems: [
                // Primero a propósito: el asistente responde en una pregunta lo que
                // en los reportes de abajo son varios clics y saber dónde mirar.
                { icon: Sparkles, label: 'Asistente IA', path: '/asistente', permission: 'ai.use', moduleKey: 'ai' },
                {
                    icon: ShoppingCart, label: 'Ventas', isSubgroup: true,
                    children: [
                        { icon: FileText, label: 'Venta de Productos', path: '/reports', permission: 'reports.sales' },
                        { icon: TrendingUp, label: 'Utilidad', path: '/reports/profit', permission: 'reports.profit', moduleKey: 'reports_advanced' },
                        { icon: PieChartIcon, label: 'Análisis de Ventas', path: '/reports/sales-analytics', permission: 'reports.sales_analytics', moduleKey: 'reports_advanced' },
                    ]
                },
                { icon: Clock, label: 'Vencimientos', path: '/reports/expiring', permission: 'reports.expiring', moduleKey: 'vencimientos' },
                {
                    icon: DollarSign, label: 'Cajas', isSubgroup: true,
                    children: [
                        { icon: DollarSign, label: 'Cierre de Caja', path: '/reports/closures', permission: 'reports.closures' },
                        { icon: ArrowLeftRight, label: 'Movimientos de Caja', path: '/reports/movements', permission: 'reports.movements' },
                        { icon: CreditCard, label: 'Conciliación Datáfonos', path: '/reports/payment-reconciliation', permission: 'reports.closures', moduleKey: 'reports_advanced' },
                    ]
                },
                { icon: Receipt, label: 'Pagos Facturas', path: '/reports/invoice-payments', permission: 'reports.invoice_payments', moduleKey: 'invoice_payments' },
            ]
        },
        {
            icon: Stamp,
            label: 'Documentos SII',
            moduleKey: 'sii',
            subItems: [
                { icon: FileText, label: 'Documentos', path: '/documentos-sii', permission: 'sii.view' },
                { icon: Settings, label: 'Activar Folios', path: '/sii/folios', permission: 'sii.folios' },
            ]
        },
        {
            icon: Bike,
            label: 'Delivery',
            moduleKey: 'delivery',
            subItems: [
                { icon: Truck, label: 'Envíos', path: '/delivery/shipments', permission: 'delivery.view' },
                { icon: Bike, label: 'Repartidores', path: '/delivery/couriers', permission: 'delivery.view' },
                { icon: MapPin, label: 'Rastreo', path: '/delivery/tracking', permission: 'delivery.view' },
                { icon: Navigation, label: 'Modo Repartidor', path: '/delivery/me', permission: 'delivery.courier' },
            ]
        },
        { icon: Briefcase, label: 'Personal', path: '/personal', permission: 'personal.view', moduleKey: 'personal' },
        { icon: WalletCards, label: 'Administración', path: '/administration', permission: 'finance.view', moduleKey: 'finance' },
        { icon: Trophy, label: 'Sorteos', path: '/sorteos', permission: 'sorteos.view', moduleKey: 'sorteos' },
        { icon: Store, label: 'Marketplace', path: '/marketplace', permission: 'settings.company', ownerOnly: true },
        { icon: Users, label: 'Usuarios', path: '/users', permission: 'users.view', moduleKey: 'users' },
        {
            icon: Settings,
            label: 'Configuración',
            subItems: [
                { icon: Settings, label: 'General', path: '/settings/general', permission: 'settings.view' },
                { icon: Crown, label: 'Mi Plan', path: '/settings/plan', permission: 'settings.company', ownerOnly: true },
                { icon: Building2, label: 'Empresa', path: '/settings/company', permission: 'settings.company' },
                { icon: FileText, label: 'Boletas', path: '/settings/receipts', permission: 'settings.receipts' },
                { icon: CreditCard, label: 'Medios de Pago', path: '/settings/payments', permission: 'settings.payments' },
                { icon: Smartphone, label: 'Integraciones', path: '/settings/integrations', permission: 'settings.system', moduleKey: 'integrations' },
                { icon: Scale, label: 'Báscula', path: '/settings/scale', permission: 'settings.system', moduleKey: 'scale' },
                { icon: Stamp, label: 'Facturación SII', path: '/settings/sii', permission: 'settings.system', moduleKey: 'sii' },
                { icon: ShieldCheck, label: 'Permisos', path: '/settings/permissions', permission: 'settings.manage_permissions' },
                { icon: Wrench, label: 'Sistema', path: '/settings/system', permission: 'settings.system' },
            ]
        },
    ];

    // La VISIBILIDAD se rige por permisos (rol). El bloqueo por PLAN no oculta:
    // marca el ítem como `isLocked` para mostrarlo con su badge de plan (Medium/Pro)
    // y que el usuario sepa qué gana al subir de plan.
    const navItems = allNavItems.filter(item => {
        if (item.subItems) {
            const visibleSubItems = item.subItems.filter(sub => {
                if (sub.isSubgroup) {
                    const visibleChildren = sub.children.filter(c => can(c.permission));
                    if (visibleChildren.length > 0) { sub.children = visibleChildren; return true; }
                    return false;
                }
                return can(sub.permission) && (!sub.ownerOnly || isOwner);
            });
            if (visibleSubItems.length > 0) { item.subItems = visibleSubItems; return true; }
            return false;
        }
        return can(item.permission) && (!item.ownerOnly || isOwner);
    }).map(item => {
        const itemLocked = item.moduleKey ? isModuleLocked(item.moduleKey) : false;
        let subItems = item.subItems;
        if (subItems) {
            subItems = subItems.map(sub => {
                if (sub.isSubgroup) {
                    return { ...sub, children: sub.children.map(c => ({ ...c, isLocked: c.moduleKey ? isModuleLocked(c.moduleKey) : false })) };
                }
                return { ...sub, isLocked: sub.moduleKey ? isModuleLocked(sub.moduleKey) : false };
            });
        }
        return { ...item, isLocked: itemLocked, subItems };
    });

    const toggleSubmenu = (label) => {
        if (!isSidebarOpen) setIsSidebarOpen(true);
        setOpenSubmenu(prev => prev === label ? null : label);
    };

    // Cerrar sesión con ventas sin subir tiene una trampa: para volver a entrar
    // hace falta internet. Si el corte sigue, quien se va no puede volver, y sus
    // ventas quedan guardadas en ESTE equipo esperándolo —nadie más las puede
    // subir, porque una venta se registra a nombre de quien la hizo—.
    //
    // No se prohíbe: el turno termina cuando termina. Pero hay que decirlo antes,
    // no después.
    const handleLogout = async () => {
        try {
            const todas = await pendingOpsApi.list(activeCompanyId);
            const mias = todas.filter(o =>
                o.status !== 'synced' &&
                (o.userId == null || Number(o.userId) === Number(currentUser?.id))
            );
            if (mias.length > 0) {
                const ok = window.confirm(
                    `Te ${mias.length === 1 ? 'queda' : 'quedan'} ${mias.length} venta${mias.length === 1 ? '' : 's'} sin subir al servidor.\n\n` +
                    'Quedan guardadas en este equipo y suben solas cuando vuelvas a entrar con tu usuario. ' +
                    'Nadie más puede subirlas.\n\n' +
                    'Ojo: para volver a entrar hace falta internet.\n\n¿Cerrar sesión igual?'
                );
                if (!ok) return;
            }
        } catch { /* Dexie no disponible: no bloquear el cierre de sesión */ }
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
                    isMobile ? "mobile-drawer fixed inset-y-0 left-0 h-full shadow-2xl" : "relative",
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

                <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto custom-scrollbar">
                    {navItems.map((item) => {
                        if (item.subItems) {
                            // If the entire submenu group is locked, render as a locked NavLink
                            if (item.isLocked) {
                                const firstSubPath = item.subItems[0]?.path || '/';
                                return (
                                    <EtiquetaMenu key={item.label} label={item.label} activa={!isSidebarOpen && !isMobile}>
                                    <NavLink
                                        to={firstSubPath}
                                        onClick={() => isMobile && setIsSidebarOpen(false)}
                                        className={() => cn(
                                            "flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
                                            "text-[var(--color-text-muted)] opacity-70 hover:opacity-100 hover:bg-amber-500/5"
                                        )}
                                    >
                                        <item.icon size={20} className={cn("min-w-[20px]", !isSidebarOpen && "mx-auto")} />
                                        <span className={cn("whitespace-nowrap transition-all duration-300 flex-1", !isSidebarOpen && "opacity-0 w-0 overflow-hidden")}>
                                            {item.label}
                                        </span>
                                        {isSidebarOpen && <LockBadge moduleKey={item.moduleKey} />}
                                        {!isSidebarOpen && (
                                            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 shadow-lg shadow-amber-400/50" />
                                        )}
                                    </NavLink>
                                    </EtiquetaMenu>
                                );
                            }

                            const isExpanded = openSubmenu === item.label;
                            const isActiveParent = item.subItems.some(sub => 
                                sub.isSubgroup 
                                    ? sub.children.some(c => location.pathname === c.path)
                                    : location.pathname === sub.path
                            );

                            return (
                                <div key={item.label} className="space-y-1">
                                    <EtiquetaMenu
                                        label={item.label}
                                        activa={!isSidebarOpen && !isMobile}
                                        subItems={item.subItems}
                                    >
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
                                    </EtiquetaMenu>

                                    {/* Subitems */}
                                    <div className={cn(
                                        "overflow-hidden transition-all duration-300 space-y-1",
                                        isExpanded && isSidebarOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                                    )}>
                                        {item.subItems.map(subItem => {
                                        if (subItem.isSubgroup) {
                                            const isSubExpanded = openSubgroup === subItem.label;
                                            const isSubActive = subItem.children.some(c => location.pathname === c.path);
                                            return (
                                                <div key={subItem.label} className="space-y-0.5">
                                                    <button
                                                        onClick={() => setOpenSubgroup(prev => prev === subItem.label ? null : subItem.label)}
                                                        className={cn(
                                                            "w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 pl-11 text-left",
                                                            isSubActive || isSubExpanded
                                                                ? "text-[var(--color-text)] font-medium"
                                                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <subItem.icon size={16} />
                                                            <span className="text-sm">{subItem.label}</span>
                                                        </div>
                                                        <ChevronDown
                                                            size={14}
                                                            className={cn("transition-transform duration-200", isSubExpanded ? "rotate-180" : "")}
                                                        />
                                                    </button>
                                                    <div className={cn(
                                                        "overflow-hidden transition-all duration-200 space-y-0.5",
                                                        isSubExpanded ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0"
                                                    )}>
                                                        {subItem.children.map(child => (
                                                            <NavLink
                                                                key={child.path}
                                                                to={child.path}
                                                                end
                                                                onClick={() => isMobile && setIsSidebarOpen(false)}
                                                                className={({ isActive }) => cn(
                                                                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 pl-[60px]",
                                                                    isActive
                                                                        ? "text-[var(--color-primary)] font-bold"
                                                                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                                                )}
                                                            >
                                                                <child.icon size={14} />
                                                                <span className="text-sm flex-1">{child.label}</span>
                                                                {child.isLocked && <LockBadge moduleKey={child.moduleKey} />}
                                                            </NavLink>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return (
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
                                                <span className="text-sm flex-1">{subItem.label}</span>
                                                {subItem.isLocked && <LockBadge moduleKey={subItem.moduleKey} />}
                                            </NavLink>
                                        );
                                    })}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <EtiquetaMenu key={item.path} label={item.label} activa={!isSidebarOpen && !isMobile}>
                            <NavLink
                                to={item.path}
                                onClick={() => isMobile && setIsSidebarOpen(false)}
                                className={({ isActive }) => cn(
                                    "flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
                                    item.isLocked
                                        ? "text-[var(--color-text-muted)] opacity-70 hover:opacity-100 hover:bg-amber-500/5"
                                        : isActive
                                            ? "bg-[var(--color-primary)] text-white font-bold shadow-[0_0_15px_rgba(0,240,255,0.4)]"
                                            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                                )}
                            >
                                <item.icon size={20} className={cn("min-w-[20px]", !isSidebarOpen && "mx-auto")} />
                                <span className={cn("whitespace-nowrap transition-all duration-300 flex-1", !isSidebarOpen && "opacity-0 w-0 overflow-hidden")}>
                                    {item.label}
                                </span>
                                {item.isLocked && isSidebarOpen && <LockBadge moduleKey={item.moduleKey} />}
                                {item.isLocked && !isSidebarOpen && (
                                    <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 shadow-lg shadow-amber-400/50" />
                                )}
                            </NavLink>
                            </EtiquetaMenu>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-[var(--glass-border)]">
                    <EtiquetaMenu label="Cerrar Sesión" activa={!isSidebarOpen && !isMobile}>
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
                    </EtiquetaMenu>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-background)] relative">
                <header className="h-16 glass border-b border-[var(--glass-border)] flex justify-between items-center gap-2 px-3 md:px-6 z-30 shrink-0 relative">
                    <div className="flex items-center gap-2 md:gap-4 min-w-0">
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
                                    {inventoryAdjustmentMode && location.pathname === '/pos' && (
                                        <span className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 px-2 py-0.5 rounded text-[10px] lg:text-xs font-bold animate-pulse whitespace-nowrap" title="Ajuste Inventario">
                                            <span className="hidden sm:inline">⚠️ AJUSTE INVENTARIO</span>
                                            <span className="sm:hidden">⚠️</span>
                                        </span>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                    <div className="flex items-center gap-2 md:gap-4 shrink-0">
                        {/* Modo offline manual.
                            Vive en la barra de arriba, junto al selector de empresa,
                            y no dentro del POS: cuando las ventas se traban hay que
                            poder apagarlo desde donde uno esté —revisando la cola,
                            en el dashboard— sin volver primero a la pantalla de
                            ventas. Y estando siempre visible se ve de un vistazo si
                            el equipo está trabajando sin conexión. */}
                        <BotonModoOffline />

                        {/* Company Switcher */}
                        <CompanySwitcher />

                        {/* Notification Bell */}
                        <NotificationBell />

                        <div className="flex items-center gap-3 md:pl-4 md:border-l md:border-[var(--glass-border)]">
                            {/* Avatar + nombre: solo en pantallas grandes; en móvil ocupan
                                espacio y hacen que la barra desborde. */}
                            <div className="hidden md:flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[var(--color-primary)] to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-[var(--color-primary)]/20">
                                    {currentUser?.name?.[0] || 'U'}
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-[var(--color-text)]">{currentUser?.name}</p>
                                    <p className="text-xs text-[var(--color-text-muted)] capitalize">{currentUser?.role}</p>
                                </div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="p-2 hover:bg-[var(--color-surface-hover)] rounded-full text-[var(--color-text-muted)] hover:text-red-400 transition-colors md:ml-2 shrink-0"
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

            {/* Aviso global de encargos web (abajo-izquierda) */}
            <WebOrderToast />
        </div>
    );
};

export default MainLayout;
