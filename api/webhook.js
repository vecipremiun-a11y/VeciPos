import crypto from 'crypto';
import { createClient } from '@libsql/client';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { APP_PRICES, displayCurrency } from './_lib/billing.js';

// Configurar MercadoPago
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});
const paymentClient = new Payment(client);

// Configurar Turso
const turso = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL,
    authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

// Valida la firma del webhook según la spec de MercadoPago:
//   header x-signature: "ts=<timestamp>,v1=<hmac_sha256>"
//   manifest firmado:   "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
//   HMAC-SHA256(manifest, MERCADOPAGO_WEBHOOK_SECRET) === v1  (comparación en tiempo constante)
// Si no hay secreto configurado, avisa y deja pasar (para no romper prod hasta configurarlo).
function validateMpSignature(req) {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
        console.warn('⚠️ MERCADOPAGO_WEBHOOK_SECRET no configurado — firma del webhook NO validada. Configúralo en Vercel y en MercadoPago → Webhooks.');
        return true;
    }
    try {
        const sig = String(req.headers['x-signature'] || '');
        const requestId = String(req.headers['x-request-id'] || '');
        const parts = Object.fromEntries(
            sig.split(',').map(p => p.split('=').map(s => s.trim())).filter(kv => kv.length === 2)
        );
        const ts = parts.ts;
        const v1 = parts.v1;
        if (!ts || !v1) return false;

        const dataId = (req.query && (req.query['data.id'] || req.query.id)) || req.body?.data?.id || '';
        const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
        const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

        const a = Buffer.from(computed, 'utf8');
        const b = Buffer.from(v1, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) {
        console.error('Error validando firma MP:', e.message);
        return false;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 🔒 Firma del webhook (defensa en profundidad; el pago igual se re-consulta a MP)
    if (!validateMpSignature(req)) {
        console.warn('🚫 Webhook con firma inválida — rechazado');
        return res.status(401).json({ error: 'invalid signature' });
    }

    try {
        const { type, data } = req.body;
        const paymentId = data?.id;

        console.log('🔔 Webhook received:', { type, paymentId });

        if (!paymentId || (type !== 'payment' && type !== 'payment.created' && type !== 'payment.updated')) {
            return res.status(200).json({ received: true });
        }

        const paymentData = await paymentClient.get({ id: paymentId });

        console.log('💳 Payment data:', {
            id: paymentData.id,
            status: paymentData.status,
            external_reference: paymentData.external_reference
        });

        if (paymentData.status !== 'approved') {
            console.log('⏸️ Payment not approved yet:', paymentData.status);
            return res.status(200).json({ received: true });
        }

        const companyId = paymentData.external_reference;
        const metadata = paymentData.metadata;

        // --- Cobro de complemento (App): activar y alinear a la fecha del plan ---
        if (metadata?.type === 'app_charge') {
            const appKey = metadata.app_key;
            if (!companyId || !appKey) {
                return res.status(400).json({ error: 'Missing app data' });
            }
            const dup = await turso.execute({
                sql: "SELECT id FROM payments WHERE mercadopago_payment_id = ?",
                args: [paymentData.id.toString()],
            });
            if (dup.rows.length > 0) {
                return res.status(200).json({ message: 'Already processed' });
            }

            const now = new Date();
            const nowIso = now.toISOString();
            const periodEnd = metadata.period_end || null;
            // Precio MENSUAL de catálogo (no el prorrateo cobrado) para el resumen.
            const cur = displayCurrency((await turso.execute({ sql: 'SELECT country_code FROM companies WHERE id = ?', args: [companyId] })).rows[0]?.country_code);
            const monthly = APP_PRICES[appKey]?.[cur] ?? paymentData.transaction_amount;

            await turso.execute({
                sql: `INSERT INTO company_apps (company_id, app_key, scope, status, period_end, trial_used, will_renew, source, granted_free, activated_at, price, currency, created_at, updated_at)
                      VALUES (?, ?, 'branch', 'active', ?, 1, 1, 'marketplace', 0, ?, ?, ?, ?, ?)
                      ON CONFLICT(company_id, app_key) DO UPDATE SET
                        status = 'active', period_end = excluded.period_end, trial_used = 1, will_renew = 1,
                        granted_free = 0, cancelled_at = NULL, activated_at = excluded.activated_at,
                        price = excluded.price, currency = excluded.currency, updated_at = excluded.updated_at`,
                args: [companyId, appKey, periodEnd, nowIso, monthly, cur, nowIso, nowIso],
            });

            await turso.execute({
                sql: `UPDATE payments SET status = 'approved', mercadopago_payment_id = ?, payment_method = ?, updated_at = ? WHERE id = ?`,
                args: [paymentData.id.toString(), paymentData.payment_method_id, nowIso, metadata.payment_id],
            });

            console.log('🧩 App activada por pago:', companyId, appKey);
            return res.status(200).json({ success: true, message: 'App activated' });
        }

        // --- Suscripción in-app (la empresa y el usuario YA existen): solo activar el plan ---
        if (metadata?.type === 'subscription') {
            if (!companyId) {
                return res.status(400).json({ error: 'Missing company_id' });
            }

            // Evitar doble procesamiento
            const dup = await turso.execute({
                sql: "SELECT id FROM payments WHERE mercadopago_payment_id = ?",
                args: [paymentData.id.toString()]
            });
            if (dup.rows.length > 0) {
                console.log('⚠️ Payment already processed');
                return res.status(200).json({ message: 'Already processed' });
            }

            const billingCycle = metadata.billing_cycle === 'annual' ? 'annual' : 'monthly';
            const subPlanId = metadata.plan_id || 'professional';
            // El plan efectivo de la empresa: una sucursal adicional es Profesional;
            // los alias legacy se normalizan a standard/professional.
            const normalizePlan = (p) => {
                const k = (p || '').toString().toLowerCase();
                if (k === 'branch_extra' || k === 'professional' || k === 'medium' || k === 'medio' || k === 'pro') return 'professional';
                if (k === 'standard' || k === 'basico' || k === 'basic') return 'standard';
                return 'professional';
            };
            const companyPlan = normalizePlan(subPlanId);
            const subNow = new Date();
            const subPeriodStart = new Date(subNow);
            const subPeriodEnd = new Date(subNow);
            if (billingCycle === 'annual') subPeriodEnd.setFullYear(subPeriodEnd.getFullYear() + 1);
            else subPeriodEnd.setMonth(subPeriodEnd.getMonth() + 1);

            const subId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            await turso.execute({
                sql: `INSERT INTO subscriptions (
                    id, company_id, plan_id, status, amount, currency,
                    current_period_start, current_period_end, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
                args: [
                    subId, companyId, subPlanId,
                    paymentData.transaction_amount,
                    paymentData.currency_id || 'CLP',
                    subPeriodStart.toISOString().split('T')[0],
                    subPeriodEnd.toISOString().split('T')[0],
                    subNow.toISOString(), subNow.toISOString()
                ]
            });

            // Activar empresa + fijar plan y fecha de caducidad (gating y ciclo de vida).
            await turso.execute({
                sql: "UPDATE companies SET status = 'active', plan = ?, subscription_id = ?, access_until = ? WHERE id = ?",
                args: [companyPlan, subId, subPeriodEnd.toISOString(), companyId]
            });

            // Pago unificado (plan mensual): realinear las Apps pagadas a la nueva
            // fecha del plan y dar de baja las canceladas (will_renew=0). En anual,
            // las Apps corren en su propio ciclo mensual y no se tocan aquí.
            if (billingCycle === 'monthly') {
                await turso.execute({
                    sql: "UPDATE company_apps SET period_end = ?, updated_at = ? WHERE company_id = ? AND status = 'active' AND will_renew = 1",
                    args: [subPeriodEnd.toISOString(), subNow.toISOString(), companyId],
                });
                await turso.execute({
                    sql: "UPDATE company_apps SET status = 'cancelled', updated_at = ? WHERE company_id = ? AND status = 'active' AND will_renew = 0",
                    args: [subNow.toISOString(), companyId],
                });
            }

            // Marcar el pago como aprobado
            await turso.execute({
                sql: `UPDATE payments SET status = 'approved', mercadopago_payment_id = ?, payment_method = ?, updated_at = ?
                      WHERE id = ?`,
                args: [paymentData.id.toString(), paymentData.payment_method_id, subNow.toISOString(), metadata.payment_id]
            });

            console.log('🎉 Subscription activated for company:', companyId);
            return res.status(200).json({ success: true, message: 'Subscription activated' });
        }
        // --- Fin suscripción in-app ---

        if (!companyId || !metadata || !metadata.registration_data) {
            console.error('❌ Missing required data in payment');
            return res.status(400).json({ error: 'Missing required data' });
        }

        const registrationData = typeof metadata.registration_data === 'string'
            ? JSON.parse(metadata.registration_data)
            : metadata.registration_data;

        const planId = metadata.plan_id;

        console.log('🏢 Processing registration for company:', companyId);

        const now = new Date();
        const trialEnd = new Date(now);
        trialEnd.setDate(trialEnd.getDate() + 15);

        const periodStart = new Date(trialEnd);
        const periodEnd = new Date(periodStart);

        if (planId === 'monthly') {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
        } else if (planId === 'yearly') {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        }

        const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            const check = await turso.execute({
                sql: "SELECT id FROM payments WHERE mercadopago_payment_id = ?",
                args: [paymentData.id.toString()]
            });

            if (check.rows.length > 0) {
                console.log('⚠️ Payment already processed');
                return res.status(200).json({ message: 'Already processed' });
            }

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
}