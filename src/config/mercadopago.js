// Configuración de MercadoPago para el frontend
export const MERCADOPAGO_CONFIG = {
    publicKey: import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY,
    locale: 'es-CL'
};

// Planes de suscripción (3 niveles). Cada plan tiene precio en CLP y en USD.
// Chile (CL) se muestra/cobra en CLP; el resto de países en USD.
// NOTA: las features son provisionales, ajústalas a tu producto real.
export const SUBSCRIPTION_PLANS = {
    basico: {
        id: 'basico',
        level: 1, // jerarquía: solo se ofrecen planes de nivel superior al actual
        name: 'Plan Básico',
        prices: {
            CLP: { monthly: 15000, annual: 150000 },
            USD: { monthly: 15, annual: 150 },
        },
        description: 'Para empezar a vender en serio',
        popular: false,
        features: [
            'Todo lo del plan Gratis, sin límites',
            'Facturación electrónica SII',
            'Compras, proveedores y facturas',
            'Encargos / preventas + producción',
            'Reportes avanzados y balanza',
            'Usuarios y cajas ilimitados'
        ]
    },
    medium: {
        id: 'medium',
        level: 2,
        name: 'Plan Medium',
        prices: {
            CLP: { monthly: 30000, annual: 300000 },
            USD: { monthly: 30, annual: 300 },
        },
        description: 'El más elegido por negocios en crecimiento',
        popular: true,
        features: [
            'Todo lo del plan Básico',
            'Gestión de Personal (asistencia + nómina)',
            'Sorteos y fidelización',
            'Multi-sucursal: crea más empresas (cada una con su plan)',
            'Integración WooCommerce y Shopify',
            'Combos, conciliación de inventario y app del sistema'
        ]
    },
    pro: {
        id: 'pro',
        level: 3,
        name: 'Plan Pro',
        prices: {
            CLP: { monthly: 60000, annual: 600000 },
            USD: { monthly: 60, annual: 600 },
        },
        description: 'Para operaciones completas',
        popular: false,
        features: [
            'Todo lo del plan Medium',
            'Página web propia (empresa principal)',
            'Delivery + app de repartidores (Próximamente)',
            'App del sistema',
            'Soporte prioritario 24h'
        ]
    }
};

// Jerarquía de planes para el gating por plan (Básico=1, Medium=2, Pro=3).
// Tolera variantes legacy (basic/medio). Devuelve null si el plan es desconocido
// (el gating trata "desconocido" como acceso completo, para no romper legacy).
export const PLAN_LEVEL = { basico: 1, basic: 1, medium: 2, medio: 2, pro: 3 };
export const getPlanLevel = (planId) => {
    const k = (planId || '').toString().trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PLAN_LEVEL, k) ? PLAN_LEVEL[k] : null;
};

// Cantidad de empresas incluidas y costo por empresa adicional (multi-sucursal).
export const PLAN_COMPANIES = {
    basico: { included: 1 },
    medium: { included: 2, extraUsd: 20 },
    pro: { included: 2, extraUsd: 20 },
};

// Ciclos de facturación disponibles
export const BILLING_CYCLES = {
    monthly: { id: 'monthly', label: 'Mensual', suffix: '/mes' },
    annual: { id: 'annual', label: 'Anual', suffix: '/año' },
};

// Medios de pago disponibles para contratar un plan.
// EDITA estos datos con los reales de tu negocio.
export const PAYMENT_CONFIG = {
    // Transferencia bancaria (la activación es manual, hasta 24 hrs hábiles)
    bankTransfer: {
        bank: 'Banco Estado',
        accountType: 'Cuenta Corriente',
        accountNumber: '000000000',
        holder: 'POSVECI SpA',
        rut: '00.000.000-0',
        email: 'pagos@posveci.com',
    },
    // PayPal: pon tu usuario de PayPal.me (ej: 'posveci'). Vacío = "Próximamente".
    paypalUser: '',
};

// Moneda de visualización/cobro según el país de la empresa: Chile → CLP, resto → USD
export const getDisplayCurrency = (countryCode) => {
    const cc = (countryCode || '').toString().trim().toUpperCase();
    return (cc === 'CL' || cc === 'CHILE' || cc === '') ? 'CLP' : 'USD';
};

// Monto a cobrar por plan/ciclo en una moneda dada
export const getPlanAmount = (planId, cycle, currency = 'CLP') => {
    const plan = SUBSCRIPTION_PLANS[planId];
    if (!plan) return 0;
    return plan.prices?.[currency]?.[cycle] || 0;
};

// Formatea un monto en la moneda indicada (CLP o USD)
export const formatMoney = (amount, currency = 'CLP') => {
    const locale = currency === 'USD' ? 'en-US' : 'es-CL';
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0
    }).format(amount || 0);
};

// Alias para historial de pagos (formatea según la moneda guardada en cada pago)
export const formatPrice = (amount, currency = 'CLP') => formatMoney(amount, currency);
