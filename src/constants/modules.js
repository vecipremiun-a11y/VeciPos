// Definición de todos los módulos del sistema que pueden ser controlados por empresa.
// El admin puede habilitar/deshabilitar estos módulos desde el panel de admin
// (tabla company_modules), y AHORA el plan contratado también los gatea:
//
//   minLevel = nivel mínimo de plan requerido para ver el módulo
//   nivel 0 = base (incluido en todos los planes) · Básico = 1 · Medium = 2 · Pro = 3
//
// Precedencia en hasModule(): rol owner/super_admin → override explícito en
// company_modules (admin puede otorgar/revocar puntualmente) → gate por plan
// (currentPlanLevel >= minLevel).

export const ALL_MODULES = [
    // ── Nivel 0 · Base (incluido en todos los planes) ─────────────────
    {
        key: 'dashboard',
        label: 'Dashboard',
        description: 'Panel principal con resúmenes de ventas y métricas.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'pos',
        label: 'Ventas (POS)',
        description: 'Punto de venta para procesar transacciones.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'clients',
        label: 'Clientes',
        description: 'Gestión de clientes y cuentas corrientes.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'sales_history',
        label: 'Historial de Ventas',
        description: 'Consulta y gestión del historial de ventas.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'inventory',
        label: 'Inventario',
        description: 'Productos y categorías.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'reports',
        label: 'Reportes',
        description: 'Reportes básicos: ventas, cierres de caja y vencimientos.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'users',
        label: 'Usuarios',
        description: 'Gestión de usuarios y control de acceso.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'settings',
        label: 'Configuración',
        description: 'Configuración general, empresa, boletas y permisos.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },
    {
        key: 'finance',
        label: 'Administración financiera',
        description: 'Gastos, servicios recurrentes y utilidad operacional por empresa.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 0,
    },

    // ── Nivel 1 · Básico ──────────────────────────────────────────────
    {
        key: 'sii',
        label: 'Facturación SII',
        description: 'Emisión de boletas y facturas electrónicas (SII).',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 1,
    },
    {
        key: 'orders',
        label: 'Compras y Proveedores',
        description: 'Proveedores, compras, facturas y pedidos a proveedores.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 1,
    },
    {
        key: 'taxes',
        label: 'Impuestos',
        description: 'Configuración de impuestos (IVA y otros).',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 1,
    },
    {
        key: 'product_profile',
        label: 'Perfil de Producto',
        description: 'Analítica detallada por producto.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 1,
    },
    {
        key: 'reports_advanced',
        label: 'Reportes avanzados',
        description: 'Utilidad, análisis de ventas y conciliación de datáfonos.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 1,
    },
    {
        key: 'scale',
        label: 'Balanza',
        description: 'Integración con balanza para productos por kg.',
        defaultEnabled: true,
        plan: 'basico',
        minLevel: 1,
    },

    // ── Nivel 2 · Medium ──────────────────────────────────────────────
    {
        key: 'preorders',
        label: 'Pedidos / Encargos',
        description: 'Encargos, preventas, historial de pedidos, sonidos y pantalla de cocina.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'production',
        label: 'Producción',
        description: 'Pantalla de producción para gestión de encargos.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'personal',
        label: 'Gestión de Personal',
        description: 'Asistencia, turnos, ausencias, nómina/pagos y vacaciones.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'sorteos',
        label: 'Sorteos',
        description: 'Página pública de inscripción a sorteos con link propio por empresa.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'combos',
        label: 'Combos / Packs',
        description: 'Armado de combos y packs a partir de productos.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'inventory_control',
        label: 'Conciliación de Inventario',
        description: 'Toma de inventario físico y control/conciliación de stock.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'integrations',
        label: 'Integraciones tienda online',
        description: 'Sincronización con WooCommerce y Shopify.',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },
    {
        key: 'multisucursal',
        label: 'Multi-sucursal',
        description: 'Gestión de múltiples empresas/sucursales (incluye 2; extra +US$20/mes).',
        defaultEnabled: false,
        plan: 'medium',
        minLevel: 2,
    },

    // ── Nivel 3 · Pro (roadmap "Próximamente") ────────────────────────
    {
        key: 'web',
        label: 'Página web propia',
        description: 'Sitio web propio para la empresa principal (Próximamente).',
        defaultEnabled: false,
        plan: 'pro',
        minLevel: 3,
    },
    {
        key: 'delivery',
        label: 'Delivery + App de repartidores',
        description: 'Delivery y app de repartidores para la empresa principal (Próximamente).',
        defaultEnabled: false,
        plan: 'pro',
        minLevel: 3,
    },
];

// Helper: obtener módulo por key
export const getModuleByKey = (key) => ALL_MODULES.find(m => m.key === key);

// Helper: obtener defaults
export const getDefaultModules = () =>
    ALL_MODULES.map(m => ({ module_key: m.key, enabled: m.defaultEnabled ? 1 : 0 }));
