// Alertas de inventario server-side (Fase 1 · Paso 26). El motor de alertas
// (checkInventoryAlerts + checkStockPredictions) corre entero en el servidor;
// el cliente solo dispara y refresca. company_id forzado en toda query.

const nowIso = () => new Date().toISOString();

// Inserta la notificación en inventory_alerts (equivalente a store.sendNotification)
async function sendNotification(turso, { type = 'system', title, message, companyId, productId, productName, alertType, priority, currentStock, threshold, daysRemaining }) {
    const now = nowIso();
    await turso.execute({
        sql: `INSERT INTO inventory_alerts (company_id, product_id, product_name, alert_type, priority, title, message, current_stock, threshold, days_remaining, channel, sent, sent_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        args: [companyId, productId || null, productName || null, alertType, priority || 'normal', title, message,
            currentStock ?? null, threshold ?? null, daysRemaining ?? null, type, now, now],
    });
}

async function alertSettingsGet(turso, companyId, session, { productId }) {
    const res = await turso.execute({
        sql: 'SELECT * FROM product_alert_settings WHERE company_id = ? AND product_id = ?',
        args: [companyId, productId],
    });
    return { success: true, settings: res.rows[0] || null };
}

async function alertSettingsSave(turso, companyId, session, { productId, settings }) {
    await turso.execute({
        sql: `INSERT INTO product_alert_settings (company_id, product_id, min_stock, critical_stock, priority, notify_system, notify_whatsapp, is_active, cooldown_hours, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(company_id, product_id) DO UPDATE SET
                min_stock = excluded.min_stock, critical_stock = excluded.critical_stock,
                priority = excluded.priority, notify_system = excluded.notify_system,
                notify_whatsapp = excluded.notify_whatsapp, is_active = excluded.is_active,
                cooldown_hours = excluded.cooldown_hours`,
        args: [companyId, productId, parseFloat(settings.min_stock) || 5, parseFloat(settings.critical_stock) || 2,
            settings.priority || 'normal', settings.notify_system ? 1 : 0, settings.notify_whatsapp ? 1 : 0,
            settings.is_active ? 1 : 0, parseInt(settings.cooldown_hours, 10) || 6, nowIso()],
    });
    return { success: true };
}

async function alertsList(turso, companyId, session, { limit = 50 }) {
    const res = await turso.execute({
        sql: 'SELECT * FROM inventory_alerts WHERE company_id = ? ORDER BY created_at DESC LIMIT ?',
        args: [companyId, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)],
    });
    return { success: true, rows: res.rows };
}

async function alertsUnreadCount(turso, companyId) {
    const res = await turso.execute({
        sql: 'SELECT COUNT(*) as count FROM inventory_alerts WHERE company_id = ? AND is_read = 0',
        args: [companyId],
    });
    return { success: true, count: res.rows[0]?.count || 0 };
}

async function alertMarkRead(turso, companyId, session, { alertId }) {
    await turso.execute({
        sql: 'UPDATE inventory_alerts SET is_read = 1 WHERE id = ? AND company_id = ?',
        args: [alertId, companyId],
    });
    return { success: true };
}

async function alertsMarkAllRead(turso, companyId) {
    await turso.execute({
        sql: 'UPDATE inventory_alerts SET is_read = 1 WHERE company_id = ? AND is_read = 0',
        args: [companyId],
    });
    return { success: true };
}

async function alertsDeleteOld(turso, companyId, session, { daysOld = 30 }) {
    await turso.execute({
        sql: "DELETE FROM inventory_alerts WHERE company_id = ? AND created_at < datetime('now', '-' || ? || ' days')",
        args: [companyId, daysOld],
    });
    return { success: true };
}

async function alertSummary(turso, companyId) {
    const res = await turso.execute({
        sql: `SELECT s.priority, s.min_stock, s.critical_stock, p.id as product_id, p.name, p.stock, p.sku
              FROM product_alert_settings s
              JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
              WHERE s.company_id = ? AND s.is_active = 1 AND (p.stock <= s.min_stock)
              ORDER BY
                CASE WHEN p.stock <= s.critical_stock THEN 0 ELSE 1 END,
                CASE s.priority WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
                p.stock ASC`,
        args: [companyId],
    });
    const criticalProducts = [];
    const lowProducts = [];
    for (const row of res.rows) {
        const item = {
            product_id: row.product_id, name: row.name, sku: row.sku,
            stock: parseFloat(row.stock), min_stock: parseFloat(row.min_stock),
            critical_stock: parseFloat(row.critical_stock), priority: row.priority,
        };
        if (item.stock <= parseFloat(row.critical_stock)) criticalProducts.push(item);
        else lowProducts.push(item);
    }
    return { success: true, criticalProducts, lowProducts };
}

// Motor de alertas — antes en store.checkInventoryAlerts. Corre server-side.
async function alertsCheck(turso, companyId, session, { specificProductIds = null }) {
    let sql = `SELECT s.*, p.name as product_name, p.stock as current_stock, p.sku
               FROM product_alert_settings s
               JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
               WHERE s.company_id = ? AND s.is_active = 1`;
    const args = [companyId];
    if (specificProductIds && specificProductIds.length > 0) {
        const ph = specificProductIds.map(() => '?').join(',');
        sql += ` AND s.product_id IN (${ph})`;
        args.push(...specificProductIds);
    }
    const result = await turso.execute({ sql, args });
    const now = new Date();
    const alertsToSend = [];

    for (const setting of result.rows) {
        const stock = parseFloat(setting.current_stock) || 0;
        const minStock = parseFloat(setting.min_stock);
        const criticalStock = parseFloat(setting.critical_stock);
        const cooldownHours = parseInt(setting.cooldown_hours, 10) || 6;

        if (setting.last_notified_at) {
            const hoursSince = (now - new Date(setting.last_notified_at)) / (1000 * 60 * 60);
            if (hoursSince < cooldownHours) continue;
        }

        let alertType = null, threshold = null;
        if (stock <= criticalStock) { alertType = 'critical'; threshold = criticalStock; }
        else if (stock <= minStock) { alertType = 'low'; threshold = minStock; }
        if (!alertType) continue;

        alertsToSend.push({ ...setting, alertType, threshold, stock });
    }

    for (const alert of alertsToSend) {
        const emoji = alert.alertType === 'critical' ? '🚨' : '⚠️';
        const typeLabel = alert.alertType === 'critical' ? 'CRÍTICO' : 'Bajo';
        const title = `${emoji} Stock ${typeLabel}: ${alert.product_name}`;
        const message = `${alert.product_name} tiene ${alert.stock} unidades (mínimo: ${alert.threshold})`;
        const base = {
            companyId, title, message, productId: alert.product_id, productName: alert.product_name,
            alertType: alert.alertType, priority: alert.priority, currentStock: alert.stock, threshold: alert.threshold,
        };
        if (alert.notify_system) await sendNotification(turso, { type: 'system', ...base });
        if (alert.notify_whatsapp) await sendNotification(turso, { type: 'whatsapp', ...base });
        await turso.execute({
            sql: 'UPDATE product_alert_settings SET last_notified_at = ? WHERE id = ? AND company_id = ?',
            args: [now.toISOString(), alert.id, companyId],
        });
    }

    return {
        success: true,
        criticalCount: alertsToSend.filter(a => a.alertType === 'critical').length,
        lowCount: alertsToSend.filter(a => a.alertType === 'low').length,
    };
}

// Motor de predicción — antes en store.checkStockPredictions.
async function stockPredictionsCheck(turso, companyId, session, { sevenDaysAgo }) {
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
        args: [companyId, sevenDaysAgo, companyId, companyId],
    });

    let sent = 0;
    for (const row of result.rows) {
        const avgDaily = (parseFloat(row.total_sold) || 0) / 7;
        if (avgDaily <= 0) continue;
        const stock = parseFloat(row.current_stock) || 0;
        const daysRemaining = stock / avgDaily;
        if (daysRemaining < 3 && daysRemaining >= 0) {
            const existing = await turso.execute({
                sql: "SELECT id FROM inventory_alerts WHERE company_id = ? AND product_id = ? AND alert_type = 'prediction' AND created_at > datetime('now', '-24 hours')",
                args: [companyId, row.product_id],
            });
            if (existing.rows.length > 0) continue;
            await sendNotification(turso, {
                type: 'system',
                title: `📊 Predicción: ${row.name} se agotará en ${Math.round(daysRemaining * 10) / 10} días`,
                message: `${row.name} tiene ${stock} unidades. Promedio de venta: ${Math.round(avgDaily * 10) / 10}/día. Se agotará en ~${Math.round(daysRemaining)} días.`,
                companyId, productId: row.product_id, productName: row.name, alertType: 'prediction',
                priority: daysRemaining < 1 ? 'critical' : 'important', currentStock: stock,
                daysRemaining: Math.round(daysRemaining * 10) / 10,
            });
            sent++;
        }
    }
    return { success: true, sent };
}

export const alertActions = {
    alertSettingsGet, alertSettingsSave, alertsList, alertsUnreadCount,
    alertMarkRead, alertsMarkAllRead, alertsDeleteOld, alertSummary,
    alertsCheck, stockPredictionsCheck,
};
