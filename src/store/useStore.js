import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { turso } from '../lib/turso';

export const useStore = create(persist((set, get) => ({
    // Initial State
    products: [],
    productLots: [], // New state for lots
    categories: [],
    suppliers: [],
    users: [],
    purchases: [],
    sales: [],
    cart: [],
    activeRegisters: [],
    currentUser: null,
    isLoading: false,
    error: null,
    darkMode: true, // Default to dark mode

    toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

    inventoryAdjustmentMode: localStorage.getItem('pos_inventory_adjustment') === 'true',
    toggleInventoryAdjustmentMode: () => set((state) => {
        const newValue = !state.inventoryAdjustmentMode;
        localStorage.setItem('pos_inventory_adjustment', newValue);
        return { inventoryAdjustmentMode: newValue };
    }),

    // Clients State & Actions
    clients: [],
    posSelectedClient: null,
    setPosSelectedClient: (client) => set({ posSelectedClient: client }),

    addClient: async (client) => {
        try {
            const result = await turso.execute({
                sql: "INSERT INTO clients (name, rut, phone, email, address, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    client.name,
                    client.rut || '',
                    client.phone || '',
                    client.email || '',
                    client.address || '',
                    new Date().toISOString()
                ]
            });
            const newClient = result.rows[0];
            set((state) => ({ clients: [...state.clients, newClient].sort((a, b) => a.name.localeCompare(b.name)) }));
            return { success: true, client: newClient };
        } catch (e) {
            console.error("Add client error", e);
            return { success: false, error: e.message };
        }
    },

    updateClient: async (id, updatedClient) => {
        try {
            await turso.execute({
                sql: "UPDATE clients SET name = ?, rut = ?, phone = ?, email = ?, address = ? WHERE id = ?",
                args: [updatedClient.name, updatedClient.rut, updatedClient.phone, updatedClient.email, updatedClient.address, id]
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
            await turso.execute({
                sql: "DELETE FROM clients WHERE id = ?",
                args: [id]
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
    fetchInitialData: async () => {
        set({ isLoading: true });
        try {
            const productsRes = await turso.execute("SELECT * FROM products");

            // Initialize product_lots table if not exists
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
                    status TEXT DEFAULT 'active'
                )
            `);

            const productLotsRes = await turso.execute("SELECT * FROM product_lots WHERE quantity > 0 ORDER BY expiry_date ASC");
            const categoriesRes = await turso.execute("SELECT * FROM categories");
            const suppliersRes = await turso.execute("SELECT * FROM suppliers");
            const usersRes = await turso.execute("SELECT * FROM users");
            const salesRes = await turso.execute("SELECT * FROM sales ORDER BY id DESC");

            // Migration: Check if 'show_in_pos' exists in categories
            // Simple check: see if fetched rows have the property or try to query specific column in catch block.
            // Safer way: try to select the column, if error, add it.
            // Actually, `SELECT *` returns everything. If we don't see it in first row (if rows exist) we can't be sure if it's just null?
            // SQLite `PRAGMA table_info(categories)` is robust.

            try {
                const info = await turso.execute("PRAGMA table_info(categories)");
                const hasShowInPos = info.rows.some(col => col.name === 'show_in_pos');
                if (!hasShowInPos) {
                    await turso.execute("ALTER TABLE categories ADD COLUMN show_in_pos BOOLEAN DEFAULT 1");
                    // Refetch categories
                    const refreshedCats = await turso.execute("SELECT * FROM categories");
                    categoriesRes.rows = refreshedCats.rows;
                }

                // Migration: Check if 'pending_adjustment' exists in products
                const prodInfo = await turso.execute("PRAGMA table_info(products)");
                const hasPendingAdjustment = prodInfo.rows.some(col => col.name === 'pending_adjustment');
                if (!hasPendingAdjustment) {
                    await turso.execute("ALTER TABLE products ADD COLUMN pending_adjustment BOOLEAN DEFAULT 0");
                }

                // Migration: Check if 'has_negative_stock' exists in sales
                const saleInfo = await turso.execute("PRAGMA table_info(sales)");
                const hasNegativeStock = saleInfo.rows.some(col => col.name === 'has_negative_stock');
                if (!hasNegativeStock) {
                    await turso.execute("ALTER TABLE sales ADD COLUMN has_negative_stock BOOLEAN DEFAULT 0");
                }

                // Migration: Check if 'client_id' exists in sales
                const hasClientId = saleInfo.rows.some(col => col.name === 'client_id');
                if (!hasClientId) {
                    await turso.execute("ALTER TABLE sales ADD COLUMN client_id INTEGER");
                    await turso.execute("ALTER TABLE sales ADD COLUMN client_name TEXT");
                }

                // Initialize clients table
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
            } catch (err) {
                console.warn("Migration check error", err);
            }

            const products = productsRes.rows;
            const productLots = productLotsRes.rows;
            const categories = categoriesRes.rows.map(c => ({
                ...c,
                showInPos: c.show_in_pos !== 0 // 1 or null -> true, 0 -> false
            }));
            const suppliers = suppliersRes.rows;
            const users = usersRes.rows;
            const clientsRes = await turso.execute("SELECT * FROM clients ORDER BY name ASC");
            const clients = clientsRes.rows;

            const sales = salesRes.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method, // Map snake_case to camelCase
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || '',
                clientId: sale.client_id,
                clientName: sale.client_name
            }));

            set({ products, productLots, categories, suppliers, users, clients, sales, isLoading: false });

            // Fetch active registers initially
            // We call get() to access the action we just defined, but actions are part of the store definition.
            // Since we are inside the store creator, we can't easily call the action from 'get()' if it's not fully constructed yet?
            // Actually in Zustand 'get()' gives access to current state/actions.
            // However, it's safer to just call the logic or call the action after set.
            // Let's call it via get().fetchActiveRegisters() if possible, or just ignore for now and call it in Dashboard.
            // Better to rely on Dashboard mounting to fetch this specific data to avoid overhead on every app load if not needed.
            // actually, let's leave it out of here to avoid circular dependency or issues during init. Dashboard will trigger it.
        } catch (error) {
            console.error("Failed to fetch data:", error);
            set({ error: error.message, isLoading: false });
        }
    },

    fetchSales: async () => {
        try {
            const result = await turso.execute("SELECT * FROM sales ORDER BY id DESC");
            const sales = result.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method,
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || '',
                clientId: sale.client_id,
                clientName: sale.client_name
            }));
            set({ sales });
        } catch (e) {
            console.error("Fetch sales error", e);
        }
    },

    login: async (username, password) => {
        // In a real app, hash passwords!
        try {
            const result = await turso.execute({
                sql: "SELECT * FROM users WHERE username = ? AND password = ?",
                args: [username, password]
            });

            if (result.rows.length > 0) {
                set({ currentUser: result.rows[0] });
                return true;
            }
            return false;
        } catch (e) {
            console.error("Login error", e);
            return false;
        }
    },

    logout: () => set({ currentUser: null }),

    addUser: async (user) => {
        try {
            const result = await turso.execute({
                sql: "INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?) RETURNING *",
                args: [user.name, user.username, user.password || '123456', user.role]
            });
            const newUser = result.rows[0];
            set((state) => ({ users: [...state.users, newUser] }));
        } catch (e) {
            console.error("Add user error", e);
        }
    },

    updateUser: async (id, updatedUser) => {
        try {
            await turso.execute({
                sql: "UPDATE users SET name = ?, username = ?, role = ? WHERE id = ?",
                args: [updatedUser.name, updatedUser.username, updatedUser.role, id]
            });

            // If a password is provided (and it's not empty), update it separately or include it.
            // For simplicity, let's allow password update if provided.
            if (updatedUser.password) {
                await turso.execute({
                    sql: "UPDATE users SET password = ? WHERE id = ?",
                    args: [updatedUser.password, id]
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
        try {
            await turso.execute({
                sql: "DELETE FROM users WHERE id = ?",
                args: [id]
            });
            set((state) => ({ users: state.users.filter(u => u.id !== id) }));
        } catch (e) {
            console.error("Delete user error", e);
        }
    },

    addProduct: async (product) => {
        try {
            const result = await turso.execute({
                sql: "INSERT INTO products (name, price, stock, category, sku, image, cost, tax_rate, unit, supplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
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
                    product.supplier || null
                ]
            });
            const newProduct = result.rows[0];
            set((state) => ({ products: [...state.products, newProduct] }));
        } catch (e) {
            console.error("Add product error", e);
        }
    },

    updateProduct: async (id, updatedProduct) => {
        try {
            await turso.execute({
                sql: "UPDATE products SET name=?, price=?, stock=?, category=?, sku=?, image=?, cost=?, tax_rate=?, unit=?, supplier=? WHERE id = ?",
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
                    id
                ]
            });
            set((state) => ({
                products: state.products.map((p) => p.id === id ? { ...p, ...updatedProduct } : p)
            }));
        } catch (e) {
            console.error("Update product error", e);
        }
    },

    deleteProduct: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM products WHERE id = ?",
                args: [id]
            });
            set((state) => ({
                products: state.products.filter((p) => p.id !== id)
            }));
        } catch (e) {
            console.error("Delete product error", e);
        }
    },

    // Categories
    addCategory: async (category) => {
        try {
            const result = await turso.execute({
                sql: "INSERT INTO categories (name, color, status, show_in_pos) VALUES (?, ?, ?, ?) RETURNING *",
                args: [category.name, category.color, category.status || 'active', category.showInPos !== false ? 1 : 0]
            });
            const newCategory = result.rows[0];
            set((state) => ({ categories: [...state.categories, newCategory] }));
        } catch (e) {
            console.error("Add category error", e);
        }
    },

    updateCategory: async (id, updatedCategory) => {
        try {
            // 1. Find the old category to see if name changed
            const { categories, products } = get();
            const oldCategory = categories.find(c => c.id === id);

            if (!oldCategory) return;

            const nameChanged = oldCategory.name !== updatedCategory.name;

            // 2. Transaction: Update Category + (Optional) Update Products
            const queries = [
                {
                    sql: "UPDATE categories SET name = ?, color = ?, status = ?, show_in_pos = ? WHERE id = ?",
                    args: [
                        updatedCategory.name,
                        updatedCategory.color,
                        updatedCategory.status,
                        updatedCategory.showInPos !== false ? 1 : 0,
                        id
                    ]
                }
            ];

            if (nameChanged) {
                queries.push({
                    sql: "UPDATE products SET category = ? WHERE category = ?",
                    args: [updatedCategory.name, oldCategory.name]
                });
            }

            await turso.batch(queries);

            // 3. Update Local State
            set((state) => ({
                categories: state.categories.map((c) => c.id === id ? { ...c, ...updatedCategory } : c),
                products: nameChanged
                    ? state.products.map(p => p.category === oldCategory.name ? { ...p, category: updatedCategory.name } : p)
                    : state.products
            }));
        } catch (e) {
            console.error("Update category error", e);
        }
    },

    deleteCategory: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM categories WHERE id = ?",
                args: [id]
            });
            set((state) => ({
                categories: state.categories.filter((c) => c.id !== id)
            }));
        } catch (e) {
            console.error("Delete category error", e);
        }
    },

    // Suppliers
    addSupplier: async (supplier) => {
        try {
            const result = await turso.execute({
                sql: "INSERT INTO suppliers (name, phone, email, status) VALUES (?, ?, ?, ?) RETURNING *",
                args: [supplier.name, supplier.phone || '', supplier.email || '', supplier.status || 'active']
            });
            const newSupplier = result.rows[0];
            set((state) => ({ suppliers: [...state.suppliers, newSupplier] }));
        } catch (e) {
            console.error("Add supplier error", e);
        }
    },

    updateSupplier: async (id, updatedSupplier) => {
        try {
            // 1. Find old supplier to check for name change
            const { suppliers } = get();
            const oldSupplier = suppliers.find(s => s.id === id);

            if (!oldSupplier) return;

            const nameChanged = oldSupplier.name !== updatedSupplier.name;

            // 2. Transaction
            const queries = [
                {
                    sql: "UPDATE suppliers SET name = ?, phone = ?, email = ?, status = ? WHERE id = ?",
                    args: [updatedSupplier.name, updatedSupplier.phone, updatedSupplier.email, updatedSupplier.status, id]
                }
            ];

            if (nameChanged) {
                queries.push({
                    sql: "UPDATE products SET supplier = ? WHERE supplier = ?",
                    args: [updatedSupplier.name, oldSupplier.name]
                });
            }

            await turso.batch(queries);

            set((state) => ({
                suppliers: state.suppliers.map((s) => s.id === id ? { ...s, ...updatedSupplier } : s),
                products: nameChanged
                    ? state.products.map(p => p.supplier === oldSupplier.name ? { ...p, supplier: updatedSupplier.name } : p)
                    : state.products
            }));
        } catch (e) {
            console.error("Update supplier error", e);
        }
    },

    deleteSupplier: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM suppliers WHERE id = ?",
                args: [id]
            });
            set((state) => ({
                suppliers: state.suppliers.filter((s) => s.id !== id)
            }));
        } catch (e) {
            console.error("Delete supplier error", e);
        }
    },

    deleteSupplier: async (id) => {
        try {
            await turso.execute({
                sql: "DELETE FROM suppliers WHERE id = ?",
                args: [id]
            });
            set((state) => ({
                suppliers: state.suppliers.filter((s) => s.id !== id)
            }));
        } catch (e) {
            console.error("Delete supplier error", e);
        }
    },

    // Purchases
    addPurchase: async (purchase) => {
        try {
            const { currentUser } = get();
            const itemsJson = JSON.stringify(purchase.items);

            // Transaction: Insert Purchase + Update Product Stock/Cost
            const queries = [
                {
                    sql: "INSERT INTO purchases (supplier_id, supplier_name, invoice_number, date, total, items, status, user_id, is_credit, credit_days, expiry_date, deposit, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                        purchase.paymentMethod || 'Efectivo'
                    ]
                }
            ];

            // For each item, update stock and cost in products table
            purchase.items.forEach(item => {
                queries.push({
                    sql: "UPDATE products SET stock = stock + ?, cost = ?, price = ?, sku = ?, tax_rate = ? WHERE id = ?",
                    args: [item.quantity, item.cost, item.price, item.sku, item.tax || 0, item.id]
                });

                // Create Lot
                queries.push({
                    sql: "INSERT INTO product_lots (product_id, batch_number, expiry_date, quantity, cost, supplier_name, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
                    args: [
                        item.id,
                        item.batchNumber || '', // Ensure batchNumber is passed from UI
                        item.expiryDate || null, // Ensure expiryDate is passed from UI
                        item.quantity,
                        item.cost,
                        purchase.supplierName,
                        new Date().toISOString()
                    ]
                });
            });

            await turso.batch(queries);

            // Refetch lots to get IDs (simpler than predicting)
            // Or just append optimistically? We need IDs for sales ideally, but for now just append.
            // Actually, better to refetch active lots or append a fake one. 
            // Let's refetch logic or just add to store optimistically without ID (risky for updates).
            // Let's fetch all lots again to be safe given the complexity? No, too heavy.
            // Let's just create an optimistic lot.
            const newLots = purchase.items.map(item => ({
                id: `temp-${Date.now()}-${item.id}`, // Temp ID
                product_id: item.id,
                batch_number: item.batchNumber || '',
                expiry_date: item.expiryDate || null,
                quantity: parseFloat(item.quantity),
                cost: parseFloat(item.cost),
                supplier_name: purchase.supplierName,
                created_at: new Date().toISOString(),
                status: 'active'
            }));

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
                            tax_rate: parseFloat(purchasedItem.tax || 0)
                        };
                    }
                    return p;
                })
            }));

            return true;
        } catch (e) {
            console.error("Add purchase error", e);
            return false;
        }
    },

    // Cart (Local Only)
    addToCart: (product) => set((state) => {
        const existing = state.cart.find((item) => item.id === product.id);
        if (existing) {
            return {
                cart: state.cart.map((item) =>
                    item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
                )
            };
        }
        return { cart: [...state.cart, { ...product, quantity: 1, discount: 0 }] };
    }),

    updateCartItem: (productId, updates) => set((state) => ({
        cart: state.cart.map((item) =>
            item.id === productId ? { ...item, ...updates } : item
        )
    })),

    removeFromCart: (productId) => set((state) => ({
        cart: state.cart.filter((item) => item.id !== productId)
    })),

    clearCart: () => set({ cart: [] }),

    fetchSales: async () => {
        try {
            const result = await turso.execute("SELECT * FROM sales ORDER BY id DESC");
            return result.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                clientId: sale.client_id,
                paymentMethod: sale.payment_method,
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || ''
            }));
        } catch (e) {
            console.error("Fetch sales error", e);
            return [];
        }
    },

    addSale: async (sale) => {
        try {
            const { productLots, products, currentUser } = get();

            // Validation: Check strict stock availability (Legacy + Valid Lots)
            for (const item of sale.items) {
                const product = products.find(p => p.id === item.id);
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
                        console.error(`Attempted to sell ${item.quantity} of ${product.name}, but only ${totalSellable} is valid/legacy. (Expired blocked)`);
                        return { success: false, error: `Stock insuficiente (Vencido/No disponible) para: ${product.name}` };
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

            const queries = [
                {
                    sql: "INSERT INTO sales (date, total, summary, items, payment_method, payment_details, user_id, status, has_negative_stock, client_id, client_name) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)",
                    args: [
                        new Date().toISOString(),
                        sale.total,
                        sale.summary,
                        itemsJson,
                        sale.paymentMethod,
                        detailsJson,
                        currentUser ? currentUser.id : null,
                        saleHasNegativeStock ? 1 : 0,
                        sale.client ? sale.client.id : null,
                        sale.client ? sale.client.name : null
                    ]
                }
            ];

            const updatedLots = [...productLots]; // Clone for local update

            // Process stock deduction (FEFO)
            for (const item of sale.items) {
                // 1. Deduct from total stock (Legacy compatibility)
                queries.push({
                    sql: "UPDATE products SET stock = stock - ? WHERE id = ?",
                    args: [item.quantity, item.id]
                });

                if (productsToMarkPending.includes(item.id)) {
                    queries.push({
                        sql: "UPDATE products SET pending_adjustment = 1 WHERE id = ?",
                        args: [item.id]
                    });
                }

                // 2. Deduct from Lots (FEFO)
                // Filter valid lots: matching product, has quantity, not expired
                // (Assuming we already validated stock availability in UI, but good to double check)
                const today = new Date().toISOString().split('T')[0];
                let remainingQty = parseFloat(item.quantity);

                const validLots = updatedLots
                    .filter(l => l.product_id === item.id && l.quantity > 0)
                    .sort((a, b) => {
                        // Sort by expiry date ASC. Null expiry counts as "far future" or "no expiry"? 
                        // Usually no expiry means stable product. Treat as last.
                        if (!a.expiry_date) return 1;
                        if (!b.expiry_date) return -1;
                        return new Date(a.expiry_date) - new Date(b.expiry_date);
                    });

                for (const lot of validLots) {
                    if (remainingQty <= 0) break;

                    // Skip if expired? User said "Un lote vencido NO debe venderse".
                    // If strict:
                    if (lot.expiry_date && lot.expiry_date < today) continue;

                    const deduct = Math.min(lot.quantity, remainingQty);

                    queries.push({
                        sql: "UPDATE product_lots SET quantity = quantity - ? WHERE id = ?",
                        args: [deduct, lot.id]
                    });

                    // Update local lot
                    lot.quantity -= deduct;
                    remainingQty -= deduct;
                }

                // If remainingQty > 0 here, it means we sold more than valid lots have.
                // In Adjustment Mode, we allow this. The 'remainingQty' is just 'sold from void' (negative stock).
                // We do NOT deduct from expired lots.
            }

            await turso.batch(queries);

            // Update local state to reflect stock changes
            set((state) => ({
                sales: [{
                    ...sale,
                    id: Date.now(),
                    date: new Date().toISOString(),
                    status: 'completed',
                    clientId: sale.client ? sale.client.id : null,
                    clientName: sale.client ? sale.client.name : null
                }, ...state.sales],
                productLots: updatedLots, // Updated lots
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



            // Force refresh of sales to get real DB IDs (Critical for payments)
            get().fetchSales();

            // Force refresh of register stats if open
            const { cashRegister, refreshRegisterStats } = get();
            if (cashRegister) {
                refreshRegisterStats(cashRegister.id);
            }

            return { success: true };

        } catch (e) {
            console.error("Sales transaction error", e);
            return { success: false, error: e.message };
        }
    },

    cancelSale: async (saleId, observation = '') => {
        try {
            const { sales } = get();
            const saleToCancel = sales.find(s => s.id === saleId);
            if (!saleToCancel) return false;

            await turso.batch([
                {
                    sql: "UPDATE sales SET status = 'cancelled', observation = ? WHERE id = ?",
                    args: [observation, saleId]
                },
                ...saleToCancel.items.map(item => ({
                    sql: "UPDATE products SET stock = stock + ? WHERE id = ?",
                    args: [item.quantity, item.id] // Restore stock
                }))
            ]);

            set(state => ({
                sales: state.sales.map(s => s.id === saleId ? { ...s, status: 'cancelled', observation } : s),
                products: state.products.map(p => {
                    const item = saleToCancel.items.find(i => i.id === p.id);
                    if (item) {
                        return { ...p, stock: p.stock + item.quantity };
                    }
                    return p;
                })
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
                date: new Date().toISOString(),
                total: amount,
                summary: `Abono de Cliente: ${client.name}`,
                items: JSON.stringify([{
                    id: 'payment-adj',
                    name: `Abono/Pago de Deuda (${salesIds.length} boletas)`,
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
            // 1. Get all open registers with user details
            const result = await turso.execute(`
                SELECT cr.*, u.name as user_name 
                FROM cash_registers cr 
                LEFT JOIN users u ON cr.user_id = u.id 
                WHERE cr.status = 'open'
            `);

            const registers = result.rows;
            const activeRegsWithBalance = [];

            // 2. Calculate balance for each active register
            for (const reg of registers) {
                // Get sales since opening
                const salesRes = await turso.execute({
                    sql: "SELECT * FROM sales WHERE user_id = ? AND date >= ?",
                    args: [reg.user_id, reg.opening_time]
                });

                let cashSales = 0;
                salesRes.rows.forEach(sale => {
                    const total = parseFloat(sale.total);
                    // Simplified cash check (same as refreshRegisterStats)
                    if (sale.payment_method === 'Efectivo') {
                        cashSales += total;
                    } else if (sale.payment_method === 'Mixto' && sale.payment_details) {
                        try {
                            const details = JSON.parse(sale.payment_details);
                            const methodsList = details.mixedPayments || details.methods;
                            if (methodsList) {
                                methodsList.forEach(m => {
                                    if (m.method === 'Efectivo') cashSales += parseFloat(m.amount || 0);
                                });
                            }
                        } catch (e) { }
                    }
                });

                // Get movements
                const movRes = await turso.execute({
                    sql: "SELECT * FROM cash_movements WHERE register_id = ?",
                    args: [reg.id]
                });

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
            }

            set({ activeRegisters: activeRegsWithBalance });
        } catch (e) {
            console.error("Fetch active registers error", e);
        }
    },

    checkRegisterStatus: async (userId) => {
        try {
            const result = await turso.execute({
                sql: "SELECT * FROM cash_registers WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
                args: [userId]
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
            const result = await turso.execute({
                sql: "INSERT INTO cash_registers (user_id, opening_amount, opening_time, status) VALUES (?, ?, ?, ?) RETURNING *",
                args: [userId, amount, new Date().toISOString(), 'open']
            });
            set({ cashRegister: result.rows[0] });
            return true;
        } catch (e) {
            console.error("Open register error", e);
            return false;
        }
    },

    closeRegister: async (registerId, finalAmount, observations, difference) => {
        try {
            await turso.execute({
                sql: "UPDATE cash_registers SET status = 'closed', closing_time = ?, final_amount = ?, observations = ?, difference = ? WHERE id = ?",
                args: [new Date().toISOString(), finalAmount, observations, difference, registerId]
            });
            set({ cashRegister: null });
            return true;
        } catch (e) {
            console.error("Close register error", e);
            return false;
        }
    },

    registerStats: { balance: 0, sales: 0, movements_in: 0, movements_out: 0, initial: 0, transactions: [] },

    refreshRegisterStats: async (registerId) => {
        try {
            // 1. Get Register Info (for opening time and initial amount)
            const regRes = await turso.execute({
                sql: "SELECT * FROM cash_registers WHERE id = ?",
                args: [registerId]
            });

            if (regRes.rows.length === 0) return;
            const register = regRes.rows[0];
            const openingTime = register.opening_time;

            // 2. Get Cash Sales since opening
            const salesRes = await turso.execute({
                sql: "SELECT * FROM sales WHERE user_id = ? AND date >= ?",
                args: [register.user_id, openingTime]
            });

            let cashSalesTotal = 0;
            const salesBreakdown = { cash: 0, card: 0, transfer: 0, total: 0 };
            const salesTransactions = [];

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
                    } catch (err) { console.error("Error parsing mixed payment", err); }
                }

                salesBreakdown.cash += cashPart;
                salesBreakdown.card += cardPart;
                salesBreakdown.transfer += transferPart;

                if (cashPart > 0) {
                    cashSalesTotal += cashPart;
                    salesTransactions.push({
                        type: 'VENTA',
                        amount: cashPart,
                        total: total,
                        date: sale.date,
                        id: sale.id
                    });
                }
            });

            // 3. Get Manual Movements
            const movementsRes = await turso.execute({
                sql: "SELECT * FROM cash_movements WHERE register_id = ?",
                args: [registerId]
            });

            let movementsIn = 0;
            let movementsOut = 0;
            const movementTransactions = [];

            movementsRes.rows.forEach(mov => {
                const amount = parseFloat(mov.amount);
                if (mov.type === 'IN') {
                    movementsIn += amount;
                    movementTransactions.push({ type: 'INGRESO', amount, reason: mov.reason, date: mov.date || mov.created_at, id: mov.id });
                } else {
                    movementsOut += amount;
                    movementTransactions.push({ type: 'RETIRO', amount, reason: mov.reason, date: mov.date || mov.created_at, id: mov.id });
                }
            });

            const allTransactions = [...salesTransactions, ...movementTransactions].sort((a, b) => new Date(b.date) - new Date(a.date));
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
        } catch (e) {
            console.error("Refresh stats error", e);
        }
    },

    // Historical Reports
    fetchClosedRegisters: async () => {
        try {
            const result = await turso.execute(`
                SELECT cr.*, u.name as user_name 
                FROM cash_registers cr 
                LEFT JOIN users u ON cr.user_id = u.id 
                WHERE cr.status = 'closed' 
                ORDER BY cr.closing_time DESC
            `);
            return result?.rows || [];
        } catch (e) {
            console.error("Fetch closed registers error", e);
            return [];
        }
    },

    addCashMovement: async (registerId, type, amount, reason) => {
        try {
            await turso.execute({
                sql: "INSERT INTO cash_movements (register_id, type, amount, reason, date) VALUES (?, ?, ?, ?, ?)",
                args: [registerId, type, amount, reason, new Date().toISOString()]
            });
            return true;
        } catch (e) {
            console.error("Add cash movement error", e);
            return false;
        }
    },

    fetchCashMovements: async () => {
        try {
            console.log("Fetching cash movements (JS Join Mode)...");

            // 1. Fetch Raw Tables
            const [movementsRes, registersRes, usersRes] = await Promise.all([
                turso.execute("SELECT * FROM cash_movements"),
                turso.execute("SELECT * FROM cash_registers"),
                turso.execute("SELECT * FROM users")
            ]);

            const movements = movementsRes?.rows || [];
            const registers = registersRes?.rows || [];
            const users = usersRes?.rows || [];

            console.log(`Fetched: ${movements.length} movs, ${registers.length} regs, ${users.length} users`);

            // Helper to find user name
            const getUserName = (userId) => {
                const u = users.find(u => u.id === userId);
                return u ? u.name : 'Desconocido';
            };

            // 2. Process Initial Openings (from Registers)
            const openingsNode = registers.map(reg => ({
                id: `opening-${reg.id}`,
                register_id: reg.id, // Explicit ID for grouping
                created_at: reg.opening_time,
                type: 'in',
                amount: reg.opening_amount,
                reason: 'Apertura de Caja',
                user_name: getUserName(reg.user_id),
                source: 'opening'
            }));

            // 3. Process Manual Movements
            const movementsNode = movements.map(mov => {
                // Robust ID Check
                const regId = mov.register_id || mov.cash_register_id;
                const reg = registers.find(r => r.id === regId);
                const userId = reg ? reg.user_id : null;

                return {
                    id: mov.id,
                    register_id: regId,
                    created_at: mov.date || mov.created_at, // Robust Date Check
                    type: String(mov.type).toLowerCase() === 'in' ? 'in' : 'out',
                    amount: mov.amount,
                    reason: mov.reason,
                    user_name: getUserName(userId),
                    source: 'movement'
                };
            });

            // 4. Combine and Sort
            const combined = [...movementsNode, ...openingsNode].sort((a, b) => {
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            });

            return combined;

        } catch (e) {
            console.error("Fetch cash movements error FULL:", e);
            return [];
        }
    },

    getRegisterReport: async (register) => {
        try {
            // Reconstruct report data
            // 1. Sales
            const salesRes = await turso.execute({
                sql: "SELECT * FROM sales WHERE user_id = ? AND date >= ? AND date <= ?",
                args: [register.user_id, register.opening_time, register.closing_time]
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
                sql: "SELECT * FROM cash_movements WHERE register_id = ?",
                args: [register.id]
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
}), {
    name: 'pos-storage',
    partialize: (state) => ({ currentUser: state.currentUser }),
}));
