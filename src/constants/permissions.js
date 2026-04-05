export const ALL_PERMISSIONS = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        permissions: [
            { id: 'dashboard.view', label: 'Ver Dashboard' },
            { id: 'dashboard.view_sales', label: 'Ver Resumen de Ventas' },
            { id: 'dashboard.view_profits', label: 'Ver Utilidades' },
        ]
    },
    {
        id: 'pos',
        label: 'Punto de Venta (POS)',
        permissions: [
            { id: 'pos.access', label: 'Acceso al POS' },
            { id: 'pos.sell', label: 'Realizar Ventas' },
            { id: 'pos.discount', label: 'Aplicar Descuentos' },
            { id: 'pos.open_register', label: 'Abrir Caja' },
            { id: 'pos.close_register', label: 'Cerrar Caja' },
            { id: 'pos.cash_in', label: 'Ingreso de Dinero' },
            { id: 'pos.cash_out', label: 'Retiro de Dinero' },
            { id: 'pos.suspend_sale', label: 'Suspender Venta' },
            { id: 'pos.recover_sale', label: 'Recuperar Venta' },
            { id: 'pos.cancel_sale', label: 'Anular Venta desde POS' },
            { id: 'pos.manage_cart', label: 'Gestionar Carritos (Tickets)' },
        ]
    },
    {
        id: 'sales',
        label: 'Historial de Ventas',
        permissions: [
            { id: 'sales.view', label: 'Ver Historial' },
            { id: 'sales.view_details', label: 'Ver Detalles de Venta' },
            { id: 'sales.cancel', label: 'Anular Venta' },
            { id: 'sales.return', label: 'Realizar Devoluciones' },
            { id: 'sales.export', label: 'Exportar Ventas' },
        ]
    },
    {
        id: 'products',
        label: 'Inventario / Productos',
        permissions: [
            { id: 'products.view', label: 'Ver Productos' },
            { id: 'products.create', label: 'Crear Productos' },
            { id: 'products.edit', label: 'Editar Productos' },
            { id: 'products.delete', label: 'Eliminar Productos' },
            { id: 'products.adjust_stock', label: 'Ajustar Stock' },
            { id: 'products.import', label: 'Importar Productos' },
            { id: 'products.export', label: 'Exportar Productos' },
            { id: 'products.view_cost', label: 'Ver Costo de Productos' },
        ]
    },
    {
        id: 'combos',
        label: 'Combos / Packs',
        permissions: [
            { id: 'combos.view', label: 'Ver Combos' },
            { id: 'combos.create', label: 'Crear Combos' },
            { id: 'combos.edit', label: 'Editar Combos' },
            { id: 'combos.delete', label: 'Eliminar Combos' },
        ]
    },
    {
        id: 'inventory_control',
        label: 'Control de Inventario',
        permissions: [
            { id: 'inventory_control.view', label: 'Ver Controles' },
            { id: 'inventory_control.create', label: 'Crear Control' },
            { id: 'inventory_control.manage', label: 'Gestionar Control (Reconciliar)' },
        ]
    },
    {
        id: 'alerts',
        label: 'Alertas de Inventario',
        permissions: [
            { id: 'alerts.view', label: 'Ver Alertas' },
            { id: 'alerts.manage', label: 'Configurar Alertas' },
        ]
    },
    {
        id: 'categories',
        label: 'Categorías',
        permissions: [
            { id: 'categories.view', label: 'Ver Categorías' },
            { id: 'categories.create', label: 'Crear Categorías' },
            { id: 'categories.edit', label: 'Editar Categorías' },
            { id: 'categories.delete', label: 'Eliminar Categorías' },
        ]
    },
    {
        id: 'suppliers',
        label: 'Proveedores',
        permissions: [
            { id: 'suppliers.view', label: 'Ver Proveedores' },
            { id: 'suppliers.create', label: 'Crear Proveedores' },
            { id: 'suppliers.edit', label: 'Editar Proveedores' },
            { id: 'suppliers.delete', label: 'Eliminar Proveedores' },
        ]
    },
    {
        id: 'purchases',
        label: 'Compras / Facturas',
        permissions: [
            { id: 'purchases.view', label: 'Ver Compras' },
            { id: 'purchases.create', label: 'Registrar Compra' },
            { id: 'purchases.edit', label: 'Editar Compra' }, // Not implemented yet but good to have
            { id: 'purchases.delete', label: 'Eliminar Compra' }, // Not implemented yet
        ]
    },
    {
        id: 'taxes',
        label: 'Impuestos',
        permissions: [
            { id: 'taxes.view', label: 'Ver Impuestos' },
            { id: 'taxes.create', label: 'Crear Impuestos' },
            { id: 'taxes.edit', label: 'Editar Impuestos' },
            { id: 'taxes.delete', label: 'Eliminar Impuestos' },
        ]
    },
    {
        id: 'clients',
        label: 'Clientes',
        permissions: [
            { id: 'clients.view', label: 'Ver Clientes' },
            { id: 'clients.create', label: 'Crear Clientes' },
            { id: 'clients.edit', label: 'Editar Clientes' },
            { id: 'clients.delete', label: 'Eliminar Clientes' },
            { id: 'clients.view_account', label: 'Ver Cuenta Corriente' },
            { id: 'clients.manage_payments', label: 'Gestionar Pagos Cta Cte' },
        ]
    },
    {
        id: 'supplier_orders',
        label: 'Pedidos a Proveedores',
        permissions: [
            { id: 'supplier_orders.view', label: 'Ver Pedidos' },
            { id: 'supplier_orders.create', label: 'Crear Pedidos' },
            { id: 'supplier_orders.edit', label: 'Editar Pedidos' },
            { id: 'supplier_orders.receive', label: 'Recibir Pedidos' },
            { id: 'supplier_orders.delete', label: 'Eliminar Pedidos' },
        ]
    },
    {
        id: 'preorders',
        label: 'Encargos',
        permissions: [
            { id: 'preorders.view', label: 'Ver Encargos' },
            { id: 'preorders.create', label: 'Crear Encargos' },
            { id: 'preorders.edit', label: 'Editar Encargos' },
            { id: 'preorders.complete', label: 'Completar/Entregar Encargos' },
        ]
    },
    {
        id: 'production',
        label: 'Producción',
        permissions: [
            { id: 'production.view', label: 'Ver Pantalla de Producción' },
            { id: 'production.manage', label: 'Gestionar Estados de Producción' },
        ]
    },
    {
        id: 'users',
        label: 'Usuarios',
        permissions: [
            { id: 'users.view', label: 'Ver Usuarios' },
            { id: 'users.create', label: 'Crear Usuarios' },
            { id: 'users.edit', label: 'Editar Usuarios' },
            { id: 'users.delete', label: 'Eliminar Usuarios' },
            { id: 'users.manage', label: 'Gestionar Usuarios (General)' },
        ]
    },
    {
        id: 'invoices',
        label: 'Facturas',
        permissions: [
            { id: 'invoices.view', label: 'Ver Facturas' },
            { id: 'invoices.create', label: 'Crear Facturas' },
            { id: 'invoices.edit', label: 'Editar Facturas' },
            { id: 'invoices.delete', label: 'Eliminar Facturas' },
            { id: 'invoices.pay', label: 'Registrar Pago de Factura' },
        ]
    },
    {
        id: 'product_profile',
        label: 'Perfil de Producto',
        permissions: [
            { id: 'product_profile.view', label: 'Ver Perfil de Producto' },
        ]
    },
    {
        id: 'reports',
        label: 'Reportes',
        permissions: [
            { id: 'reports.sales', label: 'Ver Reporte de Ventas' },
            { id: 'reports.expiring', label: 'Ver Productos por Vencer' },
            { id: 'reports.closures', label: 'Ver Cierres de Caja' },
            { id: 'reports.movements', label: 'Ver Movimientos de Caja' },
            { id: 'reports.invoice_payments', label: 'Ver Pagos de Facturas' },
            { id: 'reports.profit', label: 'Ver Reporte de Utilidades' },
            { id: 'reports.sales_analytics', label: 'Ver Análisis de Ventas' },
            { id: 'reports.export', label: 'Exportar Reportes' },
        ]
    },
    {
        id: 'personal',
        label: 'Gestión de Personal',
        permissions: [
            { id: 'personal.view', label: 'Acceso al Módulo de Personal' },
            { id: 'personal.manage', label: 'Gestionar Personal (Admin)' },
            { id: 'personal.attendance', label: 'Ver/Gestionar Asistencia' },
            { id: 'personal.corrections', label: 'Ver/Gestionar Correcciones' },
            { id: 'personal.shifts', label: 'Ver/Gestionar Turnos' },
            { id: 'personal.edit_past_shifts', label: 'Editar turnos pasados (Admin)' },
            { id: 'personal.absences', label: 'Ver/Gestionar Ausencias' },
            { id: 'personal.payroll', label: 'Ver/Gestionar Pagos y Nómina' },
            { id: 'personal.vacations', label: 'Ver/Gestionar Vacaciones' },
            { id: 'personal.reports', label: 'Ver Reportes de Personal' },
        ]
    },
    {
        id: 'sii',
        label: 'Documentos SII',
        permissions: [
            { id: 'sii.view', label: 'Ver Documentos SII' },
            { id: 'sii.folios', label: 'Gestionar Folios' },
        ]
    },
    {
        id: 'settings',
        label: 'Configuración',
        permissions: [
            { id: 'settings.view', label: 'Acceso a Configuración' },
            { id: 'settings.company', label: 'Configuración de Empresa' },
            { id: 'settings.receipts', label: 'Configuración de Boletas' },
            { id: 'settings.payments', label: 'Configuración de Medios de Pago' },
            { id: 'settings.system', label: 'Configuración del Sistema' },
            { id: 'settings.manage_permissions', label: 'Gestionar Permisos y Roles' },
        ]
    }
];
