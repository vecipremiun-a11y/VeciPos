export const ALL_PERMISSIONS = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        permissions: [
            { id: 'dashboard.view', label: 'Ver Dashboard', desc: 'Permite acceder a la pantalla principal con resumen general' },
            { id: 'dashboard.view_sales', label: 'Ver Resumen de Ventas', desc: 'Muestra el total de ventas del día y gráficos en el dashboard' },
            { id: 'dashboard.view_profits', label: 'Ver Utilidades', desc: 'Muestra las ganancias y márgenes en el dashboard' },
        ]
    },
    {
        id: 'pos',
        label: 'Punto de Venta (POS)',
        permissions: [
            { id: 'pos.access', label: 'Acceso al POS', desc: 'Permite entrar a la pantalla de punto de venta' },
            { id: 'pos.sell', label: 'Realizar Ventas', desc: 'Habilita el botón Cobrar para completar ventas y recibir pagos' },
            { id: 'pos.discount', label: 'Aplicar Descuentos', desc: 'Permite aplicar descuentos a productos en el carrito' },
            { id: 'pos.open_register', label: 'Abrir Caja', desc: 'Requiere abrir caja con monto inicial antes de vender' },
            { id: 'pos.close_register', label: 'Cerrar Caja', desc: 'Permite hacer cierre de caja con conteo de dinero' },
            { id: 'pos.cash_in', label: 'Ingreso de Dinero', desc: 'Permite registrar ingresos de efectivo a la caja abierta' },
            { id: 'pos.cash_out', label: 'Retiro de Dinero', desc: 'Permite registrar retiros de efectivo de la caja abierta' },
            { id: 'pos.suspend_sale', label: 'Suspender Venta', desc: 'Guarda el carrito actual para continuar después' },
            { id: 'pos.recover_sale', label: 'Recuperar Venta', desc: 'Permite recuperar ventas suspendidas al carrito' },
            { id: 'pos.preventa', label: 'Crear Preventas', desc: 'Permite armar carrito y generar ticket de preventa con código de barras (sin cobrar)' },
        ]
    },
    {
        id: 'sales',
        label: 'Historial de Ventas',
        permissions: [
            { id: 'sales.view', label: 'Ver Historial', desc: 'Permite ver la lista de ventas realizadas' },
            { id: 'sales.view_details', label: 'Ver Detalles de Venta', desc: 'Permite abrir y ver el detalle completo de cada venta' },
            { id: 'sales.cancel', label: 'Anular Venta', desc: 'Permite anular ventas desde el historial' },
            { id: 'sales.return', label: 'Realizar Devoluciones', desc: 'Permite hacer devoluciones de productos vendidos' },
            { id: 'sales.export', label: 'Exportar Ventas', desc: 'Permite descargar el historial de ventas como archivo' },
        ]
    },
    {
        id: 'products',
        label: 'Inventario / Productos',
        permissions: [
            { id: 'products.view', label: 'Ver Productos', desc: 'Permite ver el catálogo de productos e inventario' },
            { id: 'products.create', label: 'Crear Productos', desc: 'Permite agregar nuevos productos al catálogo' },
            { id: 'products.edit', label: 'Editar Productos', desc: 'Permite modificar nombre, precio, stock y datos de productos' },
            { id: 'products.delete', label: 'Eliminar Productos', desc: 'Permite eliminar productos del catálogo permanentemente' },
            { id: 'products.adjust_stock', label: 'Ajustar Stock', desc: 'Permite hacer ajustes manuales al stock de productos' },
            { id: 'products.import', label: 'Importar Productos', desc: 'Permite cargar productos masivamente desde archivo Excel/CSV' },
            { id: 'products.export', label: 'Exportar Productos', desc: 'Permite descargar el catálogo de productos como archivo' },
            { id: 'products.view_cost', label: 'Ver Costo de Productos', desc: 'Muestra el precio de costo y margen de ganancia (dato sensible)' },
        ]
    },
    {
        id: 'combos',
        label: 'Combos / Packs',
        permissions: [
            { id: 'combos.view', label: 'Ver Combos', desc: 'Permite ver los combos/packs creados' },
            { id: 'combos.create', label: 'Crear Combos', desc: 'Permite crear nuevos combos agrupando productos' },
            { id: 'combos.edit', label: 'Editar Combos', desc: 'Permite modificar combos existentes' },
            { id: 'combos.delete', label: 'Eliminar Combos', desc: 'Permite eliminar combos permanentemente' },
        ]
    },
    {
        id: 'inventory_control',
        label: 'Control de Inventario',
        permissions: [
            { id: 'inventory_control.view', label: 'Ver Controles', desc: 'Permite ver los controles de inventario realizados' },
            { id: 'inventory_control.create', label: 'Crear Control', desc: 'Permite iniciar un nuevo conteo/control de inventario' },
            { id: 'inventory_control.manage', label: 'Gestionar Control (Reconciliar)', desc: 'Permite aprobar diferencias y ajustar stock según el control' },
        ]
    },
    {
        id: 'alerts',
        label: 'Alertas de Inventario',
        permissions: [
            { id: 'alerts.view', label: 'Ver Alertas', desc: 'Permite ver alertas de stock bajo, vencimientos, etc.' },
            { id: 'alerts.manage', label: 'Configurar Alertas', desc: 'Permite configurar umbrales y reglas de alertas' },
        ]
    },
    {
        id: 'categories',
        label: 'Categorías',
        permissions: [
            { id: 'categories.view', label: 'Ver Categorías', desc: 'Permite ver las categorías de productos' },
            { id: 'categories.create', label: 'Crear Categorías', desc: 'Permite crear nuevas categorías para clasificar productos' },
            { id: 'categories.edit', label: 'Editar Categorías', desc: 'Permite renombrar o modificar categorías existentes' },
            { id: 'categories.delete', label: 'Eliminar Categorías', desc: 'Permite eliminar categorías (productos quedan sin categoría)' },
        ]
    },
    {
        id: 'suppliers',
        label: 'Proveedores',
        permissions: [
            { id: 'suppliers.view', label: 'Ver Proveedores', desc: 'Permite ver la lista de proveedores registrados' },
            { id: 'suppliers.create', label: 'Crear Proveedores', desc: 'Permite agregar nuevos proveedores al sistema' },
            { id: 'suppliers.edit', label: 'Editar Proveedores', desc: 'Permite modificar datos de proveedores existentes' },
            { id: 'suppliers.delete', label: 'Eliminar Proveedores', desc: 'Permite eliminar proveedores del sistema' },
        ]
    },
    {
        id: 'purchases',
        label: 'Compras / Facturas',
        permissions: [
            { id: 'purchases.view', label: 'Ver Compras', desc: 'Permite ver el registro de compras a proveedores' },
            { id: 'purchases.create', label: 'Registrar Compra', desc: 'Permite registrar nuevas compras y actualizar stock' },
            { id: 'purchases.edit', label: 'Editar Compra', desc: 'Permite modificar compras registradas' },
            { id: 'purchases.delete', label: 'Eliminar Compra', desc: 'Permite eliminar registros de compra' },
        ]
    },
    {
        id: 'taxes',
        label: 'Impuestos',
        permissions: [
            { id: 'taxes.view', label: 'Ver Impuestos', desc: 'Permite ver las tasas de impuesto configuradas' },
            { id: 'taxes.create', label: 'Crear Impuestos', desc: 'Permite crear nuevas tasas de impuesto' },
            { id: 'taxes.edit', label: 'Editar Impuestos', desc: 'Permite modificar tasas de impuesto existentes' },
            { id: 'taxes.delete', label: 'Eliminar Impuestos', desc: 'Permite eliminar tasas de impuesto' },
        ]
    },
    {
        id: 'clients',
        label: 'Clientes',
        permissions: [
            { id: 'clients.view', label: 'Ver Clientes', desc: 'Permite ver la lista de clientes registrados' },
            { id: 'clients.create', label: 'Crear Clientes', desc: 'Permite registrar nuevos clientes en el sistema' },
            { id: 'clients.edit', label: 'Editar Clientes', desc: 'Permite modificar datos de clientes existentes' },
            { id: 'clients.delete', label: 'Eliminar Clientes', desc: 'Permite eliminar clientes del sistema' },
            { id: 'clients.view_account', label: 'Ver Cuenta Corriente', desc: 'Permite ver el estado de deuda y pagos del cliente' },
            { id: 'clients.manage_payments', label: 'Gestionar Pagos Cta Cte', desc: 'Permite registrar abonos y pagos en la cuenta corriente' },
        ]
    },
    {
        id: 'supplier_orders',
        label: 'Pedidos a Proveedores',
        permissions: [
            { id: 'supplier_orders.view', label: 'Ver Pedidos', desc: 'Permite ver los pedidos realizados a proveedores' },
            { id: 'supplier_orders.create', label: 'Crear Pedidos', desc: 'Permite generar nuevos pedidos a proveedores' },
            { id: 'supplier_orders.edit', label: 'Editar Pedidos', desc: 'Permite modificar pedidos pendientes' },
            { id: 'supplier_orders.receive', label: 'Recibir Pedidos', desc: 'Permite marcar pedidos como recibidos y actualizar stock' },
            { id: 'supplier_orders.delete', label: 'Eliminar Pedidos', desc: 'Permite eliminar pedidos del sistema' },
        ]
    },
    {
        id: 'preorders',
        label: 'Encargos',
        permissions: [
            { id: 'preorders.view', label: 'Ver Encargos', desc: 'Permite ver la lista de encargos de clientes' },
            { id: 'preorders.create', label: 'Crear Encargos', desc: 'Permite registrar nuevos encargos con fecha de entrega' },
            { id: 'preorders.edit', label: 'Editar Encargos', desc: 'Permite modificar encargos existentes' },
            { id: 'preorders.complete', label: 'Completar/Entregar Encargos', desc: 'Permite marcar encargos como entregados al cliente' },
        ]
    },
    {
        id: 'production',
        label: 'Producción',
        permissions: [
            { id: 'production.view', label: 'Ver Pantalla de Producción', desc: 'Permite ver los pedidos en cola de producción' },
            { id: 'production.manage', label: 'Gestionar Estados de Producción', desc: 'Permite cambiar estados: en preparación, listo, entregado' },
        ]
    },
    {
        id: 'users',
        label: 'Usuarios',
        permissions: [
            { id: 'users.view', label: 'Ver Usuarios', desc: 'Permite ver la lista de usuarios del sistema' },
            { id: 'users.create', label: 'Crear Usuarios', desc: 'Permite agregar nuevos usuarios con credenciales' },
            { id: 'users.edit', label: 'Editar Usuarios', desc: 'Permite modificar datos y rol de usuarios existentes' },
            { id: 'users.delete', label: 'Eliminar Usuarios', desc: 'Permite eliminar usuarios del sistema' },
            { id: 'users.manage', label: 'Gestionar Usuarios (General)', desc: 'Acceso completo a la administración de usuarios' },
        ]
    },
    {
        id: 'invoices',
        label: 'Facturas',
        permissions: [
            { id: 'invoices.view', label: 'Ver Facturas', desc: 'Permite ver las facturas de proveedores registradas' },
            { id: 'invoices.create', label: 'Crear Facturas', desc: 'Permite registrar nuevas facturas de proveedores' },
            { id: 'invoices.edit', label: 'Editar Facturas', desc: 'Permite modificar facturas existentes' },
            { id: 'invoices.delete', label: 'Eliminar Facturas', desc: 'Permite eliminar facturas del sistema' },
            { id: 'invoices.pay', label: 'Registrar Pago de Factura', desc: 'Permite marcar facturas como pagadas y registrar el pago' },
        ]
    },
    {
        id: 'product_profile',
        label: 'Perfil de Producto',
        permissions: [
            { id: 'product_profile.view', label: 'Ver Perfil de Producto', desc: 'Permite ver la ficha detallada de cada producto con historial' },
        ]
    },
    {
        id: 'reports',
        label: 'Reportes',
        permissions: [
            { id: 'reports.sales', label: 'Ver Reporte de Ventas', desc: 'Accede al reporte con totales por día, semana o mes' },
            { id: 'reports.expiring', label: 'Ver Productos por Vencer', desc: 'Muestra productos próximos a su fecha de vencimiento' },
            { id: 'reports.closures', label: 'Ver Cierres de Caja', desc: 'Muestra historial de aperturas y cierres de caja' },
            { id: 'reports.movements', label: 'Ver Movimientos de Caja', desc: 'Muestra ingresos y retiros de efectivo registrados' },
            { id: 'reports.invoice_payments', label: 'Ver Pagos de Facturas', desc: 'Muestra pagos realizados a facturas de proveedores' },
            { id: 'reports.profit', label: 'Ver Reporte de Utilidades', desc: 'Muestra ganancias por producto y periodo (dato sensible)' },
            { id: 'reports.sales_analytics', label: 'Ver Análisis de Ventas', desc: 'Gráficos y análisis avanzado de tendencias de venta' },
            { id: 'reports.export', label: 'Exportar Reportes', desc: 'Permite descargar reportes como archivo Excel/PDF' },
        ]
    },
    {
        id: 'personal',
        label: 'Gestión de Personal',
        permissions: [
            { id: 'personal.view', label: 'Acceso al Módulo de Personal', desc: 'Permite entrar a la sección de gestión de personal' },
            { id: 'personal.manage', label: 'Gestionar Personal (Admin)', desc: 'Control total sobre fichas laborales y configuración' },
            { id: 'personal.attendance', label: 'Ver/Gestionar Asistencia', desc: 'Permite ver y registrar marcaciones de entrada/salida' },
            { id: 'personal.corrections', label: 'Ver/Gestionar Correcciones', desc: 'Permite crear y aprobar correcciones de asistencia' },
            { id: 'personal.shifts', label: 'Ver/Gestionar Turnos', desc: 'Permite ver y asignar turnos de trabajo' },
            { id: 'personal.edit_past_shifts', label: 'Editar turnos pasados (Admin)', desc: 'Permite modificar turnos de días anteriores' },
            { id: 'personal.absences', label: 'Ver/Gestionar Ausencias', desc: 'Permite registrar y ver licencias, permisos y ausencias' },
            { id: 'personal.payroll', label: 'Ver/Gestionar Pagos y Nómina', desc: 'Permite ver sueldos, bonos y liquidaciones (dato sensible)' },
            { id: 'personal.payroll_close', label: 'Cerrar Periodos de Nómina', desc: 'Permite cerrar el periodo y generar liquidaciones definitivas' },
            { id: 'personal.payroll_config', label: 'Configurar Reglas de Nómina', desc: 'Permite configurar reglas de cálculo de sueldo y descuentos' },
            { id: 'personal.advances', label: 'Gestionar Adelantos', desc: 'Permite registrar y aprobar adelantos de sueldo' },
            { id: 'personal.vacations', label: 'Ver/Gestionar Vacaciones', desc: 'Permite ver y gestionar solicitudes de vacaciones' },
            { id: 'personal.reports', label: 'Ver Reportes de Personal', desc: 'Accede a reportes de asistencia, horas y costos' },
            { id: 'personal.edit_pay', label: 'Editar Tipo y Montos de Pago', desc: 'Permite cambiar sueldo base, bonos y tipo de pago' },
        ]
    },
    {
        id: 'sii',
        label: 'Documentos SII',
        permissions: [
            { id: 'sii.view', label: 'Ver Documentos SII', desc: 'Permite ver boletas y facturas electrónicas emitidas al SII' },
            { id: 'sii.folios', label: 'Gestionar Folios', desc: 'Permite solicitar y administrar folios CAF del SII' },
        ]
    },
    {
        id: 'sorteos',
        label: 'Sorteos',
        permissions: [
            { id: 'sorteos.view', label: 'Ver Sorteos', desc: 'Permite acceder al módulo de sorteos y ver los participantes' },
            { id: 'sorteos.manage', label: 'Gestionar Sorteos', desc: 'Permite configurar el sorteo, editar campos y sortear ganadores' },
        ]
    },
    {
        id: 'settings',
        label: 'Configuración',
        permissions: [
            { id: 'settings.view', label: 'Acceso a Configuración', desc: 'Permite entrar a la sección de configuración' },
            { id: 'settings.company', label: 'Configuración de Empresa', desc: 'Permite editar nombre, RUT, dirección y datos de la empresa' },
            { id: 'settings.receipts', label: 'Configuración de Boletas', desc: 'Permite personalizar el formato y contenido de boletas' },
            { id: 'settings.payments', label: 'Configuración de Medios de Pago', desc: 'Permite configurar terminales, cuentas bancarias y métodos de pago' },
            { id: 'settings.system', label: 'Configuración del Sistema', desc: 'Permite cambiar zona horaria, moneda y ajustes generales' },
            { id: 'settings.manage_permissions', label: 'Gestionar Permisos y Roles', desc: 'Permite crear roles, editar permisos y asignar accesos' },
        ]
    }
];
