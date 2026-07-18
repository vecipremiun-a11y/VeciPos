// Configuración de MercadoPago para el frontend
export const MERCADOPAGO_CONFIG = {
    publicKey: import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY,
    locale: 'es-CL'
};

// Planes de suscripción — modelo definitivo de 2 niveles POR SUCURSAL.
// Standard (nivel 1) y Profesional (nivel 2). Cada plan tiene precio CLP y USD.
// Chile (CL) se muestra/cobra en CLP; el resto de países en USD.
// Los complementos (Apps) se venden aparte desde el Marketplace (ver src/constants/apps.js).
export const SUBSCRIPTION_PLANS = {
    standard: {
        id: 'standard',
        level: 1, // jerarquía: solo se ofrecen planes de nivel superior al actual
        name: 'Plan Standard',
        prices: {
            CLP: { monthly: 15000, annual: 150000 },
            USD: { monthly: 15, annual: 150 },
        },
        description: 'Para administrar un local, sin límites de registros',
        popular: false,
        features: [
            'Punto de venta, clientes e historial de ventas',
            'Inventario: productos, categorías, proveedores, compras y facturas',
            'Impuestos y facturación electrónica SII',
            'Reportes de ventas y de cajas',
            'Usuarios, productos, clientes y ventas ilimitados',
        ]
    },
    professional: {
        id: 'professional',
        level: 2,
        name: 'Plan Profesional',
        prices: {
            CLP: { monthly: 30000, annual: 300000 },
            USD: { monthly: 30, annual: 300 },
        },
        description: 'Todo el poder de POSVECI + Marketplace de complementos',
        popular: true,
        features: [
            'Todo lo del plan Standard',
            'Ventas offline y órdenes de compra',
            'Personal (asistencia + nómina) y administración financiera',
            'Sorteos, perfil de producto, combos y control de inventario',
            'Reportes avanzados: utilidad, análisis y vencimientos',
            'Marketplace de complementos + sucursales adicionales',
            'Soporte prioritario 24/7 y 2 h de capacitación',
        ]
    }
};

// Jerarquía de planes para el gating por plan (Standard=1, Profesional=2).
// Tolera variantes legacy (basico/basic=1, medium/medio/pro=2) para no romper
// datos previos a la migración 0008. Devuelve null si el plan es desconocido
// (el gating trata "desconocido" como acceso completo, para no romper legacy).
export const PLAN_LEVEL = {
    standard: 1,
    professional: 2,
    // Aliases legacy (pre-migración a 2 planes)
    basico: 1, basic: 1,
    medium: 2, medio: 2, pro: 2,
};
export const getPlanLevel = (planId) => {
    const k = (planId || '').toString().trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PLAN_LEVEL, k) ? PLAN_LEVEL[k] : null;
};

// Sucursales incluidas y costo por sucursal adicional.
// Solo Profesional puede agregar sucursales; cada adicional cuesta US$20/mes
// (CLP 20.000) y tiene el servicio Profesional completo. Standard no agrega.
export const PLAN_COMPANIES = {
    standard: { included: 1, canAddBranches: false },
    professional: { included: 1, canAddBranches: true, extraUsd: 20, extraClp: 20000 },
};

// ¿El plan permite agregar sucursales? (Solo Profesional.)
export const planCanAddBranches = (planId) => {
    const lvl = getPlanLevel(planId);
    return lvl != null && lvl >= 2;
};

// Precio de una sucursal adicional en la moneda indicada.
export const getExtraBranchAmount = (currency = 'CLP') =>
    currency === 'USD' ? PLAN_COMPANIES.professional.extraUsd : PLAN_COMPANIES.professional.extraClp;

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
