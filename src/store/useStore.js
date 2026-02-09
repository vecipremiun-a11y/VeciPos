import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { turso } from '../lib/turso';
import { subDays } from 'date-fns';
import { getNowInCompanyTime, getCompanyDayStart, getCompanyDayEnd, getStartFromDateString, getEndFromDateString, formatInCompanyTime } from '../lib/dateHelpers';

let migrationsExecuted = false;

export const useStore = create(persist((set, get) => ({
    // Initial State
    products: [],
    productLots: [], // New state for lots
    categories: [],
    suppliers: [],
    users: [],
    purchases: [],
    sales: [],
    // Multi-cart system
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
            // ... (rest of migration logic kept same, but I need to make sure I don't delete it)
            // Actually, I can leave _runMigrations as is. I only need to change fetchInitialData.
            // But wait, I am replacing a chunk. Let's look at where I am.
            // I requested view up to 450.
            // I will target fetchInitialData specifically.

            const currentVersion = versionRes.rows.length > 0 ? parseInt(versionRes.rows[0].value) : 0;
            const TARGET_VERSION = 3; // Incremented to trigger wholesale columns migration

            if (currentVersion >= TARGET_VERSION) {
                console.log("Schema is up to date (v" + currentVersion + ")");
                return;
            }

            console.log(`Migrating Schema from v${currentVersion} to v${TARGET_VERSION}...`);

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

                // 5. Para ventas con status
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

            // UPDATE VERSION
            await turso.execute({
                sql: "INSERT INTO system_settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
                args: [TARGET_VERSION, TARGET_VERSION]
            });

            console.log("SaaS Migrations Completed.");

        } catch (e) {
            console.error("Migration Fatal Error:", e);
        }
    },

    // Clients State & Actions
    clients: [],
    posSelectedClient: null,
    setPosSelectedClient: (client) => set({ posSelectedClient: client }),

    addClient: async (client) => {
        try {
            const result = await turso.execute({
                sql: "INSERT INTO clients (name, rut, phone, email, address, created_at, company_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    client.name,
                    client.rut || '',
                    client.phone || '',
                    client.email || '',
                    client.address || '',
                    new Date().toISOString(),
                    get().activeCompanyId
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

            await turso.execute({
                sql: "UPDATE clients SET name = ?, rut = ?, phone = ?, email = ?, address = ? WHERE id = ? AND company_id = ?",
                args: [updatedClient.name, updatedClient.rut, updatedClient.phone, updatedClient.email, updatedClient.address, id, activeCompanyId]
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
                    SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, c.currency, uc.role 
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
        const { currentUser, availableCompanies, fetchInitialData } = get();

        // Validate
        const targetCompany = availableCompanies.find(c => c.id === companyId);
        if (!targetCompany) {
            console.error("Attempted to switch to invalid company", companyId);
            return { success: false, error: "Invalid Company" };
        }

        console.log("Switching to company:", companyId);

        // CLEAR STATE IMMEDIATELY to prevent data bleeding
        set({
            isLoading: true,
            activeCompanyId: companyId,
            // Load inventory mode from target company
            inventoryAdjustmentMode: targetCompany.inventory_adjustment_mode === 1,
            // Clear all data lists
            products: [],
            productLots: [],
            categories: [],
            suppliers: [],
            users: [],
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

        // Reload data
        await fetchInitialData();

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
        console.time('⏱️ fetchInitialData');
        set({ isLoading: true, error: null });
        try {
            console.log('📊 fetchInitialData START');

            // RUN MIGRATIONS & BACKFILL
            if (!migrationsExecuted) {
                console.time('⏱️ _runMigrations');
                await get()._runMigrations();
                console.timeEnd('⏱️ _runMigrations');
                migrationsExecuted = true;
                console.log('✅ Migrations executed and cached for session');
            } else {
                console.log('✅ Migrations already executed, using cache');
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
                    sql: `SELECT c.id, c.name, c.timezone, c.inventory_adjustment_mode, c.currency, uc.role 
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
                    inventoryAdjustmentMode: activeCompany.inventory_adjustment_mode === 1
                });


                // Guardar en localStorage
                localStorage.setItem(`activeCompanyId:${currentUser.id}`, activeCompanyId);
            }

            // SIEMPRE cargar inventory_adjustment_mode fresco desde la DB
            // (en caso de que availableCompanies venga de localStorage con valor desactualizado)
            if (currentUser && activeCompanyId) {
                try {
                    const companyRes = await turso.execute({
                        sql: 'SELECT inventory_adjustment_mode, currency FROM companies WHERE id = ?',
                        args: [activeCompanyId]
                    });
                    if (companyRes.rows.length > 0) {
                        const freshMode = companyRes.rows[0].inventory_adjustment_mode === 1;
                        const freshCurrency = companyRes.rows[0].currency || 'CLP';
                        set({
                            inventoryAdjustmentMode: freshMode,
                            currentCurrency: freshCurrency
                        });
                        console.log('🔧 Inventory/Currency loaded from DB:', freshMode, freshCurrency);
                    }
                } catch (e) {
                    console.warn('Could not load inventory_adjustment_mode:', e);
                }
            }

            console.log('🏢 Loading data for company:', activeCompanyId);

            // ==========================================
            // 1. ENSURE SCHEMA (DDL & Column Checks)
            // ==========================================
            await turso.execute(`
                CREATE TABLE IF NOT EXISTS product_lots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    batch_number TEXT,
                    expiry_date TEXT,
                    quantity REAL,
                    cost REAL,
                    supplier_name TEXT,
                    created_at TEXT,
                    status TEXT DEFAULT 'active',
                    company_id TEXT DEFAULT 'default'
                )
            `);

            await turso.execute(`
                CREATE TABLE IF NOT EXISTS clients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    rut TEXT,
                    phone TEXT,
                    email TEXT,
                    address TEXT,
                    created_at TEXT
                )
            `);

            await turso.execute(`
                CREATE TABLE IF NOT EXISTS supplier_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT,
                    user_id TEXT,
                    supplier_id INTEGER,
                    supplier_name TEXT,
                    seller_name TEXT,
                    total_amount REAL,
                    items TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at TEXT,
                    expected_delivery_date TEXT,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                )
            `);

            // Migration: Add new columns to suppliers if they don't exist
            const newColumns = [
                'ALTER TABLE suppliers ADD COLUMN seller_name TEXT',
                'ALTER TABLE suppliers ADD COLUMN order_days TEXT',
                'ALTER TABLE suppliers ADD COLUMN delivery_days TEXT'
            ];

            for (const query of newColumns) {
                try {
                    await turso.execute(query);
                } catch (e) {
                    // Ignore error if column already exists
                }
            }

            // 2. BATCH DATA FETCHING
            // ==========================================
            console.time('⏱️ BatchFetch');
            const batchResults = await turso.batch([
                // Optimized product_lots query
                {
                    sql: `SELECT id, product_id, batch_number, expiry_date, quantity, cost, supplier_name, created_at, status, company_id 
                          FROM product_lots 
                          WHERE company_id = ? AND quantity > 0 
                          ORDER BY expiry_date ASC 
                          LIMIT 200`,
                    args: [activeCompanyId]
                },
                { sql: "SELECT * FROM categories WHERE company_id = ? ORDER BY name ASC", args: [activeCompanyId] },
                { sql: "SELECT * FROM suppliers WHERE company_id = ? ORDER BY name ASC", args: [activeCompanyId] },
                { sql: "SELECT * FROM users WHERE company_id = ?", args: [activeCompanyId] },
                { sql: "SELECT * FROM clients WHERE company_id = ? ORDER BY name ASC", args: [activeCompanyId] }
                // Removed sales LIMIT 0
            ]);
            console.timeEnd('⏱️ BatchFetch');

            const productLotsRes = batchResults[0];
            const categoriesRes = batchResults[1];
            const suppliersRes = batchResults[2];
            const usersRes = batchResults[3];
            const clientsRes = batchResults[4];

            console.log('👥 Loaded users:', usersRes.rows.length);

            // Removed products mapping
            const productLots = productLotsRes.rows;
            const categories = categoriesRes.rows.map(c => ({
                ...c,
                showInPos: c.show_in_pos !== 0
            }));
            const suppliers = suppliersRes.rows;
            const users = usersRes.rows;
            const clients = clientsRes.rows;
            // Sales processing not needed for empty set but kept for structure if limit changes
            // const sales = ...

            set({ productLots, categories, suppliers, users, clients });

            console.timeEnd('⏱️ fetchInitialData');
            console.log(`✅ Initial Load: Metadata only.`);
            console.log('✅ fetchInitialData COMPLETE');
        } catch (error) {
            console.error("Failed to fetch data:", error);
            set({ error: error.message });
        } finally {
            set({ isLoading: false });
        }
    },

    // NEW: Server-Side Search Actions
    searchProducts: async (term) => {
        const { activeCompanyId } = get();
        if (!term) return;

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
                const processedSale = {
                    ...fullSale,
                    items: JSON.parse(fullSale.items),
                    paymentMethod: fullSale.payment_method,
                    paymentDetails: fullSale.payment_details ? JSON.parse(fullSale.payment_details) : null,
                    observation: fullSale.observation || '',
                    clientId: fullSale.client_id,
                    clientName: fullSale.client_name
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
            const startOfToday = getCompanyDayStart(today, currentCompanyTimezone);
            const endOfToday = getCompanyDayEnd(today, currentCompanyTimezone);

            // Para mes: desde día 1 del mes actual
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

            // Formatear fechas para comparar con columna 'day' (YYYY-MM-DD)
            const todayStr = formatInCompanyTime(today, currentCompanyTimezone, 'yyyy-MM-dd');
            const monthStartStr = formatInCompanyTime(startOfMonth, currentCompanyTimezone, 'yyyy-MM-dd');

            console.log('📅 Dashboard dates:', { todayStr, monthStartStr, company: activeCompanyId });

            // 2. QUERIES OPTIMIZADOS usando sales_daily_summary
            // 2. QUERIES OPTIMIZADOS usando sales_daily_summary
            const [
                todayStatsRes,
                monthStatsRes,
                todayUtilityRes,        // ← NUEVA: Utilidad precalculada
                recentSalesRes,
                lowStockRes,
                topProductsRes          // ← NUEVA: Más vendidos precalculado
            ] = await turso.batch([
                // 1. Stats del día desde tabla agregada (SUPER RÁPIDO)
                {
                    sql: `SELECT 
                            COALESCE(SUM(total_sales), 0) as total_sales,
                            COALESCE(SUM(total_orders), 0) as total_orders
                          FROM sales_daily_summary
                          WHERE company_id = ? AND day = ?`,
                    args: [activeCompanyId, todayStr]
                },
                // 2. Stats del mes desde tabla agregada (RÁPIDO - solo ~30 registros)
                {
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
                },
                // 3. Utilidad de HOY (desde tabla precalculada - SUPER RÁPIDO)
                {
                    sql: `SELECT COALESCE(SUM(total_profit), 0) as total_profit
                          FROM product_daily_profit
                          WHERE company_id = ? AND day = ?`,
                    args: [activeCompanyId, todayStr]
                },
                // 4. Ventas recientes (para lista de actividad)
                {
                    sql: `SELECT s.*, u.name as user_name
                          FROM sales s
                          LEFT JOIN users u ON s.user_id = u.id
                          WHERE s.company_id = ?
                          ORDER BY s.date DESC
                          LIMIT 20`,
                    args: [activeCompanyId]
                },
                // 5. Productos con bajo stock
                {
                    sql: "SELECT * FROM products WHERE company_id = ? AND stock <= 0 LIMIT 20",
                    args: [activeCompanyId]
                },
                // 6. Productos más vendidos HOY (desde tabla precalculada)
                {
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
                }
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

    fetchProductLotsReport: async (limit = 30, offset = 0) => {
        const { activeCompanyId } = get();
        try {
            // Fetch lots joined with products to get all details in one go
            const sql = "SELECT pl.*, " +
                "p.name as p_name, p.sku as p_sku, p.image as p_image, " +
                "p.stock as p_stock, p.unit as p_unit, p.price as p_price " +
                "FROM product_lots pl " +
                "JOIN products p ON pl.product_id = p.id " +
                "WHERE pl.company_id = ? AND pl.quantity > 0 " +
                "ORDER BY pl.expiry_date ASC " +
                "LIMIT ? OFFSET ?";

            const res = await turso.execute({ sql, args: [activeCompanyId, limit, offset] });

            return res.rows.map(row => ({
                id: row.id,
                product_id: row.product_id,
                batch_number: row.batch_number,
                expiry_date: row.expiry_date,
                quantity: row.quantity,
                cost: row.cost,
                supplier_name: row.supplier_name,
                created_at: row.created_at,
                // Product embedded info
                product_name: row.p_name,
                product_sku: row.p_sku,
                product_image: row.p_image,
                product_stock: row.p_stock,
                product_unit: row.p_unit,
                product_price: row.p_price
            }));

        } catch (e) {
            console.error("Error fetching product profit report:", e);
            return [];
        }
    },

    fetchProductLotsGlobalStats: async () => {
        const { activeCompanyId, currentCompanyTimezone } = get();
        try {
            // Calculate stats server-side
            const today = new Date().toISOString().split('T')[0];
            // Calc date + 30 days for "near expiry" (matching the default logic in component)
            const d = new Date();
            d.setDate(d.getDate() + 30);
            const nextMonth = d.toISOString().split('T')[0];

            const sql = `
                SELECT 
                    COUNT(*) as total_lots,
                    COUNT(DISTINCT product_id) as total_products,
                    SUM(CASE WHEN expiry_date < ? THEN 1 ELSE 0 END) as expired_lots,
                    SUM(CASE WHEN expiry_date >= ? AND expiry_date <= ? THEN 1 ELSE 0 END) as near_expiry_lots,
                    SUM(CASE WHEN expiry_date < ? THEN (cost * quantity) ELSE 0 END) as expiry_value_lost,
                    SUM(CASE WHEN (expiry_date >= ? OR expiry_date IS NULL) AND NOT (expiry_date >= ? AND expiry_date <= ?) THEN 1 ELSE 0 END) as valid_lots
                FROM product_lots 
                WHERE company_id = ? AND quantity > 0
            `;
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
                            const netPrice = price;
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
                sql: "INSERT INTO users (name, username, password, role, company_id) VALUES (?, ?, ?, ?, ?) RETURNING *",
                args: [user.name, user.username, user.password || '123456', user.role, activeCompanyId]
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
        if (!currentUser || currentUser.role !== 'Administrador') {
            console.error('❌ Permission denied: Only administrators can update users');
            return {
                success: false,
                error: 'Acceso denegado. Solo administradores pueden modificar usuarios.'
            };
        }

        try {
            await turso.execute({
                sql: "UPDATE users SET name = ?, username = ?, role = ? WHERE id = ? AND company_id = ?",
                args: [updatedUser.name, updatedUser.username, updatedUser.role, id, activeCompanyId]
            });

            // If a password is provided (and it's not empty), update it separately or include it.
            if (updatedUser.password) {
                await turso.execute({
                    sql: "UPDATE users SET password = ? WHERE id = ? AND company_id = ?",
                    args: [updatedUser.password, id, activeCompanyId]
                });
            }

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

    addProduct: async (product) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            const result = await turso.execute({
                sql: "INSERT INTO products (name, price, stock, category, sku, image, cost, tax_rate, unit, supplier, is_offer, offer_price, price_ranges, scale_group_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
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
                    activeCompanyId
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

            set((state) => ({ products: [...state.products, newProduct].sort((a, b) => a.name.localeCompare(b.name)) }));
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

            await turso.execute({
                sql: "UPDATE products SET name=?, price=?, stock=?, category=?, sku=?, image=?, cost=?, tax_rate=?, unit=?, supplier=?, is_offer=?, offer_price=?, price_ranges=?, scale_group_id=? WHERE id = ? AND company_id = ?",
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
                    id,
                    activeCompanyId
                ]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'UPDATE', 'PRODUCT', JSON.stringify({ id, updates: updatedProduct }), new Date().toISOString()]
            });

            set((state) => ({
                products: state.products.map((p) => p.id === id ? { ...p, ...updatedProduct } : p)
            }));
            return { success: true };
        } catch (e) {
            console.error("Update product error", e);
            return { success: false, error: e.message };
        }
    },

    deleteProduct: async (id) => {
        try {
            const { activeCompanyId, currentUser, validateCompanyAccess } = get();
            if (!validateCompanyAccess(currentUser?.id, activeCompanyId)) return { success: false, error: "Access Denied" };

            await turso.execute({
                sql: "DELETE FROM products WHERE id = ? AND company_id = ?",
                args: [id, activeCompanyId]
            });

            // Audit
            await turso.execute({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'DELETE', 'PRODUCT', JSON.stringify({ id }), new Date().toISOString()]
            });

            set((state) => ({
                products: state.products.filter((p) => p.id !== id)
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
                sql: "INSERT INTO categories (name, color, status, show_in_pos, company_id) VALUES (?, ?, ?, ?, ?) RETURNING *",
                args: [category.name, category.color, category.status || 'active', category.showInPos !== false ? 1 : 0, activeCompanyId]
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
            const { categories, products } = get();
            const oldCategory = categories.find(c => c.id === id);

            if (!oldCategory) return { success: false, error: "Category not found" };

            const nameChanged = oldCategory.name !== updatedCategory.name;

            // 2. Transaction: Update Category + (Optional) Update Products
            const queries = [
                {
                    sql: "UPDATE categories SET name = ?, color = ?, status = ?, show_in_pos = ? WHERE id = ? AND company_id = ?",
                    args: [
                        updatedCategory.name,
                        updatedCategory.color,
                        updatedCategory.status,
                        updatedCategory.showInPos !== false ? 1 : 0,
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

            // Refresh available companies
            await get().fetchUserCompanies(currentUser.id);

            return { success: true };
        } catch (e) {
            console.error("Create company error", e);
            return { success: false, error: e.message };
        }
    },

    toggleCompanyStatus: async (companyId, newStatus) => {
        try {
            const { turso, currentUser } = get(); // Ensure currentUser is available
            // If checking permissions:
            // if (currentUser?.role !== 'super_admin') ... 
            // Reuse existing logic but ensure fetchAllSubscriptions is added next.

            await turso.execute({
                sql: "UPDATE companies SET status = ?, updated_at = ? WHERE id = ?",
                args: [newStatus, new Date().toISOString(), companyId]
            });
            return { success: true };
        } catch (error) {
            console.error('Error toggling company status:', error);
            return { success: false, error: 'Database error' };
        }
    },

    checkSubscriptionStatus: async (companyId) => {
        try {
            const { turso } = get();
            const res = await turso.execute({
                sql: "SELECT status, trial_ends_at, subscription_id FROM companies WHERE id = ?",
                args: [companyId]
            });
            return res.rows[0];
        } catch (e) {
            console.error(e);
            return null;
        }
    },

    fetchAllSubscriptions: async () => {
        try {
            const { turso } = get();
            const result = await turso.execute({
                sql: `SELECT 
                        c.id as company_id,
                        c.name as company_name,
                        c.status as company_status,
                        c.trial_ends_at,
                        c.created_at,
                        s.id as subscription_id,
                        s.plan_id,
                        s.status as subscription_status,
                        s.amount,
                        s.current_period_start,
                        s.current_period_end,
                        sp.name as plan_name
                      FROM companies c
                      LEFT JOIN subscriptions s ON c.subscription_id = s.id
                      LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
                      ORDER BY c.created_at DESC`
            });
            return result.rows;
        } catch (error) {
            console.error('Error fetching subscriptions:', error);
            return [];
        }
    },


    // Purchases
    addPurchase: async (purchase) => {
        try {
            const { currentUser, activeCompanyId, validateCompanyAccess } = get();

            // 0. Security Validation
            if (!validateCompanyAccess(currentUser ? currentUser.id : null, activeCompanyId)) {
                return { success: false, error: "Access Denied" };
            }

            const itemsJson = JSON.stringify(purchase.items);

            // Transaction: Insert Purchase + Update Product Stock/Cost
            const queries = [
                {
                    sql: "INSERT INTO purchases (supplier_id, supplier_name, invoice_number, date, total, items, status, user_id, is_credit, credit_days, expiry_date, deposit, payment_method, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                        activeCompanyId
                    ]
                }
            ];

            // For each item, update stock, cost AND supplier in products table
            purchase.items.forEach(item => {
                queries.push({
                    sql: "UPDATE products SET stock = stock + ?, cost = ?, price = ?, sku = ?, tax_rate = ?, supplier = ? WHERE id = ? AND company_id = ?",
                    args: [item.quantity, item.cost, item.price, item.sku, item.tax || 0, purchase.supplierName, item.id, activeCompanyId]
                });

                // Create Lot
                queries.push({
                    sql: "INSERT INTO product_lots (product_id, batch_number, expiry_date, quantity, cost, supplier_name, created_at, status, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)",
                    args: [
                        item.id,
                        item.batchNumber || '',
                        item.expiryDate || null,
                        item.quantity,
                        item.cost,
                        purchase.supplierName,
                        new Date().toISOString(),
                        activeCompanyId
                    ]
                });
            });

            // Audit
            queries.push({
                sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                args: [activeCompanyId, currentUser?.id, 'CREATE', 'PURCHASE', JSON.stringify({ total: purchase.total }), new Date().toISOString()]
            });

            await turso.batch(queries);

            // Refetch lots or simulate (Optimistic)
            const newLots = purchase.items.map(item => ({
                id: `temp - ${Date.now()} - ${item.id}`, // Temp ID
                product_id: item.id,
                batch_number: item.batchNumber || '',
                expiry_date: item.expiryDate || null,
                quantity: parseFloat(item.quantity),
                cost: parseFloat(item.cost),
                supplier_name: purchase.supplierName,
                created_at: new Date().toISOString(),
                status: 'active',
                company_id: activeCompanyId
            }));

            // We need newPurchase object primarily for state update
            const newPurchase = {
                ...purchase,
                id: Date.now(),
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
                            stock: parseFloat(p.stock) + parseFloat(purchasedItem.quantity),
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

            return { success: true };
        } catch (e) {
            console.error("Add purchase error", e);
            return { success: false, error: e.message };
        }
    },

    fetchPurchases: async (offset = 0) => {
        try {
            const { activeCompanyId } = get();
            // Optimized query: Not selecting 'items' to keep list lightweight
            const result = await turso.execute({
                sql: "SELECT id, supplier_name, invoice_number, date, total, status, is_credit, credit_days, expiry_date, deposit, payment_method, company_id FROM purchases WHERE company_id = ? ORDER BY date DESC LIMIT 50 OFFSET ?",
                args: [activeCompanyId, offset]
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
        const { carts, nextCartId } = get();

        if (carts.length >= 3) {
            alert('Máximo 3 carritos simultáneos');
            return;
        }

        const newCart = {
            id: nextCartId,
            name: `Ticket ${carts.length + 1}`,
            items: [],
            client: null,
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
                offer_price: product.offer_price
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
        try {
            const { productLots, products, currentUser, activeCompanyId, validateCompanyAccess } = get();

            // ============================================
            // 🆕 VALIDACIÓN DE DATOS
            // ============================================

            // Validar estructura básica de la venta
            if (!sale || typeof sale !== 'object') {
                console.error('❌ Venta inválida:', sale);
                return { success: false, error: 'Datos de venta inválidos' };
            }

            if (!Array.isArray(sale.items) || sale.items.length === 0) {
                console.error('❌ Venta sin items');
                return { success: false, error: 'La venta debe tener al menos un producto' };
            }

            // Validar total de venta
            const saleTotal = parseFloat(sale.total);
            if (isNaN(saleTotal) || saleTotal < 0) {
                console.error('❌ Total de venta inválido:', sale.total);
                return { success: false, error: 'Total de venta inválido' };
            }

            // Validar cada item
            for (let i = 0; i < sale.items.length; i++) {
                const item = sale.items[i];

                // Validar ID y nombre
                if (!item.id) {
                    console.error(`❌ Item ${i + 1} sin ID`);
                    return { success: false, error: `Producto ${i + 1} sin identificador` };
                }

                if (!item.name || typeof item.name !== 'string') {
                    console.error(`❌ Item ${i + 1} sin nombre`);
                    return { success: false, error: `Producto ${i + 1} sin nombre válido` };
                }

                // Validar cantidad
                const quantity = parseFloat(item.quantity);
                if (isNaN(quantity) || quantity <= 0) {
                    console.error(`❌ Cantidad inválida para ${item.name}:`, item.quantity);
                    return { success: false, error: `Cantidad inválida para ${item.name}` };
                }

                // Validar precio
                const price = parseFloat(item.price);
                if (isNaN(price) || price < 0) {
                    console.error(`❌ Precio inválido para ${item.name}:`, item.price);
                    return { success: false, error: `Precio inválido para ${item.name}` };
                }

                // Validar costo (puede ser 0 pero no negativo ni NaN)
                const cost = parseFloat(item.cost);
                if (isNaN(cost) || cost < 0) {
                    console.error(`❌ Costo inválido para ${item.name}:`, item.cost);
                    return { success: false, error: `Costo inválido para ${item.name}` };
                }

                // Validar tax_rate (opcional pero si existe debe ser válido)
                if (item.tax_rate !== undefined && item.tax_rate !== null) {
                    const taxRate = parseFloat(item.tax_rate);
                    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
                        console.error(`❌ Tasa de impuesto inválida para ${item.name}:`, item.tax_rate);
                        return { success: false, error: `Tasa de impuesto inválida para ${item.name}` };
                    }
                }

                // Normalizar valores (convertir strings a números)
                sale.items[i] = {
                    ...item,
                    quantity: quantity,
                    price: price,
                    cost: cost,
                    tax_rate: item.tax_rate ? parseFloat(item.tax_rate) : 0
                };
            }

            // Validar método de pago
            if (!sale.paymentMethod || typeof sale.paymentMethod !== 'string') {
                console.error('❌ Método de pago inválido:', sale.paymentMethod);
                return { success: false, error: 'Método de pago inválido' };
            }

            // Normalizar sale.total
            sale.total = saleTotal;

            console.log('✅ Validación de datos completada');

            // ============================================
            // FIN VALIDACIÓN
            // ============================================

            // 0. Security Validation
            if (!validateCompanyAccess(currentUser ? currentUser.id : null, activeCompanyId)) {
                console.error("Access Denied: User cannot add sale to this company.");
                return { success: false, error: "Acceso denegado." };
            }

            // Validation: Check strict stock availability (Legacy + Valid Lots)
            for (const item of sale.items) {
                const product = products.find(p => p.id === item.id);

                // Extra Security: Ensure product belongs to active company (implicitly checked if products are filtered, but good to be explicit if we fetched all)
                // Since 'products' in state are already filtered by activeCompanyId in fetchInitialData, this is safe.

                if (!product) continue;

                // 1. Calculate specific lot stats
                const itemLots = productLots.filter(l => l.product_id === item.id && l.quantity > 0);
                const totalLotQty = itemLots.reduce((sum, l) => sum + l.quantity, 0);

                // 2. Calculate Legacy Stock (Stock not in any lot)
                const legacyStock = Math.max(0, product.stock - totalLotQty);

                // 3. Calculate Valid Lot Stock (Not expired)
                const today = new Date().toISOString().split('T')[0];
                const validLotStock = itemLots
                    .filter(l => !l.expiry_date || l.expiry_date >= today)
                    .reduce((sum, l) => sum + l.quantity, 0);

                const totalSellable = legacyStock + validLotStock;
                const { inventoryAdjustmentMode } = get();

                if (item.quantity > totalSellable) {
                    if (inventoryAdjustmentMode) {
                        // In adjustment mode, we allow selling but strictly block expired lots if NO other option?
                        // Actually requirements say: "Never sell expired lots".
                        // Logic below handles deduction. Here we just bypass quantity check.
                        // But we verify we aren't literally forced to pull from an expired lot?
                        // If totalSellable is 0, it means we have NO valid stock.
                        // In adjustment mode, we sell "virtual/negative" stock. We do NOT touch expired lots.
                        // So we proceed.
                    } else {
                        // Fail the entire sale if one item exceeds valid stock
                        console.error(`Attempted to sell ${item.quantity} of ${product.name}, but only ${totalSellable} is valid / legacy. (Expired blocked)`);
                        return { success: false, error: `Stock insuficiente(Vencido / No disponible) para: ${product.name}` };
                    }
                }
            }

            // Transaction: Insert Sale + Deduct Stock
            const itemsJson = JSON.stringify(sale.items);
            const detailsJson = JSON.stringify(sale.paymentDetails);
            const { inventoryAdjustmentMode } = get();

            // Check if this sale triggers negative stock
            let saleHasNegativeStock = false;

            // Re-check logic to flag products
            const productsToMarkPending = [];

            for (const item of sale.items) {
                const product = products.find(p => p.id === item.id);
                if (!product) continue;
                const itemLots = productLots.filter(l => l.product_id === item.id && l.quantity > 0);
                const totalLotQty = itemLots.reduce((sum, l) => sum + l.quantity, 0);
                const legacyStock = Math.max(0, product.stock - totalLotQty);
                const today = new Date().toISOString().split('T')[0];
                const validLotStock = itemLots
                    .filter(l => !l.expiry_date || l.expiry_date >= today)
                    .reduce((sum, l) => sum + l.quantity, 0);

                if (item.quantity > (legacyStock + validLotStock)) {
                    saleHasNegativeStock = true;
                    productsToMarkPending.push(item.id);
                }
            }

            // 🆕 INICIO DE TRANSACCIÓN EXPLÍCITA
            const tx = await turso.transaction('write');

            try {
                // 1. Insert Sale
                await tx.execute({
                    sql: "INSERT INTO sales (date, total, summary, items, payment_method, payment_details, user_id, status, has_negative_stock, client_id, client_name, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)",
                    args: [
                        getNowInCompanyTime(get().currentCompanyTimezone).toISOString(),
                        sale.total,
                        sale.summary,
                        itemsJson,
                        sale.paymentMethod,
                        detailsJson,
                        currentUser ? currentUser.id : null,
                        saleHasNegativeStock ? 1 : 0,
                        sale.client ? sale.client.id : null,
                        sale.client ? sale.client.name : null,
                        activeCompanyId
                    ]
                });

                // 2. Update sales_daily_summary
                const todayForSummary = new Date();
                const todayStr = formatInCompanyTime(todayForSummary, get().currentCompanyTimezone, 'yyyy-MM-dd');

                await tx.execute({
                    sql: `INSERT INTO sales_daily_summary (company_id, day, total_sales, total_orders, updated_at)
                          VALUES (?, ?, ?, 1, ?)
                          ON CONFLICT(company_id, day) 
                          DO UPDATE SET 
                            total_sales = total_sales + excluded.total_sales,
                            total_orders = total_orders + 1,
                            updated_at = excluded.updated_at`,
                    args: [
                        activeCompanyId,
                        todayStr,
                        sale.total,
                        new Date().toISOString()
                    ]
                });

                // 3. Update product_daily_profit por cada producto
                for (const item of sale.items) {
                    const quantity = parseFloat(item.quantity);
                    const price = parseFloat(item.price) || 0;
                    const cost = parseFloat(item.cost) || 0;
                    const taxRate = parseFloat(item.tax_rate) || 0;

                    const totalRevenue = price * quantity;
                    const totalCost = cost * quantity;
                    const netPrice = price / (1 + (taxRate / 100));
                    const profitPerUnit = netPrice - cost;
                    const totalProfit = profitPerUnit * quantity;
                    const totalTax = totalRevenue - (netPrice * quantity);

                    await tx.execute({
                        sql: `INSERT INTO product_daily_profit 
                              (company_id, product_id, day, total_quantity, total_revenue, total_cost, total_tax, total_profit, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                              ON CONFLICT(company_id, product_id, day) 
                              DO UPDATE SET 
                                total_quantity = total_quantity + excluded.total_quantity,
                                total_revenue = total_revenue + excluded.total_revenue,
                                total_cost = total_cost + excluded.total_cost,
                                total_tax = total_tax + excluded.total_tax,
                                total_profit = total_profit + excluded.total_profit,
                                updated_at = excluded.updated_at`,
                        args: [
                            activeCompanyId,
                            item.id,
                            todayStr,
                            quantity,
                            totalRevenue,
                            totalCost,
                            totalTax,
                            totalProfit,
                            new Date().toISOString()
                        ]
                    });

                    console.log(`📊 Updating product_daily_profit: ${item.name}, qty: ${quantity}, profit: $${totalProfit.toFixed(2)}`);
                }

                // 4. Process stock deduction
                const updatedLots = [...productLots];

                for (const item of sale.items) {
                    // Deduct from total stock
                    await tx.execute({
                        sql: "UPDATE products SET stock = stock - ? WHERE id = ? AND company_id = ?",
                        args: [item.quantity, item.id, activeCompanyId]
                    });

                    if (productsToMarkPending.includes(item.id)) {
                        await tx.execute({
                            sql: "UPDATE products SET pending_adjustment = 1 WHERE id = ? AND company_id = ?",
                            args: [item.id, activeCompanyId]
                        });
                    }

                    // Deduct from Lots (FEFO Logic)
                    const today = new Date().toISOString().split('T')[0];
                    let remainingQty = parseFloat(item.quantity);

                    const validLots = updatedLots
                        .filter(l => l.product_id === item.id && l.quantity > 0)
                        .sort((a, b) => {
                            if (!a.expiry_date) return 1;
                            if (!b.expiry_date) return -1;
                            return new Date(a.expiry_date) - new Date(b.expiry_date);
                        });

                    for (const lot of validLots) {
                        if (remainingQty <= 0) break;
                        if (lot.expiry_date && lot.expiry_date < today) continue;

                        const deduct = Math.min(lot.quantity, remainingQty);

                        await tx.execute({
                            sql: "UPDATE product_lots SET quantity = quantity - ? WHERE id = ?",
                            args: [deduct, lot.id]
                        });

                        lot.quantity -= deduct;
                        remainingQty -= deduct;
                    }
                }

                // 5. Update cash register (solo si existe y está abierta)
                // Re-obtener cashRegister del store para evitar referencias obsoletas
                const currentCashRegister = get().cashRegister;

                if (currentCashRegister && currentCashRegister.id) {
                    console.log('📦 Updating cash register balance:', currentCashRegister.id);
                    try {
                        await tx.execute({
                            sql: "UPDATE cash_registers SET current_balance = current_balance + ? WHERE id = ? AND company_id = ?",
                            args: [sale.total, currentCashRegister.id, activeCompanyId]
                        });
                    } catch (cashRegisterError) {
                        console.warn('⚠️ Failed to update cash register:', cashRegisterError);
                        // No lanzar error, permitir que venta se complete
                    }
                } else {
                    console.log('ℹ️ No cash register open, skipping balance update (this is normal)');
                }

                // 6. Audit Log
                await tx.execute({
                    sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    args: [
                        activeCompanyId,
                        currentUser ? currentUser.id : null,
                        'CREATE',
                        'SALE',
                        JSON.stringify({ total: sale.total, itemsCount: sale.items.length }),
                        new Date().toISOString()
                    ]
                });

                // 🆕 COMMIT: Todo salió bien
                await tx.commit();
                console.log('✅ Sale transaction committed successfully');

                // Update local state (Copied from existing logic)
                set((state) => ({
                    sales: [{
                        ...sale,
                        id: Date.now(),
                        date: new Date().toISOString(),
                        status: 'completed',
                        clientId: sale.client ? sale.client.id : null,
                        clientName: sale.client ? sale.client.name : null,
                        company_id: activeCompanyId
                    }, ...state.sales],
                    productLots: updatedLots,
                    products: state.products.map(p => {
                        const soldItem = sale.items.find(i => i.id === p.id);
                        if (soldItem) {
                            const isPending = productsToMarkPending.includes(p.id);
                            return {
                                ...p,
                                stock: p.stock - soldItem.quantity,
                                pending_adjustment: isPending ? 1 : (p.pending_adjustment || 0)
                            };
                        }
                        return p;
                    })
                }));

                // Force refresh
                get().fetchSales();
                const postSaleCashRegister = get().cashRegister;
                if (postSaleCashRegister && postSaleCashRegister.id) {
                    get().refreshRegisterStats(postSaleCashRegister.id);
                }

                return { success: true };

            } catch (error) {
                // 🆕 ROLLBACK: Revertir todo si falla
                await tx.rollback();
                console.error('❌ Sale transaction failed, rolled back:', error);
                return { success: false, error: error.message };
            }



        } catch (e) {
            console.error("Sales transaction error", e);
            return { success: false, error: e.message };
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

            // Safe Parsing of date for daily profit update
            const saleDateObj = new Date(sale.date);
            const saleDay = !isNaN(saleDateObj.getTime())
                ? saleDateObj.toISOString().split('T')[0]
                : new Date().toISOString().split('T')[0];

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
                    sql: "UPDATE products SET stock = stock + ? WHERE id = ? AND company_id = ?",
                    args: [item.quantity, item.id, activeCompanyId]
                });

                // B. Revert Product Daily Profit (Reports)
                // Calculate values to subtract
                const revenue = item.price * item.quantity;
                const cost = (item.cost || 0) * item.quantity;
                const taxRate = item.tax_rate || 0;
                // Net price logic should match addSale: price / (1 + tax/100)
                const netPrice = item.price / (1 + (taxRate / 100));
                const totalTax = revenue - (netPrice * item.quantity);
                const totalProfit = (netPrice - (item.cost || 0)) * item.quantity;

                queries.push({
                    sql: `UPDATE product_daily_profit 
                           SET total_quantity = total_quantity - ?,
                               total_revenue = total_revenue - ?,
                               total_cost = total_cost - ?,
                               total_tax = total_tax - ?,
                               total_profit = total_profit - ?
                           WHERE product_id = ? AND day = ? AND company_id = ?`,
                    args: [item.quantity, revenue, cost, totalTax, totalProfit, item.id, saleDay, activeCompanyId]
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
            // This assumes cancellation implies returning money from the current drawer
            if (cashRegister && cashRegister.id) {
                queries.push({
                    sql: "UPDATE cash_registers SET current_balance = current_balance - ? WHERE id = ? AND company_id = ?",
                    args: [sale.total, cashRegister.id, activeCompanyId]
                });

                // Audit Refund
                queries.push({
                    sql: "INSERT INTO audit_logs (company_id, user_id, action, entity, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    args: [activeCompanyId, currentUser?.id, 'REFUND', 'SALE', JSON.stringify({ saleId, total: sale.total, reason: observation }), new Date().toISOString()]
                });
            }

            // 5. Update Daily Sales Summary
            queries.push({
                sql: `UPDATE sales_daily_summary 
                      SET total_sales = total_sales - ?, 
                          total_orders = total_orders - 1 
                      WHERE day = ? AND company_id = ?`,
                args: [sale.total, saleDay, activeCompanyId]
            });

            // Execute Batch Transaction
            await turso.batch(queries);

            // 5. Update Local State
            set(state => ({
                sales: state.sales.map(s => s.id === saleId ? { ...s, status: 'cancelled', observation } : s),

                // Optimistically update products stock in UI
                products: state.products.map(p => {
                    const item = items.find(i => i.id === p.id);
                    if (item) {
                        return { ...p, stock: (parseFloat(p.stock) || 0) + parseFloat(item.quantity) };
                    }
                    return p;
                }),

                // Update local cash register balance if matches
                cashRegister: (state.cashRegister && cashRegister && state.cashRegister.id === cashRegister.id)
                    ? { ...state.cashRegister, current_balance: (state.cashRegister.current_balance || 0) - sale.total }
                    : state.cashRegister
            }));

            return true;

        } catch (e) {
            console.error("Cancel sale error", e);
            return false;
        }
    },

    registerClientPayment: async (client, amount, salesIds, paymentMethod) => {
        try {
            const { currentUser, sales, products } = get();

            // 1. Create a "Payment" Sale entry (So it appears in daily cash register)
            const paymentSale = {
                date: getNowInCompanyTime(get().currentCompanyTimezone).toISOString(),
                total: amount,
                summary: `Abono de Cliente: ${client.name}`,
                items: JSON.stringify([{
                    id: 'payment-adj',
                    name: `Abono / Pago de Deuda(${salesIds.length} boletas)`,
                    price: amount,
                    quantity: 1,
                    unit: 'Und'
                }]),
                payment_method: paymentMethod,
                payment_details: JSON.stringify({ amount: amount, change: 0, type: 'debt_payment' }),
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

            // 2. Update the status of the Paid Sales
            salesIds.forEach(id => {
                queries.push({
                    sql: "UPDATE sales SET status = 'paid' WHERE id = ?",
                    args: [Number(id)]
                });
            });

            await turso.batch(queries);

            // 3. Update Local State
            set(state => ({
                sales: [
                    { ...paymentSale, id: Date.now(), items: JSON.parse(paymentSale.items), paymentDetails: JSON.parse(paymentSale.payment_details) }, // Add the new "payment" sale
                    ...state.sales.map(s => salesIds.includes(s.id) ? { ...s, status: 'paid' } : s) // Mark old ones as paid
                ]
            }));

            // 4. Force Fetch from DB to ensure consistency
            await get().fetchSales();

            // 5. Refresh Register
            const { cashRegister, refreshRegisterStats } = get();
            if (cashRegister) {
                refreshRegisterStats(cashRegister.id);
            }

            return { success: true };

        } catch (e) {
            console.error("Register payment error", e);
            return { success: false, error: e.message };
        }
    },

    // Cash Register Logic
    cashRegister: null,

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
            const [salesStatsRes, movementsRes, recentSalesRes] = await turso.batch([
                // Query agregado para stats de ventas (MUY RÁPIDO)
                {
                    sql: `SELECT 
                            COUNT(*) as total_sales,
                            SUM(CASE WHEN payment_method = 'Efectivo' THEN total ELSE 0 END) as cash_total,
                            SUM(CASE WHEN payment_method = 'Tarjeta' THEN total ELSE 0 END) as card_total,
                            SUM(CASE WHEN payment_method = 'Transferencia' THEN total ELSE 0 END) as transfer_total,
                            SUM(total) as total_sales_amount
                          FROM sales 
                          WHERE user_id = ? 
                          AND date >= ? 
                          AND company_id = ?`,
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
                          AND (payment_method = 'Efectivo' OR payment_method = 'Mixto')
                          ORDER BY date DESC 
                          LIMIT 20`,
                    args: [register.user_id, openingTime, activeCompanyId]
                }
            ]);

            // 3. Procesar stats de ventas (ya viene agregado, super rápido)
            const salesStats = salesStatsRes.rows[0] || {
                cash_total: 0,
                card_total: 0,
                transfer_total: 0,
                total_sales_amount: 0
            };

            let cashSalesTotal = parseFloat(salesStats.cash_total) || 0;
            const salesBreakdown = {
                cash: cashSalesTotal,
                card: parseFloat(salesStats.card_total) || 0,
                transfer: parseFloat(salesStats.transfer_total) || 0,
                total: parseFloat(salesStats.total_sales_amount) || 0
            };

            // 4. Para ventas Mixtas, necesitamos procesarlas (solo si hay)
            const mixedSalesRes = await turso.execute({
                sql: `SELECT total, payment_details 
                      FROM sales 
                      WHERE user_id = ? 
                      AND date >= ? 
                      AND company_id = ?
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

    // Historical Reports
    fetchClosedRegisters: async (limit = 20, offset = 0) => {
        try {
            const { activeCompanyId } = get();

            // Get total count first (optional but good for UI)
            /* 
            const countResult = await turso.execute({
                sql: "SELECT COUNT(*) as total FROM cash_registers WHERE status = 'closed' AND company_id = ?",
                args: [activeCompanyId]
            });
            const totalCount = countResult.rows[0].total; 
            */

            const result = await turso.execute({
                sql: `SELECT cr.*, u.name as user_name 
                      FROM cash_registers cr 
                      LEFT JOIN users u ON cr.user_id = u.id 
                      WHERE cr.status = 'closed' AND cr.company_id = ?
                      ORDER BY cr.closing_time DESC
                      LIMIT ? OFFSET ?`,
                args: [activeCompanyId, limit, offset]
            });

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

    fetchCashMovements: async (limit = 20, offset = 0) => {
        try {
            const { activeCompanyId } = get();
            console.log(`Fetching cash movements (limit: ${limit}, offset: ${offset}) for company:`, activeCompanyId);

            // 1. Fetch Registers (Paginated)
            const registersRes = await turso.execute({
                sql: `SELECT cr.*, u.name as user_name 
                      FROM cash_registers cr 
                      LEFT JOIN users u ON cr.user_id = u.id 
                      WHERE cr.company_id = ? 
                      ORDER BY cr.opening_time DESC 
                      LIMIT ? OFFSET ?`,
                args: [activeCompanyId, limit, offset]
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
            const salesBreakdown = { cash: 0, card: 0, transfer: 0, total: 0 };

            salesRes.rows.forEach(sale => {
                const total = parseFloat(sale.total);
                salesBreakdown.total += total;

                let cashPart = 0;
                let cardPart = 0;
                let transferPart = 0;

                if (sale.payment_method === 'Efectivo') {
                    cashPart = total;
                } else if (sale.payment_method === 'Tarjeta') {
                    cardPart = total;
                } else if (sale.payment_method === 'Transferencia') {
                    transferPart = total;
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
    // 🆕 FUNCIONES DE SUSCRIPCIÓN
    // ============================================

    // Verificar estado de suscripción de una empresa
    checkSubscriptionStatus: async (companyId) => {
        try {
            const { turso } = get();
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

    // Obtener todas las suscripciones (Admin)
    fetchAllSubscriptions: async () => {
        try {
            const { turso } = get();
            const result = await turso.execute({
                sql: `SELECT 
                        c.id as company_id,
                        c.name as company_name,
                        c.status as company_status,
                        s.id as subscription_id,
                        s.plan_id,
                        s.status as subscription_status,
                        s.amount,
                        s.current_period_start,
                        s.current_period_end,
                        sp.name as plan_name
                      FROM companies c
                      LEFT JOIN subscriptions s ON c.subscription_id = s.id
                      LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
                      ORDER BY c.created_at DESC`
            });

            return result.rows;
        } catch (error) {
            console.error('Error fetching subscriptions:', error);
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
            const result = await turso.execute({
                sql: `SELECT m.*,
                             (SELECT COUNT(*) FROM support_attachments WHERE message_id = m.id) as attachment_count
                      FROM support_messages m
                      WHERE m.ticket_id = ? AND m.is_internal_note = 0
                      ORDER BY m.created_at ASC`,
                args: [ticketId]
            });

            return { success: true, messages: result.rows || [] };
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
    replyToTicket: async (ticketId, message, isInternalNote = false) => {
        const { currentUser } = get();

        try {
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();

            await turso.execute({
                sql: `INSERT INTO support_messages 
                      (id, ticket_id, sender_type, sender_id, sender_name, message, created_at, is_internal_note, read_by_client)
                      VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 0)`,
                args: [messageId, ticketId, currentUser.id.toString(), currentUser.name || 'Admin', message, now, isInternalNote ? 1 : 0]
            });

            if (!isInternalNote) {
                await turso.execute({
                    sql: `UPDATE support_tickets 
                          SET updated_at = ?, last_message_at = ?, unread_by_client = unread_by_client + 1, unread_by_admin = 0
                          WHERE id = ?`,
                    args: [now, now, ticketId]
                });
            }

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
    }
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
