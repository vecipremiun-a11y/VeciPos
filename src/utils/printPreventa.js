import bwipjs from 'bwip-js';
import { formatCurrency } from './formatCurrency';

export const printPreventa = async (code, items, total, vendedorName, company = {}, format = '80mm') => {
    const companyName = typeof company === 'string' ? company : (company.name || 'POSKEM');
    const companyPhone = typeof company === 'string' ? '' : (company.phone || '');
    const companyAddress = typeof company === 'string' ? '' : (company.address || '');
    const headerMessage = typeof company === 'string' ? '' : (company.headerMessage || '');
    const footerMessage = typeof company === 'string' ? '' : (company.footerMessage || '');

    // Generate barcode image
    let barcodeDataUrl = '';
    try {
        const canvas = document.createElement('canvas');
        bwipjs.toCanvas(canvas, {
            bcid: 'code128',
            text: code,
            scale: 3,
            height: 14,
            includetext: true,
            textxalign: 'center',
            textsize: 10,
        });
        barcodeDataUrl = canvas.toDataURL('image/png');
    } catch (e) {
        console.error('Error generating barcode:', e);
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Por favor permite ventanas emergentes para imprimir.');
        return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    const itemsHtml = items.map(item => {
        const qty = item.quantity || 1;
        const price = item.price || 0;
        const subtotal = price * qty;
        return `
            <tr>
                <td class="item-name">${item.name}</td>
                <td class="item-qty">${qty}</td>
                <td class="item-price">${formatCurrency(price)}</td>
                <td class="item-total">${formatCurrency(subtotal)}</td>
            </tr>
        `;
    }).join('');

    const totalQty = items.reduce((sum, i) => sum + (i.quantity || 1), 0);

    const contactLine = [companyPhone, companyAddress].filter(Boolean).join(' | ');
    const footerText = footerMessage || 'Presentar este ticket en caja para pago';

    // Format-dependent settings
    const isA4 = format === 'a4';
    const is58 = format === '58mm';
    const pageSize = isA4 ? 'A4' : `${format} auto`;
    const pageMargin = isA4 ? '15mm' : '2mm';
    const bodyWidth = isA4 ? '190mm' : '100%';
    const bodyPadding = isA4 ? '10mm' : '0';
    const baseFontSize = isA4 ? '14px' : (is58 ? '10px' : '11px');
    const companyFontSize = isA4 ? '24px' : (is58 ? '14px' : '18px');
    const docTypeFontSize = isA4 ? '28px' : (is58 ? '16px' : '22px');
    const contactFontSize = isA4 ? '11px' : (is58 ? '8px' : '9px');
    const infoFontSize = isA4 ? '12px' : (is58 ? '9px' : '10px');
    const titleFontSize = isA4 ? '16px' : (is58 ? '11px' : '13px');
    const thFontSize = isA4 ? '11px' : (is58 ? '8px' : '9px');
    const itemNameFontSize = isA4 ? '14px' : (is58 ? '10px' : '12px');
    const itemQtyFontSize = isA4 ? '14px' : (is58 ? '10px' : '12px');
    const itemPriceFontSize = isA4 ? '13px' : (is58 ? '9px' : '11px');
    const itemTotalFontSize = isA4 ? '14px' : (is58 ? '10px' : '12px');
    const totalLabelFontSize = isA4 ? '20px' : (is58 ? '13px' : '16px');
    const totalAmountFontSize = isA4 ? '28px' : (is58 ? '18px' : '22px');
    const countFontSize = isA4 ? '11px' : (is58 ? '8px' : '9px');
    const barcodeFontSize = isA4 ? '14px' : (is58 ? '10px' : '12px');
    const footerFontSize = isA4 ? '13px' : (is58 ? '9px' : '11px');
    const footerSubFontSize = isA4 ? '10px' : (is58 ? '7px' : '8px');

    const content = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Preventa ${code}</title>
            <style>
                @page { size: ${pageSize}; margin: ${pageMargin}; }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    width: ${bodyWidth}; 
                    ${isA4 ? 'max-width: 190mm; margin: 0 auto; padding: ' + bodyPadding + ';' : ''}
                    color: #000; 
                    font-size: ${baseFontSize};
                    line-height: 1.3;
                }

                /* Header */
                .header {
                    text-align: center;
                    padding-bottom: 6px;
                    border-bottom: 2px solid #000;
                    margin-bottom: 6px;
                }
                .company-name {
                    font-size: ${companyFontSize};
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 2px;
                }
                .doc-type {
                    font-size: ${docTypeFontSize};
                    font-weight: 900;
                    letter-spacing: 3px;
                    background: #000;
                    color: #fff;
                    padding: 4px 12px;
                    display: inline-block;
                    margin: 4px 0;
                }
                .contact-info {
                    font-size: ${contactFontSize};
                    color: #333;
                    margin-top: 2px;
                }

                /* Vendor & Date info */
                .info-section {
                    display: flex;
                    justify-content: space-between;
                    padding: 5px 0;
                    border-bottom: 1px dashed #000;
                    margin-bottom: 6px;
                    font-size: ${infoFontSize};
                }
                .info-section .label { font-weight: bold; }

                /* Products table */
                .products-title {
                    font-size: ${titleFontSize};
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 4px;
                    border-bottom: 1px solid #000;
                    padding-bottom: 2px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 4px;
                }
                th {
                    text-align: left;
                    font-size: ${thFontSize};
                    font-weight: 900;
                    text-transform: uppercase;
                    border-bottom: 1px solid #999;
                    padding: 3px 2px;
                    color: #333;
                }
                th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
                td {
                    padding: 4px 2px;
                    vertical-align: top;
                    border-bottom: 1px dotted #ccc;
                }
                .item-name { 
                    font-size: ${itemNameFontSize}; 
                    font-weight: 700; 
                    max-width: 55%;
                    word-wrap: break-word;
                }
                .item-qty { text-align: right; font-size: ${itemQtyFontSize}; font-weight: 600; }
                .item-price { text-align: right; font-size: ${itemPriceFontSize}; color: #444; }
                .item-total { text-align: right; font-size: ${itemTotalFontSize}; font-weight: 700; }

                /* Total */
                .total-section {
                    border-top: 2px solid #000;
                    margin-top: 4px;
                    padding-top: 6px;
                }
                .total-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .total-label {
                    font-size: ${totalLabelFontSize};
                    font-weight: 900;
                    text-transform: uppercase;
                }
                .total-amount {
                    font-size: ${totalAmountFontSize};
                    font-weight: 900;
                }
                .items-count {
                    font-size: ${countFontSize};
                    color: #555;
                    margin-top: 2px;
                }

                /* Barcode */
                .barcode-section {
                    text-align: center;
                    margin-top: 8px;
                    padding-top: 6px;
                    border-top: 1px dashed #000;
                }
                .barcode-section img { max-width: ${isA4 ? '50%' : '90%'}; height: auto; }
                .barcode-code {
                    font-size: ${barcodeFontSize};
                    font-weight: 700;
                    letter-spacing: 2px;
                    margin-top: 2px;
                }

                /* Footer */
                .footer {
                    text-align: center;
                    margin-top: 8px;
                    padding-top: 4px;
                    border-top: 1px dashed #000;
                    font-size: ${footerFontSize};
                    font-weight: 700;
                }
                .footer-sub {
                    font-size: ${footerSubFontSize};
                    color: #666;
                    margin-top: 2px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="company-name">${companyName}</div>
                <div class="doc-type">PREVENTA</div>
                ${contactLine ? `<div class="contact-info">${contactLine}</div>` : ''}
                ${headerMessage ? `<div class="contact-info" style="margin-top:2px;font-style:italic">${headerMessage}</div>` : ''}
            </div>

            <div class="info-section">
                <div>
                    <span class="label">Atendido por:</span> ${vendedorName}
                </div>
                <div>
                    <span class="label">Fecha:</span> ${dateStr} ${timeStr}
                </div>
            </div>

            <div class="products-title">Detalle de Productos</div>
            <table>
                <thead>
                    <tr>
                        <th>Producto</th>
                        <th>Cant.</th>
                        <th>Precio</th>
                        <th>Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="total-section">
                <div class="total-row">
                    <span class="total-label">Total a Pagar</span>
                    <span class="total-amount">${formatCurrency(total)}</span>
                </div>
                <div class="items-count">${totalQty} artículo${totalQty !== 1 ? 's' : ''}</div>
            </div>

            <div class="barcode-section">
                ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" alt="${code}" />` : ''}
                <div class="barcode-code">${code}</div>
            </div>

            <div class="footer">
                ${footerText}
                <div class="footer-sub">Este documento no es válido como boleta o factura</div>
            </div>

            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
};
