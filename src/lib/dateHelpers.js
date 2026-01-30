import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Convierte fecha UTC de la base de datos a fecha local de la empresa
 * @param {string|Date} utcDate - Fecha en UTC
 * @param {string} companyTimezone - Timezone IANA (ej: 'America/Santiago')
 * @returns {Date} Fecha convertida a la zona horaria local
 */
export const toCompanyLocalTime = (utcDate, companyTimezone) => {
    const date = typeof utcDate === 'string' ? parseISO(utcDate) : utcDate;
    return toZonedTime(date, companyTimezone);
};

/**
 * Convierte fecha local de empresa a UTC para guardar en DB
 * @param {Date} localDate - Fecha local
 * @param {string} companyTimezone - Timezone IANA
 * @returns {Date} Fecha en UTC
 */
export const toUTC = (localDate, companyTimezone) => {
    return fromZonedTime(localDate, companyTimezone);
};

/**
 * Formatea fecha en zona horaria de empresa
 * @param {string|Date} utcDate - Fecha en UTC
 * @param {string} companyTimezone - Timezone IANA
 * @param {string} formatString - Formato deseado (default: 'dd/MM/yyyy HH:mm')
 * @returns {string} Fecha formateada
 */
export const formatInCompanyTime = (utcDate, companyTimezone, formatString = 'dd/MM/yyyy HH:mm') => {
    return formatInTimeZone(utcDate, companyTimezone, formatString);
};

/**
 * Obtiene inicio del día (00:00:00) en UTC para la fecha dada en timezone de empresa
 * @param {Date} date - Fecha de referencia (objeto Date)
 * @param {string} companyTimezone - Timezone IANA
 * @returns {Date} Inicio del día en UTC
 */
export const getCompanyDayStart = (date, companyTimezone) => {
    const localDate = toCompanyLocalTime(date, companyTimezone);
    const startLocal = startOfDay(localDate);
    return toUTC(startLocal, companyTimezone);
};

/**
 * Obtiene fin del día (23:59:59.999) en UTC para la fecha dada en timezone de empresa
 * @param {Date} date - Fecha de referencia (objeto Date)
 * @param {string} companyTimezone - Timezone IANA
 * @returns {Date} Fin del día en UTC
 */
export const getCompanyDayEnd = (date, companyTimezone) => {
    const localDate = toCompanyLocalTime(date, companyTimezone);
    const endLocal = endOfDay(localDate);
    return toUTC(endLocal, companyTimezone);
};

/**
 * Obtiene la fecha/hora actual en el timezone de la empresa
 * @param {string} companyTimezone - Timezone IANA
 * @returns {Date} Fecha/hora actual en timezone de empresa (como objeto Date UTC)
 */
export const getNowInCompanyTime = (companyTimezone) => {
    return toCompanyLocalTime(new Date(), companyTimezone);
};

/**
 * Interpreta string YYYY-MM-DD como inicio del día en la zona horaria de la empresa
 * @param {string} dateStr - Fecha 'YYYY-MM-DD'
 * @param {string} companyTimezone - Timezone IANA
 * @returns {Date} Fecha UTC correspondiente al 00:00:00 local
 */
export const getStartFromDateString = (dateStr, companyTimezone) => {
    // Agregamos T00:00:00 para asegurar formato
    const localStr = `${dateStr}T00:00:00`;
    return fromZonedTime(localStr, companyTimezone);
};

/**
 * Interpreta string YYYY-MM-DD como fin del día en la zona horaria de la empresa
 * @param {string} dateStr - Fecha 'YYYY-MM-DD'
 * @param {string} companyTimezone - Timezone IANA
 * @returns {Date} Fecha UTC correspondiente al 23:59:59.999 local
 */
export const getEndFromDateString = (dateStr, companyTimezone) => {
    const localStr = `${dateStr}T23:59:59.999`;
    return fromZonedTime(localStr, companyTimezone);
};
