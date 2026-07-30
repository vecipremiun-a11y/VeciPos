// Plantillas de permisos por rol + seeding server-side (usado al crear una empresa).
// Extraído del store para no duplicar y para que la creación de empresas corra en el servidor.

export const DEFAULT_PERMS = {
    'Caja': [
        'dashboard.view', 'dashboard.view_sales',
        'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
        'sales.view', 'sales.view_details',
        'clients.view', 'clients.create', 'clients.view_account',
        'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.complete',
        'personal.view', 'personal.attendance', 'personal.corrections',
        'alerts.view',
    ],
    'Vendedor': [
        'dashboard.view',
        'pos.access', 'pos.preventa',
        'clients.view', 'clients.create',
        'personal.view', 'personal.attendance',
        'alerts.view',
    ],
    'Bodeguero': [
        'dashboard.view',
        'products.view', 'products.create', 'products.edit', 'products.adjust_stock', 'products.import', 'products.export',
        'categories.view', 'categories.create', 'categories.edit',
        'suppliers.view', 'suppliers.create', 'suppliers.edit',
        'invoices.view', 'invoices.create',
        'purchases.view', 'purchases.create', 'purchases.edit',
        'product_profile.view',
        'supplier_orders.view', 'supplier_orders.create', 'supplier_orders.edit', 'supplier_orders.receive',
        'reports.expiring',
        'combos.view', 'combos.create', 'combos.edit', 'combos.delete',
        'inventory_control.view', 'inventory_control.create', 'inventory_control.manage',
        'alerts.view', 'alerts.manage',
    ],
    'Supervisor': [
        'dashboard.view', 'dashboard.view_sales', 'dashboard.view_profits',
        'sales.view', 'sales.view_details', 'sales.export',
        'clients.view', 'clients.view_account',
        'reports.sales', 'reports.expiring', 'reports.closures', 'reports.movements', 'reports.invoice_payments', 'reports.profit', 'reports.sales_analytics', 'reports.export',
        'products.view', 'products.view_cost',
        'taxes.view',
        'personal.view', 'personal.attendance', 'personal.corrections', 'personal.shifts', 'personal.absences', 'personal.reports',
        'combos.view',
        'inventory_control.view',
        'alerts.view',
        'sii.view', 'sii.folios',
        'finance.view',
    ],
    // Repartidor: acceso EXCLUSIVO a su pantalla de entregas. Sin POS, sin caja,
    // sin inventario. Existe para no tener que darle un rol de cajero/vendedor a
    // alguien que solo reparte (le abriría medio sistema).
    'Repartidor': [
        'delivery.courier',
    ],
};

export const ALL_PERMS = [
    'dashboard.view', 'dashboard.view_sales', 'dashboard.view_profits',
    'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
    'sales.view', 'sales.cancel', 'sales.export', 'sales.view_details',
    'products.view', 'products.create', 'products.edit', 'products.delete', 'products.adjust_stock', 'products.import', 'products.export', 'products.view_cost',
    'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.pay',
    'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete',
    'product_profile.view',
    'clients.view', 'clients.create', 'clients.edit', 'clients.delete', 'clients.view_account', 'clients.manage_payments',
    'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.delete', 'preorders.complete',
    'production.view', 'production.manage',
    'supplier_orders.view', 'supplier_orders.create', 'supplier_orders.edit', 'supplier_orders.receive', 'supplier_orders.delete',
    'reports.sales', 'reports.expiring', 'reports.closures', 'reports.movements', 'reports.invoice_payments', 'reports.profit', 'reports.sales_analytics', 'reports.export',
    'users.view', 'users.create', 'users.edit', 'users.delete', 'users.manage',
    'settings.view', 'settings.company', 'settings.receipts', 'settings.payments', 'settings.system', 'settings.manage_permissions',
    'taxes.view', 'taxes.create', 'taxes.edit', 'taxes.delete',
    'personal.view', 'personal.manage', 'personal.attendance', 'personal.corrections', 'personal.shifts', 'personal.edit_past_shifts', 'personal.absences', 'personal.payroll', 'personal.vacations', 'personal.reports',
    'combos.view', 'combos.create', 'combos.edit', 'combos.delete',
    'inventory_control.view', 'inventory_control.create', 'inventory_control.manage',
    'alerts.view', 'alerts.manage',
    'sii.view', 'sii.folios',
    'finance.view', 'finance.manage',
    'delivery.view', 'delivery.assign', 'delivery.couriers', 'delivery.settle', 'delivery.courier',
];

// Siembra las plantillas de permisos por rol para una empresa nueva (INSERT OR IGNORE, por lotes).
export async function seedRolePermissions(turso, companyId) {
    const queries = [];
    for (const role of ['Caja', 'Vendedor', 'Bodeguero', 'Supervisor', 'Repartidor']) {
        const allowed = DEFAULT_PERMS[role] || [];
        for (const p of ALL_PERMS) {
            queries.push({
                sql: 'INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
                args: [companyId, role, p, allowed.includes(p) ? 1 : 0],
            });
        }
    }
    // Administrador: todo
    for (const p of ALL_PERMS) {
        queries.push({
            sql: 'INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)',
            args: [companyId, 'Administrador', p, 1],
        });
    }
    const CHUNK = 50;
    for (let i = 0; i < queries.length; i += CHUNK) {
        await turso.batch(queries.slice(i, i + CHUNK));
    }
}
