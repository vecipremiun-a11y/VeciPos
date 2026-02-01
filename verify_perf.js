import { createClient } from "@libsql/client";
import dotenv from 'dotenv';
import { getCompanyDayStart, getCompanyDayEnd, formatInCompanyTime } from './src/lib/dateHelpers.js';
import { subDays } from 'date-fns';

dotenv.config();

const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN,
});

async function runVerification() {
    console.log("🚀 Starting verification...");

    // Simulate store state
    const activeCompanyId = 'default';
    const currentCompanyTimezone = 'America/Santiago';

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
        const [
            todayStatsRes,
            monthStatsRes,
            todayDetailedSalesRes,
            recentSalesRes,
            lowStockRes
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
            // 3. Ventas detalladas de HOY (para calcular utilidad)
            {
                sql: `SELECT s.*, u.name as user_name
                      FROM sales s
                      LEFT JOIN users u ON s.user_id = u.id
                      WHERE s.company_id = ? 
                      AND s.date >= ? 
                      AND s.date <= ?
                      ORDER BY s.date DESC`,
                args: [activeCompanyId, startOfToday.toISOString(), endOfToday.toISOString()]
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
            }
        ]);

        console.timeEnd('⏱️ fetchDashboardData');

        const todayStats = todayStatsRes.rows[0];
        const monthStats = monthStatsRes.rows;

        console.log('📊 Today Stats (optimizado):', todayStats);
        console.log('📊 Month Data Points:', monthStats.length);

        const totalSalesMonth = monthStats.reduce((acc, day) => acc + (parseFloat(day.total_sales) || 0), 0);
        console.log('💰 Total Sales Month:', totalSalesMonth);

        console.log('✅ Verification Complete');

    } catch (e) {
        console.error("❌ Verification failed", e);
    }
}

runVerification();
