const { createClient } = require('@libsql/client');
const mercadopago = require('mercadopago');

// Configurar MercadoPago
mercadopago.configure({
    access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// Configurar Turso
const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

module.exports = async function handler(req, res) {
    // Solo permitir POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { type, data } = req.body;
        const paymentId = data?.id;

        console.log('🔔 Webhook received:', { type, paymentId });

        // Solo procesar notificaciones de pago
        if (!paymentId || (type !== 'payment' && type !== 'payment.created' && type !== 'payment.updated')) {
            return res.status(200).json({ received: true });
        }

        // Obtener información del pago desde MercadoPago
        const payment = await mercadopago.payment.findById(paymentId);
        const paymentData = payment.body;

        console.log('💳 Payment data:', {
            id: paymentData.id,
            status: paymentData.status,
            external_reference: paymentData.external_reference
        });

        // Solo procesar pagos aprobados
        if (paymentData.status !== 'approved') {
            console.log('⏸️ Payment not approved yet:', paymentData.status);
            return res.status(200).json({ received: true });
        }

        const companyId = paymentData.external_reference;
        const metadata = paymentData.metadata;

        if (!companyId || !metadata || !metadata.registration_data) {
            console.error('❌ Missing required data in payment');
            return res.status(400).json({ error: 'Missing required data' });
        }

        // Parsear datos de registro
        const registrationData = typeof metadata.registration_data === 'string'
            ? JSON.parse(metadata.registration_data)
            : metadata.registration_data;

        const planId = metadata.plan_id;

        console.log('🏢 Processing registration for company:', companyId);

        // Calcular fechas de suscripción
        const now = new Date();
        const trialEnd = new Date(now);
        trialEnd.setDate(trialEnd.getDate() + 15); // 15 días de prueba

        const periodStart = new Date(trialEnd);
        const periodEnd = new Date(periodStart);

        if (planId === 'monthly') {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
        } else if (planId === 'yearly') {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        }

        // Generar ID de suscripción
        const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            // Verificar si ya se procesó este pago
            const check = await turso.execute({
                sql: "SELECT id FROM payments WHERE mercadopago_payment_id = ?",
                args: [paymentData.id.toString()]
            });

            if (check.rows.length > 0) {
                console.log('⚠️ Payment already processed');
                return res.status(200).json({ message: 'Already processed' });
            }

            // 1. Crear suscripción
            await turso.execute({
                sql: `INSERT INTO subscriptions (
                    id, company_id, plan_id, status, amount, currency,
                    current_period_start, current_period_end, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, 'CLP', ?, ?, ?, ?)`,
                args: [
                    subscriptionId,
                    companyId,
                    planId,
                    paymentData.transaction_amount,
                    periodStart.toISOString().split('T')[0],
                    periodEnd.toISOString().split('T')[0],
                    now.toISOString(),
                    now.toISOString()
                ]
            });

            console.log('✅ Subscription created:', subscriptionId);

            // 2. Actualizar empresa a estado trial
            await turso.execute({
                sql: `UPDATE companies 
                      SET status = 'trial', 
                          subscription_id = ?,
                          trial_ends_at = ?,
                          updated_at = ?
                      WHERE id = ?`,
                args: [
                    subscriptionId,
                    trialEnd.toISOString().split('T')[0],
                    now.toISOString(),
                    companyId
                ]
            });

            console.log('✅ Company updated to trial');

            // 3. Crear usuario administrador
            const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await turso.execute({
                sql: `INSERT INTO users (
                    id, name, username, password, role, company_id, email, created_at
                ) VALUES (?, ?, ?, ?, 'Administrador', ?, ?, ?)`,
                args: [
                    userId,
                    registrationData.admin.name,
                    registrationData.admin.username,
                    registrationData.admin.password,
                    companyId,
                    registrationData.admin.email,
                    now.toISOString()
                ]
            });

            console.log('✅ Admin user created:', registrationData.admin.username);

            // 4. Actualizar payment como aprobado
            await turso.execute({
                sql: `UPDATE payments 
                      SET status = 'approved',
                          mercadopago_payment_id = ?,
                          payment_method = ?,
                          updated_at = ?
                      WHERE company_id = ? AND status = 'pending'`,
                args: [
                    paymentData.id.toString(),
                    paymentData.payment_method_id,
                    now.toISOString(),
                    companyId
                ]
            });

            console.log('✅ Payment updated');

            console.log('🎉 Company activated successfully:', companyId);

            return res.status(200).json({
                success: true,
                message: 'Company activated successfully'
            });

        } catch (dbError) {
            console.error('❌ Database error:', dbError);
            throw dbError;
        }

    } catch (error) {
        console.error('❌ Webhook error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
};