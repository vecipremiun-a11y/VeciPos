import { Certificado, CAF, DTE, EnvioDTE, EnvioBOLETA, EnviadorSII } from '@devlas/dte-sii';
import ConsumoFolio from '@devlas/dte-sii/ConsumoFolio.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.SII_ENCRYPTION_KEY || 'poskem-sii-default-key-change-me!'; // 32 chars

// ─── Encriptar/Desencriptar contraseña del certificado ───

export function encryptPassword(plainText) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

export function decryptPassword(encryptedText) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ─── Cargar certificado desde config de BD ───

export function loadCertificado(siiConfig) {
    if (!siiConfig.certificado_pfx || !siiConfig.certificado_password) {
        throw new Error('Certificado digital no configurado para esta empresa');
    }

    const pfxBuffer = Buffer.from(siiConfig.certificado_pfx, 'base64');
    const password = decryptPassword(siiConfig.certificado_password);

    return new Certificado(pfxBuffer, password);
}

// ─── Cargar CAF ───

export function loadCAF(cafXml) {
    return new CAF(cafXml);
}

// ─── Construir DTE para Boleta (39) ───

export function buildBoleta(saleData, siiConfig, folio, caf) {
    const items = saleData.items || [];
    const taxRate = 0.19; // IVA Chile 19%

    // Calcular totales
    let montoTotal = 0;
    const detalles = items.map((item, idx) => {
        const qty = parseFloat(item.quantity) || 1;
        const priceWithTax = parseFloat(item.price) || 0;
        const itemTaxRate = parseFloat(item.tax_rate) || 0;
        const montoItem = Math.round(priceWithTax * qty);
        montoTotal += montoItem;

        const detail = {
            NroLinDet: idx + 1,
            ...(itemTaxRate === 0 ? { IndExe: 1 } : {}),
            NmbItem: sanitizeText(item.name),
            QtyItem: qty,
            PrcItem: Math.round(priceWithTax),
            MontoItem: montoItem,
        };

        return detail;
    });

    // Calcular IVA
    const itemsAfectos = items.filter(i => (parseFloat(i.tax_rate) || 0) > 0);
    const montoAfecto = itemsAfectos.reduce((sum, i) => {
        const qty = parseFloat(i.quantity) || 1;
        const price = parseFloat(i.price) || 0;
        return sum + Math.round(price * qty);
    }, 0);
    const montoNeto = Math.round(montoAfecto / (1 + taxRate));
    const montoIva = montoAfecto - montoNeto;

    const itemsExentos = items.filter(i => (parseFloat(i.tax_rate) || 0) === 0);
    const montoExento = itemsExentos.reduce((sum, i) => {
        const qty = parseFloat(i.quantity) || 1;
        const price = parseFloat(i.price) || 0;
        return sum + Math.round(price * qty);
    }, 0);

    const dteData = {
        Encabezado: {
            IdDoc: {
                TipoDTE: 39,
                Folio: folio,
                FchEmis: new Date().toISOString().split('T')[0],
                IndServicio: 3, // Boleta de venta
            },
            Emisor: {
                RUTEmisor: siiConfig.rut_emisor,
                RznSocEmisor: sanitizeText(siiConfig.razon_social),
                GiroEmisor: sanitizeText(siiConfig.giro),
                DirOrigen: sanitizeText(siiConfig.direccion || ''),
                CmnaOrigen: sanitizeText(siiConfig.comuna || ''),
                CiudadOrigen: sanitizeText(siiConfig.ciudad || ''),
                Acteco: siiConfig.acteco ? parseInt(siiConfig.acteco) : undefined,
            },
            Receptor: {
                RUTRecep: saleData.rut_receptor || '66666666-6',
                RznSocRecep: sanitizeText(saleData.razon_social_receptor || 'CLIENTE'),
            },
            Totales: {
                ...(montoExento > 0 ? { MntExe: montoExento } : {}),
                ...(montoNeto > 0 ? { MntNeto: montoNeto, TasaIVA: 19, IVA: montoIva } : {}),
                MntTotal: montoTotal,
            },
        },
        Detalle: detalles,
    };

    const dte = new DTE(dteData);
    dte.generarXML().timbrar(caf);

    return { dte, montoTotal, montoNeto, montoIva };
}

