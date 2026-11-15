import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatCurrency } from './formatCurrency';
import { buildSaleReceiptModel } from '../lib/saleReceipt';

// PDF de la boleta (Historial → Descargar PDF). `xml` = el DTE firmado, si la
// venta tiene boleta o factura electrónica: de ahí salen el RUT del emisor, la
// razón social, el giro, el IVA y el cliente identificado, con el mismo modelo
// que la térmica y el ticket del navegador. Antes este PDF salía igual que una
// nota de venta, solo que con el timbre (Kevin, 10-nov-2026).
export const generateReceiptPDF = async (saleDetails, seller, receiptConfig = null, currencyCode = 'CLP', timbreImg = null, xml = null) => {
    // Si no se pasa config, usar valores por defecto
    const config = receiptConfig || {
        business_name: 'VECI',
        address: null,
        tax_id: null,
        phone: null,
        email: null,
        header_message: null,
        footer_message: '¡GRACIAS POR SU COMPRA!\nVuelva pronto',
        show_tax_id: false,
        show_phone: false,
        show_email: false
    };

    const fmt = config.format || '58mm';
    const pdfWidth = fmt === 'a4' ? 210 : (fmt === '80mm' ? 80 : 58);
    const centerX = pdfWidth / 2;
    const rightX = pdfWidth - 2;
    const maxTextWidth = pdfWidth - 4;
    const separator = fmt === 'a4' ? '─'.repeat(80) : '--------------------------------';

    const model = buildSaleReceiptModel(saleDetails, {
        sellerName: seller?.name,
        receiptConfig: config,
        currency: currencyCode,
        dteInfo: saleDetails.dte_folio ? { folio: saleDetails.dte_folio } : null,
        xml,
    });

    // Dibuja la boleta en `doc` y devuelve hasta dónde llegó (mm).
    const dibujar = (doc) => {
        // Setup font styles
        doc.setFont('courier', 'bold');
        doc.setFontSize(fmt === 'a4' ? 14 : 10);

        let yPos = fmt === 'a4' ? 20 : 10;

        // Header - Nombre del Negocio
        doc.text(config.business_name || 'VECI', centerX, yPos, { align: 'center' });
        yPos += 5;

        // Razón social, RUT, giro, dirección, teléfono y email, según el modelo (en
        // la boleta electrónica, del DTE). Antes salía siempre una dirección: la de
        // la boleta o, si estaba vacía, 'Sotomayor 1460-A' en cualquier empresa.
        doc.setFont('courier', 'bold');
        doc.setFontSize(fmt === 'a4' ? 10 : 8);
        for (const linea of model.datosLineas) {
            for (const l of doc.splitTextToSize(linea, maxTextWidth)) {
                doc.text(l, centerX, yPos, { align: 'center' });
                yPos += 4;
            }
        }

        // Mensaje cabecera personalizado (si existe)
        if (config.header_message) {
            yPos += 2;
            const headerLines = doc.splitTextToSize(config.header_message, maxTextWidth);
            headerLines.forEach(line => {
                doc.text(line, centerX, yPos, { align: 'center' });
                yPos += 3;
            });
        }

        yPos += 2;

        const sellerName = seller?.name || 'Vendedor';
        const date = new Date(saleDetails.date || Date.now()).toLocaleString('es-CL');
        const ticketId = saleDetails.id ? `${saleDetails.id}` : `${Date.now().toString().slice(-6)}`;

        doc.setFontSize(fmt === 'a4' ? 9 : 7);
        // DTE folio (if SII electronic invoicing is active)
        if (saleDetails.dte_folio) {
            const dteLabel = saleDetails.dte_tipo === 33 ? 'Factura Electrónica' : 'Boleta Electrónica';
            doc.setFont('courier', 'bold');
            doc.text(`${dteLabel}`, centerX, yPos, { align: 'center' });
            yPos += 3;
            doc.text(`Folio N° ${saleDetails.dte_folio}`, centerX, yPos, { align: 'center' });
            yPos += 4;
            doc.setFont('courier', 'bold');
        } else {
            // Con boleta electrónica el número es el folio; el de la venta confundía.
            doc.text(`Boleta: ${ticketId}`, 2, yPos);
            yPos += 4;
        }
        doc.text(`Fecha: ${date}`, 2, yPos);
        yPos += 4;
        doc.text(`Vend: ${sellerName}`, 2, yPos);
        yPos += 4;
        // Cliente identificado en el DTE (el SII pide su RUT si no es el genérico).
        if (model.clientRut) {
            const filas = [model.clientName ? `Cliente: ${model.clientName}` : null, `RUT: ${model.clientRut}`, ...(model.clientLineas || [])];
            for (const fila of filas.filter(Boolean)) {
                for (const l of doc.splitTextToSize(fila, maxTextWidth)) {
                    doc.text(l, 2, yPos);
                    yPos += 4;
                }
            }
        }

        doc.text(separator, 2, yPos);
        yPos += 5;

        // Items
        doc.setFont('courier', 'bold');
        doc.text('DESCRIPCIÓN', 2, yPos);
        doc.text('TOTAL', rightX, yPos, { align: 'right' });
        yPos += 4;
        doc.setFont('courier', 'bold');
        doc.text(separator, 2, yPos);
        yPos += 4;

        const items = saleDetails.items || [];
        items.forEach(item => {
            const splitName = doc.splitTextToSize(item.name, maxTextWidth);
            doc.text(splitName, 2, yPos);
            yPos += splitName.length * 3;

            doc.text(`${item.quantity} x ${formatCurrency(item.price, currencyCode)}`, 2, yPos);
            doc.text(`${formatCurrency(item.price * item.quantity, currencyCode)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
        });

        doc.text(separator, 2, yPos);
        yPos += 5;

        // Totals
        const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
        const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;
        const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
        const change = saleDetails.paymentDetails?.change || 0;

        // Delivery de un pedido a domicilio: debajo del subtotal, fuera de los productos.
        const deliveryFee = Math.round(Number(saleDetails.paymentDetails?.deliveryFee) || 0);
        if (deliveryFee > 0) {
            doc.setFont('courier', 'normal');
            doc.text('Subtotal', 2, yPos);
            doc.text(`${formatCurrency(saleDetails.total - deliveryFee, currencyCode)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
            doc.text('Delivery', 2, yPos);
            doc.text(`${formatCurrency(deliveryFee, currencyCode)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
        }

        // IVA del DTE (obligatorio impreso): la factura lo lleva antes del total
        // (neto, exento, IVA); la boleta, debajo, como "IVA incluido".
        const desglose = () => {
            doc.setFont('courier', 'bold');
            doc.setFontSize(fmt === 'a4' ? 10 : 8);
            for (const [k, v] of model.desglose || []) {
                doc.text(k, 2, yPos);
                doc.text(formatCurrency(v, currencyCode), rightX, yPos, { align: 'right' });
                yPos += 5;
            }
        };
        if (model.desgloseAntesDelTotal) desglose();

        doc.setFont('courier', 'bold');
        doc.setFontSize(fmt === 'a4' ? 14 : 10);
        doc.text('TOTAL', 2, yPos);
        doc.text(`${formatCurrency(saleDetails.total, currencyCode)}`, rightX, yPos, { align: 'right' });
        yPos += 6;
        if (!model.desgloseAntesDelTotal && model.desglose?.length) {
            desglose();
            yPos += 1;
        }

        if (saleDetails.status === 'cancelled') {
            doc.setTextColor(255, 0, 0);
            doc.text('ANULADA', centerX, yPos, { align: 'center' });
            doc.setTextColor(0, 0, 0);
            yPos += 6;
        }

        doc.setFont('courier', 'bold');
        doc.setFontSize(fmt === 'a4' ? 10 : 8);
        doc.text('Medio Pago:', 2, yPos);
        doc.text(paymentLabel, rightX, yPos, { align: 'right' });
        yPos += 5;

        if (isCash) {
            doc.text('Pagó con:', 2, yPos);
            doc.text(`${formatCurrency(amountPaid, currencyCode)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
            doc.text('Vuelto:', 2, yPos);
            doc.text(`${formatCurrency(change, currencyCode)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
        }

        // Footer personalizado
        yPos += 10;
        doc.setFontSize(fmt === 'a4' ? 10 : 8);
        const footerMessage = config.footer_message || '¡GRACIAS POR SU COMPRA!\nVuelva pronto';
        const footerLines = footerMessage.split('\n');
        footerLines.forEach(line => {
            doc.text(line, centerX, yPos, { align: 'center' });
            yPos += 5;
        });

        // Timbre SII (PDF417)
        if (timbreImg) {
            yPos += 5;
            doc.setFontSize(6);
            doc.text('Timbre Electrónico SII', centerX, yPos, { align: 'center' });
            yPos += 3;
            const timbreWidth = Math.min(maxTextWidth, 54);
            doc.addImage(timbreImg, 'PNG', 2, yPos, timbreWidth, 18);
            yPos += 20;
            doc.setFontSize(5);
            // El SII pide indicar dónde se verifica la boleta (Formato v4.2, introducción).
            doc.text('Verifique documento: www.sii.cl', centerX, yPos, { align: 'center' });
            yPos += 4;
        }

        return yPos;
    };

    if (fmt === 'a4') {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        dibujar(doc);
        return doc.output('blob');
    }
    // Ticket: la hoja mide lo que mide la boleta. Antes era fija de 200 mm y una
    // venta con varios productos perdía el final (el timbre incluido). Una boleta
    // corta sigue saliendo en 200 mm, como siempre.
    const alto = dibujar(new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, 3000] }));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, Math.max(200, Math.ceil(alto + 8))] });
    dibujar(doc);
    return doc.output('blob');
};

export const generateWhatsAppLink = (phoneNumber, saleDetails, seller, receiptConfig = null, currencyCode = 'CLP') => {
    const config = receiptConfig || {
        business_name: 'VECI',
        address: 'Sotomayor 1460-A',
        tax_id: null,
        phone: null,
        email: null,
        header_message: null,
        footer_message: '*¡GRACIAS POR SU COMPRA!*',
        show_tax_id: false,
        show_phone: false,
        show_email: false
    };

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const fullNumber = `569${cleanNumber}`;
    const sellerName = seller?.name || 'Vendedor';
    const date = new Date(saleDetails.date || Date.now()).toLocaleString('es-CL');
    const ticketId = saleDetails.id ? `${saleDetails.id}` : `${Date.now().toString().slice(-6)}`;

    const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
    const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;

    let receiptText = `*COMPROBANTE ${config.business_name || 'VECI'}*\n`;
    receiptText += `${config.address || 'Sotomayor 1460-A'}\n`;

    if (config.show_tax_id && config.tax_id) {
        receiptText += `RUT: ${config.tax_id}\n`;
    }
    if (config.show_phone && config.phone) {
        receiptText += `Tel: ${config.phone}\n`;
    }
    if (config.show_email && config.email) {
        receiptText += `${config.email}\n`;
    }

    if (config.header_message) {
        receiptText += `\n_${config.header_message}_\n`;
    }

    receiptText += `\n`;
    // DTE folio (SII electronic invoicing)
    if (saleDetails.dte_folio) {
        const dteLabel = saleDetails.dte_tipo === 33 ? 'Factura Electrónica' : 'Boleta Electrónica';
        receiptText += `*${dteLabel} - Folio N° ${saleDetails.dte_folio}*\n`;
    }
    receiptText += `Boleta: ${ticketId}\n`;
    receiptText += `Fecha: ${date}\n`;
    receiptText += `Vend: ${sellerName}\n`;
    if (saleDetails.status === 'cancelled') {
        receiptText += `*ESTADO: ANULADA*\n`;
    }
    receiptText += `--------------------------------\n`;
    receiptText += `\`\`\``;

    receiptText += `DESCRIPCION           TOTAL\n`;
    receiptText += `---------------------------\n`;

    const items = saleDetails.items || [];
    items.forEach(item => {
        const name = item.name.length > 20 ? item.name.substring(0, 20) : item.name;
        const total = item.price * item.quantity;
        receiptText += `${name}\n`;

        const qtyPrice = `${item.quantity} x ${formatCurrency(item.price, currencyCode)}`;
        const totalStr = formatCurrency(total, currencyCode);

        const spaceNeeded = 27 - qtyPrice.length - totalStr.length;
        const spaces = spaceNeeded > 0 ? ' '.repeat(spaceNeeded) : ' ';

        receiptText += `${qtyPrice}${spaces}${totalStr}\n`;
    });

    receiptText += `---------------------------\n`;

    const deliveryFee = Math.round(Number(saleDetails.paymentDetails?.deliveryFee) || 0);
    if (deliveryFee > 0) {
        const fila = (a, b) => `${a}${' '.repeat(Math.max(1, 27 - a.length - b.length))}${b}\n`;
        receiptText += fila('Subtotal', formatCurrency(saleDetails.total - deliveryFee, currencyCode));
        receiptText += fila('Delivery', formatCurrency(deliveryFee, currencyCode));
    }

    const totalLabel = "TOTAL";
    const totalValue = formatCurrency(saleDetails.total, currencyCode);
    const totalSpaces = 27 - totalLabel.length - totalValue.length;
    receiptText += `${totalLabel}${' '.repeat(totalSpaces > 0 ? totalSpaces : 1)}${totalValue}\n`;

    receiptText += `\`\`\``;
    receiptText += `\nMedio Pago: ${paymentLabel}\n`;

    if (isCash) {
        const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
        const change = saleDetails.paymentDetails?.change || 0;
        receiptText += `Pagó con: ${formatCurrency(Number(amountPaid), currencyCode)}\n`;
        receiptText += `Vuelto: ${formatCurrency(Number(change), currencyCode)}\n`;
    }

    receiptText += `\n${config.footer_message || '*¡GRACIAS POR SU COMPRA!*'}`;

    const encodedMessage = encodeURIComponent(receiptText);
    return `https://wa.me/${fullNumber}?text=${encodedMessage}`;
};
