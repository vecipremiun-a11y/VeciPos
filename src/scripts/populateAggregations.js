import { turso } from '../lib/turso';

/**
 * Script para poblar tablas de agregación con ventas históricas
 * OPTIMIZADO: Procesa día por día para evitar errores de memoria (Resource exhausted)
 */
export const populateAggregations = async (companyId) => {
    console.log('🔄 Iniciando población de tablas de agregación (Modo Optimizado)...');

    try {
        // 1. Obtener días únicos con ventas (mucho más ligero que traer todas las ventas)
        console.log('📅 Obteniendo lista de días con actividad...');

        // Usamos strftime o substr para extraer la fecha YYYY-MM-DD
        const daysResult = await turso.execute({
            sql: `SELECT DISTINCT substr(date, 1, 10) as sale_day 
                  FROM sales 
                  WHERE company_id = ? 
                  ORDER BY sale_day ASC`,
            args: [companyId]
        });

        const uniqueDays = daysResult.rows.map(r => r.sale_day).filter(d => d); // Filtrar nulos
        console.log(`✅ ${uniqueDays.length} días encontrados para procesar.`);

        if (uniqueDays.length === 0) {
            console.log('⚠️ No hay días con ventas para procesar');
            return { success: true, message: 'No hay ventas' };
        }

        // 2. Procesar día por día secuencialmente
        let processedDays = 0;
        let errors = 0;

        for (const dateStr of uniqueDays) {
            try {
                // Pequeña pausa para no saturar la UI ni la red
                if (processedDays % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    console.log(`⏳ Procesando día ${dateStr} (${processedDays + 1}/${uniqueDays.length})...`);
                }

                await processSingleDay(companyId, dateStr);
                processedDays++;
            } catch (e) {
                console.error(`❌ Error procesando día ${dateStr}:`, e);
                errors++;
            }
        }

        console.log(`✅ Población completada. Días: ${processedDays}, Errores: ${errors}`);
        return { success: true, daysProcessed: processedDays };

    } catch (e) {
        console.error('❌ Error general poblando agregaciones:', e);
        return { success: false, error: e.message };
    }
};

/**
 * Procesa todas las ventas de un UNICO día y genera los reportes
 */