// ─── Construir DTE para Factura (33) ───

export function buildFactura(saleData, siiConfig, folio, caf) {
    const items = saleData.items || [];
    const taxRate = 0.19;

    let montoTotal = 0;
    const detalles = items.map((item, idx) => {
        const qty = parseFloat(item.quantity) || 1;
        const priceWithTax = parseFloat(item.price) || 0;
        const itemTaxRate = parseFloat(item.tax_rate) || 0;

        // Factura: precios netos
        const priceNeto = itemTaxRate > 0
            ? Math.round(priceWithTax / (1 + taxRate))
            : Math.round(priceWithTax);

        const montoItem = priceNeto * qty;

        const detail = {
            NroLinDet: idx + 1,
            ...(itemTaxRate === 0 ? { IndExe: 1 } : {}),
            NmbItem: sanitizeText(item.name),
            QtyItem: qty,
            PrcItem: priceNeto,
            MontoItem: montoItem,
        };

        return detail;
    });

    // Calcular totales netos
    const itemsAfectos = detalles.filter((d, i) => (parseFloat(items[i].tax_rate) || 0) > 0);
    const montoNeto = itemsAfectos.reduce((sum, d) => sum + d.MontoItem, 0);
    const montoIva = Math.round(montoNeto * taxRate);

    const itemsExentos = detalles.filter((d, i) => (parseFloat(items[i].tax_rate) || 0) === 0);
    const montoExento = itemsExentos.reduce((sum, d) => sum + d.MontoItem, 0);

    montoTotal = montoNeto + montoIva + montoExento;

    const dteData = {
        Encabezado: {
            IdDoc: {
                TipoDTE: 33,
                Folio: folio,
                FchEmis: new Date().toISOString().split('T')[0],
            },
            Emisor: {
                RUTEmisor: siiConfig.rut_emisor,
                RznSoc: sanitizeText(siiConfig.razon_social),
                GiroEmis: sanitizeText(siiConfig.giro),
                DirOrigen: sanitizeText(siiConfig.direccion || ''),
                CmnaOrigen: sanitizeText(siiConfig.comuna || ''),
                CiudadOrigen: sanitizeText(siiConfig.ciudad || ''),
                Acteco: siiConfig.acteco ? parseInt(siiConfig.acteco) : undefined,
            },
            Receptor: {
                RUTRecep: saleData.rut_receptor,
                RznSocRecep: sanitizeText(saleData.razon_social_receptor || ''),
                GiroRecep: sanitizeText(saleData.giro_receptor || 'Sin giro'),
                DirRecep: sanitizeText(saleData.dir_receptor || ''),
                CmnaRecep: sanitizeText(saleData.comuna_receptor || ''),
                CiudadRecep: sanitizeText(saleData.ciudad_receptor || ''),
            },
            Totales: {
                ...(montoExento > 0 ? { MntExe: montoExento } : {}),
                MntNeto: montoNeto,
                TasaIVA: 19,
                IVA: montoIva,
                MntTotal: montoTotal,
            },
        },
        Detalle: detalles,
    };

    // Forma de pago: 1 = Contado, 2 = Crédito
    if (saleData.forma_pago === 'credito') {
        dteData.Encabezado.IdDoc.FmaPago = 2;
        if (saleData.dias_credito) {
            const fchVenc = new Date();
            fchVenc.setDate(fchVenc.getDate() + parseInt(saleData.dias_credito));
            dteData.Encabezado.IdDoc.FchVenc = fchVenc.toISOString().split('T')[0];
        }
    } else {
        dteData.Encabezado.IdDoc.FmaPago = 1;
    }

    const dte = new DTE(dteData);
    dte.generarXML().timbrar(caf);

    return { dte, montoTotal, montoNeto, montoIva };
}

// ─── Construir DTE para Factura Exenta (34) ───

