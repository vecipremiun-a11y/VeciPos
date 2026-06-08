// Definición de todos los módulos del sistema que pueden ser controlados por empresa
// El admin puede habilitar/deshabilitar estos módulos desde el panel de admin

export const ALL_MODULES = [
    {
        key: 'dashboard',
        label: 'Dashboard',
        description: 'Panel principal con resúmenes de ventas y métricas.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'pos',
        label: 'Ventas (POS)',
        description: 'Punto de venta para procesar transacciones.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'clients',
        label: 'Clientes',
        description: 'Gestión de clientes y cuentas corrientes.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'sales_history',
        label: 'Historial de Ventas',
        description: 'Consulta y gestión del historial de ventas.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'preorders',
        label: 'Pedidos / Encargos',
        description: 'Sistema de encargos y pedidos personalizados.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'production',
        label: 'Producción',
        description: 'Pantalla de producción para gestión de encargos.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'inventory',
        label: 'Inventario',
        description: 'Productos, categorías, proveedores, facturas y compras.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'orders',
        label: 'Órdenes de Compra',
        description: 'Pedidos a proveedores y seguimiento.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'reports',
        label: 'Reportes',
        description: 'Reportes de ventas, cierres de caja, utilidades y más.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'personal',
        label: 'Gestión de Personal',
        description: 'Asistencia, turnos, ausencias, nómina, vacaciones y más.',
        defaultEnabled: false,
        plan: 'pro',
    },
    {
        key: 'sorteos',
        label: 'Sorteos',
        description: 'Página pública de inscripción a sorteos con link propio por empresa.',
        defaultEnabled: false,
        plan: 'pro',
    },
    {
        key: 'users',
        label: 'Usuarios',
        description: 'Gestión de usuarios y control de acceso.',
        defaultEnabled: true,
        plan: 'basic',
    },
    {
        key: 'settings',
        label: 'Configuración',
        description: 'Configuración general, empresa, boletas y permisos.',
        defaultEnabled: true,
        plan: 'basic',
    },
];

// Helper: obtener módulo por key
export const getModuleByKey = (key) => ALL_MODULES.find(m => m.key === key);

// Helper: obtener defaults
export const getDefaultModules = () =>
    ALL_MODULES.map(m => ({ module_key: m.key, enabled: m.defaultEnabled ? 1 : 0 }));
