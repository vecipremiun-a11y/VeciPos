import { create } from 'zustand';
import { turso } from '../lib/turso';

export const useStore = create((set, get) => ({
    // Initial State
    products: [],
    users: [],
    sales: [],
    cart: [],
    currentUser: null,
    isLoading: false,
    error: null,

    // Actions
    fetchInitialData: async () => {
        set({ isLoading: true });
        try {
            const productsRes = await turso.execute("SELECT * FROM products");
            const usersRes = await turso.execute("SELECT * FROM users");
            const salesRes = await turso.execute("SELECT * FROM sales ORDER BY id DESC");

            const products = productsRes.rows;
            const users = usersRes.rows;
            const sales = salesRes.rows.map(sale => ({
                ...sale,
                items: JSON.parse(sale.items) // Parse JSON items here for easier consumption
            }));

            set({ products, users, sales, isLoading: false });
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
                sql: "INSERT INTO products (name, price, stock, category, sku, image, cost, tax_rate, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
                args: [
                    product.name,
                    product.price,
                    product.stock,
                    product.category,
                    product.sku,
                    product.image || null,
                    product.cost || 0,
                    product.tax_rate || 0,
                    product.unit || 'Und'
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
                sql: "UPDATE products SET name=?, price=?, stock=?, category=?, sku=?, image=?, cost=?, tax_rate=?, unit=? WHERE id = ?",
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
        return { cart: [...state.cart, { ...product, quantity: 1 }] };
    }),

    removeFromCart: (productId) => set((state) => ({
        cart: state.cart.filter((item) => item.id !== productId)
    })),

    clearCart: () => set({ cart: [] }),

    addSale: async (sale) => {
        try {
            // Transaction: Insert Sale + Deduct Stock
            const { currentUser } = get();
            // Transaction: Insert Sale + Deduct Stock
            const itemsJson = JSON.stringify(sale.items);
            const detailsJson = JSON.stringify(sale.paymentDetails);

            await turso.batch([
                {
                    sql: "INSERT INTO sales (date, total, summary, items, payment_method, payment_details, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    args: [new Date().toISOString(), sale.total, sale.summary, itemsJson, sale.paymentMethod, detailsJson, currentUser ? currentUser.id : null]
                },
                ...sale.items.map(item => ({
                    sql: "UPDATE products SET stock = stock - ? WHERE id = ?",
                    args: [item.quantity, item.id]
                }))
            ]);

            // Update local state to reflect stock changes
            set((state) => ({
                sales: [{ ...sale, id: Date.now(), date: new Date().toISOString() }, ...state.sales],
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

        } catch (e) {
            console.error("Sales transaction error", e);
        }
    },

    // Cash Register Logic
    cashRegister: null,

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
}));
