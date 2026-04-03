import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatCurrency } from './formatCurrency';

export const generateReceiptPDF = async (saleDetails, seller, receiptConfig = null, currencyCode = 'CLP', timbreImg = null) => {
    // Si no se pasa config, usar valores por defecto
    const config = receiptConfig || {
        business_name: 'VECI',
        address: 'Sotomayor 1460-A',
        tax_id: null,
        phone: null,
        email: null,
        header_message: null,
        footer_message: '¡GRACIAS POR SU COMPRA!\nVuelva pronto',
        show_tax_id: false,
        show_phone: false,
        show_email: false
    };

    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [58, 200] // 58mm width
    });

    // Setup font styles
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);

    let yPos = 10;

    // Header - Nombre del Negocio
    doc.text(config.business_name || 'VECI', 29, yPos, { align: 'center' });
    yPos += 5;

    // Dirección
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(config.address || 'Sotomayor 1460-A', 29, yPos, { align: 'center' });
    yPos += 4;

    // RUT/NIT (si está configurado y habilitado)
    if (config.show_tax_id && config.tax_id) {
        doc.text(`RUT: ${config.tax_id}`, 29, yPos, { align: 'center' });
        yPos += 4;
    }

    // Teléfono (si está configurado y habilitado)
    if (config.show_phone && config.phone) {
        doc.text(`Tel: ${config.phone}`, 29, yPos, { align: 'center' });
        yPos += 4;
    }

    // Email (si está configurado y habilitado)
    if (config.show_email && config.email) {
        doc.text(config.email, 29, yPos, { align: 'center' });
        yPos += 4;
    }

    // Mensaje cabecera personalizado (si existe)
    if (config.header_message) {
        yPos += 2;
        const headerLines = doc.splitTextToSize(config.header_message, 54);
        headerLines.forEach(line => {
            doc.text(line, 29, yPos, { align: 'center' });
            yPos += 3;
        });
    }

    yPos += 2;

    const sellerName = seller?.name || 'Vendedor';
    const date = new Date(saleDetails.date || Date.now()).toLocaleString('es-CL');
    const ticketId = saleDetails.id ? `T-${String(saleDetails.id).slice(-6)}` : `T-${Date.now().toString().slice(-6)}`;

    doc.setFontSize(7);
    // DTE folio (if SII electronic invoicing is active)
    if (saleDetails.dte_folio) {
        const dteLabel = saleDetails.dte_tipo === 33 ? 'Factura Electrónica' : 'Boleta Electrónica';
        doc.setFont('courier', 'bold');
        doc.text(`${dteLabel}`, 29, yPos, { align: 'center' });
        yPos += 3;
        doc.text(`Folio N° ${saleDetails.dte_folio}`, 29, yPos, { align: 'center' });
        yPos += 4;
        doc.setFont('courier', 'normal');
    }
    doc.text(`Boleta: ${ticketId}`, 2, yPos);
    yPos += 4;
    doc.text(`Fecha: ${date}`, 2, yPos);
    yPos += 4;
    doc.text(`Vend: ${sellerName}`, 2, yPos);
    yPos += 4;

    doc.text('--------------------------------', 2, yPos);
    yPos += 5;

    // Items
    doc.setFont('courier', 'bold');
    doc.text('DESCRIPCIÓN', 2, yPos);
    doc.text('TOTAL', 56, yPos, { align: 'right' });
    yPos += 4;
    doc.setFont('courier', 'normal');
    doc.text('--------------------------------', 2, yPos);
    yPos += 4;

    const items = saleDetails.items || [];
    items.forEach(item => {
        const splitName = doc.splitTextToSize(item.name, 54);
        doc.text(splitName, 2, yPos);
        yPos += splitName.length * 3;

        doc.text(`${item.quantity} x ${formatCurrency(item.price, currencyCode)}`, 2, yPos);
        doc.text(`${formatCurrency(item.price * item.quantity, currencyCode)}`, 56, yPos, { align: 'right' });
        yPos += 5;
    });

    doc.text('--------------------------------', 2, yPos);
    yPos += 5;

    // Totals
    const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
    const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;
    const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
    const change = saleDetails.paymentDetails?.change || 0;

    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.text('TOTAL', 2, yPos);
    doc.text(`${formatCurrency(saleDetails.total, currencyCode)}`, 56, yPos, { align: 'right' });
    yPos += 6;

    if (saleDetails.status === 'cancelled') {
        doc.setTextColor(255, 0, 0);
        doc.text('ANULADA', 29, yPos, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        yPos += 6;
    }

    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text('Medio Pago:', 2, yPos);
    doc.text(paymentLabel, 56, yPos, { align: 'right' });
    yPos += 5;

    if (isCash) {
        doc.text('Pagó con:', 2, yPos);
        doc.text(`${formatCurrency(amountPaid, currencyCode)}`, 56, yPos, { align: 'right' });
        yPos += 5;
        doc.text('Vuelto:', 2, yPos);
        doc.text(`${formatCurrency(change, currencyCode)}`, 56, yPos, { align: 'right' });
        yPos += 5;
    }

    // Footer personalizado
    yPos += 10;
    doc.setFontSize(8);
    const footerMessage = config.footer_message || '¡GRACIAS POR SU COMPRA!\nVuelva pronto';
    const footerLines = footerMessage.split('\n');
    footerLines.forEach(line => {
        doc.text(line, 29, yPos, { align: 'center' });
        yPos += 5;
    });

    // Timbre SII (PDF417)
    if (timbreImg) {
        yPos += 5;
        doc.setFontSize(6);
        doc.text('Timbre Electrónico SII', 29, yPos, { align: 'center' });
        yPos += 3;
        doc.addImage(timbreImg, 'PNG', 2, yPos, 54, 18);
        yPos += 20;
        doc.setFontSize(5);
        doc.text('Res. Ex. SII - Documento tributario electrónico', 29, yPos, { align: 'center' });
        yPos += 4;
    }

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
    const ticketId = saleDetails.id ? `T-${String(saleDetails.id).slice(-6)}` : `T-${Date.now().toString().slice(-6)}`;

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
