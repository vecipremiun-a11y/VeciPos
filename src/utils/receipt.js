import jsPDF from 'jspdf';
import 'jspdf-autotable';

export const formatMoney = (amount) => {
    return '$' + Number(amount).toLocaleString('es-CL');
};

export const generateReceiptPDF = (saleDetails, seller) => {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [58, 200] // 58mm width
    });

    // Setup font styles
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);

    // Header
    doc.text('VECI', 29, 10, { align: 'center' });
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text('Sotomayor 1460-A', 29, 15, { align: 'center' });

    const sellerName = seller?.name || 'Vendedor';
    const date = new Date(saleDetails.date || Date.now()).toLocaleString('es-CL');
    // If ticketId is not in saleDetails, generate one from id or date
    const ticketId = saleDetails.id ? `T-${String(saleDetails.id).slice(-6)}` : `T-${Date.now().toString().slice(-6)}`;

    doc.setFontSize(7);
    doc.text(`Boleta: ${ticketId}`, 2, 25);
    doc.text(`Fecha: ${date}`, 2, 29);
    doc.text(`Vend: ${sellerName}`, 2, 33);

    doc.text('--------------------------------', 2, 37);

    // Items
    let yPos = 42;
    doc.setFont('courier', 'bold');
    doc.text('DESCRIPCIÓN', 2, yPos);
    doc.text('TOTAL', 56, yPos, { align: 'right' });
    yPos += 4;
    doc.setFont('courier', 'normal');
    doc.text('--------------------------------', 2, yPos);
    yPos += 4;

    const items = saleDetails.items || [];
    items.forEach(item => {
        // Split name if too long
        const splitName = doc.splitTextToSize(item.name, 54);
        doc.text(splitName, 2, yPos);
        yPos += splitName.length * 3;

        doc.text(`${item.quantity} x ${Number(item.price).toLocaleString('es-CL')}`, 2, yPos);
        doc.text(`$${(item.price * item.quantity).toLocaleString('es-CL')}`, 56, yPos, { align: 'right' });
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
    doc.text(`$${Number(saleDetails.total).toLocaleString('es-CL')}`, 56, yPos, { align: 'right' });
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
        doc.text(`$${Number(amountPaid).toLocaleString('es-CL')}`, 56, yPos, { align: 'right' });
        yPos += 5;
        doc.text('Vuelto:', 2, yPos);
        doc.text(`$${Number(change).toLocaleString('es-CL')}`, 56, yPos, { align: 'right' });
        yPos += 5;
    }

    // Footer
    yPos += 10;
    doc.setFontSize(8);
    doc.text('¡GRACIAS POR SU COMPRA!', 29, yPos, { align: 'center' });
    yPos += 5;
    doc.text('Vuelva pronto', 29, yPos, { align: 'center' });

    return doc.output('blob');
};

export const generateWhatsAppLink = (phoneNumber, saleDetails, seller) => {
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const fullNumber = `569${cleanNumber}`;
    const sellerName = seller?.name || 'Vendedor';
    const date = new Date(saleDetails.date || Date.now()).toLocaleString('es-CL');
    const ticketId = saleDetails.id ? `T-${String(saleDetails.id).slice(-6)}` : `T-${Date.now().toString().slice(-6)}`;

    const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
    const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;

    let receiptText = `*COMPROBANTE VECI*\n`;
    receiptText += `Sotomayor 1460-A\n\n`;
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

        const qtyPrice = `${item.quantity} x ${formatMoney(item.price)}`;
        const totalStr = formatMoney(total);

        const spaceNeeded = 27 - qtyPrice.length - totalStr.length;
        const spaces = spaceNeeded > 0 ? ' '.repeat(spaceNeeded) : ' ';

        receiptText += `${qtyPrice}${spaces}${totalStr}\n`;
    });

    receiptText += `---------------------------\n`;

    const totalLabel = "TOTAL";
    const totalValue = formatMoney(saleDetails.total);
    const totalSpaces = 27 - totalLabel.length - totalValue.length;
    receiptText += `${totalLabel}${' '.repeat(totalSpaces > 0 ? totalSpaces : 1)}${totalValue}\n`;

    receiptText += `\`\`\``;
    receiptText += `\nMedio Pago: ${paymentLabel}\n`;

    if (isCash) {
        const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
        const change = saleDetails.paymentDetails?.change || 0;
        receiptText += `Pagó con: ${formatMoney(Number(amountPaid))}\n`;
        receiptText += `Vuelto: ${formatMoney(Number(change))}\n`;
    }

    receiptText += `\n*¡GRACIAS POR SU COMPRA!*`;

    const encodedMessage = encodeURIComponent(receiptText);
    return `https://wa.me/${fullNumber}?text=${encodedMessage}`;
};