export function buildFacturaExenta(saleData, siiConfig, folio, caf) {
    const items = saleData.items || [];

    let montoTotal = 0;
    const detalles = items.map((item, idx) => {
        const qty = parseFloat(item.quantity) || 1;
        const price = Math.round(parseFloat(item.price) || 0);
        const montoItem = price * qty;
        montoTotal += montoItem;

        return {
            NroLinDet: idx + 1,
            IndExe: 1,
            NmbItem: sanitizeText(item.name),
            QtyItem: qty,
            PrcItem: price,
            MontoItem: montoItem,
        };
    });

    const dteData = {
        Encabezado: {
            IdDoc: {
                TipoDTE: 34,
                Folio: folio,
                FchEmis: new Date().toISOString().split('T')[0],
            },
            Emisor: {
                RUTEmisor: siiConfig.rut_emisor,
                RznSoc: sanitizeText(siiConfig.razon_social),
                GiroEmis: sanitizeText(siiConfig.giro),
                DirOrigen: sanitizeText(siiConfig.direccion || ''),
                CmnaOrigen: sanitizeText(siiConfig.comuna || ''),
                CiudadOrigen: sanitizeText(siiConfig.ciudad || ''),
                Acteco: siiConfig.acteco ? parseInt(siiConfig.acteco) : undefined,
            },
            Receptor: {
                RUTRecep: saleData.rut_receptor,
                RznSocRecep: sanitizeText(saleData.razon_social_receptor || ''),
                GiroRecep: sanitizeText(saleData.giro_receptor || 'Sin giro'),
                DirRecep: sanitizeText(saleData.dir_receptor || ''),
                CmnaRecep: sanitizeText(saleData.comuna_receptor || ''),
                CiudadRecep: sanitizeText(saleData.ciudad_receptor || ''),
            },
            Totales: {
                MntExe: montoTotal,
                MntTotal: montoTotal,
            },
        },
        Detalle: detalles,
    };

    // Forma de pago
    if (saleData.forma_pago === 'credito') {
        dteData.Encabezado.IdDoc.FmaPago = 2;
        if (saleData.dias_credito) {
            const fchVenc = new Date();
            fchVenc.setDate(fchVenc.getDate() + parseInt(saleData.dias_credito));
            dteData.Encabezado.IdDoc.FchVenc = fchVenc.toISOString().split('T')[0];
        }
    } else {
        dteData.Encabezado.IdDoc.FmaPago = 1;
    }

    const dte = new DTE(dteData);
    dte.generarXML().timbrar(caf);

    return { dte, montoTotal, montoNeto: 0, montoIva: 0 };
}

// ─── Enviar DTE al SII ───

export async function enviarDTE(dte, siiConfig, cert, tipoDte) {
    const ambiente = siiConfig.ambiente || 'certificacion';

    let envio;
    if (tipoDte === 39 || tipoDte === 41) {
        envio = new EnvioBOLETA({ certificado: cert });
    } else {
        envio = new EnvioDTE({ certificado: cert });
    }

    envio.agregar(dte);
    envio.setCaratula({
        RutEmisor: siiConfig.rut_emisor,
        RutEnvia: siiConfig.rut_emisor,
        FchResol: siiConfig.sii_resolution_date || '2014-08-22',
        NroResol: parseInt(siiConfig.sii_resolution_number) || 0,
    });
    envio.generar();

    const enviador = new EnviadorSII(cert, ambiente);
    const resultado = await enviador.enviarDteSoap(envio);

    return resultado;
}

// ─── Consultar estado ───

export async function consultarEstado(trackId, siiConfig, cert) {
    const ambiente = siiConfig.ambiente || 'certificacion';
    const enviador = new EnviadorSII(cert, ambiente);

    const estado = await enviador.consultarEstadoEnvio({
        trackId,
        rutEmisor: siiConfig.rut_emisor,
    });

    return estado;
}

// ─── Generar RCOF (Resumen Consumo de Folios) ───

export function generarRCOF(boletas, siiConfig, cert) {
    const rcof = new ConsumoFolio({ certificado: cert });

    for (const boleta of boletas) {
        rcof.agregar(boleta);
    }

    rcof.setCaratula({
        RutEmisor: siiConfig.rut_emisor,
        FchResol: siiConfig.sii_resolution_date || '2014-08-22',
        NroResol: parseInt(siiConfig.sii_resolution_number) || 0,
    });
    rcof.generar();

    return rcof;
}

// ─── Helpers ───

function sanitizeText(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '')
        .normalize('NFC')
        .substring(0, 100);
}
