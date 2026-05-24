import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { turso } from '../lib/turso';
import { getNowInCompanyTime, getCompanyDayStart, getCompanyDayEnd, getStartFromDateString, getEndFromDateString, formatInCompanyTime } from '../lib/dateHelpers';
import { purgeCompanyData, localDb, pendingOpsApi, siiFoliosApi } from '../lib/db/localdb';
import { syncCatalogFromServer } from '../lib/db/sync';
import { markActivity } from '../lib/smartPolling';
import { mirrorSaleItems, mirrorPurchaseItems } from '../lib/itemNormalization';
import { cleanRut } from '../utils/rutValidation';

let migrationsExecuted = false;
let fetchInProgress = false;
const DDL_CACHE_KEY = 'poskem_ddl_v';
const DDL_TARGET = 22; // Increment when adding new migrations/DDL

const safeJsonStringify = (value) => JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === 'bigint') {
        const asNumber = Number(currentValue);
        return Number.isFinite(asNumber) ? asNumber : currentValue.toString();
    }
    return currentValue;
});

const normalizeSku = (value) => {
    if (value === undefined || value === null) {
        return '';
    }

    return String(value).trim().toUpperCase();
};

export const useStore = create(persist((set, get) => ({
    // Initial State
    products: [],
    productLots: [], // New state for lots
    categories: [],
    suppliers: [],
    users: [],
    rolePermissions: [], // 🔒 Permissions State (Initialized)
    companyModules: [], // 🏷️ Feature Flags per company
    purchases: [],
    sales: [],
    // Multi-cart system
    carts: [
        {
            id: 1,
            name: 'Ticket 1',
            items: [],
            client: null,
            tipoDte: 39,
            createdAt: Date.now()
        }
    ],
    activeCartId: 1,
    nextCartId: 2,

    // Payment Methods State
    paymentMethodsConfig: {
        cash_enabled: 1,
        card_enabled: 1,
        transfer_enabled: 1,
        credit_enabled: 1,
        mixed_enabled: 1
    },
    paymentTerminals: [],
    bankAccounts: [],
    taxRates: [], // 🆕 Tax Rates State

    // 👷 GESTIÓN LABORAL - Estado Inicial
    staffMembers: [],
    attendanceToday: [],
    pendingCorrections: [],
    workShifts: [],
    laborAbsences: [],
    personalConfig: null,
    salaryAdvances: [],
    payrollPeriods: [],
    payrollPayments: [],
    vacationRequests: [],
    vacationBalances: [],

    // Computed getters (derivados automáticamente, sin duplicación)
    get cart() {
        const { carts, activeCartId } = get();
        return carts.find(c => c.id === activeCartId)?.items || [];
    },

    get posSelectedClient() {
        const { carts, activeCartId } = get();
        return carts.find(c => c.id === activeCartId)?.client || null;
    },
    activeRegisters: [],
    cashRegister: null,
    currentUser: null,
    isLoading: false,
    error: null,
    _hasHydrated: false,
    setHasHydrated: (state) => set({ _hasHydrated: state }),
    darkMode: true, // Default to dark mode

    toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

    inventoryAdjustmentMode: false, // Will be loaded from DB per company
    creditBlockMode: 'warn', // 'warn' or 'block' - loaded from DB per company

    toggleInventoryAdjustmentMode: async () => {
        const { activeCompanyId, inventoryAdjustmentMode } = get();
        const newValue = !inventoryAdjustmentMode;

        try {
            // Update database
            await turso.execute({
                sql: 'UPDATE companies SET inventory_adjustment_mode = ? WHERE id = ?',
                args: [newValue ? 1 : 0, activeCompanyId]
            });

            // Update local state
            set({ inventoryAdjustmentMode: newValue });

            return { success: true };
        } catch (e) {
            console.error('Error updating inventory adjustment mode:', e);
            return { success: false, error: e.message };
        }
    },

    // SaaS State & Logic
    activeCompanyId: 'default',
    availableCompanies: [], // List of companies the user can access
    currentCompanyTimezone: 'America/Santiago', // <-- Timezone support
    currentCurrency: 'CLP', // Moneda activa de la empresa
    // Default to default for migration, but logic should update this. 
    // Wait, I should probably load this from localStorage? 
    // For now 'default' is safe as we backfilled everything to 'default'.

    // Estado del sistema de soporte
    supportTickets: [],
    currentTicket: null,
    unreadSupportCount: 0,

    currentUserCompanyRole: null,

    validateCompanyAccess: (userId, companyId) => {
        const { availableCompanies, currentUser } = get();
        // 1. Basic User Check
        if (!currentUser || !userId) return false;

        // 2. Super Admin Bypass (Optional, but safer to stick to explicit membership for data consistency)
        // However, if super_admin is not "owner" but needs access, this might be needed.
        // But our createCompany makes them owner. So membership check is robust.

        // 3. Check Membership
        return availableCompanies.some(c => c.id === companyId);
    },

    _runMigrations: async () => {
        console.log("Checking SaaS Migrations...");
        try {
            // 0. Ensure System Settings Table Exists
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            `);

            // Check Schema Version
            const versionRes = await turso.execute("SELECT value FROM system_settings WHERE key = 'schema_version'");
            const currentVersion = versionRes.rows.length > 0 ? parseInt(versionRes.rows[0].value) : 0;
            const TARGET_VERSION = 9;

            if (currentVersion >= TARGET_VERSION) {
                console.log("Schema is up to date (v" + currentVersion + ")");
                return;
            }

            console.log(`Migrating Schema from v${currentVersion} to v${TARGET_VERSION}...`);

            // Migration 1: Base Tables (v1)
            if (currentVersion < 1) {
                // This block is implicitly handled by the subsequent CREATE TABLE IF NOT EXISTS statements
                // and the initial setup of company_id.
                // For explicit versioning, one might wrap existing table creations here.
            }

            // 1. Create Companies Table
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS companies (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT DEFAULT 'active', -- active, suspended, deleted
                    created_at TEXT,
                    inventory_adjustment_mode INTEGER DEFAULT 0
                )
            `);

            // 2. Create User-Companies Table
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS user_companies (
                    user_id INTEGER,
                    company_id TEXT,
                    role TEXT,
                    PRIMARY KEY (user_id, company_id)
                )
            `);

            // 3. Create Audit Logs Table
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    user_id INTEGER,
                    action TEXT,
                    entity TEXT,
                    details TEXT,
                    created_at TEXT
                )
            `);

            // 4. Ensure Default Company Exists
            const defaultCompanyCheck = await turso.execute("SELECT * FROM companies WHERE id = 'default'");
            if (defaultCompanyCheck.rows.length === 0) {
                await turso.execute({
                    sql: "INSERT INTO companies (id, name, status, created_at) VALUES (?, ?, ?, ?)",
                    args: ['default', 'Empresa Principal', 'active', new Date().toISOString()]
                });
                console.log("Created Default Company");
            }

            // 5. Add company_id to all tables
            const tablesWithCompany = [
                'users', 'products', 'product_lots', 'categories', 'suppliers',
                'sales', 'clients', 'purchases', 'cash_registers', 'cash_movements'
            ];

            for (const table of tablesWithCompany) {
                try {
                    const info = await turso.execute(`PRAGMA table_info(${table})`);
                    const hasCompanyId = info.rows.some(col => col.name === 'company_id');
                    if (!hasCompanyId) {
                        console.log(`Adding company_id to ${table}...`);
                        await turso.execute(`ALTER TABLE ${table} ADD COLUMN company_id TEXT DEFAULT 'default'`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_company_id ON ${table}(company_id)`);
                    }
                } catch (e) {
                    console.warn(`Migration error for table ${table}:`, e);
                }
            }

            // Composite Indices for Sales and Purchases
            try {
                // Índices existentes (mantener)
                await turso.execute("CREATE INDEX IF NOT EXISTS idx_sales_company_date ON sales(company_id, date)");
                await turso.execute("CREATE INDEX IF NOT EXISTS idx_purchases_company_date ON purchases(company_id, date)");

                // 🆕 NUEVOS ÍNDICES PARA PERFORMANCE

                // 1. Para Reports.jsx - Query principal de reportes
                // Usado en: fetchProductProfitReport(startDate, endDate)
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_product_daily_profit_lookup 
                    ON product_daily_profit(company_id, day, product_id)
                `);

                // 2. Para Dashboard - Top productos del día
                // Usado en: fetchDashboardData() para productos más vendidos
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_product_daily_profit_top 
                    ON product_daily_profit(company_id, day, total_quantity DESC)
                `);

                // 3. Para FEFO - Lotes por fecha de vencimiento
                // Usado en: addSale() al deducir stock de lotes
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_product_lots_fefo 
                    ON product_lots(product_id, expiry_date) 
                    WHERE quantity > 0
                `);

                // 4. Para búsqueda de productos
                // Usado en: searchProducts(), loadCategoryProducts()
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_products_search 
                    ON products(company_id, category, name, sku)
                `);

                // 5. Para productos encargables
                // Usado en: getPreorderableProducts() - filtrar por sale_mode
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_products_preorder 
                    ON products(company_id, sale_mode, category, name)
                `);

                // 5b. Para productos por proveedor
                // Usado en: Orders - cargar productos del proveedor seleccionado
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_products_supplier 
                    ON products(company_id, supplier)
                `);

                // 6. Para ventas con status
                // Usado en: queries que filtran por status (cancelled, completed)
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_sales_status 
                    ON sales(company_id, status, date DESC)
                `);

                // 6. Para historial de clientes
                // Usado en: ClientAccountDetails - ver ventas por cliente
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_sales_client 
                    ON sales(client_id, company_id, date DESC) 
                    WHERE client_id IS NOT NULL
                `);

                // 7. Para cierres de caja
                // Usado en: CashClosuresReport
                await turso.execute(`
                    CREATE INDEX IF NOT EXISTS idx_cash_registers_closure 
                    ON cash_registers(company_id, opening_time DESC, status)
                `);

                console.log('✅ Performance indices created successfully');

            } catch (e) {
                console.warn("❌ Index creation error", e);
            }

            // 6. Add inventory_adjustment_mode to companies table (for existing databases)
            try {
                const companyInfo = await turso.execute(`PRAGMA table_info(companies)`);
                const hasInventoryMode = companyInfo.rows.some(col => col.name === 'inventory_adjustment_mode');
                if (!hasInventoryMode) {
                    console.log('Adding inventory_adjustment_mode to companies...');
                    await turso.execute(`ALTER TABLE companies ADD COLUMN inventory_adjustment_mode INTEGER DEFAULT 0`);
                }
            } catch (e) {
                console.warn("Migration error for companies.inventory_adjustment_mode:", e);
            }


            // 7. Add new columns to suppliers table (seller_name, order_days, delivery_days)
            try {
                const supplierInfo = await turso.execute(`PRAGMA table_info(suppliers)`);
                const hasSellerName = supplierInfo.rows.some(col => col.name === 'seller_name');
                if (!hasSellerName) {
                    console.log('Adding extra columns to suppliers...');
                    await turso.execute(`ALTER TABLE suppliers ADD COLUMN seller_name TEXT`);
                    await turso.execute(`ALTER TABLE suppliers ADD COLUMN order_days TEXT`);
                    await turso.execute(`ALTER TABLE suppliers ADD COLUMN delivery_days TEXT`);
                }
            } catch (e) {
                console.warn("Migration error for suppliers extra columns:", e);
            }

            // 8. Add Wholesale/Scale Pricing Columns to Products
            try {
                const productInfo = await turso.execute(`PRAGMA table_info(products)`);
                const hasPriceRanges = productInfo.rows.some(col => col.name === 'price_ranges');
                const hasScaleGroupId = productInfo.rows.some(col => col.name === 'scale_group_id');
                const hasOriginalPrice = productInfo.rows.some(col => col.name === 'original_price');

                if (!hasPriceRanges) {
                    console.log('Adding price_ranges to products...');
                    await turso.execute(`ALTER TABLE products ADD COLUMN price_ranges TEXT`); // JSON string
                }
                if (!hasScaleGroupId) {
                    console.log('Adding scale_group_id to products...');
                    await turso.execute(`ALTER TABLE products ADD COLUMN scale_group_id TEXT`);
                }
                if (!hasOriginalPrice) {
                    console.log('Adding original_price to products...');
                    await turso.execute(`ALTER TABLE products ADD COLUMN original_price REAL`);
                }
            } catch (e) {
                console.warn("Migration error for products wholesale columns:", e);
            }

            // 9. Add Payment Tracking Columns to Purchases
            try {
                const purchasesInfo = await turso.execute(`PRAGMA table_info(purchases)`);
                const hasAmountPaid = purchasesInfo.rows.some(col => col.name === 'amount_paid');
                const hasPaymentDate = purchasesInfo.rows.some(col => col.name === 'payment_date');

                if (!hasAmountPaid) {
                    console.log('Adding amount_paid to purchases...');
                    await turso.execute(`ALTER TABLE purchases ADD COLUMN amount_paid REAL DEFAULT 0`);
                }
                if (!hasPaymentDate) {
                    console.log('Adding payment_date to purchases...');
                    await turso.execute(`ALTER TABLE purchases ADD COLUMN payment_date TEXT`);
                }
            } catch (e) {
                console.warn("Migration error for purchases payment columns:", e);
            }

            // 10. Enforce Unique Constraint on role_permissions (Fix for toggles)
            try {
                // 1. Delete duplicates, keeping the one with highest ID (latest)
                await turso.execute(`
                    DELETE FROM role_permissions 
                    WHERE id NOT IN (
                        SELECT MAX(id) 
                        FROM role_permissions 
                        GROUP BY company_id, role, permission
                    )
                `);

                // 2. Create Unique Index explicitely
                await turso.execute(`
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique 
                    ON role_permissions(company_id, role, permission)
                `);

                console.log("✅ Enforced unique constraint on role_permissions");
            } catch (e) {
                console.warn("Error enforcing unique constraint on role_permissions:", e);
            }

            // 6. Backfill User Permissions (Self-Healing)
            try {
                const users = await turso.execute("SELECT * FROM users");
                for (const user of users.rows) {
                    const targetCompanyId = user.company_id || 'default';

                    const permCheck = await turso.execute({
                        sql: "SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?",
                        args: [user.id, targetCompanyId]
                    });

                    if (permCheck.rows.length === 0) {
                        await turso.execute({
                            sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)",
                            args: [user.id, targetCompanyId, user.role || 'admin']
                        });
                        console.log(`Auto-linked user ${user.username} to ${targetCompanyId}`);
                    }
                }
            } catch (e) { console.warn("Backfill users error", e); }

            // ============================================
            // 🆕 TABLAS PARA SISTEMA DE SUSCRIPCIÓN
            // ============================================

            // 1. Tabla de planes de suscripción
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS subscription_plans (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    price DECIMAL(10,2) NOT NULL,
                    currency TEXT DEFAULT 'CLP',
                    frequency TEXT NOT NULL,
                    description TEXT,
                    features TEXT,
                    is_active INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Insertar planes predefinidos
            await turso.execute(`
                INSERT OR IGNORE INTO subscription_plans (id, name, price, currency, frequency, description, features)
                VALUES 
                ('monthly', 'Plan Mensual', 30000, 'CLP', 'monthly', 'Facturación mensual', '["Punto de venta completo","Gestión de inventario","Reportes en tiempo real","Múltiples usuarios","Soporte por email"]'),
                ('yearly', 'Plan Anual', 300000, 'CLP', 'yearly', 'Facturación anual - Ahorra $60,000', '["Todo lo del plan mensual","Ahorro de $60,000 al año","2 meses gratis","Soporte prioritario","Actualizaciones anticipadas"]')
            `);

            // 2. Tabla de suscripciones
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS subscriptions (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    mercadopago_subscription_id TEXT,
                    mercadopago_preapproval_id TEXT,
                    amount DECIMAL(10,2) NOT NULL,
                    currency TEXT DEFAULT 'CLP',
                    current_period_start DATE,
                    current_period_end DATE,
                    trial_end DATE,
                    cancelled_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (company_id) REFERENCES companies(id),
                    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
                )
            `);

            // 3. Tabla de pagos
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS payments (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    subscription_id TEXT,
                    amount DECIMAL(10,2) NOT NULL,
                    currency TEXT DEFAULT 'CLP',
                    status TEXT DEFAULT 'pending',
                    mercadopago_payment_id TEXT,
                    mercadopago_preference_id TEXT,
                    payment_method TEXT,
                    payment_type TEXT,
                    description TEXT,
                    payer_email TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (company_id) REFERENCES companies(id),
                    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
                )
            `);

            // 4. Modificar tabla companies para agregar campos de suscripción
            // Verificar si las columnas ya existen antes de agregarlas
            try {
                await turso.execute(`ALTER TABLE companies ADD COLUMN status TEXT DEFAULT 'pending_payment'`);
            } catch (e) {
                console.log('Column status already exists in companies');
            }

            try {
                await turso.execute(`ALTER TABLE companies ADD COLUMN subscription_id TEXT`);
            } catch (e) {
                console.log('Column subscription_id already exists in companies');
            }

            try {
                await turso.execute(`ALTER TABLE companies ADD COLUMN trial_ends_at DATE`);
            } catch (e) {
                console.log('Column trial_ends_at already exists in companies');
            }

            // 5. Crear índices para mejor performance
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id)`);
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`);
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id)`);
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status)`);

            console.log('✅ Subscription tables created successfully');

            // Migration 5: Preorder Bakery Columns (v5)
            if (currentVersion < 5) {
                console.log("Applying v5 (Preorder Bakery)...");
                try {
                    // Products: new preorder config columns
                    const prodInfo = await turso.execute(`PRAGMA table_info(products)`);
                    const prodCols = prodInfo.rows.map(r => r.name);
                    if (!prodCols.includes('preorder_billing_unit')) {
                        console.log('Adding preorder bakery columns to products...');
                        await turso.execute(`ALTER TABLE products ADD COLUMN preorder_billing_unit TEXT DEFAULT 'unit'`);
                        await turso.execute(`ALTER TABLE products ADD COLUMN preorder_price_per_kg REAL DEFAULT 0`);
                        await turso.execute(`ALTER TABLE products ADD COLUMN preorder_gram_per_unit REAL DEFAULT 0`);
                    }

                    // preorder_items: billing details + weight tracking
                    const piInfo = await turso.execute(`PRAGMA table_info(preorder_items)`);
                    const piCols = piInfo.rows.map(r => r.name);
                    if (!piCols.includes('billing_unit')) {
                        console.log('Adding bakery columns to preorder_items...');
                        await turso.execute(`ALTER TABLE preorder_items ADD COLUMN billing_unit TEXT DEFAULT 'unit'`);
                        await turso.execute(`ALTER TABLE preorder_items ADD COLUMN price_per_kg REAL DEFAULT 0`);
                        await turso.execute(`ALTER TABLE preorder_items ADD COLUMN gram_per_unit REAL DEFAULT 0`);
                        await turso.execute(`ALTER TABLE preorder_items ADD COLUMN estimated_total REAL DEFAULT 0`);
                        await turso.execute(`ALTER TABLE preorder_items ADD COLUMN real_weight_kg REAL`);
                        await turso.execute(`ALTER TABLE preorder_items ADD COLUMN real_total REAL`);
                    }

                    // preorders: estimated vs real totals
                    const poInfo = await turso.execute(`PRAGMA table_info(preorders)`);
                    const poCols = poInfo.rows.map(r => r.name);
                    if (!poCols.includes('estimated_total')) {
                        console.log('Adding estimated/real total to preorders...');
                        await turso.execute(`ALTER TABLE preorders ADD COLUMN estimated_total REAL DEFAULT 0`);
                        await turso.execute(`ALTER TABLE preorders ADD COLUMN real_total REAL`);
                    }

                    console.log('✅ Preorder bakery columns added');
                } catch (e) {
                    console.warn('Migration error for preorder bakery columns:', e);
                }
            }

            // Migration 6: Simplified Preorder Config (v6)
            if (currentVersion < 6) {
                console.log("Applying v6 (Preorder Base Price)...");
                const tableInfo = await turso.execute("PRAGMA table_info(products)");
                const columns = tableInfo.rows.map(r => r.name);
                if (!columns.includes('preorder_use_base_price')) {
                    await turso.execute("ALTER TABLE products ADD COLUMN preorder_use_base_price BOOLEAN DEFAULT 1");
                }
            }

            // Migration 7: Category Visibility (v7)
            if (currentVersion < 7) {
                console.log("Applying v7 (Category Visibility)...");
                const catInfo = await turso.execute("PRAGMA table_info(categories)");
                const catCols = catInfo.rows.map(r => r.name);
                if (!catCols.includes('show_in_preorders')) {
                    await turso.execute("ALTER TABLE categories ADD COLUMN show_in_preorders BOOLEAN DEFAULT 1");
                }
            }


            // Migration 8: Labor Management Phase 1 (v8)
            if (currentVersion < 8) {
                console.log("Applying v8 (Labor Management Phase 1)...");
                try {
                    // 1. Add columns to users table
                    const userInfo = await turso.execute("PRAGMA table_info(users)");
                    const userCols = userInfo.rows.map(r => r.name);

                    if (!userCols.includes('has_labor_profile')) {
                        console.log('Adding labor columns to users...');
                        // Ficha laboral básica
                        await turso.execute("ALTER TABLE users ADD COLUMN has_labor_profile INTEGER DEFAULT 0");
                        await turso.execute("ALTER TABLE users ADD COLUMN labor_position TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN labor_branch TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN labor_start_date TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN labor_status TEXT DEFAULT 'active'");
                        await turso.execute("ALTER TABLE users ADD COLUMN labor_pin TEXT");

                        // Configuración de pago
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_type TEXT DEFAULT 'monthly'");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_method TEXT DEFAULT 'cash'");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_day TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_base_amount REAL DEFAULT 0");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_fixed_bonus REAL DEFAULT 0");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_fixed_discount REAL DEFAULT 0");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_bank_name TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_bank_account TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_bank_account_type TEXT");
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_bank_owner TEXT");
                    }

                    // 2. Create New Tables for Labor Management

                    // Marcaciones de asistencia
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS attendance_records (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            recorded_at TEXT NOT NULL,
                            date TEXT NOT NULL,
                            source TEXT DEFAULT 'kiosk',
                            device_label TEXT,
                            branch TEXT,
                            recorded_by INTEGER,
                            notes TEXT,
                            is_corrected INTEGER DEFAULT 0,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_attendance_company_date ON attendance_records(company_id, date)");
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id, date)");

                    // Solicitudes de corrección de asistencia
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS attendance_corrections (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            original_record_id INTEGER,
                            correction_type TEXT NOT NULL,
                            original_at TEXT,
                            requested_at TEXT,
                            requested_date TEXT NOT NULL,
                            reason TEXT NOT NULL,
                            status TEXT DEFAULT 'pending',
                            reviewed_by INTEGER,
                            reviewed_at TEXT,
                            reviewer_notes TEXT,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_corrections_company_status ON attendance_corrections(company_id, status)");

                    // Turnos planificados
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS work_shifts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            shift_date TEXT NOT NULL,
                            start_time TEXT NOT NULL,
                            end_time TEXT NOT NULL,
                            branch TEXT,
                            notes TEXT,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            UNIQUE(user_id, shift_date)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_shifts_company_date ON work_shifts(company_id, shift_date)");

                    // Ausencias/permisos laborales
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS labor_absences (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            absence_date TEXT NOT NULL,
                            type TEXT NOT NULL,
                            status TEXT DEFAULT 'approved',
                            notes TEXT,
                            approved_by INTEGER,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_absences_company_date ON labor_absences(company_id, absence_date)");
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_absences_user ON labor_absences(user_id, absence_date)");

                    // Migration: add half_day, half_day_period, hours, group_id columns
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN half_day INTEGER DEFAULT 0"); } catch (_) { /* already exists */ }
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN half_day_period TEXT DEFAULT NULL"); } catch (_) { /* already exists */ }
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN hours REAL DEFAULT NULL"); } catch (_) { /* already exists */ }
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN group_id TEXT DEFAULT NULL"); } catch (_) { /* already exists */ }

                    // Migration: pay_hourly_rate for mixed pay type
                    try {
                        await turso.execute("ALTER TABLE users ADD COLUMN pay_hourly_rate REAL DEFAULT 0");
                    } catch (_) { /* column already exists */ }

                    // Configuración de Personal por empresa
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS personal_config (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL UNIQUE,
                            late_tolerance_minutes INTEGER DEFAULT 10,
                            kiosk_device_label TEXT DEFAULT 'Kiosco Principal',
                            created_at TEXT,
                            updated_at TEXT
                        )
                    `);

                    // Migration: payroll config columns in personal_config
                    try {
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN late_discount_enabled INTEGER DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN late_discount_per_minute REAL DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN absence_discount_enabled INTEGER DEFAULT 1");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN vacation_paid INTEGER DEFAULT 1");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN medical_paid INTEGER DEFAULT 1");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN permission_paid INTEGER DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN bonus_punctuality_enabled INTEGER DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN bonus_punctuality_amount REAL DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN bonus_attendance_enabled INTEGER DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN bonus_attendance_amount REAL DEFAULT 0");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN working_days_per_month INTEGER DEFAULT 30");
                        await turso.execute("ALTER TABLE personal_config ADD COLUMN working_hours_per_day REAL DEFAULT 8");
                    } catch (_) { /* columns already exist */ }

                    // Adelantos/anticipos
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS salary_advances (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            amount REAL NOT NULL,
                            advance_date TEXT NOT NULL,
                            reason TEXT,
                            pay_method TEXT DEFAULT 'cash',
                            status TEXT DEFAULT 'pending',
                            period_id INTEGER,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_advances_company_user ON salary_advances(company_id, user_id)");

                    // Liquidaciones de periodo
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS payroll_periods (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            period_label TEXT NOT NULL,
                            period_start TEXT NOT NULL,
                            period_end TEXT NOT NULL,
                            hours_worked REAL DEFAULT 0,
                            days_absent INTEGER DEFAULT 0,
                            late_count INTEGER DEFAULT 0,
                            late_minutes INTEGER DEFAULT 0,
                            extra_hours REAL DEFAULT 0,
                            manual_bonus REAL DEFAULT 0,
                            manual_discount REAL DEFAULT 0,
                            advances_discounted REAL DEFAULT 0,
                            base_amount REAL DEFAULT 0,
                            total_to_pay REAL DEFAULT 0,
                            is_closed INTEGER DEFAULT 0,
                            notes TEXT,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            closed_at TEXT,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_payroll_company_user ON payroll_periods(company_id, user_id)");

                    // Pagos realizados (registro de pago real)
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS payroll_payments (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            period_id INTEGER,
                            amount_paid REAL NOT NULL,
                            payment_date TEXT NOT NULL,
                            pay_method TEXT DEFAULT 'cash',
                            status TEXT DEFAULT 'paid',
                            notes TEXT,
                            created_by INTEGER,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_payments_company ON payroll_payments(company_id, payment_date)");

                    // Vacaciones: saldos
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS vacation_balances (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL UNIQUE,
                            initial_balance REAL DEFAULT 0,
                            accrued_days REAL DEFAULT 0,
                            used_days REAL DEFAULT 0,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);

                    // Vacaciones: solicitudes
                    await turso.execute(`
                        CREATE TABLE IF NOT EXISTS vacation_requests (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            start_date TEXT NOT NULL,
                            end_date TEXT NOT NULL,
                            total_days INTEGER NOT NULL,
                            status TEXT DEFAULT 'pending',
                            notes TEXT,
                            reviewed_by INTEGER,
                            reviewed_at TEXT,
                            created_at TEXT NOT NULL,
                            FOREIGN KEY (user_id) REFERENCES users(id)
                        )
                    `);
                    await turso.execute("CREATE INDEX IF NOT EXISTS idx_vacations_company ON vacation_requests(company_id, start_date)");

                    console.log('✅ Labor Management Phase 1 tables created');
                } catch (e) {
                    console.warn('Migration error for Labor Management Phase 1:', e);
                }
            }

            // Migration 9: Units per box (v9)
            if (currentVersion < 9) {
                console.log("Applying v9 (Units per box)...");
                const prodInfo = await turso.execute("PRAGMA table_info(products)");
                const prodCols = prodInfo.rows.map(r => r.name);
                if (!prodCols.includes('units_per_box')) {
                    await turso.execute("ALTER TABLE products ADD COLUMN units_per_box INTEGER DEFAULT 0");
                }
            }

            // UPDATE VERSION
            await turso.execute({
                sql: "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('schema_version', ?)",
                args: [TARGET_VERSION.toString()]
            });


            // ============================================
            // 🔐 ROLE PERMISSIONS TABLE (with schema validation)
            // ============================================
            // ============================================
            // 🔐 FIX: Recrear role_permissions con schema correcto
            // ============================================
            try {
                const rpInfo = await turso.execute("PRAGMA table_info(role_permissions)");
                const rpColumns = rpInfo.rows.map(r => r.name);
                if (rpInfo.rows.length === 0 || !rpColumns.includes('permission')) {
                    console.log("🔄 Fixing role_permissions table schema...");
                    await turso.execute("DROP TABLE IF EXISTS role_permissions");
                }
            } catch (e) { console.warn("PRAGMA check error:", e); }

            await turso.execute(`
                CREATE TABLE IF NOT EXISTS role_permissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    permission TEXT NOT NULL,
                    granted INTEGER DEFAULT 1,
                    UNIQUE(company_id, role, permission)
                )
            `);

            // ============================================
            // 🎭 CUSTOM ROLES TABLE (with schema validation)
            // ============================================
            // ============================================
            // 🎭 CUSTOM ROLES TABLE (with schema validation)
            // ============================================
            try {
                const crInfo = await turso.execute("PRAGMA table_info(custom_roles)");
                const crColumns = crInfo.rows.map(r => r.name);
                if (crInfo.rows.length === 0 || !crColumns.includes('role_name')) {
                    console.log("🔄 Fixing custom_roles table schema...");
                    await turso.execute("DROP TABLE IF EXISTS custom_roles");
                }
            } catch (e) { console.warn("PRAGMA check error:", e); }

            await turso.execute(`
                CREATE TABLE IF NOT EXISTS custom_roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    role_name TEXT NOT NULL,
                    description TEXT,
                    color TEXT DEFAULT '#6366f1',
                    is_system INTEGER DEFAULT 0,
                    created_at TEXT,
                    UNIQUE(company_id, role_name)
                )
            `);

            // Seed Permissions if needed
            await get().setupDefaultPermissions();

            // ============================================
            // 🏷️ COMPANY MODULES TABLE (Feature Flags)
            // ============================================
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS company_modules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    module_key TEXT NOT NULL,
                    enabled INTEGER DEFAULT 1,
                    updated_at TEXT,
                    UNIQUE(company_id, module_key)
                )
            `);

            // ============================================
            // 🔄 SALE RETURNS TABLE (Devoluciones)
            // ============================================
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS sale_returns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    sale_id INTEGER NOT NULL,
                    user_id INTEGER,
                    reason TEXT NOT NULL,
                    items TEXT NOT NULL,
                    total REAL NOT NULL,
                    created_at TEXT NOT NULL
                )
            `);
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id, company_id)`);
            await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sale_returns_company ON sale_returns(company_id, created_at DESC)`);

            // === Migration 16: Credit management system ===
            try {
                const clientInfo = await turso.execute(`PRAGMA table_info(clients)`);
                const hasCreditLimit = clientInfo.rows.some(col => col.name === 'credit_limit');
                if (!hasCreditLimit) {
                    console.log('Adding credit management columns to clients...');
                    await turso.execute(`ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0`);
                    await turso.execute(`ALTER TABLE clients ADD COLUMN credit_period_days INTEGER DEFAULT 30`);
                    await turso.execute(`ALTER TABLE clients ADD COLUMN credit_enabled INTEGER DEFAULT 1`);
                    await turso.execute(`ALTER TABLE clients ADD COLUMN client_status TEXT DEFAULT 'active'`);
                }
                const salesInfo = await turso.execute(`PRAGMA table_info(sales)`);
                const hasDueDate = salesInfo.rows.some(col => col.name === 'payment_due_date');
                if (!hasDueDate) {
                    console.log('Adding payment_due_date to sales...');
                    await turso.execute(`ALTER TABLE sales ADD COLUMN payment_due_date TEXT`);
                }
                const companyInfo16 = await turso.execute(`PRAGMA table_info(companies)`);
                const hasCreditBlockMode = companyInfo16.rows.some(col => col.name === 'credit_block_mode');
                if (!hasCreditBlockMode) {
                    console.log('Adding credit_block_mode to companies...');
                    await turso.execute(`ALTER TABLE companies ADD COLUMN credit_block_mode TEXT DEFAULT 'warn'`);
                }
            } catch (e) {
                console.warn('Migration 16 (credit management) error:', e);
            }

            // === Migration 17: Partial payments support ===
            try {
                const salesInfo17 = await turso.execute(`PRAGMA table_info(sales)`);
                const hasAmountPaid = salesInfo17.rows.some(col => col.name === 'amount_paid');
                if (!hasAmountPaid) {
                    console.log('Adding amount_paid to sales for partial payments...');
                    await turso.execute(`ALTER TABLE sales ADD COLUMN amount_paid REAL DEFAULT 0`);
                }
            } catch (e) {
                console.warn('Migration 17 (partial payments) error:', e);
            }

            // === Migration 18: Preventas + Renombrar Vendedor → Caja ===
            try {
                // 18a: Crear tabla preventas
                await turso.execute(`CREATE TABLE IF NOT EXISTS preventas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    code TEXT NOT NULL,
                    items TEXT NOT NULL,
                    client_data TEXT,
                    total REAL NOT NULL DEFAULT 0,
                    created_by INTEGER,
                    created_by_name TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    completed_by INTEGER,
                    completed_at TEXT,
                    sale_id INTEGER,
                    created_at TEXT NOT NULL,
                    UNIQUE(company_id, code)
                )`);

                // 18b: Renombrar rol "Vendedor" → "Caja" en permisos y asignaciones
                const hasOldVendedor = await turso.execute(`SELECT COUNT(*) as c FROM role_permissions WHERE role = 'Vendedor' LIMIT 1`);
                if (Number(hasOldVendedor.rows[0]?.c) > 0) {
                    // Check that 'Caja' role doesn't already exist to avoid conflicts
                    const hasCaja = await turso.execute(`SELECT COUNT(*) as c FROM role_permissions WHERE role = 'Caja' LIMIT 1`);
                    if (Number(hasCaja.rows[0]?.c) === 0) {
                        console.log('Renaming role Vendedor → Caja...');
                        await turso.execute(`UPDATE role_permissions SET role = 'Caja' WHERE role = 'Vendedor'`);
                        await turso.execute(`UPDATE user_companies SET role = 'Caja' WHERE role = 'Vendedor'`);
                    }
                }

                // 18c: Seed new "Vendedor" role permissions for existing companies
                // (Only if the new Vendedor doesn't exist yet in role_permissions)
                const hasNewVendedor = await turso.execute(`SELECT COUNT(*) as c FROM role_permissions WHERE role = 'Vendedor' LIMIT 1`);
                if (Number(hasNewVendedor.rows[0]?.c) === 0) {
                    // Get all companies that have role_permissions
                    const companies = await turso.execute(`SELECT DISTINCT company_id FROM role_permissions`);
                    const vendedorPerms = [
                        'dashboard.view', 'pos.access', 'pos.preventa',
                        'clients.view', 'clients.create',
                        'personal.view', 'personal.attendance',
                        'alerts.view'
                    ];
                    for (const row of companies.rows) {
                        for (const p of vendedorPerms) {
                            await turso.execute({
                                sql: `INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, 'Vendedor', ?, 1)`,
                                args: [row.company_id, p]
                            });
                        }
                    }
                    // Also add pos.scan_preventa to Caja for existing companies
                    for (const row of companies.rows) {
                        await turso.execute({
                            sql: `INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, 'Caja', 'pos.scan_preventa', 1)`,
                            args: [row.company_id]
                        });
                    }
                }
            } catch (e) {
                console.warn('Migration 18 (preventas + roles) error:', e);
            }

            // === Migration 19: Preventa ticket config columns ===
            try {
                const compInfo19 = await turso.execute(`PRAGMA table_info(companies)`);
                const cols19 = compInfo19.rows.map(c => c.name);
                if (!cols19.includes('preventa_business_name')) {
                    console.log('Adding preventa config columns to companies...');
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_business_name TEXT DEFAULT ''`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_address TEXT DEFAULT ''`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_phone TEXT DEFAULT ''`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_header_message TEXT DEFAULT ''`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_footer_message TEXT DEFAULT ''`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_show_phone INTEGER DEFAULT 1`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_show_address INTEGER DEFAULT 1`);
                    console.log('✅ Preventa config columns added');
                }
            } catch (e) {
                console.warn('Migration 19 (preventa config) error:', e);
            }

            // === Migration 20: Print format columns ===
            try {
                const compInfo20 = await turso.execute(`PRAGMA table_info(companies)`);
                const cols20 = compInfo20.rows.map(c => c.name);
                if (!cols20.includes('receipt_format')) {
                    console.log('Adding print format columns to companies...');
                    await turso.execute(`ALTER TABLE companies ADD COLUMN receipt_format TEXT DEFAULT '58mm'`);
                    await turso.execute(`ALTER TABLE companies ADD COLUMN preventa_format TEXT DEFAULT '80mm'`);
                    console.log('✅ Print format columns added');
                }
            } catch (e) {
                console.warn('Migration 20 (print format) error:', e);
            }

            console.log("SaaS Migrations Completed.");

        } catch (e) {
            console.error("Migration Fatal Error:", e);
        }
    },

    // Clients State & Actions
    clients: [],
    // setPosSelectedClient is defined below in the multi-cart section (L3641+)

    addClient: async (client) => {
        try {
            // Validación: RUT único por empresa. En Chile el RUT identifica a la
            // persona, así que dos clientes con el mismo RUT = la misma persona
            // (deuda/historial/match con miniveci se romperían si se duplica).
            // Comparación insensible al formato (con/sin puntos, may/min).
            // Clientes SIN RUT sí se permiten (cliente casual).
            const rutClean = cleanRut(client.rut);
            if (rutClean) {
                const dup = get().clients.find(c => c.rut && cleanRut(c.rut) === rutClean);
                if (dup) {
                    return {
                        success: false,
                        error: 'RUT_DUPLICATE',
                        message: `Ya existe un cliente con ese RUT: ${dup.name}`,
                        existingClientId: dup.id,
                        existingClientName: dup.name,
                    };
                }
            }

            const result = await turso.execute({
                sql: "INSERT INTO clients (name, rut, phone, email, address, razon_social, giro, comuna, ciudad, created_at, company_id, credit_limit, credit_period_days, credit_enabled, client_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    client.name,
                    client.rut || '',
                    client.phone || '',
                    client.email || '',
                    client.address || '',
                    client.razon_social || '',
                    client.giro || '',
                    client.comuna || '',
                    client.ciudad || '',
                    new Date().toISOString(),
                    get().activeCompanyId,
                    client.credit_limit || 0,
                    client.credit_period_days || 30,
                    client.credit_enabled !== undefined ? (client.credit_enabled ? 1 : 0) : 1,
                    client.client_status || 'active'
                ]
            });
            const newClient = result.rows[0];

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [get().activeCompanyId, get().currentUser?.id, 'CREATE', 'CLIENT', JSON.stringify({ name: client.name }), new Date().toISOString()]
            });

            set((state) => ({ clients: [...state.clients, newClient].sort((a, b) => a.name.localeCompare(b.name)) }));
            return { success: true, client: newClient };
        } catch (e) {
            console.error("Add client error", e);
            return { success: false, error: e.message };
        }
    },

    updateClient: async (id, updatedClient) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // RUT único por empresa (excluyendo el propio cliente que se edita).
            const rutClean = cleanRut(updatedClient.rut);
            if (rutClean) {
                const dup = get().clients.find(c => c.id !== id && c.rut && cleanRut(c.rut) === rutClean);
                if (dup) {
                    return {
                        success: false,
                        error: 'RUT_DUPLICATE',
                        message: `Ya existe otro cliente con ese RUT: ${dup.name}`,
                        existingClientId: dup.id,
                        existingClientName: dup.name,
                    };
                }
            }

            await turso.execute({
                sql: "UPDATE clients SET name = ?, rut = ?, phone = ?, email = ?, address = ?, razon_social = ?, giro = ?, comuna = ?, ciudad = ?, credit_limit = ?, credit_period_days = ?, credit_enabled = ?, client_status = ? WHERE id = ? AND company_id = ?",
                args: [updatedClient.name, updatedClient.rut, updatedClient.phone, updatedClient.email, updatedClient.address, updatedClient.razon_social || '', updatedClient.giro || '', updatedClient.comuna || '', updatedClient.ciudad || '', updatedClient.credit_limit || 0, updatedClient.credit_period_days || 30, updatedClient.credit_enabled !== undefined ? (updatedClient.credit_enabled ? 1 : 0) : 1, updatedClient.client_status || 'active', id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'UPDATE', 'CLIENT', JSON.stringify({ id, updates: updatedClient }), new Date().toISOString()]
            });

            set((state) => ({
                clients: state.clients.map((c) => c.id === id ? { ...c, ...updatedClient } : c).sort((a, b) => a.name.localeCompare(b.name))
            }));
            return { success: true };
        } catch (e) {
            console.error("Update client error", e);
            return { success: false, error: e.message };
        }
    },

    deleteClient: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            await turso.execute({
                sql: "DELETE FROM clients WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'CLIENT', JSON.stringify({ id }), new Date().toISOString()]
            });

            set((state) => ({
                clients: state.clients.filter((c) => c.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete client error", e);
            return { success: false, error: e.message };
        }
    },



    // Actions
    fetchUserCompanies: async (userId) => {
        try {
            const res = await turso.execute({
                sql: `
                    SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, c.currency, c.credit_block_mode, uc.role 
                    FROM user_companies uc
                    JOIN companies c ON uc.company_id = c.id
                    WHERE uc.user_id = ? AND c.status = 'active'
                `,
                args: [userId]
            });
            set({ availableCompanies: res.rows });
            return res.rows;
        } catch (e) {
            console.error("Fetch user companies error", e);
            return [];
        }
    },

    setActiveCompanyId: async (companyId) => {
        const { currentUser, availableCompanies, fetchInitialData, activeCompanyId: previousCompanyId } = get();

        // Validate
        const targetCompany = availableCompanies.find(c => c.id === companyId);
        if (!targetCompany) {
            console.error("Attempted to switch to invalid company", companyId);
            return { success: false, error: "Invalid Company" };
        }

        // OFFLINE: bloquear cambio de empresa porque no podemos descargar
        // el catálogo de la empresa nueva. Solo permitir si es la misma empresa.
        if (typeof navigator !== 'undefined' && !navigator.onLine && companyId !== previousCompanyId) {
            console.warn("Cannot switch company while offline");
            return {
                success: false,
                error: 'Sin conexión a internet. Para cambiar de empresa necesitas conexión.'
            };
        }

        console.log("Switching to company:", companyId);

        // Purgar catálogo local de la empresa ANTERIOR (si era distinta) para
        // evitar acumular datos en IndexedDB y mezclar empresas.
        if (previousCompanyId && previousCompanyId !== companyId) {
            try {
                await purgeCompanyData(previousCompanyId);
                console.log('🧹 Catálogo local de empresa anterior purgado:', previousCompanyId);
            } catch (e) {
                console.warn('No se pudo purgar catálogo local previo:', e);
            }
        }

        // CLEAR STATE IMMEDIATELY to prevent data bleeding
        set({
            isLoading: true,
            activeCompanyId: companyId,
            // Load inventory mode from target company
            inventoryAdjustmentMode: targetCompany.inventory_adjustment_mode === 1,
            creditBlockMode: targetCompany.credit_block_mode || 'warn',
            // Clear all data lists
            products: [],
            productLots: [],
            categories: [],
            suppliers: [],
            users: [],
            rolePermissions: [], // 🔒 Permissions State
            companyModules: [], // 🏷️ Clear feature flags
            clients: [],
            purchases: [],
            sales: [],
            // Clear Dashboard/POS specific state
            // Clear Dashboard/POS specific state
            cashRegister: null, // Critical: Reset cash register
            activeRegisters: [],
            posSelectedClient: null,
            // Reset Multi-Cart System
            carts: [
                {
                    id: 1,
                    name: 'Ticket 1',
                    items: [],
                    client: null,
                    createdAt: Date.now()
                }
            ],
            activeCartId: 1,
            nextCartId: 2
        });

        if (currentUser) {
            localStorage.setItem(`activeCompanyId:${currentUser.id}`, companyId);
        }

        // Reload data (incluye permisos y módulos en el batch)
        await fetchInitialData();

        // Sincronizar catálogo a IndexedDB local en background (no bloquear UI).
        // Esto permite que el POS funcione offline si se cae internet más tarde.
        if (typeof navigator !== 'undefined' && navigator.onLine) {
            syncCatalogFromServer(companyId).catch((e) =>
                console.warn('[sync] catálogo background falló:', e)
            );
        }

        // After data load, check if this user has an open register in the NEW company
        // We need to fetch this explicitly because fetchInitialData might not set cashRegister
        const { checkRegisterStatus } = get();
        if (currentUser) {
            await checkRegisterStatus(currentUser.id);
        }

        set({ isLoading: false });
        return { success: true };
    },

    fetchInitialData: async () => {
        if (fetchInProgress) {
            console.log('⚠️ fetchInitialData already in progress, skipping duplicate call');
            return;
        }
        fetchInProgress = true;
        console.time('⏱️ fetchInitialData');
        set({ isLoading: true, error: null });

        // ============================================
        // 📴 BOOTSTRAP OFFLINE
        // ============================================
        // Si no hay internet, leer el catálogo desde Dexie en lugar de Turso.
        // Esto permite que el POS funcione tras refrescar la pestaña sin red.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            try {
                const { activeCompanyId } = get();
                if (activeCompanyId) {
                    console.log('📴 Sin internet — cargando catálogo desde IndexedDB...');
                    const [products, productLots, clients, categories, taxRates] = await Promise.all([
                        localDb.products.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.productLots.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.clients.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.categories.where('companyId').equals(activeCompanyId).toArray(),
                        localDb.taxRates.where('companyId').equals(activeCompanyId).toArray(),
                    ]);
                    const pendingCount = await pendingOpsApi.count(activeCompanyId, 'queued');
                    set({
                        products,
                        productLots,
                        clients,
                        categories,
                        taxRates,
                        pendingSalesCount: pendingCount,
                        isLoading: false,
                    });
                    console.log(`📴 Catálogo offline cargado: ${products.length} productos, ${clients.length} clientes`);
                } else {
                    set({ isLoading: false });
                }
            } catch (e) {
                console.error('❌ Error bootstrap offline:', e);
                set({ isLoading: false, error: 'No se pudo cargar catálogo offline' });
            } finally {
                fetchInProgress = false;
                console.timeEnd('⏱️ fetchInitialData');
            }
            return;
        }

        try {
            console.log('📊 fetchInitialData START');

            // RUN MIGRATIONS & BACKFILL — skip if already done this session or cached in localStorage
            if (!migrationsExecuted) {
                const cachedDDL = localStorage.getItem(DDL_CACHE_KEY);
                if (cachedDDL === String(DDL_TARGET)) {
                    // DDL/migrations already ran in a previous session, skip
                    migrationsExecuted = true;
                    console.log('✅ DDL cached in localStorage (v' + DDL_TARGET + '), skipping migrations');
                } else {
                    // Quick check: is schema already up to date? (single SELECT, no DDL)
                    let schemaOk = false;
                    try {
                        const vRes = await turso.execute("SELECT value FROM system_settings WHERE key = 'schema_version'");
                        const dbVersion = vRes.rows.length > 0 ? parseInt(vRes.rows[0].value) : 0;
                        if (dbVersion >= 8) {
                            schemaOk = true;
                            console.log('✅ Schema already at v' + dbVersion + ', skipping heavy DDL');
                        }
                    } catch (e) {
                        // system_settings table might not exist yet → need full migration
                        console.log('⚠️ Schema check failed, will run full migrations:', e.message);
                    }

                    if (schemaOk) {
                        // Schema is up to date — all tables exist, skip ALL DDL
                        console.log('✅ All tables exist (v8+), going straight to data fetch');
                    } else {
                        // Full migration path — only runs on brand new databases
                        console.time('⏱️ _runMigrations');
                        await get()._runMigrations();
                        console.timeEnd('⏱️ _runMigrations');

                        // Heavy DDL for extra tables
                        await turso.execute(`CREATE TABLE IF NOT EXISTS product_lots (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            product_id INTEGER, batch_number TEXT, expiry_date TEXT,
                            quantity REAL, cost REAL, supplier_name TEXT, created_at TEXT,
                            status TEXT DEFAULT 'active', company_id TEXT DEFAULT 'default'
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS clients (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            name TEXT NOT NULL, rut TEXT, phone TEXT, email TEXT,
                            address TEXT, created_at TEXT
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS supplier_orders (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT, user_id TEXT, supplier_id INTEGER,
                            supplier_name TEXT, seller_name TEXT, total_amount REAL,
                            items TEXT, status TEXT DEFAULT 'pending', created_at TEXT,
                            expected_delivery_date TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS payment_methods_config (
                            company_id TEXT PRIMARY KEY,
                            cash_enabled INTEGER DEFAULT 1, card_enabled INTEGER DEFAULT 1,
                            transfer_enabled INTEGER DEFAULT 1, credit_enabled INTEGER DEFAULT 1,
                            mixed_enabled INTEGER DEFAULT 1,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS payment_terminals (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT, name TEXT, color TEXT DEFAULT '#3B82F6',
                            is_active INTEGER DEFAULT 1, created_at TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS bank_accounts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT, bank_name TEXT, account_number TEXT,
                            account_type TEXT, owner_name TEXT, rut TEXT, email TEXT,
                            is_active INTEGER DEFAULT 1, created_at TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS inventory_losses (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT, lot_id INTEGER, product_id INTEGER,
                            product_name TEXT, product_sku TEXT, batch_number TEXT,
                            expiry_date TEXT, quantity REAL, cost_per_unit REAL,
                            total_loss REAL, reason TEXT DEFAULT 'expired',
                            notes TEXT, user_id TEXT, created_at TEXT
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS stock_adjustments (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            product_id INTEGER NOT NULL,
                            user_id INTEGER,
                            user_name TEXT,
                            old_stock REAL NOT NULL,
                            new_stock REAL NOT NULL,
                            difference REAL NOT NULL,
                            reason TEXT DEFAULT 'manual',
                            created_at TEXT NOT NULL
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_stock_adj_product ON stock_adjustments(company_id, product_id)`);

                        // ── Inventory Control (Stock Take) ──
                        await turso.execute(`CREATE TABLE IF NOT EXISTS inventory_controls (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            user_name TEXT,
                            name TEXT NOT NULL,
                            type TEXT NOT NULL DEFAULT 'free',
                            category TEXT,
                            status TEXT DEFAULT 'in_progress',
                            total_products INTEGER DEFAULT 0,
                            counted_products INTEGER DEFAULT 0,
                            notes TEXT,
                            started_at TEXT NOT NULL,
                            completed_at TEXT,
                            created_at TEXT
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_inv_ctrl_company_status ON inventory_controls(company_id, status)`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS inventory_control_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            control_id INTEGER NOT NULL,
                            product_id INTEGER NOT NULL,
                            product_name TEXT NOT NULL,
                            product_sku TEXT,
                            system_stock REAL NOT NULL,
                            counted_stock REAL NOT NULL,
                            difference REAL NOT NULL,
                            cost REAL DEFAULT 0,
                            counted_at TEXT NOT NULL,
                            updated_at TEXT,
                            UNIQUE(control_id, product_id)
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_inv_ctrl_items_ctrl ON inventory_control_items(control_id)`);

                        // Column checks
                        const plInfo = await turso.execute("PRAGMA table_info(product_lots)");
                        const suppInfo = await turso.execute("PRAGMA table_info(suppliers)");
                        const plCols = plInfo.rows.map(r => r.name);
                        const suppCols = suppInfo.rows.map(r => r.name);

                        if (!plCols.includes('purchase_id')) {
                            try { await turso.execute('ALTER TABLE product_lots ADD COLUMN purchase_id INTEGER'); } catch(e) {}
                        }
                        if (!plCols.includes('initial_quantity')) {
                            try { await turso.execute('ALTER TABLE product_lots ADD COLUMN initial_quantity REAL'); } catch(e) {}
                        }
                        if (!suppCols.includes('seller_name')) {
                            try {
                                await turso.execute('ALTER TABLE suppliers ADD COLUMN seller_name TEXT');
                                await turso.execute('ALTER TABLE suppliers ADD COLUMN order_days TEXT');
                                await turso.execute('ALTER TABLE suppliers ADD COLUMN delivery_days TEXT');
                            } catch(e) {}
                        }

                        // Backfills
                        if (!plCols.includes('purchase_id')) {
                            try {
                                await turso.execute(`
                                    UPDATE product_lots SET purchase_id = (
                                        SELECT pu.id FROM purchases pu
                                        WHERE pu.company_id = product_lots.company_id
                                          AND pu.supplier_name = product_lots.supplier_name
                                          AND DATE(pu.date) = DATE(product_lots.created_at)
                                        ORDER BY pu.id DESC LIMIT 1
                                    ) WHERE purchase_id IS NULL
                                `);
                            } catch (e) { console.warn('Backfill purchase_id skipped:', e.message); }
                        }
                        if (!plCols.includes('initial_quantity')) {
                            try {
                                await turso.execute('UPDATE product_lots SET initial_quantity = quantity WHERE initial_quantity IS NULL');
                            } catch (e) { console.warn('Backfill initial_quantity skipped:', e.message); }
                        }

                        // One-time migration: fix initial_quantity from purchase JSON
                        try {
                            const marker = await turso.execute("SELECT COUNT(*) as c FROM audit_logs WHERE action = 'MIGRATION_FIX_INITIAL_QTY'");
                            if ((marker.rows[0]?.c || 0) === 0) {
                                const lotsWithPurchase = await turso.execute(
                                    `SELECT pl.id as lot_id, pl.product_id, pl.purchase_id, pu.items as items_json
                                     FROM product_lots pl
                                     JOIN purchases pu ON pl.purchase_id = pu.id
                                     WHERE pl.purchase_id IS NOT NULL`
                                );
                                let fixed = 0;
                                for (const row of lotsWithPurchase.rows) {
                                    try {
                                        const items = JSON.parse(row.items_json || '[]');
                                        const matchItem = items.find(i => String(i.id) === String(row.product_id));
                                        if (matchItem && matchItem.quantity) {
                                            await turso.execute({
                                                sql: 'UPDATE product_lots SET initial_quantity = ? WHERE id = ?',
                                                args: [matchItem.quantity, row.lot_id]
                                            });
                                            fixed++;
                                        }
                                    } catch (_) { /* skip malformed JSON */ }
                                }
                                await turso.execute({
                                    sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, NULL, 'MIGRATION_FIX_INITIAL_QTY', 'SYSTEM', ?, ?)",
                                    args: ['system', JSON.stringify({ fixed }), new Date().toISOString()]
                                });
                                console.log(`Migration: Fixed initial_quantity for ${fixed} lots`);
                            }
                        } catch (e) {
                            console.warn('Fix initial_quantity migration skipped:', e.message);
                        }
                    }

                    // ── Always-run DDL: add missing columns to labor_absences ──
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN half_day INTEGER DEFAULT 0"); } catch (_) { /* already exists */ }
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN half_day_period TEXT DEFAULT NULL"); } catch (_) { /* already exists */ }
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN hours REAL DEFAULT NULL"); } catch (_) { /* already exists */ }
                    try { await turso.execute("ALTER TABLE labor_absences ADD COLUMN group_id TEXT DEFAULT NULL"); } catch (_) { /* already exists */ }

                    // ── Always-run DDL for new tables (safe with IF NOT EXISTS) ──
                    try {
                        await turso.execute(`CREATE TABLE IF NOT EXISTS inventory_controls (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            user_id INTEGER NOT NULL,
                            user_name TEXT,
                            name TEXT NOT NULL,
                            type TEXT NOT NULL DEFAULT 'free',
                            category TEXT,
                            status TEXT DEFAULT 'in_progress',
                            total_products INTEGER DEFAULT 0,
                            counted_products INTEGER DEFAULT 0,
                            notes TEXT,
                            started_at TEXT NOT NULL,
                            completed_at TEXT,
                            created_at TEXT
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_inv_ctrl_company_status ON inventory_controls(company_id, status)`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS inventory_control_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            control_id INTEGER NOT NULL,
                            product_id INTEGER NOT NULL,
                            product_name TEXT NOT NULL,
                            product_sku TEXT,
                            system_stock REAL NOT NULL,
                            counted_stock REAL NOT NULL,
                            difference REAL NOT NULL,
                            cost REAL DEFAULT 0,
                            counted_at TEXT NOT NULL,
                            updated_at TEXT,
                            UNIQUE(control_id, product_id)
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_inv_ctrl_items_ctrl ON inventory_control_items(control_id)`);
                    } catch (e) {
                        console.warn('Inventory control tables creation skipped:', e.message);
                    }

                    // ── Combos / Packs tables ──
                    try {
                        await turso.execute(`CREATE TABLE IF NOT EXISTS product_combos (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            name TEXT NOT NULL,
                            sku TEXT,
                            price REAL NOT NULL,
                            cost REAL DEFAULT 0,
                            image TEXT,
                            description TEXT,
                            is_active INTEGER DEFAULT 1,
                            has_dates INTEGER DEFAULT 0,
                            start_date TEXT,
                            end_date TEXT,
                            tax_rate REAL DEFAULT 0,
                            created_at TEXT,
                            updated_at TEXT
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_combos_company_active ON product_combos(company_id, is_active)`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS product_combo_items (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            combo_id INTEGER NOT NULL,
                            product_id INTEGER NOT NULL,
                            product_name TEXT NOT NULL,
                            product_sku TEXT,
                            quantity REAL NOT NULL DEFAULT 1,
                            cost REAL DEFAULT 0,
                            FOREIGN KEY(combo_id) REFERENCES product_combos(id) ON DELETE CASCADE
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON product_combo_items(combo_id)`);
                    } catch (e) {
                        console.warn('Combo tables creation skipped:', e.message);
                    }

                    // ── Inventory Alerts tables ──
                    try {
                        await turso.execute(`CREATE TABLE IF NOT EXISTS product_alert_settings (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            product_id INTEGER NOT NULL,
                            min_stock REAL NOT NULL DEFAULT 5,
                            critical_stock REAL NOT NULL DEFAULT 2,
                            priority TEXT DEFAULT 'normal',
                            notify_system INTEGER DEFAULT 1,
                            notify_whatsapp INTEGER DEFAULT 0,
                            is_active INTEGER DEFAULT 1,
                            cooldown_hours INTEGER DEFAULT 6,
                            last_notified_at TEXT,
                            created_at TEXT,
                            UNIQUE(company_id, product_id)
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_alert_settings_company ON product_alert_settings(company_id, is_active)`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS inventory_alerts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            product_id INTEGER,
                            product_name TEXT,
                            alert_type TEXT NOT NULL,
                            priority TEXT DEFAULT 'normal',
                            title TEXT NOT NULL,
                            message TEXT NOT NULL,
                            current_stock REAL,
                            threshold REAL,
                            days_remaining REAL,
                            is_read INTEGER DEFAULT 0,
                            channel TEXT DEFAULT 'system',
                            sent INTEGER DEFAULT 0,
                            sent_at TEXT,
                            created_at TEXT
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_alerts_company_read ON inventory_alerts(company_id, is_read)`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_alerts_company_type ON inventory_alerts(company_id, alert_type)`);
                    } catch (e) {
                        console.warn('Alert tables creation skipped:', e.message);
                    }

                    // ── SII Chile (DTE) tables ──
                    try {
                        await turso.execute(`CREATE TABLE IF NOT EXISTS sii_config (
                            company_id TEXT PRIMARY KEY,
                            rut_emisor TEXT NOT NULL,
                            razon_social TEXT NOT NULL,
                            giro TEXT NOT NULL,
                            direccion TEXT,
                            comuna TEXT,
                            ciudad TEXT,
                            acteco TEXT,
                            certificado_pfx TEXT,
                            certificado_password TEXT,
                            ambiente TEXT DEFAULT 'certificacion',
                            sii_resolution_number TEXT,
                            sii_resolution_date TEXT,
                            auto_emit INTEGER DEFAULT 1,
                            is_active INTEGER DEFAULT 0,
                            created_at TEXT,
                            updated_at TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS sii_cafs (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            tipo_dte INTEGER NOT NULL,
                            folio_desde INTEGER NOT NULL,
                            folio_hasta INTEGER NOT NULL,
                            folio_actual INTEGER NOT NULL,
                            caf_xml TEXT NOT NULL,
                            caf_fingerprint TEXT,
                            estado TEXT DEFAULT 'active',
                            created_at TEXT,
                            updated_at TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sii_cafs_lookup ON sii_cafs(company_id, tipo_dte, estado)`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS sii_dtes (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            sale_id INTEGER,
                            tipo_dte INTEGER NOT NULL,
                            folio INTEGER NOT NULL,
                            rut_receptor TEXT,
                            razon_social_receptor TEXT,
                            monto_total INTEGER,
                            monto_neto INTEGER,
                            monto_iva INTEGER,
                            xml_firmado TEXT,
                            track_id TEXT,
                            estado TEXT DEFAULT 'pending',
                            sii_response TEXT,
                            created_at TEXT,
                            updated_at TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sii_dtes_sale ON sii_dtes(company_id, sale_id)`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sii_dtes_estado ON sii_dtes(company_id, estado)`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sii_dtes_folio ON sii_dtes(company_id, tipo_dte, folio)`);
                        await turso.execute(`CREATE TABLE IF NOT EXISTS sii_rcof (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            company_id TEXT NOT NULL,
                            fecha TEXT NOT NULL,
                            xml TEXT,
                            track_id TEXT,
                            estado TEXT DEFAULT 'pending',
                            created_at TEXT,
                            FOREIGN KEY(company_id) REFERENCES companies(id)
                        )`);
                        await turso.execute(`CREATE INDEX IF NOT EXISTS idx_sii_rcof_lookup ON sii_rcof(company_id, fecha)`);
                    } catch (e) {
                        console.warn('SII tables creation skipped:', e.message);
                    }

                    // ── Migrate new permissions for existing companies ──
                    try {
                        const NEW_PERMS = [
                            'combos.view', 'combos.create', 'combos.edit', 'combos.delete',
                            'inventory_control.view', 'inventory_control.create', 'inventory_control.manage',
                            'alerts.view', 'alerts.manage'
                        ];
                        // Check if these permissions exist in any company
                        const permCheck = await turso.execute({
                            sql: `SELECT COUNT(*) as count FROM role_permissions WHERE permission = 'combos.view'`,
                            args: []
                        });
                        if (Number(permCheck.rows[0].count) === 0) {
                            // Get all company+role combos
                            const existingRoles = await turso.execute({
                                sql: `SELECT DISTINCT company_id, role FROM role_permissions`,
                                args: []
                            });
                            const ROLE_DEFAULTS = {
                                'Vendedor': ['alerts.view'],
                                'Bodeguero': ['combos.view', 'combos.create', 'combos.edit', 'combos.delete', 'inventory_control.view', 'inventory_control.create', 'inventory_control.manage', 'alerts.view', 'alerts.manage'],
                                'Supervisor': ['combos.view', 'inventory_control.view', 'alerts.view'],
                                'Administrador': NEW_PERMS
                            };
                            const batch = [];
                            for (const row of existingRoles.rows) {
                                const allowed = ROLE_DEFAULTS[row.role] || [];
                                for (const p of NEW_PERMS) {
                                    batch.push({
                                        sql: `INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)`,
                                        args: [row.company_id, row.role, p, allowed.includes(p) ? 1 : 0]
                                    });
                                }
                            }
                            if (batch.length > 0) {
                                const CHUNK = 50;
                                for (let i = 0; i < batch.length; i += CHUNK) {
                                    await turso.batch(batch.slice(i, i + CHUNK));
                                }
                                console.log(`✅ Migrated ${NEW_PERMS.length} new permissions for ${existingRoles.rows.length} role-company combos`);
                            }
                        }
                    } catch (e) {
                        console.warn('Permission migration skipped:', e.message);
                    }

                    // ── DDL 15: Fix permission name mismatches + add missing perms ──
                    try {
                        // Rename mismatched permissions
                        const RENAMES = [
                            ['dashboard.view_profit', 'dashboard.view_profits'],
                            ['clients.register_payment', 'clients.manage_payments'],
                            ['settings.permissions', 'settings.manage_permissions'],
                            ['orders.view', 'supplier_orders.view'],
                            ['orders.create', 'supplier_orders.create'],
                            ['orders.edit', 'supplier_orders.edit'],
                            ['orders.receive', 'supplier_orders.receive'],
                        ];
                        const renameBatch = [];
                        for (const [oldName, newName] of RENAMES) {
                            renameBatch.push({
                                sql: `UPDATE role_permissions SET permission = ? WHERE permission = ? AND NOT EXISTS (SELECT 1 FROM role_permissions rp2 WHERE rp2.company_id = role_permissions.company_id AND rp2.role = role_permissions.role AND rp2.permission = ?)`,
                                args: [newName, oldName, newName]
                            });
                        }
                        // Delete orphaned orders_history.view and settings.general
                        renameBatch.push({ sql: `DELETE FROM role_permissions WHERE permission = 'orders_history.view'`, args: [] });
                        renameBatch.push({ sql: `DELETE FROM role_permissions WHERE permission = 'settings.general'`, args: [] });
                        if (renameBatch.length > 0) {
                            await turso.batch(renameBatch);
                            console.log('✅ Permission names fixed (DDL 15)');
                        }

                        // Add newly defined permissions that may be missing
                        const EXTRA_PERMS = [
                            'pos.cancel_sale', 'sales.export', 'products.view_cost',
                            'invoices.pay', 'reports.export', 'users.manage',
                            'supplier_orders.edit', 'supplier_orders.receive', 'supplier_orders.delete'
                        ];
                        const extraCheck = await turso.execute({
                            sql: `SELECT COUNT(*) as count FROM role_permissions WHERE permission = 'pos.cancel_sale'`,
                            args: []
                        });
                        if (Number(extraCheck.rows[0].count) === 0) {
                            const existingRoles2 = await turso.execute({
                                sql: `SELECT DISTINCT company_id, role FROM role_permissions`,
                                args: []
                            });
                            const extraBatch = [];
                            for (const row of existingRoles2.rows) {
                                for (const p of EXTRA_PERMS) {
                                    extraBatch.push({
                                        sql: `INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, 0)`,
                                        args: [row.company_id, row.role, p]
                                    });
                                }
                            }
                            if (extraBatch.length > 0) {
                                const CHUNK = 50;
                                for (let i = 0; i < extraBatch.length; i += CHUNK) {
                                    await turso.batch(extraBatch.slice(i, i + CHUNK));
                                }
                                console.log(`✅ Added ${EXTRA_PERMS.length} missing permissions for ${existingRoles2.rows.length} role-company combos`);
                            }
                        }
                    } catch (e) {
                        console.warn('Permission name fix migration skipped:', e.message);
                    }

                    // ── Migration 16: Credit management columns (always-run) ──
                    try {
                        const clientInfo16 = await turso.execute(`PRAGMA table_info(clients)`);
                        const hasCreditLimit = clientInfo16.rows.some(col => col.name === 'credit_limit');
                        if (!hasCreditLimit) {
                            console.log('Adding credit management columns to clients...');
                            await turso.execute(`ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN credit_period_days INTEGER DEFAULT 30`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN credit_enabled INTEGER DEFAULT 1`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN client_status TEXT DEFAULT 'active'`);
                        }
                        const salesInfo16 = await turso.execute(`PRAGMA table_info(sales)`);
                        const hasDueDate = salesInfo16.rows.some(col => col.name === 'payment_due_date');
                        if (!hasDueDate) {
                            await turso.execute(`ALTER TABLE sales ADD COLUMN payment_due_date TEXT`);
                        }
                        const companyInfo16 = await turso.execute(`PRAGMA table_info(companies)`);
                        const hasCreditBlockMode = companyInfo16.rows.some(col => col.name === 'credit_block_mode');
                        if (!hasCreditBlockMode) {
                            await turso.execute(`ALTER TABLE companies ADD COLUMN credit_block_mode TEXT DEFAULT 'warn'`);
                        }
                    } catch (e) {
                        console.warn('Migration 16 (credit management) error:', e);
                    }

                    // ── Migration 18: Billing fields for SII invoicing on clients ──
                    try {
                        const clientInfo18 = await turso.execute(`PRAGMA table_info(clients)`);
                        const cols18 = clientInfo18.rows.map(c => c.name);
                        if (!cols18.includes('razon_social')) {
                            console.log('Adding SII billing columns to clients...');
                            await turso.execute(`ALTER TABLE clients ADD COLUMN razon_social TEXT DEFAULT ''`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN giro TEXT DEFAULT ''`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN comuna TEXT DEFAULT ''`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN ciudad TEXT DEFAULT ''`);
                            console.log('✅ SII billing columns added to clients');
                        }
                    } catch (e) {
                        console.warn('Migration 18 (SII billing columns) error:', e);
                    }

                    // ── Migration 17: Denormalized debt columns on clients (always-run) ──
                    try {
                        const clientInfo17 = await turso.execute(`PRAGMA table_info(clients)`);
                        const cols17 = clientInfo17.rows.map(c => c.name);
                        if (!cols17.includes('total_debt')) {
                            console.log('Adding denormalized debt columns to clients...');
                            await turso.execute(`ALTER TABLE clients ADD COLUMN total_debt REAL DEFAULT 0`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN pending_sales_count INTEGER DEFAULT 0`);
                            await turso.execute(`ALTER TABLE clients ADD COLUMN overdue_count INTEGER DEFAULT 0`);
                            // Backfill from existing sales
                            await turso.execute(`
                                UPDATE clients SET
                                    total_debt = COALESCE((
                                        SELECT SUM(s.total) FROM sales s
                                        WHERE s.client_id = clients.id AND s.company_id = clients.company_id
                                        AND s.payment_method = 'Crédito' AND s.status NOT IN ('paid','cancelled')
                                    ), 0),
                                    pending_sales_count = COALESCE((
                                        SELECT COUNT(*) FROM sales s
                                        WHERE s.client_id = clients.id AND s.company_id = clients.company_id
                                        AND s.payment_method = 'Crédito' AND s.status NOT IN ('paid','cancelled')
                                    ), 0),
                                    overdue_count = COALESCE((
                                        SELECT COUNT(*) FROM sales s
                                        WHERE s.client_id = clients.id AND s.company_id = clients.company_id
                                        AND s.payment_method = 'Crédito' AND s.status NOT IN ('paid','cancelled')
                                        AND s.payment_due_date IS NOT NULL AND s.payment_due_date < datetime('now')
                                    ), 0)
                            `);
                            console.log('✅ Backfilled client debt columns from sales');
                        }
                    } catch (e) {
                        console.warn('Migration 17 (debt columns) error:', e);
                    }

                    // Cache successful DDL in localStorage
                    localStorage.setItem(DDL_CACHE_KEY, String(DDL_TARGET));
                    migrationsExecuted = true;
                    console.log('✅ Migrations & schema checked and cached');
                }
            } else {
                console.log('✅ Migrations already executed, using memory cache');
            }

            const { currentUser } = get();
            let { activeCompanyId, availableCompanies } = get();

            console.log('🔍 Initial state:', {
                user: currentUser?.username,
                activeCompanyId,
                companiesCount: availableCompanies?.length
            });

            // CRÍTICO: Si hay usuario pero NO hay empresas cargadas (recarga de página)
            if (currentUser && (!availableCompanies || availableCompanies.length === 0)) {
                console.log('🔄 Page reload detected - Loading user companies...');

                // Cargar empresas del usuario
                const companiesRes = await turso.execute({
                    sql: `SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, c.currency, c.credit_block_mode, uc.role 
                          FROM user_companies uc
                          JOIN companies c ON uc.company_id = c.id
                          WHERE uc.user_id = ? AND c.status = 'active'`,
                    args: [currentUser.id]
                });

                availableCompanies = companiesRes.rows;

                if (availableCompanies.length === 0) {
                    throw new Error("Usuario sin empresas asignadas");
                }

                // Determinar activeCompanyId correcto
                // Prioridad 1: company_id del usuario (su empresa home)
                if (currentUser.company_id && availableCompanies.some(c => c.id === currentUser.company_id)) {
                    activeCompanyId = currentUser.company_id;
                    console.log('✅ Using user home company:', currentUser.company_id);
                }
                // Prioridad 2: Última empresa guardada en localStorage
                else {
                    const storedCompanyId = localStorage.getItem(`activeCompanyId:${currentUser.id}`);
                    if (storedCompanyId && availableCompanies.some(c => c.id === storedCompanyId)) {
                        activeCompanyId = storedCompanyId;
                        console.log('✅ Using stored company from localStorage:', storedCompanyId);
                    } else {
                        activeCompanyId = availableCompanies[0].id;
                        console.log('✅ Using first available company:', activeCompanyId);
                    }
                }

                const activeCompany = availableCompanies.find(c => c.id === activeCompanyId);

                // Actualizar estado
                set({
                    availableCompanies,
                    activeCompanyId,
                    currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                    currentCurrency: activeCompany.currency || 'CLP',
                    currentUserCompanyRole: activeCompany.role,
                    inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                    creditBlockMode: activeCompany.credit_block_mode || 'warn'
                });


                // Guardar en localStorage
                localStorage.setItem(`activeCompanyId:${currentUser.id}`, activeCompanyId);
            }

            console.log('🏢 Loading data for company:', activeCompanyId);

            // SINGLE BATCH FETCH: 1 HTTP round-trip for all metadata
            // ==========================================
            console.time('⏱️ BatchFetch');
            const batchResults = await turso.batch([
                { sql: `SELECT pl.id, pl.product_id, pl.batch_number, pl.expiry_date, pl.quantity, pl.cost, pl.supplier_name, pl.created_at, pl.status, pl.company_id, p.name AS product_name, p.unit AS product_unit
                          FROM product_lots pl
                          LEFT JOIN products p ON p.id = pl.product_id
                          WHERE pl.company_id = ? AND pl.quantity > 0 
                          ORDER BY pl.expiry_date ASC 
                          LIMIT 200`, args: [activeCompanyId] },
                { sql: "SELECT * FROM categories WHERE company_id = ? ORDER BY name ASC", args: [activeCompanyId] },
                { sql: "SELECT * FROM suppliers WHERE company_id = ? ORDER BY name ASC", args: [activeCompanyId] },
                { sql: "SELECT * FROM users WHERE company_id = ?", args: [activeCompanyId] },
                { sql: "SELECT * FROM clients WHERE company_id = ? ORDER BY name ASC", args: [activeCompanyId] },
                { sql: "SELECT * FROM role_permissions WHERE company_id = ?", args: [activeCompanyId] },
                { sql: "SELECT * FROM tax_rates WHERE company_id = ?", args: [activeCompanyId] },
                { sql: "SELECT * FROM company_modules WHERE company_id = ?", args: [activeCompanyId] },
                { sql: "SELECT * FROM payment_methods_config WHERE company_id = ?", args: [activeCompanyId] },
                { sql: "SELECT * FROM payment_terminals WHERE company_id = ? AND is_active = 1", args: [activeCompanyId] },
                { sql: "SELECT * FROM bank_accounts WHERE company_id = ? AND is_active = 1", args: [activeCompanyId] },
                { sql: "SELECT inventory_adjustment_mode, currency, credit_block_mode FROM companies WHERE id = ?", args: [activeCompanyId] }
            ], 'read');
            const [productLotsRes, categoriesRes, suppliersRes, usersRes, clientsRes, permissionsRes, taxesRes, modulesRes, payConfigRes, payTerminalsRes, bankAccountsRes, companyConfigRes] = batchResults;
            console.timeEnd('⏱️ BatchFetch');

            console.log('👥 Loaded users:', usersRes.rows.length);

            // Process payment methods config
            let payConfig = payConfigRes.rows[0];
            if (!payConfig) {
                // Initialize default config if not exists
                await turso.execute({ sql: "INSERT INTO payment_methods_config (company_id) VALUES (?)", args: [activeCompanyId] });
                payConfig = { company_id: activeCompanyId, cash_enabled: 1, card_enabled: 1, transfer_enabled: 1, credit_enabled: 1, mixed_enabled: 1 };
            }

            // Process company config
            if (companyConfigRes.rows.length > 0) {
                const freshMode = companyConfigRes.rows[0].inventory_adjustment_mode === 1;
                const freshCurrency = companyConfigRes.rows[0].currency || 'CLP';
                const freshCreditBlockMode = companyConfigRes.rows[0].credit_block_mode || 'warn';
                set({ inventoryAdjustmentMode: freshMode, currentCurrency: freshCurrency, creditBlockMode: freshCreditBlockMode });
            }

            // Removed products mapping
            const productLots = productLotsRes.rows;
            const categories = categoriesRes.rows.map(c => ({
                ...c,
                showInPos: c.show_in_pos !== 0
            }));
            const suppliers = suppliersRes.rows;
            const users = usersRes.rows;
            const clients = clientsRes.rows;

            set({
                productLots, categories, suppliers, users, clients,
                rolePermissions: permissionsRes.rows,
                taxRates: taxesRes.rows,
                companyModules: modulesRes.rows,
                paymentMethodsConfig: payConfig,
                paymentTerminals: payTerminalsRes.rows,
                bankAccounts: bankAccountsRes.rows
            });

            console.timeEnd('⏱️ fetchInitialData');
            console.log(`✅ Initial Load: Metadata only.`);
            console.log('✅ fetchInitialData COMPLETE');
        } catch (error) {
            console.error("Failed to fetch data:", error);
            set({ error: error.message });
        } finally {
            fetchInProgress = false;
            set({ isLoading: false });
        }
    },

    // 🏷️ COMPANY MODULES — see definition in "COMPANY MODULE MANAGEMENT" section below

    // NEW: Server-Side Search Actions
    searchProducts: async (term) => {
        const { activeCompanyId } = get();
        if (!term) return;

        // OFFLINE: buscar en Dexie
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            try {
                const t = String(term).toLowerCase();
                const all = await localDb.products.where('companyId').equals(activeCompanyId).toArray();
                const filtered = all.filter(p =>
                    (p.name && String(p.name).toLowerCase().includes(t)) ||
                    (p.sku && String(p.sku).toLowerCase().includes(t)) ||
                    (p.barcode && String(p.barcode).toLowerCase().includes(t))
                ).slice(0, 50).map(p => ({
                    ...p,
                    price_ranges: typeof p.price_ranges === 'string'
                        ? (() => { try { return JSON.parse(p.price_ranges); } catch { return []; } })()
                        : (p.price_ranges || [])
                }));
                set({ products: filtered });
            } catch (e) {
                console.error('Search offline failed', e);
            }
            return;
        }

        try {
            console.time('⏱️ searchProducts');
            // Optimización: Búsqueda limitada a 50
            const res = await turso.execute({
                sql: `SELECT * FROM products WHERE company_id = ? AND (name LIKE ? OR sku LIKE ?) LIMIT 50`,
                args: [activeCompanyId, `%${term}%`, `%${term}%`]
            });
            console.timeEnd('⏱️ searchProducts');

            const products = res.rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));
            set({ products });
        } catch (e) {
            console.error("Search failed", e);
        }
    },

    getProductByBarcode: async (barcode) => {
        const { activeCompanyId } = get();

        // OFFLINE: buscar en Dexie
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            try {
                const all = await localDb.products.where('companyId').equals(activeCompanyId).toArray();
                const p = all.find(x => x.sku === barcode || x.barcode === barcode || x.name === barcode);
                if (!p) return null;
                return {
                    ...p,
                    price_ranges: typeof p.price_ranges === 'string'
                        ? (() => { try { return JSON.parse(p.price_ranges); } catch { return []; } })()
                        : (p.price_ranges || [])
                };
            } catch (e) {
                console.error('Barcode lookup offline failed', e);
                return null;
            }
        }

        try {
            const res = await turso.execute({
                sql: `SELECT * FROM products WHERE company_id = ? AND (sku = ? OR name = ?) LIMIT 1`,
                args: [activeCompanyId, barcode, barcode]
            });

            if (res.rows.length > 0) {
                const p = res.rows[0];
                return {
                    ...p,
                    price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
                };
            }
            return null;
        } catch (e) {
            console.error("Barcode lookup failed", e);
            return null;
        }
    },

    searchProductsForDropdown: async (term) => {
        const { activeCompanyId } = get();
        if (!term) return [];

        try {
            const res = await turso.execute({
                sql: `SELECT * FROM products WHERE company_id = ? AND (name LIKE ? OR sku LIKE ?) LIMIT 50`,
                args: [activeCompanyId, `%${term}%`, `%${term}%`]
            });

            return res.rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));
        } catch (e) {
            console.error("Dropdown search failed", e);
            return [];
        }
    },



    loadCategoryProducts: async (category, offset = 0, limit = 30) => {
        const { activeCompanyId } = get();

        // OFFLINE: leer de Dexie
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            try {
                let all = await localDb.products.where('companyId').equals(activeCompanyId).toArray();
                if (category && category !== 'Todos') {
                    all = all.filter(p => p.category === category);
                }
                // Ordenar: ofertas primero, luego nombre
                all.sort((a, b) => {
                    const ao = a.is_offer ? 1 : 0;
                    const bo = b.is_offer ? 1 : 0;
                    if (ao !== bo) return bo - ao;
                    return String(a.name || '').localeCompare(String(b.name || ''));
                });
                const slice = all.slice(offset, offset + limit).map(p => ({
                    ...p,
                    price_ranges: typeof p.price_ranges === 'string'
                        ? (() => { try { return JSON.parse(p.price_ranges); } catch { return []; } })()
                        : (p.price_ranges || [])
                }));
                if (offset === 0) {
                    set({ products: slice });
                } else {
                    const current = get().products;
                    set({ products: [...current, ...slice] });
                }
                return slice.length === limit;
            } catch (e) {
                console.error('Load category offline failed', e);
                return false;
            }
        }

        try {
            console.log(`📦 Loading products: category=${category}, offset=${offset}`);
            console.time(`⏱️ loadCategoryProducts-${category}-${offset}`);

            // Query optimizado - solo columnas necesarias
            let sql = `SELECT 
                id, name, sku, price, cost, stock, category, unit, image,
                tax_rate, is_offer, offer_price, company_id,
                price_ranges, scale_group_id, original_price
            FROM products 
            WHERE company_id = ?`;

            let args = [activeCompanyId];

            // Filtrar por categoría si no es "Todos"
            if (category && category !== 'Todos') {
                sql += " AND category = ?";
                args.push(category);
            }

            // Ordenar y paginar
            sql += " ORDER BY is_offer DESC, name ASC LIMIT ? OFFSET ?";
            args.push(limit, offset);

            const result = await turso.execute({ sql, args });

            console.timeEnd(`⏱️ loadCategoryProducts-${category}-${offset}`);
            console.log(`✅ Loaded ${result.rows.length} products`);

            // Procesar price_ranges si existe
            const products = result.rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));

            // Si es primera página (offset=0), reemplazar productos
            // Si es paginación, agregar a los existentes
            if (offset === 0) {
                set({ products });
            } else {
                const currentProducts = get().products;
                set({ products: [...currentProducts, ...products] });
            }

            // Retornar si hay más productos
            return result.rows.length === limit; // true si hay más

        } catch (e) {
            console.error("❌ Load category products failed", e);
            return false;
        }
    },

    // --- TAX RATES ACTIONS ---
    fetchTaxRates: async () => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: "SELECT * FROM tax_rates WHERE company_id = ? ORDER BY rate ASC",
                args: [activeCompanyId]
            });
            set({ taxRates: res.rows });
        } catch (e) {
            console.error("Failed to fetch tax rates:", e);
        }
    },

    addTaxRate: async (taxData) => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: "INSERT INTO tax_rates (name, rate, is_default, company_id) VALUES (?, ?, ?, ?)",
                args: [taxData.name, taxData.rate, taxData.is_default ? 1 : 0, activeCompanyId]
            });

            // Si es default, quitar default a otros
            if (taxData.is_default) {
                await turso.execute({
                    sql: "UPDATE tax_rates SET is_default = 0 WHERE id != ? AND company_id = ?",
                    args: [res.lastInsertRowid, activeCompanyId]
                });
            }

            await get().fetchTaxRates();
            return { success: true };
        } catch (e) {
            console.error("Failed to add tax rate:", e);
            return { success: false, error: e.message };
        }
    },

    updateTaxRate: async (id, taxData) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: "UPDATE tax_rates SET name = ?, rate = ?, is_default = ? WHERE id = ? AND company_id = ?",
                args: [taxData.name, taxData.rate, taxData.is_default ? 1 : 0, id, activeCompanyId]
            });

            // Si es default, quitar default a otros
            if (taxData.is_default) {
                await turso.execute({
                    sql: "UPDATE tax_rates SET is_default = 0 WHERE id != ? AND company_id = ?",
                    args: [id, activeCompanyId]
                });
            }

            await get().fetchTaxRates();
            return { success: true };
        } catch (e) {
            console.error("Failed to update tax rate:", e);
            return { success: false, error: e.message };
        }
    },

    deleteTaxRate: async (id) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: "DELETE FROM tax_rates WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });
            await get().fetchTaxRates();
            return { success: true };
        } catch (e) {
            console.error("Failed to delete tax rate:", e);
            return { success: false, error: e.message };
        }
    },

    fetchSales: async (fromDate, toDate, offset = 0, limit = 30, paymentMethodFilter = '', sellerIdFilter = '', saleIdFilter = '') => {
        try {
            const { activeCompanyId, currentCompanyTimezone, sales: currentSales } = get();

            // Only select lightweight columns for the list
            let query = "SELECT id, date, total, status, user_id, payment_method, client_name, client_id FROM sales WHERE company_id = ?";
            const args = [activeCompanyId];

            // PRIORITY 1: Sale ID Search (Global)
            if (saleIdFilter) {
                query += " AND id = ?";
                args.push(saleIdFilter);

                // Note: When searching by ID, we ignore other filters to ensure we find the specific ticket
                // We still apply LIMIT/OFFSET but usually ID returns 1 result. 
                // However, standard flow suggests resetting offset when searching.
            }
            // PRIORITY 2: Standard Filters (Date, Payment, Seller)
            else {
                let start, end;

                if (fromDate && toDate) {
                    // Explicit filter
                    // Use string helpers to avoid UTC shifting issues with new Date()
                    start = getStartFromDateString(fromDate, currentCompanyTimezone);
                    end = getEndFromDateString(toDate, currentCompanyTimezone);
                } else {
                    // Default: TODAY
                    const today = new Date();
                    start = getCompanyDayStart(today, currentCompanyTimezone);
                    end = getCompanyDayEnd(today, currentCompanyTimezone);
                }

                query += " AND date >= ? AND date <= ?";
                args.push(start.toISOString(), end.toISOString());

                if (paymentMethodFilter && paymentMethodFilter !== 'Todos') {
                    query += " AND payment_method = ?";
                    args.push(paymentMethodFilter);
                }

                if (sellerIdFilter && sellerIdFilter !== 'Todos') {
                    // sellerIdFilter comes as string, but user_id is Integer in DB usually?
                    // Let's check schema/previous usage. Sales.user_id is integer?
                    // users.id is integer. 
                    query += " AND user_id = ?";
                    args.push(sellerIdFilter);
                }
            }

            query += " ORDER BY id DESC LIMIT ? OFFSET ?";
            args.push(limit, offset);

            const result = await turso.execute({ sql: query, args });

            // Map basic details, assume items and heavy details are null initially
            const newSales = result.rows.map(sale => ({
                ...sale,
                items: null, // To be loaded on demand
                paymentDetails: null, // To be loaded on demand
                paymentMethod: sale.payment_method, // Explicit mapping for UI
                observation: sale.observation || '',
            }));

            if (offset === 0) {
                set({ sales: newSales });
            } else {
                set({ sales: [...currentSales, ...newSales] });
            }

            return newSales.length; // Return count to know if there are more
        } catch (e) {
            console.error("Fetch sales error", e);
            return 0;
        }
    },

    /**
     * Fetch full sales (with items) for reporting purposes.
     * - Filters by company_id and date range in company timezone.
     * - Excludes cancelled sales (status != 'cancelled').
     * - Returns the array (does NOT mutate the `sales` state used by the history UI).
     */
    fetchSalesForReport: async (startDate, endDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            if (!startDate || !endDate) return [];
            const start = getStartFromDateString(startDate, currentCompanyTimezone).toISOString();
            const end = getEndFromDateString(endDate, currentCompanyTimezone).toISOString();
            const result = await turso.execute({
                sql: `SELECT id, date, total, status, user_id, payment_method, client_name, client_id, items
                      FROM sales
                      WHERE company_id = ? AND date >= ? AND date <= ? AND status != 'cancelled'
                      ORDER BY date DESC`,
                args: [activeCompanyId, start, end]
            });
            return result.rows.map(s => ({
                ...s,
                paymentMethod: s.payment_method,
            }));
        } catch (e) {
            console.error("fetchSalesForReport error", e);
            return [];
        }
    },

    fetchClientSales: async (clientId) => {
        try {
            const { activeCompanyId } = get();

            // Query for ALL sales for this client (newest first)
            const result = await turso.execute({
                sql: "SELECT * FROM sales WHERE client_id = ? AND company_id = ? ORDER BY date DESC LIMIT 500",
                args: [clientId, activeCompanyId]
            });

            return result.rows.map(sale => ({
                ...sale,
                items: typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items,
                paymentMethod: sale.payment_method, // Mapping for UI
                clientId: sale.client_id, // Mapping for UI consistency
                observation: sale.observation || ''
            }));
        } catch (e) {
            console.error("Error fetching client sales:", e);
            return [];
        }
    },

    // Sync denormalized debt columns for a single client (DB + local state)
    _syncClientDebt: async (clientId) => {
        try {
            const { activeCompanyId } = get();
            if (!clientId || !activeCompanyId) return;

            // Check if amount_paid column exists
            let debtFormula = 'total';
            try {
                const cols = await turso.execute(`PRAGMA table_info(sales)`);
                if (cols.rows.some(c => c.name === 'amount_paid')) {
                    debtFormula = 'total - COALESCE(amount_paid, 0)';
                }
            } catch (_) {}

            const res = await turso.execute({
                sql: `SELECT 
                        COALESCE(SUM(${debtFormula}), 0) as total_debt,
                        COUNT(*) as pending_count,
                        COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN 1 END) as overdue_count
                      FROM sales
                      WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito'
                        AND status NOT IN ('paid', 'cancelled')`,
                args: [clientId, activeCompanyId]
            });
            const r = res.rows[0] || {};
            const totalDebt = parseFloat(r.total_debt) || 0;
            const pendingCount = parseInt(r.pending_count) || 0;
            const overdueCount = parseInt(r.overdue_count) || 0;

            await turso.execute({
                sql: `UPDATE clients SET total_debt = ?, pending_sales_count = ?, overdue_count = ? WHERE id = ? AND company_id = ?`,
                args: [totalDebt, pendingCount, overdueCount, clientId, activeCompanyId]
            });

            set(state => ({
                clients: state.clients.map(c =>
                    c.id === clientId ? { ...c, total_debt: totalDebt, pending_sales_count: pendingCount, overdue_count: overdueCount } : c
                )
            }));
        } catch (e) {
            console.warn('_syncClientDebt error:', e);
        }
    },

    // Get credit status for a single client (debt, limit, overdue status)
    getClientCreditStatus: async (clientId) => {
        try {
            const { activeCompanyId } = get();
            const clientData = get().clients.find(c => c.id === clientId);
            if (!clientData) return null;

            // Check if amount_paid column exists
            let debtFormula = 'total';
            try {
                const cols = await turso.execute(`PRAGMA table_info(sales)`);
                if (cols.rows.some(c => c.name === 'amount_paid')) {
                    debtFormula = 'total - COALESCE(amount_paid, 0)';
                }
            } catch (_) {}

            const result = await turso.execute({
                sql: `SELECT 
                        COALESCE(SUM(${debtFormula}), 0) as total_debt,
                        COUNT(*) as pending_count,
                        MIN(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') AND status NOT IN ('paid','cancelled') THEN payment_due_date END) as oldest_overdue_date,
                        COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') AND status NOT IN ('paid','cancelled') THEN 1 END) as overdue_count,
                        COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date >= datetime('now') AND payment_due_date <= datetime('now', '+3 days') AND status NOT IN ('paid','cancelled') THEN 1 END) as due_soon_count
                      FROM sales 
                      WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito' 
                      AND status NOT IN ('paid', 'cancelled')`,
                args: [clientId, activeCompanyId]
            });

            const row = result.rows[0];
            const totalDebt = parseFloat(row?.total_debt || 0);
            const creditLimit = parseFloat(clientData.credit_limit || 0);
            const overdueCount = parseInt(row?.overdue_count || 0);
            const dueSoonCount = parseInt(row?.due_soon_count || 0);
            let oldestOverdueDays = 0;
            if (row?.oldest_overdue_date) {
                oldestOverdueDays = Math.floor((Date.now() - new Date(row.oldest_overdue_date).getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                totalDebt,
                creditLimit,
                availableCredit: creditLimit > 0 ? Math.max(0, creditLimit - totalDebt) : null,
                creditUsagePercent: creditLimit > 0 ? Math.min(100, (totalDebt / creditLimit) * 100) : 0,
                hasOverdue: overdueCount > 0,
                overdueCount,
                dueSoonCount,
                oldestOverdueDays,
                pendingCount: parseInt(row?.pending_count || 0),
                clientStatus: clientData.client_status || 'active',
                creditEnabled: clientData.credit_enabled === 1 || clientData.credit_enabled === true
            };
        } catch (e) {
            console.error('Error getting client credit status:', e);
            return null;
        }
    },

    // Fetch debt summary for ALL clients (for list view indicators)
    fetchClientsDebtSummary: async () => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: `SELECT 
                        client_id,
                        COALESCE(SUM(total), 0) as total_debt,
                        COUNT(*) as pending_count,
                        MIN(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN payment_due_date END) as oldest_overdue_date,
                        COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < datetime('now') THEN 1 END) as overdue_count,
                        COUNT(CASE WHEN payment_due_date IS NOT NULL AND payment_due_date >= datetime('now') AND payment_due_date <= datetime('now', '+3 days') THEN 1 END) as due_soon_count
                      FROM sales 
                      WHERE company_id = ? AND payment_method = 'Crédito' 
                      AND status NOT IN ('paid', 'cancelled')
                      AND client_id IS NOT NULL
                      GROUP BY client_id`,
                args: [activeCompanyId]
            });

            const debtMap = {};
            for (const row of result.rows) {
                let oldestOverdueDays = 0;
                if (row.oldest_overdue_date) {
                    oldestOverdueDays = Math.floor((Date.now() - new Date(row.oldest_overdue_date).getTime()) / (1000 * 60 * 60 * 24));
                }
                debtMap[row.client_id] = {
                    totalDebt: parseFloat(row.total_debt || 0),
                    pendingCount: parseInt(row.pending_count || 0),
                    overdueCount: parseInt(row.overdue_count || 0),
                    dueSoonCount: parseInt(row.due_soon_count || 0),
                    oldestOverdueDays
                };
            }
            return debtMap;
        } catch (e) {
            console.error('Error fetching clients debt summary:', e);
            return {};
        }
    },

    // Update credit_block_mode for the current company
    setCreditBlockMode: async (mode) => {
        try {
            const { activeCompanyId } = get();
            await turso.execute({
                sql: 'UPDATE companies SET credit_block_mode = ? WHERE id = ?',
                args: [mode, activeCompanyId]
            });
            set({ creditBlockMode: mode });
            return { success: true };
        } catch (e) {
            console.error('Error setting credit block mode:', e);
            return { success: false, error: e.message };
        }
    },

    fetchSaleDetails: async (saleId) => {
        try {
            const { activeCompanyId, sales } = get();

            // Fetch full details for one sale
            const result = await turso.execute({
                sql: "SELECT * FROM sales WHERE id = ? AND company_id = ?",
                args: [saleId, activeCompanyId]
            });

            if (result.rows.length > 0) {
                const fullSale = result.rows[0];

                // Check for DTE (SII electronic invoice)
                let dte_folio = null;
                let dte_tipo = null;
                try {
                    const dteResult = await turso.execute({
                        sql: "SELECT folio, tipo_dte FROM sii_dtes WHERE sale_id = ? AND company_id = ? AND estado IN ('sent', 'accepted') LIMIT 1",
                        args: [saleId, activeCompanyId]
                    });
                    if (dteResult.rows.length > 0) {
                        dte_folio = dteResult.rows[0].folio;
                        dte_tipo = dteResult.rows[0].tipo_dte;
                    }
                } catch (_) { /* sii_dtes table may not exist yet */ }

                const processedSale = {
                    ...fullSale,
                    items: fullSale.items ? JSON.parse(fullSale.items) : [],
                    paymentMethod: fullSale.payment_method,
                    paymentDetails: fullSale.payment_details ? JSON.parse(fullSale.payment_details) : null,
                    observation: fullSale.observation || '',
                    clientId: fullSale.client_id,
                    clientName: fullSale.client_name,
                    dte_folio,
                    dte_tipo,
                };

                // Update the specific sale in the list with full details
                set({
                    sales: sales.map(s => s.id === saleId ? processedSale : s)
                });

                return processedSale;
            }
            return null;
        } catch (e) {
            console.error("Fetch sale details error", e);
            return null;
        }
    },

    fetchTodaySales: async () => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            const today = new Date();
            const startOfDayUTC = getCompanyDayStart(today, currentCompanyTimezone);
            const endOfDayUTC = getCompanyDayEnd(today, currentCompanyTimezone);

            const result = await turso.execute({
                sql: `SELECT s.*, u.name as user_name 
                      FROM sales s 
                      LEFT JOIN users u ON s.user_id = u.id 
                      WHERE s.company_id = ? 
                      AND s.date >= ? 
                      AND s.date <= ?
                      ORDER BY s.date DESC`,
                args: [
                    activeCompanyId,
                    startOfDayUTC.toISOString(),
                    endOfDayUTC.toISOString()
                ]
            });

            return result.rows || [];
        } catch (e) {
            console.error("Fetch today sales error", e);
            return [];
        }
    },

    // Optimized for Chart (Lightweight: No JSON blobs)
    fetchMonthlyStats: async (fromDate, toDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            const start = getCompanyDayStart(new Date(fromDate), currentCompanyTimezone);
            const end = getCompanyDayEnd(new Date(toDate), currentCompanyTimezone);

            // Only fetch what's needed for aggregation
            const sql = "SELECT id, date, total, company_id, summary FROM sales WHERE company_id = ? AND date >= ? AND date <= ?";

            const result = await turso.execute({
                sql,
                args: [activeCompanyId, start.toISOString(), end.toISOString()]
            });


            // We return raw rows, aggregation happens in component
            return result.rows || [];
        } catch (e) {
            console.error("Fetch monthly stats error", e);
            return [];
        }
    },

    fetchInventoryProducts: async (offset = 0, searchTerm = '', category = 'Todos') => {
        const { activeCompanyId, products: currentProducts } = get();
        try {
            console.time('⏱️ fetchInventory');
            const limit = 50;
            let sql = "SELECT * FROM products WHERE company_id = ?";
            let args = [activeCompanyId];

            // Add Search Filter
            if (searchTerm) {
                sql += " AND (name LIKE ? OR sku LIKE ?)";
                args.push('%' + searchTerm + '%', '%' + searchTerm + '%');
            }

            // Add Category Filter
            if (category !== 'Todos') {
                sql += " AND category = ?";
                args.push(category);
            }

            // Add Pagination
            sql += " ORDER BY is_offer DESC, name ASC LIMIT ? OFFSET ?";
            args.push(limit, offset);

            const res = await turso.execute({ sql, args });
            console.timeEnd('⏱️ fetchInventory');

            const newProducts = res.rows.map(p => ({
                ...p,
                price_ranges: p.price_ranges ? JSON.parse(p.price_ranges) : []
            }));

            if (offset === 0) {
                set({ products: newProducts });
            } else {
                set({ products: [...currentProducts, ...newProducts] });
            }

            return newProducts.length;
        } catch (e) {
            console.error("Inventory fetch failed", e);
            return 0;
        }
    },


    // Optimized for Recent Activity List (Limit 20)
    fetchRecentSales: async () => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: "SELECT * FROM sales WHERE company_id = ? ORDER BY id DESC LIMIT 20",
                args: [activeCompanyId]
            });

            const sales = result.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method,
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || '',
                clientId: sale.client_id,
                clientName: sale.client_name
            }));
            return sales;
        } catch (e) {
            console.error("Fetch recent sales error", e);
            return [];
        }
    },

    fetchLowStockProducts: async () => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: "SELECT * FROM products WHERE company_id = ? AND stock <= 0 LIMIT 20",
                args: [activeCompanyId]
            });
            return res.rows || [];
        } catch (e) {
            console.error("Fetch low stock failed", e);
            return [];
        }
    },

    fetchDashboardData: async () => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        try {
            console.time('⏱️ fetchDashboardData');

            // 1. Calcular fechas
            const today = new Date();

            // Para mes: desde día 1 del mes actual
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

            // Formatear fechas para comparar con columna 'day' (YYYY-MM-DD)
            const todayStr = formatInCompanyTime(today, currentCompanyTimezone, 'yyyy-MM-dd');
            const monthStartStr = formatInCompanyTime(startOfMonth, currentCompanyTimezone, 'yyyy-MM-dd');

            console.log('📅 Dashboard dates:', { todayStr, monthStartStr, company: activeCompanyId });

            // 2. QUERIES OPTIMIZADOS usando sales_daily_summary
            // 2. QUERIES OPTIMIZADOS usando sales_daily_summary
            const [todayStatsRes, monthStatsRes, todayUtilityRes] = await Promise.all([
                turso.execute({
                    sql: `SELECT 
                            COALESCE(SUM(total_sales), 0) as total_sales,
                            COALESCE(SUM(total_orders), 0) as total_orders
                          FROM sales_daily_summary
                          WHERE company_id = ? AND day = ?`,
                    args: [activeCompanyId, todayStr]
                }),
                turso.execute({
                    sql: `SELECT 
                            day,
                            total_sales,
                            total_orders
                          FROM sales_daily_summary
                          WHERE company_id = ? 
                          AND day >= ? 
                          AND day <= ?
                          ORDER BY day ASC`,
                    args: [activeCompanyId, monthStartStr, todayStr]
                }),
                turso.execute({
                    sql: `SELECT COALESCE(SUM(total_profit), 0) as total_profit
                          FROM product_daily_profit
                          WHERE company_id = ? AND day = ?`,
                    args: [activeCompanyId, todayStr]
                })
            ]);
            const [recentSalesRes, lowStockRes, topProductsRes] = await Promise.all([
                turso.execute({
                    sql: `SELECT s.*, u.name as user_name
                          FROM sales s
                          LEFT JOIN users u ON s.user_id = u.id
                          WHERE s.company_id = ?
                          ORDER BY s.date DESC
                          LIMIT 20`,
                    args: [activeCompanyId]
                }),
                turso.execute({
                    sql: "SELECT * FROM products WHERE company_id = ? AND stock <= 0 LIMIT 20",
                    args: [activeCompanyId]
                }),
                turso.execute({
                    sql: `SELECT 
                            p.id,
                            p.name,
                            p.category,
                            p.unit,
                            pdp.total_quantity,
                            pdp.total_revenue
                          FROM product_daily_profit pdp
                          JOIN products p ON pdp.product_id = p.id
                          WHERE pdp.company_id = ? 
                          AND pdp.day = ?
                          ORDER BY pdp.total_quantity DESC
                          LIMIT 10`,
                    args: [activeCompanyId, todayStr]
                })
            ]);

            // 3. Procesar resultados
            const todayStats = todayStatsRes.rows[0] || { total_sales: 0, total_orders: 0 };
            const monthlyStats = monthStatsRes.rows;
            const todayUtility = todayUtilityRes.rows[0]?.total_profit || 0;  // ← NUEVO

            const recentSales = recentSalesRes.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method,
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || '',
                clientId: sale.client_id,
                clientName: sale.client_name
            }));

            const lowStockProducts = lowStockRes.rows;
            const topProducts = topProductsRes.rows;  // ← NUEVO

            // Trigger background fetch for registers
            get().fetchActiveRegisters();
            const activeRegisters = get().activeRegisters;

            return {
                activeRegisters,
                todayUtility,      // ← NUEVO: Utilidad precalculada
                todayStats,
                monthlyStats,
                recentSales,
                lowStockProducts,
                topProducts        // ← NUEVO: Más vendidos precalculado
            };

        } catch (e) {
            console.error("❌ Fetch dashboard data failed", e);
            return null;
        }
    },

    fetchProductLotsReport: async (productLimit = 20, productOffset = 0, searchTerm = '') => {
        const { activeCompanyId } = get();
        try {
            // Step 1: Get paginated product IDs that have active lots, ordered by earliest expiry
            let prodSql, prodArgs;
            if (searchTerm.trim()) {
                const likeTerm = `%${searchTerm.trim()}%`;
                prodSql = `SELECT pl.product_id, MIN(pl.expiry_date) as min_expiry
                      FROM product_lots pl
                      JOIN products p ON pl.product_id = p.id
                      WHERE pl.company_id = ? AND pl.quantity > 0 AND pl.expiry_date IS NOT NULL
                      AND (p.name LIKE ? OR p.sku LIKE ?)
                      GROUP BY pl.product_id
                      ORDER BY min_expiry ASC
                      LIMIT ? OFFSET ?`;
                prodArgs = [activeCompanyId, likeTerm, likeTerm, productLimit, productOffset];
            } else {
                prodSql = `SELECT product_id, MIN(expiry_date) as min_expiry
                      FROM product_lots
                      WHERE company_id = ? AND quantity > 0 AND expiry_date IS NOT NULL
                      GROUP BY product_id
                      ORDER BY min_expiry ASC
                      LIMIT ? OFFSET ?`;
                prodArgs = [activeCompanyId, productLimit, productOffset];
            }
            const prodRes = await turso.execute({ sql: prodSql, args: prodArgs });

            const productIds = prodRes.rows.map(r => r.product_id);
            if (productIds.length === 0) return { products: [], hasMore: false };

            // Step 2: Fetch ALL lots for those products
            const placeholders = productIds.map(() => '?').join(',');
            const sql = `SELECT pl.*, 
                p.name as p_name, p.sku as p_sku, p.image as p_image, 
                p.stock as p_stock, p.unit as p_unit, p.price as p_price, 
                pu.invoice_number as invoice_number, pu.date as purchase_date 
                FROM product_lots pl 
                JOIN products p ON pl.product_id = p.id 
                LEFT JOIN purchases pu ON pl.purchase_id = pu.id 
                WHERE pl.company_id = ? AND pl.quantity > 0 
                AND pl.product_id IN (${placeholders})
                ORDER BY pl.product_id, (pl.expiry_date IS NULL) ASC, pl.expiry_date ASC`;

            const res = await turso.execute({ sql, args: [activeCompanyId, ...productIds] });

            const lots = res.rows.map(row => ({
                id: row.id,
                product_id: row.product_id,
                batch_number: row.batch_number,
                expiry_date: row.expiry_date,
                quantity: row.quantity,
                initial_quantity: row.initial_quantity || row.quantity,
                cost: row.cost,
                supplier_name: row.supplier_name,
                created_at: row.created_at,
                purchase_id: row.purchase_id,
                invoice_number: row.invoice_number || null,
                purchase_date: row.purchase_date || null,
                product_name: row.p_name,
                product_sku: row.p_sku,
                product_image: row.p_image,
                product_stock: row.p_stock,
                product_unit: row.p_unit,
                product_price: row.p_price
            }));

            return { products: lots, hasMore: productIds.length === productLimit };
        } catch (e) {
            console.error("Error fetching product lots report:", e);
            return { products: [], hasMore: false };
        }
    },

    fetchProductLotsGlobalStats: async () => {
        const { activeCompanyId } = get();
        try {
            // Calculate stats server-side
            const today = new Date().toISOString().split('T')[0];
            // Calc date + 30 days for "near expiry" (matching the default logic in component)
            const d = new Date();
            d.setDate(d.getDate() + 30);
            const nextMonth = d.toISOString().split('T')[0];

            // Params: today (expired <), today (near >=), nextMonth (near <=), today (value <), today (valid >=), today(valid_near_start), nextMonth(valid_near_end), company
            // Simplified valid logic: Total - Expired - Near = Valid (roughly, seeing how component did it)
            // Component logic: 
            // - Expired: < today
            // - Near: >= startDate (today) AND <= endDate (today+1mo)
            // - Valid: The rest.

            const res = await turso.execute({
                sql: `SELECT 
                        COUNT(*) as total_lots,
                        COUNT(DISTINCT product_id) as total_products,
                        SUM(CASE WHEN expiry_date < ? THEN 1 ELSE 0 END) as expired_lots,
                        SUM(CASE WHEN expiry_date >= ? AND expiry_date <= ? THEN 1 ELSE 0 END) as near_expiry_lots,
                        SUM(CASE WHEN expiry_date < ? THEN (cost * quantity) ELSE 0 END) as expiry_value_lost
                      FROM product_lots 
                      WHERE company_id = ? AND quantity > 0`,
                args: [today, today, nextMonth, today, activeCompanyId]
            });

            const row = res.rows[0];
            const total = row.total_lots || 0;
            const expired = row.expired_lots || 0;
            const near = row.near_expiry_lots || 0;
            const valid = total - expired - near; // Derive valid from others to ensure sum matches

            return {
                validLots: valid,
                nearExpiryLots: near,
                expiredLots: expired,
                totalLots: total,
                totalItems: row.total_products || 0,
                expiryValueLost: row.expiry_value_lost || 0
            };
        } catch (e) {
            console.error("Error fetching stats:", e);
            return null;
        }
    },

    // Write off an expired lot: moves it to inventory_losses and sets quantity to 0
    // reason: 'expired' (pérdida) | 'supplier_exchange' (cambio proveedor)
    writeOffExpiredLot: async (lot, notes = '', reason = 'expired') => {
        const { activeCompanyId, currentUser } = get();
        try {
            const now = new Date().toISOString();
            const totalLoss = reason === 'expired' ? (lot.cost || 0) * (lot.quantity || 0) : 0;

            await turso.batch([
                // 1. Record the loss
                {
                    sql: `INSERT INTO inventory_losses (company_id, lot_id, product_id, product_name, product_sku, batch_number, expiry_date, quantity, cost_per_unit, total_loss, reason, notes, user_id, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [
                        activeCompanyId,
                        lot.id,
                        lot.product_id,
                        lot.product_name || '',
                        lot.product_sku || '',
                        lot.batch_number || '',
                        lot.expiry_date || null,
                        lot.quantity,
                        lot.cost || 0,
                        totalLoss,
                        reason,
                        notes,
                        currentUser?.id || null,
                        now
                    ]
                },
                // 2. Deduct from product stock
                {
                    sql: `UPDATE products SET stock = ROUND(stock - ?, 3) WHERE id = ? AND company_id = ?`,
                    args: [lot.quantity, lot.product_id, activeCompanyId]
                },
                // 3. Zero out the lot
                {
                    sql: `UPDATE product_lots SET quantity = 0 WHERE id = ?`,
                    args: [lot.id]
                },
                // 4. Audit log
                {
                    sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'WRITE_OFF', 'LOT', ?, ?)`,
                    args: [activeCompanyId, currentUser?.id, JSON.stringify({ lot_id: lot.id, product: lot.product_name, quantity: lot.quantity, loss: totalLoss, reason }), now]
                }
            ]);

            // Update local state
            set((state) => ({
                productLots: state.productLots.map(l =>
                    l.id === lot.id ? { ...l, quantity: 0 } : l
                ),
                products: state.products.map(p =>
                    p.id === lot.product_id
                        ? { ...p, stock: Math.round((p.stock - lot.quantity) * 1000) / 1000 }
                        : p
                )
            }));

            return { success: true, totalLoss };
        } catch (e) {
            console.error('Error writing off lot:', e);
            return { success: false, error: e.message };
        }
    },

    // Write off ALL expired lots for a product at once
    // reason: 'expired' | 'supplier_exchange'
    writeOffAllExpiredLots: async (lots, notes = '', reason = 'expired') => {
        const { activeCompanyId, currentUser } = get();
        try {
            const now = new Date().toISOString();
            const queries = [];
            let totalLossSum = 0;
            let totalQtySum = 0;
            const productStockDeductions = new Map();

            for (const lot of lots) {
                const totalLoss = reason === 'expired' ? (lot.cost || 0) * (lot.quantity || 0) : 0;
                totalLossSum += totalLoss;
                totalQtySum += lot.quantity;

                const prev = productStockDeductions.get(lot.product_id) || 0;
                productStockDeductions.set(lot.product_id, prev + lot.quantity);

                queries.push({
                    sql: `INSERT INTO inventory_losses (company_id, lot_id, product_id, product_name, product_sku, batch_number, expiry_date, quantity, cost_per_unit, total_loss, reason, notes, user_id, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [activeCompanyId, lot.id, lot.product_id, lot.product_name || '', lot.product_sku || '', lot.batch_number || '', lot.expiry_date || null, lot.quantity, lot.cost || 0, totalLoss, reason, notes, currentUser?.id || null, now]
                });
                queries.push({
                    sql: `UPDATE product_lots SET quantity = 0 WHERE id = ?`,
                    args: [lot.id]
                });
            }

            // Deduct stock per product
            for (const [productId, qty] of productStockDeductions) {
                queries.push({
                    sql: `UPDATE products SET stock = ROUND(stock - ?, 3) WHERE id = ? AND company_id = ?`,
                    args: [qty, productId, activeCompanyId]
                });
            }

            // Audit
            queries.push({
                sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'WRITE_OFF_BATCH', 'LOT', ?, ?)`,
                args: [activeCompanyId, currentUser?.id, JSON.stringify({ lots_count: lots.length, total_qty: totalQtySum, total_loss: totalLossSum }), now]
            });

            await turso.batch(queries);

            // Update local state
            const lotIds = new Set(lots.map(l => l.id));
            set((state) => ({
                productLots: state.productLots.map(l =>
                    lotIds.has(l.id) ? { ...l, quantity: 0 } : l
                ),
                products: state.products.map(p => {
                    const deduction = productStockDeductions.get(p.id);
                    if (deduction) {
                        return { ...p, stock: Math.round((p.stock - deduction) * 1000) / 1000 };
                    }
                    return p;
                })
            }));

            return { success: true, totalLoss: totalLossSum, lotsProcessed: lots.length };
        } catch (e) {
            console.error('Error batch writing off lots:', e);
            return { success: false, error: e.message };
        }
    },

    // Fetch inventory losses history
    fetchInventoryLosses: async (limit = 50, offset = 0) => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: `SELECT il.*, u.name as user_name
                      FROM inventory_losses il
                      LEFT JOIN users u ON il.user_id = u.id
                      WHERE il.company_id = ?
                      ORDER BY il.created_at DESC
                      LIMIT ? OFFSET ?`,
                args: [activeCompanyId, limit, offset]
            });
            return res.rows;
        } catch (e) {
            console.error('Error fetching inventory losses:', e);
            return [];
        }
    },

    // Get summary stats of inventory losses
    fetchInventoryLossesStats: async () => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: `SELECT 
                        COUNT(*) as total_records,
                        SUM(quantity) as total_units,
                        SUM(CASE WHEN reason = 'expired' THEN total_loss ELSE 0 END) as total_value,
                        SUM(CASE WHEN reason = 'supplier_exchange' THEN quantity ELSE 0 END) as total_exchanged_units,
                        SUM(CASE WHEN reason = 'supplier_exchange' THEN 1 ELSE 0 END) as total_exchanges,
                        COUNT(DISTINCT product_id) as total_products
                      FROM inventory_losses
                      WHERE company_id = ?`,
                args: [activeCompanyId]
            });
            return res.rows[0] || { total_records: 0, total_units: 0, total_value: 0, total_products: 0, total_exchanged_units: 0, total_exchanges: 0 };
        } catch (e) {
            console.error('Error fetching loss stats:', e);
            return { total_records: 0, total_units: 0, total_value: 0, total_products: 0 };
        }
    },

    // ============ INVENTORY CONTROL (STOCK TAKE) ============

    createInventoryControl: async ({ name, type, category }) => {
        const { activeCompanyId, currentUser } = get();
        try {
            const now = new Date().toISOString();
            // Check for existing active control for THIS user
            const existing = await turso.execute({
                sql: `SELECT id, user_name, started_at FROM inventory_controls WHERE company_id = ? AND user_id = ? AND status = 'in_progress' LIMIT 1`,
                args: [activeCompanyId, currentUser?.id]
            });
            if (existing.rows.length > 0) {
                const e = existing.rows[0];
                return { success: false, error: `Ya tienes un control en progreso desde ${e.started_at}`, existing: e };
            }
            // Count total products for scope
            let totalProducts = 0;
            if (type === 'complete') {
                const cnt = await turso.execute({ sql: `SELECT COUNT(*) as c FROM products WHERE company_id = ?`, args: [activeCompanyId] });
                totalProducts = cnt.rows[0]?.c || 0;
            } else if (type === 'category') {
                const cnt = await turso.execute({ sql: `SELECT COUNT(*) as c FROM products WHERE company_id = ? AND category = ?`, args: [activeCompanyId, category] });
                totalProducts = cnt.rows[0]?.c || 0;
            } else if (type === 'supplier') {
                const cnt = await turso.execute({ sql: `SELECT COUNT(*) as c FROM products WHERE company_id = ? AND supplier = ?`, args: [activeCompanyId, category] });
                totalProducts = cnt.rows[0]?.c || 0;
            }
            const res = await turso.execute({
                sql: `INSERT INTO inventory_controls (company_id, user_id, user_name, name, type, category, status, total_products, counted_products, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, 0, ?, ?)`,
                args: [activeCompanyId, currentUser?.id, currentUser?.name || currentUser?.username || 'Usuario', name, type, category || null, totalProducts, now, now]
            });
            return { success: true, control: { id: Number(res.lastInsertRowid), company_id: activeCompanyId, user_id: currentUser?.id, user_name: currentUser?.name || currentUser?.username, name, type, category, status: 'in_progress', total_products: totalProducts, counted_products: 0, started_at: now } };
        } catch (e) {
            console.error('Error creating inventory control:', e);
            return { success: false, error: e.message };
        }
    },

    fetchActiveInventoryControl: async () => {
        const { activeCompanyId, currentUser } = get();
        try {
            const res = await turso.execute({
                sql: `SELECT * FROM inventory_controls WHERE company_id = ? AND user_id = ? AND status = 'in_progress' LIMIT 1`,
                args: [activeCompanyId, currentUser?.id]
            });
            if (res.rows.length === 0) return null;
            return res.rows[0];
        } catch (e) {
            console.error('Error fetching active control:', e);
            return null;
        }
    },

    fetchControlProducts: async (controlId, { limit = 50, offset = 0, search = '', filter = 'all', type = 'complete', category = null } = {}) => {
        const { activeCompanyId } = get();
        try {
            let where = `WHERE p.company_id = ?`;
            let args = [activeCompanyId];
            if (type === 'category' && category) {
                where += ` AND p.category = ?`;
                args.push(category);
            }
            if (type === 'supplier' && category) {
                where += ` AND p.supplier = ?`;
                args.push(category);
            }
            if (search) {
                where += ` AND (p.name LIKE ? OR p.sku LIKE ?)`;
                args.push(`%${search}%`, `%${search}%`);
            }
            let having = '';
            if (filter === 'pending') having = `HAVING ci.id IS NULL`;
            else if (filter === 'counted') having = `HAVING ci.id IS NOT NULL`;

            const res = await turso.execute({
                sql: `SELECT p.id, p.name, p.sku, p.stock, p.cost, p.category, p.image, p.unit,
                             ci.id as item_id, ci.system_stock, ci.counted_stock, ci.difference, ci.counted_at
                      FROM products p
                      LEFT JOIN inventory_control_items ci ON ci.product_id = p.id AND ci.control_id = ?
                      ${where}
                      GROUP BY p.id
                      ${having}
                      ORDER BY ci.id IS NOT NULL ASC, p.name ASC
                      LIMIT ? OFFSET ?`,
                args: [controlId, ...args, limit, offset]
            });
            return res.rows;
        } catch (e) {
            console.error('Error fetching control products:', e);
            return [];
        }
    },

    saveControlItem: async (controlId, productId, countedStock) => {
        const { activeCompanyId, currentUser } = get();
        try {
            const now = new Date().toISOString();
            // Get current product data
            const prodRes = await turso.execute({
                sql: `SELECT id, name, sku, stock, cost FROM products WHERE id = ? AND company_id = ?`,
                args: [productId, activeCompanyId]
            });
            if (prodRes.rows.length === 0) return { success: false, error: 'Producto no encontrado' };
            const product = prodRes.rows[0];

            // Check if already counted in this control
            const existingItem = await turso.execute({
                sql: `SELECT id, system_stock FROM inventory_control_items WHERE control_id = ? AND product_id = ?`,
                args: [controlId, productId]
            });

            const roundedCount = Math.round(countedStock * 1000) / 1000;
            let systemStock;

            if (existingItem.rows.length > 0) {
                // RE-EDIT: revert to original system_stock, then apply new count
                systemStock = existingItem.rows[0].system_stock;
                const difference = Math.round((roundedCount - systemStock) * 1000) / 1000;
                // Update item
                await turso.execute({
                    sql: `UPDATE inventory_control_items SET counted_stock = ?, difference = ?, updated_at = ? WHERE control_id = ? AND product_id = ?`,
                    args: [roundedCount, difference, now, controlId, productId]
                });
                // Update product stock immediately
                await turso.execute({
                    sql: `UPDATE products SET stock = ROUND(?, 3) WHERE id = ? AND company_id = ?`,
                    args: [roundedCount, productId, activeCompanyId]
                });
                // Log stock adjustment
                if (Math.abs(roundedCount - (parseFloat(product.stock) || 0)) >= 0.001) {
                    await turso.execute({
                        sql: `INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [activeCompanyId, productId, currentUser?.id, currentUser?.name || currentUser?.username || 'Desconocido', product.stock, roundedCount, Math.round((roundedCount - product.stock) * 1000) / 1000, 'control_inventario', now]
                    });
                }
                // Audit log
                await turso.execute({
                    sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'INVENTORY_CONTROL', 'PRODUCT', ?, ?)`,
                    args: [activeCompanyId, currentUser?.id, JSON.stringify({ controlId, productId, productName: product.name, action: 're-edit', systemStock, oldCounted: product.stock, newCounted: roundedCount, difference }), now]
                });
                return { success: true, item: { product_id: productId, product_name: product.name, product_sku: product.sku, system_stock: systemStock, counted_stock: roundedCount, difference, cost: product.cost || 0, reEdit: true } };
            } else {
                // NEW count
                systemStock = product.stock;
                const difference = Math.round((roundedCount - systemStock) * 1000) / 1000;
                await turso.execute({
                    sql: `INSERT INTO inventory_control_items (control_id, product_id, product_name, product_sku, system_stock, counted_stock, difference, cost, counted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [controlId, productId, product.name, product.sku || '', systemStock, roundedCount, difference, product.cost || 0, now]
                });
                // Update product stock immediately
                await turso.execute({
                    sql: `UPDATE products SET stock = ROUND(?, 3) WHERE id = ? AND company_id = ?`,
                    args: [roundedCount, productId, activeCompanyId]
                });
                // Log stock adjustment
                if (Math.abs(roundedCount - systemStock) >= 0.001) {
                    await turso.execute({
                        sql: `INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [activeCompanyId, productId, currentUser?.id, currentUser?.name || currentUser?.username || 'Desconocido', systemStock, roundedCount, difference, 'control_inventario', now]
                    });
                }
                // Update counted_products counter
                await turso.execute({
                    sql: `UPDATE inventory_controls SET counted_products = counted_products + 1 WHERE id = ?`,
                    args: [controlId]
                });
                // Audit log
                await turso.execute({
                    sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'INVENTORY_CONTROL', 'PRODUCT', ?, ?)`,
                    args: [activeCompanyId, currentUser?.id, JSON.stringify({ controlId, productId, productName: product.name, action: 'count', systemStock, countedStock: roundedCount, difference }), now]
                });
                // Check inventory alerts after control (non-blocking)
                setTimeout(() => { get().checkInventoryAlerts([productId]); }, 100);

                return { success: true, item: { product_id: productId, product_name: product.name, product_sku: product.sku, system_stock: systemStock, counted_stock: roundedCount, difference, cost: product.cost || 0, reEdit: false } };
            }
        } catch (e) {
            console.error('Error saving control item:', e);
            return { success: false, error: e.message };
        }
    },

    removeControlItem: async (controlId, productId) => {
        const { activeCompanyId, currentUser } = get();
        try {
            const now = new Date().toISOString();
            const item = await turso.execute({
                sql: `SELECT * FROM inventory_control_items WHERE control_id = ? AND product_id = ?`,
                args: [controlId, productId]
            });
            if (item.rows.length === 0) return { success: false, error: 'Item no encontrado' };
            const row = item.rows[0];
            // Revert stock to system_stock
            await turso.execute({
                sql: `UPDATE products SET stock = ROUND(?, 3) WHERE id = ? AND company_id = ?`,
                args: [row.system_stock, productId, activeCompanyId]
            });
            await turso.execute({
                sql: `DELETE FROM inventory_control_items WHERE control_id = ? AND product_id = ?`,
                args: [controlId, productId]
            });
            await turso.execute({
                sql: `UPDATE inventory_controls SET counted_products = MAX(counted_products - 1, 0) WHERE id = ?`,
                args: [controlId]
            });
            await turso.execute({
                sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'INVENTORY_CONTROL', 'PRODUCT', ?, ?)`,
                args: [activeCompanyId, currentUser?.id, JSON.stringify({ controlId, productId, productName: row.product_name, action: 'remove', revertedTo: row.system_stock }), now]
            });
            return { success: true };
        } catch (e) {
            console.error('Error removing control item:', e);
            return { success: false, error: e.message };
        }
    },

    completeInventoryControl: async (controlId) => {
        const { activeCompanyId } = get();
        try {
            const now = new Date().toISOString();
            await turso.execute({
                sql: `UPDATE inventory_controls SET status = 'completed', completed_at = ? WHERE id = ? AND company_id = ?`,
                args: [now, controlId, activeCompanyId]
            });
            return { success: true };
        } catch (e) {
            console.error('Error completing control:', e);
            return { success: false, error: e.message };
        }
    },

    cancelInventoryControl: async (controlId) => {
        const { activeCompanyId } = get();
        try {
            const now = new Date().toISOString();
            await turso.execute({
                sql: `UPDATE inventory_controls SET status = 'cancelled', completed_at = ? WHERE id = ? AND company_id = ?`,
                args: [now, controlId, activeCompanyId]
            });
            return { success: true };
        } catch (e) {
            console.error('Error cancelling control:', e);
            return { success: false, error: e.message };
        }
    },

    fetchControlReport: async (controlId) => {
        try {
            const itemsRes = await turso.execute({
                sql: `SELECT * FROM inventory_control_items WHERE control_id = ? ORDER BY counted_at ASC`,
                args: [controlId]
            });
            const items = itemsRes.rows;
            const totalCounted = items.length;
            const withDifference = items.filter(i => Math.abs(i.difference) > 0.001);
            const missing = items.filter(i => i.difference < -0.001);
            const surplus = items.filter(i => i.difference > 0.001);
            const matched = items.filter(i => Math.abs(i.difference) <= 0.001);
            return {
                items,
                stats: {
                    totalCounted,
                    withDifference: withDifference.length,
                    missing: missing.length,
                    surplus: surplus.length,
                    matched: matched.length,
                    missingValue: Math.round(missing.reduce((s, i) => s + Math.abs(i.difference) * (i.cost || 0), 0) * 100) / 100,
                    surplusValue: Math.round(surplus.reduce((s, i) => s + i.difference * (i.cost || 0), 0) * 100) / 100,
                    totalDifferenceValue: Math.round(withDifference.reduce((s, i) => s + Math.abs(i.difference) * (i.cost || 0), 0) * 100) / 100
                }
            };
        } catch (e) {
            console.error('Error fetching control report:', e);
            return { items: [], stats: { totalCounted: 0, withDifference: 0, missing: 0, surplus: 0, matched: 0, missingValue: 0, surplusValue: 0, totalDifferenceValue: 0 } };
        }
    },

    fetchControlHistory: async (limit = 20, offset = 0) => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: `SELECT * FROM inventory_controls WHERE company_id = ? AND status IN ('completed', 'cancelled') ORDER BY completed_at DESC LIMIT ? OFFSET ?`,
                args: [activeCompanyId, limit, offset]
            });
            return res.rows;
        } catch (e) {
            console.error('Error fetching control history:', e);
            return [];
        }
    },

    // ============ INVENTORY RECONCILIATION ============

    fetchReconciliationData: async ({ limit = 30, offset = 0, search = '' } = {}) => {
        const { activeCompanyId } = get();
        try {
            const baseWhere = search
                ? `WHERE p.company_id = ? AND (p.name LIKE ? OR p.sku LIKE ?)`
                : `WHERE p.company_id = ?`;
            const baseArgs = search
                ? [activeCompanyId, `%${search}%`, `%${search}%`]
                : [activeCompanyId];

            // Stats query (only on first page without search to avoid repeated heavy queries)
            let stats = null;
            if (offset === 0 && !search) {
                const statsRes = await turso.execute({
                    sql: `SELECT 
                            COUNT(*) as total,
                            SUM(CASE WHEN diff > 0 THEN 1 ELSE 0 END) as stock_greater,
                            SUM(CASE WHEN diff < 0 THEN 1 ELSE 0 END) as lots_greater,
                            SUM(CASE WHEN sub.stock < 0 THEN 1 ELSE 0 END) as negative_stock
                          FROM (
                            SELECT p.stock, (p.stock - COALESCE(SUM(pl.quantity), 0)) as diff
                            FROM products p
                            LEFT JOIN product_lots pl ON pl.product_id = p.id AND pl.company_id = p.company_id AND pl.quantity > 0
                            WHERE p.company_id = ?
                            GROUP BY p.id
                            HAVING ABS(p.stock - COALESCE(SUM(pl.quantity), 0)) > 0.01 OR (p.stock < 0)
                          ) sub`,
                    args: [activeCompanyId]
                });
                const s = statsRes.rows[0];
                stats = { total: s.total || 0, stockGreater: s.stock_greater || 0, lotsGreater: s.lots_greater || 0, negativeStock: s.negative_stock || 0 };
            }

            // Paginated products query
            const res = await turso.execute({
                sql: `SELECT 
                        p.id, p.name, p.sku, p.stock, p.image, p.unit, p.cost,
                        COALESCE(SUM(pl.quantity), 0) as lots_total,
                        COUNT(pl.id) as lots_count
                      FROM products p
                      LEFT JOIN product_lots pl ON pl.product_id = p.id AND pl.company_id = p.company_id AND pl.quantity > 0
                      ${baseWhere}
                      GROUP BY p.id
                      HAVING ABS(p.stock - COALESCE(SUM(pl.quantity), 0)) > 0.01 OR (p.stock < 0)
                      ORDER BY ABS(p.stock - COALESCE(SUM(pl.quantity), 0)) DESC
                      LIMIT ? OFFSET ?`,
                args: [...baseArgs, limit, offset]
            });

            const products = res.rows.map(r => ({
                id: r.id, name: r.name, sku: r.sku, image: r.image, unit: r.unit, cost: r.cost,
                stock: r.stock, lots_total: r.lots_total, lots_count: r.lots_count,
                difference: Math.round((r.stock - r.lots_total) * 1000) / 1000
            }));

            return { products, hasMore: products.length === limit, stats };
        } catch (e) {
            console.error('Error fetching reconciliation data:', e);
            return { products: [], hasMore: false, stats: null };
        }
    },

    fetchProductLotsForReconciliation: async (productId) => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: `SELECT pl.*, pu.invoice_number 
                      FROM product_lots pl
                      LEFT JOIN purchases pu ON pl.purchase_id = pu.id
                      WHERE pl.product_id = ? AND pl.company_id = ?
                      ORDER BY pl.quantity > 0 DESC, pl.expiry_date ASC`,
                args: [productId, activeCompanyId]
            });
            return res.rows;
        } catch (e) {
            console.error('Error fetching lots for reconciliation:', e);
            return [];
        }
    },

    reconcileProduct: async (productId, action, notes = '') => {
        // action: 'adjust_stock' = set product.stock to match lots total
        //         'adjust_lots' = zero out lot quantities to match stock (0)
        const { activeCompanyId, currentUser } = get();
        try {
            const now = new Date().toISOString();

            if (action === 'adjust_stock') {
                // Get current lots total
                const lotsRes = await turso.execute({
                    sql: `SELECT COALESCE(SUM(quantity), 0) as total FROM product_lots WHERE product_id = ? AND company_id = ? AND quantity > 0`,
                    args: [productId, activeCompanyId]
                });
                const lotsTotal = lotsRes.rows[0]?.total || 0;

                // Get current stock for audit
                const prodRes = await turso.execute({
                    sql: `SELECT stock, name FROM products WHERE id = ? AND company_id = ?`,
                    args: [productId, activeCompanyId]
                });
                const oldStock = prodRes.rows[0]?.stock || 0;
                const productName = prodRes.rows[0]?.name || '';

                await turso.execute({
                    sql: `UPDATE products SET stock = ? WHERE id = ? AND company_id = ?`,
                    args: [lotsTotal, productId, activeCompanyId]
                });

                // Log stock adjustment
                if (Math.abs(lotsTotal - oldStock) >= 0.001) {
                    await turso.execute({
                        sql: `INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [activeCompanyId, productId, currentUser?.id, currentUser?.name || currentUser?.username || 'Desconocido', oldStock, lotsTotal, Math.round((lotsTotal - oldStock) * 1000) / 1000, 'reconciliacion', now]
                    });
                }

                await turso.execute({
                    sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'RECONCILIATION', 'INVENTORY', ?, ?)`,
                    args: [activeCompanyId, currentUser?.id,
                        JSON.stringify({ productId, productName, action: 'adjust_stock', oldStock, newStock: lotsTotal, notes }),
                        now]
                });

                // Update Zustand state
                set(state => ({
                    products: state.products.map(p =>
                        p.id === productId ? { ...p, stock: lotsTotal } : p
                    )
                }));

                return { success: true, message: `Stock ajustado de ${oldStock} a ${lotsTotal}` };
            }

            if (action === 'adjust_lots') {
                // Get product stock
                const prodRes = await turso.execute({
                    sql: `SELECT stock, name FROM products WHERE id = ? AND company_id = ?`,
                    args: [productId, activeCompanyId]
                });
                const currentStock = prodRes.rows[0]?.stock || 0;
                const productName = prodRes.rows[0]?.name || '';

                const today = now.slice(0, 10); // 'YYYY-MM-DD'

                // 1) Set all EXPIRED lots to 0
                const expiredRes = await turso.execute({
                    sql: `SELECT id, quantity FROM product_lots WHERE product_id = ? AND company_id = ? AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date < ?`,
                    args: [productId, activeCompanyId, today]
                });
                for (const lot of expiredRes.rows) {
                    await turso.execute({
                        sql: `UPDATE product_lots SET quantity = 0 WHERE id = ?`,
                        args: [lot.id]
                    });
                }

                // 2) Get only ACTIVE lots (not expired) ordered by FEFO
                const lotsRes = await turso.execute({
                    sql: `SELECT id, quantity, expiry_date FROM product_lots WHERE product_id = ? AND company_id = ? AND quantity > 0 AND (expiry_date IS NULL OR expiry_date >= ?) ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC`,
                    args: [productId, activeCompanyId, today]
                });

                const lots = lotsRes.rows;
                let remaining = Math.max(currentStock, 0);
                const updates = [];

                for (const lot of lots) {
                    if (remaining <= 0) {
                        updates.push({ id: lot.id, newQty: 0 });
                    } else {
                        const assign = Math.min(lot.quantity, remaining);
                        updates.push({ id: lot.id, newQty: assign });
                        remaining -= assign;
                    }
                }

                // Execute updates on active lots
                for (const u of updates) {
                    await turso.execute({
                        sql: `UPDATE product_lots SET quantity = ? WHERE id = ?`,
                        args: [u.newQty, u.id]
                    });
                }

                await turso.execute({
                    sql: `INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, 'RECONCILIATION', 'INVENTORY', ?, ?)`,
                    args: [activeCompanyId, currentUser?.id,
                        JSON.stringify({ productId, productName, action: 'adjust_lots', stock: currentStock, lotsAdjusted: updates.length, notes }),
                        now]
                });

                return { success: true, message: `${updates.length} lotes ajustados al stock (${currentStock})` };
            }

            return { success: false, error: 'Acción no válida' };
        } catch (e) {
            console.error('Error reconciling product:', e);
            return { success: false, error: e.message };
        }
    },

    reconcileAllProducts: async (products, action, notes = '') => {
        const { reconcileProduct } = get();
        let success = 0;
        let failed = 0;
        for (const product of products) {
            const result = await reconcileProduct(product.id, action, notes);
            if (result.success) success++;
            else failed++;
        }
        return { success: true, message: `${success} productos conciliados, ${failed} errores` };
    },

    fetchProductProfitReport: async (startDate, endDate) => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT 
                        pdp.day,
                        pdp.product_id,
                        pdp.total_quantity,
                        pdp.total_revenue,
                        pdp.total_cost,
                        pdp.total_profit,
                        p.name as product_name,
                        p.sku as product_sku
                      FROM product_daily_profit pdp
                      JOIN products p ON pdp.product_id = p.id
                      WHERE pdp.company_id = ?
                      AND pdp.day >= ?
                      AND pdp.day <= ?
                      ORDER BY pdp.day DESC, pdp.total_revenue DESC`,
                args: [activeCompanyId, startDate, endDate]
            });

            return result.rows.map(row => ({
                day: row.day,
                productId: row.product_id,
                productName: row.product_name,
                barcode: row.product_sku || '-',
                quantity: row.total_quantity,
                totalSale: row.total_revenue,
                totalCost: row.total_cost,
                totalProfit: row.total_profit,
                unitCost: row.total_quantity > 0 ? row.total_cost / row.total_quantity : 0,
                unitPrice: row.total_quantity > 0 ? row.total_revenue / row.total_quantity : 0
            }));
        } catch (e) {
            console.error("Error fetching report:", e);
            return [];
        }
    },

    recalculateProductProfits: async () => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        try {
            console.time('⏱️ recalculateProductProfits');
            console.log('🔄 Starting full backfill of product_daily_profit...');

            // 2. Fetch and Process Sales in Batches (Pagination to avoid Mem/Response limits)
            const BATCH_SIZE = 100;
            const dailyData = {}; // Key: "day_productId"
            let offset = 0;
            let hasMore = true;
            let totalSalesProcessed = 0;

            console.log(`🔄 Fetching sales for company: ${activeCompanyId}...`);

            while (hasMore) {
                const salesRes = await turso.execute({
                    sql: "SELECT id, date, items FROM sales WHERE company_id = ? AND status != 'cancelled' LIMIT ? OFFSET ?",
                    args: [activeCompanyId, BATCH_SIZE, offset]
                });

                const sales = salesRes.rows;
                if (sales.length < BATCH_SIZE) {
                    hasMore = false;
                } else {
                    offset += BATCH_SIZE;
                }

                if (sales.length > 0) {
                    totalSalesProcessed += sales.length;
                    // 3. Process Batch
                    sales.forEach(sale => {
                        if (!sale.items) return;

                        // Format date to company day YYYY-MM-DD
                        const day = formatInCompanyTime(sale.date, currentCompanyTimezone, 'yyyy-MM-dd');

                        let items = [];
                        try { items = JSON.parse(sale.items); } catch (e) { return; }

                        items.forEach(item => {
                            const pid = item.id;
                            const key = `${day}_${pid}`;

                            if (!dailyData[key]) {
                                dailyData[key] = {
                                    company_id: activeCompanyId,
                                    product_id: pid,
                                    day: day,
                                    total_quantity: 0,
                                    total_revenue: 0,
                                    total_cost: 0,
                                    total_tax: 0,
                                    total_profit: 0
                                };
                            }

                            const qty = parseFloat(item.quantity) || 0;
                            const price = parseFloat(item.price) || 0;
                            const cost = parseFloat(item.cost) || 0;

                            // Simplified tax logic matching addSale
                            const taxRate = parseFloat(item.tax_rate) || 0;
                            const netPriceTax = price / (1 + (taxRate / 100));

                            const revenue = price * qty;
                            const costTotal = cost * qty;
                            const taxTotal = revenue - (netPriceTax * qty);
                            const profitTotal = (netPriceTax - cost) * qty;

                            dailyData[key].total_quantity += qty;
                            dailyData[key].total_revenue += revenue;
                            dailyData[key].total_cost += costTotal;
                            dailyData[key].total_tax += taxTotal;
                            dailyData[key].total_profit += profitTotal;
                        });
                    });
                }
            }

            // 4. Process Batch Inserts (Chunks of 50 to avoid limits)
            const entries = Object.values(dailyData);
            console.log(`📝 Backfill Debug: Processed ${totalSalesProcessed} sales. Generated ${entries.length} daily stats.`);

            if (entries.length === 0) {
                console.warn("⚠️ No entries generated. Aborting delete to preserve existing data.");
                return { success: false, count: 0, message: "No data found to recalculate." };
            }

            // ONLY DELETE IF WE HAVE DATA TO REPLACE
            console.log("🗑️ Clearing old product_daily_profit records...");
            await turso.execute({
                sql: "DELETE FROM product_daily_profit WHERE company_id = ?",
                args: [activeCompanyId]
            });

            const INSERT_BATCH_SIZE = 50;
            let insertedCount = 0;

            for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
                const batch = entries.slice(i, i + INSERT_BATCH_SIZE);
                const queries = [];

                for (const entry of batch) {
                    queries.push({
                        sql: `INSERT INTO product_daily_profit
                          (company_id, product_id, day, total_quantity, total_revenue, total_cost, total_tax, total_profit, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [
                            entry.company_id,
                            entry.product_id,
                            entry.day,
                            entry.total_quantity,
                            entry.total_revenue,
                            entry.total_cost,
                            entry.total_tax,
                            entry.total_profit,
                            new Date().toISOString()
                        ]
                    });
                }

                if (queries.length > 0) {
                    try {
                        await turso.batch(queries);
                        insertedCount += queries.length;
                    } catch (batchError) {
                        console.error("❌ Error inserting batch:", batchError);
                    }
                }
            }

            console.timeEnd('⏱️ recalculateProductProfits');
            console.log(`✅ Backfilled ${insertedCount} daily product records successfully.`);
            return { success: true, count: insertedCount };

        } catch (e) {
            console.error("Backfill error:", e);
            return { success: false, error: e.message };
        }
    },
    login: async (username, password) => {
        try {
            // 1. Autenticar usuario
            const result = await turso.execute({
                sql: "SELECT * FROM users WHERE username = ? AND password = ?",
                args: [username, password]
            });

            if (result.rows.length === 0) {
                return { success: false, error: "Usuario o contraseña incorrectos" };
            }

            const user = result.rows[0];

            // 2. Obtener empresas del usuario
            const companiesRes = await turso.execute({
                sql: `SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, uc.role,
                             c.status, c.trial_ends_at, c.subscription_id
                      FROM user_companies uc
                      JOIN companies c ON uc.company_id = c.id
                      WHERE uc.user_id = ? AND c.status IN ('active', 'trial')
                      ORDER BY c.id`,
                args: [user.id]
            });

            if (companiesRes.rows.length === 0) {
                return {
                    success: false,
                    error: "Este usuario no tiene empresas asignadas. Contacte al administrador."
                };
            }

            const userCompanies = companiesRes.rows;

            // 3. DETERMINAR EMPRESA ACTIVA (PRIORIDAD CORRECTA)
            let activeCompanyId;

            // Prioridad 1: company_id del usuario (su empresa "home")
            if (user.company_id && userCompanies.some(c => c.id === user.company_id)) {
                activeCompanyId = user.company_id;
            }
            // Prioridad 2: Última empresa guardada en localStorage
            else {
                const storedCompanyId = localStorage.getItem(`activeCompanyId:${user.id}`);
                if (storedCompanyId && userCompanies.some(c => c.id === storedCompanyId)) {
                    activeCompanyId = storedCompanyId;
                } else {
                    activeCompanyId = userCompanies[0].id;
                }
            }

            const activeCompany = userCompanies.find(c => c.id === activeCompanyId);

            // Sync user_companies.role if it differs from users.role (fixes desync from old bug)
            if (activeCompany.role !== user.role && user.role !== 'super_admin' && user.role !== 'owner') {
                console.log(`🔄 Syncing user_companies.role: ${activeCompany.role} → ${user.role}`);
                await turso.execute({
                    sql: "UPDATE user_companies SET role = ? WHERE user_id = ? AND company_id = ?",
                    args: [user.role, user.id, activeCompanyId]
                });
                activeCompany.role = user.role;
            }

            // --- VERIFICACIÓN DE SUSCRIPCIÓN ---
            // Solo para admin/users normales (Super Admin bypass?)
            // Asumimos que super_admin tiene rol 'super_admin' en users table o company role.
            if (user.role !== 'super_admin') {
                const now = new Date();

                // 1. Verificar estado base
                if (['suspended', 'cancelled'].includes(activeCompany.status)) {
                    return {
                        success: false,
                        error: `La cuenta de la empresa está ${activeCompany.status === 'suspended' ? 'suspendida' : 'cancelada'}. Contacte a soporte.`
                    };
                }

                if (activeCompany.status === 'pending_payment') {
                    return { success: false, error: 'Pago pendiente. Por favor complete el pago.' };
                }

                // 2. Verificar Pruebas vencidas
                if (activeCompany.status === 'trial' && activeCompany.trial_ends_at) {
                    const trialEnd = new Date(activeCompany.trial_ends_at);
                    if (now > trialEnd) {
                        // Actualizar a past_due
                        await turso.execute({
                            sql: "UPDATE companies SET status = 'past_due' WHERE id = ?",
                            args: [activeCompanyId]
                        });
                        return { success: false, needsRenewal: true, error: 'Tu periodo de prueba ha finalizado.' };
                    }
                }

                // 3. Verificar Suscripciones activas vencidas (si hay subscription_id)
                // Necesitamos hacer fetch de la suscripción para ver current_period_end?
                // O confiamos en que un cron job o webhook actualiza el status?
                // Para seguridad, verificamos aqui si tenemos los datos.
                // activeCompany en el SELECT de arriba NO trae subscription data.

                // Hacemos una query extra rápida para chequear validez
                const subCheck = await turso.execute({
                    sql: `SELECT s.status, s.current_period_end 
                          FROM companies c 
                          LEFT JOIN subscriptions s ON c.subscription_id = s.id 
                          WHERE c.id = ?`,
                    args: [activeCompanyId]
                });

                if (subCheck.rows.length > 0) {
                    const sub = subCheck.rows[0];
                    if (sub.status === 'active' && sub.current_period_end) {
                        const periodEnd = new Date(sub.current_period_end);
                        // Dar 2 días de gracia? No, estricto por ahora.
                        if (now > periodEnd) {
                            await turso.execute({
                                sql: "UPDATE companies SET status = 'past_due' WHERE id = ?",
                                args: [activeCompanyId]
                            });
                            // También update subscription?
                            if (sub.status === 'active') { // Update local db status if needed
                                await turso.execute({
                                    sql: "UPDATE subscriptions SET status = 'past_due' WHERE company_id = ?",
                                    args: [activeCompanyId]
                                });
                            }
                            return { success: false, needsRenewal: true, error: 'Tu suscripción ha vencido.' };
                        }
                    }
                }
            }
            // -----------------------------------

            // 4. Establecer estado
            set({
                currentUser: user,
                availableCompanies: userCompanies,
                activeCompanyId: activeCompanyId,
                currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                currentUserCompanyRole: activeCompany.role,
                inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1
            });

            // 5. Guardar en localStorage
            localStorage.setItem(`activeCompanyId:${user.id}`, activeCompanyId);

            // 6. FORZAR GUARDADO MANUAL DE SESIÓN (CRÍTICO)
            try {
                const persistedState = {
                    state: {
                        currentUser: user,
                        activeCompanyId: activeCompanyId,
                        availableCompanies: userCompanies,
                        currentCompanyTimezone: activeCompany.timezone || 'America/Santiago',
                        currentUserCompanyRole: activeCompany.role,
                        inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1,
                        darkMode: get().darkMode,
                        carts: get().carts,
                        activeCartId: get().activeCartId,
                        nextCartId: get().nextCartId
                    },
                    version: 0
                };

                localStorage.setItem('pos-storage', JSON.stringify(persistedState));
                console.log('💾 Session manually saved to localStorage');

                // Verificar que se guardó
                const saved = localStorage.getItem('pos-storage');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    console.log('✅ Verified saved user:', parsed?.state?.currentUser?.username);
                }
            } catch (e) {
                console.error('❌ Failed to save session manually:', e);
            }

            console.log('🔐 Login successful:', {
                user: user.username,
                homeCompany: user.company_id,
                activeCompany: activeCompanyId,
                availableCompanies: userCompanies.length
            });

            return { success: true };

        } catch (e) {
            console.error("Login error", e);
            return { success: false, error: "Error al iniciar sesión" };
        }
    },

    logout: () => {
        const { currentUser } = get();

        console.log('🚪 Logging out user:', currentUser?.username);

        // Reset fetch lock so login can trigger fetchInitialData again
        fetchInProgress = false;

        // Limpiar localStorage
        if (currentUser) {
            localStorage.removeItem(`activeCompanyId:${currentUser.id}`);
        }

        // LIMPIAR TODO EL ESTADO
        set({
            currentUser: null,
            availableCompanies: [],
            activeCompanyId: null,
            currentCompanyTimezone: 'America/Santiago',
            currentUserCompanyRole: null,
            products: [],
            productLots: [],
            categories: [],
            suppliers: [],
            users: [],        // ← CRÍTICO
            clients: [],
            sales: [],
            purchases: [],
            // Reset Multi-Cart
            carts: [
                {
                    id: 1,
                    name: 'Ticket 1',
                    items: [],
                    client: null,
                    createdAt: Date.now()
                }
            ],
            activeCartId: 1,
            nextCartId: 2,
            cashRegister: null,
            posSelectedClient: null,
            isLoading: false,
            error: null
        });

        console.log('✅ Logout complete - All state cleared');
    },

    addUser: async (user) => {
        const { activeCompanyId, currentUser } = get();

        // 🔒 VALIDACIÓN DE PERMISOS
        if (!currentUser || currentUser.role !== 'Administrador') {
            console.error('❌ Permission denied: Only administrators can add users');
            return {
                success: false,
                error: 'Acceso denegado. Solo administradores pueden crear usuarios.'
            };
        }

        try {
            // 1. Create User
            const result = await turso.execute({
                sql: `INSERT INTO users (
                    name, username, password, role, company_id,
                    has_labor_profile, labor_position, labor_branch, labor_start_date, labor_status, labor_pin,
                    pay_type, pay_method, pay_day, pay_base_amount, pay_fixed_bonus, pay_fixed_discount,
                    pay_bank_name, pay_bank_account, pay_bank_account_type, pay_bank_owner
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
                args: [
                    user.name, user.username, user.password || '123456', user.role, activeCompanyId,
                    user.has_labor_profile ? 1 : 0, user.labor_position, user.labor_branch, user.labor_start_date, user.labor_status, user.labor_pin,
                    user.pay_type, user.pay_method, user.pay_day, user.pay_base_amount, user.pay_fixed_bonus, user.pay_fixed_discount,
                    user.pay_bank_name, user.pay_bank_account, user.pay_bank_account_type, user.pay_bank_owner
                ]
            });
            const newUser = result.rows[0];

            // 2. Link to Company
            await turso.execute({
                sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)",
                args: [newUser.id, activeCompanyId, user.role]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, 'system', 'CREATE', 'USER', JSON.stringify({ username: user.username }), new Date().toISOString()]
            });

            set((state) => ({ users: [...state.users, newUser] }));
            return { success: true, user: newUser };
        } catch (e) {
            console.error("Add user error", e);
            return { success: false, error: e.message };
        }
    },

    updateUser: async (id, updatedUser) => {
        const { activeCompanyId, currentUser } = get();

        // 🔒 VALIDACIÓN DE PERMISOS
        if (!currentUser || (currentUser.role !== 'Administrador' && currentUser.role !== 'super_admin' && currentUser.username !== 'Super_admin')) {
            console.error('❌ Permission denied: Only administrators can update users');
            return {
                success: false,
                error: 'Acceso denegado. Solo administradores pueden modificar usuarios.'
            };
        }

        try {
            await turso.execute({
                sql: `UPDATE users SET 
                    name = ?, username = ?, role = ?,
                    has_labor_profile = ?, labor_position = ?, labor_branch = ?, labor_start_date = ?, labor_status = ?, labor_pin = ?,
                    pay_type = ?, pay_method = ?, pay_day = ?, pay_base_amount = ?, pay_fixed_bonus = ?, pay_fixed_discount = ?,
                    pay_bank_name = ?, pay_bank_account = ?, pay_bank_account_type = ?, pay_bank_owner = ?
                    WHERE id = ? AND company_id = ?`,
                args: [
                    updatedUser.name, updatedUser.username, updatedUser.role,
                    updatedUser.has_labor_profile ? 1 : 0, updatedUser.labor_position, updatedUser.labor_branch, updatedUser.labor_start_date, updatedUser.labor_status, updatedUser.labor_pin,
                    updatedUser.pay_type, updatedUser.pay_method, updatedUser.pay_day, updatedUser.pay_base_amount, updatedUser.pay_fixed_bonus, updatedUser.pay_fixed_discount,
                    updatedUser.pay_bank_name, updatedUser.pay_bank_account, updatedUser.pay_bank_account_type, updatedUser.pay_bank_owner,
                    id, activeCompanyId
                ]
            });

            // If a password is provided (and it's not empty), update it separately or include it.
            if (updatedUser.password) {
                await turso.execute({
                    sql: "UPDATE users SET password = ? WHERE id = ? AND company_id = ?",
                    args: [updatedUser.password, id, activeCompanyId]
                });
            }

            // Sync role in user_companies table (permissions use this role)
            await turso.execute({
                sql: "UPDATE user_companies SET role = ? WHERE user_id = ? AND company_id = ?",
                args: [updatedUser.role, id, activeCompanyId]
            });

            set((state) => ({
                users: state.users.map(u => u.id === id ? { ...u, ...updatedUser } : u)
            }));
        } catch (e) {
            console.error("Update user error", e);
        }
    },

    deleteUser: async (id) => {
        const { activeCompanyId, currentUser } = get();

        // 🔒 VALIDACIÓN DE PERMISOS
        if (!currentUser || currentUser.role !== 'Administrador') {
            console.error('❌ Permission denied: Only administrators can delete users');
            return {
                success: false,
                error: 'Acceso denegado. Solo administradores pueden eliminar usuarios.'
            };
        }

        try {
            await turso.execute({
                sql: "DELETE FROM users WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });
            set((state) => ({ users: state.users.filter(u => u.id !== id) }));
        } catch (e) {
            console.error("Delete user error", e);
        }
    },

    // ============================================
    // 🔐 ROLE PERMISSIONS ACTIONS
    // ============================================

    hasPermission: (permission) => {
        const { currentUser, currentUserCompanyRole, rolePermissions } = get();

        // 1. No user/role = No permission
        if (!currentUser) return false;

        // 2. Super Admin & Owner BYPASS
        // Check "super_admin" global role OR "owner"/"super_admin" company role
        if (currentUser.role === 'super_admin' || currentUser.role === 'owner') return true;
        if (currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin') return true;

        // 3. Administrador BYPASS (Optional - User asked to default explicit, but 'Administrador' usually means full access)
        // The prompt says "Administrador -> TODO habilitado" via DB, but having a fallback code bypass is safer/faster.
        if (currentUser.role === 'Administrador' || currentUserCompanyRole === 'Administrador') return true;

        // 4. Check specific permission
        if (!rolePermissions) return false; // Safety check
        const perm = rolePermissions.find(p => p.role === currentUserCompanyRole && p.permission === permission);

        // If permission record exists, use its value. 
        // If it doesn't exist, DEFAULT TO FALSE (Deny by default rule)
        // UNLESS it's a legacy user without migrated permissions? No, we seed them.
        return perm ? Number(perm.granted) === 1 : false;
    },

    fetchRolePermissions: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;

        try {
            // Load ALL permissions for the company (to manage them in settings)
            // Or just for the current user?
            // "Cargar permisos al login" implies current user needed for checks,
            // but "Settings" needs all roles. 
            // Let's load ALL for the company to be safe and simple.
            const res = await turso.execute({
                sql: "SELECT * FROM role_permissions WHERE company_id = ?",
                args: [activeCompanyId]
            });
            set({ rolePermissions: res.rows });
        } catch (e) {
            console.error("Error fetching role permissions:", e);
        }
    },

    updateRolePermission: async (role, permission, granted) => {
        const { activeCompanyId, currentUser, validateCompanyAccess } = get();
        // Validation commented out for debugging if needed, but usually kept
        if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) {
            console.error("updateRolePermission: Access Denied");
            return { success: false, error: "Access Denied" };
        }

        console.log(`[STORE] Updating permission: ${role} - ${permission} = ${granted}`);

        try {
            // Self-healing: REMOVE DUPLICATES first to allow unique index creation
            // We keep the one with the highest ROWID (latest) or just arbitrary one.
            // Actually, since we are about to set a specific value, we can just delete ALL for this user/role/perm
            // and then insert afresh. This is safer and cleaner than index fighting.

            // 1. Delete existing entries for this specific permission
            await turso.execute({
                sql: "DELETE FROM role_permissions WHERE company_id = ? AND role = ? AND permission = ?",
                args: [activeCompanyId, role, permission]
            });

            // 2. Try to create the index (now that we cleaned up this specific row, 
            // but there might be duplicates for *other* rows preventing index creation).
            // So we really should try to de-duplicate the WHOLE table if we want the index to live.
            try {
                // Nuclear option for duplicates: Keep only the latest rowid for each group
                await turso.execute(`
                    DELETE FROM role_permissions 
                    WHERE rowid NOT IN (
                        SELECT MAX(rowid) 
                        FROM role_permissions 
                        GROUP BY company_id, role, permission
                    )
                `);

                await turso.execute(`
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique 
                    ON role_permissions(company_id, role, permission)
                `);
            } catch (idxError) {
                console.warn("Index/Dedup warning:", idxError);
            }

            // 3. Insert the new value (fresh)
            await turso.execute({
                sql: `INSERT INTO role_permissions (company_id, role, permission, granted)
                      VALUES (?, ?, ?, ?)`,
                args: [activeCompanyId, role, permission, granted ? 1 : 0]
            });

            // Refresh local state
            await get().fetchRolePermissions();
            return { success: true };
        } catch (e) {
            console.error("Error updating permission (Role: " + role + ", Perm: " + permission + "):", e);
            return { success: false, error: e.message };
        }
    },



    // ============================================
    // 🎭 ROLE MANAGEMENT ACTIONS (NEW)
    // ============================================

    fetchCompanyRoles: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return [];

        try {
            // 1. Get custom roles
            const res = await turso.execute({
                sql: "SELECT * FROM custom_roles WHERE company_id = ?",
                args: [activeCompanyId]
            });

            const customRoles = res.rows;

            // 2. Define System Roles
            const systemRoles = [
                { role_name: 'Caja', is_system: 1, color: '#10b981', description: 'Caja registradora - cobros y pagos' },
                { role_name: 'Vendedor', is_system: 1, color: '#8b5cf6', description: 'Vendedor - crea preventas' },
                { role_name: 'Bodeguero', is_system: 1, color: '#f59e0b', description: 'Gestión de inventario' },
                { role_name: 'Supervisor', is_system: 1, color: '#3b82f6', description: 'Acceso a reportes y supervisión' }
            ];

            // 3. Merge system roles if not in DB (or force them to exist in return)
            // Ideally, we should sync standard roles to DB to allow editing colors/desc in future, 
            // but for now, we just ensure they are in the list.

            // Filter out system roles from customRoles if they accidentally got there with is_system=1
            // (Our migration logic below prevents this but good to be safe)

            // Let's just return combined list.
            // If we find system roles in DB, use them. If not, use defaults.
            const mergedRoles = [...customRoles];

            for (const sysRole of systemRoles) {
                if (!mergedRoles.find(r => r.role_name === sysRole.role_name)) {
                    mergedRoles.push(sysRole);

                    // Optional: Persist system roles to DB so they have IDs?
                    // For now, UI works with role_name as key.
                }
            }

            return mergedRoles;
        } catch (e) {
            console.warn("Error fetching company roles (likely table missing), returning defaults:", e);

            try {
                await turso.execute(`
                    CREATE TABLE IF NOT EXISTS custom_roles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        company_id TEXT NOT NULL,
                        role_name TEXT NOT NULL,
                        description TEXT,
                        color TEXT DEFAULT '#6366f1',
                        is_system INTEGER DEFAULT 0,
                        created_at TEXT,
                        UNIQUE(company_id, role_name)
                    )
                `);
            } catch (createError) {
                console.error("Failed to auto-create custom_roles table:", createError);
            }

            return [
                { role_name: 'Vendedor', is_system: 1, color: '#10b981', description: 'Rol base para ventas' },
                { role_name: 'Bodeguero', is_system: 1, color: '#f59e0b', description: 'Gestión de inventario' },
                { role_name: 'Supervisor', is_system: 1, color: '#3b82f6', description: 'Acceso a reportes y supervisión' }
            ];
        }
    },

    createCustomRole: async (roleName, description, color, copyFromRole) => {
        const { activeCompanyId, startLoading, stopLoading } = get();
        if (!activeCompanyId) return { success: false, error: "No company" };

        startLoading();
        try {
            // 1. Insert Role
            await turso.execute({
                sql: "INSERT INTO custom_roles (company_id, role_name, description, color, is_system, created_at) VALUES (?, ?, ?, ?, 0, ?)",
                args: [activeCompanyId, roleName, description, color, new Date().toISOString()]
            });

            // 2. Setup Permissions
            // If copyFromRole, copy their permissions
            // Else, insert explicit denied (granted=0) or just leave empty (default false)? 
            // Better to insert all known perms as 0 so they show up in UI if we iterate DB rows, 
            // but the UI iterates ALL_PERMISSIONS constant, checking DB.
            // So we primarily need to copy '1's if copyFromRole is set.

            if (copyFromRole) {
                // Copy granted permissions from source role
                await turso.execute({
                    sql: `INSERT INTO role_permissions (company_id, role, permission, granted)
                          SELECT company_id, ?, permission, granted 
                          FROM role_permissions 
                          WHERE company_id = ? AND role = ?`,
                    args: [roleName, activeCompanyId, copyFromRole]
                });
            } else {
                // Init with nothing? Or explicitly set 'granted=0' for everything?
                // Nothing is fine, hasPermission returns false if not found.
            }

            stopLoading();
            return { success: true };
        } catch (e) {
            console.error("Create role error:", e);
            stopLoading();
            return { success: false, error: e.message };
        }
    },

    deleteCustomRole: async (roleName) => {
        const { activeCompanyId, startLoading, stopLoading } = get();
        startLoading();
        try {
            // 1. Validate not system
            // (UI should block, but double check)

            // 2. Reassign users -> 'Vendedor'
            await turso.execute({
                sql: "UPDATE user_companies SET role = 'Caja' WHERE company_id = ? AND role = ?",
                args: [activeCompanyId, roleName]
            });

            // 3. Delete permissions
            await turso.execute({
                sql: "DELETE FROM role_permissions WHERE company_id = ? AND role = ?",
                args: [activeCompanyId, roleName]
            });

            // 4. Delete role
            await turso.execute({
                sql: "DELETE FROM custom_roles WHERE company_id = ? AND role_name = ? AND is_system = 0",
                args: [activeCompanyId, roleName]
            });

            stopLoading();
            return { success: true };
        } catch (e) {
            console.error("Delete role error:", e);
            stopLoading();
            return { success: false, error: e.message };
        }
    },

    renameCustomRole: async (oldName, newName) => {
        const { activeCompanyId, startLoading, stopLoading } = get();
        startLoading();
        try {
            // 1. Update custom_roles
            await turso.execute({
                sql: "UPDATE custom_roles SET role_name = ? WHERE company_id = ? AND role_name = ?",
                args: [newName, activeCompanyId, oldName]
            });

            // 2. Update role_permissions
            await turso.execute({
                sql: "UPDATE role_permissions SET role = ? WHERE company_id = ? AND role = ?",
                args: [newName, activeCompanyId, oldName]
            });

            // 3. Update user_companies
            await turso.execute({
                sql: "UPDATE user_companies SET role = ? WHERE company_id = ? AND role = ?",
                args: [newName, activeCompanyId, oldName]
            });

            stopLoading();
            return { success: true };
        } catch (e) {
            console.error("Rename role error:", e);
            stopLoading();
            return { success: false, error: e.message };
        }
    },

    togglePermission: async (role, permission, newValue) => {
        // Alias to updateRolePermission but matches the request naming consistency
        return get().updateRolePermission(role, permission, newValue);
    },

    resetRoleDefaults: async (role) => {
        const { activeCompanyId } = get();
        try {
            // 1. Delete all permissions for this role
            await turso.execute({
                sql: "DELETE FROM role_permissions WHERE company_id = ? AND role = ?",
                args: [activeCompanyId, role]
            });

            // 2. Re-seed (setupDefaultPermissions logic needs to be flexible or we just re-run it)
            // setupDefaultPermissions currently checks if count > 0 to skip.
            // We need a specific "seed role" function or just manually re-insert here.

            // Let's grab the PERMS definitions from setupDefaultPermissions logic
            // Copy-pasting the definition for safety and isolation
            const PERMS = {
                'Caja': [
                    'dashboard.view', 'dashboard.view_sales',
                    'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
                    'sales.view', 'sales.view_details',
                    'clients.view', 'clients.create', 'clients.view_account',
                    'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.complete',
                    'production.view', 'production.manage',
                    'personal.view', 'personal.attendance', 'personal.corrections',
                    'alerts.view'
                ],
                'Vendedor': [
                    'dashboard.view',
                    'pos.access', 'pos.preventa',
                    'clients.view', 'clients.create',
                    'personal.view', 'personal.attendance',
                    'alerts.view'
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
                    'alerts.view', 'alerts.manage'
                ],
                'Supervisor': [
                    'dashboard.view', 'dashboard.view_sales', 'dashboard.view_profits',
                    'sales.view', 'sales.view_details', 'sales.export',
                    'clients.view', 'clients.view_account',
                    'reports.sales', 'reports.expiring', 'reports.closures', 'reports.movements', 'reports.invoice_payments', 'reports.profit', 'reports.sales_analytics', 'reports.export',
                    'products.view', 'products.view_cost',
                    'taxes.view',
                    'combos.view',
                    'inventory_control.view',
                    'alerts.view',
                    'sii.view', 'sii.folios'
                ]
            };

            const allowed = PERMS[role];
            if (!allowed) return { success: false, error: "Role not found in defaults" };

            // Note: We only insert the '1's. The store check 'granted=1' handles the rest (defaults to false if missing).
            // But to be consistent with setupDefaultPermissions which inserts everything:
            // Actually, setupDefaultPermissions loops ALL_KNOWN_PERMISSIONS.
            // For reset, let's just insert the '1's. It's cleaner. 
            // Wait, existing logic inserts 0s too. Let's stick to inserting 1s for the reset. 
            // The hasPermission check: `perm ? perm.granted === 1 : false`. 
            // So if row is missing, it returns false. Only need to insert 1s.

            for (const p of allowed) {
                await turso.execute({
                    sql: "INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, 1)",
                    args: [activeCompanyId, role, p]
                });
            }

            await get().fetchRolePermissions();
            return { success: true };

        } catch (e) {
            console.error("Reset role error:", e);
            return { success: false, error: e.message };
        }
    },

    setupDefaultPermissions: async () => {
        const { activeCompanyId } = get();
        if (!activeCompanyId) return;

        try {
            const ROLES = ['Caja', 'Vendedor', 'Bodeguero', 'Supervisor']; // Admin is handled by code bypass or seeded separately
            const check = await turso.execute({
                sql: "SELECT COUNT(*) as count FROM role_permissions WHERE company_id = ?",
                args: [activeCompanyId]
            });

            if (Number(check.rows[0].count) > 0) return; // Already seeded

            console.log("🌱 Seeding default permissions for company:", activeCompanyId);

            // DEFINICIÓN DE PERMISOS
            const PERMS = {
                // Caja: POS completo, cobros, suspender, escanear preventas
                'Caja': [
                    'dashboard.view', 'dashboard.view_sales',
                    'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
                    'sales.view', 'sales.view_details',
                    'clients.view', 'clients.create', 'clients.view_account',
                    'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.complete',
                    'personal.view', 'personal.attendance', 'personal.corrections',
                    'alerts.view'
                ],
                // Vendedor: solo POS + preventas, sin caja ni cobros
                'Vendedor': [
                    'dashboard.view',
                    'pos.access', 'pos.preventa',
                    'clients.view', 'clients.create',
                    'personal.view', 'personal.attendance',
                    'alerts.view'
                ],
                // Bodeguero: Inventory, Orders, Combos, Control, Alerts
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
                    'alerts.view', 'alerts.manage'
                ],
                // Supervisor: Reports, View Only, Alerts, SII
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
                    'sii.view', 'sii.folios'
                ]
            };

            const queries = [];
            const ALL_KNOWN_PERMISSIONS = [
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
                'sii.view', 'sii.folios'
            ];

            // Generate Inserts
            for (const role of ROLES) {
                const allowed = PERMS[role] || [];

                // Strategy: Insert ALL permissions, setting granted=1 if in list, 0 otherwise
                for (const p of ALL_KNOWN_PERMISSIONS) {
                    queries.push({
                        sql: "INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)",
                        args: [activeCompanyId, role, p, allowed.includes(p) ? 1 : 0]
                    });
                }
            }

            // Also seed 'Administrador' with EVERYTHING enabled (just to show in UI)
            for (const p of ALL_KNOWN_PERMISSIONS) {
                queries.push({
                    sql: "INSERT INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)",
                    args: [activeCompanyId, 'Administrador', p, 1]
                });
            }

            if (queries.length > 0) {
                // Split into chunks to avoid argument limits
                const CHUNK_SIZE = 50;
                for (let i = 0; i < queries.length; i += CHUNK_SIZE) {
                    await turso.batch(queries.slice(i, i + CHUNK_SIZE));
                }
            }

            console.log("✅ Seeded default permissions.");

        } catch (e) {
            console.error("Error seeding permissions:", e);
        }
    },

    addProduct: async (product) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Pre-check: si el SKU ya existe para la misma empresa, evitamos crear
            // un duplicado silencioso (lo que confundía con un sync fallido). Si el
            // SKU está vacío o auto-generado tipo "QUICK-..." dejamos pasar.
            if (product.sku && !String(product.sku).startsWith('QUICK-')) {
                const dup = await turso.execute({
                    sql: 'SELECT id, name FROM products WHERE sku = ? AND company_id = ? LIMIT 1',
                    args: [product.sku, activeCompanyId],
                });
                if (dup.rows.length > 0) {
                    const existing = dup.rows[0];
                    return {
                        success: false,
                        error: 'SKU_DUPLICATE',
                        message: `Ya existe un producto con SKU ${product.sku}: "${existing.name}" (id=${existing.id}). Ábrelo desde el listado para editarlo.`,
                        existingProductId: existing.id,
                    };
                }
            }

            const result = await turso.execute({
                sql: "INSERT INTO products (name, price, stock, category, sku, image, cost, tax_rate, unit, supplier, is_offer, offer_price, price_ranges, scale_group_id, company_id, sale_mode, allow_item_notes, preorder_unit, preorder_billing_unit, preorder_price_per_kg, preorder_gram_per_unit, preorder_use_base_price, units_per_box) VALUES (?, ?, ROUND(?, 3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    product.name,
                    product.price,
                    product.stock,
                    product.category,
                    product.sku,
                    product.image || null,
                    product.cost || 0,
                    product.tax_rate || 0,
                    product.unit || 'Und',
                    product.supplier || null,
                    product.is_offer ? 1 : 0,
                    product.offer_price || 0,
                    JSON.stringify(product.price_ranges || []),
                    product.scale_group_id || null,
                    activeCompanyId,
                    product.sale_mode || 'sale_only',
                    product.allow_item_notes ? 1 : 0,
                    product.preorder_unit || null,
                    product.preorder_billing_unit || 'unit',
                    product.preorder_price_per_kg || 0,
                    product.preorder_gram_per_unit || 0,
                    product.preorder_use_base_price !== undefined ? (product.preorder_use_base_price ? 1 : 0) : 1,
                    product.units_per_box || 0
                ]
            });
            // Safely handle price_ranges for the local state update
            let parsedPriceRanges = [];
            try {
                // Try to use the returned DB value if possible, otherwise fall back to input
                const dbValue = result.rows[0].price_ranges;
                if (typeof dbValue === 'string') {
                    parsedPriceRanges = JSON.parse(dbValue);
                } else if (Array.isArray(dbValue)) {
                    parsedPriceRanges = dbValue;
                } else {
                    parsedPriceRanges = product.price_ranges || [];
                }
            } catch (e) {
                console.warn("Error parsing price_ranges from DB, using input", e);
                parsedPriceRanges = product.price_ranges || [];
            }

            const newProduct = { ...result.rows[0], price_ranges: parsedPriceRanges };

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'CREATE', 'PRODUCT', JSON.stringify({ name: product.name, sku: product.sku }), new Date().toISOString()]
            });

            set((state) => ({ products: [...state.products, newProduct].sort((a, b) => a.name.localeCompare(b.name)), _preorderCache: { key: '', products: [], ts: 0 } }));

            // POS -> Tienda: sincronizar producto nuevo si tiene SKU
            try {
                if (newProduct.sku && String(newProduct.sku).trim()) {
                    const syncPayload = {
                        id: newProduct.id,
                        sku: newProduct.sku,
                        name: newProduct.name,
                        category: newProduct.category,
                        stock: newProduct.stock,
                        price: newProduct.price,
                        cost: Number(newProduct.cost || 0),
                        unit: newProduct.unit || 'Und',
                        tax_rate: Number(newProduct.tax_rate || 0),
                        is_offer: newProduct.is_offer ? true : false,
                        offer_price: newProduct.is_offer ? Number(newProduct.offer_price || 0) : 0,
                        image: newProduct.image || null,
                        price_ranges: parsedPriceRanges || [],
                        sale_mode: newProduct.sale_mode || 'sale_only',
                        preorder_unit: newProduct.preorder_unit || null,
                        preorder_billing_unit: newProduct.preorder_billing_unit || 'unit',
                        preorder_price_per_kg: Number(newProduct.preorder_price_per_kg || 0),
                        preorder_gram_per_unit: Number(newProduct.preorder_gram_per_unit || 0),
                        preorder_use_base_price: newProduct.preorder_use_base_price !== undefined
                            ? Boolean(newProduct.preorder_use_base_price)
                            : true,
                        units_per_box: Number(newProduct.units_per_box || 0),
                    };
                    fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product: syncPayload })
                    }).then(async (res) => {
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) {
                            console.warn('Product sync post-create failed:', { id: newProduct.id, status: res.status, data });
                        } else {
                            console.log('✅ Product sync post-create success:', { id: newProduct.id, sku: newProduct.sku });
                        }
                    }).catch(syncError => {
                        console.warn('Product sync post-create error:', syncError);
                    });
                }
            } catch (syncError) {
                console.warn('Product sync post-create setup error:', syncError);
            }

            // Save alert config if provided
            if (product._alertConfig) {
                get().saveAlertSettings(newProduct.id, product._alertConfig).catch(e => console.warn('Alert settings save error:', e));
            }

            return { success: true, product: newProduct };
        } catch (e) {
            console.error("Add product error", e);
            return { success: false, error: e.message };
        }
    },

    updateProduct: async (id, updatedProduct) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Detect stock change before update
            const oldProduct = get().products.find(p => p.id === id);
            const oldStock = oldProduct ? parseFloat(oldProduct.stock) || 0 : 0;
            const newStock = Math.round((parseFloat(updatedProduct.stock) || 0) * 1000) / 1000;
            const stockChanged = Math.abs(newStock - oldStock) >= 0.001;

            await turso.execute({
                sql: "UPDATE products SET name=?, price=?, stock=ROUND(?, 3), category=?, sku=?, image=?, cost=?, tax_rate=?, unit=?, supplier=?, is_offer=?, offer_price=?, price_ranges=?, scale_group_id=?, sale_mode=?, allow_item_notes=?, preorder_unit=?, preorder_billing_unit=?, preorder_price_per_kg=?, preorder_gram_per_unit=?, preorder_use_base_price=?, units_per_box=? WHERE id = ? AND company_id = ?",
                args: [
                    updatedProduct.name,
                    updatedProduct.price,
                    updatedProduct.stock,
                    updatedProduct.category,
                    updatedProduct.sku,
                    updatedProduct.image,
                    updatedProduct.cost || 0,
                    updatedProduct.tax_rate || 0,
                    updatedProduct.unit || 'Und',
                    updatedProduct.supplier || null,
                    updatedProduct.is_offer ? 1 : 0,
                    updatedProduct.offer_price || 0,
                    JSON.stringify(updatedProduct.price_ranges || []),
                    updatedProduct.scale_group_id || null,
                    updatedProduct.sale_mode || 'sale_only',
                    updatedProduct.allow_item_notes ? 1 : 0,
                    updatedProduct.preorder_unit || null,
                    updatedProduct.preorder_billing_unit || 'unit',
                    updatedProduct.preorder_price_per_kg || 0,
                    updatedProduct.preorder_gram_per_unit || 0,
                    updatedProduct.preorder_use_base_price !== undefined ? (updatedProduct.preorder_use_base_price ? 1 : 0) : 1,
                    updatedProduct.units_per_box || 0,
                    id,
                    activeCompanyId
                ]
            });

            // Log stock adjustment if stock changed
            if (stockChanged) {
                const now = new Date().toISOString();
                await turso.execute({
                    sql: `INSERT INTO stock_adjustments (company_id, product_id, user_id, user_name, old_stock, new_stock, difference, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [activeCompanyId, id, currentUser?.id, currentUser?.name || currentUser?.username || 'Desconocido', oldStock, newStock, Math.round((newStock - oldStock) * 1000) / 1000, 'manual', now]
                });
            }

            // POS -> Tienda: sincronizar producto completo al editar
            try {
                if (updatedProduct.sku && normalizeSku(updatedProduct.sku)) {
                    // Solo enviar imagen si realmente cambió (evitar enviar ~200KB base64 cada vez)
                    const oldProd = get().products.find(p => p.id === id);
                    const imageChanged = updatedProduct.image !== (oldProd?.image || null);
                    console.log('🔄 Sync:', { sku: updatedProduct.sku, imageChanged, hasImage: !!updatedProduct.image });

                    const syncPayload = {
                        id,
                        sku: updatedProduct.sku,
                        name: updatedProduct.name,
                        category: updatedProduct.category,
                        stock: updatedProduct.stock,
                        price: updatedProduct.price,
                        cost: Number(updatedProduct.cost || 0),
                        unit: updatedProduct.unit || 'Und',
                        tax_rate: Number(updatedProduct.tax_rate || 0),
                        is_offer: updatedProduct.is_offer ? true : false,
                        offer_price: updatedProduct.is_offer ? Number(updatedProduct.offer_price || 0) : 0,
                        price_ranges: updatedProduct.price_ranges || [],
                        // Modo del producto y configuración de encargo (consumido por la tienda
                        // para decidir visibilidad / tipo de producto). Si la tienda ignora estos
                        // campos no pasa nada, se mantiene compatibilidad atrás.
                        sale_mode: updatedProduct.sale_mode || 'sale_only',
                        preorder_unit: updatedProduct.preorder_unit || null,
                        preorder_billing_unit: updatedProduct.preorder_billing_unit || 'unit',
                        preorder_price_per_kg: Number(updatedProduct.preorder_price_per_kg || 0),
                        preorder_gram_per_unit: Number(updatedProduct.preorder_gram_per_unit || 0),
                        preorder_use_base_price: updatedProduct.preorder_use_base_price !== undefined
                            ? Boolean(updatedProduct.preorder_use_base_price)
                            : true,
                        units_per_box: Number(updatedProduct.units_per_box || 0),
                    };
                    if (imageChanged && updatedProduct.image) {
                        syncPayload.image = updatedProduct.image;
                    }

                    fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product: syncPayload })
                    }).then(async (res) => {
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) {
                            console.warn('Product sync post-edit failed:', { id, status: res.status, data });
                        } else {
                            console.log('✅ Product sync post-edit success:', { id, sku: updatedProduct.sku });
                        }
                    }).catch(syncError => {
                        console.warn('Product sync post-edit error:', syncError);
                    });
                }
            } catch (syncError) {
                console.warn('Product sync post-edit setup error:', syncError);
            }

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'UPDATE', 'PRODUCT', JSON.stringify({ id, updates: updatedProduct }), new Date().toISOString()]
            });

            set((state) => ({
                products: state.products.map((p) => p.id === id ? { ...p, ...updatedProduct } : p),
                _preorderCache: { key: '', products: [], ts: 0 }
            }));

            // Save alert config if provided
            if (updatedProduct._alertConfig) {
                get().saveAlertSettings(id, updatedProduct._alertConfig).catch(e => console.warn('Alert settings save error:', e));
            }

            return { success: true };
        } catch (e) {
            console.error("Update product error", e);
            return { success: false, error: e.message };
        }
    },

    syncSaleStockToStore: async ({ saleId, soldAt, items }) => {
        try {
            const { activeCompanyId } = get();

            if (!activeCompanyId || !Array.isArray(items) || items.length === 0) {
                console.warn('Stock sync skipped: payload incompleto', {
                    activeCompanyId,
                    saleId,
                    itemsCount: Array.isArray(items) ? items.length : 0,
                });
                return { success: false, error: 'Payload de sincronización incompleto' };
            }

            const normalizedItems = items.map(item => {
                const unit = (item?.unit || 'un').toLowerCase();
                const rawStock = Number(item?.stock ?? 0);
                const clampedStock = rawStock < 0 ? 0 : rawStock;
                const stock = (unit === 'kg' || unit === 'lt')
                    ? Math.round(clampedStock * 1000) / 1000
                    : Math.round(clampedStock);

                return {
                    sku: normalizeSku(item?.sku),
                    product_id: item?.product_id !== undefined && item?.product_id !== null
                        ? Number(item.product_id)
                        : null,
                    stock,
                    unit,
                };
            }).filter(item => item.sku && Number.isFinite(item.stock));

            if (normalizedItems.length === 0) {
                console.warn('Stock sync skipped: SKU inválido después de normalizar', {
                    saleId,
                    itemsCount: Array.isArray(items) ? items.length : 0,
                });
                return { success: false, error: 'No hay SKUs válidos para sincronizar' };
            }

            const response = await fetch(`/api/integration/sync-stock?company_id=${encodeURIComponent(activeCompanyId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJsonStringify({
                    sale_id: saleId,
                    sold_at: soldAt,
                    items: normalizedItems,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                console.warn('Stock sync to store failed:', data);
                return {
                    success: false,
                    status: response.status,
                    body: data,
                };
            }

            return {
                success: true,
                status: 200,
                body: data,
            };
        } catch (error) {
            console.warn('Stock sync to store network error:', error);
            return { success: false, error: error.message };
        }
    },

    syncAllStockWithStore: async (onProgress) => {
        try {
            const { activeCompanyId } = get();

            if (!activeCompanyId) {
                return { success: false, error: 'Empresa activa no disponible' };
            }

            const dbProducts = await turso.execute({
                sql: `
                    SELECT id, name, sku, price, stock, category, cost, unit,
                           is_offer, offer_price, tax_rate, image, price_ranges
                    FROM products
                    WHERE company_id = ?
                      AND sku IS NOT NULL
                      AND TRIM(sku) <> ''
                    ORDER BY id ASC
                `,
                args: [activeCompanyId]
            });

            const items = (dbProducts.rows || []).map(product => {
                const unit = (product.unit || 'un').toLowerCase();
                const rawStock = Number(product.stock || 0);
                const clampedStock = rawStock < 0 ? 0 : rawStock;
                // Kg/Lt: 3 decimales, Und: entero
                const stock = (unit === 'kg' || unit === 'lt')
                    ? Math.round(clampedStock * 1000) / 1000
                    : Math.round(clampedStock);

                let priceRanges = [];
                try {
                    if (product.price_ranges) {
                        priceRanges = typeof product.price_ranges === 'string'
                            ? JSON.parse(product.price_ranges)
                            : product.price_ranges;
                    }
                } catch { /* ignore */ }

                const item = {
                    id: Number(product.id),
                    name: product.name || '',
                    sku: String(product.sku).trim(),
                    price: Number(product.price || 0),
                    stock,
                    category: product.category || 'General',
                    cost: Number(product.cost || 0),
                    unit,
                    tax_rate: Number(product.tax_rate || 0),
                    is_offer: product.is_offer ? true : false,
                    offer_price: product.is_offer ? Number(product.offer_price || 0) : 0,
                    price_ranges: priceRanges,
                };

                if (product.image) item.image = product.image;

                return item;
            }).filter(product => product.sku);

            const total = items.length;
            if (total === 0) {
                return { success: true, total: 0, updated: 0, failed: 0, failures: [] };
            }

            let processed = 0;
            let updated = 0;
            let failed = 0;
            const failures = [];

            for (const item of items) {
                try {
                    const response = await fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: safeJsonStringify({ product: item }),
                    });

                    const data = await response.json().catch(() => ({}));

                    if (response.ok && data.success) {
                        updated += 1;
                    } else {
                        failed += 1;
                        failures.push({
                            sku: item.sku,
                            status: response.status,
                            body: JSON.stringify(data).slice(0, 500),
                        });
                    }
                } catch (err) {
                    failed += 1;
                    failures.push({ sku: item.sku, status: 0, body: err.message });
                }

                processed += 1;

                if (typeof onProgress === 'function') {
                    onProgress({
                        processed,
                        total,
                        message: `Sincronizando ${processed} de ${total} productos...`,
                    });
                }
            }

            return {
                success: failed === 0,
                total,
                updated,
                failed,
                failures,
            };
        } catch (error) {
            console.error('syncAllStockWithStore error:', error);
            return { success: false, error: error.message, total: 0, updated: 0, failed: 0, failures: [] };
        }
    },

    deleteProduct: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // Obtener SKU antes de borrar para sincronizar con tienda
            const productToDelete = get().products.find(p => p.id === id);

            await turso.execute({
                sql: "DELETE FROM products WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'PRODUCT', JSON.stringify({ id }), new Date().toISOString()]
            });

            // POS -> Tienda: sincronizar eliminación (stock 0, sin escalas)
            try {
                const sku = productToDelete?.sku;
                if (sku && String(sku).trim()) {
                    fetch(`/api/integration/sync-product?company_id=${encodeURIComponent(activeCompanyId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            product: {
                                id,
                                sku,
                                stock: 0,
                                price_ranges: [],
                            }
                        })
                    }).then(async (res) => {
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) {
                            console.warn('Product sync post-delete failed:', { id, status: res.status, data });
                        } else {
                            console.log('✅ Product sync post-delete success:', { id, sku });
                        }
                    }).catch(syncError => {
                        console.warn('Product sync post-delete error:', syncError);
                    });
                }
            } catch (syncError) {
                console.warn('Product sync post-delete setup error:', syncError);
            }

            set((state) => ({
                products: state.products.filter((p) => p.id !== id),
                _preorderCache: { key: '', products: [], ts: 0 }
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete product error", e);
            return { success: false, error: e.message };
        }
    },

    // Categories
    addCategory: async (category) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            const result = await turso.execute({
                sql: "INSERT INTO categories (name, color, status, show_in_pos, show_in_preorders, company_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    category.name,
                    category.color,
                    category.status || 'active',
                    category.showInPos !== false ? 1 : 0,
                    category.showInPreorders !== false ? 1 : 0,
                    activeCompanyId
                ]
            });
            const newCategory = result.rows[0];

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'CREATE', 'CATEGORY', JSON.stringify({ name: category.name }), new Date().toISOString()]
            });

            set((state) => ({ categories: [...state.categories, newCategory] }));
            return { success: true, category: newCategory };
        } catch (e) {
            console.error("Add category error", e);
            return { success: false, error: e.message };
        }
    },

    updateCategory: async (id, updatedCategory) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // 1. Find the old category to see if name changed
            const { categories } = get();
            const oldCategory = categories.find(c => c.id === id);

            if (!oldCategory) return { success: false, error: "Category not found" };

            const nameChanged = oldCategory.name !== updatedCategory.name;

            // 2. Transaction: Update Category + (Optional) Update Products
            const queries = [
                {
                    sql: "UPDATE categories SET name = ?, color = ?, status = ?, show_in_pos = ?, show_in_preorders = ? WHERE id = ? AND company_id = ?",
                    args: [
                        updatedCategory.name,
                        updatedCategory.color,
                        updatedCategory.status,
                        updatedCategory.showInPos !== false ? 1 : 0,
                        updatedCategory.showInPreorders !== false ? 1 : 0,
                        id,
                        activeCompanyId
                    ]
                }
            ];

            if (nameChanged) {
                queries.push({
                    sql: "UPDATE products SET category = ? WHERE category = ? AND company_id = ?",
                    args: [updatedCategory.name, oldCategory.name, activeCompanyId]
                });
            }

            // Audit
            queries.push({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'UPDATE', 'CATEGORY', JSON.stringify({ id, updates: updatedCategory }), new Date().toISOString()]
            });

            await turso.batch(queries);

            // 3. Update Local State
            set((state) => ({
                categories: state.categories.map((c) => c.id === id ? { ...c, ...updatedCategory } : c),
                products: nameChanged
                    ? state.products.map(p => p.category === oldCategory.name ? { ...p, category: updatedCategory.name } : p)
                    : state.products
            }));
            return { success: true };
        } catch (e) {
            console.error("Update category error", e);
            return { success: false, error: e.message };
        }
    },

    deleteCategory: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            await turso.execute({
                sql: "DELETE FROM categories WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'CATEGORY', JSON.stringify({ id }), new Date().toISOString()]
            });

            set((state) => ({
                categories: state.categories.filter((c) => c.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete category error", e);
            return { success: false, error: e.message };
        }
    },

    // Suppliers
    addSupplier: async (supplier) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            const result = await turso.execute({
                sql: "INSERT INTO suppliers (name, phone, email, seller_name, order_days, delivery_days, status, company_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    supplier.name,
                    supplier.phone || '',
                    supplier.email || '',
                    supplier.seller_name || '',
                    supplier.order_days || '',
                    supplier.delivery_days || '',
                    supplier.status || 'active',
                    activeCompanyId,
                    new Date().toISOString()
                ]
            });
            const newSupplier = result.rows[0];

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'CREATE', 'SUPPLIER', JSON.stringify({ name: supplier.name }), new Date().toISOString()]
            });

            set((state) => ({ suppliers: [...state.suppliers, newSupplier] }));
            return { success: true, supplier: newSupplier };
        } catch (e) {
            console.error("Add supplier error", e);
            return { success: false, error: e.message };
        }
    },

    updateSupplier: async (id, updatedSupplier) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // 1. Find old supplier to check for name change
            const { suppliers } = get();
            const oldSupplier = suppliers.find(s => s.id === id);

            if (!oldSupplier) return { success: false, error: "Supplier not found" };

            const nameChanged = oldSupplier.name !== updatedSupplier.name;

            // 2. Transaction
            const queries = [
                {
                    sql: "UPDATE suppliers SET name = ?, phone = ?, email = ?, seller_name = ?, order_days = ?, delivery_days = ?, status = ? WHERE id = ? AND company_id = ?",
                    args: [
                        updatedSupplier.name,
                        updatedSupplier.phone || '',
                        updatedSupplier.email || '',
                        updatedSupplier.seller_name || '',
                        updatedSupplier.order_days || '',
                        updatedSupplier.delivery_days || '',
                        updatedSupplier.status || 'active',
                        id,
                        activeCompanyId
                    ]
                }
            ];

            if (nameChanged) {
                queries.push({
                    sql: "UPDATE products SET supplier = ? WHERE supplier = ? AND company_id = ?",
                    args: [updatedSupplier.name, oldSupplier.name, activeCompanyId]
                });
            }

            // Audit
            queries.push({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'UPDATE', 'SUPPLIER', JSON.stringify({ id, updates: updatedSupplier }), new Date().toISOString()]
            });

            await turso.batch(queries);

            set((state) => ({
                suppliers: state.suppliers.map((s) => s.id === id ? { ...s, ...updatedSupplier } : s),
                products: nameChanged
                    ? state.products.map(p => p.supplier === oldSupplier.name ? { ...p, supplier: updatedSupplier.name } : p)
                    : state.products
            }));
            return { success: true };
        } catch (e) {
            console.error("Update supplier error", e);
            return { success: false, error: e.message };
        }
    },

    deleteSupplier: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            await turso.execute({
                sql: "DELETE FROM suppliers WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'SUPPLIER', JSON.stringify({ id }), new Date().toISOString()]
            });

            set((state) => ({
                suppliers: state.suppliers.filter((s) => s.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete supplier error", e);
            return { success: false, error: e.message };
        }
    },

    fetchSupplierOrders: async (filters = {}) => {
        try {
            const { activeCompanyId } = get();
            let sql = "SELECT * FROM supplier_orders WHERE company_id = ?";
            const args = [activeCompanyId];

            if (filters.supplier_id) {
                sql += " AND supplier_id = ?";
                args.push(filters.supplier_id);
            }
            if (filters.status) {
                sql += " AND status = ?";
                args.push(filters.status);
            }

            sql += " ORDER BY created_at DESC";

            const result = await turso.execute({ sql, args });
            return result.rows.map(row => ({
                ...row,
                items: row.items ? JSON.parse(row.items) : []
            }));
        } catch (e) {
            console.error("Fetch supplier orders error", e);
            return [];
        }
    },

    createSupplierOrder: async (orderData) => {
        try {
            const { activeCompanyId, currentUser } = get();

            const result = await turso.execute({
                sql: `INSERT INTO supplier_orders (
                    company_id, user_id, supplier_id, supplier_name, seller_name, 
                    total_amount, items, status, created_at, expected_delivery_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
                args: [
                    activeCompanyId,
                    currentUser?.id || null,
                    orderData.supplier_id,
                    orderData.supplier_name,
                    orderData.seller_name || null,
                    orderData.total_amount,
                    JSON.stringify(orderData.items),
                    'pending',
                    new Date().toISOString(),
                    orderData.expected_delivery_date || null
                ]
            });

            const newOrder = result.rows[0];
            return { success: true, order: newOrder };
        } catch (e) {
            console.error("Create supplier order error", e);
            return { success: false, error: e.message };
        }
    },

    deleteSupplierOrder: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();

            // Security check
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            // 1. Delete Order
            await turso.execute({
                sql: "DELETE FROM supplier_orders WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // 2. Audit Log
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'SUPPLIER_ORDER', JSON.stringify({ id }), new Date().toISOString()]
            });

            return { success: true };
        } catch (e) {
            console.error("Delete supplier order error", e);
            return { success: false, error: e.message };
        }
    },

    // =========================================
    // SUPER ADMIN ACTIONS
    // =========================================

    fetchAdminStats: async () => {
        try {
            const { currentUser } = get();
            if (currentUser?.role !== 'super_admin') return null;

            const totalRes = await turso.execute("SELECT COUNT(*) as count FROM companies");
            const activeRes = await turso.execute("SELECT COUNT(*) as count FROM companies WHERE status = 'active'");
            const suspendedRes = await turso.execute("SELECT COUNT(*) as count FROM companies WHERE status = 'suspended'");

            return {
                totalCompanies: totalRes.rows[0].count,
                activeCompanies: activeRes.rows[0].count,
                suspendedCompanies: suspendedRes.rows[0].count
            };
        } catch (e) {
            console.error("Fetch admin stats error", e);
            return null;
        }
    },

    fetchAllCompanies: async () => {
        try {
            const { currentUser } = get();
            if (currentUser?.role !== 'super_admin') return [];

            const res = await turso.execute("SELECT * FROM companies ORDER BY created_at DESC");
            return res.rows;
        } catch (e) {
            console.error("Fetch all companies error", e);
            return [];
        }
    },

    createCompany: async (companyData) => {
        try {
            const { id, name, country, plan, newUser } = companyData;
            const { currentUser } = get();

            if (currentUser?.role !== 'super_admin') return { success: false, error: "Access Denied" };

            // 1. Create Company
            await turso.execute({
                sql: "INSERT INTO companies (id, name, status, created_at, country_code, plan) VALUES (?, ?, 'active', ?, ?, ?)",
                args: [id, name, new Date().toISOString(), country || 'CL', plan || 'basic']
            });

            // 2. Assign Current Admin as Owner (so they can manage it)
            await turso.execute({
                sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')",
                args: [currentUser.id, id]
            });

            // 3. Create New User (if provided)
            if (newUser && newUser.username && newUser.password) {
                // Check if username exists
                const userCheck = await turso.execute({
                    sql: "SELECT id FROM users WHERE username = ?",
                    args: [newUser.username]
                });

                if (userCheck.rows.length > 0) {
                    console.warn(`Username ${newUser.username} already exists. Skipping user creation.`);
                    // We don't fail the whole process, just warn? Or maybe we should allow linking existing user?
                    // For now, let's assume unique usernames required for new creation.
                } else {
                    const userRes = await turso.execute({
                        sql: "INSERT INTO users (username, password, name, role, company_id) VALUES (?, ?, ?, 'Administrador', ?) RETURNING id",
                        args: [newUser.username, newUser.password, newUser.name || newUser.username, id]
                    });

                    const newUserId = userRes.rows[0]?.id; // If RETURNING is supported, else query? 

                    // Turso/LibSQL usually supports RETURNING. If not, we'd need to select by username.
                    // Assuming it works or we fallback:
                    let finalUserId = newUserId;
                    if (!finalUserId) {
                        const fetchUser = await turso.execute({
                            sql: "SELECT id FROM users WHERE username = ?",
                            args: [newUser.username]
                        });
                        finalUserId = fetchUser.rows[0]?.id;
                    }

                    if (finalUserId) {
                        await turso.execute({
                            sql: "INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, 'owner')",
                            args: [finalUserId, id]
                        });
                    }
                }
            }

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: ['system', currentUser.id, 'CREATE', 'COMPANY', JSON.stringify({ id, name, plan }), new Date().toISOString()]
            });

            // 4. Seed default role permissions for new company (hardcoded defaults)
            try {
                const DEFAULT_PERMS = {
                    'Caja': [
                        'dashboard.view', 'dashboard.view_sales',
                        'pos.access', 'pos.sell', 'pos.discount', 'pos.open_register', 'pos.close_register', 'pos.cash_in', 'pos.cash_out', 'pos.suspend_sale', 'pos.recover_sale', 'pos.preventa',
                        'sales.view', 'sales.view_details',
                        'clients.view', 'clients.create', 'clients.view_account',
                        'preorders.view', 'preorders.create', 'preorders.edit', 'preorders.complete',
                        'personal.view', 'personal.attendance', 'personal.corrections',
                        'alerts.view'
                    ],
                    'Vendedor': [
                        'dashboard.view',
                        'pos.access', 'pos.preventa',
                        'clients.view', 'clients.create',
                        'personal.view', 'personal.attendance',
                        'alerts.view'
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
                        'alerts.view', 'alerts.manage'
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
                        'sii.view', 'sii.folios'
                    ]
                };

                const ALL_PERMS = [
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
                    'sii.view', 'sii.folios'
                ];

                const queries = [];
                const ROLES = ['Caja', 'Vendedor', 'Bodeguero', 'Supervisor'];
                for (const role of ROLES) {
                    const allowed = DEFAULT_PERMS[role] || [];
                    for (const p of ALL_PERMS) {
                        queries.push({
                            sql: "INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)",
                            args: [id, role, p, allowed.includes(p) ? 1 : 0]
                        });
                    }
                }
                // Administrador gets everything
                for (const p of ALL_PERMS) {
                    queries.push({
                        sql: "INSERT OR IGNORE INTO role_permissions (company_id, role, permission, granted) VALUES (?, ?, ?, ?)",
                        args: [id, 'Administrador', p, 1]
                    });
                }

                const CHUNK_SIZE = 50;
                for (let i = 0; i < queries.length; i += CHUNK_SIZE) {
                    await turso.batch(queries.slice(i, i + CHUNK_SIZE));
                }
                console.log(`✅ Seeded default role permissions for new company ${id}`);
            } catch (permErr) {
                console.warn('Could not seed permissions for new company:', permErr.message);
            }

            // Refresh available companies
            await get().fetchUserCompanies(currentUser.id);

            return { success: true };
        } catch (e) {
            console.error("Create company error", e);
            return { success: false, error: e.message };
        }
    },

    // toggleCompanyStatus, checkSubscriptionStatus, fetchAllSubscriptions
    // are defined in the ADMIN & SAAS ACTIONS section below


    // Purchases
    addPurchase: async (purchase) => {
        try {
            const { currentUser, activeCompanyId, validateCompanyAccess } = get();

            // 0. Security Validation
            if (!validateCompanyAccess(currentUser ? currentUser.id : null, activeCompanyId)) {
                return { success: false, error: "Access Denied" };
            }

            const itemsJson = JSON.stringify(purchase.items);

            // 1. Insert Purchase FIRST to get its ID (needed to link lots)
            const purchaseResult = await turso.execute({
                sql: "INSERT INTO purchases (supplier_id, supplier_name, invoice_number, date, total, items, status, user_id, is_credit, credit_days, expiry_date, deposit, payment_method, company_id, payment_observation, payment_document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                args: [
                    purchase.supplierId,
                    purchase.supplierName,
                    purchase.invoiceNumber || '',
                    purchase.date,
                    purchase.total,
                    itemsJson,
                    'completed',
                    currentUser ? currentUser.id : null,
                    purchase.isCredit ? 1 : 0,
                    purchase.creditDays || null,
                    purchase.expiryDate || null,
                    purchase.deposit || 0,
                    purchase.paymentMethod || 'Efectivo',
                    activeCompanyId,
                    purchase.observation || null,
                    purchase.document || null
                ]
            });
            const purchaseId = purchaseResult.rows[0]?.id || purchaseResult.lastInsertRowid;

            // 2. Batch: Update products + Create lots (linked to purchase)
            const queries = [];

            // For each item, update stock, cost AND supplier in products table
            purchase.items.forEach(item => {
                queries.push({
                    sql: "UPDATE products SET stock = ROUND(stock + ?, 3), cost = ?, price = ?, sku = ?, tax_rate = ?, supplier = ? WHERE id = ? AND company_id = ?",
                    args: [item.quantity, item.cost, item.price, item.sku, item.tax || 0, purchase.supplierName, item.id, activeCompanyId]
                });

                // Create Lot linked to purchase
                queries.push({
                    sql: "INSERT INTO product_lots (product_id, batch_number, expiry_date, quantity, initial_quantity, cost, supplier_name, created_at, status, company_id, purchase_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
                    args: [
                        item.id,
                        item.batchNumber || '',
                        item.expiryDate || null,
                        item.quantity,
                        item.quantity,
                        item.cost,
                        purchase.supplierName,
                        new Date().toISOString(),
                        activeCompanyId,
                        purchaseId
                    ]
                });
            });

            // Audit
            queries.push({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'CREATE', 'PURCHASE', JSON.stringify({ total: purchase.total }), new Date().toISOString()]
            });

            await turso.batch(queries);

            // FASE 4 · Escritura dual silenciosa a purchase_items.
            // purchases.items (JSON) ya está guardado. Si la normalización falla,
            // NO afecta la compra ni las APIs externas — solo se loggea.
            mirrorPurchaseItems(turso, {
                purchaseId,
                companyId: activeCompanyId,
                purchaseDate: purchase.date,
                items: purchase.items,
                source: 'live',
            }).catch(err => console.error('[fase4] mirrorPurchaseItems:', err?.message || err));

            // Refetch lots or simulate (Optimistic). Usamos UUID o id+random para evitar
            // colisiones si addPurchase se invoca varias veces en el mismo tick.
            const tempBase = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
            const newLots = purchase.items.map((item, idx) => ({
                id: `temp-${tempBase}-${item.id}-${idx}`, // Temp ID único
                product_id: item.id,
                batch_number: item.batchNumber || '',
                expiry_date: item.expiryDate || null,
                quantity: parseFloat(item.quantity),
                initial_quantity: parseFloat(item.quantity),
                cost: parseFloat(item.cost),
                supplier_name: purchase.supplierName,
                created_at: new Date().toISOString(),
                status: 'active',
                company_id: activeCompanyId,
                purchase_id: purchaseId
            }));

            // We need newPurchase object primarily for state update
            const newPurchase = {
                ...purchase,
                id: purchaseId, // Usamos el ID real devuelto por la BD
                status: 'completed',
                userId: currentUser ? currentUser.id : null,
                company_id: activeCompanyId
            };

            set((state) => ({
                purchases: [newPurchase, ...state.purchases],
                productLots: [...state.productLots, ...newLots],
                products: state.products.map(p => {
                    const purchasedItem = purchase.items.find(i => i.id === p.id);
                    if (purchasedItem) {
                        return {
                            ...p,
                            stock: Math.round((parseFloat(p.stock) + parseFloat(purchasedItem.quantity)) * 1000) / 1000,
                            cost: parseFloat(purchasedItem.cost),
                            price: parseFloat(purchasedItem.price),
                            sku: purchasedItem.sku,
                            tax_rate: parseFloat(purchasedItem.tax || 0),
                            supplier: purchase.supplierName // Update supplier
                        };
                    }
                    return p;
                })
            }));

            // UPDATE AGGREGATION
            await get().updateSupplierPurchaseSummary({ ...purchase, date: purchase.date || new Date().toISOString() }, activeCompanyId);

            // Check inventory alerts after purchase (non-blocking)
            setTimeout(() => {
                const productIds = purchase.items?.map(i => i.productId || i.product_id).filter(Boolean);
                get().checkInventoryAlerts(productIds);
            }, 100);

            return { success: true };
        } catch (e) {
            console.error("Add purchase error", e);
            return { success: false, error: e.message };
        }
    },

    fetchPurchases: async (offset = 0, limit = 50) => {
        try {
            const { activeCompanyId } = get();
            // Optimized query: Not selecting 'items' to keep list lightweight
            const result = await turso.execute({
                sql: "SELECT * FROM purchases WHERE company_id = ? ORDER BY date DESC LIMIT ? OFFSET ?",
                args: [activeCompanyId, limit, offset]
            });
            return result.rows || [];
        } catch (e) {
            console.error("Fetch purchases error", e);
            return [];
        }
    },

    fetchPurchaseDetails: async (id) => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: "SELECT * FROM purchases WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            if (result.rows.length > 0) {
                const purchase = result.rows[0];
                return {
                    ...purchase,
                    items: typeof purchase.items === 'string' ? JSON.parse(purchase.items) : purchase.items
                };
            }
            return null;
        } catch (e) {
            console.error("Fetch purchase details error", e);
            return null;
        }
    },

    deletePurchase: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            await turso.execute({
                sql: "DELETE FROM purchases WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'PURCHASE', JSON.stringify({ id }), new Date().toISOString()]
            });

            set((state) => ({
                purchases: state.purchases.filter(p => p.id !== id)
            }));
            return { success: true };
        } catch (e) {
            console.error("Delete purchase error", e);
            return { success: false, error: e.message };
        }
    },

    // ============================================
    // MULTI-CART SYSTEM
    // ============================================

    // Agregar nuevo carrito (máximo 3)
    addCart: () => {
        const { carts, nextCartId, activeCartId } = get();

        if (carts.length >= 3) {
            alert('Máximo 3 carritos simultáneos');
            return;
        }

        // Inherit tipoDte from current active cart (respects user's default)
        const activeCart = carts.find(c => c.id === activeCartId);
        const inheritedDte = activeCart ? activeCart.tipoDte : 0;

        const newCart = {
            id: nextCartId,
            name: `Ticket ${carts.length + 1}`,
            items: [],
            client: null,
            tipoDte: inheritedDte,
            createdAt: Date.now()
        };

        console.log('➕ Adding cart:', newCart.name);

        set({
            carts: [...carts, newCart],
            activeCartId: nextCartId,
            nextCartId: nextCartId + 1
        });
    },

    // Cambiar carrito activo (instantáneo)
    setActiveCart: (cartId) => {
        const { carts } = get();
        const cartExists = carts.find(c => c.id === cartId);

        if (!cartExists) {
            console.error('Cart not found:', cartId);
            return;
        }

        console.log('🔄 Switching to cart:', cartId);
        set({ activeCartId: cartId });

        // cart y posSelectedClient se actualizan automáticamente via getters
    },

    // Remover carrito (mínimo 1)
    removeCart: (cartId) => {
        const { carts, activeCartId } = get();

        if (carts.length === 1) {
            alert('Debe mantener al menos un carrito abierto');
            return;
        }

        const cartToRemove = carts.find(c => c.id === cartId);
        if (cartToRemove && cartToRemove.items.length > 0) {
            if (!confirm(`¿Cerrar ${cartToRemove.name}? Tiene ${cartToRemove.items.length} productos.`)) {
                return;
            }
        }

        console.log('❌ Removing cart:', cartId);

        // Filtrar el carrito eliminado y RENOMBRAR secuencialmente
        const newCarts = carts
            .filter(c => c.id !== cartId)
            .map((cart, index) => ({
                ...cart,
                name: `Ticket ${index + 1}`
            }));

        console.log('🔄 Carts renumbered:', newCarts.map(c => c.name).join(', '));

        // Si eliminamos el activo, cambiar al primero disponible
        const newActiveId = cartId === activeCartId
            ? newCarts[0].id
            : activeCartId;

        set({
            carts: newCarts,
            activeCartId: newActiveId
        });
    },

    // Renombrar carrito (opcional)
    renameCart: (cartId, newName) => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === cartId
                    ? { ...c, name: newName }
                    : c
            )
        }));
    },

    setPosSelectedClient: (client) => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === state.activeCartId
                    ? { ...c, client }
                    : c
            )
        }));
    },

    setCartTipoDte: (tipoDte) => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === state.activeCartId
                    ? { ...c, tipoDte }
                    : c
            )
        }));
    },

    // Cart (Local Only)
    _recalculateCartPrices: (cartItems) => {
        // 1. Calculate totals per group
        const groupTotals = {};
        cartItems.forEach(item => {
            if (item.scale_group_id) {
                groupTotals[item.scale_group_id] = (groupTotals[item.scale_group_id] || 0) + item.quantity;
            }
        });

        // Helper to calculate price for a single item context
        const calculateItemPrice = (product, quantityForScale) => {
            // Priority 1: Wholesale Ranges
            if (product.price_ranges && Array.isArray(product.price_ranges) && product.price_ranges.length > 0) {
                const match = product.price_ranges.find(r => {
                    const min = parseFloat(r.min) || 0;
                    const max = r.max ? parseFloat(r.max) : Infinity;
                    return quantityForScale >= min && quantityForScale <= max;
                });
                if (match) return parseFloat(match.price);
            }
            // Priority 2: Offer Price
            if (product.is_offer && product.offer_price > 0) {
                return parseFloat(product.offer_price);
            }
            // Priority 3: Base Price
            return parseFloat(product.original_price || product.price);
        };

        // 2. Update prices for all items
        return cartItems.map(item => {
            // If price was manually set, skip auto-calculation for this item
            if (item.isManualPrice) {
                return item;
            }

            let quantityForScale = item.quantity;

            if (item.scale_group_id && groupTotals[item.scale_group_id]) {
                quantityForScale = groupTotals[item.scale_group_id];
            }

            const newPrice = calculateItemPrice(item, quantityForScale);

            return {
                ...item,
                price: newPrice
            };
        });
    },

    addToCart: (product) => {
        const { carts, activeCartId, inventoryAdjustmentMode } = get();

        console.log('➕ addToCart called:', {
            product: product.name,
            activeCartId,
            inventoryMode: inventoryAdjustmentMode
        });

        // PASO 1: Encontrar el carrito activo
        const activeCart = carts.find(c => c.id === activeCartId);
        if (!activeCart) {
            console.error('❌ No active cart found');
            return;
        }

        // PASO 2: Verificar si el producto YA EXISTE en el carrito
        const existingItem = activeCart.items.find(i => String(i.id) === String(product.id));

        if (existingItem) {
            // PRODUCTO YA EXISTE → SUMAR CANTIDAD
            console.log('✅ Product exists, incrementing quantity');
            get().updateCartItem(existingItem.id, existingItem.quantity + 1);
            return;
        }

        // PASO 3: Producto NO existe → Validar stock (solo en modo normal)
        if (!inventoryAdjustmentMode) {
            // Calcular stock en TODOS los carritos
            const totalInAllCarts = carts.reduce((total, cart) => {
                const itemInCart = cart.items.find(i => i.id === product.id);
                return total + (itemInCart?.quantity || 0);
            }, 0);

            const availableStock = (product.stock || 0) - totalInAllCarts;

            if (availableStock <= 0) {
                alert(`Stock insuficiente para "${product.name}". Ya hay ${totalInAllCarts} unidades en carritos.`);
                return;
            }

            console.log('📦 Stock check:', {
                product: product.name,
                totalStock: product.stock,
                inCarts: totalInAllCarts,
                available: availableStock
            });
        }

        // PASO 4: Agregar producto NUEVO al carrito
        console.log('✅ Adding new product to cart');

        let newItemsContext = [];

        set(state => {
            const currentCart = state.carts.find(c => c.id === state.activeCartId);
            const rawNewItem = {
                id: product.id,
                name: product.name,
                price: product.price || 0,
                cost: product.cost || 0,
                quantity: 1,
                tax_rate: product.tax_rate || 0,
                image: product.image || null,
                sku: product.sku || '',
                stock: product.stock || 0,
                unit: product.unit || 'Und',
                category: product.category || '',
                discountPercent: 0,
                // Wholesale & Offer Support
                price_ranges: product.price_ranges || [],
                scale_group_id: product.scale_group_id || null,
                original_price: product.original_price || product.price,
                is_offer: product.is_offer,
                offer_price: product.offer_price,
                // Combo / Pack support
                is_combo: product.is_combo || false,
                combo_id: product.combo_id || null,
                combo_items: product.combo_items || null
            };

            const updatedItems = [...currentCart.items, rawNewItem];
            // Recalculate prices considering the new item (might trigger scale for group)
            newItemsContext = get()._recalculateCartPrices(updatedItems);

            return {
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? {
                            ...c,
                            items: newItemsContext
                        }
                        : c
                )
            };
        });
    },


    updateCartItem: (productId, updates) => {
        const { carts, activeCartId } = get();

        // Handle quantity update with stock validation
        // Hybrid support: 'updates' can be object or quantity (if number)
        // User request implied simpler signature but we support object for compat

        let newQuantity;
        if (typeof updates === 'number') {
            newQuantity = updates;
        } else if (updates && typeof updates.quantity === 'number') {
            newQuantity = updates.quantity;
        }

        // Only validate if quantity is changing
        if (newQuantity !== undefined) {
            const product = carts.find(c => c.id === activeCartId)?.items.find(i => i.id === productId);
            if (!product) return; // Should not happen

            const totalInOtherCarts = carts.reduce((total, cart) => {
                if (cart.id === activeCartId) return total;
                const itemInCart = cart.items.find(i => i.id === productId);
                return total + (itemInCart?.quantity || 0);
            }, 0);

            const availableStock = (product.stock || 0) - totalInOtherCarts;

            // Si estamos en modo de ajuste de inventario, SALTAMOS la validación de stock
            const { inventoryAdjustmentMode } = get();

            if (!inventoryAdjustmentMode) {
                if (newQuantity > availableStock) {
                    alert(`Stock insuficiente. Solo hay ${availableStock} disponibles (${totalInOtherCarts} en otros carritos).`);
                    return;
                }
            }

            if (newQuantity <= 0 && !updates._skipRemoval) {
                get().removeFromCart(productId);
                return;
            }
        }

        set(state => {
            const currentCart = state.carts.find(c => c.id === state.activeCartId);
            const updatedItemsRaw = currentCart.items.map(item => {
                if (item.id === productId) {
                    // Apply updates
                    const isPriceUpdate = updates.price !== undefined;
                    const baseUpdate = typeof updates === 'object' ? updates : { quantity: updates };
                    return {
                        ...item,
                        ...baseUpdate,
                        isManualPrice: isPriceUpdate ? true : item.isManualPrice
                    };
                }
                return item;
            });

            // Recalculate prices for the whole cart
            const itemsWithPrices = get()._recalculateCartPrices(updatedItemsRaw);

            return {
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? {
                            ...c,
                            items: itemsWithPrices
                        }
                        : c
                )
            };
        });
    },

    removeFromCart: (productId) => {
        set(state => {
            const currentCart = state.carts.find(c => c.id === state.activeCartId);
            const remainingItemsRaw = currentCart.items.filter(item => item.id !== productId);

            // Recalculate prices (e.g. if removing an item affects scale group total)
            const itemsWithPrices = get()._recalculateCartPrices(remainingItemsRaw);

            return {
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? {
                            ...c,
                            items: itemsWithPrices
                        }
                        : c
                )
            };
        });
    },

    clearCart: () => {
        set(state => ({
            carts: state.carts.map(c =>
                c.id === state.activeCartId
                    ? { ...c, items: [], client: null }
                    : c
            )
        }));
    },



    addSale: async (sale) => {
        // ============================================
        // FASE 0: DETECCIÓN OFFLINE
        // ============================================
        // Si NO hay conexión, derivar a la ruta offline (Dexie + cola).
        // Esto permite seguir vendiendo aunque la conexión esté caída por
        // horas. La sincronización al servidor se hace automáticamente al
        // volver online (App.jsx + OfflineSync page).
        // Excepción: si la venta viene desde la cola de sincronización
        // (`_fromOfflineQueue`), NO re-encolar — debe procesarse online sí o sí.
        if (typeof navigator !== 'undefined' && !navigator.onLine && !sale?._fromOfflineQueue) {
            try {
                return await get()._addSaleOffline(sale);
            } catch (offlineErr) {
                console.error('❌ Error en venta offline:', offlineErr);
                return { success: false, error: offlineErr.message || 'Error venta offline' };
            }
        }

        // ============================================
        // FASE 1: VALIDACIÓN RÁPIDA (PRE-PROCESAMIENTO)
        // ============================================
        const startTime = performance.now();

        try {
            const { productLots, currentUser, activeCompanyId, validateCompanyAccess } = get();

            // Validación básica ultra-rápida
            if (!sale?.items?.length || !sale.total || sale.total < 0) {
                return { success: false, error: 'Datos de venta inválidos' };
            }

            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) {
                return { success: false, error: 'Acceso denegado' };
            }

            const saleTotal = parseFloat(sale.total);
            const { inventoryAdjustmentMode, creditBlockMode } = get();

            // ============================================
            // CREDIT VALIDATION (before heavy processing)
            // ============================================
            if (sale.client?.id) {
                const clientData = get().clients.find(c => c.id === sale.client.id);
                if (clientData) {
                    // 1. Check if client is fully blocked
                    if (clientData.client_status === 'blocked') {
                        return { success: false, error: 'CLIENT_BLOCKED', message: 'Este cliente está bloqueado y no puede realizar compras.' };
                    }
                    // 2. Check credit-specific blocks when paying with credit
                    if (sale.paymentMethod === 'Crédito') {
                        if (clientData.client_status === 'credit_blocked' || clientData.credit_enabled === 0) {
                            return { success: false, error: 'CREDIT_NOT_ALLOWED', message: 'Este cliente no tiene habilitado el crédito.' };
                        }
                        // 3. Check credit limit
                        if (clientData.credit_limit > 0) {
                            const debtRes = await turso.execute({
                                sql: `SELECT COALESCE(SUM(total), 0) as total_debt FROM sales 
                                      WHERE client_id = ? AND company_id = ? AND payment_method = 'Crédito' 
                                      AND status NOT IN ('paid', 'cancelled')`,
                                args: [sale.client.id, activeCompanyId]
                            });
                            const currentDebt = parseFloat(debtRes.rows[0]?.total_debt || 0);
                            if (currentDebt + saleTotal > clientData.credit_limit) {
                                if (creditBlockMode === 'block') {
                                    return { success: false, error: 'CREDIT_LIMIT_EXCEEDED', message: `Límite de crédito excedido. Límite: $${clientData.credit_limit.toLocaleString()}, Deuda actual: $${currentDebt.toLocaleString()}` };
                                }
                                // warn mode: continue but flag it
                                sale._creditWarning = `Crédito excedido. Límite: $${clientData.credit_limit.toLocaleString()}, Deuda: $${currentDebt.toLocaleString()}, Nueva deuda: $${(currentDebt + saleTotal).toLocaleString()}`;
                            }
                        }
                    }
                }
            }

            // ============================================
            // FASE 2: PRE-CÁLCULOS (ANTES DE TRANSACCIÓN)
            // ============================================

            // Separate regular items and combo items
            const regularItems = sale.items.filter(i => !i.is_combo);
            const comboItems = sale.items.filter(i => i.is_combo);

            // Collect all product IDs needed (regular + combo components)
            const regularIds = regularItems.map(i => i.id);
            const comboComponentIds = comboItems.flatMap(c => (c.combo_items || []).map(ci => ci.product_id));
            const allProductIds = [...new Set([...regularIds, ...comboComponentIds])];

            // Fetch fresh product data from DB
            const itemIds = allProductIds.length > 0 ? allProductIds : [0];
            const placeholders = itemIds.map(() => '?').join(',');

            const dbProductsRes = await turso.execute({
                sql: `SELECT * FROM products WHERE id IN (${placeholders}) AND company_id = ?`,
                args: [...itemIds, activeCompanyId]
            });
            const dbProducts = dbProductsRes.rows;

            // Fetch fresh lots from DB (not from Zustand state which may be stale)
            const dbLotsRes = await turso.execute({
                sql: `SELECT * FROM product_lots WHERE product_id IN (${placeholders}) AND company_id = ? AND quantity > 0`,
                args: [...itemIds, activeCompanyId]
            });
            const freshLots = dbLotsRes.rows;

            // Preparar todos los datos ANTES de entrar a la transacción
            const itemsToProcess = [];
            const productsToUpdate = [];
            const lotsToUpdate = [];
            const productsToMarkPending = [];

            // Crear índices rápidos (Map es O(1) vs filter que es O(n))
            // Usamos dbProducts en lugar de get().products
            // NORMALIZAR IDs a String para evitar mismatch de tipos (number vs string)
            const productsMap = new Map(dbProducts.map(p => [String(p.id), p]));
            const lotsByProduct = new Map();

            freshLots.forEach(lot => {
                const pId = String(lot.product_id);
                if (!lotsByProduct.has(pId)) {
                    lotsByProduct.set(pId, []);
                }
                lotsByProduct.get(pId).push(lot);
            });

            const today = new Date().toISOString().split('T')[0];

            console.log(`🛒 Processing ${sale.items.length} items for sale`);

            // Procesar cada item UNA SOLA VEZ
            for (const item of sale.items) {
                // Combos: add to itemsToProcess but skip product stock deduction here
                if (item.is_combo) {
                    const quantity = parseFloat(item.quantity);
                    const price = parseFloat(item.price);
                    const cost = parseFloat(item.cost) || 0;
                    itemsToProcess.push({
                        id: item.id,
                        name: item.name,
                        quantity,
                        price,
                        cost,
                        tax_rate: parseFloat(item.tax_rate) || 0,
                        is_combo: true
                    });

                    // Deduct stock from each component product
                    for (const comp of (item.combo_items || [])) {
                        const compIdStr = String(comp.product_id);
                        const compProduct = productsMap.get(compIdStr);
                        if (!compProduct) {
                            // 🛑 Componente faltante: la venta del combo NO puede quedar parcial.
                            // Antes hacíamos `continue` y vendíamos el combo sin descontar stock.
                            console.error(`❌ Combo ${item.name}: componente product_id=${comp.product_id} no encontrado en BD`);
                            return {
                                success: false,
                                error: `Combo "${item.name}": componente faltante (id ${comp.product_id}). No se puede procesar la venta.`
                            };
                        }

                        const compDeduct = (parseFloat(comp.quantity) || 1) * quantity;

                        // Accumulate if same product appears in multiple combos
                        const existing = productsToUpdate.find(p => String(p.id) === compIdStr);
                        if (existing) {
                            existing.quantityToDeduct += compDeduct;
                        } else {
                            productsToUpdate.push({
                                id: comp.product_id,
                                quantityToDeduct: compDeduct,
                                markPending: false
                            });
                        }

                        // FEFO lot deduction for component
                        const compLots = (lotsByProduct.get(compIdStr) || [])
                            .filter(l => l.quantity > 0)
                            .sort((a, b) => {
                                const aExpired = a.expiry_date && a.expiry_date < today;
                                const bExpired = b.expiry_date && b.expiry_date < today;
                                if (aExpired !== bExpired) return aExpired ? 1 : -1;
                                if (!a.expiry_date) return 1;
                                if (!b.expiry_date) return -1;
                                return new Date(a.expiry_date) - new Date(b.expiry_date);
                            });

                        let compRemaining = compDeduct;
                        for (const lot of compLots) {
                            if (compRemaining <= 0) break;
                            const deduct = Math.min(lot.quantity, compRemaining);
                            lotsToUpdate.push({ id: Number(lot.id), deduct });
                            compRemaining -= deduct;
                        }
                    }
                    continue;
                }

                const itemIdStr = String(item.id);
                const product = productsMap.get(itemIdStr);

                if (!product) {
                    console.error(`❌ ITEM SKIPPED (Not found in DB): Item ID ${item.id} (${item.name}). DB has ${dbProducts.length} products loaded.`);
                    // OPTIONAL: Fail the sale if an item is missing? 
                    // For now, continuing but logging error is better than silent failure.
                    // Ideally we should alert but this runs in background.
                    continue;
                }

                const quantity = parseFloat(item.quantity);
                const price = parseFloat(item.price);
                const cost = parseFloat(item.cost) || 0;

                // Validar cantidad
                if (quantity <= 0) {
                    console.error(`❌ Invalid quantity for ${item.name}: ${quantity}`);
                    return { success: false, error: `Cantidad inválida para ${item.name}` };
                }

                // Calcular stock disponible
                const itemLots = lotsByProduct.get(itemIdStr) || [];
                const totalLotQty = itemLots.reduce((sum, l) => sum + (l.quantity || 0), 0);
                const legacyStock = Math.max(0, product.stock - totalLotQty);
                const validLotStock = itemLots
                    .filter(l => l.quantity > 0 && (!l.expiry_date || l.expiry_date >= today))
                    .reduce((sum, l) => sum + l.quantity, 0);

                const totalSellable = legacyStock + validLotStock;

                // Verificar stock
                if (!inventoryAdjustmentMode && quantity > totalSellable) {
                    console.error(`❌ Insufficient stock for ${item.name}. Required: ${quantity}, Available: ${totalSellable}`);
                    return {
                        success: false,
                        error: `Stock insuficiente para: ${product.name}`
                    };
                }

                // Marcar productos que quedarán en negativo
                if (quantity > totalSellable) {
                    productsToMarkPending.push(item.id);
                }

                // Preparar datos del item (discountPercent para DTE SII)
                itemsToProcess.push({
                    id: item.id,
                    name: item.name,
                    quantity,
                    price,
                    cost,
                    tax_rate: parseFloat(item.tax_rate) || 0,
                    discountPercent: parseFloat(item.discountPercent) || 0
                });

                // Preparar UPDATE de producto
                productsToUpdate.push({
                    id: item.id,
                    quantityToDeduct: quantity,
                    markPending: productsToMarkPending.includes(item.id)
                });

                // Preparar UPDATEs de lotes (FEFO)
                const validLots = itemLots
                    .filter(l => l.quantity > 0)
                    .sort((a, b) => {
                        // Priority: non-expired first (FEFO), then expired, then no-date
                        const aExpired = a.expiry_date && a.expiry_date < today;
                        const bExpired = b.expiry_date && b.expiry_date < today;
                        if (aExpired !== bExpired) return aExpired ? 1 : -1;
                        if (!a.expiry_date) return 1;
                        if (!b.expiry_date) return -1;
                        return new Date(a.expiry_date) - new Date(b.expiry_date);
                    });

                let remainingQty = quantity;
                for (const lot of validLots) {
                    if (remainingQty <= 0) break;

                    const deduct = Math.min(lot.quantity, remainingQty);
                    lotsToUpdate.push({
                        id: Number(lot.id),
                        deduct
                    });
                    remainingQty -= deduct;
                }
            }

            console.log(`⚡ Pre-cálculos: ${(performance.now() - startTime).toFixed(2)}ms`);
            console.log(`📦 Lots to update: ${lotsToUpdate.length}, Products to update: ${productsToUpdate.length}`);

            // ============================================
            // FASE 3: TRANSACCIÓN OPTIMIZADA
            // ============================================

            const tx = await turso.transaction();

            try {
                const now = new Date().toISOString();
                const itemsJson = JSON.stringify(itemsToProcess);
                const detailsJson = JSON.stringify(sale.paymentDetails);

                // Calculate payment_due_date for credit sales
                let paymentDueDate = null;
                if (sale.paymentMethod === 'Crédito' && sale.client?.id) {
                    const clientData = get().clients.find(c => c.id === sale.client.id);
                    const periodDays = clientData?.credit_period_days || 30;
                    const dueDate = new Date();
                    dueDate.setDate(dueDate.getDate() + periodDays);
                    paymentDueDate = dueDate.toISOString();
                }

                // 1. INSERT sale (crítico)
                const saleResult = await tx.execute({
                    sql: `INSERT INTO sales 
                          (company_id, user_id, date, items, total, summary, payment_method, payment_details, status, client_id, client_name, payment_due_date) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
                    args: [
                        activeCompanyId,
                        currentUser?.id,
                        now,
                        itemsJson,
                        saleTotal,
                        sale.summary,
                        sale.paymentMethod,
                        detailsJson,
                        sale.client?.id || null,
                        sale.client?.name || null,
                        paymentDueDate
                    ]
                });

                const rawSaleId = saleResult.lastInsertRowid || Date.now();
                const saleId = typeof rawSaleId === 'bigint' ? Number(rawSaleId) : rawSaleId;

                // 2. BATCH UPDATE de productos
                //
                // FASE 3 · Concurrencia stock:
                // Cuando inventoryAdjustmentMode === false (NO se permite stock negativo)
                // añadimos la guarda `AND stock >= ?` y validamos rowsAffected.
                // Esto evita que dos cajas concurrentes vendan el mismo último ítem.
                // Si inventoryAdjustmentMode === true, mantenemos el comportamiento
                // histórico (sin guarda) para respetar la opción del usuario.
                const productUpdatePromises = productsToUpdate.map(p => {
                    if (inventoryAdjustmentMode) {
                        return tx.execute({
                            sql: `UPDATE products
                                  SET stock = ROUND(stock - ?, 3),
                                      pending_adjustment = CASE WHEN ? THEN 1 ELSE pending_adjustment END
                                  WHERE id = ? AND company_id = ?`,
                            args: [p.quantityToDeduct, p.markPending ? 1 : 0, p.id, activeCompanyId]
                        }).then(r => ({ kind: 'product', p, res: r }));
                    }
                    return tx.execute({
                        sql: `UPDATE products
                              SET stock = ROUND(stock - ?, 3),
                                  pending_adjustment = CASE WHEN ? THEN 1 ELSE pending_adjustment END
                              WHERE id = ? AND company_id = ? AND stock >= ?`,
                        args: [p.quantityToDeduct, p.markPending ? 1 : 0, p.id, activeCompanyId, p.quantityToDeduct]
                    }).then(r => ({ kind: 'product', p, res: r }));
                });

                // 3. BATCH UPDATE de lotes
                // Misma estrategia: con stock negativo permitido no aplicamos guarda;
                // sin él aplicamos `AND quantity >= ?` para evitar lotes negativos.
                const lotUpdatePromises = lotsToUpdate.map(l => {
                    if (inventoryAdjustmentMode) {
                        return tx.execute({
                            sql: `UPDATE product_lots SET quantity = ROUND(quantity - ?, 3) WHERE id = ?`,
                            args: [l.deduct, l.id]
                        }).then(r => ({ kind: 'lot', l, res: r }));
                    }
                    return tx.execute({
                        sql: `UPDATE product_lots SET quantity = ROUND(quantity - ?, 3) WHERE id = ? AND quantity >= ?`,
                        args: [l.deduct, l.id, l.deduct]
                    }).then(r => ({ kind: 'lot', l, res: r }));
                });

                // 4. Audit log
                const auditPromise = tx.execute({
                    sql: `INSERT INTO audit_logs
                          (company_id, user_id, action, entity, details, created_at)
                          VALUES (?, ?, 'CREATE', 'SALE', ?, ?)`,
                    args: [
                        activeCompanyId,
                        currentUser?.id,
                        JSON.stringify({ total: saleTotal, itemsCount: itemsToProcess.length }),
                        now
                    ]
                });

                // Ejecutar todos los UPDATEs
                const updateResults = await Promise.all([
                    ...productUpdatePromises,
                    ...lotUpdatePromises,
                ]);
                await auditPromise;

                // FASE 3 · Validación de rowsAffected (solo si NO se permite negativo).
                // Si alguna fila no fue actualizada significa que otra caja se llevó
                // el último stock entre la pre-validación y este UPDATE. Abortamos
                // la transacción para no vender stock que ya no existe.
                if (!inventoryAdjustmentMode) {
                    const failed = updateResults.filter(r => Number(r.res?.rowsAffected ?? 0) === 0);
                    if (failed.length > 0) {
                        const failedProducts = failed
                            .filter(f => f.kind === 'product')
                            .map(f => {
                                const prod = productsMap.get(String(f.p.id));
                                return prod?.name || `product#${f.p.id}`;
                            });
                        const failedLots = failed
                            .filter(f => f.kind === 'lot')
                            .map(f => `lot#${f.l.id}`);
                        await tx.rollback();
                        const detail = [...failedProducts, ...failedLots].join(', ');
                        console.error('❌ Stock concurrente insuficiente:', detail);
                        return {
                            success: false,
                            error: 'CONCURRENT_STOCK',
                            message: `Stock insuficiente (otra caja vendió primero): ${detail}`
                        };
                    }
                }

                // COMMIT
                await tx.commit();

                // FASE 4 · Escritura dual silenciosa a sale_items.
                // El JSON sales.items YA está guardado (fuente de verdad).
                // sale_items es snapshot complementario para analytics.
                // Si falla, NO debe afectar la venta — solo se loggea.
                // No se await: se dispara en background para no añadir latencia.
                mirrorSaleItems(turso, {
                    saleId,
                    companyId: activeCompanyId,
                    saleDate: now,
                    items: itemsToProcess,
                    source: 'live',
                }).catch(err => console.error('[fase4] mirrorSaleItems:', err?.message || err));

                // FASE 9 · Marca actividad para que el smart-polling (sync,
                // dashboard, alertas) cambie a modo "activo" y refresque ya.
                markActivity();

                console.log(`⚡ Transacción: ${(performance.now() - startTime).toFixed(2)}ms`);

                const stockSyncByProduct = new Map();
                itemsToProcess.forEach(item => {
                    // For combos, sync component products instead
                    if (item.is_combo) return;
                    const key = String(item.id);
                    const current = stockSyncByProduct.get(key) || {
                        product_id: item.id,
                        sku: null,
                        quantity_sold: 0,
                        stock: null,
                    };

                    current.quantity_sold += Number(item.quantity || 0);
                    stockSyncByProduct.set(key, current);
                });

                // Add combo component products to stock sync
                comboItems.forEach(combo => {
                    const saleQty = parseFloat(combo.quantity) || 1;
                    (combo.combo_items || []).forEach(comp => {
                        const key = String(comp.product_id);
                        const current = stockSyncByProduct.get(key) || {
                            product_id: comp.product_id,
                            sku: null,
                            quantity_sold: 0,
                            stock: null,
                        };
                        current.quantity_sold += (parseFloat(comp.quantity) || 1) * saleQty;
                        stockSyncByProduct.set(key, current);
                    });
                });

                const stockSyncItems = Array.from(stockSyncByProduct.values()).map(item => {
                    const product = productsMap.get(String(item.product_id));
                    const previousStock = Number(product?.stock || 0);
                    const unit = (product?.unit || 'un').toLowerCase();
                    const raw = previousStock - Number(item.quantity_sold || 0);
                    const nextStock = (unit === 'kg' || unit === 'lt')
                        ? Math.round(raw * 1000) / 1000
                        : Math.round(raw);
                    return {
                        product_id: item.product_id,
                        sku: product?.sku || null,
                        stock: nextStock,
                        unit: product?.unit || 'Und',
                    };
                }).filter(item => item.sku && Number.isFinite(item.stock));

                if (stockSyncItems.length === 0) {
                    console.warn('Stock sync skipped: no hay items válidos con sku/stock', {
                        saleId,
                        rawItems: itemsToProcess.map(i => ({ id: i.id, name: i.name })),
                    });
                } else {
                    get().syncSaleStockToStore({
                        saleId,
                        soldAt: now,
                        items: stockSyncItems,
                    }).then(syncResult => {
                        if (!syncResult?.success) {
                            console.warn('Stock sync post-sale failed:', {
                                saleId,
                                syncResult,
                                items: stockSyncItems,
                            });
                        } else {
                            console.log('✅ Stock sync post-sale success:', {
                                saleId,
                                status: syncResult.status,
                                items: stockSyncItems,
                            });
                        }
                    }).catch(syncError => {
                        console.warn('Stock sync post-sale error:', {
                            saleId,
                            error: syncError?.message || String(syncError),
                            items: stockSyncItems,
                        });
                    });
                }

                // ============================================
                // FASE 4: ACTUALIZAR ESTADO LOCAL (OPTIMISTIC)
                // ============================================

                // Actualizar lotes localmente
                const updatedLots = [...productLots];
                lotsToUpdate.forEach(lotUpdate => {
                    const lot = updatedLots.find(l => l.id === lotUpdate.id);
                    if (lot) lot.quantity -= lotUpdate.deduct;
                });

                // Actualizar estado
                set((state) => ({
                    sales: [{
                        id: saleId,
                        date: now,
                        status: 'completed',
                        clientId: sale.client?.id || null,
                        clientName: sale.client?.name || null,
                        client_id: sale.client?.id || null,
                        client_name: sale.client?.name || null,
                        company_id: activeCompanyId,
                        user_id: currentUser?.id,
                        user_name: currentUser?.name,
                        items: itemsToProcess,
                        payment_method: sale.paymentMethod,
                        payment_details: sale.paymentDetails,
                        total: saleTotal,
                        summary: sale.summary
                    }, ...state.sales],
                    productLots: updatedLots,
                    products: state.products.map(p => {
                        const update = productsToUpdate.find(u => u.id === p.id);
                        if (update) {
                            return {
                                ...p,
                                stock: Math.round((p.stock - update.quantityToDeduct) * 1000) / 1000,
                                pending_adjustment: update.markPending ? 1 : p.pending_adjustment
                            };
                        }
                        return p;
                    })
                }));

                // Actualizar stats de caja (no blocking)
                const postSaleCashRegister = get().cashRegister;
                if (postSaleCashRegister?.id) {
                    get().refreshRegisterStats(postSaleCashRegister.id);
                }

                // ============================================
                // FASE 5: AGREGACIONES EN BACKGROUND (NO BLOQUEA)
                // ============================================

                // Esto se ejecuta DESPUÉS de que la UI ya mostró éxito
                // No afecta la velocidad percibida por el usuario
                setTimeout(async () => {
                    try {
                        await get().updateAllAggregations(
                            {
                                ...sale,
                                total: saleTotal,
                                date: now,
                                items: itemsToProcess
                            },
                            currentUser?.id,
                            currentUser?.name,
                            activeCompanyId,
                            get().currentCompanyTimezone
                        );
                    } catch (aggErr) {
                        console.error('⚠️ Aggregation update failed:', aggErr);
                    }
                }, 0);

                const totalTime = (performance.now() - startTime).toFixed(2);
                console.log(`✅ Venta completada en ${totalTime}ms`);

                // Check inventory alerts (non-blocking)
                setTimeout(() => {
                    const productIds = itemsToProcess.map(i => i.id).filter(Boolean);
                    get().checkInventoryAlerts(productIds);
                }, 100);

                // Sync client debt columns if credit sale (await: el saldo del cliente DEBE
                // quedar coherente antes de retornar para que la siguiente venta lo lea bien)
                if (sale.paymentMethod === 'Crédito' && sale.client?.id) {
                    try {
                        await get()._syncClientDebt(sale.client.id);
                    } catch (debtErr) {
                        console.warn('⚠️ _syncClientDebt failed post-sale:', debtErr);
                    }
                }

                // ============================================
                // FASE 6: EMISIÓN DTE SII (NON-BLOCKING)
                // ============================================
                setTimeout(async () => {
                    try {
                        const siiConfigRes = await turso.execute({
                            sql: 'SELECT auto_emit, is_active FROM sii_config WHERE company_id = ?',
                            args: [activeCompanyId]
                        });
                        const siiCfg = siiConfigRes.rows[0];
                        if (siiCfg && Number(siiCfg.auto_emit) === 1 && Number(siiCfg.is_active) === 1) {
                            // Use tipoDte from sale data (set in POS), fallback to auto-detect
                            const tipoDte = sale.tipoDte != null ? sale.tipoDte : ((sale.client?.rut && sale.client.rut.trim()) ? 33 : 39);
                            // Skip SII emission for Nota de Venta (tipo 0)
                            if (tipoDte === 0) {
                                console.log('📝 Nota de Venta — sin emisión SII');
                                return;
                            }
                            const body = {
                                sale_id: saleId,
                                tipo_dte: tipoDte,
                            };
                            if ((tipoDte === 33 || tipoDte === 34) && sale.invoiceData) {
                                body.rut_receptor = sale.invoiceData.rut_receptor;
                                body.razon_social_receptor = sale.invoiceData.razon_social_receptor;
                                body.giro_receptor = sale.invoiceData.giro_receptor;
                                body.dir_receptor = sale.invoiceData.dir_receptor;
                                body.comuna_receptor = sale.invoiceData.comuna_receptor;
                                body.ciudad_receptor = sale.invoiceData.ciudad_receptor;
                                if (sale.invoiceData.formaPago) {
                                    body.forma_pago = sale.invoiceData.formaPago;
                                    if (sale.invoiceData.diasCredito) {
                                        body.dias_credito = sale.invoiceData.diasCredito;
                                    }
                                }
                            } else if (tipoDte === 33 && sale.client) {
                                body.rut_receptor = sale.client.rut;
                                body.razon_social_receptor = sale.client.name || sale.client.razon_social || 'Sin Razón Social';
                            }
                            const emitRes = await fetch('/api/sii/emit', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-company-id': activeCompanyId,
                                },
                                body: JSON.stringify(body),
                            });
                            const emitData = await emitRes.json();
                            if (emitRes.ok && emitData.success) {
                                console.log(`📄 DTE emitido: Tipo ${tipoDte}, Folio ${emitData.folio}, TrackID ${emitData.track_id}`);
                                // Auto-check status after 15s
                                if (emitData.track_id) {
                                    setTimeout(async () => {
                                        try {
                                            await fetch(`/api/sii/status?track_id=${encodeURIComponent(emitData.track_id)}`, {
                                                headers: { 'x-company-id': activeCompanyId },
                                            });
                                            console.log('✅ Auto-check estado DTE completado');
                                        } catch (e) {
                                            console.warn('⚠️ Auto-check estado DTE falló:', e.message);
                                        }
                                    }, 15000);
                                }
                            } else {
                                console.warn('⚠️ DTE emission failed:', emitData.error || emitData);
                            }
                        }
                    } catch (siiErr) {
                        console.warn('⚠️ SII auto-emit error (non-blocking):', siiErr.message);
                    }
                }, 200);

                return { success: true, saleId, creditWarning: sale._creditWarning || null };

            } catch (error) {
                // ROLLBACK COMPLETO de la transacción crítica
                try { await tx.rollback(); } catch { /* tx ya pudo cerrarse */ }
                console.error('❌ Sale failed, rolled back:', error);

                // 🛟 FAILSAFE: encolar la venta en localStorage para reintento automático.
                // Así NO perdemos la venta aunque haya caída de red / timeout de Turso.
                // Para el cajero la venta sigue siendo "exitosa" — se sincroniza apenas vuelva la conexión.
                try {
                    const queued = get()._queueFailedSale(sale, error?.message || String(error));
                    if (queued) {
                        return {
                            success: true,
                            saleId: queued.tempId,
                            queued: true,
                            queueReason: error?.message || 'Sin conexión',
                            creditWarning: sale._creditWarning || null,
                        };
                    }
                } catch (qErr) {
                    console.error('❌ Failed to queue sale for retry:', qErr);
                }

                return { success: false, error: error.message };
            }

        } catch (e) {
            console.error('❌ Sale error:', e);
            // También intentar encolar si fue un error antes de la transacción
            try {
                const queued = get()._queueFailedSale(sale, e?.message || String(e));
                if (queued) {
                    return {
                        success: true,
                        saleId: queued.tempId,
                        queued: true,
                        queueReason: e?.message || 'Sin conexión',
                    };
                }
            } catch { /* noop */ }
            return { success: false, error: e.message };
        }
    },

    // ============================================
    // 🛟 COLA DE VENTAS PENDIENTES (FAILSAFE OFFLINE)
    // ============================================
    // Si una venta falla en la transacción (caída de red, timeout de Turso),
    // la guardamos en localStorage y la reintentamos en background.
    // Así el cajero NUNCA pierde una venta aunque la conexión se corte.

    /**
     * Procesa una venta SIN tocar Turso, usando solo Dexie y el state local.
     * Se llama cuando navigator.onLine === false.
     * El stock se decrementa LOCALMENTE en Dexie + Zustand para evitar sobreventa
     * en la misma sesión offline. Al volver online y sincronizar, addSale ejecuta
     * la transacción real contra Turso (fuente de verdad).
     */
    _addSaleOffline: async (sale) => {
        const startTime = performance.now();
        const { activeCompanyId, currentUser, products, productLots, clients, inventoryAdjustmentMode } = get();

        // Validación básica
        if (!sale?.items?.length || !sale.total || sale.total < 0) {
            return { success: false, error: 'Datos de venta inválidos' };
        }
        if (!activeCompanyId || !currentUser) {
            return { success: false, error: 'Sesión inválida — vuelve a iniciar sesión' };
        }

        // Validación de cliente
        if (sale.client?.id) {
            const c = clients.find(x => x.id === sale.client.id);
            if (c?.client_status === 'blocked') {
                return { success: false, error: 'CLIENT_BLOCKED', message: 'Este cliente está bloqueado.' };
            }
            if (sale.paymentMethod === 'Crédito' && c) {
                if (c.client_status === 'credit_blocked' || c.credit_enabled === 0) {
                    return { success: false, error: 'CREDIT_NOT_ALLOWED', message: 'Este cliente no tiene habilitado el crédito.' };
                }
                // Nota: el límite real se valida al sincronizar (requiere SUM en servidor).
            }
        }

        // Validación de stock contra catálogo en memoria
        const stockErrors = [];
        for (const item of sale.items) {
            if (item.is_combo) continue;
            const product = products.find(p => p.id === item.id);
            if (!product) {
                stockErrors.push(`Producto no encontrado en catálogo local: ${item.name || item.id}`);
                continue;
            }
            const lots = productLots.filter(l => (l.product_id === item.id || l.productId === item.id));
            const lotStock = lots.reduce((sum, l) => sum + parseFloat(l.quantity || 0), 0);
            const totalStock = parseFloat(product.stock || 0) + lotStock;
            const qty = parseFloat(item.quantity || 0);
            if (qty > totalStock && !inventoryAdjustmentMode) {
                stockErrors.push(`Stock insuficiente para ${item.name || product.name}: pedido ${qty}, disponible ${totalStock}`);
            }
        }
        if (stockErrors.length > 0 && !inventoryAdjustmentMode) {
            return {
                success: false,
                error: 'STOCK_INSUFFICIENT_OFFLINE',
                message: stockErrors.join(' · ')
            };
        }

        // Encolar en Dexie
        const tempId = `offline_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

        // Si es boleta (tipo 39), intentar tomar un folio CAF pre-reservado
        // para que el DTE pueda emitirse al sincronizar. Si no hay folios
        // disponibles, la venta se encola igual y el DTE se emitirá usando
        // el siguiente folio del CAF al sincronizar (puede fallar si no hay).
        let offlineFolio = null;
        const tipoDteRequested = sale.tipoDte ?? null;
        if (tipoDteRequested === 39) {
            try {
                offlineFolio = await siiFoliosApi.takeOne(activeCompanyId, 39, tempId);
                if (!offlineFolio) {
                    console.warn('⚠️ No hay folios CAF offline disponibles para boleta. Venta encolada sin folio.');
                }
            } catch (e) {
                console.warn('⚠️ Error tomando folio offline:', e);
            }
        }

        try {
            await pendingOpsApi.add({
                tempId,
                companyId: activeCompanyId,
                userId: currentUser.id,
                type: 'sale',
                payload: {
                    items: sale.items,
                    total: sale.total,
                    summary: sale.summary,
                    paymentMethod: sale.paymentMethod,
                    paymentDetails: sale.paymentDetails,
                    client: sale.client || null,
                    tipoDte: sale.tipoDte ?? null,
                    invoiceData: sale.invoiceData || null,
                    _offlineCreatedAt: new Date().toISOString(),
                    _offlineUserId: currentUser.id,
                    _offlineUserName: currentUser.name || currentUser.username,
                    _offlineFolio: offlineFolio?.folio ?? null,
                    _offlineFolioId: offlineFolio?.id ?? null,
                    _offlineFolioTipoDte: offlineFolio?.tipoDte ?? null,
                },
            });
        } catch (e) {
            console.error('❌ No se pudo encolar venta offline en Dexie:', e);
            // Si tomamos folio, liberarlo para no perderlo.
            if (offlineFolio?.id) {
                await siiFoliosApi.releaseFolio(offlineFolio.id).catch(() => {});
            }
            // Fallback: usar localStorage (mecanismo legacy) para no perder la venta.
            const fallback = get()._queueFailedSale(sale, `offline-dexie-fail: ${e.message}`);
            if (fallback) {
                return { success: true, saleId: fallback.tempId, queued: true, queueReason: 'offline' };
            }
            return { success: false, error: 'No se pudo guardar la venta offline.' };
        }

        // Decrementar stock LOCAL en Dexie (best-effort, no bloqueante).
        try {
            for (const item of sale.items) {
                if (item.is_combo) continue;
                const qty = parseFloat(item.quantity || 0);
                if (!qty) continue;
                const localProd = await localDb.products.get(item.id);
                if (localProd) {
                    const newStock = parseFloat(localProd.stock || 0) - qty;
                    await localDb.products.update(item.id, { stock: newStock });
                }
            }
        } catch (e) {
            console.warn('⚠️ Decremento de stock local falló (no bloquea venta):', e);
        }

        // Actualizar contador y stock en Zustand state
        try {
            const total = await pendingOpsApi.count(activeCompanyId, 'queued');
            set({ pendingSalesCount: total });
        } catch { /* noop */ }

        try {
            set(state => ({
                products: state.products.map(p => {
                    const item = sale.items.find(i => !i.is_combo && i.id === p.id);
                    if (!item) return p;
                    const qty = parseFloat(item.quantity || 0);
                    return { ...p, stock: parseFloat(p.stock || 0) - qty };
                })
            }));
        } catch { /* noop */ }

        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`📴 Venta OFFLINE encolada en ${elapsed}ms — tempId=${tempId}`);

        return {
            success: true,
            saleId: tempId,
            queued: true,
            offline: true,
            queueReason: 'offline',
            offlineFolio: offlineFolio?.folio ?? null,
        };
    },

    _queueFailedSale: (sale, reason = 'unknown') => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null;
            const { activeCompanyId, currentUser, currentCompanyTimezone } = get();
            const KEY = 'poskem_pending_sales_v1';
            const queue = JSON.parse(localStorage.getItem(KEY) || '[]');
            const tempId = `pending_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            const entry = {
                tempId,
                companyId: activeCompanyId,
                userId: currentUser?.id || null,
                userName: currentUser?.name || null,
                timezone: currentCompanyTimezone || null,
                queuedAt: new Date().toISOString(),
                attempts: 0,
                lastError: reason,
                sale: {
                    items: sale.items,
                    total: sale.total,
                    summary: sale.summary,
                    paymentMethod: sale.paymentMethod,
                    paymentDetails: sale.paymentDetails,
                    client: sale.client || null,
                    tipoDte: sale.tipoDte ?? null,
                    invoiceData: sale.invoiceData || null,
                },
            };
            queue.push(entry);
            localStorage.setItem(KEY, JSON.stringify(queue));
            set({ pendingSalesCount: queue.length });
            console.warn(`🛟 Venta encolada para reintento (tempId=${tempId}, motivo: ${reason})`);
            return entry;
        } catch (e) {
            console.error('Error encolando venta pendiente:', e);
            return null;
        }
    },

    getPendingSalesQueue: () => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return [];
            return JSON.parse(localStorage.getItem('poskem_pending_sales_v1') || '[]');
        } catch { return []; }
    },

    processPendingSalesQueue: async () => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return { processed: 0 };
            if (!navigator?.onLine) return { processed: 0, offline: true };
            const KEY = 'poskem_pending_sales_v1';
            const queue = JSON.parse(localStorage.getItem(KEY) || '[]');
            if (queue.length === 0) {
                // Aún así, contar lo que haya en Dexie para mantener el badge correcto
                let dexieCount = 0;
                try {
                    const { activeCompanyId } = get();
                    if (activeCompanyId) {
                        dexieCount = await pendingOpsApi.count(activeCompanyId, 'queued');
                    }
                } catch { /* noop */ }
                set({ pendingSalesCount: dexieCount });
                return { processed: 0, remaining: dexieCount };
            }
            const { activeCompanyId } = get();
            const remaining = [];
            let processed = 0;
            for (const entry of queue) {
                // Solo reintentar las de la empresa activa para evitar mezclar contextos.
                if (entry.companyId && activeCompanyId && entry.companyId !== activeCompanyId) {
                    remaining.push(entry);
                    continue;
                }
                try {
                    entry.attempts = (entry.attempts || 0) + 1;
                    const result = await get().addSale(entry.sale);
                    if (result?.success && !result.queued) {
                        processed += 1;
                        console.log(`✅ Venta pendiente sincronizada (tempId=${entry.tempId}, saleId=${result.saleId})`);
                    } else if (result?.queued) {
                        // Sigue offline — mantenerla
                        remaining.push(entry);
                    } else {
                        entry.lastError = result?.error || 'unknown';
                        if (entry.attempts < 10) remaining.push(entry);
                        else console.error(`❌ Venta pendiente descartada tras 10 intentos:`, entry);
                    }
                } catch (e) {
                    entry.lastError = e?.message || String(e);
                    if (entry.attempts < 10) remaining.push(entry);
                }
            }
            localStorage.setItem(KEY, JSON.stringify(remaining));
            // Contador unificado: legacy localStorage + Dexie pendingOps queued
            let dexieCount = 0;
            try {
                const { activeCompanyId } = get();
                if (activeCompanyId) {
                    dexieCount = await pendingOpsApi.count(activeCompanyId, 'queued');
                }
            } catch { /* noop */ }
            set({ pendingSalesCount: remaining.length + dexieCount });
            return { processed, remaining: remaining.length + dexieCount };
        } catch (e) {
            console.error('Error procesando cola de ventas pendientes:', e);
            return { processed: 0, error: e.message };
        }
    },

    cancelSale: async (saleId, observation = '') => {
        try {
            const { sales, activeCompanyId, fetchSaleDetails, cashRegister, currentUser } = get();

            // 1. Get Sale & Complete Details
            let sale = sales.find(s => s.id === saleId);

            // Check if we have full items details. If not, fetch them.
            if (!sale || !sale.items || (Array.isArray(sale.items) && sale.items.length === 0) || typeof sale.items === 'string') {
                const details = await fetchSaleDetails(saleId);
                if (!details) {
                    console.error("Sale not found for cancellation");
                    return false;
                }
                sale = details;
            }

            // Ensure items is an array
            const items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;

            console.log(`🚫 Cancelling Sale #${saleId} - Items: ${items.length}`);

            // 2. Prepare Transaction Queries
            const queries = [
                // Mark sale as cancelled
                {
                    sql: "UPDATE sales SET status = 'cancelled', observation = ? WHERE id = ? AND company_id = ?",
                    args: [observation, saleId, activeCompanyId]
                }
            ];

            // 3. Process Items Restoration
            for (const item of items) {
                // A. Restore Product Total Stock
                queries.push({
                    sql: "UPDATE products SET stock = ROUND(stock + ?, 3) WHERE id = ? AND company_id = ?",
                    args: [item.quantity, item.id, activeCompanyId]
                });

                // C. Restore to Lot (Add to most recent lot)
                // We use a subquery to find the most recent lot for this product to restore stock to.
                queries.push({
                    sql: `UPDATE product_lots 
                           SET quantity = quantity + ? 
                           WHERE id = (
                               SELECT id FROM product_lots 
                               WHERE product_id = ? AND company_id = ? 
                               ORDER BY created_at DESC LIMIT 1
                           )`,
                    args: [item.quantity, item.id, activeCompanyId]
                });
            }

            // 4. Refund from Cash Register (If open)
            // Cash register balance is calculated dynamically from sales, not stored as a column.
            // We only need to log the refund audit entry.
            if (cashRegister && cashRegister.id) {
                // Audit Refund
                queries.push({
                    sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    args: [activeCompanyId, currentUser?.id, 'REFUND', 'SALE', JSON.stringify({ saleId, total: sale.total, reason: observation }), new Date().toISOString()]
                });
            }

            // Execute Batch Transaction
            await turso.batch(queries);

            // 5. Reverse all aggregations (sales_daily_summary, vendor_daily_performance,
            //    product_daily_profit, product_movement_stats, hourly_sales_stats).
            //    This keeps the pre-aggregated reports (Venta de Productos, Análisis de Ventas)
            //    in sync with the live `sales` table.
            try {
                await get().reverseAllAggregations(
                    { ...sale, items, total: sale.total, date: sale.date },
                    sale.user_id,
                    activeCompanyId,
                    get().currentCompanyTimezone
                );
            } catch (aggErr) {
                console.warn('⚠️ reverseAllAggregations failed for cancelled sale', saleId, aggErr);
            }

            // 5. Update Local State
            set(state => ({
                sales: state.sales.map(s => s.id === saleId ? { ...s, status: 'cancelled', observation } : s),

                // Optimistically update products stock in UI
                products: state.products.map(p => {
                    const item = items.find(i => i.id === p.id);
                    if (item) {
                        return { ...p, stock: Math.round(((parseFloat(p.stock) || 0) + parseFloat(item.quantity)) * 1000) / 1000 };
                    }
                    return p;
                })
            }));

            // 6. Sync restored stock to online store (WooCommerce)
            try {
                const { products: updatedProducts } = get();
                const productIds = items.map(item => item.id).filter(Boolean);

                // Query fresh stock + SKU from DB for cancelled items
                let dbProducts = [];
                if (productIds.length > 0) {
                    const placeholders = productIds.map(() => '?').join(',');
                    const dbResult = await turso.execute({
                        sql: `SELECT id, sku, stock, unit FROM products WHERE id IN (${placeholders}) AND company_id = ?`,
                        args: [...productIds, activeCompanyId]
                    });
                    dbProducts = dbResult.rows || [];
                }

                const stockSyncItems = items.map(item => {
                    const dbProd = dbProducts.find(p => String(p.id) === String(item.id));
                    const stateProd = updatedProducts.find(p => String(p.id) === String(item.id));
                    const sku = dbProd?.sku || stateProd?.sku || null;
                    const unit = (dbProd?.unit || stateProd?.unit || 'un').toLowerCase();
                    const raw = parseFloat(dbProd?.stock ?? stateProd?.stock ?? 0);
                    const stock = (unit === 'kg' || unit === 'lt')
                        ? Math.round(raw * 1000) / 1000
                        : Math.round(raw);
                    return { product_id: item.id, sku, stock, unit: dbProd?.unit || stateProd?.unit || 'Und' };
                }).filter(item => item.sku && normalizeSku(item.sku) && Number.isFinite(item.stock));

                console.log(`🔄 Cancel sync: ${stockSyncItems.length} items to sync`, stockSyncItems);

                if (stockSyncItems.length > 0) {
                    get().syncSaleStockToStore({
                        saleId,
                        soldAt: new Date().toISOString(),
                        items: stockSyncItems,
                    }).then(syncResult => {
                        if (!syncResult?.success) {
                            console.warn('Stock sync post-cancel failed:', { saleId, syncResult, items: stockSyncItems });
                        } else {
                            console.log('✅ Stock sync post-cancel success:', { saleId, status: syncResult.status, items: stockSyncItems });
                        }
                    }).catch(syncError => {
                        console.warn('Stock sync post-cancel error:', { saleId, error: syncError?.message || String(syncError), items: stockSyncItems });
                    });
                } else {
                    console.warn('⚠️ Cancel sync skipped: no items with valid SKU', { saleId, items, dbProducts });
                }
            } catch (syncErr) {
                console.warn('Stock sync post-cancel setup error:', syncErr);
            }

            // Check inventory alerts after cancel (non-blocking)
            setTimeout(() => { get().checkInventoryAlerts(); }, 100);

            // Refrescar stats de caja para descontar la venta anulada
            const postCancelRegister = get().cashRegister;
            if (postCancelRegister?.id) {
                get().refreshRegisterStats(postCancelRegister.id);
            }

            // Sync client debt if this was a credit sale (await para que el saldo quede
            // actualizado antes de devolver el control a la UI)
            const cancelledClientId = sale.client_id || sale.clientId;
            if (cancelledClientId && sale.payment_method === 'Crédito') {
                try {
                    await get()._syncClientDebt(cancelledClientId);
                } catch (debtErr) {
                    console.warn('⚠️ _syncClientDebt failed post-cancel:', debtErr);
                }
            }

            return true;

        } catch (e) {
            console.error("Cancel sale error", e);
            return { success: false, error: e?.message || String(e) };
        }
    },

    // ============================================
    // 🔄 DEVOLUCIONES (Product Returns)
    // ============================================

    processReturn: async (saleId, returnItems, reason) => {
        try {
            const { activeCompanyId, currentUser, fetchSaleDetails, sales, currentCompanyTimezone } = get();

            // Ensure table exists
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS sale_returns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    sale_id INTEGER NOT NULL,
                    user_id INTEGER,
                    reason TEXT NOT NULL,
                    items TEXT NOT NULL,
                    total REAL NOT NULL,
                    created_at TEXT NOT NULL
                )
            `);

            // 1. Get full sale details
            let sale = sales.find(s => s.id === saleId);
            if (!sale || !sale.items) {
                sale = await fetchSaleDetails(saleId);
            }
            if (!sale) return { success: false, error: 'Venta no encontrada' };

            const items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;

            // 2. Fetch existing returns for this sale to validate quantities
            const existingReturnsResult = await turso.execute({
                sql: "SELECT items FROM sale_returns WHERE sale_id = ? AND company_id = ?",
                args: [saleId, activeCompanyId]
            });

            // Build map of already-returned quantities
            const alreadyReturned = {};
            for (const row of existingReturnsResult.rows) {
                const retItems = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
                for (const ri of retItems) {
                    alreadyReturned[ri.id] = (alreadyReturned[ri.id] || 0) + ri.quantity;
                }
            }

            // 3. Validate each return item
            const validatedItems = [];
            for (const ri of returnItems) {
                const originalItem = items.find(i => i.id === ri.id);
                if (!originalItem) continue;

                const previouslyReturned = alreadyReturned[ri.id] || 0;
                const maxReturnable = originalItem.quantity - previouslyReturned;

                if (ri.quantity <= 0 || ri.quantity > maxReturnable) {
                    return { success: false, error: `Cantidad inválida para ${originalItem.name}. Máximo devolvible: ${maxReturnable}` };
                }

                validatedItems.push({
                    id: ri.id,
                    name: originalItem.name,
                    sku: originalItem.sku || '',
                    quantity: ri.quantity,
                    price: originalItem.price,
                    cost: originalItem.cost || 0,
                    unit: originalItem.unit || 'Und'
                });
            }

            if (validatedItems.length === 0) {
                return { success: false, error: 'No hay productos válidos para devolver' };
            }

            const returnTotal = validatedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const now = new Date().toISOString();

            // Día de la VENTA original en la zona horaria del comercio (consistente con
            // updateSalesDailySummary / updateProductDailyProfit que también usan TZ).
            const tz = currentCompanyTimezone;
            const saleDay = formatInCompanyTime(sale.date, tz, 'yyyy-MM-dd');

            // 4. Build transaction queries
            const queries = [
                // Insert the return record
                {
                    sql: "INSERT INTO sale_returns (company_id, sale_id, user_id, reason, items, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    args: [activeCompanyId, saleId, currentUser?.id, reason, JSON.stringify(validatedItems), returnTotal, now]
                },
                // Audit log
                {
                    sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    args: [activeCompanyId, currentUser?.id, 'RETURN', 'SALE', JSON.stringify({ saleId, returnTotal, items: validatedItems.map(i => ({ id: i.id, name: i.name, qty: i.quantity })), reason }), now]
                }
            ];

            // 5. Restore stock for each returned item
            for (const item of validatedItems) {
                queries.push({
                    sql: "UPDATE products SET stock = ROUND(stock + ?, 3) WHERE id = ? AND company_id = ?",
                    args: [item.quantity, item.id, activeCompanyId]
                });
                // Restore to most recent lot
                queries.push({
                    sql: `UPDATE product_lots 
                           SET quantity = quantity + ? 
                           WHERE id = (
                               SELECT id FROM product_lots 
                               WHERE product_id = ? AND company_id = ? 
                               ORDER BY created_at DESC LIMIT 1
                           )`,
                    args: [item.quantity, item.id, activeCompanyId]
                });
            }

            // 6. Update daily summary (resta el monto devuelto del total del día de la venta original).
            //    No tocamos total_orders porque la venta sigue existiendo (devolución parcial).
            queries.push({
                sql: `UPDATE sales_daily_summary 
                      SET total_sales = MAX(0, total_sales - ?),
                          updated_at = datetime('now')
                      WHERE day = ? AND company_id = ?`,
                args: [returnTotal, saleDay, activeCompanyId]
            });

            // 7. Registrar movimiento de caja por el reembolso (DENTRO del batch para que sea
            //    atómico con la devolución: si falla algo, no queda devolución sin movimiento).
            const openRegister = get().cashRegister;
            if (openRegister?.id) {
                queries.push({
                    sql: "INSERT INTO cash_movements (register_id, type, amount, reason, date, company_id) VALUES (?, ?, ?, ?, ?, ?)",
                    args: [openRegister.id, 'OUT', returnTotal, `Devolución Venta #${saleId}: ${reason}`, now, activeCompanyId]
                });
            }

            // Execute all queries as a batch
            await turso.batch(queries);

            // 7b. Revertir agregaciones de los productos devueltos.
            //     Esto mantiene en cuadre: product_daily_profit, product_movement_stats.
            //     NO tocamos vendor_daily_performance ni hourly_sales_stats porque la venta
            //     sigue existiendo (es una devolución parcial: el ticket no desaparece).
            try {
                // Adaptar items al formato esperado por reverseProductDailyProfit / reverseProductMovementStats
                const itemsForReverse = validatedItems.map(i => ({
                    id: i.id,
                    name: i.name,
                    quantity: i.quantity,
                    price: i.price,
                    cost: i.cost || 0,
                    tax_rate: 0, // El detalle de tax queda en la venta original; restamos solo cantidad y revenue
                }));
                await Promise.all([
                    get().reverseProductDailyProfit(itemsForReverse, activeCompanyId, sale.date),
                    get().reverseProductMovementStats(itemsForReverse, activeCompanyId),
                ]);
            } catch (aggErr) {
                console.warn('⚠️ Reverso parcial de agregaciones falló (devolución):', aggErr);
            }

            // 8. Update local state - stock
            set(state => ({
                products: state.products.map(p => {
                    const returnedItem = validatedItems.find(i => i.id === p.id);
                    if (returnedItem) {
                        return { ...p, stock: Math.round(((parseFloat(p.stock) || 0) + parseFloat(returnedItem.quantity)) * 1000) / 1000 };
                    }
                    return p;
                })
            }));

            // 9. Sync stock to online store (non-blocking)
            try {
                const { products: updatedProducts } = get();
                const productIds = validatedItems.map(item => item.id).filter(Boolean);

                if (productIds.length > 0) {
                    const placeholders = productIds.map(() => '?').join(',');
                    const dbResult = await turso.execute({
                        sql: `SELECT id, sku, stock, unit FROM products WHERE id IN (${placeholders}) AND company_id = ?`,
                        args: [...productIds, activeCompanyId]
                    });
                    const dbProducts = dbResult.rows || [];

                    const stockSyncItems = validatedItems.map(item => {
                        const dbProd = dbProducts.find(p => String(p.id) === String(item.id));
                        const stateProd = updatedProducts.find(p => String(p.id) === String(item.id));
                        const sku = dbProd?.sku || stateProd?.sku || null;
                        const unit = (dbProd?.unit || stateProd?.unit || 'un').toLowerCase();
                        const raw = parseFloat(dbProd?.stock ?? stateProd?.stock ?? 0);
                        const stock = (unit === 'kg' || unit === 'lt')
                            ? Math.round(raw * 1000) / 1000
                            : Math.round(raw);
                        return { product_id: item.id, sku, stock, unit: dbProd?.unit || stateProd?.unit || 'Und' };
                    }).filter(item => item.sku && normalizeSku(item.sku) && Number.isFinite(item.stock));

                    if (stockSyncItems.length > 0) {
                        get().syncSaleStockToStore({
                            saleId,
                            soldAt: now,
                            items: stockSyncItems,
                        }).catch(err => console.warn('Stock sync post-return error:', err));
                    }
                }
            } catch (syncErr) {
                console.warn('Stock sync post-return setup error:', syncErr);
            }

            // 10. Refrescar stats de caja si está abierta
            if (openRegister?.id) {
                get().refreshRegisterStats(openRegister.id);
            }

            setTimeout(() => { get().checkInventoryAlerts(); }, 100);

            return { success: true, returnTotal };

        } catch (e) {
            console.error("Process return error:", e);
            return { success: false, error: e?.message || String(e) };
        }
    },

    fetchSaleReturns: async (saleId) => {
        try {
            const { activeCompanyId } = get();
            await turso.execute(`CREATE TABLE IF NOT EXISTS sale_returns (
                id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, sale_id INTEGER NOT NULL,
                user_id INTEGER, reason TEXT NOT NULL, items TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL
            )`);
            const result = await turso.execute({
                sql: "SELECT id, sale_id, user_id, reason, items, total, created_at FROM sale_returns WHERE sale_id = ? AND company_id = ? ORDER BY created_at DESC",
                args: [saleId, activeCompanyId]
            });
            return result.rows.map(r => ({
                ...r,
                items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items
            }));
        } catch (e) {
            console.error("Fetch sale returns error:", e);
            return [];
        }
    },

    registerClientPayment: async (client, amount, distributionOrSalesIds, paymentMethod) => {
        try {
            const { currentUser, sales } = get();

            // Ensure amount_paid column exists (migration may not have run yet)
            try {
                const salesCols = await turso.execute(`PRAGMA table_info(sales)`);
                if (!salesCols.rows.some(c => c.name === 'amount_paid')) {
                    await turso.execute(`ALTER TABLE sales ADD COLUMN amount_paid REAL DEFAULT 0`);
                }
            } catch (_) { /* column likely already exists */ }

            // Support both old format (array of IDs) and new format (distribution array)
            let distribution;
            if (Array.isArray(distributionOrSalesIds) && distributionOrSalesIds.length > 0 && typeof distributionOrSalesIds[0] === 'object') {
                // New format: [{ saleId, amount, fullyPaid, newTotalPaid }]
                distribution = distributionOrSalesIds;
            } else {
                // Legacy format: array of sale IDs (mark all as fully paid)
                distribution = distributionOrSalesIds.map(id => {
                    const sale = sales.find(s => s.id === id);
                    return { saleId: id, amount: sale ? parseFloat(sale.total) : 0, fullyPaid: true, newTotalPaid: sale ? parseFloat(sale.total) : 0 };
                });
            }

            const partialCount = distribution.filter(d => !d.fullyPaid).length;
            const totalBoletas = distribution.length;

            // 1. Create a "Payment" Sale entry (So it appears in daily cash register)
            let summaryDetail = `${totalBoletas} boleta${totalBoletas > 1 ? 's' : ''}`;
            if (partialCount > 0) summaryDetail += ` (${partialCount} parcial)`;

            const paymentSale = {
                date: getNowInCompanyTime(get().currentCompanyTimezone).toISOString(),
                total: amount,
                summary: `Abono de Cliente: ${client.name}`,
                items: JSON.stringify([{
                    id: 'payment-adj',
                    name: `Abono / Pago de Deuda (${summaryDetail})`,
                    price: amount,
                    quantity: 1,
                    unit: 'Und'
                }]),
                payment_method: paymentMethod,
                payment_details: JSON.stringify({ amount: amount, change: 0, type: 'debt_payment', distribution }),
                user_id: currentUser ? currentUser.id : null,
                status: 'completed',
                has_negative_stock: 0,
                client_id: client.id,
                client_name: client.name
            };

            const queries = [
                {
                    sql: "INSERT INTO sales (date, total, summary, items, payment_method, payment_details, user_id, status, has_negative_stock, client_id, client_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    args: [
                        paymentSale.date,
                        paymentSale.total,
                        paymentSale.summary,
                        paymentSale.items,
                        paymentSale.payment_method,
                        paymentSale.payment_details,
                        paymentSale.user_id,
                        paymentSale.status,
                        paymentSale.has_negative_stock,
                        paymentSale.client_id,
                        paymentSale.client_name
                    ]
                }
            ];

            // 2. Update each sale: amount_paid and status
            distribution.forEach(d => {
                if (d.fullyPaid) {
                    queries.push({
                        sql: "UPDATE sales SET status = 'paid', amount_paid = total WHERE id = ?",
                        args: [Number(d.saleId)]
                    });
                } else {
                    queries.push({
                        sql: "UPDATE sales SET amount_paid = ?, status = CASE WHEN ? >= total THEN 'paid' ELSE status END WHERE id = ?",
                        args: [d.newTotalPaid, d.newTotalPaid, Number(d.saleId)]
                    });
                }
            });

            await turso.batch(queries);

            // 3. Update Local State
            const distributionMap = new Map(distribution.map(d => [d.saleId, d]));
            set(state => ({
                sales: [
                    { ...paymentSale, id: Date.now(), items: JSON.parse(paymentSale.items), paymentDetails: JSON.parse(paymentSale.payment_details) },
                    ...state.sales.map(s => {
                        const d = distributionMap.get(s.id);
                        if (!d) return s;
                        return {
                            ...s,
                            status: d.fullyPaid ? 'paid' : s.status,
                            amount_paid: d.newTotalPaid
                        };
                    })
                ]
            }));

            // 4. Force Fetch from DB to ensure consistency
            await get().fetchSales();

            // 5. Refresh Register
            const { cashRegister, refreshRegisterStats } = get();
            if (cashRegister) {
                refreshRegisterStats(cashRegister.id);
            }

            // 6. Sync client debt columns
            await get()._syncClientDebt(client.id);

            return { success: true };

        } catch (e) {
            console.error("Register payment error", e);
            return { success: false, error: e.message };
        }
    },

    // Cash Register Logic
    fetchActiveRegisters: async () => {
        try {
            console.time('⏱️ fetchActiveRegisters');
            const { activeCompanyId } = get();

            // 1. Get all open registers with user details (VALIDATED by company membership)
            const result = await turso.execute({
                sql: `SELECT cr.*, u.name as user_name 
                      FROM cash_registers cr 
                      LEFT JOIN users u ON cr.user_id = u.id 
                      INNER JOIN user_companies uc ON cr.user_id = uc.user_id 
                                                    AND cr.company_id = uc.company_id
                      WHERE cr.status = 'open' 
                      AND cr.company_id = ?`,
                args: [activeCompanyId]
            });

            const registers = result.rows;

            if (registers.length === 0) {
                set({ activeRegisters: [] });
                console.timeEnd('⏱️ fetchActiveRegisters');
                return;
            }

            // 2. OPTIMIZACIÓN: Queries en PARALELO con batch
            const queries = [];

            registers.forEach(reg => {
                // Query para ventas de este registro
                queries.push({
                    sql: `SELECT total, payment_method, payment_details 
                          FROM sales 
                          WHERE user_id = ? 
                          AND date >= ? 
                          AND company_id = ?`,
                    args: [reg.user_id, reg.opening_time, activeCompanyId]
                });

                // Query para movimientos de este registro
                queries.push({
                    sql: "SELECT type, amount FROM cash_movements WHERE register_id = ? AND company_id = ?",
                    args: [reg.id, activeCompanyId]
                });
            });

            // Ejecutar TODAS las queries en paralelo
            const results = await turso.batch(queries);

            // 3. Procesar resultados
            const activeRegsWithBalance = [];

            registers.forEach((reg, index) => {
                const salesIndex = index * 2;
                const movementsIndex = index * 2 + 1;

                const salesRes = results[salesIndex];
                const movRes = results[movementsIndex];

                // Calcular ventas en efectivo
                let cashSales = 0;
                salesRes.rows.forEach(sale => {
                    const total = parseFloat(sale.total);

                    if (sale.payment_method === 'Efectivo') {
                        cashSales += total;
                    } else if (sale.payment_method === 'Mixto' && sale.payment_details) {
                        try {
                            const details = JSON.parse(sale.payment_details);
                            const methodsList = details.mixedPayments || details.methods;
                            if (methodsList) {
                                methodsList.forEach(m => {
                                    if (m.method === 'Efectivo') {
                                        cashSales += parseFloat(m.amount || 0);
                                    }
                                });
                            }
                        } catch (e) {
                            console.error('Error parsing payment details:', e);
                        }
                    }
                });

                // Calcular movimientos
                let movesIn = 0;
                let movesOut = 0;
                movRes.rows.forEach(m => {
                    const amount = parseFloat(m.amount);
                    if (m.type === 'IN') movesIn += amount;
                    else movesOut += amount;
                });

                const currentBalance = reg.opening_amount + cashSales + movesIn - movesOut;

                activeRegsWithBalance.push({
                    ...reg,
                    currentBalance
                });
            });

            set({ activeRegisters: activeRegsWithBalance });

            console.timeEnd('⏱️ fetchActiveRegisters');
            console.log('✅ Active registers loaded:', activeRegsWithBalance.length);

        } catch (e) {
            console.error("❌ Fetch active registers error", e);
            console.timeEnd('⏱️ fetchActiveRegisters');
        }
    },

    checkRegisterStatus: async (userId) => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: "SELECT * FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
                args: [userId, activeCompanyId]
            });

            if (result.rows.length > 0) {
                set({ cashRegister: result.rows[0] });
            } else {
                set({ cashRegister: null });
            }
        } catch (e) {
            console.error("Check register error", e);
        }
    },

    openRegister: async (userId, amount) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();

            // ✅ VALIDACIÓN CRÍTICA: Verificar si ya existe una caja abierta para este usuario
            const existingRegisterCheck = await turso.execute({
                sql: "SELECT * FROM cash_registers WHERE user_id = ? AND company_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
                args: [userId, activeCompanyId]
            });

            if (existingRegisterCheck.rows.length > 0) {
                console.error("⚠️ User already has an open register:", existingRegisterCheck.rows[0]);
                // Cargar la caja existente en el estado
                set({ cashRegister: existingRegisterCheck.rows[0] });
                return { success: false, error: 'Ya tienes una caja abierta. Debes cerrarla antes de abrir una nueva.', existingRegister: existingRegisterCheck.rows[0] };
            }

            // Si no hay caja abierta, proceder con la apertura
            const result = await turso.execute({
                sql: "INSERT INTO cash_registers (user_id, opening_amount, opening_time, status, company_id) VALUES (?, ?, ?, ?, ?) RETURNING *",
                args: [userId, amount, getNowInCompanyTime(currentCompanyTimezone).toISOString(), 'open', activeCompanyId]
            });

            set({ cashRegister: result.rows[0] });
            console.log("✅ Cash register opened successfully:", result.rows[0]);
            return { success: true, register: result.rows[0] };
        } catch (e) {
            console.error("❌ Open register error", e);
            return { success: false, error: 'Error al abrir la caja. Intenta nuevamente.' };
        }
    },

    closeRegister: async (registerId, finalAmount, observations, difference) => {
        try {
            const { activeCompanyId } = get();
            await turso.execute({
                sql: "UPDATE cash_registers SET status = 'closed', closing_time = ?, final_amount = ?, observations = ?, difference = ? WHERE id = ? AND company_id = ?",
                args: [getNowInCompanyTime(get().currentCompanyTimezone).toISOString(), finalAmount, observations, difference, registerId, activeCompanyId]
            });
            set({ cashRegister: null });
            return true;
        } catch (e) {
            console.error("Close register error", e);
            return false;
        }
    },

    registerStats: { balance: 0, sales: 0, movements_in: 0, movements_out: 0, initial: 0, transactions: [] },
    suspendedSalesCount: 0,
    pendingSalesCount: 0,

    refreshRegisterStats: async (registerId) => {
        try {
            console.time('⏱️ refreshRegisterStats');
            const { activeCompanyId } = get();

            // 1. Get Register Info (for opening time and initial amount)
            const regRes = await turso.execute({
                sql: "SELECT * FROM cash_registers WHERE id = ?",
                args: [registerId]
            });

            if (regRes.rows.length === 0) {
                console.timeEnd('⏱️ refreshRegisterStats');
                return;
            }

            const register = regRes.rows[0];
            const openingTime = register.opening_time;

            // 2. OPTIMIZADO: Queries en paralelo usando batch
            const [salesStatsRes, movementsRes, recentSalesRes, preorderPaymentsRes] = await turso.batch([
                // Query agregado para stats de ventas (MUY RÁPIDO)
                {
                    sql: `SELECT
                            COUNT(*) as total_sales,
                            SUM(CASE WHEN payment_method = 'Efectivo' THEN total ELSE 0 END) as cash_total,
                            SUM(CASE WHEN payment_method = 'Tarjeta' THEN total ELSE 0 END) as card_total,
                            SUM(CASE WHEN payment_method = 'Transferencia' THEN total ELSE 0 END) as transfer_total,
                            SUM(CASE WHEN payment_method = 'Crédito' THEN total ELSE 0 END) as credit_total,
                            SUM(total) as total_sales_amount
                          FROM sales
                          WHERE user_id = ?
                          AND date >= ?
                          AND company_id = ?
                          AND status != 'cancelled'`,
                    args: [register.user_id, openingTime, activeCompanyId]
                },
                // Movimientos
                {
                    sql: "SELECT * FROM cash_movements WHERE register_id = ? AND company_id = ?",
                    args: [registerId, activeCompanyId]
                },
                // Últimas 20 ventas en efectivo para transacciones (para el widget)
                {
                    sql: `SELECT id, date, total, payment_method
                          FROM sales
                          WHERE user_id = ?
                          AND date >= ?
                          AND company_id = ?
                          AND status != 'cancelled'
                          AND (payment_method = 'Efectivo' OR payment_method = 'Mixto')
                          ORDER BY date DESC
                          LIMIT 20`,
                    args: [register.user_id, openingTime, activeCompanyId]
                },
                // Tarjeta/Transferencia de encargos cobrados por ESTA caja
                // (excluye cancelados → refunds no cuentan). Solo totales para
                // el desglose; el detalle de cada cobro se carga lazy al abrir
                // la pestaña correspondiente (ver getRegisterPreorderPayments).
                {
                    sql: `SELECT pp.method, SUM(pp.amount) as total
                          FROM preorder_payments pp
                          JOIN preorders po ON pp.preorder_id = po.id
                          WHERE pp.register_id = ?
                            AND pp.method IN ('Tarjeta', 'Transferencia')
                            AND po.status != 'canceled'
                          GROUP BY pp.method`,
                    args: [registerId]
                }
            ]);

            // 3. Procesar stats de ventas (ya viene agregado, super rápido)
            const salesStats = salesStatsRes.rows[0] || {
                cash_total: 0,
                card_total: 0,
                transfer_total: 0,
                credit_total: 0,
                total_sales_amount: 0
            };

            let cashSalesTotal = parseFloat(salesStats.cash_total) || 0;
            const salesBreakdown = {
                cash: cashSalesTotal,
                card: parseFloat(salesStats.card_total) || 0,
                transfer: parseFloat(salesStats.transfer_total) || 0,
                credit: parseFloat(salesStats.credit_total) || 0,
                total: parseFloat(salesStats.total_sales_amount) || 0
            };

            // 4. Para ventas Mixtas, necesitamos procesarlas (solo si hay)
            const mixedSalesRes = await turso.execute({
                sql: `SELECT total, payment_details 
                      FROM sales 
                      WHERE user_id = ? 
                      AND date >= ? 
                      AND company_id = ?
                      AND status != 'cancelled'
                      AND payment_method = 'Mixto'`,
                args: [register.user_id, openingTime, activeCompanyId]
            });

            // Procesar solo ventas mixtas (mucho menos que todas)
            mixedSalesRes.rows.forEach(sale => {
                try {
                    const details = JSON.parse(sale.payment_details);
                    const methodsList = details.mixedPayments || details.methods;
                    if (methodsList) {
                        let cashInMixed = 0;
                        let cardInMixed = 0;
                        let transferInMixed = 0;

                        methodsList.forEach(m => {
                            const amount = parseFloat(m.amount || 0);
                            if (m.method === 'Efectivo') cashInMixed += amount;
                            if (m.method === 'Tarjeta') cardInMixed += amount;
                            if (m.method === 'Transferencia') transferInMixed += amount;
                        });

                        // Ajustar breakdown
                        cashSalesTotal += cashInMixed;
                        salesBreakdown.cash += cashInMixed;
                        salesBreakdown.card += cardInMixed;
                        salesBreakdown.transfer += transferInMixed;
                    }
                } catch (err) {
                    console.error("Error parsing mixed payment", err);
                }
            });

            // 4b. Sumar Tarjeta/Transferencia de ENCARGOS al desglose
            //     (efectivo de encargos ya va por cash_movements → balance).
            (preorderPaymentsRes.rows || []).forEach(r => {
                const amt = parseFloat(r.total) || 0;
                if (r.method === 'Tarjeta') salesBreakdown.card += amt;
                else if (r.method === 'Transferencia') salesBreakdown.transfer += amt;
            });

            // 5. Procesar transacciones recientes para el widget
            const salesTransactions = recentSalesRes.rows.map(sale => ({
                type: 'VENTA',
                amount: parseFloat(sale.total),
                total: parseFloat(sale.total),
                date: sale.date,
                id: sale.id
            }));

            // 6. Procesar movimientos
            let movementsIn = 0;
            let movementsOut = 0;
            const movementTransactions = [];

            movementsRes.rows.forEach(mov => {
                const amount = parseFloat(mov.amount);
                if (mov.type === 'IN') {
                    movementsIn += amount;
                    movementTransactions.push({
                        type: 'INGRESO',
                        amount,
                        reason: mov.reason,
                        date: mov.date || mov.created_at,
                        id: mov.id
                    });
                } else {
                    movementsOut += amount;
                    movementTransactions.push({
                        type: 'RETIRO',
                        amount,
                        reason: mov.reason,
                        date: mov.date || mov.created_at,
                        id: mov.id
                    });
                }
            });

            // 7. Combinar transacciones y ordenar
            const allTransactions = [...salesTransactions, ...movementTransactions]
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            // 8. Calcular balance final
            const currentBalance = register.opening_amount + cashSalesTotal + movementsIn - movementsOut;

            set({
                registerStats: {
                    balance: currentBalance,
                    sales: cashSalesTotal,
                    salesBreakdown: salesBreakdown,
                    movements_in: movementsIn,
                    movements_out: movementsOut,
                    initial: register.opening_amount,
                    transactions: allTransactions
                }
            });

            console.timeEnd('⏱️ refreshRegisterStats');
            console.log('✅ Stats refreshed:', {
                balance: currentBalance,
                sales: cashSalesTotal,
                movements_in: movementsIn,
                movements_out: movementsOut
            });

        } catch (e) {
            console.error("❌ Refresh stats error", e);
            console.timeEnd('⏱️ refreshRegisterStats');
        }
    },

    // Detalle por método de pago (Tarjeta o Transferencia) para el desglose
    // del Estado de Caja. LAZY: solo se llama cuando el usuario abre la pestaña
    // → no afecta el tiempo de carga inicial de la caja.
    //
    // Devuelve transacciones combinadas POS + encargo (excluye cancelados),
    // ordenadas por fecha desc. Para POS: extrae datáfono/cuenta de
    // payment_details. Para encargos: no se captura datáfono/cuenta aún
    // (futuro), se muestra '-'.
    getRegisterMethodTransactions: async (registerId, method) => {
        try {
            const { activeCompanyId } = get();
            if (!registerId || !method) return { success: false, transactions: [] };

            // Datos de la caja para filtrar ventas POS por user + opening_time.
            const regRes = await turso.execute({
                sql: 'SELECT user_id, opening_time FROM cash_registers WHERE id = ?',
                args: [registerId]
            });
            if (regRes.rows.length === 0) return { success: false, transactions: [] };
            const { user_id: userId, opening_time: openingTime } = regRes.rows[0];

            // POS: ventas con el método directo + mixtas (filtramos client-side
            // las mixtas para extraer la porción correspondiente).
            const [salesRes, mixedRes, preorderRes] = await turso.batch([
                {
                    sql: `SELECT id, date, total, payment_method, payment_details
                          FROM sales
                          WHERE user_id = ? AND date >= ? AND company_id = ?
                            AND status != 'cancelled' AND payment_method = ?
                          ORDER BY date DESC LIMIT 100`,
                    args: [userId, openingTime, activeCompanyId, method]
                },
                {
                    sql: `SELECT id, date, total, payment_details
                          FROM sales
                          WHERE user_id = ? AND date >= ? AND company_id = ?
                            AND status != 'cancelled' AND payment_method = 'Mixto'
                          ORDER BY date DESC LIMIT 100`,
                    args: [userId, openingTime, activeCompanyId]
                },
                {
                    sql: `SELECT pp.id, pp.amount, pp.created_at, pp.type, po.id as preorder_id,
                            po.client_name,
                            pt.name as terminal_name,
                            ba.bank_name as bank_name, ba.account_number as bank_account_number
                          FROM preorder_payments pp
                          JOIN preorders po ON pp.preorder_id = po.id
                          LEFT JOIN payment_terminals pt ON pp.terminal_id = pt.id
                          LEFT JOIN bank_accounts ba ON pp.bank_account_id = ba.id
                          WHERE pp.register_id = ? AND pp.method = ?
                            AND po.status != 'canceled'
                          ORDER BY pp.created_at DESC LIMIT 100`,
                    args: [registerId, method]
                }
            ]);

            const detailKey = method === 'Tarjeta' ? 'terminal' : 'account';
            const sourceLabel = method === 'Tarjeta' ? 'Datáfono' : 'Cuenta';
            const transactions = [];

            // POS directo: cada venta es 1 transacción
            for (const s of salesRes.rows) {
                let detail = null;
                try {
                    const d = JSON.parse(s.payment_details || '{}');
                    detail = d[detailKey] || null;
                } catch { /* noop */ }
                transactions.push({
                    id: `s_${s.id}`,
                    source: 'POS',
                    reference: `Venta #${s.id}`,
                    amount: parseFloat(s.total) || 0,
                    date: s.date,
                    detail, // datáfono o cuenta
                });
            }

            // POS mixto: extraer la porción del método específico
            for (const s of mixedRes.rows) {
                try {
                    const d = JSON.parse(s.payment_details || '{}');
                    const methods = d.mixedPayments || d.methods || [];
                    methods.forEach((m, idx) => {
                        if (m.method === method && Number(m.amount) > 0) {
                            transactions.push({
                                id: `m_${s.id}_${idx}`,
                                source: 'POS',
                                reference: `Venta mixta #${s.id}`,
                                amount: parseFloat(m.amount) || 0,
                                date: s.date,
                                detail: m[detailKey] || null,
                            });
                        }
                    });
                } catch { /* noop */ }
            }

            // Encargos: 1 transacción por pago. Datáfono/cuenta vienen del JOIN.
            for (const p of preorderRes.rows) {
                let detail = null;
                if (method === 'Tarjeta') {
                    detail = p.terminal_name || null;
                } else if (method === 'Transferencia') {
                    detail = p.bank_name
                        ? `${p.bank_name}${p.bank_account_number ? ' · ' + p.bank_account_number : ''}`
                        : null;
                }
                transactions.push({
                    id: `p_${p.id}`,
                    source: 'Encargo',
                    reference: `Encargo #${p.preorder_id}${p.client_name ? ' · ' + p.client_name : ''}`,
                    amount: parseFloat(p.amount) || 0,
                    date: p.created_at,
                    detail,
                });
            }

            // Orden desc por fecha
            transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

            return { success: true, transactions, detailLabel: sourceLabel };
        } catch (e) {
            console.error('Error obteniendo transacciones por método:', e);
            return { success: false, transactions: [], error: e.message };
        }
    },

    // Historical Reports
    fetchClosedRegisters: async (limit = 20, offset = 0, startDate, endDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();

            let sql = `SELECT cr.*, u.name as user_name 
                      FROM cash_registers cr 
                      LEFT JOIN users u ON cr.user_id = u.id 
                      WHERE cr.status = 'closed' AND cr.company_id = ?`;
            const args = [activeCompanyId];
            if (startDate) {
                const utcStart = getStartFromDateString(startDate, currentCompanyTimezone).toISOString();
                sql += ' AND cr.closing_time >= ?';
                args.push(utcStart);
            }
            if (endDate) {
                const utcEnd = getEndFromDateString(endDate, currentCompanyTimezone).toISOString();
                sql += ' AND cr.closing_time <= ?';
                args.push(utcEnd);
            }
            sql += ' ORDER BY cr.closing_time DESC LIMIT ? OFFSET ?';
            args.push(limit, offset);

            const result = await turso.execute({ sql, args });

            return result.rows;
        } catch (e) {
            console.error("Fetch closed registers error", e);
            return [];
        }
    },

    addCashMovement: async (registerId, type, amount, reason) => {
        try {
            const { activeCompanyId } = get();
            await turso.execute({
                sql: "INSERT INTO cash_movements (register_id, type, amount, reason, date, company_id) VALUES (?, ?, ?, ?, ?, ?)",
                args: [registerId, type, amount, reason, getNowInCompanyTime(get().currentCompanyTimezone).toISOString(), activeCompanyId]
            });
            return true;
        } catch (e) {
            console.error("Add cash movement error", e);
            return false;
        }
    },

    fetchCashMovements: async (limit = 20, offset = 0, startDate, endDate) => {
        try {
            const { activeCompanyId, currentCompanyTimezone } = get();
            console.log(`Fetching cash movements (limit: ${limit}, offset: ${offset}) for company:`, activeCompanyId);

            // 1. Fetch Registers (Paginated)
            let regSql = `SELECT cr.*, u.name as user_name 
                      FROM cash_registers cr 
                      LEFT JOIN users u ON cr.user_id = u.id 
                      WHERE cr.company_id = ?`;
            const regArgs = [activeCompanyId];
            if (startDate) {
                const utcStart = getStartFromDateString(startDate, currentCompanyTimezone).toISOString();
                regSql += ' AND cr.opening_time >= ?';
                regArgs.push(utcStart);
            }
            if (endDate) {
                const utcEnd = getEndFromDateString(endDate, currentCompanyTimezone).toISOString();
                regSql += ' AND cr.opening_time <= ?';
                regArgs.push(utcEnd);
            }
            regSql += ' ORDER BY cr.opening_time DESC LIMIT ? OFFSET ?';
            regArgs.push(limit, offset);
            const registersRes = await turso.execute({
                sql: regSql,
                args: regArgs
            });

            const registers = registersRes.rows;

            if (registers.length === 0) {
                return [];
            }

            const registerIds = registers.map(r => r.id);
            const placeholders = registerIds.map(() => '?').join(',');

            // 2. Fetch Movements for these registers
            // Note: We filter by company_id AND register_id to cover indexes better, though register_id alone is sufficient logically.
            const movementsRes = await turso.execute({
                sql: `SELECT cm.* 
                      FROM cash_movements cm 
                      WHERE cm.company_id = ? 
                      AND cm.register_id IN (${placeholders})`,
                args: [activeCompanyId, ...registerIds]
            });

            const movements = movementsRes.rows;

            console.log(`Fetched: ${registers.length} registers, ${movements.length} movements`);

            // 3. Process Initial Openings (from Registers)
            const openingsNode = registers.map(reg => ({
                id: `opening-${reg.id}`,
                register_id: reg.id,
                created_at: reg.opening_time,
                type: 'in',
                amount: reg.opening_amount,
                reason: 'Apertura de Caja',
                user_name: reg.user_name || 'Desconocido',
                source: 'opening'
            }));

            // 4. Process Movements
            // We need to attach user_name to movements. Since we fetched registers with user_name, we can look it up.
            // Create a map for quick lookup: register_id -> user_name
            const regUserMap = registers.reduce((acc, r) => {
                acc[r.id] = r.user_name || 'Desconocido';
                return acc;
            }, {});

            const movementsNode = movements.map(mov => {
                const regId = mov.register_id || mov.cash_register_id;
                // Since we only fetched movements for the fetched registers, this lookup should always succeed.
                const userName = regUserMap[regId] || 'Desconocido';

                return {
                    id: mov.id,
                    register_id: regId,
                    created_at: mov.date || mov.created_at, // Robust Date Check
                    type: String(mov.type).toLowerCase() === 'in' ? 'in' : 'out', // Normalize type
                    amount: mov.amount,
                    reason: mov.reason,
                    user_name: userName,
                    source: 'movement'
                };
            });

            // 5. Combine (no need to sort globally if we rely on component sorting, 
            // but sorting here helps ensure the return value is consistent)
            // The component groups by register and sorts groups by opening time.
            // Inside groups, it sorts by movement time.
            // Returning a flat list is fine.
            const combined = [...openingsNode, ...movementsNode];

            return combined;

        } catch (e) {
            console.error("Fetch cash movements error:", e);
            return [];
        }
    },

    getRegisterReport: async (register) => {
        try {
            // Reconstruct report data
            // 1. Sales
            const { activeCompanyId } = get();
            const salesRes = await turso.execute({
                sql: "SELECT * FROM sales WHERE user_id = ? AND date >= ? AND date <= ? AND company_id = ?",
                args: [register.user_id, register.opening_time, register.closing_time, activeCompanyId]
            });

            let cashSalesTotal = 0;
            const salesBreakdown = { cash: 0, card: 0, transfer: 0, credit: 0, total: 0 };

            salesRes.rows.forEach(sale => {
                if (sale.status === 'cancelled') return;
                const total = parseFloat(sale.total);
                salesBreakdown.total += total;

                let cashPart = 0;
                let cardPart = 0;
                let transferPart = 0;
                let creditPart = 0;

                if (sale.payment_method === 'Efectivo') {
                    cashPart = total;
                } else if (sale.payment_method === 'Tarjeta') {
                    cardPart = total;
                } else if (sale.payment_method === 'Transferencia') {
                    transferPart = total;
                } else if (sale.payment_method === 'Crédito') {
                    creditPart = total;
                } else if (sale.payment_method === 'Mixto' && sale.payment_details) {
                    try {
                        const details = JSON.parse(sale.payment_details);
                        const methodsList = details.mixedPayments || details.methods;
                        if (methodsList) {
                            methodsList.forEach(m => {
                                const amount = parseFloat(m.amount || 0);
                                if (m.method === 'Efectivo') cashPart += amount;
                                if (m.method === 'Tarjeta') cardPart += amount;
                                if (m.method === 'Transferencia') transferPart += amount;
                            });
                        }
                    } catch (e) { }
                }

                salesBreakdown.cash += cashPart;
                salesBreakdown.card += cardPart;
                salesBreakdown.transfer += transferPart;
                salesBreakdown.credit += creditPart;

                if (cashPart > 0) {
                    cashSalesTotal += cashPart;
                }
            });

            // 2. Movements
            const movementsRes = await turso.execute({
                sql: "SELECT * FROM cash_movements WHERE register_id = ? AND company_id = ?",
                args: [register.id, activeCompanyId]
            });

            let movementsIn = 0;
            let movementsOut = 0;

            movementsRes.rows.forEach(mov => {
                const amount = parseFloat(mov.amount);
                if (mov.type === 'IN') movementsIn += amount;
                else movementsOut += amount;
            });

            const calculatedExpected = register.opening_amount + cashSalesTotal + movementsIn - movementsOut;

            return {
                ...register,
                salesBreakdown,
                movements: { in: movementsIn, out: movementsOut },
                calculatedExpected
            };

        } catch (e) {
            console.error("Get register report error", e);
            return null;
        }
    },

    // ============================================
    // SUSPENDED SALES (Suspender/Recuperar Ventas)
    // ============================================

    // Actualizar contador de ventas suspendidas (rápido, solo COUNT)
    updateSuspendedCount: async () => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: `SELECT COUNT(*) as count 
                      FROM suspended_sales 
                      WHERE company_id = ? 
                      AND status = 'suspended'`,
                args: [activeCompanyId]
            });

            const count = result.rows[0]?.count || 0;
            set({ suspendedSalesCount: count });
            console.log('✅ Suspended sales count:', count);
        } catch (e) {
            console.error('❌ Update suspended count error:', e);
        }
    },

    // Suspender venta actual (guardar y limpiar carrito)
    suspendSale: async () => {
        try {
            const { carts, activeCartId, activeCompanyId, currentUser, currentCompanyTimezone } = get();

            // DERIVAR cart y client manualmente (NO usar getters)
            const activeCart = carts.find(c => c.id === activeCartId);
            const cart = activeCart?.items || [];
            const posSelectedClient = activeCart?.client || null;

            console.log('💾 Attempting to suspend sale:', {
                activeCartId,
                cartItems: cart.length,
                items: cart.map(i => i.name)
            });

            if (cart.length === 0) {
                alert('El carrito está vacío');
                return false;
            }

            // Calcular totales
            const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const tax = cart.reduce((sum, item) => {
                const taxRate = parseFloat(item.tax_rate) || 0;
                return sum + (item.price * item.quantity * taxRate / 100);
            }, 0);
            const total = subtotal + tax;
            const itemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

            const now = getNowInCompanyTime(currentCompanyTimezone).toISOString();

            console.log('💾 Suspending sale:', { itemsCount, total });

            await turso.execute({
                sql: `INSERT INTO suspended_sales 
                      (company_id, user_id, items, client_data, subtotal, tax, total, items_count, suspended_at, status, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suspended', ?)`,
                args: [
                    activeCompanyId,
                    currentUser.id,
                    JSON.stringify(cart),
                    posSelectedClient ? JSON.stringify(posSelectedClient) : null,
                    subtotal,
                    tax,
                    total,
                    itemsCount,
                    now,
                    now
                ]
            });

            console.log('✅ Sale suspended successfully');

            // Limpiar SOLO el carrito activo
            set(state => ({
                carts: state.carts.map(c =>
                    c.id === state.activeCartId
                        ? { ...c, items: [], client: null }
                        : c
                )
            }));

            // Actualizar contador
            await get().updateSuspendedCount();

            return true;
        } catch (e) {
            console.error('❌ Suspend sale error:', e);
            alert('Error al suspender la venta');
            return false;
        }
    },

    // Traer lista de ventas suspendidas (ligera, sin items completos)
    fetchSuspendedSales: async () => {
        try {
            const { activeCompanyId } = get();

            console.time('⏱️ fetchSuspendedSales');

            // Query optimizado: solo campos necesarios para la lista
            const result = await turso.execute({
                sql: `SELECT 
                        s.id,
                        s.total,
                        s.items_count,
                        s.suspended_at,
                        u.name as user_name
                      FROM suspended_sales s
                      LEFT JOIN users u ON s.user_id = u.id
                      WHERE s.company_id = ? 
                      AND s.status = 'suspended'
                      ORDER BY s.suspended_at DESC
                      LIMIT 50`,
                args: [activeCompanyId]
            });

            console.timeEnd('⏱️ fetchSuspendedSales');
            console.log('✅ Fetched suspended sales:', result.rows.length);

            return result.rows;
        } catch (e) {
            console.error('❌ Fetch suspended sales error:', e);
            return [];
        }
    },

    // Recuperar venta (trae items completos y restaura carrito)
    recoverSale: async (saleId) => {
        try {
            const { activeCompanyId, currentUser } = get();

            console.log('🔄 Recovering sale:', saleId);
            console.time('⏱️ recoverSale');

            // Traer solo items y client_data
            const result = await turso.execute({
                sql: `SELECT items, client_data 
                      FROM suspended_sales 
                      WHERE id = ? 
                      AND company_id = ? 
                      AND status = 'suspended'`,
                args: [saleId, activeCompanyId]
            });

            if (result.rows.length === 0) {
                alert('Esta venta ya fue recuperada o no existe');
                return false;
            }

            const sale = result.rows[0];
            const items = JSON.parse(sale.items);
            const clientData = sale.client_data ? JSON.parse(sale.client_data) : null;

            console.log('✅ Sale data recovered:', { itemsCount: items.length });

            // Marcar como recuperada (no eliminar, para auditoría)
            await turso.execute({
                sql: `UPDATE suspended_sales 
                      SET status = 'recovered', 
                      recovered_at = ?, 
                      recovered_by = ?
                  WHERE id = ?`,
                args: [new Date().toISOString(), currentUser.id, saleId]
            });

            // Limpiar carrito actual
            get().clearCart();

            // Restaurar items en carrito
            items.forEach(item => {
                get().addToCart({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    cost: item.cost || 0,
                    quantity: item.quantity,
                    tax_rate: item.tax_rate || 0,
                    image: item.image || null,
                    sku: item.sku || '',
                    stock: item.stock || 0
                });
            });

            // Restaurar cliente
            if (clientData) {
                get().setPosSelectedClient(clientData);
            }

            // Actualizar contador
            await get().updateSuspendedCount();

            console.timeEnd('⏱️ recoverSale');
            console.log('✅ Sale recovered successfully');

            return true;
        } catch (e) {
            console.error('❌ Recover sale error:', e);
            alert('Error al recuperar la venta');
            return false;
        }
    },

    // Eliminar venta suspendida
    deleteSuspendedSale: async (saleId) => {
        try {
            const { activeCompanyId } = get();

            console.log('🗑️ Deleting suspended sale:', saleId);

            // Marcar como eliminada (no borrar, para auditoría)
            await turso.execute({
                sql: `UPDATE suspended_sales 
                      SET status = 'deleted' 
                      WHERE id = ? 
                      AND company_id = ?`,
                args: [saleId, activeCompanyId]
            });

            console.log('✅ Sale deleted successfully');

            // Actualizar contador
            await get().updateSuspendedCount();

            return true;
        } catch (e) {
            console.error('❌ Delete suspended sale error:', e);
            return false;
        }
    },

    // ============================================
    // �️ FUNCIONES DE PREVENTAS
    // ============================================

    pendingPreventasCount: 0,

    createPreventa: async (items, clientData, total) => {
        try {
            const { activeCompanyId, currentUser, currentCompanyTimezone } = get();
            if (!activeCompanyId || !currentUser) throw new Error('No company/user');

            // Ensure table exists (idempotent)
            await turso.execute(`CREATE TABLE IF NOT EXISTS preventas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id TEXT NOT NULL,
                code TEXT NOT NULL,
                items TEXT NOT NULL,
                client_data TEXT,
                total REAL NOT NULL DEFAULT 0,
                created_by INTEGER,
                created_by_name TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                completed_by INTEGER,
                completed_at TEXT,
                sale_id INTEGER,
                created_at TEXT NOT NULL,
                UNIQUE(company_id, code)
            )`);

            const now = getNowInCompanyTime(currentCompanyTimezone);
            const pad = (n) => String(n).padStart(2, '0');
            const yy = String(now.getFullYear()).slice(-2);
            const code = `PV${yy}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;

            await turso.execute({
                sql: `INSERT INTO preventas (company_id, code, items, client_data, total, created_by, created_by_name, status, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
                args: [
                    activeCompanyId,
                    code,
                    JSON.stringify(items),
                    clientData ? JSON.stringify(clientData) : null,
                    total,
                    currentUser.id,
                    currentUser.name || currentUser.username,
                    now.toISOString()
                ]
            });

            await get().updatePreventasCount();
            return { success: true, code };
        } catch (e) {
            console.error('Error creating preventa:', e);
            return { success: false, error: e.message };
        }
    },

    fetchPendingPreventas: async () => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: `SELECT id, code, items, client_data, total, created_by_name, created_at
                      FROM preventas
                      WHERE company_id = ? AND status = 'pending'
                      ORDER BY created_at DESC
                      LIMIT 100`,
                args: [activeCompanyId]
            });
            return result.rows.map(r => ({
                ...r,
                items: JSON.parse(r.items),
                client_data: r.client_data ? JSON.parse(r.client_data) : null
            }));
        } catch (e) {
            console.error('Error fetching preventas:', e);
            return [];
        }
    },

    fetchPreventaByCode: async (code) => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: `SELECT id, code, items, client_data, total, created_by_name, created_at
                      FROM preventas
                      WHERE company_id = ? AND code = ? AND status = 'pending'`,
                args: [activeCompanyId, code]
            });
            if (result.rows.length === 0) return null;
            const r = result.rows[0];
            return { ...r, items: JSON.parse(r.items), client_data: r.client_data ? JSON.parse(r.client_data) : null };
        } catch (e) {
            console.error('Error fetching preventa by code:', e);
            return null;
        }
    },

    completePreventa: async (code, saleId) => {
        try {
            const { activeCompanyId, currentUser, currentCompanyTimezone } = get();
            const now = getNowInCompanyTime(currentCompanyTimezone).toISOString();
            const result = await turso.execute({
                sql: `UPDATE preventas SET status = 'completed', completed_by = ?, completed_at = ?, sale_id = ? WHERE company_id = ? AND code = ? AND status = 'pending'`,
                args: [currentUser.id, now, saleId, activeCompanyId, code]
            });
            // Validar que realmente se haya marcado como completada (puede ya estar completed/cancelled)
            const affected = Number(result?.rowsAffected ?? 0);
            if (affected === 0) {
                console.warn(`⚠️ completePreventa: ningún registro actualizado (code=${code}). Posiblemente ya estaba completada o cancelada.`);
                await get().updatePreventasCount();
                return false;
            }
            await get().updatePreventasCount();
            return true;
        } catch (e) {
            console.error('Error completing preventa:', e);
            return false;
        }
    },

    cancelPreventa: async (code) => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: `UPDATE preventas SET status = 'cancelled' WHERE company_id = ? AND code = ? AND status = 'pending'`,
                args: [activeCompanyId, code]
            });
            const affected = Number(result?.rowsAffected ?? 0);
            if (affected === 0) {
                console.warn(`⚠️ cancelPreventa: ningún registro actualizado (code=${code}). Posiblemente ya estaba completada o cancelada.`);
                await get().updatePreventasCount();
                return false;
            }
            await get().updatePreventasCount();
            return true;
        } catch (e) {
            console.error('Error cancelling preventa:', e);
            return false;
        }
    },

    updatePreventasCount: async () => {
        try {
            const { activeCompanyId } = get();
            const result = await turso.execute({
                sql: `SELECT COUNT(*) as c FROM preventas WHERE company_id = ? AND status = 'pending'`,
                args: [activeCompanyId]
            });
            set({ pendingPreventasCount: Number(result.rows[0].c) });
        } catch (e) {
            set({ pendingPreventasCount: 0 });
        }
    },

    // ============================================
    // �🆕 FUNCIONES DE SUSCRIPCIÓN
    // ============================================

    // Verificar estado de suscripción de una empresa
    checkSubscriptionStatus: async (companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT c.status, c.trial_ends_at, s.current_period_end, s.plan_id
                      FROM companies c
                      LEFT JOIN subscriptions s ON c.subscription_id = s.id
                      WHERE c.id = ?`,
                args: [companyId]
            });

            if (result.rows.length === 0) {
                return { isActive: false, status: 'not_found' };
            }

            const company = result.rows[0];
            const now = new Date();

            // Si está en trial
            if (company.status === 'trial' && company.trial_ends_at) {
                const trialEnd = new Date(company.trial_ends_at);
                if (now <= trialEnd) {
                    return {
                        isActive: true,
                        status: 'trial',
                        daysRemaining: Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))
                    };
                }
            }

            // Si tiene suscripción activa
            if (company.status === 'active' && company.current_period_end) {
                const periodEnd = new Date(company.current_period_end);
                if (now <= periodEnd) {
                    return {
                        isActive: true,
                        status: 'active',
                        renewsAt: company.current_period_end
                    };
                }
            }

            // En cualquier otro caso
            return {
                isActive: company.status === 'active',
                status: company.status
            };

        } catch (error) {
            console.error('Error checking subscription:', error);
            return { isActive: false, status: 'error' };
        }
    },

    updateCurrency: async (newCurrency) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: 'UPDATE companies SET currency = ? WHERE id = ?',
                args: [newCurrency, activeCompanyId]
            });
            set({ currentCurrency: newCurrency });
            return { success: true };
        } catch (e) {
            console.error('Error updating currency:', e);
            return { success: false, error: e.message };
        }
    },

    // Obtener historial de pagos de una empresa
    fetchPaymentHistory: async (companyId) => {
        try {
            const { turso } = get();
            const result = await turso.execute({
                sql: `SELECT * FROM payments 
                      WHERE company_id = ? 
                      ORDER BY created_at DESC`,
                args: [companyId]
            });

            return result.rows;
        } catch (error) {
            console.error('Error fetching payment history:', error);
            return [];
        }
    },


    // ═══════════════════════════════════════════════════════════════
    // SISTEMA DE SOPORTE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Crear nuevo ticket de soporte
     */
    createSupportTicket: async (subject, category = 'general', initialMessage = '') => {
        const { activeCompanyId, currentUser } = get();

        try {
            const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();

            // Crear ticket
            await turso.execute({
                sql: `INSERT INTO support_tickets 
                      (id, company_id, user_id, subject, category, status, priority, created_at, updated_at, last_message_at)
                      VALUES (?, ?, ?, ?, ?, 'open', 'normal', ?, ?, ?)`,
                args: [ticketId, activeCompanyId, currentUser.id, subject, category, now, now, now]
            });

            // Si hay mensaje inicial, crearlo
            if (initialMessage) {
                const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                await turso.execute({
                    sql: `INSERT INTO support_messages 
                          (id, ticket_id, sender_type, sender_id, sender_name, message, created_at)
                          VALUES (?, ?, 'client', ?, ?, ?, ?)`,
                    args: [messageId, ticketId, currentUser.id.toString(), currentUser.name, initialMessage, now]
                });
            }

            return { success: true, ticketId };
        } catch (e) {
            console.error('Error creating support ticket:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Obtener tickets de la empresa actual
     */
    fetchSupportTickets: async () => {
        const { activeCompanyId } = get();

        try {
            const result = await turso.execute({
                sql: `SELECT t.*, 
                             u.name as user_name,
                             (SELECT COUNT(*) FROM support_messages 
                              WHERE ticket_id = t.id AND sender_type = 'admin' AND read_by_client = 0) as unread_count
                      FROM support_tickets t
                      LEFT JOIN users u ON t.user_id = u.id
                      WHERE t.company_id = ?
                      ORDER BY t.updated_at DESC`,
                args: [activeCompanyId]
            });

            const tickets = result.rows || [];
            const unreadTotal = tickets.reduce((sum, t) => sum + (t.unread_count || 0), 0);

            set({
                supportTickets: tickets,
                unreadSupportCount: unreadTotal
            });

            return { success: true, tickets };
        } catch (e) {
            console.error('Error fetching support tickets:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Obtener mensajes de un ticket
     */
    fetchTicketMessages: async (ticketId) => {
        try {
            // 1. Obtener mensajes
            let sql = `SELECT m.* FROM support_messages m WHERE m.ticket_id = ? ORDER BY m.created_at ASC`;

            const messagesResult = await turso.execute({
                sql,
                args: [ticketId]
            });

            const messages = messagesResult.rows || [];

            if (messages.length === 0) {
                return { success: true, messages: [] };
            }

            // 2. Obtener adjuntos para este ticket
            const attachmentsResult = await turso.execute({
                sql: `SELECT * FROM support_attachments WHERE ticket_id = ?`,
                args: [ticketId]
            });

            const attachments = attachmentsResult.rows || [];

            // 3. Combinar
            const messagesWithAttachments = messages.map(msg => ({
                ...msg,
                attachments: attachments.filter(a => a.message_id === msg.id)
            }));

            return { success: true, messages: messagesWithAttachments };
        } catch (e) {
            console.error('Error fetching messages:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Enviar mensaje en un ticket (cliente)
     */
    sendSupportMessage: async (ticketId, message) => {
        const { currentUser } = get();

        try {
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();

            // Insertar mensaje
            await turso.execute({
                sql: `INSERT INTO support_messages 
                      (id, ticket_id, sender_type, sender_id, sender_name, message, created_at, read_by_admin)
                      VALUES (?, ?, 'client', ?, ?, ?, ?, 0)`,
                args: [messageId, ticketId, currentUser.id.toString(), currentUser.name, message, now]
            });

            // Actualizar ticket
            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET updated_at = ?, last_message_at = ?, unread_by_admin = unread_by_admin + 1
                      WHERE id = ?`,
                args: [now, now, ticketId]
            });

            return { success: true, messageId };
        } catch (e) {
            console.error('Error sending message:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Marcar mensajes como leídos (cliente)
     */
    markMessagesAsRead: async (ticketId) => {
        try {
            await turso.execute({
                sql: `UPDATE support_messages 
                      SET read_by_client = 1 
                      WHERE ticket_id = ? AND sender_type = 'admin' AND read_by_client = 0`,
                args: [ticketId]
            });

            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET unread_by_client = 0 
                      WHERE id = ?`,
                args: [ticketId]
            });

            // Actualizar contadores locales
            get().fetchSupportTickets();

            return { success: true };
        } catch (e) {
            console.error('Error marking as read:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Subir adjunto
     */
    uploadSupportAttachment: async (ticketId, messageId, file) => {
        try {
            // Convertir a base64 para guardar en BD (solo para archivos pequeños)
            const reader = new FileReader();
            const base64Promise = new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const base64 = await base64Promise;
            const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();

            await turso.execute({
                sql: `INSERT INTO support_attachments 
                      (id, message_id, ticket_id, filename, file_type, file_url, file_size, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [attachmentId, messageId, ticketId, file.name, file.type, base64, file.size, now]
            });

            return { success: true, attachmentId, url: base64 };
        } catch (e) {
            console.error('Error uploading attachment:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Obtener adjuntos de un mensaje
     */
    fetchMessageAttachments: async (messageId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT * FROM support_attachments WHERE message_id = ?`,
                args: [messageId]
            });

            return { success: true, attachments: result.rows || [] };
        } catch (e) {
            console.error('Error fetching attachments:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // FUNCIONES ADMIN (para el panel de administración)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Obtener TODOS los tickets (admin)
     */
    fetchAllSupportTickets: async (filters = {}) => {
        try {
            let sql = `SELECT t.*, 
                              u.name as user_name,
                              c.name as company_name,
                              (SELECT COUNT(*) FROM support_messages 
                               WHERE ticket_id = t.id AND sender_type = 'client' AND read_by_admin = 0) as unread_count
                       FROM support_tickets t
                       LEFT JOIN users u ON t.user_id = u.id
                       LEFT JOIN companies c ON t.company_id = c.id
                       WHERE 1=1`;

            const args = [];

            if (filters.status) {
                sql += ` AND t.status = ?`;
                args.push(filters.status);
            }

            if (filters.assigned_to) {
                sql += ` AND t.assigned_to = ?`;
                args.push(filters.assigned_to);
            }

            if (filters.priority) {
                sql += ` AND t.priority = ?`;
                args.push(filters.priority);
            }

            if (filters.search) {
                sql += ` AND (t.subject LIKE ? OR c.name LIKE ?)`;
                const searchTerm = `%${filters.search}%`;
                args.push(searchTerm, searchTerm);
            }

            sql += ` ORDER BY t.updated_at DESC LIMIT 100`;

            const result = await turso.execute({ sql, args });

            return { success: true, tickets: result.rows || [] };
        } catch (e) {
            console.error('Error fetching all tickets:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Responder ticket (admin)
     */
    replyToTicket: async (ticketId, message) => {
        const { currentUser } = get();

        try {
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();

            await turso.execute({
                sql: `INSERT INTO support_messages 
                      (id, ticket_id, sender_type, sender_id, sender_name, message, created_at, read_by_client)
                      VALUES (?, ?, 'admin', ?, ?, ?, ?, 0)`,
                args: [messageId, ticketId, currentUser.id.toString(), currentUser.name || 'Admin', message, now]
            });

            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET updated_at = ?, last_message_at = ?, unread_by_client = unread_by_client + 1, unread_by_admin = 0
                      WHERE id = ?`,
                args: [now, now, ticketId]
            });

            return { success: true, messageId };
        } catch (e) {
            console.error('Error replying to ticket:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Actualizar estado del ticket
     */
    updateTicketStatus: async (ticketId, status) => {
        try {
            const now = new Date().toISOString();
            const resolvedAt = status === 'resolved' ? now : null;

            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET status = ?, updated_at = ?, resolved_at = ?
                      WHERE id = ?`,
                args: [status, now, resolvedAt, ticketId]
            });

            return { success: true };
        } catch (e) {
            console.error('Error updating ticket status:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Actualizar prioridad del ticket
     */
    updateTicketPriority: async (ticketId, priority) => {
        try {
            const now = new Date().toISOString();

            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET priority = ?, updated_at = ?
                      WHERE id = ?`,
                args: [priority, now, ticketId]
            });

            return { success: true };
        } catch (e) {
            console.error('Error updating ticket priority:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Asignar ticket a admin
     */
    assignTicket: async (ticketId, adminId) => {
        try {
            const now = new Date().toISOString();

            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET assigned_to = ?, updated_at = ?
                      WHERE id = ?`,
                args: [adminId, now, ticketId]
            });

            return { success: true };
        } catch (e) {
            console.error('Error assigning ticket:', e);
            return { success: false, error: e.message };
        }
    },

    /**
     * Marcar mensajes como leídos (admin)
     */
    markTicketAsReadByAdmin: async (ticketId) => {
        try {
            await turso.execute({
                sql: `UPDATE support_messages 
                      SET read_by_admin = 1 
                      WHERE ticket_id = ? AND sender_type = 'client' AND read_by_admin = 0`,
                args: [ticketId]
            });

            await turso.execute({
                sql: `UPDATE support_tickets 
                      SET unread_by_admin = 0 
                      WHERE id = ?`,
                args: [ticketId]
            });

            return { success: true };
        } catch (e) {
            console.error('Error marking as read by admin:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // SISTEMA DE AGREGACIÓN Y ESTADÍSTICAS
    // ═══════════════════════════════════════════════════════════════

    updateSalesDailySummary: async (saleData, companyId, timezone) => {
        try {
            const tz = timezone || get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');

            // FASE 7.1 · UPSERT: 1 roundtrip en vez de SELECT + INSERT/UPDATE (2).
            // PK (company_id, day) garantiza atomicidad y elimina race condition
            // entre cajeros concurrentes del mismo día.
            await turso.execute({
                sql: `INSERT INTO sales_daily_summary
                        (company_id, day, total_sales, total_orders, updated_at)
                      VALUES (?, ?, ?, 1, datetime('now'))
                      ON CONFLICT(company_id, day) DO UPDATE SET
                        total_sales = total_sales + excluded.total_sales,
                        total_orders = total_orders + 1,
                        updated_at = datetime('now')`,
                args: [companyId, dateStr, saleData.total]
            });

            return { success: true };
        } catch (e) {
            console.error('Error updating daily summary:', e);
            return { success: false, error: e.message };
        }
    },

    updateVendorDailyPerformance: async (saleData, userId, userName, companyId) => {
        try {
            const tz = get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');
            const performanceId = `perf_${companyId}_${userId}_${dateStr}`;

            const itemsSold = saleData.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
            const cost = saleData.items?.reduce((sum, item) => sum + (item.cost || 0) * item.quantity, 0) || 0;
            const profit = saleData.total - cost;
            const saleTime = new Date(saleData.date).toISOString();
            const now = new Date().toISOString();

            // FASE 7.3 · UPSERT: 1 roundtrip en vez de SELECT + INSERT/UPDATE.
            // avg_ticket se recalcula inline contra los valores OLD del row
            // (SQLite evalúa SET expressions sobre los valores pre-update).
            await turso.execute({
                sql: `INSERT INTO vendor_daily_performance
                        (id, company_id, user_id, user_name, date, total_sales, total_amount, total_profit,
                         avg_ticket, total_items_sold, first_sale_time, last_sale_time, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(company_id, user_id, date) DO UPDATE SET
                        total_sales = total_sales + 1,
                        total_amount = total_amount + excluded.total_amount,
                        total_profit = total_profit + excluded.total_profit,
                        avg_ticket = (total_amount + excluded.total_amount) / (total_sales + 1),
                        total_items_sold = total_items_sold + excluded.total_items_sold,
                        last_sale_time = excluded.last_sale_time,
                        updated_at = excluded.updated_at`,
                args: [performanceId, companyId, userId, userName, dateStr, saleData.total,
                    profit, saleData.total, itemsSold, saleTime, saleTime, now, now]
            });

            return { success: true };
        } catch (e) {
            console.error('Error updating vendor performance:', e);
            return { success: false, error: e.message };
        }
    },

    updateProductDailyProfit: async (items, companyId, date) => {
        try {
            if (!Array.isArray(items) || items.length === 0) {
                return { success: true };
            }

            const tz = get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(date, tz, 'yyyy-MM-dd');

            // FASE 7.2 · Batch UPSERT: 1 roundtrip de red en vez de 2N
            // (un SELECT + un INSERT/UPDATE por cada item). Atómico (transacción
            // implícita de turso.batch) y sin race condition en agregados.
            const queries = items.map(item => {
                const price = parseFloat(item.price) || 0;
                const qty = parseFloat(item.quantity) || 0;
                const costUnit = parseFloat(item.cost) || 0;
                const taxRate = parseFloat(item.tax_rate) || 0;
                const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;

                const revenue = price * qty;
                const cost = costUnit * qty;
                const tax = revenue - (netPrice * qty);
                const profit = (netPrice - costUnit) * qty;

                return {
                    sql: `INSERT INTO product_daily_profit
                            (company_id, product_id, day, total_quantity, total_revenue,
                             total_cost, total_tax, total_profit, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                          ON CONFLICT(company_id, product_id, day) DO UPDATE SET
                            total_quantity = total_quantity + excluded.total_quantity,
                            total_revenue = total_revenue + excluded.total_revenue,
                            total_cost = total_cost + excluded.total_cost,
                            total_tax = total_tax + excluded.total_tax,
                            total_profit = total_profit + excluded.total_profit,
                            updated_at = CURRENT_TIMESTAMP`,
                    args: [companyId, item.id, dateStr, item.quantity,
                        revenue, cost, tax, profit]
                };
            });

            await turso.batch(queries);
            return { success: true };
        } catch (e) {
            console.error('Error updating product profit:', e);
            return { success: false, error: e.message };
        }
    },

    updateProductMovementStats: async (items, companyId) => {
        try {
            if (!Array.isArray(items) || items.length === 0) {
                return { success: true };
            }

            const now = new Date().toISOString();

            // FASE 7.3 · Batch UPSERT: 1 roundtrip de red en vez de 2N
            // (SELECT + INSERT/UPDATE por cada item). Atómico, sin race condition.
            const queries = items.map(item => {
                const statsId = `stats_${companyId}_${item.id}`;
                const revenue = item.price * item.quantity;

                return {
                    sql: `INSERT INTO product_movement_stats
                            (id, company_id, product_id, product_name, total_sold_all_time,
                             total_revenue_all_time, sold_last_7_days, revenue_last_7_days,
                             sold_last_30_days, revenue_last_30_days, last_sale_date, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(company_id, product_id) DO UPDATE SET
                            total_sold_all_time = total_sold_all_time + excluded.total_sold_all_time,
                            total_revenue_all_time = total_revenue_all_time + excluded.total_revenue_all_time,
                            sold_last_7_days = sold_last_7_days + excluded.sold_last_7_days,
                            revenue_last_7_days = revenue_last_7_days + excluded.revenue_last_7_days,
                            sold_last_30_days = sold_last_30_days + excluded.sold_last_30_days,
                            revenue_last_30_days = revenue_last_30_days + excluded.revenue_last_30_days,
                            last_sale_date = excluded.last_sale_date,
                            updated_at = excluded.updated_at`,
                    args: [statsId, companyId, item.id, item.name, item.quantity, revenue,
                        item.quantity, revenue, item.quantity, revenue, now, now]
                };
            });

            await turso.batch(queries);
            return { success: true };
        } catch (e) {
            console.error('Error updating product stats:', e);
            return { success: false, error: e.message };
        }
    },

    updateHourlySalesStats: async (saleData, companyId) => {
        try {
            const tz = get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');
            const hour = parseInt(formatInCompanyTime(saleData.date, tz, 'H'), 10) || 0;
            const hourlyId = `hourly_${companyId}_${dateStr}_${hour}`;
            const now = new Date().toISOString();

            // FASE 7.3 · UPSERT: 1 roundtrip en vez de SELECT + INSERT/UPDATE.
            await turso.execute({
                sql: `INSERT INTO hourly_sales_stats
                        (id, company_id, date, hour, total_sales, total_amount, created_at, updated_at)
                      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                      ON CONFLICT(company_id, date, hour) DO UPDATE SET
                        total_sales = total_sales + 1,
                        total_amount = total_amount + excluded.total_amount,
                        updated_at = excluded.updated_at`,
                args: [hourlyId, companyId, dateStr, hour, saleData.total, now, now]
            });

            return { success: true };
        } catch (e) {
            console.error('Error updating hourly stats:', e);
            return { success: false, error: e.message };
        }
    },

    updateSupplierPurchaseSummary: async (purchase, companyId) => {
        try {
            const purchaseDate = new Date(purchase.date);
            const dateStr = purchaseDate.toLocaleDateString('en-CA');
            const supplierId = purchase.supplierId;
            const summaryId = `supp_buy_${companyId}_${supplierId}_${dateStr}`;
            const totalItems = purchase.items.reduce((sum, item) => sum + Number(item.quantity), 0);

            const existing = await turso.execute({
                sql: 'SELECT * FROM supplier_purchase_summary WHERE company_id = ? AND supplier_id = ? AND date = ?',
                args: [companyId, supplierId, dateStr]
            });

            if (existing.rows.length === 0) {
                const now = new Date().toISOString();
                await turso.execute({
                    sql: `INSERT INTO supplier_purchase_summary
                          (id, company_id, supplier_id, supplier_name, date, total_purchases, total_amount, total_items, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
                    args: [summaryId, companyId, supplierId, purchase.supplierName, dateStr, purchase.total, totalItems, now, now]
                });
            } else {
                await turso.execute({
                    sql: `UPDATE supplier_purchase_summary SET
                            total_purchases = total_purchases + 1,
                            total_amount = total_amount + ?,
                            total_items = total_items + ?,
                            updated_at = ?
                          WHERE id = ?`,
                    args: [purchase.total, totalItems, new Date().toISOString(), summaryId]
                });
            }
            return { success: true };
        } catch (e) {
            console.error('Error updating supplier summary:', e);
            return { success: false, error: e.message };
        }
    },


    updateAllAggregations: async (saleData, userId, userName, companyId, timezone) => {
        try {
            await Promise.all([
                get().updateSalesDailySummary(saleData, companyId, timezone),
                get().updateVendorDailyPerformance(saleData, userId, userName, companyId),
                get().updateProductDailyProfit(saleData.items, companyId, saleData.date),
                get().updateProductMovementStats(saleData.items, companyId),
                get().updateHourlySalesStats(saleData, companyId)
            ]);

            console.log('✅ All aggregations updated');
            return { success: true };
        } catch (e) {
            console.error('Error updating aggregations:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // REVERSO DE AGREGACIONES (Para anulaciones)
    // ═══════════════════════════════════════════════════════════════

    reverseSalesDailySummary: async (saleData, companyId, timezone) => {
        try {
            const tz = timezone || get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');

            await turso.execute({
                sql: `UPDATE sales_daily_summary SET
                        total_sales = MAX(0, total_sales - ?),
                        total_orders = MAX(0, total_orders - 1),
                        updated_at = datetime('now')
                      WHERE company_id = ? AND day = ?`,
                args: [saleData.total, companyId, dateStr]
            });
            return { success: true };
        } catch (e) {
            console.error('Error reversing daily summary:', e);
            return { success: false, error: e.message };
        }
    },

    reverseVendorDailyPerformance: async (saleData, userId, companyId) => {
        try {
            const tz = get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');
            const performanceId = `perf_${companyId}_${userId}_${dateStr}`;

            const itemsSold = saleData.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
            const cost = saleData.items?.reduce((sum, item) => sum + (item.cost || 0) * item.quantity, 0) || 0;
            const profit = saleData.total - cost;

            const result = await turso.execute({
                sql: `UPDATE vendor_daily_performance SET
                        total_sales = MAX(0, total_sales - 1),
                        total_amount = MAX(0, total_amount - ?),
                        total_profit = MAX(0, total_profit - ?),
                        avg_ticket = CASE WHEN (total_sales - 1) > 0 THEN (total_amount - ?) / (total_sales - 1) ELSE 0 END,
                        total_items_sold = MAX(0, total_items_sold - ?),
                        updated_at = datetime('now')
                      WHERE id = ?`,
                args: [saleData.total, profit, saleData.total, itemsSold, performanceId]
            });
            const affected = Number(result?.rowsAffected ?? 0);
            if (affected === 0) {
                // No existe fila en vendor_daily_performance para esta venta. Esto ocurre si
                // se anula una venta cuya agregación nunca se creó (ej. falló silenciosamente
                // en su momento). Lo registramos para diagnóstico, no es bloqueante.
                console.warn(`⚠️ reverseVendorDailyPerformance: fila no encontrada (id=${performanceId}). Saltado.`);
            }
            return { success: true };
        } catch (e) {
            console.error('Error reversing vendor performance:', e);
            return { success: false, error: e.message };
        }
    },

    reverseProductDailyProfit: async (items, companyId, date) => {
        try {
            const tz = get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(date, tz, 'yyyy-MM-dd');

            for (const item of items) {
                const price = parseFloat(item.price) || 0;
                const qty = parseFloat(item.quantity) || 0;
                const costUnit = parseFloat(item.cost) || 0;
                const taxRate = parseFloat(item.tax_rate) || 0;
                const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;

                const revenue = price * qty;
                const cost = costUnit * qty;
                const tax = revenue - (netPrice * qty);
                const profit = (netPrice - costUnit) * qty;

                await turso.execute({
                    sql: `UPDATE product_daily_profit SET
                            total_quantity = MAX(0, total_quantity - ?),
                            total_revenue = MAX(0, total_revenue - ?),
                            total_cost = MAX(0, total_cost - ?),
                            total_tax = MAX(0, total_tax - ?),
                            total_profit = MAX(0, total_profit - ?),
                            updated_at = CURRENT_TIMESTAMP
                          WHERE company_id = ? AND product_id = ? AND day = ?`,
                    args: [item.quantity, revenue, cost, tax, profit, companyId, item.id, dateStr]
                });
            }
            return { success: true };
        } catch (e) {
            console.error('Error reversing product profit:', e);
            return { success: false, error: e.message };
        }
    },

    reverseProductMovementStats: async (items, companyId) => {
        try {
            const now = new Date().toISOString();

            for (const item of items) {
                const statsId = `stats_${companyId}_${item.id}`;
                const revenue = item.price * item.quantity;

                await turso.execute({
                    sql: `UPDATE product_movement_stats SET
                            total_sold_all_time = MAX(0, total_sold_all_time - ?),
                            total_revenue_all_time = MAX(0, total_revenue_all_time - ?),
                            sold_last_7_days = MAX(0, sold_last_7_days - ?),
                            revenue_last_7_days = MAX(0, revenue_last_7_days - ?),
                            sold_last_30_days = MAX(0, sold_last_30_days - ?),
                            revenue_last_30_days = MAX(0, revenue_last_30_days - ?),
                            updated_at = ?
                          WHERE id = ?`,
                    args: [item.quantity, revenue, item.quantity, revenue, item.quantity, revenue, now, statsId]
                });
            }
            return { success: true };
        } catch (e) {
            console.error('Error reversing product stats:', e);
            return { success: false, error: e.message };
        }
    },

    reverseHourlySalesStats: async (saleData, companyId) => {
        try {
            const tz = get().currentCompanyTimezone;
            const dateStr = formatInCompanyTime(saleData.date, tz, 'yyyy-MM-dd');
            const hour = parseInt(formatInCompanyTime(saleData.date, tz, 'H'), 10) || 0;
            const hourlyId = `hourly_${companyId}_${dateStr}_${hour}`;

            await turso.execute({
                sql: `UPDATE hourly_sales_stats SET
                        total_sales = MAX(0, total_sales - 1),
                        total_amount = MAX(0, total_amount - ?),
                        updated_at = datetime('now')
                      WHERE id = ?`,
                args: [saleData.total, hourlyId]
            });
            return { success: true };
        } catch (e) {
            console.error('Error reversing hourly stats:', e);
            return { success: false, error: e.message };
        }
    },

    reverseAllAggregations: async (saleData, userId, companyId, timezone) => {
        try {
            if (!saleData || !saleData.items) return { success: false, error: 'Missing sale data' };

            await Promise.all([
                get().reverseSalesDailySummary(saleData, companyId, timezone),
                get().reverseVendorDailyPerformance(saleData, userId, companyId),
                get().reverseProductDailyProfit(saleData.items, companyId, saleData.date),
                get().reverseProductMovementStats(saleData.items, companyId),
                get().reverseHourlySalesStats(saleData, companyId)
            ]);

            console.log('✅ All aggregations reversed for cancelled sale');
            return { success: true };
        } catch (e) {
            console.error('Error reversing aggregations:', e);
            return { success: false, error: e.message };
        }
    },



    // ═══════════════════════════════════════════════════════════════
    // REPORTES INSTANTÁNEOS (PRE-CALCULADOS)
    // ═══════════════════════════════════════════════════════════════

    getSalesSummaryByDate: async (date, companyId) => {
        try {
            const result = await turso.execute({
                sql: 'SELECT * FROM sales_daily_summary WHERE company_id = ? AND day = ?',
                args: [companyId || get().activeCompanyId, date]
            });
            const row = result.rows[0] || null;
            // Map actual DB columns to expected field names
            const summary = row ? {
                ...row,
                date: row.day,
                total_amount: row.total_sales || 0,
                total_profit: 0, // Not tracked in this table
                total_items_sold: 0,
                total_sales: row.total_orders || 0
            } : null;
            return { success: true, summary };
        } catch (e) {
            console.error('Error getting sales summary:', e);
            return { success: false, error: e.message };
        }
    },

    getSalesSummaryByRange: async (startDate, endDate, companyId) => {
        try {
            // Get sales summary from sales_daily_summary (has day, total_sales as amount, total_orders)
            const salesResult = await turso.execute({
                sql: `SELECT day, total_sales, total_orders
                      FROM sales_daily_summary 
                      WHERE company_id = ? AND day BETWEEN ? AND ?
                      ORDER BY day ASC`,
                args: [companyId || get().activeCompanyId, startDate, endDate]
            });

            // Get profit data from product_daily_profit
            const profitResult = await turso.execute({
                sql: `SELECT day, SUM(total_revenue) as total_revenue, SUM(total_cost) as total_cost, SUM(total_profit) as total_profit, SUM(total_tax) as total_tax
                      FROM product_daily_profit
                      WHERE company_id = ? AND day BETWEEN ? AND ?
                      GROUP BY day
                      ORDER BY day ASC`,
                args: [companyId || get().activeCompanyId, startDate, endDate]
            });

            // Create a map of profit data by day
            const profitByDay = {};
            profitResult.rows.forEach(row => {
                profitByDay[row.day] = row;
            });

            // Merge data: use sales_daily_summary for amounts and product_daily_profit for profit
            const daily = salesResult.rows.map(row => {
                const profitData = profitByDay[row.day] || {};
                return {
                    date: row.day,
                    total_sales: row.total_orders || 0,
                    total_amount: row.total_sales || 0,
                    total_profit: profitData.total_profit || 0,
                    total_cost: profitData.total_cost || 0,
                    total_tax: profitData.total_tax || 0,
                    cash_amount: 0,
                    card_amount: 0,
                    transfer_amount: 0
                };
            });

            const totals = daily.reduce((acc, day) => ({
                totalSales: acc.totalSales + day.total_sales,
                totalAmount: acc.totalAmount + day.total_amount,
                totalCost: acc.totalCost + day.total_cost,
                totalProfit: acc.totalProfit + day.total_profit,
                totalTax: acc.totalTax + day.total_tax,
                cashAmount: 0,
                cardAmount: 0,
                transferAmount: 0
            }), { totalSales: 0, totalAmount: 0, totalCost: 0, totalProfit: 0, totalTax: 0, cashAmount: 0, cardAmount: 0, transferAmount: 0 });

            return { success: true, daily, totals };
        } catch (e) {
            console.error('Error getting sales range:', e);
            return { success: false, error: e.message };
        }
    },

    compareSalesWithPreviousPeriod: async (startDate, endDate, companyId) => {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

            const prevEnd = new Date(start);
            prevEnd.setDate(prevEnd.getDate() - 1);
            const prevStart = new Date(prevEnd);
            prevStart.setDate(prevStart.getDate() - daysDiff);

            const prevStartStr = prevStart.toLocaleDateString('en-CA');
            const prevEndStr = prevEnd.toLocaleDateString('en-CA');

            const current = await get().getSalesSummaryByRange(startDate, endDate, companyId);
            const previous = await get().getSalesSummaryByRange(prevStartStr, prevEndStr, companyId);

            if (!current.success || !previous.success) {
                return { success: false, error: 'Error fetching data' };
            }

            const comparison = {
                current: current.totals,
                previous: previous.totals,
                changes: {
                    salesChange: ((current.totals.totalSales - previous.totals.totalSales) / (previous.totals.totalSales || 1)) * 100,
                    amountChange: ((current.totals.totalAmount - previous.totals.totalAmount) / (previous.totals.totalAmount || 1)) * 100,
                    profitChange: ((current.totals.totalProfit - previous.totals.totalProfit) / (previous.totals.totalProfit || 1)) * 100
                }
            };

            return { success: true, comparison };
        } catch (e) {
            console.error('Error comparing periods:', e);
            return { success: false, error: e.message };
        }
    },

    getVendorRanking: async (startDate, endDate, companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT user_id, user_name,
                        SUM(total_sales) as total_sales,
                        SUM(total_amount) as total_amount,
                        SUM(total_profit) as total_profit,
                        AVG(avg_ticket) as avg_ticket,
                        SUM(total_items_sold) as total_items_sold
                      FROM vendor_daily_performance
                      WHERE company_id = ? AND date BETWEEN ? AND ?
                      GROUP BY user_id, user_name
                      ORDER BY total_amount DESC`,
                args: [companyId || get().activeCompanyId, startDate, endDate]
            });
            return { success: true, ranking: result.rows };
        } catch (e) {
            console.error('Error getting vendor ranking:', e);
            return { success: false, error: e.message };
        }
    },

    getTopProducts: async (startDate, endDate, limit = 10, companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT pdp.product_id, p.name as product_name,
                        SUM(pdp.total_quantity) as total_sold,
                        SUM(pdp.total_revenue) as total_revenue,
                        SUM(pdp.total_profit) as total_profit,
                        CASE WHEN SUM(pdp.total_revenue) > 0 
                             THEN (SUM(pdp.total_profit) / SUM(pdp.total_revenue)) * 100 
                             ELSE 0 END as avg_margin
                      FROM product_daily_profit pdp
                      LEFT JOIN products p ON pdp.product_id = p.id
                      WHERE pdp.company_id = ? AND pdp.day BETWEEN ? AND ?
                      GROUP BY pdp.product_id
                      ORDER BY total_sold DESC
                      LIMIT ?`,
                args: [companyId || get().activeCompanyId, startDate, endDate, limit]
            });
            return { success: true, products: result.rows };
        } catch (e) {
            console.error('Error getting top products:', e);
            return { success: false, error: e.message };
        }
    },

    getBestMarginProducts: async (startDate, endDate, limit = 10, companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT pdp.product_id, p.name as product_name,
                        SUM(pdp.total_quantity) as total_sold,
                        SUM(pdp.total_revenue) as total_revenue,
                        SUM(pdp.total_profit) as total_profit,
                        CASE WHEN SUM(pdp.total_revenue) > 0 
                             THEN (SUM(pdp.total_profit) / SUM(pdp.total_revenue)) * 100 
                             ELSE 0 END as avg_margin
                      FROM product_daily_profit pdp
                      LEFT JOIN products p ON pdp.product_id = p.id
                      WHERE pdp.company_id = ? AND pdp.day BETWEEN ? AND ?
                      GROUP BY pdp.product_id
                      HAVING total_sold > 0
                      ORDER BY avg_margin DESC
                      LIMIT ?`,
                args: [companyId || get().activeCompanyId, startDate, endDate, limit]
            });
            return { success: true, products: result.rows };
        } catch (e) {
            console.error('Error getting best margin products:', e);
            return { success: false, error: e.message };
        }
    },

    getSalesByPaymentMethod: async (startDate, endDate, companyId, userId) => {
        try {
            const cid = companyId || get().activeCompanyId;
            const tz = get().currentCompanyTimezone;
            const utcStart = getStartFromDateString(startDate, tz).toISOString();
            const utcEnd = getEndFromDateString(endDate, tz).toISOString();
            let sql = `SELECT payment_method, COUNT(*) as count, SUM(total) as amount
                       FROM sales
                       WHERE company_id = ? AND date >= ? AND date <= ? AND status != 'cancelled'`;
            const args = [cid, utcStart, utcEnd];
            if (userId) {
                sql += ' AND user_id = ?';
                args.push(userId);
            }
            sql += ' GROUP BY payment_method ORDER BY amount DESC';
            const result = await turso.execute({ sql, args });
            const totalAmount = result.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
            const totalCount = result.rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
            const methods = result.rows.map(r => ({
                method: r.payment_method || 'Otro',
                amount: Number(r.amount) || 0,
                count: Number(r.count) || 0,
                percentage: totalAmount > 0 ? ((Number(r.amount) || 0) / totalAmount) * 100 : 0
            }));
            return { success: true, methods, totalAmount, totalCount };
        } catch (e) {
            console.error('Error getting sales by payment method:', e);
            return { success: false, error: e.message };
        }
    },

    getVendorTopProducts: async (startDate, endDate, userId, companyId, limit = 10) => {
        try {
            const cid = companyId || get().activeCompanyId;
            const tz = get().currentCompanyTimezone;
            const utcStart = getStartFromDateString(startDate, tz).toISOString();
            const utcEnd = getEndFromDateString(endDate, tz).toISOString();
            const result = await turso.execute({
                sql: `SELECT items FROM sales
                      WHERE company_id = ? AND date >= ? AND date <= ? AND status != 'cancelled' AND user_id = ?`,
                args: [cid, utcStart, utcEnd, userId]
            });
            const productMap = {};
            for (const row of result.rows) {
                try {
                    const items = JSON.parse(row.items || '[]');
                    for (const item of items) {
                        const key = item.id || item.name;
                        if (!productMap[key]) {
                            productMap[key] = { name: item.name, quantity: 0, amount: 0 };
                        }
                        productMap[key].quantity += Number(item.qty || item.quantity || 0);
                        productMap[key].amount += Number(item.qty || item.quantity || 0) * Number(item.price || 0);
                    }
                } catch {}
            }
            const products = Object.values(productMap)
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, limit);
            return { success: true, products };
        } catch (e) {
            console.error('Error getting vendor top products:', e);
            return { success: false, error: e.message };
        }
    },

    getVendorSalesSummary: async (startDate, endDate, companyId) => {
        try {
            const cid = companyId || get().activeCompanyId;
            const tz = get().currentCompanyTimezone;
            const utcStart = getStartFromDateString(startDate, tz).toISOString();
            const utcEnd = getEndFromDateString(endDate, tz).toISOString();
            const result = await turso.execute({
                sql: `SELECT s.user_id, u.name as user_name,
                        COUNT(*) as total_sales,
                        SUM(s.total) as total_amount,
                        SUM(CASE WHEN s.payment_method = 'Efectivo' THEN s.total ELSE 0 END) as cash,
                        SUM(CASE WHEN s.payment_method = 'Tarjeta' THEN s.total ELSE 0 END) as card,
                        SUM(CASE WHEN s.payment_method = 'Transferencia' THEN s.total ELSE 0 END) as transfer,
                        SUM(CASE WHEN s.payment_method = 'Mixto' THEN s.total ELSE 0 END) as mixed,
                        SUM(CASE WHEN s.payment_method = 'Crédito' THEN s.total ELSE 0 END) as credit
                      FROM sales s
                      LEFT JOIN users u ON s.user_id = u.id
                      WHERE s.company_id = ? AND s.date >= ? AND s.date <= ? AND s.status != 'cancelled'
                      GROUP BY s.user_id
                      ORDER BY total_amount DESC`,
                args: [cid, utcStart, utcEnd]
            });
            const vendors = result.rows.map(r => ({
                user_id: r.user_id,
                user_name: r.user_name || 'Sin nombre',
                total_sales: Number(r.total_sales) || 0,
                total_amount: Number(r.total_amount) || 0,
                cash: Number(r.cash) || 0,
                card: Number(r.card) || 0,
                transfer: Number(r.transfer) || 0,
                mixed: Number(r.mixed) || 0,
                credit: Number(r.credit) || 0
            }));
            return { success: true, vendors };
        } catch (e) {
            console.error('Error getting vendor sales summary:', e);
            return { success: false, error: e.message };
        }
    },

    getPeakHoursAnalysis: async (startDate, endDate, companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT hour,
                        SUM(total_sales) as total_sales,
                        SUM(total_amount) as total_amount,
                        AVG(total_amount / NULLIF(total_sales, 0)) as avg_ticket
                      FROM hourly_sales_stats
                      WHERE company_id = ? AND date BETWEEN ? AND ?
                      GROUP BY hour
                      ORDER BY hour ASC`,
                args: [companyId || get().activeCompanyId, startDate, endDate]
            });
            return { success: true, hours: result.rows };
        } catch (e) {
            console.error('Error getting peak hours:', e);
            return { success: false, error: e.message };
        }
    },

    getSupplierPurchaseSummary: async (startDate, endDate, companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT supplier_id, supplier_name,
                        SUM(total_purchases) as total_purchases,
                        SUM(total_amount) as total_amount,
                        SUM(total_items) as total_items
                      FROM supplier_purchase_summary
                      WHERE company_id = ? AND date BETWEEN ? AND ?
                      GROUP BY supplier_id, supplier_name
                      ORDER BY total_amount DESC`,
                args: [companyId || get().activeCompanyId, startDate, endDate]
            });
            return { success: true, suppliers: result.rows };
        } catch (e) {
            console.error('Error getting supplier summary:', e);
            return { success: false, error: e.message };
        }
    },

    getSlowMovingProducts: async (companyId) => {
        try {
            const result = await turso.execute({
                sql: `SELECT product_id, product_name,
                        total_sold_all_time, sold_last_7_days, sold_last_30_days,
                        avg_daily_sales, last_sale_date
                      FROM product_movement_stats
                      WHERE company_id = ? AND avg_daily_sales < 1
                      ORDER BY avg_daily_sales ASC, last_sale_date ASC
                      LIMIT 20`,
                args: [companyId || get().activeCompanyId]
            });
            return { success: true, products: result.rows };
        } catch (e) {
            console.error('Error getting slow moving products:', e);
            return { success: false, error: e.message };
        }
    },

    getAggregatedDashboardMetrics: async (companyId) => {
        try {
            const today = new Date().toLocaleDateString('en-CA');
            const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

            const [todayData, yesterdayData] = await Promise.all([
                get().getSalesSummaryByDate(today, companyId),
                get().getSalesSummaryByDate(yesterday, companyId)
            ]);

            const todaySum = todayData.summary || {};
            const yesterdaySum = yesterdayData.summary || {};

            const metrics = {
                today: {
                    sales: todaySum.total_sales || 0,
                    amount: todaySum.total_amount || 0,
                    profit: todaySum.total_profit || 0,
                    items: todaySum.total_items_sold || 0
                },
                yesterday: {
                    sales: yesterdaySum.total_sales || 0,
                    amount: yesterdaySum.total_amount || 0,
                    profit: yesterdaySum.total_profit || 0,
                    items: yesterdaySum.total_items_sold || 0
                },
                changes: {
                    salesChange: ((todaySum.total_sales || 0) - (yesterdaySum.total_sales || 0)) / ((yesterdaySum.total_sales || 1)) * 100,
                    amountChange: ((todaySum.total_amount || 0) - (yesterdaySum.total_amount || 0)) / ((yesterdaySum.total_amount || 1)) * 100,
                    profitChange: ((todaySum.total_profit || 0) - (yesterdaySum.total_profit || 0)) / ((yesterdaySum.total_profit || 1)) * 100
                }
            };

            return { success: true, metrics };
        } catch (e) {
            console.error('Error getting dashboard metrics:', e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // MANTENIMIENTO DE AGREGACIONES
    // ═══════════════════════════════════════════════════════════════

    cleanOldProductStats: async (companyId) => {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 90);
            const cutoffStr = cutoffDate.toLocaleDateString('en-CA');

            await turso.execute({
                sql: 'DELETE FROM product_daily_profit WHERE company_id = ? AND date < ?',
                args: [companyId, cutoffStr]
            });

            await turso.execute({
                sql: 'DELETE FROM hourly_sales_stats WHERE company_id = ? AND date < ?',
                args: [companyId, cutoffStr]
            });

            console.log('✅ Old stats cleaned');
            return { success: true };
        } catch (e) {
            console.error('Error cleaning stats:', e);
            return { success: false, error: e.message };
        }
    },

    recalculateProductAverages: async (companyId) => {
        try {
            const products = await turso.execute({
                sql: 'SELECT DISTINCT product_id FROM product_movement_stats WHERE company_id = ?',
                args: [companyId]
            });

            for (const p of products.rows) {
                const sales = await turso.execute({
                    sql: `SELECT SUM(units_sold) as total 
                          FROM product_daily_profit 
                          WHERE company_id = ? AND product_id = ? 
                          AND date >= date('now', '-30 days')`,
                    args: [companyId, p.product_id]
                });

                const total = sales.rows[0]?.total || 0;
                const avgDaily = total / 30;

                await turso.execute({
                    sql: 'UPDATE product_movement_stats SET avg_daily_sales = ? WHERE company_id = ? AND product_id = ?',
                    args: [avgDaily, companyId, p.product_id]
                });
            }

            console.log('✅ Averages recalculated');
            return { success: true };
        } catch (e) {
            console.error('Error recalculating averages:', e);
            return { success: false, error: e.message };
        }
    },

    // ==========================================
    // 👑 ADMIN & SAAS ACTIONS
    // ==========================================

    // ==========================================
    // 🏷️ COMPANY MODULE MANAGEMENT (Feature Flags)
    // ==========================================

    fetchCompanyModules: async (companyId) => {
        const targetCompanyId = companyId || get().activeCompanyId;
        if (!targetCompanyId) return [];
        try {
            const res = await turso.execute({
                sql: "SELECT * FROM company_modules WHERE company_id = ?",
                args: [targetCompanyId]
            });
            if (!companyId) {
                // Update local state only if fetching for current company
                set({ companyModules: res.rows });
            }
            return res.rows;
        } catch (e) {
            console.error('Error fetching company modules:', e);
            return [];
        }
    },

    updateCompanyModule: async (companyId, moduleKey, enabled) => {
        try {
            await turso.execute({
                sql: `INSERT INTO company_modules (company_id, module_key, enabled, updated_at)
                      VALUES (?, ?, ?, ?)
                      ON CONFLICT(company_id, module_key) DO UPDATE SET enabled = ?, updated_at = ?`,
                args: [companyId, moduleKey, enabled ? 1 : 0, new Date().toISOString(), enabled ? 1 : 0, new Date().toISOString()]
            });
            // Refresh local state if it's the current company
            if (companyId === get().activeCompanyId) {
                await get().fetchCompanyModules();
            }
            return { success: true };
        } catch (e) {
            console.error('Error updating company module:', e);
            return { success: false, error: e.message };
        }
    },

    hasModule: (moduleKey) => {
        const { companyModules, currentUser, currentUserCompanyRole } = get();

        // Super admin / owner / Administrador always have access
        if (currentUser?.role === 'super_admin' || currentUserCompanyRole === 'owner' || currentUserCompanyRole === 'super_admin') return true;

        // If no records exist for this company, use defaults (all enabled except 'personal')
        if (!companyModules || companyModules.length === 0) {
            // Default: personal is disabled, everything else is enabled
            return moduleKey !== 'personal';
        }

        const record = companyModules.find(m => m.module_key === moduleKey);
        if (!record) {
            // If module not in DB, default: personal disabled, rest enabled
            return moduleKey !== 'personal';
        }

        return Number(record.enabled) === 1;
    },

    fetchAllSubscriptions: async () => {
        try {
            const result = await turso.execute(`
                SELECT c.id as company_id, c.name as company_name, c.status as company_status,
                       s.id as subscription_id, s.plan_id, s.status as subscription_status,
                       s.amount, s.currency, s.current_period_start, s.current_period_end
                FROM companies c
                LEFT JOIN subscriptions s ON c.id = s.company_id
                ORDER BY c.created_at DESC
            `);
            return result.rows;
        } catch (e) {
            console.error('Error fetching subscriptions:', e);
            throw e; // Let the component handle it or return empty
        }
    },

    toggleCompanyStatus: async (companyId, newStatus) => {
        try {
            await turso.execute({
                sql: "UPDATE companies SET status = ? WHERE id = ?",
                args: [newStatus, companyId]
            });
            return { success: true };
        } catch (e) {
            console.error("Error toggling company status:", e);
            return { success: false, error: e.message };
        }
    },

    deleteCompany: async (companyId) => {
        try {
            // Safe delete for Zombies
            // Safe delete for Zombies - ORDER MATTERS! DELETE CHILDREN FIRST.
            await turso.batch([
                // 1. Operational Data
                { sql: "DELETE FROM supplier_orders WHERE company_id = ?", args: [companyId] },
                { sql: "DELETE FROM payments WHERE company_id = ?", args: [companyId] },
                { sql: "DELETE FROM audit_logs WHERE company_id = ?", args: [companyId] },

                // 2. Configuration Data
                { sql: "DELETE FROM payment_terminals WHERE company_id = ?", args: [companyId] },
                { sql: "DELETE FROM bank_accounts WHERE company_id = ?", args: [companyId] },
                { sql: "DELETE FROM payment_methods_config WHERE company_id = ?", args: [companyId] },

                // 3. Core Relations
                { sql: "DELETE FROM subscriptions WHERE company_id = ?", args: [companyId] },
                { sql: "DELETE FROM user_companies WHERE company_id = ?", args: [companyId] },
                { sql: "DELETE FROM users WHERE company_id = ?", args: [companyId] },

                // 4. The Company Itself (LAST)
                { sql: "DELETE FROM companies WHERE id = ?", args: [companyId] }
            ]);
            return { success: true };
        } catch (e) {
            console.error("Error deleting company:", e);
            return { success: false, error: e.message };
        }
    },

    adminCreateSubscription: async (companyId, planId = 'monthly', amount = 30000) => {
        try {
            const now = new Date();
            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);

            // 1. Check if there is already an existing subscription for this company (active or not)
            // Since company_id is NOT unique, we pick the most recent one or creating a new one?
            // User intention is "Activate", so if there is an existing one, update it.
            const existingSub = await turso.execute({
                sql: "SELECT id FROM subscriptions WHERE company_id = ? LIMIT 1",
                args: [companyId]
            });

            if (existingSub.rows.length > 0) {
                // Update existing
                const subId = existingSub.rows[0].id;
                await turso.execute({
                    sql: `UPDATE subscriptions SET 
                            plan_id = ?, 
                            status = 'active', 
                            amount = ?, 
                            current_period_start = ?, 
                            current_period_end = ?, 
                            updated_at = ?
                          WHERE id = ?`,
                    args: [
                        planId,
                        amount,
                        now.toISOString(),
                        nextMonth.toISOString(),
                        now.toISOString(),
                        subId
                    ]
                });
            } else {
                // Insert new
                const subId = `sub_manual_${Date.now()}`;
                await turso.execute({
                    sql: `INSERT INTO subscriptions (id, company_id, plan_id, status, amount, currency, current_period_start, current_period_end, created_at, updated_at)
                          VALUES (?, ?, ?, 'active', ?, 'CLP', ?, ?, ?, ?)`,
                    args: [
                        subId,
                        companyId,
                        planId,
                        amount,
                        now.toISOString(),
                        nextMonth.toISOString(),
                        now.toISOString(),
                        now.toISOString()
                    ]
                });
            }

            return { success: true };
        } catch (e) {
            console.error("Error creating manual subscription:", e);
            return { success: false, error: e.message };
        }
    },

    // ==========================================
    // PREORDERS (ENCARGOS) MODULE
    // ==========================================

    preorders: [],
    preorderCart: [],
    _preorderCache: { key: '', products: [], ts: 0 },
    _preorderIndexEnsured: false,

    addToPreorderCart: (product) => {
        set(state => {
            const billingUnit = product.preorder_billing_unit || 'unit';
            const useBasePrice = product.preorder_use_base_price !== 0; // default true (1)
            const effectivePrice = (product.is_offer && product.offer_price > 0)
                ? product.offer_price : product.price;

            // Resolve actual price for preorder
            const resolvedPrice = useBasePrice ? effectivePrice : (parseFloat(product.preorder_price_per_kg) || 0);

            // If billing by kg, resolvedPrice is per_kg. If unit, it's unit_price.
            const pricePerKg = billingUnit === 'kg' ? resolvedPrice : 0;
            const gramPerUnit = parseFloat(product.preorder_gram_per_unit) || 0;

            // Helper to calculate estimated line total
            const calcEstimated = (qty) => {
                if (billingUnit === 'kg') {
                    if (pricePerKg > 0 && gramPerUnit > 0) {
                        return qty * (gramPerUnit / 1000) * pricePerKg;
                    }
                    return null; // Pending calculation
                }
                return qty * (billingUnit === 'kg' ? 0 : resolvedPrice);
            };

            const existing = state.preorderCart.find(i => i.id === product.id);
            if (existing) {
                const newQty = existing.qty + 1;
                return {
                    preorderCart: state.preorderCart.map(i =>
                        i.id === product.id
                            ? { ...i, qty: newQty, line_total: calcEstimated(newQty) }
                            : i
                    )
                };
            }
            return {
                preorderCart: [...state.preorderCart, {
                    id: product.id,
                    product_id: product.id,
                    product_name: product.name,
                    qty: 1,
                    unit: product.preorder_unit || product.unit || 'Und',
                    unit_price: billingUnit === 'unit' ? resolvedPrice : effectivePrice, // display base price if billing by kg?
                    billing_unit: billingUnit,
                    price_per_kg: pricePerKg,
                    gram_per_unit: gramPerUnit,
                    line_total: calcEstimated(1),
                    note: '',
                    allow_item_notes: product.allow_item_notes
                }]
            };
        });
    },

    updatePreorderCartItem: (productId, updates) => {
        set(state => ({
            preorderCart: state.preorderCart.map(i => {
                if (i.id !== productId) return i;
                const updated = { ...i, ...updates };
                // Recalculate estimated total based on billing mode
                if (updated.billing_unit === 'kg') {
                    if (parseFloat(updated.price_per_kg) > 0 && parseFloat(updated.gram_per_unit) > 0) {
                        updated.line_total = updated.qty * (parseFloat(updated.gram_per_unit) / 1000) * parseFloat(updated.price_per_kg);
                    } else {
                        updated.line_total = null; // Pending
                    }
                } else {
                    updated.line_total = updated.qty * updated.unit_price;
                }
                return updated;
            })
        }));
    },

    removeFromPreorderCart: (productId) => {
        set(state => ({
            preorderCart: state.preorderCart.filter(i => i.id !== productId)
        }));
    },

    clearPreorderCart: () => set({ preorderCart: [] }),

    // Suma (IN) o resta (OUT) efectivo de un encargo a la caja ABIERTA del
    // momento, vía cash_movements. Así el cobro/devolución de encargos en
    // efectivo se refleja en la caja en tiempo real (igual que las ventas POS).
    // Solo aplica a efectivo; tarjeta/transferencia no tocan la caja física.
    // Si no hay caja abierta o el monto es 0, no hace nada (no se puede sumar
    // a una caja cerrada).
    _registerPreorderCash: async ({ amount, reason, direction = 'IN' }) => {
        try {
            const { cashRegister, activeCompanyId } = get();
            const amt = Number(amount) || 0;
            if (!cashRegister?.id || amt <= 0) return { skipped: true };

            await turso.execute({
                sql: "INSERT INTO cash_movements (register_id, type, amount, reason, date, company_id) VALUES (?, ?, ?, ?, ?, ?)",
                args: [cashRegister.id, direction, amt, reason, new Date().toISOString(), activeCompanyId]
            });
            get().refreshRegisterStats(cashRegister.id);
            return { success: true };
        } catch (e) {
            console.error('Error registrando efectivo de encargo en caja:', e);
            return { success: false, error: e.message };
        }
    },

    createPreorder: async (preorderData) => {
        const { activeCompanyId, currentUser } = get();
        try {
            const estimatedTotal = preorderData.total_amount;
            const result = await turso.execute({
                sql: `INSERT INTO preorders
                      (company_id, client_id, client_name, client_phone, due_date, due_time,
                       status, total_amount, estimated_total, deposit_amount, remaining_amount,
                       delivery_type, delivery_address, notes, created_by, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    preorderData.client_id || null,
                    preorderData.client_name || '',
                    preorderData.client_phone || '',
                    preorderData.due_date,
                    preorderData.due_time,
                    estimatedTotal,
                    estimatedTotal,
                    preorderData.deposit_amount || 0,
                    estimatedTotal - (preorderData.deposit_amount || 0),
                    preorderData.delivery_type || 'pickup',
                    preorderData.delivery_address || '',
                    preorderData.notes || '',
                    currentUser?.name || '',
                    new Date().toISOString()
                ]
            });

            const preorderId = Number(result.lastInsertRowid);

            // Insert items with bakery fields
            for (const item of preorderData.items) {
                const itemEstimated = item.line_total;
                await turso.execute({
                    sql: `INSERT INTO preorder_items
                          (preorder_id, product_id, product_name, qty, unit, unit_price, line_total, note,
                           billing_unit, price_per_kg, gram_per_unit, estimated_total)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [
                        preorderId,
                        item.product_id,
                        item.product_name,
                        item.qty,
                        item.unit || 'Und',
                        item.unit_price,
                        item.line_total,
                        item.note || '',
                        item.billing_unit || 'unit',
                        item.price_per_kg || 0,
                        item.gram_per_unit || 0,
                        itemEstimated
                    ]
                });
            }

            // Insert initial payment (deposit) if any
            if (preorderData.deposit_amount > 0) {
                const depositMethod = preorderData.deposit_method || 'Efectivo';
                // Estampamos register_id para tarjeta/transferencia (efectivo va
                // por cash_movements). Permite ver el cobro en el desglose de la
                // caja abierta sin mezclar entre cajeras concurrentes.
                const regId = get().cashRegister?.id || null;
                const tId = depositMethod === 'Tarjeta' ? (preorderData.deposit_terminal_id || null) : null;
                const baId = depositMethod === 'Transferencia' ? (preorderData.deposit_bank_account_id || null) : null;
                await turso.execute({
                    sql: `INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id)
                          VALUES (?, ?, ?, 'deposit', ?, ?, ?)`,
                    args: [preorderId, preorderData.deposit_amount, depositMethod, regId, tId, baId]
                });
                // Si el abono fue en efectivo, sumarlo a la caja abierta.
                if (depositMethod === 'Efectivo') {
                    await get()._registerPreorderCash({
                        amount: preorderData.deposit_amount,
                        reason: `Abono encargo #${preorderId} - ${preorderData.client_name || 'Cliente'}`.trim()
                    });
                } else if (regId && (depositMethod === 'Tarjeta' || depositMethod === 'Transferencia')) {
                    // Refresca stats para que el desglose tarjeta/transf se actualice live.
                    get().refreshRegisterStats(regId);
                }
            }

            // Refresh list
            await get().fetchPreorders();
            set({ preorderCart: [] });

            // Empuje a miniveci (best-effort, no bloquea). Si el cliente tiene
            // cuenta en la web, miniveci lo asocia y este encargo aparece en
            // su historial. Si la integración no está activa o el cliente no es
            // identificable, el endpoint hace skip silencioso.
            if (typeof navigator !== 'undefined' && navigator.onLine) {
                fetch('/api/integration/push-preorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preorder_id: preorderId }),
                }).catch(() => { /* fire-and-forget */ });
            }

            return { success: true, preorderId };
        } catch (e) {
            console.error('Error creating preorder:', e);
            return { success: false, error: e.message };
        }
    },

    fetchPreorders: async (filters = {}) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT p.*, 
                        (SELECT GROUP_CONCAT(pi.product_name || ' x' || pi.qty, ', ')
                         FROM preorder_items pi WHERE pi.preorder_id = p.id) as items_summary
                       FROM preorders p
                       WHERE p.company_id = ?`;
            const args = [activeCompanyId];

            if (filters.date) {
                sql += ' AND p.due_date = ?';
                args.push(filters.date);
            }
            if (filters.status && filters.status !== 'all') {
                sql += ' AND p.status = ?';
                args.push(filters.status);
            }
            if (filters.startDate && filters.endDate) {
                sql += ' AND p.due_date BETWEEN ? AND ?';
                args.push(filters.startDate, filters.endDate);
            }

            sql += ' ORDER BY p.due_date ASC, p.due_time ASC';

            const result = await turso.execute({ sql, args });
            set({ preorders: result.rows });
            return { success: true, preorders: result.rows };
        } catch (e) {
            console.error('Error fetching preorders:', e);
            return { success: false, error: e.message };
        }
    },

    getPreorderDetails: async (preorderId) => {
        try {
            const [preorderRes, itemsRes, paymentsRes] = await turso.batch([
                {
                    sql: 'SELECT * FROM preorders WHERE id = ?',
                    args: [preorderId]
                },
                {
                    sql: 'SELECT * FROM preorder_items WHERE preorder_id = ?',
                    args: [preorderId]
                },
                {
                    sql: 'SELECT * FROM preorder_payments WHERE preorder_id = ? ORDER BY created_at ASC',
                    args: [preorderId]
                }
            ]);

            return {
                success: true,
                preorder: preorderRes.rows[0] || null,
                items: itemsRes.rows,
                payments: paymentsRes.rows
            };
        } catch (e) {
            console.error('Error getting preorder details:', e);
            return { success: false, error: e.message };
        }
    },

    updatePreorderStatus: async (preorderId, newStatus, reason = null) => {
        try {
            // Leemos external_source/public_code + status/cliente antes del cambio
            // (el status previo evita devolver dos veces si ya estaba cancelado).
            const infoRes = await turso.execute({
                sql: 'SELECT external_source, external_public_code, status, client_name FROM preorders WHERE id = ?',
                args: [preorderId],
            });
            const info = infoRes.rows?.[0] || {};
            const prevStatus = info.status;

            // Si hay motivo (rechazo), lo guardamos en notes para que quede registro local
            if (reason && reason.trim()) {
                await turso.execute({
                    sql: `UPDATE preorders SET status = ?, notes = TRIM(COALESCE(notes,'') || ' · Rechazo: ' || ?), updated_at = datetime('now') WHERE id = ?`,
                    args: [newStatus, reason.trim(), preorderId]
                });
            } else {
                await turso.execute({
                    sql: `UPDATE preorders SET status = ?, updated_at = datetime('now') WHERE id = ?`,
                    args: [newStatus, preorderId]
                });
            }

            // Si se CANCELA (y no estaba ya cancelado), devolver de la caja el
            // efectivo que se había cobrado (abonos/pagos en efectivo). La salida
            // sale de la caja abierta del que procesa la cancelación.
            if (newStatus === 'canceled' && prevStatus !== 'canceled') {
                const cashRes = await turso.execute({
                    sql: `SELECT COALESCE(SUM(amount), 0) as cash_paid
                          FROM preorder_payments
                          WHERE preorder_id = ? AND method = 'Efectivo'`,
                    args: [preorderId]
                });
                const cashPaid = Number(cashRes.rows[0]?.cash_paid) || 0;
                if (cashPaid > 0) {
                    await get()._registerPreorderCash({
                        amount: cashPaid,
                        reason: `Devolución abono encargo #${preorderId} - ${info.client_name || ''}`.trim(),
                        direction: 'OUT'
                    });
                }
            }

            await get().fetchPreorders();

            // Aviso saliente a miniveci si el encargo está sincronizado con la web.
            // Disparamos para CUALQUIER preorder con external_public_code, así
            // funciona tanto para los que vinieron de miniveci como para los
            // presenciales que se empujaron a la cuenta del cliente.
            if (info.external_public_code) {
                fetch('/api/integration/notify-miniveci-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        public_code: info.external_public_code,
                        status: newStatus,
                        ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
                    }),
                }).catch(err => console.warn('notify-miniveci failed', err));
            }

            return { success: true };
        } catch (e) {
            console.error('Error updating preorder status:', e);
            return { success: false, error: e.message };
        }
    },

    addPreorderPayment: async (preorderId, amount, method, type = 'final', { terminalId = null, bankAccountId = null } = {}) => {
        try {
            const regId = get().cashRegister?.id || null;
            const tId = method === 'Tarjeta' ? (terminalId || null) : null;
            const baId = method === 'Transferencia' ? (bankAccountId || null) : null;
            await turso.execute({
                sql: `INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [preorderId, amount, method, type, regId, tId, baId]
            });

            // Si el pago fue en efectivo, sumarlo a la caja abierta.
            if (method === 'Efectivo') {
                await get()._registerPreorderCash({
                    amount,
                    reason: `Pago encargo #${preorderId}`
                });
            } else if (regId && (method === 'Tarjeta' || method === 'Transferencia')) {
                get().refreshRegisterStats(regId);
            }

            // Update remaining amount
            const paymentsRes = await turso.execute({
                sql: 'SELECT SUM(amount) as total_paid FROM preorder_payments WHERE preorder_id = ?',
                args: [preorderId]
            });
            const totalPaid = paymentsRes.rows[0]?.total_paid || 0;

            const preorderRes = await turso.execute({
                sql: 'SELECT total_amount FROM preorders WHERE id = ?',
                args: [preorderId]
            });
            const totalAmount = preorderRes.rows[0]?.total_amount || 0;

            await turso.execute({
                sql: `UPDATE preorders SET deposit_amount = ?, remaining_amount = ?, updated_at = datetime('now') WHERE id = ?`,
                args: [totalPaid, totalAmount - totalPaid, preorderId]
            });

            // If fully paid, mark as delivered
            if (totalPaid >= totalAmount && type === 'final') {
                await turso.execute({
                    sql: `UPDATE preorders SET status = 'delivered', updated_at = datetime('now') WHERE id = ?`,
                    args: [preorderId]
                });
            }

            await get().fetchPreorders();
            return { success: true };
        } catch (e) {
            console.error('Error adding preorder payment:', e);
            return { success: false, error: e.message };
        }
    },

    getPreorderableProducts: async (searchTerm = '', category = 'Todos') => {
        const { activeCompanyId, _preorderCache } = get();
        const cacheKey = `${activeCompanyId}|${searchTerm}|${category}`;

        // Helper: filtrar+formatear desde cualquier lista de productos
        const filterAndFormat = (rows) => {
            const term = String(searchTerm || '').toLowerCase();
            let out = (rows || []).filter(p =>
                p && (p.sale_mode === 'preorder_only' || p.sale_mode === 'both')
            );
            if (category && category !== 'Todos') out = out.filter(p => p.category === category);
            if (term) out = out.filter(p =>
                (p.name && String(p.name).toLowerCase().includes(term)) ||
                (p.sku && String(p.sku).toLowerCase().includes(term))
            );
            out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            return out.slice(0, 50).map(p => ({
                ...p,
                price_ranges: typeof p.price_ranges === 'string'
                    ? (() => { try { return JSON.parse(p.price_ranges); } catch { return []; } })()
                    : (p.price_ranges || [])
            }));
        };

        // Refresco silencioso desde Turso → actualiza Dexie + caché
        const refreshFromTurso = async () => {
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;
            try {
                if (!get()._preorderIndexEnsured) {
                    set({ _preorderIndexEnsured: true });
                    turso.execute(
                        `CREATE INDEX IF NOT EXISTS idx_products_company_salemode
                         ON products(company_id, sale_mode)`
                    ).catch(() => {});
                }
                const result = await turso.execute({
                    sql: `SELECT id, name, sku, price, cost, image, category, unit,
                          sale_mode, is_offer, offer_price, allow_item_notes, price_ranges,
                          preorder_unit, preorder_billing_unit, preorder_price_per_kg,
                          preorder_gram_per_unit, preorder_use_base_price
                          FROM products
                          WHERE company_id = ? AND sale_mode IN ('preorder_only', 'both')
                          ORDER BY name ASC`,
                    args: [activeCompanyId]
                });
                // Actualizar Dexie con productos preorder (upsert)
                try {
                    const stamped = result.rows.map(r => ({ ...r, companyId: activeCompanyId }));
                    await localDb.products.bulkPut(stamped);
                } catch (dexErr) {
                    console.warn('No se pudo actualizar Dexie con preorder:', dexErr.message);
                }
                // Marcar timestamp de último refresco
                try {
                    localStorage.setItem(`_preTs_${activeCompanyId}`, String(Date.now()));
                } catch { /* noop */ }
                // Si la búsqueda actual coincide, actualizar caché de UI
                const products = filterAndFormat(result.rows);
                set({ _preorderCache: { key: cacheKey, products, ts: Date.now() } });
            } catch (e) {
                console.warn('Refresh preorder Turso falló:', e?.message);
            }
        };

        // 1) Caché en memoria
        if (_preorderCache.key === cacheKey && Date.now() - _preorderCache.ts < 5 * 60 * 1000) {
            // Si la última sincronización con Turso fue hace >5min, refrescar en background
            try {
                const lastSync = parseInt(localStorage.getItem(`_preTs_${activeCompanyId}`) || '0', 10);
                if (Date.now() - lastSync > 5 * 60 * 1000) refreshFromTurso();
            } catch { /* noop */ }
            return { success: true, products: _preorderCache.products };
        }

        // 2) DEXIE PRIMERO — siempre, instantáneo
        try {
            const all = await localDb.products
                .where('companyId').equals(activeCompanyId).toArray();
            if (all.length > 0) {
                const products = filterAndFormat(all);
                set({ _preorderCache: { key: cacheKey, products, ts: Date.now() } });

                // Refrescar Turso en background si la última sync fue hace >5min
                try {
                    const lastSync = parseInt(localStorage.getItem(`_preTs_${activeCompanyId}`) || '0', 10);
                    if (Date.now() - lastSync > 5 * 60 * 1000) refreshFromTurso();
                } catch { /* noop */ }

                return { success: true, products };
            }
        } catch (e) {
            console.warn('Dexie preorder lookup falló:', e?.message);
        }

        // 3) Sin datos locales: pedir a Turso (primera vez después de login)
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            return { success: false, error: 'Sin conexión y sin catálogo local' };
        }
        try {
            if (!get()._preorderIndexEnsured) {
                set({ _preorderIndexEnsured: true });
                turso.execute(
                    `CREATE INDEX IF NOT EXISTS idx_products_company_salemode
                     ON products(company_id, sale_mode)`
                ).catch(() => {});
            }
            const result = await turso.execute({
                sql: `SELECT id, name, sku, price, cost, image, category, unit,
                      sale_mode, is_offer, offer_price, allow_item_notes, price_ranges,
                      preorder_unit, preorder_billing_unit, preorder_price_per_kg,
                      preorder_gram_per_unit, preorder_use_base_price
                      FROM products
                      WHERE company_id = ? AND sale_mode IN ('preorder_only', 'both')
                      ORDER BY name ASC`,
                args: [activeCompanyId]
            });
            // Guardar en Dexie para próximas veces
            try {
                const stamped = result.rows.map(r => ({ ...r, companyId: activeCompanyId }));
                await localDb.products.bulkPut(stamped);
                localStorage.setItem(`_preTs_${activeCompanyId}`, String(Date.now()));
            } catch { /* noop */ }
            const products = filterAndFormat(result.rows);
            set({ _preorderCache: { key: cacheKey, products, ts: Date.now() } });
            return { success: true, products };
        } catch (e) {
            console.error('Error fetching preorderable products:', e);
            return { success: false, error: e.message };
        }
    },

    invalidatePreorderCache: () => set({ _preorderCache: { key: '', products: [], ts: 0 } }),

    getPreorderReports: async (startDate, endDate) => {
        const { activeCompanyId } = get();
        try {
            console.log("Generando reporte de VENTAS por encargo (solo entregados):", startDate, endDate);

            // REPORTE DE VENTAS POR ENCARGO — solo cuenta encargos ENTREGADOS.
            //
            // Reglas de negocio (definidas con el usuario 2026-05-22):
            //   · Un encargo es VENTA solo cuando status = 'delivered'.
            //   · Pendientes / confirmados / en preparación / listos = pipeline,
            //     NO son venta todavía → excluidos.
            //   · Cancelados (abono devuelto) = no es venta → excluidos.
            //   · Se filtra por delivered_at (fecha de ENTREGA real), no por
            //     created_at: un encargo creado ayer y entregado hoy es venta de hoy.
            //   · Montos REALES: real_total del encargo y real_total/real_weight_kg
            //     por item (lo que efectivamente se pesó y cobró), con fallback a
            //     los estimados para datos viejos sin real_*.
            //
            // delivered_at puede venir en formato ISO ('...T...Z') o con espacio,
            // por eso se filtra con SUBSTR(...,1,10) BETWEEN (parte fecha).
            const dateFilter = 'SUBSTR(__col__, 1, 10) BETWEEN ? AND ?';

            // 1. Resumen General (solo entregados)
            const summaryRes = await turso.execute({
                sql: `SELECT
                    COUNT(*) as total_orders,
                    SUM(COALESCE(real_total, total_amount)) as total_revenue,
                    SUM(deposit_amount) as total_deposits,
                    COUNT(*) as delivered_count,
                    AVG(COALESCE(real_total, total_amount)) as avg_ticket
                  FROM preorders
                  WHERE status = 'delivered'
                    AND ${dateFilter.replace('__col__', 'delivered_at')}
                    AND company_id = ?`,
                args: [startDate, endDate, activeCompanyId]
            });
            const summary = summaryRes.rows[0];

            // 2. Por Estado — solo hay 'delivered'. Se mantiene por compatibilidad
            //    con el componente (pie chart). Mostrará una sola porción.
            const byStatus = [{
                status: 'delivered',
                count: summary?.total_orders || 0,
                total: summary?.total_revenue || 0,
            }];

            // 3. Por Producto (Top Productos vendidos por encargo) — montos reales
            const byProductRes = await turso.execute({
                sql: `SELECT
                    p.name,
                    p.sku,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty)) as quantity,
                    pi.billing_unit,
                    SUM(COALESCE(pi.real_total, pi.line_total)) as revenue,
                    SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty) * COALESCE(p.original_price, 0)) as approximate_cost
                  FROM preorder_items pi
                  JOIN preorders po ON pi.preorder_id = po.id
                  JOIN products p ON pi.product_id = p.id
                  WHERE po.status = 'delivered'
                    AND ${dateFilter.replace('__col__', 'po.delivered_at')}
                    AND po.company_id = ?
                  GROUP BY pi.product_id
                  ORDER BY revenue DESC`,
                args: [startDate, endDate, activeCompanyId]
            });
            const byProduct = byProductRes.rows.map(p => ({
                ...p,
                profit: (p.revenue || 0) - (p.approximate_cost || 0)
            }));

            // 4. Por Cliente (Top Clientes por encargo) — montos reales
            const byClientRes = await turso.execute({
                sql: `SELECT
                    po.client_id,
                    po.client_name,
                    MAX(po.client_phone) as phone,
                    COUNT(*) as orders_count,
                    SUM(COALESCE(po.real_total, po.total_amount)) as total_spend,
                    MAX(po.delivered_at) as last_order_date
                  FROM preorders po
                  WHERE po.status = 'delivered'
                    AND ${dateFilter.replace('__col__', 'po.delivered_at')}
                    AND po.company_id = ?
                  GROUP BY COALESCE(po.client_id, po.client_name)
                  ORDER BY total_spend DESC
                  LIMIT 100`,
                args: [startDate, endDate, activeCompanyId]
            });
            const byClient = byClientRes.rows;

            // 5. Detalles (lista completa de ventas entregadas)
            const detailsRes = await turso.execute({
                sql: `SELECT
                    po.id, po.created_at, po.delivered_at, po.due_date, po.status,
                    po.client_name,
                    COALESCE(po.real_total, po.total_amount) as total_amount,
                    po.deposit_amount,
                    (SELECT GROUP_CONCAT(p.name || ' (' || COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty) || ')', ', ')
                     FROM preorder_items pi JOIN products p ON pi.product_id = p.id
                     WHERE pi.preorder_id = po.id) as items_summary
                  FROM preorders po
                  WHERE po.status = 'delivered'
                    AND ${dateFilter.replace('__col__', 'po.delivered_at')}
                    AND po.company_id = ?
                  ORDER BY po.delivered_at DESC`,
                args: [startDate, endDate, activeCompanyId]
            });
            const details = detailsRes.rows;

            return {
                success: true,
                summary,
                byStatus,
                byProduct,
                byClient,
                details
            };

        } catch (e) {
            console.error("Error generating preorder reports:", e);
            return { success: false, error: e.message };
        }
    },

    // Dashboard de inteligencia de encargos (Pedidos → Historial).
    // Eje temporal: due_date (fecha de ENTREGA del encargo) — matchea con
    // Producción y con la operativa de la panadería ("¿qué fue para hoy?").
    // Responde: cuántos encargos eran para el período, qué pasó con ellos
    // (entregado/cancelado/en proceso), cuánto se vendió, medios de pago,
    // días pico, productos/clientes top, y crecimiento vs el período anterior.
    // due_date se guarda como 'YYYY-MM-DD' → comparación directa sin SUBSTR.
    getPreorderAnalytics: async (startDate, endDate) => {
        const { activeCompanyId } = get();
        try {
            // due_date es string 'YYYY-MM-DD' → BETWEEN directo, sin SUBSTR.
            const df = '__col__ BETWEEN ? AND ?';

            // Período anterior equivalente (misma duración, justo antes) para growth.
            const sd = new Date(`${startDate}T00:00:00Z`);
            const ed = new Date(`${endDate}T00:00:00Z`);
            const days = Math.max(0, Math.round((ed - sd) / 86400000)) + 1;
            const prevEnd = new Date(sd.getTime() - 86400000);
            const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
            const iso = (d) => d.toISOString().slice(0, 10);
            const prevStartStr = iso(prevStart);
            const prevEndStr = iso(prevEnd);

            const [
                statusRes, moneyRes, payRes, dailyRes, productRes, clientRes, prevRes
            ] = await turso.batch([
                // 1. Conteo + monto por estado (para el círculo de %)
                {
                    sql: `SELECT status, COUNT(*) as count,
                            SUM(COALESCE(real_total, total_amount)) as amount
                          FROM preorders
                          WHERE ${df.replace('__col__', 'due_date')} AND company_id = ?
                          GROUP BY status`,
                    args: [startDate, endDate, activeCompanyId]
                },
                // 2. Resumen de dinero
                {
                    sql: `SELECT
                            COUNT(*) as total_orders,
                            SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered_count,
                            SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) as canceled_count,
                            SUM(CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN 1 ELSE 0 END) as inprocess_count,
                            SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue,
                            SUM(CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN COALESCE(estimated_total, total_amount) ELSE 0 END) as pipeline_value,
                            SUM(deposit_amount) as total_deposits,
                            AVG(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) END) as avg_ticket
                          FROM preorders
                          WHERE ${df.replace('__col__', 'due_date')} AND company_id = ?`,
                    args: [startDate, endDate, activeCompanyId]
                },
                // 3. Medios de pago (de pagos asociados a encargos entregados)
                {
                    sql: `SELECT pp.method, COUNT(DISTINCT pp.preorder_id) as orders, SUM(pp.amount) as total
                          FROM preorder_payments pp
                          JOIN preorders po ON pp.preorder_id = po.id
                          WHERE po.status = 'delivered'
                            AND ${df.replace('__col__', 'po.due_date')}
                            AND po.company_id = ?
                          GROUP BY pp.method
                          ORDER BY total DESC`,
                    args: [startDate, endDate, activeCompanyId]
                },
                // 4. Serie diaria por fecha de entrega: cuántos eran para cada día
                //    y cuántos efectivamente se entregaron (con ventas reales).
                {
                    sql: `SELECT due_date as day,
                            COUNT(*) as orders,
                            SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue,
                            SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered
                          FROM preorders
                          WHERE ${df.replace('__col__', 'due_date')} AND company_id = ?
                          GROUP BY due_date ORDER BY due_date`,
                    args: [startDate, endDate, activeCompanyId]
                },
                // 5. Productos más encargados (excluye cancelados = demanda real)
                {
                    sql: `SELECT p.name, p.sku, pi.billing_unit,
                            SUM(COALESCE(pi.real_weight_kg, pi.real_qty, pi.qty)) as quantity,
                            SUM(COALESCE(pi.real_total, pi.line_total)) as revenue,
                            COUNT(DISTINCT po.id) as orders
                          FROM preorder_items pi
                          JOIN preorders po ON pi.preorder_id = po.id
                          JOIN products p ON pi.product_id = p.id
                          WHERE po.status != 'canceled'
                            AND ${df.replace('__col__', 'po.due_date')}
                            AND po.company_id = ?
                          GROUP BY pi.product_id
                          ORDER BY quantity DESC
                          LIMIT 15`,
                    args: [startDate, endDate, activeCompanyId]
                },
                // 6. Top clientes (por monto entregado real)
                {
                    sql: `SELECT po.client_id, po.client_name,
                            MAX(po.client_phone) as phone,
                            COUNT(*) as orders_count,
                            SUM(CASE WHEN po.status='delivered' THEN 1 ELSE 0 END) as delivered_count,
                            SUM(CASE WHEN po.status='canceled' THEN 1 ELSE 0 END) as canceled_count,
                            SUM(CASE WHEN po.status='delivered' THEN COALESCE(po.real_total, po.total_amount) ELSE 0 END) as total_spend
                          FROM preorders po
                          WHERE ${df.replace('__col__', 'po.due_date')}
                            AND po.company_id = ?
                          GROUP BY COALESCE(po.client_id, po.client_name)
                          ORDER BY total_spend DESC
                          LIMIT 15`,
                    args: [startDate, endDate, activeCompanyId]
                },
                // 7. Período anterior (para growth)
                {
                    sql: `SELECT
                            COUNT(*) as total_orders,
                            SUM(CASE WHEN status='delivered' THEN COALESCE(real_total, total_amount) ELSE 0 END) as revenue
                          FROM preorders
                          WHERE ${df.replace('__col__', 'due_date')} AND company_id = ?`,
                    args: [prevStartStr, prevEndStr, activeCompanyId]
                }
            ]);

            const money = moneyRes.rows[0] || {};
            const totalOrders = Number(money.total_orders) || 0;
            const deliveredCount = Number(money.delivered_count) || 0;
            const canceledCount = Number(money.canceled_count) || 0;
            const inprocessCount = Number(money.inprocess_count) || 0;
            const revenue = Number(money.revenue) || 0;

            // Tasas: cumplimiento = entregados / (entregados + cancelados resueltos)
            const resolved = deliveredCount + canceledCount;
            const fulfillmentRate = resolved > 0 ? (deliveredCount / resolved) * 100 : 0;
            const cancellationRate = totalOrders > 0 ? (canceledCount / totalOrders) * 100 : 0;

            // Growth vs período anterior
            const prev = prevRes.rows[0] || {};
            const prevRevenue = Number(prev.revenue) || 0;
            const prevOrders = Number(prev.total_orders) || 0;
            const pct = (cur, prv) => {
                if (prv === 0) return cur > 0 ? 100 : 0;
                return ((cur - prv) / prv) * 100;
            };

            // Día pico (más encargos)
            const daily = dailyRes.rows.map(r => ({
                day: r.day,
                orders: Number(r.orders) || 0,
                delivered: Number(r.delivered) || 0,
                revenue: Number(r.revenue) || 0
            }));
            const peakDay = daily.reduce((max, d) => (d.orders > (max?.orders || 0) ? d : max), null);

            return {
                success: true,
                summary: {
                    totalOrders,
                    deliveredCount,
                    canceledCount,
                    inprocessCount,
                    revenue,
                    pipelineValue: Number(money.pipeline_value) || 0,
                    totalDeposits: Number(money.total_deposits) || 0,
                    avgTicket: Number(money.avg_ticket) || 0,
                    fulfillmentRate,
                    cancellationRate,
                },
                byStatus: statusRes.rows.map(r => ({
                    status: r.status,
                    count: Number(r.count) || 0,
                    amount: Number(r.amount) || 0
                })),
                byPaymentMethod: payRes.rows.map(r => ({
                    method: r.method,
                    orders: Number(r.orders) || 0,
                    total: Number(r.total) || 0
                })),
                daily,
                peakDay,
                byProduct: productRes.rows.map(r => ({
                    name: r.name,
                    sku: r.sku,
                    billing_unit: r.billing_unit,
                    quantity: Number(r.quantity) || 0,
                    revenue: Number(r.revenue) || 0,
                    orders: Number(r.orders) || 0
                })),
                byClient: clientRes.rows.map(r => ({
                    client_name: r.client_name,
                    phone: r.phone,
                    orders_count: Number(r.orders_count) || 0,
                    delivered_count: Number(r.delivered_count) || 0,
                    canceled_count: Number(r.canceled_count) || 0,
                    total_spend: Number(r.total_spend) || 0
                })),
                growth: {
                    revenueChange: pct(revenue, prevRevenue),
                    ordersChange: pct(totalOrders, prevOrders),
                    prevRevenue,
                    prevOrders,
                    prevStart: prevStartStr,
                    prevEnd: prevEndStr,
                }
            };
        } catch (e) {
            console.error("Error generating preorder analytics:", e);
            return { success: false, error: e.message };
        }
    },

    deliverPreorder: async (preorderId, itemWeights, paymentMethod = 'Efectivo', { terminalId = null, bankAccountId = null } = {}) => {
        try {
            // 1. Update each item with real_qty, real_weight_kg, real_total.
            //    · Productos por kg: total = real_weight_kg × price_per_kg.
            //      real_qty queda como conteo de unidades entregadas (tracking).
            //    · Productos por unidad: total = real_qty × unit_price.
            let realTotal = 0;
            for (const iw of itemWeights) {
                const realQty = iw.real_qty !== undefined && iw.real_qty !== null && iw.real_qty !== ''
                    ? Number(iw.real_qty)
                    : Number(iw.qty || 0);
                const realItemTotal = iw.billing_unit === 'kg'
                    ? (Number(iw.real_weight_kg) || 0) * (Number(iw.price_per_kg) || 0)
                    : realQty * (Number(iw.unit_price) || 0);
                realTotal += realItemTotal;

                await turso.execute({
                    sql: `UPDATE preorder_items SET real_qty = ?, real_weight_kg = ?, real_total = ? WHERE id = ?`,
                    args: [realQty, iw.real_weight_kg || null, realItemTotal, iw.id]
                });
            }

            // 2. Get total already paid (deposits)
            const paymentsRes = await turso.execute({
                sql: 'SELECT SUM(amount) as total_paid FROM preorder_payments WHERE preorder_id = ?',
                args: [preorderId]
            });
            const totalPaid = paymentsRes.rows[0]?.total_paid || 0;
            const balanceDue = Math.max(0, realTotal - totalPaid);

            // 3. Register final payment if there's balance due
            if (balanceDue > 0) {
                const regId = get().cashRegister?.id || null;
                const tId = paymentMethod === 'Tarjeta' ? (terminalId || null) : null;
                const baId = paymentMethod === 'Transferencia' ? (bankAccountId || null) : null;
                await turso.execute({
                    sql: `INSERT INTO preorder_payments (preorder_id, amount, method, type, register_id, terminal_id, bank_account_id) VALUES (?, ?, ?, 'final', ?, ?, ?)`,
                    args: [preorderId, balanceDue, paymentMethod, regId, tId, baId]
                });
                // Si el saldo se cobró en efectivo, sumarlo a la caja abierta.
                if (paymentMethod === 'Efectivo') {
                    await get()._registerPreorderCash({
                        amount: balanceDue,
                        reason: `Cobro encargo #${preorderId}`
                    });
                } else if (regId && (paymentMethod === 'Tarjeta' || paymentMethod === 'Transferencia')) {
                    get().refreshRegisterStats(regId);
                }
            }

            // 4. Update preorder with real total, mark as delivered.
            //    delivered_at marca cuándo se entregó (= cuándo se concretó la
            //    venta). El reporte de ventas por encargo filtra por esta fecha.
            await turso.execute({
                sql: `UPDATE preorders SET real_total = ?, total_amount = ?, remaining_amount = 0, deposit_amount = ?, status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
                args: [realTotal, realTotal, totalPaid, preorderId]
            });

            await get().fetchPreorders();
            return { success: true, realTotal, balanceDue };
        } catch (e) {
            console.error('Error delivering preorder:', e);
            return { success: false, error: e.message };
        }
    },

    // ==========================================
    // PAYMENT METHODS ACTIONS
    // ==========================================
    fetchPaymentMethodsSettings: async () => {
        const { activeCompanyId } = get();
        try {
            // 1. Config
            const configRes = await turso.execute({
                sql: "SELECT * FROM payment_methods_config WHERE company_id = ?",
                args: [activeCompanyId]
            });

            let config = configRes.rows[0];
            if (!config) {
                // Initialize default config if not exists
                await turso.execute({
                    sql: "INSERT INTO payment_methods_config (company_id) VALUES (?)",
                    args: [activeCompanyId]
                });
                config = {
                    company_id: activeCompanyId,
                    cash_enabled: 1,
                    card_enabled: 1,
                    transfer_enabled: 1,
                    credit_enabled: 1,
                    mixed_enabled: 1
                };
            }

            // 2. Terminals
            const terminalsRes = await turso.execute({
                sql: "SELECT * FROM payment_terminals WHERE company_id = ? AND is_active = 1",
                args: [activeCompanyId]
            });

            // 3. Bank Accounts
            const accountsRes = await turso.execute({
                sql: "SELECT * FROM bank_accounts WHERE company_id = ? AND is_active = 1",
                args: [activeCompanyId]
            });

            set({
                paymentMethodsConfig: config,
                paymentTerminals: terminalsRes.rows,
                bankAccounts: accountsRes.rows
            });

            return { success: true };
        } catch (e) {
            console.error("Error fetching payment settings:", e);
            return { success: false, error: e.message };
        }
    },

    togglePaymentMethod: async (method, isEnabled) => {
        const { activeCompanyId, paymentMethodsConfig } = get();
        const fieldMap = {
            'cash': 'cash_enabled',
            'card': 'card_enabled',
            'transfer': 'transfer_enabled',
            'credit': 'credit_enabled',
            'mixed': 'mixed_enabled'
        };
        const dbField = fieldMap[method];
        if (!dbField) return;

        try {
            await turso.execute({
                sql: `UPDATE payment_methods_config SET ${dbField} = ? WHERE company_id = ?`,
                args: [isEnabled ? 1 : 0, activeCompanyId]
            });

            set({
                paymentMethodsConfig: {
                    ...paymentMethodsConfig,
                    [dbField]: isEnabled ? 1 : 0
                }
            });
            return { success: true };
        } catch (e) {
            console.error("Error toggling payment method:", e);
            return { success: false, error: e.message };
        }
    },

    addPaymentTerminal: async (terminalData) => {
        const { activeCompanyId, paymentTerminals } = get();
        try {
            // First check if column color exists (migration on the fly for old concept)
            // But since this is new, we assume create table is correct or alter if needed.
            // Let's just do the insert. If code column exists it will error if we don't provide it? No, code was there.
            // We are changing 'code' to 'color'.
            // For safety let's ensure the table structure.

            try {
                // Quick migration check
                const info = await turso.execute("PRAGMA table_info(payment_terminals)");
                const hasColor = info.rows.some(col => col.name === 'color');
                if (!hasColor) {
                    await turso.execute("ALTER TABLE payment_terminals ADD COLUMN color TEXT DEFAULT '#3B82F6'");
                }
            } catch (e) { console.warn("Terminal migration check fail", e); }

            const res = await turso.execute({
                sql: "INSERT INTO payment_terminals (company_id, name, color, created_at) VALUES (?, ?, ?, ?) RETURNING *",
                args: [activeCompanyId, terminalData.name, terminalData.color || '#3B82F6', new Date().toISOString()]
            });
            const newTerminal = res.rows[0];
            set({ paymentTerminals: [...paymentTerminals, newTerminal] });
            return { success: true };
        } catch (e) {
            console.error("Error adding terminal:", e);
            return { success: false, error: e.message };
        }
    },

    updatePaymentTerminal: async (id, terminalData) => {
        const { paymentTerminals } = get();
        try {
            await turso.execute({
                sql: "UPDATE payment_terminals SET name = ?, color = ? WHERE id = ?",
                args: [terminalData.name, terminalData.color || '#3B82F6', id]
            });
            const updatedTerminals = paymentTerminals.map(t =>
                t.id === id ? { ...t, name: terminalData.name, color: terminalData.color || '#3B82F6' } : t
            );
            set({ paymentTerminals: updatedTerminals });
            return { success: true };
        } catch (e) {
            console.error("Error updating terminal:", e);
            return { success: false, error: e.message };
        }
    },

    deletePaymentTerminal: async (id) => {
        const { activeCompanyId, paymentTerminals } = get();
        try {
            await turso.execute({
                sql: "UPDATE payment_terminals SET is_active = 0 WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });
            set({ paymentTerminals: paymentTerminals.filter(t => t.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting terminal:", e);
            return { success: false, error: e.message };
        }
    },

    addBankAccount: async (accountData) => {
        const { activeCompanyId, bankAccounts } = get();
        try {
            const res = await turso.execute({
                sql: `INSERT INTO bank_accounts 
                      (company_id, bank_name, account_number, account_type, owner_name, rut, email, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
                args: [
                    activeCompanyId,
                    accountData.bank_name,
                    accountData.account_number,
                    accountData.account_type,
                    accountData.owner_name,
                    accountData.rut,
                    accountData.email,
                    new Date().toISOString()
                ]
            });
            const newAccount = res.rows[0];
            set({ bankAccounts: [...bankAccounts, newAccount] });
            return { success: true };
        } catch (e) {
            console.error("Error adding bank account:", e);
            return { success: false, error: e.message };
        }
    },

    updateBankAccount: async (id, accountData) => {
        const { bankAccounts } = get();
        try {
            await turso.execute({
                sql: "UPDATE bank_accounts SET bank_name = ?, account_number = ?, account_type = ?, owner_name = ?, rut = ?, email = ? WHERE id = ?",
                args: [
                    accountData.bank_name,
                    accountData.account_number,
                    accountData.account_type,
                    accountData.owner_name,
                    accountData.rut,
                    accountData.email,
                    id
                ]
            });

            const updatedAccounts = bankAccounts.map(a =>
                a.id === id ? { ...a, ...accountData } : a
            );
            set({ bankAccounts: updatedAccounts });
            return { success: true };
        } catch (e) {
            console.error("Error updating bank account:", e);
            return { success: false, error: e.message };
        }
    },

    deleteBankAccount: async (id) => {
        const { activeCompanyId, bankAccounts } = get();
        try {
            await turso.execute({
                sql: "UPDATE bank_accounts SET is_active = 0 WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });
            set({ bankAccounts: bankAccounts.filter(a => a.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting bank account:", e);
            return { success: false, error: e.message };
        }
    },


    // ==========================================
    // 👷 GESTIÓN LABORAL: FUNCIONES
    // ==========================================

    // --- 1. Gestión de Personal (Ficha Laboral) ---

    // Obtener lista de empleados (usuarios con perfil laboral activo)
    fetchStaffMembers: async () => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT * FROM users 
                      WHERE company_id = ? AND has_labor_profile = 1 
                      ORDER BY labor_status ASC, username ASC`,
                args: [activeCompanyId]
            });
            set({ staffMembers: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching staff:", e);
            throw e;
        }
    },

    // Actualizar datos de ficha laboral y configuración de pago
    updateLaborProfile: async (userId, data) => {
        try {
            // Construir query dinámico
            const fields = Object.keys(data).map(key => `${key} = ?`).join(', ');
            const values = Object.values(data);

            await turso.execute({
                sql: `UPDATE users SET ${fields} WHERE id = ?`,
                args: [...values, userId]
            });

            // Actualizar estado local si el usuario está en staffMembers
            const { staffMembers } = get();
            const updatedStaff = staffMembers.map(u =>
                u.id === userId ? { ...u, ...data } : u
            );
            set({ staffMembers: updatedStaff });

            return { success: true };
        } catch (e) {
            console.error("Error updating labor profile:", e);
            return { success: false, error: e.message };
        }
    },

    // Activar/Desactivar perfil laboral (convertir usuario en empleado)
    toggleLaborProfile: async (userId, enable) => {
        try {
            await turso.execute({
                sql: "UPDATE users SET has_labor_profile = ? WHERE id = ?",
                args: [enable ? 1 : 0, userId]
            });

            // Recargar lista de empleados
            get().fetchStaffMembers();
            // Recargar lista de usuarios general
            // get().fetchUsers(); // Si existe, recargarla también

            return { success: true };
        } catch (e) {
            console.error("Error toggling labor profile:", e);
            return { success: false, error: e.message };
        }
    },

    // Buscar empleado por PIN (para Kiosco)
    getLaborProfileByPin: async (pin, companyId = null) => {
        const targetCompany = companyId || get().activeCompanyId;
        try {
            const result = await turso.execute({
                sql: `SELECT * FROM users 
                      WHERE (company_id = ? OR company_id = 'default') 
                      AND has_labor_profile = 1 
                      AND labor_pin = ? 
                      AND labor_status = 'active'`,
                args: [targetCompany, pin]
            });

            if (result.rows.length > 0) {
                return result.rows[0];
            }
            return null;
        } catch (e) {
            console.error("Error finding user by PIN:", e);
            return null;
        }
    },

    // --- 2. Asistencia ---

    fetchAttendanceToday: async () => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        // Use local date in company timezone, not UTC
        const today = formatInCompanyTime(new Date(), currentCompanyTimezone, 'yyyy-MM-dd');
        try {
            const result = await turso.execute({
                sql: `SELECT ar.*, u.username, u.name 
                      FROM attendance_records ar
                      JOIN users u ON ar.user_id = u.id
                      WHERE ar.company_id = ? AND ar.date = ?
                      ORDER BY ar.recorded_at ASC`,
                args: [activeCompanyId, today]
            });

            // Group by user_id and pair entry/exit
            const grouped = {};
            for (const row of result.rows) {
                const key = row.user_id;
                if (!grouped[key]) {
                    grouped[key] = {
                        id: row.id,
                        user_id: row.user_id,
                        username: row.username,
                        name: row.name,
                        date: row.date,
                        check_in: null,
                        check_out: null,
                        branch: row.branch || null,
                        notes: row.notes || null,
                        source: row.source,
                    };
                }
                if (row.type === 'entry' && !grouped[key].check_in) {
                    grouped[key].check_in = row.recorded_at;
                    if (row.branch) grouped[key].branch = row.branch;
                }
                if (row.type === 'exit') {
                    grouped[key].check_out = row.recorded_at;
                }
                if (row.notes) grouped[key].notes = row.notes;
            }

            set({ attendanceToday: Object.values(grouped) });
        } catch (e) {
            console.error("Error fetching attendance today:", e);
        }
    },

    fetchAttendanceByRange: async (startDate, endDate, userId = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT ar.*, u.username, u.name 
                       FROM attendance_records ar
                       JOIN users u ON ar.user_id = u.id
                       WHERE ar.company_id = ? AND ar.date BETWEEN ? AND ?`;
            const args = [activeCompanyId, startDate, endDate];

            if (userId) {
                sql += ` AND ar.user_id = ?`;
                args.push(userId);
            }

            sql += ` ORDER BY ar.date DESC, ar.recorded_at DESC`;

            const result = await turso.execute({ sql, args });
            const rows = result.rows;

            // Group by user_id + date and pair entry/exit into single records
            const grouped = {};
            for (const row of rows) {
                const key = `${row.user_id}_${row.date}`;
                if (!grouped[key]) {
                    grouped[key] = {
                        id: row.id,
                        user_id: row.user_id,
                        username: row.username,
                        name: row.name,
                        date: row.date,
                        check_in: null,
                        check_out: null,
                        branch: row.branch || null,
                        notes: row.notes || null,
                        source: row.source,
                    };
                }
                if (row.type === 'entry' && !grouped[key].check_in) {
                    grouped[key].check_in = row.recorded_at;
                    if (row.branch) grouped[key].branch = row.branch;
                }
                if (row.type === 'exit' && !grouped[key].check_out) {
                    grouped[key].check_out = row.recorded_at;
                }
                if (row.notes) grouped[key].notes = row.notes;
            }

            // Convert to array sorted by date desc
            return Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date));
        } catch (e) {
            console.error("Error fetching attendance range:", e);
            throw e;
        }
    },

    fetchAttendanceByRangeRaw: async (startDate, endDate, userId = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT ar.*, u.username, u.name 
                       FROM attendance_records ar
                       JOIN users u ON ar.user_id = u.id
                       WHERE ar.company_id = ? AND ar.date BETWEEN ? AND ?`;
            const args = [activeCompanyId, startDate, endDate];
            if (userId) {
                sql += ` AND ar.user_id = ?`;
                args.push(userId);
            }
            sql += ` ORDER BY ar.date DESC, ar.recorded_at DESC`;
            const result = await turso.execute({ sql, args });
            return result.rows;
        } catch (e) {
            console.error("Error fetching raw attendance range:", e);
            throw e;
        }
    },

    markAttendance: async (userId, type, deviceLabel, branch) => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        const now = new Date();
        const recordedAt = now.toISOString();
        // Use local date in company timezone, not UTC
        const date = formatInCompanyTime(now, currentCompanyTimezone, 'yyyy-MM-dd');

        try {
            // Lógica automática: verificar último estado
            const lastRecordRes = await turso.execute({
                sql: `SELECT * FROM attendance_records 
                      WHERE company_id = ? AND user_id = ? AND date = ? 
                      ORDER BY recorded_at DESC LIMIT 1`,
                args: [activeCompanyId, userId, date]
            });

            const lastRecord = lastRecordRes.rows[0];
            let finalType = type; // 'entry' o 'exit' o 'auto'

            if (type === 'auto') {
                if (!lastRecord) {
                    finalType = 'entry';
                } else if (lastRecord.type === 'entry') {
                    finalType = 'exit';
                } else {
                    // Ya salió, ¿permitir reingreso? Por ahora asumimos jornada simple.
                    // O podría ser turno partido. Permitamos reingreso.
                    finalType = 'entry';
                }
            } else {
                // Validación explícita
                if (type === 'entry' && lastRecord?.type === 'entry') {
                    throw new Error("Ya tienes una entrada registrada sin salida.");
                }
                if (type === 'exit' && (!lastRecord || lastRecord.type === 'exit')) {
                    throw new Error("No tienes una entrada registrada para salir.");
                }
            }

            await turso.execute({
                sql: `INSERT INTO attendance_records 
                      (company_id, user_id, type, recorded_at, date, source, device_label, branch) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [activeCompanyId, userId, finalType, recordedAt, date, 'kiosk', deviceLabel, branch]
            });

            // Actualizar vista local si es hoy
            get().fetchAttendanceToday();

            return { success: true, type: finalType, recordedAt };
        } catch (e) {
            console.error("Error marking attendance:", e);
            return { success: false, error: e.message };
        }
    },

    registerManualAttendance: async (userId, type, datetime, notes, recordedBy) => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        // Use local date in company timezone
        const date = formatInCompanyTime(new Date(datetime), currentCompanyTimezone, 'yyyy-MM-dd');

        try {
            await turso.execute({
                sql: `INSERT INTO attendance_records 
                      (company_id, user_id, type, recorded_at, date, source, notes, recorded_by) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [activeCompanyId, userId, type, datetime, date, 'manual', notes, recordedBy]
            });

            get().fetchAttendanceToday();
            return { success: true };
        } catch (e) {
            console.error("Error registering manual attendance:", e);
            return { success: false, error: e.message };
        }
    },

    getAttendanceStatus: async (userId) => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        const today = formatInCompanyTime(new Date(), currentCompanyTimezone, 'yyyy-MM-dd');
        try {
            const result = await turso.execute({
                sql: `SELECT type FROM attendance_records 
                      WHERE company_id = ? AND user_id = ? AND date = ? 
                      ORDER BY recorded_at DESC LIMIT 1`,
                args: [activeCompanyId, userId, today]
            });

            if (result.rows.length === 0) return 'not_marked';
            return result.rows[0].type === 'entry' ? 'inside' : 'outside';
        } catch (e) {
            console.error("Error getting status:", e);
            return 'unknown';
        }
    },

    // --- 3. Correcciones de Asistencia ---

    fetchPendingCorrections: async () => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT ac.*, u.username, u.name 
                      FROM attendance_corrections ac
                      JOIN users u ON ac.user_id = u.id
                      WHERE ac.company_id = ? AND ac.status = 'pending'
                      ORDER BY ac.created_at DESC`,
                args: [activeCompanyId]
            });
            set({ pendingCorrections: result.rows });
        } catch (e) {
            console.error("Error fetching corrections:", e);
        }
    },

    fetchCorrectionsByStatus: async (status) => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT ac.*, u.username, u.name, r.username as reviewer_name
                      FROM attendance_corrections ac
                      JOIN users u ON ac.user_id = u.id
                      LEFT JOIN users r ON ac.reviewed_by = r.id
                      WHERE ac.company_id = ? AND ac.status = ?
                      ORDER BY ac.created_at DESC`,
                args: [activeCompanyId, status]
            });
            return result.rows;
        } catch (e) {
            console.error("Error fetching corrections by status:", e);
            return [];
        }
    },

    requestCorrection: async (data) => {
        const { activeCompanyId, currentUser } = get();
        // data: { user_id, original_record_id, correction_type, original_at, requested_at, requested_date, reason }
        try {
            await turso.execute({
                sql: `INSERT INTO attendance_corrections 
                      (company_id, user_id, original_record_id, correction_type, original_at, requested_at, requested_date, reason, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    data.user_id || currentUser.id,
                    data.original_record_id,
                    data.correction_type,
                    data.original_at,
                    data.requested_at,
                    data.requested_date,
                    data.reason,
                    new Date().toISOString()
                ]
            });
            // Si es admin quien pide, ¿se autoaprueba? Por ahora dejemos flujo normal.
            return { success: true };
        } catch (e) {
            console.error("Error requesting correction:", e);
            return { success: false, error: e.message };
        }
    },

    approveCorrection: async (correctionId, reviewerNotes, reviewedBy) => {
        const { activeCompanyId } = get();
        const now = new Date().toISOString();
        try {
            // 1. Obtener datos de la corrección
            const corrRes = await turso.execute({
                sql: "SELECT * FROM attendance_corrections WHERE id = ?",
                args: [correctionId]
            });
            const correction = corrRes.rows[0];
            if (!correction) throw new Error("Correction not found");

            // 2. Aplicar cambios en attendance_records según tipo
            if (correction.correction_type === 'edit_time') {
                // Marcar original como corregido (soft delete o flag)
                if (correction.original_record_id) {
                    await turso.execute({
                        sql: "UPDATE attendance_records SET is_corrected = 1 WHERE id = ?",
                        args: [correction.original_record_id]
                    });

                    // Obtener datos del original para replicar resto de campos (type, source, device)
                    // ... Simplificación: crear nuevo registro "manual" con la hora corregida
                    const origRes = await turso.execute("SELECT * FROM attendance_records WHERE id = ?", [correction.original_record_id]);
                    const orig = origRes.rows[0];

                    await turso.execute({
                        sql: `INSERT INTO attendance_records 
                              (company_id, user_id, type, recorded_at, date, source, notes, is_corrected, recorded_by) 
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [
                            activeCompanyId,
                            correction.user_id,
                            orig.type,
                            correction.requested_at, // La nueva hora 
                            orig.date,
                            'manual',
                            `Corrección aprobada: ${correction.reason}`,
                            0,
                            reviewedBy
                        ]
                    });
                }
            } else if (correction.correction_type === 'add_entry' || correction.correction_type === 'add_exit') {
                const type = correction.correction_type === 'add_entry' ? 'entry' : 'exit';
                await turso.execute({
                    sql: `INSERT INTO attendance_records 
                          (company_id, user_id, type, recorded_at, date, source, notes, recorded_by) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [
                        activeCompanyId,
                        correction.user_id,
                        type,
                        correction.requested_at,
                        correction.requested_date,
                        'manual',
                        `Corrección (Agregar): ${correction.reason}`,
                        reviewedBy
                    ]
                });
            } else if (correction.correction_type === 'delete') {
                if (correction.original_record_id) {
                    await turso.execute({
                        sql: "UPDATE attendance_records SET is_corrected = 1 WHERE id = ?",
                        args: [correction.original_record_id]
                    });
                }
            }

            // 3. Actualizar estado de la solicitud
            await turso.execute({
                sql: `UPDATE attendance_corrections 
                      SET status = 'approved', reviewed_by = ?, reviewed_at = ?, reviewer_notes = ? 
                      WHERE id = ?`,
                args: [reviewedBy, now, reviewerNotes, correctionId]
            });

            // Refrescar datos
            get().fetchPendingCorrections();
            get().fetchAttendanceToday(); // Por si afecta hoy

            return { success: true };
        } catch (e) {
            console.error("Error approving correction:", e);
            return { success: false, error: e.message };
        }
    },

    rejectCorrection: async (correctionId, reviewerNotes, reviewedBy) => {
        const now = new Date().toISOString();
        try {
            await turso.execute({
                sql: `UPDATE attendance_corrections 
                      SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, reviewer_notes = ? 
                      WHERE id = ?`,
                args: [reviewedBy, now, reviewerNotes, correctionId]
            });
            get().fetchPendingCorrections();
            return { success: true };
        } catch (e) {
            console.error("Error rejecting correction:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 4. Turnos Planificados ---

    fetchShifts: async (weekStart, weekEnd, userId = null) => {
        const { activeCompanyId } = get();
        try {
            const startDate = String(weekStart).split('T')[0];
            const endDate = String(weekEnd).split('T')[0];
            let sql = `SELECT ws.*, u.username, u.name 
                       FROM work_shifts ws
                       JOIN users u ON ws.user_id = u.id
                       WHERE ws.company_id = ? AND ws.shift_date BETWEEN ? AND ?`;
            const args = [activeCompanyId, startDate, endDate];

            if (userId) {
                sql += ` AND ws.user_id = ?`;
                args.push(userId);
            }

            const result = await turso.execute({ sql, args });
            set({ workShifts: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching shifts:", e);
            return [];
        }
    },

    createShift: async (data) => {
        const { activeCompanyId, currentUser } = get();
        try {
            const shiftDate = data.shift_date || data.start_time.split('T')[0];
            const notes = data.notes || '';
            const branch = data.branch || 'Principal'; // Default branch?
            const createdByUser = currentUser ? currentUser.username : 'System';

            // INSERT OR REPLACE para manejar restricción UNIQUE(user_id, shift_date)
            await turso.execute({
                sql: `INSERT OR REPLACE INTO work_shifts 
                      (company_id, user_id, shift_date, start_time, end_time, branch, notes, created_by, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    data.user_id,
                    shiftDate,
                    data.start_time,
                    data.end_time,
                    branch,
                    notes,
                    createdByUser,
                    new Date().toISOString()
                ]
            });
            return { success: true };
        } catch (e) {
            console.error("Error creating shift:", e);
            return { success: false, error: e.message };
        }
    },

    deleteShift: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM work_shifts WHERE id = ?",
                args: [id]
            });
            // Actualizar localmente
            const { workShifts } = get();
            set({ workShifts: workShifts.filter(s => s.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting shift:", e);
            return { success: false, error: e.message };
        }
    },

    deleteShiftByDate: async (userId, shiftDate) => {
        try {
            const { activeCompanyId } = get();
            await turso.execute({
                sql: "DELETE FROM work_shifts WHERE user_id = ? AND shift_date = ? AND company_id = ?",
                args: [userId, shiftDate, activeCompanyId]
            });
            const { workShifts } = get();
            set({ workShifts: workShifts.filter(s => !(String(s.user_id) === String(userId) && s.shift_date === shiftDate)) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting shift by date:", e);
            return { success: false, error: e.message };
        }
    },

    copyPreviousWeek: async (currentWeekStart, previousWeekStart, userId = null) => {
        const { activeCompanyId, currentUser } = get();
        // currentWeekStart: fecha inicio de la semana destino (Lunes)
        // previousWeekStart: fecha inicio de semana origen
        // Esto es complejo en SQL puro si las fechas cambian (obvio).
        // Lógica JS: Fetch previous -> Calculate new dates -> Insert batch
        try {
            // 1. Fetch previous week shifts
            // Calcular end dates (assuming 7 days)
            const prevEnd = new Date(new Date(previousWeekStart).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            let sql = `SELECT * FROM work_shifts WHERE company_id = ? AND shift_date BETWEEN ? AND ?`;
            const args = [activeCompanyId, previousWeekStart, prevEnd];
            if (userId) {
                sql += ` AND user_id = ?`;
                args.push(userId);
            }
            const prevShiftsRes = await turso.execute({ sql, args });
            const prevShifts = prevShiftsRes.rows;

            if (prevShifts.length === 0) return { success: true, count: 0 };

            // 2. Map to new dates
            // Diff en días entre semanas suele ser 7
            const dayDiff = (new Date(currentWeekStart) - new Date(previousWeekStart)) / (1000 * 60 * 60 * 24);

            const newShifts = prevShifts.map(s => {
                const oldDate = new Date(s.shift_date);
                const newDate = new Date(oldDate.getTime() + dayDiff * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

                // Update start_time and end_time
                const oldStart = new Date(s.start_time);
                const newStart = new Date(oldStart.getTime() + dayDiff * 24 * 60 * 60 * 1000).toISOString();

                const oldEnd = new Date(s.end_time);
                const newEnd = new Date(oldEnd.getTime() + dayDiff * 24 * 60 * 60 * 1000).toISOString();

                return {
                    ...s,
                    shift_date: newDate,
                    start_time: newStart,
                    end_time: newEnd
                };
            });

            // 3. Batch insert
            for (const s of newShifts) {
                await get().createShift(s, currentUser.id);
            }

            return { success: true, count: newShifts.length };

        } catch (e) {
            console.error("Error copying week:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 5. Ausencias ---

    fetchAbsences: async (startDate, endDate, userId = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT la.*, la.absence_date as start_date, la.absence_date as end_date, u.username, u.name 
                       FROM labor_absences la
                       JOIN users u ON la.user_id = u.id
                       WHERE la.company_id = ? AND la.absence_date BETWEEN ? AND ?`;
            const args = [activeCompanyId, startDate, endDate];

            if (userId) {
                sql += ` AND la.user_id = ?`;
                args.push(userId);
            }

            sql += ' ORDER BY la.absence_date DESC';
            const result = await turso.execute({ sql, args });
            set({ laborAbsences: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching absences:", e);
            return [];
        }
    },

    createAbsence: async (data) => {
        const { activeCompanyId, currentUser, fetchAttendanceByRangeRaw } = get();
        try {
            const createdByUser = currentUser ? currentUser.username : 'System';
            const startDate = data.start_date || data.absence_date || new Date().toISOString().split('T')[0];
            const endDate = data.end_date || startDate;
            const notes = data.notes || data.reason || '';
            const halfDay = data.half_day ? 1 : 0;
            const halfDayPeriod = data.half_day ? (data.half_day_period || 'morning') : null;
            const hours = data.hours || null;
            const groupId = `abs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            // Generate all dates in range
            const dates = [];
            let current = new Date(`${startDate}T12:00:00`);
            const end = new Date(`${endDate}T12:00:00`);
            while (current <= end) {
                dates.push(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
            }

            if (!dates.length) return { success: false, error: 'Rango de fechas inválido' };

            // Validation: check for existing absences on those dates
            const existingCheck = await turso.execute({
                sql: `SELECT absence_date FROM labor_absences WHERE company_id = ? AND user_id = ? AND absence_date IN (${dates.map(() => '?').join(',')})`,
                args: [activeCompanyId, data.user_id, ...dates]
            });
            if (existingCheck.rows.length > 0) {
                const dupes = existingCheck.rows.map(r => r.absence_date).join(', ');
                return { success: false, error: `Ya existe ausencia en: ${dupes}` };
            }

            // Validation: check days with real attendance (block if already clocked in on non-half-day)
            if (!halfDay) {
                const attendance = await fetchAttendanceByRangeRaw(startDate, endDate);
                const attendedDates = attendance
                    .filter(a => String(a.user_id) === String(data.user_id) && a.type === 'entry')
                    .map(a => a.date);
                const uniqueAttended = [...new Set(attendedDates)];
                if (uniqueAttended.length > 0) {
                    return { success: false, error: `No se puede registrar ausencia completa en días con asistencia: ${uniqueAttended.join(', ')}` };
                }
            }

            // Insert one record per day
            const queries = dates.map(d => ({
                sql: `INSERT INTO labor_absences 
                      (company_id, user_id, absence_date, type, status, notes, approved_by, created_at, half_day, half_day_period, hours, group_id) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    data.user_id,
                    d,
                    data.type,
                    data.status || 'approved',
                    notes,
                    createdByUser,
                    new Date().toISOString(),
                    halfDay,
                    halfDayPeriod,
                    hours,
                    groupId
                ]
            }));

            // Batch insert
            const CHUNK = 50;
            for (let i = 0; i < queries.length; i += CHUNK) {
                await turso.batch(queries.slice(i, i + CHUNK));
            }

            return { success: true, count: dates.length, groupId };
        } catch (e) {
            console.error("Error creating absence:", e);
            return { success: false, error: e.message };
        }
    },

    deleteAbsence: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM labor_absences WHERE id = ?",
                args: [id]
            });
            // Actualizar local
            const { laborAbsences } = get();
            set({ laborAbsences: laborAbsences.filter(a => a.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting absence:", e);
            return { success: false, error: e.message };
        }
    },

    deleteAbsenceGroup: async (groupId) => {
        try {
            if (!groupId) return { success: false, error: 'No group_id' };
            const { activeCompanyId } = get();
            await turso.execute({
                sql: "DELETE FROM labor_absences WHERE group_id = ? AND company_id = ?",
                args: [groupId, activeCompanyId]
            });
            const { laborAbsences } = get();
            set({ laborAbsences: laborAbsences.filter(a => a.group_id !== groupId) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting absence group:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 6. Configuración de Personal ---

    fetchPersonalConfig: async () => {
        const { activeCompanyId } = get();
        try {
            let result = await turso.execute({
                sql: "SELECT * FROM personal_config WHERE company_id = ?",
                args: [activeCompanyId]
            });

            if (result.rows.length === 0) {
                // Crear default si no existe
                await turso.execute({
                    sql: "INSERT INTO personal_config (company_id, late_tolerance_minutes, created_at) VALUES (?, ?, ?)",
                    args: [activeCompanyId, 10, new Date().toISOString()]
                });
                result = await turso.execute({
                    sql: "SELECT * FROM personal_config WHERE company_id = ?",
                    args: [activeCompanyId]
                });
            }

            set({ personalConfig: result.rows[0] });
            return result.rows[0];
        } catch (e) {
            console.error("Error fetching personal config:", e);
            return null;
        }
    },

    updatePersonalConfig: async (data) => {
        const { activeCompanyId } = get();
        try {
            const fields = [
                'late_tolerance_minutes', 'kiosk_device_label',
                'late_discount_enabled', 'late_discount_per_minute',
                'absence_discount_enabled', 'vacation_paid', 'medical_paid', 'permission_paid',
                'bonus_punctuality_enabled', 'bonus_punctuality_amount',
                'bonus_attendance_enabled', 'bonus_attendance_amount',
                'working_days_per_month', 'working_hours_per_day'
            ];
            const setClauses = [];
            const args = [];
            for (const f of fields) {
                if (data[f] !== undefined) {
                    setClauses.push(`${f} = ?`);
                    args.push(data[f]);
                }
            }
            if (setClauses.length === 0) return { success: true };
            setClauses.push('updated_at = ?');
            args.push(new Date().toISOString());
            args.push(activeCompanyId);

            await turso.execute({
                sql: `UPDATE personal_config SET ${setClauses.join(', ')} WHERE company_id = ?`,
                args
            });

            set({ personalConfig: { ...get().personalConfig, ...data } });
            return { success: true };
        } catch (e) {
            console.error("Error updating personal config:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 7. Adelantos ---

    fetchAdvances: async (userId = null, startDate = null, endDate = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT sa.*, u.username, u.name 
                       FROM salary_advances sa
                       JOIN users u ON sa.user_id = u.id
                       WHERE sa.company_id = ?`;
            const args = [activeCompanyId];

            if (userId) {
                sql += ` AND sa.user_id = ?`;
                args.push(userId);
            }
            if (startDate && endDate) {
                sql += ` AND sa.advance_date BETWEEN ? AND ?`;
                args.push(startDate, endDate);
            }

            sql += ` ORDER BY sa.advance_date DESC`;

            const result = await turso.execute({ sql, args });
            set({ salaryAdvances: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching advances:", e);
            return [];
        }
    },

    createAdvance: async (data) => {
        const { activeCompanyId, currentUser } = get();
        try {
            const createdByUser = currentUser ? currentUser.username : 'System';
            const payMethod = data.pay_method || 'transfer';
            const reason = data.reason || data.notes || '';
            const advanceDate = data.advance_date || data.date || new Date().toISOString().split('T')[0];

            await turso.execute({
                sql: `INSERT INTO salary_advances 
                      (company_id, user_id, amount, advance_date, reason, pay_method, status, created_by, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    data.user_id,
                    data.amount,
                    advanceDate,
                    reason,
                    payMethod,
                    'pending',
                    createdByUser,
                    new Date().toISOString()
                ]
            });
            return { success: true };
        } catch (e) {
            console.error("Error creating advance:", e);
            return { success: false, error: e.message };
        }
    },

    markAdvanceDiscounted: async (id, periodId) => {
        try {
            await turso.execute({
                sql: "UPDATE salary_advances SET status = 'discounted', period_id = ? WHERE id = ?",
                args: [periodId, id]
            });
            return { success: true };
        } catch (e) {
            console.error("Error marking advance:", e);
            return { success: false, error: e.message };
        }
    },

    deleteAdvance: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM salary_advances WHERE id = ?",
                args: [id]
            });
            const { salaryAdvances } = get();
            set({ salaryAdvances: salaryAdvances.filter(a => a.id !== id) });
            return { success: true };
        } catch (e) {
            console.error("Error deleting advance:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 8. Liquidaciones (Cálculo y Gestión) ---

    fetchPayrollPeriods: async (userId = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT pp.*, u.username, u.name 
                        FROM payroll_periods pp
                        JOIN users u ON pp.user_id = u.id
                        WHERE pp.company_id = ?`;
            const args = [activeCompanyId];

            if (userId) {
                sql += ` AND pp.user_id = ?`;
                args.push(userId);
            }

            sql += ` ORDER BY pp.period_end DESC, pp.created_at DESC`;

            const result = await turso.execute({ sql, args });
            set({ payrollPeriods: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching periods:", e);
            return [];
        }
    },

    calculatePeriod: async (userId, periodStart, periodEnd) => {
        const { activeCompanyId } = get();
        try {
            // 1. User + Config
            const userRes = await turso.execute("SELECT * FROM users WHERE id = ?", [userId]);
            const user = userRes.rows[0];
            const config = await get().fetchPersonalConfig();
            const tolerance = config?.late_tolerance_minutes || 10;
            const workingDaysMonth = config?.working_days_per_month || 30;

            // 2. Attendance, Shifts, Absences
            const attendance = await get().fetchAttendanceByRangeRaw(periodStart, periodEnd, userId);
            const shifts = await get().fetchShifts(periodStart, periodEnd, userId);
            const absencesData = await get().fetchAbsences(periodStart, periodEnd, userId);

            const shiftsMap = {};
            shifts.forEach(s => {
                if (s.notes !== 'LIBRE') shiftsMap[s.shift_date] = s;
            });

            const absencesMap = {};
            (absencesData || []).forEach(a => { absencesMap[a.absence_date] = a; });

            const daysMap = {};
            attendance.forEach(r => {
                if (!daysMap[r.date]) daysMap[r.date] = [];
                daysMap[r.date].push(r);
            });

            // 3. Process each shift day
            let hoursWorked = 0;
            let lateCount = 0;
            let lateMinutes = 0;
            let daysWorked = 0;
            let daysAbsent = 0;
            let daysVacation = 0;
            let daysMedical = 0;
            let daysPermission = 0;
            let daysUnjustified = 0;
            const detailDays = [];

            const shiftDates = Object.keys(shiftsMap).sort();
            for (const dateStr of shiftDates) {
                const shift = shiftsMap[dateStr];
                const records = (daysMap[dateStr] || []).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
                const absence = absencesMap[dateStr];

                let dayStatus = 'absent';
                let dayHours = 0;
                let dayLateMin = 0;

                // Find entry/exit pairs
                let entryTime = null;
                for (const r of records) {
                    if (r.type === 'entry') {
                        entryTime = new Date(r.recorded_at);
                        // Late check
                        const shiftStartStr = shift.start_time.includes('T') ? shift.start_time : `${dateStr}T${shift.start_time}`;
                        const shiftStart = new Date(shiftStartStr);
                        const diffMins = (entryTime - shiftStart) / (1000 * 60);
                        if (diffMins > tolerance) {
                            dayLateMin = Math.floor(diffMins);
                        }
                    } else if (r.type === 'exit' && entryTime) {
                        const exitTime = new Date(r.recorded_at);
                        dayHours += (exitTime - entryTime) / (1000 * 60 * 60);
                        entryTime = null;
                    }
                }

                if (dayHours > 0) {
                    dayStatus = dayLateMin > 0 ? 'late' : 'present';
                    hoursWorked += dayHours;
                    daysWorked++;
                    if (dayLateMin > 0) {
                        lateCount++;
                        lateMinutes += dayLateMin;
                    }
                } else if (absence) {
                    const aType = absence.type;
                    if (aType === 'vacation') { dayStatus = 'vacation'; daysVacation++; }
                    else if (aType === 'medical') { dayStatus = 'medical'; daysMedical++; }
                    else if (aType === 'permission') { dayStatus = 'permission'; daysPermission++; }
                    else if (aType === 'unjustified') { dayStatus = 'unjustified'; daysUnjustified++; daysAbsent++; }
                    else { dayStatus = 'absence_other'; daysAbsent++; }
                } else {
                    // Past date with no attendance and no absence = unjustified absence
                    const today = new Date().toISOString().slice(0, 10);
                    if (dateStr < today) {
                        dayStatus = 'unjustified';
                        daysUnjustified++;
                        daysAbsent++;
                    }
                }

                detailDays.push({ date: dateStr, status: dayStatus, hours: +dayHours.toFixed(2), lateMin: dayLateMin, absence: absence?.type || null });
            }

            // Also count attendance on days without shifts
            for (const dateStr of Object.keys(daysMap)) {
                if (!shiftsMap[dateStr]) {
                    const records = daysMap[dateStr].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
                    let entryTime = null;
                    let dayHours = 0;
                    for (const r of records) {
                        if (r.type === 'entry') entryTime = new Date(r.recorded_at);
                        else if (r.type === 'exit' && entryTime) {
                            dayHours += (new Date(r.recorded_at) - entryTime) / (1000 * 60 * 60);
                            entryTime = null;
                        }
                    }
                    if (dayHours > 0) {
                        hoursWorked += dayHours;
                        daysWorked++;
                        detailDays.push({ date: dateStr, status: 'extra', hours: +dayHours.toFixed(2), lateMin: 0, absence: null });
                    }
                }
            }

            // 4. Calculate base amount
            let baseAmount = 0;
            const payType = user.pay_type || 'monthly';
            const baseRate = user.pay_base_amount || 0;
            const hourlyRate = user.pay_hourly_rate || 0;
            const valorDia = workingDaysMonth > 0 ? baseRate / workingDaysMonth : 0;

            if (payType === 'monthly') {
                baseAmount = baseRate;
            } else if (payType === 'hourly') {
                baseAmount = baseRate * hoursWorked;
            } else if (payType === 'weekly') {
                // weeks in period
                const msInRange = new Date(periodEnd) - new Date(periodStart);
                const weeksInRange = Math.max(1, Math.round(msInRange / (7 * 24 * 60 * 60 * 1000)));
                baseAmount = baseRate * weeksInRange;
            } else if (payType === 'biweekly') {
                baseAmount = baseRate; // biweekly rate is set directly per quincena
            } else if (payType === 'mixed') {
                baseAmount = baseRate + (hourlyRate * hoursWorked);
            }

            // 5. Discounts
            let autoDiscounts = 0;
            let discountDetails = [];

            // Absence discount (unjustified only)
            if (config?.absence_discount_enabled && daysUnjustified > 0) {
                const absDsc = valorDia * daysUnjustified;
                autoDiscounts += absDsc;
                discountDetails.push({ label: `Faltas injustificadas (${daysUnjustified}d)`, amount: absDsc });
            }

            // Late discount
            if (config?.late_discount_enabled && lateMinutes > 0) {
                const lateDsc = (config.late_discount_per_minute || 0) * lateMinutes;
                autoDiscounts += lateDsc;
                discountDetails.push({ label: `Atrasos (${lateCount}x, ${lateMinutes}min)`, amount: lateDsc });
            }

            // 6. Paid absences (vacation, medical, permission)
            let paidAbsenceAmount = 0;
            if (config?.vacation_paid && daysVacation > 0) {
                paidAbsenceAmount += valorDia * daysVacation;
            }
            if (config?.medical_paid && daysMedical > 0) {
                paidAbsenceAmount += valorDia * daysMedical;
            }
            if (config?.permission_paid && daysPermission > 0) {
                paidAbsenceAmount += valorDia * daysPermission;
            }

            // 7. Automatic bonuses
            let autoBonuses = 0;
            let bonusDetails = [];

            if (config?.bonus_punctuality_enabled && lateCount === 0 && daysWorked > 0) {
                autoBonuses += config.bonus_punctuality_amount || 0;
                bonusDetails.push({ label: 'Bono puntualidad', amount: config.bonus_punctuality_amount || 0 });
            }
            if (config?.bonus_attendance_enabled && daysUnjustified === 0 && daysWorked > 0) {
                autoBonuses += config.bonus_attendance_amount || 0;
                bonusDetails.push({ label: 'Bono asistencia completa', amount: config.bonus_attendance_amount || 0 });
            }

            // 8. Advances
            const advRes = await turso.execute({
                sql: `SELECT SUM(amount) as total FROM salary_advances 
                      WHERE company_id = ? AND user_id = ? AND status = 'pending' AND advance_date <= ?`,
                args: [activeCompanyId, userId, periodEnd]
            });
            const advancesTotal = advRes.rows[0].total || 0;

            // 9. Final calculation
            const totalBonuses = autoBonuses + (user.pay_fixed_bonus || 0);
            const totalDiscounts = autoDiscounts + (user.pay_fixed_discount || 0);
            const totalToPay = baseAmount + paidAbsenceAmount + totalBonuses - totalDiscounts - advancesTotal;

            return {
                user_id: userId,
                period_start: periodStart,
                period_end: periodEnd,
                pay_type: payType,
                hours_worked: +hoursWorked.toFixed(2),
                days_worked: daysWorked,
                days_absent: daysAbsent,
                days_vacation: daysVacation,
                days_medical: daysMedical,
                days_permission: daysPermission,
                days_unjustified: daysUnjustified,
                total_shifts: shiftDates.length,
                late_count: lateCount,
                late_minutes: lateMinutes,
                extra_hours: 0,
                base_amount: +baseAmount.toFixed(0),
                paid_absence_amount: +paidAbsenceAmount.toFixed(0),
                auto_bonuses: +autoBonuses.toFixed(0),
                manual_bonus: user.pay_fixed_bonus || 0,
                auto_discounts: +autoDiscounts.toFixed(0),
                manual_discount: user.pay_fixed_discount || 0,
                advances_discounted: advancesTotal,
                total_to_pay: +totalToPay.toFixed(0),
                bonus_details: bonusDetails,
                discount_details: discountDetails,
                detail_days: detailDays
            };

        } catch (e) {
            console.error("Error calculating period:", e);
            throw e;
        }
    },

    createPayrollPeriod: async (data, createdBy) => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: `INSERT INTO payroll_periods 
                      (company_id, user_id, period_label, period_start, period_end, 
                       hours_worked, days_absent, late_count, late_minutes, extra_hours, 
                       manual_bonus, manual_discount, advances_discounted, base_amount, 
                       total_to_pay, created_by, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
                args: [
                    activeCompanyId, data.user_id, data.period_label, data.period_start, data.period_end,
                    data.hours_worked, data.days_absent, data.late_count, data.late_minutes, data.extra_hours,
                    data.manual_bonus, data.manual_discount, data.advances_discounted, data.base_amount,
                    data.total_to_pay, createdBy, new Date().toISOString()
                ]
            });

            const newId = res.rows[0].id;

            // Si se descontaron anticipos, actualizarlos
            if (data.advances_discounted > 0) {
                await turso.execute({
                    sql: `UPDATE salary_advances 
                           SET status = 'discounted', period_id = ? 
                           WHERE company_id = ? AND user_id = ? AND status = 'pending' AND advance_date <= ?`,
                    args: [newId, activeCompanyId, data.user_id, data.period_end]
                });
            }

            return { success: true, id: newId };
        } catch (e) {
            console.error("Error creating payroll period:", e);
            return { success: false, error: e.message };
        }
    },

    closePeriod: async (periodId) => {
        try {
            await turso.execute({
                sql: "UPDATE payroll_periods SET is_closed = 1, closed_at = ? WHERE id = ?",
                args: [new Date().toISOString(), periodId]
            });
            // Recargar
            get().fetchPayrollPeriods();
            return { success: true };
        } catch (e) {
            console.error("Error closing period:", e);
            return { success: false, error: e.message };
        }
    },

    updatePayrollPeriod: async (id, data) => {
        // Solo permitir si no está cerrado
        try {
            // Check status
            const current = await turso.execute("SELECT is_closed FROM payroll_periods WHERE id = ?", [id]);
            if (current.rows[0]?.is_closed) throw new Error("Period is closed");

            const fields = Object.keys(data).map(key => `${key} = ?`).join(', ');
            const values = Object.values(data);

            await turso.execute({
                sql: `UPDATE payroll_periods SET ${fields} WHERE id = ?`,
                args: [...values, id]
            });
            return { success: true };
        } catch (e) {
            console.error("Error updating period:", e);
            return { success: false, error: e.message };
        }
    },

    // --- 9. Pagos de Nómina (Reales) ---

    fetchPayrollPayments: async (userId = null, startDate = null, endDate = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT pp.*, u.username, u.name, per.period_label
                       FROM payroll_payments pp
                       JOIN users u ON pp.user_id = u.id
                       LEFT JOIN payroll_periods per ON pp.period_id = per.id
                       WHERE pp.company_id = ?`;
            const args = [activeCompanyId];

            if (userId) {
                sql += ` AND pp.user_id = ?`;
                args.push(userId);
            }
            if (startDate && endDate) {
                sql += ` AND pp.payment_date BETWEEN ? AND ?`;
                args.push(startDate, endDate);
            }

            sql += ` ORDER BY pp.payment_date DESC`;

            const result = await turso.execute({ sql, args });
            set({ payrollPayments: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching payments:", e);
            return [];
        }
    },

    createPayrollPayment: async (data, createdBy) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: `INSERT INTO payroll_payments 
                      (company_id, user_id, period_id, amount_paid, payment_date, pay_method, status, notes, created_by, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    data.user_id,
                    data.period_id,
                    data.amount_paid,
                    data.payment_date,
                    data.pay_method,
                    'paid',
                    data.notes,
                    createdBy,
                    new Date().toISOString()
                ]
            });
            return { success: true };
        } catch (e) {
            console.error("Error creating payment:", e);
            return { success: false, error: e.message };
        }
    },

    getPendingPayments: async () => {
        // Retorna usuarios con deuda (Liquidaciones cerradas vs Pagos realizados)
        const { activeCompanyId } = get();
        try {
            // Suma de Total a Pagar en Periodos Cerrados
            // MENOS Suma de Pagos Realizados
            // Agrupado por User

            // Esta query compleja podría simplificarse en JS si hay pocos datos, 
            // pero intentemos SQL

            const sql = `
                SELECT u.id, u.name, 
                    (SELECT COALESCE(SUM(total_to_pay),0) FROM payroll_periods WHERE user_id = u.id AND is_closed = 1) as total_owed,
                    (SELECT COALESCE(SUM(amount_paid),0) FROM payroll_payments WHERE user_id = u.id) as total_paid
                FROM users u
                WHERE u.company_id = ? AND u.has_labor_profile = 1
             `;

            const result = await turso.execute(sql, [activeCompanyId]);

            return result.rows.map(r => ({
                ...r,
                balance: r.total_owed - r.total_paid
            })).filter(r => Math.abs(r.balance) > 0.01); // Solo con saldo pendiente

        } catch (e) {
            console.error("Error getting pending payments:", e);
            return [];
        }
    },

    // --- 10. Vacaciones ---

    fetchVacationRequests: async (status = null) => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT vr.*, u.username, u.name 
                       FROM vacation_requests vr
                       JOIN users u ON vr.user_id = u.id
                       WHERE vr.company_id = ?`;
            const args = [activeCompanyId];

            if (status) {
                sql += ` AND vr.status = ?`;
                args.push(status);
            }
            sql += ` ORDER BY vr.start_date DESC`;

            const result = await turso.execute({ sql, args });
            set({ vacationRequests: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching vacation requests:", e);
            return [];
        }
    },

    fetchVacationBalances: async () => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT vb.*, u.username, u.name 
                      FROM vacation_balances vb
                      JOIN users u ON vb.user_id = u.id
                      WHERE vb.company_id = ?`,
                args: [activeCompanyId]
            });
            set({ vacationBalances: result.rows });
            return result.rows;
        } catch (e) {
            console.error("Error fetching vacation balances:", e);
            return [];
        }
    },

    createVacationRequest: async (data) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: `INSERT INTO vacation_requests 
                      (company_id, user_id, start_date, end_date, total_days, notes, created_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [activeCompanyId, data.user_id, data.start_date, data.end_date, data.total_days, data.notes, new Date().toISOString()]
            });
            return { success: true };
        } catch (e) {
            console.error("Error requesting vacation:", e);
            return { success: false, error: e.message };
        }
    },

    approveVacation: async (requestId, reviewedBy) => {
        // Aprobar: 1. Update status 2. Create 'vacation' absence records 3. Deduct from balance
        const { activeCompanyId } = get();
        const now = new Date().toISOString();
        try {
            // Get Request
            const reqRes = await turso.execute("SELECT * FROM vacation_requests WHERE id = ?", [requestId]);
            const request = reqRes.rows[0];
            if (!request) throw new Error("Request not found");

            // 1. Update request status
            await turso.execute({
                sql: "UPDATE vacation_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
                args: [reviewedBy, now, requestId]
            });

            // 2. Create absences (Range loop)
            // Lógica simplificada: crear una ausencia por cada día o una por rango? 
            // La tabla labor_absences tiene fecha única "absence_date". Debemos iterar.

            const start = new Date(request.start_date);
            const end = new Date(request.end_date);

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                await get().createAbsence({
                    user_id: request.user_id,
                    absence_date: d.toISOString().split('T')[0],
                    type: 'vacation',
                    notes: `Vacaciones aprobadas (Req #${requestId})`
                }, reviewedBy);
            }

            // 3. Update Balance
            // Check if balance row exists
            const balCheck = await turso.execute("SELECT * FROM vacation_balances WHERE user_id = ?", [request.user_id]);
            if (balCheck.rows.length === 0) {
                await turso.execute("INSERT INTO vacation_balances (company_id, user_id, used_days) VALUES (?, ?, ?)",
                    [activeCompanyId, request.user_id, request.total_days]);
            } else {
                await turso.execute("UPDATE vacation_balances SET used_days = used_days + ? WHERE user_id = ?",
                    [request.total_days, request.user_id]);
            }

            // Reload
            get().fetchVacationRequests();
            get().fetchVacationBalances();
            return { success: true };

        } catch (e) {
            console.error("Error approving vacation:", e);
            return { success: false, error: e.message };
        }
    },

    rejectVacation: async (requestId, reviewedBy) => {
        const now = new Date().toISOString();
        try {
            await turso.execute({
                sql: "UPDATE vacation_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
                args: [reviewedBy, now, requestId]
            });
            get().fetchVacationRequests();
            return { success: true };
        } catch (e) {
            console.error("Error rejecting vacation:", e);
            return { success: false, error: e.message };
        }
    },

    updateVacationBalance: async (userId, data) => {
        // data: { initial_balance, accrued_days, used_days }
        const { activeCompanyId } = get();
        try {
            // Check exist
            const check = await turso.execute("SELECT id FROM vacation_balances WHERE user_id = ?", [userId]);

            if (check.rows.length === 0) {
                await turso.execute({
                    sql: "INSERT INTO vacation_balances (company_id, user_id, initial_balance, accrued_days, used_days) VALUES (?, ?, ?, ?, ?)",
                    args: [activeCompanyId, userId, data.initial_balance || 0, data.accrued_days || 0, data.used_days || 0]
                });
            } else {
                const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
                const values = Object.values(data);
                await turso.execute({
                    sql: `UPDATE vacation_balances SET ${fields} WHERE user_id = ?`,
                    args: [...values, userId]
                });
            }
            get().fetchVacationBalances();
            return { success: true };
        } catch (e) {
            console.error("Error updating balance:", e);
            return { success: false, error: e.message };
        }
    },

    // ═══════════════════════════════════════════
    // COMBOS / PACKS
    // ═══════════════════════════════════════════

    combos: [],

    fetchCombos: async (search = '') => {
        const { activeCompanyId } = get();
        try {
            let sql = `SELECT * FROM product_combos WHERE company_id = ?`;
            let args = [activeCompanyId];
            if (search) {
                sql += ` AND (name LIKE ? OR sku LIKE ?)`;
                args.push(`%${search}%`, `%${search}%`);
            }
            sql += ` ORDER BY created_at DESC`;
            const result = await turso.execute({ sql, args });

            // Fetch items for each combo
            const combos = [];
            for (const combo of result.rows) {
                const itemsRes = await turso.execute({
                    sql: `SELECT ci.*, p.stock as current_stock FROM product_combo_items ci LEFT JOIN products p ON p.id = ci.product_id WHERE ci.combo_id = ?`,
                    args: [combo.id]
                });
                combos.push({ ...combo, items: itemsRes.rows });
            }

            set({ combos });
            return combos;
        } catch (e) {
            console.error('Error fetching combos:', e);
            return [];
        }
    },

    createCombo: async (data) => {
        const { activeCompanyId } = get();
        try {
            const now = new Date().toISOString();
            const totalCost = (data.items || []).reduce((sum, it) => sum + (parseFloat(it.cost) || 0) * (parseFloat(it.quantity) || 1), 0);
            const result = await turso.execute({
                sql: `INSERT INTO product_combos (company_id, name, sku, price, cost, image, description, is_active, has_dates, start_date, end_date, tax_rate, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
                args: [
                    activeCompanyId,
                    data.name,
                    data.sku || null,
                    parseFloat(data.price),
                    Math.round(totalCost * 100) / 100,
                    data.image || null,
                    data.description || null,
                    data.has_dates ? 1 : 0,
                    data.start_date || null,
                    data.end_date || null,
                    parseFloat(data.tax_rate) || 0,
                    now, now
                ]
            });
            const comboId = typeof result.lastInsertRowid === 'bigint' ? Number(result.lastInsertRowid) : result.lastInsertRowid;

            // Insert combo items
            for (const item of (data.items || [])) {
                await turso.execute({
                    sql: `INSERT INTO product_combo_items (combo_id, product_id, product_name, product_sku, quantity, cost) VALUES (?, ?, ?, ?, ?, ?)`,
                    args: [comboId, item.product_id, item.product_name, item.product_sku || null, parseFloat(item.quantity) || 1, parseFloat(item.cost) || 0]
                });
            }

            await get().fetchCombos();
            return { success: true, comboId };
        } catch (e) {
            console.error('Error creating combo:', e);
            return { success: false, error: e.message };
        }
    },

    updateCombo: async (comboId, data) => {
        const { activeCompanyId } = get();
        try {
            const now = new Date().toISOString();
            const totalCost = (data.items || []).reduce((sum, it) => sum + (parseFloat(it.cost) || 0) * (parseFloat(it.quantity) || 1), 0);
            await turso.execute({
                sql: `UPDATE product_combos SET name=?, sku=?, price=?, cost=?, image=?, description=?, has_dates=?, start_date=?, end_date=?, tax_rate=?, updated_at=? WHERE id=? AND company_id=?`,
                args: [
                    data.name, data.sku || null, parseFloat(data.price),
                    Math.round(totalCost * 100) / 100,
                    data.image || null, data.description || null,
                    data.has_dates ? 1 : 0, data.start_date || null, data.end_date || null,
                    parseFloat(data.tax_rate) || 0, now, comboId, activeCompanyId
                ]
            });

            // Replace items
            await turso.execute({ sql: `DELETE FROM product_combo_items WHERE combo_id = ?`, args: [comboId] });
            for (const item of (data.items || [])) {
                await turso.execute({
                    sql: `INSERT INTO product_combo_items (combo_id, product_id, product_name, product_sku, quantity, cost) VALUES (?, ?, ?, ?, ?, ?)`,
                    args: [comboId, item.product_id, item.product_name, item.product_sku || null, parseFloat(item.quantity) || 1, parseFloat(item.cost) || 0]
                });
            }

            await get().fetchCombos();
            return { success: true };
        } catch (e) {
            console.error('Error updating combo:', e);
            return { success: false, error: e.message };
        }
    },

    deleteCombo: async (comboId) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({ sql: `DELETE FROM product_combos WHERE id = ? AND company_id = ?`, args: [comboId, activeCompanyId] });
            await get().fetchCombos();
            return { success: true };
        } catch (e) {
            console.error('Error deleting combo:', e);
            return { success: false, error: e.message };
        }
    },

    toggleComboActive: async (comboId) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: `UPDATE product_combos SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ? AND company_id = ?`,
                args: [new Date().toISOString(), comboId, activeCompanyId]
            });
            await get().fetchCombos();
            return { success: true };
        } catch (e) {
            console.error('Error toggling combo:', e);
            return { success: false, error: e.message };
        }
    },

    fetchCombosForPOS: async () => {
        const { activeCompanyId } = get();
        try {
            const today = new Date().toISOString().split('T')[0];
            const result = await turso.execute({
                sql: `SELECT * FROM product_combos WHERE company_id = ? AND is_active = 1`,
                args: [activeCompanyId]
            });

            const combosForPOS = [];
            for (const combo of result.rows) {
                // Check vigencia
                if (combo.has_dates) {
                    if (combo.start_date && today < combo.start_date) continue;
                    if (combo.end_date && today > combo.end_date) continue;
                }

                // Get items and calculate available stock
                const itemsRes = await turso.execute({
                    sql: `SELECT ci.*, p.stock as current_stock FROM product_combo_items ci LEFT JOIN products p ON p.id = ci.product_id WHERE ci.combo_id = ?`,
                    args: [combo.id]
                });

                let availableStock = Infinity;
                const comboItems = [];
                for (const item of itemsRes.rows) {
                    const qty = parseFloat(item.quantity) || 1;
                    const stock = parseFloat(item.current_stock) || 0;
                    availableStock = Math.min(availableStock, Math.floor(stock / qty));
                    comboItems.push({
                        product_id: item.product_id,
                        product_name: item.product_name,
                        product_sku: item.product_sku,
                        quantity: qty,
                        cost: parseFloat(item.cost) || 0
                    });
                }
                if (availableStock === Infinity) availableStock = 0;

                combosForPOS.push({
                    id: `combo_${combo.id}`,
                    name: combo.name,
                    price: parseFloat(combo.price),
                    cost: parseFloat(combo.cost) || 0,
                    stock: availableStock,
                    sku: combo.sku || '',
                    image: combo.image || null,
                    tax_rate: parseFloat(combo.tax_rate) || 0,
                    unit: 'Und',
                    category: 'Combos',
                    is_combo: true,
                    combo_id: combo.id,
                    combo_items: comboItems,
                    is_offer: false,
                    offer_price: null,
                    price_ranges: [],
                    scale_group_id: null,
                    original_price: parseFloat(combo.price)
                });
            }

            set({ products: combosForPOS });
            return combosForPOS;
        } catch (e) {
            console.error('Error fetching combos for POS:', e);
            return [];
        }
    },

    // ═══════════════════════════════════════════
    // INVENTORY ALERTS SYSTEM
    // ═══════════════════════════════════════════

    inventoryAlerts: [],
    unreadAlertCount: 0,

    // ── Alert Settings CRUD ──

    fetchAlertSettings: async (productId) => {
        const { activeCompanyId } = get();
        try {
            const res = await turso.execute({
                sql: `SELECT * FROM product_alert_settings WHERE company_id = ? AND product_id = ?`,
                args: [activeCompanyId, productId]
            });
            return res.rows[0] || null;
        } catch (e) {
            console.error('Error fetching alert settings:', e);
            return null;
        }
    },

    saveAlertSettings: async (productId, settings) => {
        const { activeCompanyId } = get();
        try {
            const now = new Date().toISOString();
            await turso.execute({
                sql: `INSERT INTO product_alert_settings (company_id, product_id, min_stock, critical_stock, priority, notify_system, notify_whatsapp, is_active, cooldown_hours, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(company_id, product_id) DO UPDATE SET
                        min_stock = excluded.min_stock,
                        critical_stock = excluded.critical_stock,
                        priority = excluded.priority,
                        notify_system = excluded.notify_system,
                        notify_whatsapp = excluded.notify_whatsapp,
                        is_active = excluded.is_active,
                        cooldown_hours = excluded.cooldown_hours`,
                args: [
                    activeCompanyId, productId,
                    parseFloat(settings.min_stock) || 5,
                    parseFloat(settings.critical_stock) || 2,
                    settings.priority || 'normal',
                    settings.notify_system ? 1 : 0,
                    settings.notify_whatsapp ? 1 : 0,
                    settings.is_active ? 1 : 0,
                    parseInt(settings.cooldown_hours) || 6,
                    now
                ]
            });
            return { success: true };
        } catch (e) {
            console.error('Error saving alert settings:', e);
            return { success: false, error: e.message };
        }
    },

    // ── Notification Service (abstraction layer) ──

    sendNotification: async ({ type = 'system', title, message, companyId, productId, productName, alertType, priority, currentStock, threshold, daysRemaining }) => {
        try {
            const now = new Date().toISOString();

            // 1. Always save to DB
            await turso.execute({
                sql: `INSERT INTO inventory_alerts (company_id, product_id, product_name, alert_type, priority, title, message, current_stock, threshold, days_remaining, channel, sent, sent_at, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                args: [companyId, productId || null, productName || null, alertType, priority || 'normal', title, message, currentStock ?? null, threshold ?? null, daysRemaining ?? null, type, now, now]
            });

            // 2. WhatsApp placeholder (ready for future integration)
            if (type === 'whatsapp') {
                // sendWhatsAppNotification({ to: company.phone, message })
                console.log('📱 WhatsApp notification queued (not implemented):', { title, message });
            }

            return { success: true };
        } catch (e) {
            console.error('Error sending notification:', e);
            return { success: false, error: e.message };
        }
    },

    // ── Core Alert Engine ──

    checkInventoryAlerts: async (specificProductIds = null) => {
        const { activeCompanyId, sendNotification } = get();
        if (!activeCompanyId) return;

        try {
            // Get all active alert settings with current product stock
            let sql = `SELECT s.*, p.name as product_name, p.stock as current_stock, p.sku
                        FROM product_alert_settings s
                        JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
                        WHERE s.company_id = ? AND s.is_active = 1`;
            let args = [activeCompanyId];

            if (specificProductIds && specificProductIds.length > 0) {
                const placeholders = specificProductIds.map(() => '?').join(',');
                sql += ` AND s.product_id IN (${placeholders})`;
                args.push(...specificProductIds);
            }

            const result = await turso.execute({ sql, args });
            const now = new Date();
            const alertsToSend = [];

            for (const setting of result.rows) {
                const stock = parseFloat(setting.current_stock) || 0;
                const minStock = parseFloat(setting.min_stock);
                const criticalStock = parseFloat(setting.critical_stock);
                const cooldownHours = parseInt(setting.cooldown_hours) || 6;

                // Anti-spam: check cooldown
                if (setting.last_notified_at) {
                    const lastNotified = new Date(setting.last_notified_at);
                    const hoursSince = (now - lastNotified) / (1000 * 60 * 60);
                    if (hoursSince < cooldownHours) continue;
                }

                // Determine alert type
                let alertType = null;
                let threshold = null;

                if (stock <= criticalStock) {
                    alertType = 'critical';
                    threshold = criticalStock;
                } else if (stock <= minStock) {
                    alertType = 'low';
                    threshold = minStock;
                }

                if (!alertType) continue;

                alertsToSend.push({
                    ...setting,
                    alertType,
                    threshold,
                    stock
                });
            }

            // Send grouped alerts
            if (alertsToSend.length > 0) {
                const criticalAlerts = alertsToSend.filter(a => a.alertType === 'critical');
                const lowAlerts = alertsToSend.filter(a => a.alertType === 'low');

                // Individual notifications per product for tracking
                for (const alert of alertsToSend) {
                    const emoji = alert.alertType === 'critical' ? '🚨' : '⚠️';
                    const typeLabel = alert.alertType === 'critical' ? 'CRÍTICO' : 'Bajo';
                    const title = `${emoji} Stock ${typeLabel}: ${alert.product_name}`;
                    const message = `${alert.product_name} tiene ${alert.stock} unidades (mínimo: ${alert.threshold})`;

                    if (alert.notify_system) {
                        await sendNotification({
                            type: 'system', title, message,
                            companyId: activeCompanyId,
                            productId: alert.product_id,
                            productName: alert.product_name,
                            alertType: alert.alertType,
                            priority: alert.priority,
                            currentStock: alert.stock,
                            threshold: alert.threshold
                        });
                    }

                    if (alert.notify_whatsapp) {
                        await sendNotification({
                            type: 'whatsapp', title, message,
                            companyId: activeCompanyId,
                            productId: alert.product_id,
                            productName: alert.product_name,
                            alertType: alert.alertType,
                            priority: alert.priority,
                            currentStock: alert.stock,
                            threshold: alert.threshold
                        });
                    }

                    // Update last_notified_at (anti-spam)
                    await turso.execute({
                        sql: `UPDATE product_alert_settings SET last_notified_at = ? WHERE id = ?`,
                        args: [now.toISOString(), alert.id]
                    });
                }

                console.log(`🔔 Alerts sent: ${criticalAlerts.length} critical, ${lowAlerts.length} low`);
            }

            // Refresh unread count
            await get().fetchUnreadAlertCount();

            return { criticalCount: alertsToSend.filter(a => a.alertType === 'critical').length, lowCount: alertsToSend.filter(a => a.alertType === 'low').length };
        } catch (e) {
            console.error('Error checking inventory alerts:', e);
            return { criticalCount: 0, lowCount: 0 };
        }
    },

    // ── Prediction Engine (PRO) ──

    checkStockPredictions: async () => {
        const { activeCompanyId, sendNotification } = get();
        if (!activeCompanyId) return;

        try {
            // Get average daily sales for last 7 days per product
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const result = await turso.execute({
                sql: `SELECT s.product_id, s.product_name, p.stock as current_stock, p.name,
                             SUM(s.quantity_sold) as total_sold
                      FROM (
                          SELECT json_each.value->>'id' as product_id,
                                 json_each.value->>'name' as product_name,
                                 CAST(json_each.value->>'quantity' AS REAL) as quantity_sold
                          FROM sales, json_each(sales.items)
                          WHERE sales.company_id = ? AND sales.date >= ? AND sales.status = 'completed'
                      ) s
                      JOIN products p ON p.id = s.product_id AND p.company_id = ?
                      JOIN product_alert_settings pas ON pas.product_id = p.id AND pas.company_id = ? AND pas.is_active = 1
                      GROUP BY s.product_id`,
                args: [activeCompanyId, sevenDaysAgo, activeCompanyId, activeCompanyId]
            });

            for (const row of result.rows) {
                const avgDaily = (parseFloat(row.total_sold) || 0) / 7;
                if (avgDaily <= 0) continue;

                const stock = parseFloat(row.current_stock) || 0;
                const daysRemaining = stock / avgDaily;

                if (daysRemaining < 3 && daysRemaining >= 0) {
                    // Check cooldown (no duplicate prediction alerts within 24h)
                    const existing = await turso.execute({
                        sql: `SELECT id FROM inventory_alerts WHERE company_id = ? AND product_id = ? AND alert_type = 'prediction' AND created_at > datetime('now', '-24 hours')`,
                        args: [activeCompanyId, row.product_id]
                    });
                    if (existing.rows.length > 0) continue;

                    await sendNotification({
                        type: 'system',
                        title: `📊 Predicción: ${row.name} se agotará en ${Math.round(daysRemaining * 10) / 10} días`,
                        message: `${row.name} tiene ${stock} unidades. Promedio de venta: ${Math.round(avgDaily * 10) / 10}/día. Se agotará en ~${Math.round(daysRemaining)} días.`,
                        companyId: activeCompanyId,
                        productId: row.product_id,
                        productName: row.name,
                        alertType: 'prediction',
                        priority: daysRemaining < 1 ? 'critical' : 'important',
                        currentStock: stock,
                        daysRemaining: Math.round(daysRemaining * 10) / 10
                    });
                }
            }
        } catch (e) {
            console.error('Error checking stock predictions:', e);
        }
    },

    // ── Fetch & Manage Alerts ──

    fetchInventoryAlerts: async (limit = 50) => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT * FROM inventory_alerts WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`,
                args: [activeCompanyId, limit]
            });
            set({ inventoryAlerts: result.rows });
            return result.rows;
        } catch (e) {
            console.error('Error fetching alerts:', e);
            return [];
        }
    },

    fetchUnreadAlertCount: async () => {
        const { activeCompanyId } = get();
        try {
            const result = await turso.execute({
                sql: `SELECT COUNT(*) as count FROM inventory_alerts WHERE company_id = ? AND is_read = 0`,
                args: [activeCompanyId]
            });
            const count = result.rows[0]?.count || 0;
            set({ unreadAlertCount: count });
            return count;
        } catch (e) {
            return 0;
        }
    },

    markAlertRead: async (alertId) => {
        try {
            await turso.execute({ sql: `UPDATE inventory_alerts SET is_read = 1 WHERE id = ?`, args: [alertId] });
            await get().fetchUnreadAlertCount();
        } catch (e) {
            console.error('Error marking alert read:', e);
        }
    },

    markAllAlertsRead: async () => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: `UPDATE inventory_alerts SET is_read = 1 WHERE company_id = ? AND is_read = 0`,
                args: [activeCompanyId]
            });
            set({ unreadAlertCount: 0 });
        } catch (e) {
            console.error('Error marking all alerts read:', e);
        }
    },

    deleteOldAlerts: async (daysOld = 30) => {
        const { activeCompanyId } = get();
        try {
            await turso.execute({
                sql: `DELETE FROM inventory_alerts WHERE company_id = ? AND created_at < datetime('now', '-' || ? || ' days')`,
                args: [activeCompanyId, daysOld]
            });
        } catch (e) {
            console.error('Error deleting old alerts:', e);
        }
    },

    // ── WhatsApp Placeholder ──

    sendWhatsAppNotification: async (payload) => {
        // PLACEHOLDER: Ready for future WhatsApp integration
        // payload: { to, message, companyId }
        console.log('📱 [WhatsApp Placeholder] Would send:', payload);
        // Future: Call WhatsApp Business API here
        // await fetch('https://api.whatsapp.com/...', { method: 'POST', body: JSON.stringify(payload) });
        return { success: true, status: 'queued' };
    },

    // ── Dashboard Alert Summary ──

    fetchAlertSummary: async () => {
        const { activeCompanyId } = get();
        try {
            // Get products with active alerts that are currently in alert state
            const result = await turso.execute({
                sql: `SELECT s.priority, s.min_stock, s.critical_stock, p.id as product_id, p.name, p.stock, p.sku
                      FROM product_alert_settings s
                      JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
                      WHERE s.company_id = ? AND s.is_active = 1 AND (p.stock <= s.min_stock)
                      ORDER BY
                        CASE WHEN p.stock <= s.critical_stock THEN 0 ELSE 1 END,
                        CASE s.priority WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
                        p.stock ASC`,
                args: [activeCompanyId]
            });

            const criticalProducts = [];
            const lowProducts = [];

            for (const row of result.rows) {
                const item = {
                    product_id: row.product_id,
                    name: row.name,
                    sku: row.sku,
                    stock: parseFloat(row.stock),
                    min_stock: parseFloat(row.min_stock),
                    critical_stock: parseFloat(row.critical_stock),
                    priority: row.priority
                };

                if (item.stock <= parseFloat(row.critical_stock)) {
                    criticalProducts.push(item);
                } else {
                    lowProducts.push(item);
                }
            }

            return { criticalProducts, lowProducts };
        } catch (e) {
            console.error('Error fetching alert summary:', e);
            return { criticalProducts: [], lowProducts: [] };
        }
    },

}), {
    name: 'pos-storage',
    partialize: (state) => ({
        carts: state.carts,
        activeCartId: state.activeCartId,
        nextCartId: state.nextCartId,
        currentUser: state.currentUser,
        activeCompanyId: state.activeCompanyId,
        availableCompanies: state.availableCompanies,
        currentCompanyTimezone: state.currentCompanyTimezone,
        currentCurrency: state.currentCurrency,
        currentUserCompanyRole: state.currentUserCompanyRole,
        darkMode: state.darkMode
    }),
    onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
    }
}));

