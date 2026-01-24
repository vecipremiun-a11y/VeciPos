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
            const sales = salesRes.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items),
                paymentMethod: sale.payment_method, // Map snake_case to camelCase
                paymentDetails: sale.payment_details ? JSON.parse(sale.payment_details) : null,
                observation: sale.observation || ''
            }));

            set({ products, productLots, categories, suppliers, users, sales, isLoading: false });

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
                // If product.stock > totalLotQty, the difference is legacy.
                // If product.stock < totalLotQty, we have a data sync issue, assume 0 legacy.
                const legacyStock = Math.max(0, product.stock - totalLotQty);

                // 3. Calculate Valid Lot Stock (Not expired)
                const today = new Date().toISOString().split('T')[0];
                const validLotStock = itemLots
                    .filter(l => !l.expiry_date || l.expiry_date >= today)
                    .reduce((sum, l) => sum + l.quantity, 0);

                const totalSellable = legacyStock + validLotStock;

                if (item.quantity > totalSellable) {
                    // Fail the entire sale if one item exceeds valid stock
                    // Optional: You could allow partial, but standard POS usually blocks or warns.
                    // Given user requirement "Un lote vencido NO debe venderse", blocking is safer.
                    console.error(`Attempted to sell ${item.quantity} of ${product.name}, but only ${totalSellable} is valid/legacy. (Expired blocked)`);
                    return { success: false, error: `Stock insuficiente (Vencido/No disponible) para: ${product.name}` };
                }
            }

            // Transaction: Insert Sale + Deduct Stock
            const itemsJson = JSON.stringify(sale.items);
            const detailsJson = JSON.stringify(sale.paymentDetails);

            const queries = [
                {
                    sql: "INSERT INTO sales (date, total, summary, items, payment_method, payment_details, user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')",
                    args: [new Date().toISOString(), sale.total, sale.summary, itemsJson, sale.paymentMethod, detailsJson, currentUser ? currentUser.id : null]
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
                    // However, if we are here, we assume user allowed it or we strictly block.
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
                // This creates a discrepancy if we strictly rely on lots.
                // For now, we fall back to just updating products table stock (which we did above).
                // But this means lots won't sum up to product stock.
                // User said "NUNCA se descuente stock de un producto vencido".
                // If we run out of valid lots, we technically shouldn't sell. 
                // But to avoid blocking sales in critical moment if data is messy, we proceed with warning/logging?
                // Given the strict requirement: "Un lote vencido NO debe venderse", we hopefully filtered those in available stock check.
            }

            await turso.batch(queries);

            // Update local state to reflect stock changes
            set((state) => ({
                sales: [{ ...sale, id: Date.now(), date: new Date().toISOString(), status: 'completed' }, ...state.sales],
                productLots: updatedLots, // Updated lots
                products: state.products.map(p => {
                    const soldItem = sale.items.find(i => i.id === p.id);
                    if (soldItem) {
                        return { ...p, stock: p.stock - soldItem.quantity };
                    }
                    return p;
                })
            }));

            // Force refresh of register stats if open
            const { cashRegister, refreshRegisterStats } = get();
            if (cashRegister) {
                await refreshRegisterStats(cashRegister.id);
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
                    if (m.type === 'IN') movesIn += parseFloat(m.amount);
                    else movesOut += parseFloat(m.amount);
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

    addCashMovement: async (registerId, type, amount, reason) => {
        try {
            await turso.execute({
                sql: "INSERT INTO cash_movements (register_id, type, amount, reason, date) VALUES (?, ?, ?, ?, ?)",
                args: [registerId, type, amount, reason, new Date().toISOString()]
            });
            // Trigger a refresh of stats ideally, or just let the UI trigger it
            return true;
        } catch (e) {
            console.error("Add movement error", e);
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
            // Note: This relies on sales date > openingTime. 
            // Also need to parse items/paymentDetails to be precise about CASH portion if mixed, 
            // but for MVP we assume 'paymentMethod' = 'Efectivo' or we sum total if method is Effective.
            // For Mixed, we might need more complex logic, but let's stick to basic 'Efectivo' method check + Mixed check logic later if needed.
            // Actually, let's just sum all sales where method is 'Efectivo' for now for simplicity, or grab all and filter in JS.

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
                    movementTransactions.push({ type: 'INGRESO', amount, reason: mov.reason, date: mov.date, id: mov.id });
                } else {
                    movementsOut += amount;
                    movementTransactions.push({ type: 'RETIRO', amount, reason: mov.reason, date: mov.date, id: mov.id });
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
}), {
    name: 'pos-storage',
    partialize: (state) => ({ currentUser: state.currentUser }),
}));
