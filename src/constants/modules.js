// Definición de todos los módulos del sistema que pueden ser controlados por empresa.
// El admin puede habilitar/deshabilitar estos módulos desde el panel de admin
// (tabla company_modules), y el plan contratado también los gatea:
//
//   minLevel = nivel mínimo de plan requerido para ver el módulo
//   nivel 0 = base (incluido en todos los planes) · Standard = 1 · Profesional = 2
//
// Precedencia en hasModule(): override explícito en company_modules (el admin
// puede otorgar/revocar puntualmente) → gate por plan (currentPlanLevel >= minLevel).
//
// NOTA: algunos módulos (preorders/production=App "Cocina", integrations, scale, y
// la tienda web) se venden como COMPLEMENTOS del Marketplace, no por plan. Su gating
// real es por App (ver src/constants/apps.js + hasApp). Aquí conservan un minLevel
// provisional solo como respaldo; el gate efectivo lo aplica hasApp.

export const ALL_MODULES = [
    // ── Nivel 0 · Base (incluido en todos los planes) ─────────────────
    {
        key: 'dashboard',
        label: 'Dashboard',
        description: 'Panel principal con resúmenes de ventas y métricas.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'pos',
        label: 'Ventas (POS)',
        description: 'Punto de venta para procesar transacciones.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'clients',
        label: 'Clientes',
        description: 'Gestión de clientes y cuentas corrientes.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'sales_history',
        label: 'Historial de Ventas',
        description: 'Consulta y gestión del historial de ventas.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'inventory',
        label: 'Inventario',
        description: 'Productos y categorías.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'reports',
        label: 'Reportes',
        description: 'Reportes básicos: ventas y cierres de caja.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'users',
        label: 'Usuarios',
        description: 'Gestión de usuarios y control de acceso.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },
    {
        key: 'settings',
        label: 'Configuración',
        description: 'Configuración general, empresa, boletas y permisos.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 0,
    },

    // ── Nivel 1 · Standard ────────────────────────────────────────────
    {
        key: 'sii',
        label: 'Facturación SII',
        description: 'Emisión de boletas y facturas electrónicas (SII).',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 1,
    },
    {
        key: 'purchases',
        label: 'Compras, Proveedores y Facturas',
        description: 'Proveedores, compras y facturas de proveedores.',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 1,
    },
    {
        key: 'taxes',
        label: 'Impuestos',
        description: 'Configuración de impuestos (IVA y otros).',
        defaultEnabled: true,
        plan: 'standard',
        minLevel: 1,
    },

    // ── Nivel 2 · Profesional ─────────────────────────────────────────
    {
        key: 'offline_sales',
        label: 'Ventas Offline',
        description: 'Sincronización de ventas realizadas sin conexión.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'supplier_orders',
        label: 'Órdenes de Compra',
        description: 'Pedidos a proveedores y su historial.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'invoice_payments',
        label: 'Pagos de Facturas',
        description: 'Reporte de pagos realizados a facturas de proveedores.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'product_profile',
        label: 'Perfil de Producto',
        description: 'Analítica detallada por producto.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'reports_advanced',
        label: 'Reportes avanzados',
        description: 'Utilidad, análisis de ventas y conciliación de datáfonos.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'vencimientos',
        label: 'Vencimientos',
        description: 'Control de productos próximos a vencer.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'finance',
        label: 'Administración financiera',
        description: 'Gastos, servicios recurrentes y utilidad operacional por empresa.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'personal',
        label: 'Gestión de Personal',
        description: 'Asistencia, turnos, ausencias, nómina/pagos y vacaciones.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'sorteos',
        label: 'Sorteos',
        description: 'Página pública de inscripción a sorteos con link propio por empresa.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'combos',
        label: 'Combos / Packs',
        description: 'Armado de combos y packs a partir de productos.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'inventory_control',
        label: 'Conciliación de Inventario',
        description: 'Toma de inventario físico y control/conciliación de stock.',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },
    {
        key: 'multisucursal',
        label: 'Multi-sucursal',
        description: 'Gestión de múltiples sucursales (agrega sucursales por +US$20/mes).',
        defaultEnabled: true,
        plan: 'professional',
        minLevel: 2,
    },

    // ── Complementos del Marketplace (Apps) — gating real por hasApp ───
    // Se dejan con minLevel provisional; el gate efectivo lo aplica hasApp.
    {
        key: 'preorders',
        label: 'Pedidos / Encargos (App Cocina)',
        description: 'Encargos, preventas, historial de pedidos, sonidos y pantalla de cocina.',
        defaultEnabled: false,
        plan: 'professional',
        minLevel: 2,
        appKey: 'cocina',
    },
    {
        key: 'production',
        label: 'Producción (App Cocina)',
        description: 'Pantalla de producción para gestión de encargos.',
        defaultEnabled: false,
        plan: 'professional',
        minLevel: 2,
        appKey: 'cocina',
    },
    {
        key: 'integrations',
        label: 'Integración tienda online (App)',
        description: 'Sincronización con WooCommerce y tienda web.',
        defaultEnabled: false,
        plan: 'professional',
        minLevel: 2,
        appKey: 'integracion',
    },
    {
        key: 'scale',
        label: 'Balanza (App)',
        description: 'Integración con balanza para productos por kg.',
        defaultEnabled: false,
        plan: 'professional',
        minLevel: 2,
        appKey: 'bascula',
    },
    {
        key: 'web',
        label: 'Tienda Web (App)',
        description: 'Pedidos web y sincronización de la tienda online.',
        defaultEnabled: false,
        plan: 'professional',
        minLevel: 2,
        appKey: 'tienda_web',
    },
];

// Helper: obtener módulo por key
export const getModuleByKey = (key) => ALL_MODULES.find(m => m.key === key);

// Helper: obtener defaults
export const getDefaultModules = () =>
    ALL_MODULES.map(m => ({ module_key: m.key, enabled: m.defaultEnabled ? 1 : 0 }));
