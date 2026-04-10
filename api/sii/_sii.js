import { Certificado, CAF, DTE, EnvioDTE, EnvioBOLETA, EnviadorSII } from '@devlas/dte-sii';
import ConsumoFolio from '@devlas/dte-sii/ConsumoFolio.js';
import crypto from 'crypto';
import https from 'https';
import FormData from 'form-data';

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
    const tz = saleData.timezone;
    const taxRate = 0.19; // IVA Chile 19%

    // Calcular totales — aplicar descuento por item
    let montoTotal = 0;
    const detalles = items.map((item, idx) => {
        const qty = parseFloat(item.quantity) || 1;
        const priceWithTax = parseFloat(item.price) || 0;
        const discount = parseFloat(item.discountPercent) || 0;
        const effectivePrice = discount > 0 ? Math.round(priceWithTax * (1 - discount / 100)) : Math.round(priceWithTax);
        const itemTaxRate = parseFloat(item.tax_rate) || 0;
        const montoItem = Math.round(effectivePrice * qty);
        montoTotal += montoItem;

        const detail = {
            NroLinDet: idx + 1,
            ...(itemTaxRate === 0 ? { IndExe: 1 } : {}),
            NmbItem: sanitizeText(item.name),
            QtyItem: qty,
            PrcItem: effectivePrice,
            MontoItem: montoItem,
        };

        return detail;
    });

    // Calcular IVA
    const afectoTotal = detalles.reduce((sum, d, i) => {
        return (parseFloat(items[i].tax_rate) || 0) > 0 ? sum + d.MontoItem : sum;
    }, 0);
    const montoNeto = Math.round(afectoTotal / (1 + taxRate));
    const montoIva = afectoTotal - montoNeto;

    const montoExento = detalles.reduce((sum, d, i) => {
        return (parseFloat(items[i].tax_rate) || 0) === 0 ? sum + d.MontoItem : sum;
    }, 0);

    const dteData = {
        Encabezado: {
            IdDoc: {
                TipoDTE: 39,
                Folio: folio,
                FchEmis: fechaEmpresa(tz),
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
                ...(montoNeto > 0 ? { MntNeto: montoNeto } : {}),
                ...(montoExento > 0 ? { MntExe: montoExento } : {}),
                ...(montoNeto > 0 ? { IVA: montoIva } : {}),
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
    const tz = saleData.timezone;
    const taxRate = 0.19;

    let montoTotal = 0;
    const detalles = items.map((item, idx) => {
        const qty = parseFloat(item.quantity) || 1;
        const priceWithTax = parseFloat(item.price) || 0;
        const discount = parseFloat(item.discountPercent) || 0;
        const effectivePrice = discount > 0 ? priceWithTax * (1 - discount / 100) : priceWithTax;
        const itemTaxRate = parseFloat(item.tax_rate) || 0;

        // Factura: precios netos
        const priceNeto = itemTaxRate > 0
            ? Math.round(effectivePrice / (1 + taxRate))
            : Math.round(effectivePrice);

        const montoItem = Math.round(priceNeto * qty);

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
                FchEmis: fechaEmpresa(tz),
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
                MntNeto: montoNeto,
                ...(montoExento > 0 ? { MntExe: montoExento } : {}),
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
            const fchVenc = new Date(new Date().toLocaleString('en-US', { timeZone: tz || 'America/Santiago' }));
            fchVenc.setDate(fchVenc.getDate() + parseInt(saleData.dias_credito));
            dteData.Encabezado.IdDoc.FchVenc = fchVenc.toLocaleDateString('en-CA');
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
    const tz = saleData.timezone;

    let montoTotal = 0;
    const detalles = items.map((item, idx) => {
        const qty = parseFloat(item.quantity) || 1;
        const rawPrice = parseFloat(item.price) || 0;
        const discount = parseFloat(item.discountPercent) || 0;
        const price = discount > 0 ? Math.round(rawPrice * (1 - discount / 100)) : Math.round(rawPrice);
        const montoItem = Math.round(price * qty);
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
                FchEmis: fechaEmpresa(tz),
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
            const fchVenc = new Date(new Date().toLocaleString('en-US', { timeZone: tz || 'America/Santiago' }));
            fchVenc.setDate(fchVenc.getDate() + parseInt(saleData.dias_credito));
            dteData.Encabezado.IdDoc.FchVenc = fchVenc.toLocaleDateString('en-CA');
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

    // RutEnvia debe ser el RUT del certificado (persona que firma), no necesariamente el emisor
    const rutEnvia = cert.rut || siiConfig.rut_emisor;

    let envio;
    if (tipoDte === 39 || tipoDte === 41) {
        envio = new EnvioBOLETA({ certificado: cert });
    } else {
        envio = new EnvioDTE({ certificado: cert });
    }

    envio.agregar(dte);
    envio.setCaratula({
        RutEmisor: siiConfig.rut_emisor,
        RutEnvia: rutEnvia,
        FchResol: siiConfig.sii_resolution_date || '2014-08-22',
        NroResol: parseInt(siiConfig.sii_resolution_number) || 0,
    });
    envio.generar();

    const enviador = new EnviadorSII(cert, ambiente);

    let resultado;
    if (tipoDte === 39 || tipoDte === 41) {
        // FIX: La librería usa Buffer.from(xml,'utf-8') para boletas REST,
        // pero el SII exige ISO-8859-1. Enviamos nosotros con encoding correcto.
        resultado = await _enviarBoletaLatin1(enviador, envio, siiConfig.rut_emisor, rutEnvia);
    } else {
        resultado = await enviador.enviarDteSoap(envio);
    }

    return resultado;
}

// ─── Envío de boletas con encoding ISO-8859-1 correcto ───

async function _enviarBoletaLatin1(enviador, envio, rutEmisor, rutEnvia) {
    // Obtener token de autenticación
    if (!enviador.token) {
        await enviador.getToken();
    }

    let xml = envio.getXML();
    if (!xml) throw new Error('No se pudo generar el XML del EnvioBOLETA');

    if (!xml.startsWith('<?xml')) {
        xml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n' + xml;
    }

    const [rutSenderStr, dvSender] = rutEnvia.split('-');
    const [rutCompanyStr, dvCompany] = rutEmisor.split('-');
    const rutSender = parseInt(rutSenderStr.replace(/\./g, ''), 10);
    const rutCompany = parseInt(rutCompanyStr.replace(/\./g, ''), 10);

    const formData = new FormData();
    formData.append('rutSender', rutSender.toString());
    formData.append('dvSender', dvSender.toUpperCase());
    formData.append('rutCompany', rutCompany.toString());
    formData.append('dvCompany', dvCompany.toUpperCase());

    // KEY FIX: Usar 'latin1' para que los bytes coincidan con encoding="ISO-8859-1"
    const xmlBuffer = Buffer.from(xml, 'latin1');
    formData.append('archivo', xmlBuffer, {
        filename: 'EnvioBOLETA.xml',
        contentType: 'application/xml',
    });

    const url = enviador.urls[enviador.ambiente].envio;
    const urlObj = new URL(url);
    const formBuffer = formData.getBuffer();
    const formHeaders = formData.getHeaders();

    console.log(`📤 Enviando boleta al SII (latin1): ${url}, ${xmlBuffer.length} bytes`);

    const response = await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                ...formHeaders,
                'Content-Length': formBuffer.length,
                'User-Agent': 'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)',
                'Accept': 'application/json',
                'Cookie': `TOKEN=${enviador.token}`,
            },
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ text: data, status: res.statusCode }));
        });
        req.on('error', reject);
        req.write(formBuffer);
        req.end();
    });

    console.log(`📥 SII HTTP ${response.status}:`, response.text);

    // Parse response
    if (response.status !== 200) {
        return { ok: false, status: response.status, trackId: null, mensaje: `Error HTTP ${response.status}`, respuesta: response.text };
    }
    try {
        const json = JSON.parse(response.text);
        if (json.trackid) {
            return { ok: true, trackId: json.trackid.toString(), TRACKID: json.trackid.toString(), estado: json.estado };
        }
        return { ok: false, trackId: null, mensaje: json.descripcion || 'Sin trackid', respuesta: response.text };
    } catch {
        return { ok: false, trackId: null, mensaje: 'Respuesta no JSON', respuesta: response.text };
    }
}

// ─── Consultar estado ───

export async function consultarEstado(trackId, siiConfig, cert) {
    const ambiente = siiConfig.ambiente || 'certificacion';
    const enviador = new EnviadorSII(cert, ambiente);

    const estado = await enviador.consultarEstado(trackId, siiConfig.rut_emisor);

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

// Fecha actual en zona horaria de la empresa
function fechaEmpresa(tz) {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'America/Santiago' });
}

// @devlas/dte-sii sanitiza XML internamente, aquí solo limpiamos texto
function sanitizeText(text, maxLen = 80) {
    if (!text) return '';
    return text
        .replace(/'/g, '')
        .normalize('NFC')
        .trim()
        .substring(0, maxLen);
}