const processSingleDay = async (companyId, dateStr) => {
    // 1. Contadores y Acumuladores (Se mantienen en memoria mientras procesamos lotes)
    let totalSales = 0;
    let totalAmount = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let cashSales = 0, cashAmount = 0;
    let cardSales = 0, cardAmount = 0;
    let transferSales = 0, transferAmount = 0;
    let mixedSales = 0, mixedAmount = 0;
    let totalItemsSold = 0;

    const vendorStats = {};
    const productStats = {};
    const hourlyStats = {};

    // 2. Obtener total de ventas para paginar
    const countResult = await turso.execute({
        sql: `SELECT COUNT(*) as count
              FROM sales
              WHERE company_id = ? 
              AND date LIKE ?`,
        args: [companyId, `${dateStr}%`]
    });

    const totalToProcess = countResult.rows[0]?.count || 0;
    if (totalToProcess === 0) return;

    const BATCH_SIZE = 50; // Lote pequeño para evitar Resource Exhausted

    // 3. Procesar por lotes
    for (let offset = 0; offset < totalToProcess; offset += BATCH_SIZE) {

        const salesResult = await turso.execute({
            sql: `SELECT s.*, u.name as user_name
                  FROM sales s
                  LEFT JOIN users u ON s.user_id = u.id
                  WHERE s.company_id = ? 
                  AND s.date LIKE ?
                  LIMIT ? OFFSET ?`,
            args: [companyId, `${dateStr}%`, BATCH_SIZE, offset]
        });

        const sales = salesResult.rows;

        for (const sale of sales) {
            totalSales++; // Incrementar contador de ventas

            // Parsear montos
            const amount = parseFloat(sale.total) || 0;
            totalAmount += amount;

            // Parsear items
            let items = [];
            try {
                items = typeof sale.items === 'string' ? JSON.parse(sale.items) : (sale.items || []);
            } catch (e) { items = []; }

            // Calcular costo y ganancia real de la venta
            let saleCost = 0;
            let saleProfit = 0;

            for (const item of items) {
                const quantity = parseFloat(item.quantity) || 0;
                const price = parseFloat(item.price) || 0;
                const cost = parseFloat(item.cost) || 0;

                const itemRevenue = price * quantity;
                const itemCost = cost * quantity;
                const itemProfit = itemRevenue - itemCost;

                saleCost += itemCost;
                saleProfit += itemProfit;
                totalItemsSold += quantity;

                // Estadísticas por Producto
                const productId = item.id || item.product_id;
                if (productId) {
                    if (!productStats[productId]) {
                        productStats[productId] = {
                            product_id: productId,
                            product_name: item.name,
                            units_sold: 0,
                            total_revenue: 0,
                            total_cost: 0,
                            total_profit: 0
                        };
                    }
                    productStats[productId].units_sold += quantity;
                    productStats[productId].total_revenue += itemRevenue;
                    productStats[productId].total_cost += itemCost;
                    productStats[productId].total_profit += itemProfit;
                }
            }

            totalCost += saleCost;
            totalProfit += saleProfit;

            // Clasificación por Método de Pago
            const pm = (sale.payment_method || sale.paymentMethod || 'Efectivo').toLowerCase();

            if (pm.includes('efectivo') || pm === 'cash') {
                cashSales++; cashAmount += amount;
            } else if (pm.includes('tarjeta') || pm === 'card') {
                cardSales++; cardAmount += amount;
            } else if (pm.includes('transfer')) {
                transferSales++; transferAmount += amount;
            } else if (pm.includes('mixto') || pm.includes('mixed')) {
                mixedSales++; mixedAmount += amount;
            }

            // Estadísticas por Vendedor
            const userId = sale.user_id;
            if (userId) {
                if (!vendorStats[userId]) {
                    vendorStats[userId] = {
                        user_id: userId,
                        user_name: sale.user_name || 'Vendedor',
                        total_sales: 0,
                        total_amount: 0,
                        total_profit: 0,
                        total_items_sold: 0,
                        first_sale_time: sale.date,
                        last_sale_time: sale.date
                    };
                }
                vendorStats[userId].total_sales++;
                vendorStats[userId].total_amount += amount;
                vendorStats[userId].total_profit += saleProfit;
                vendorStats[userId].total_items_sold += items.reduce((acc, i) => acc + (parseFloat(i.quantity) || 0), 0);

                // Actualizar tiempos
                if (new Date(sale.date) > new Date(vendorStats[userId].last_sale_time)) {
                    vendorStats[userId].last_sale_time = sale.date;
                }
                if (new Date(sale.date) < new Date(vendorStats[userId].first_sale_time)) {
                    vendorStats[userId].first_sale_time = sale.date;
                }
            }

            // Estadísticas por Hora
            const saleHour = new Date(sale.date).getHours();
            if (!hourlyStats[saleHour]) {
                hourlyStats[saleHour] = {
                    hour: saleHour,
                    total_sales: 0,
                    total_amount: 0
                };
            }
            hourlyStats[saleHour].total_sales++;
            hourlyStats[saleHour].total_amount += amount;
        }
    }

    const now = new Date().toISOString();

    // 4. Escribir resultados en Base de Datos (Atomic writes per day)

    // A. sales_daily_summary
    const summaryId = `summary_${companyId}_${dateStr}`;
    await turso.execute({
        sql: `INSERT INTO sales_daily_summary 
              (id, company_id, date, total_sales, total_amount, total_cost, total_profit,
               cash_sales, cash_amount, card_sales, card_amount, transfer_sales, transfer_amount,
               mixed_sales, mixed_amount, total_items_sold, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(company_id, date) DO UPDATE SET
                total_sales = excluded.total_sales,
                total_amount = excluded.total_amount,
                total_cost = excluded.total_cost,
                total_profit = excluded.total_profit,
                cash_sales = excluded.cash_sales,
                cash_amount = excluded.cash_amount,
                card_sales = excluded.card_sales,
                card_amount = excluded.card_amount,
                transfer_sales = excluded.transfer_sales,
                transfer_amount = excluded.transfer_amount,
                mixed_sales = excluded.mixed_sales,
                mixed_amount = excluded.mixed_amount,
                total_items_sold = excluded.total_items_sold,
                updated_at = excluded.updated_at`,
        args: [
            summaryId, companyId, dateStr, totalSales, totalAmount, totalCost, totalProfit,
            cashSales, cashAmount, cardSales, cardAmount, transferSales, transferAmount,
            mixedSales, mixedAmount, totalItemsSold, now, now
        ]
    });

    // B. vendor_daily_performance (Batch)
    for (const [userId, stats] of Object.entries(vendorStats)) {
        const performanceId = `perf_${companyId}_${userId}_${dateStr}`;
        const avgTicket = stats.total_sales > 0 ? stats.total_amount / stats.total_sales : 0;

        await turso.execute({
            sql: `INSERT INTO vendor_daily_performance
                  (id, company_id, user_id, user_name, date, total_sales, total_amount, 
                   total_profit, avg_ticket, total_items_sold, first_sale_time, last_sale_time, 
                   created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(company_id, user_id, date) DO UPDATE SET
                    total_sales = excluded.total_sales,
                    total_amount = excluded.total_amount,
                    total_profit = excluded.total_profit,
                    avg_ticket = excluded.avg_ticket,
                    total_items_sold = excluded.total_items_sold,
                    last_sale_time = excluded.last_sale_time,
                    updated_at = excluded.updated_at`,
            args: [
                performanceId, companyId, userId, stats.user_name, dateStr,
                stats.total_sales, stats.total_amount, stats.total_profit, avgTicket,
                stats.total_items_sold, stats.first_sale_time, stats.last_sale_time,
                now, now
            ]
        });
    }

    // C. product_daily_profit
    const productQueries = [];
    for (const [productId, stats] of Object.entries(productStats)) {
        const profitId = `profit_${companyId}_${productId}_${dateStr}`;
        const margin = stats.total_revenue > 0
            ? (stats.total_profit / stats.total_revenue) * 100
            : 0;

        productQueries.push({
            sql: `INSERT INTO product_daily_profit
                  (id, company_id, product_id, product_name, date, units_sold, 
                   total_revenue, total_cost, total_profit, profit_margin, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(company_id, product_id, date) DO UPDATE SET
                    units_sold = excluded.units_sold,
                    total_revenue = excluded.total_revenue,
                    total_cost = excluded.total_cost,
                    total_profit = excluded.total_profit,
                    profit_margin = excluded.profit_margin,
                    updated_at = excluded.updated_at`,
            args: [
                profitId, companyId, productId, stats.product_name, dateStr,
                stats.units_sold, stats.total_revenue, stats.total_cost,
                stats.total_profit, margin, now, now
            ]
        });
    }

    // Ejecutar queries de productos en lotes pequeños (batch de 50)
    for (let i = 0; i < productQueries.length; i += 50) {
        const batch = productQueries.slice(i, i + 50);
        await turso.batch(batch);
    }

    // D. hourly_sales_stats
    for (const [hour, stats] of Object.entries(hourlyStats)) {
        const hourlyId = `hourly_${companyId}_${dateStr}_${hour}`;

        await turso.execute({
            sql: `INSERT INTO hourly_sales_stats
                  (id, company_id, date, hour, total_sales, total_amount, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(company_id, date, hour) DO UPDATE SET
                    total_sales = excluded.total_sales,
                    total_amount = excluded.total_amount,
                    updated_at = excluded.updated_at`,
            args: [hourlyId, companyId, dateStr, hour, stats.total_sales, stats.total_amount, now, now]
        });
    }
};

window.populateAggregations = populateAggregations;
