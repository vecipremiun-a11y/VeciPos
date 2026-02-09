/**
 * Configuración de monedas con sus símbolos y formatos
 */
const CURRENCY_CONFIG = {
    CLP: {
        symbol: '$',
        code: 'CLP',
        locale: 'es-CL',
        decimals: 0,
        position: 'before' // symbol before number
    },
    USD: {
        symbol: '$',
        code: 'USD',
        locale: 'en-US',
        decimals: 2,
        position: 'before'
    },
    MXN: {
        symbol: '$',
        code: 'MXN',
        locale: 'es-MX',
        decimals: 2,
        position: 'before'
    },
    ARS: {
        symbol: '$',
        code: 'ARS',
        locale: 'es-AR',
        decimals: 2,
        position: 'before'
    },
    COP: {
        symbol: '$',
        code: 'COP',
        locale: 'es-CO',
        decimals: 0,
        position: 'before'
    },
    PEN: {
        symbol: 'S/',
        code: 'PEN',
        locale: 'es-PE',
        decimals: 2,
        position: 'before'
    },
    BRL: {
        symbol: 'R$',
        code: 'BRL',
        locale: 'pt-BR',
        decimals: 2,
        position: 'before'
    },
    EUR: {
        symbol: '€',
        code: 'EUR',
        locale: 'es-ES',
        decimals: 2,
        position: 'after'
    },
    VES: {
        symbol: 'Bs',
        code: 'VES',
        locale: 'es-VE',
        decimals: 2,
        position: 'before'
    }
};

/**
 * Formatea un número como moneda según la configuración
 * @param {number} amount - Cantidad a formatear
 * @param {string} currencyCode - Código de moneda (CLP, USD, etc.)
 * @param {boolean} showCode - Si mostrar el código de moneda (ej: USD)
 * @returns {string} Monto formateado
 */
export const formatCurrency = (amount, currencyCode = 'CLP', showCode = false) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
        amount = 0;
    }

    const config = CURRENCY_CONFIG[currencyCode] || CURRENCY_CONFIG.CLP;

    // Formatear el número según el locale
    const formatted = new Intl.NumberFormat(config.locale, {
        minimumFractionDigits: config.decimals,
        maximumFractionDigits: config.decimals
    }).format(amount);

    // Construir el resultado
    if (config.position === 'before') {
        return showCode
            ? `${config.symbol}${formatted} ${config.code}`
            : `${config.symbol}${formatted}`;
    } else {
        return showCode
            ? `${formatted}${config.symbol} ${config.code}`
            : `${formatted}${config.symbol}`;
    }
};

/**
 * Obtiene solo el símbolo de la moneda
 * @param {string} currencyCode - Código de moneda
 * @returns {string} Símbolo
 */
export const getCurrencySymbol = (currencyCode = 'CLP') => {
    const config = CURRENCY_CONFIG[currencyCode] || CURRENCY_CONFIG.CLP;
    return config.symbol;
};

/**
 * Obtiene la configuración completa de una moneda
 * @param {string} currencyCode - Código de moneda
 * @returns {object} Configuración
 */
export const getCurrencyConfig = (currencyCode = 'CLP') => {
    return CURRENCY_CONFIG[currencyCode] || CURRENCY_CONFIG.CLP;
};

// Exportar también la configuración por si se necesita
export { CURRENCY_CONFIG };
