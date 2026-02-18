
import { formatCurrency } from './formatCurrency';

export const printPreorder = (preorder, items, companyName = 'POSKEM') => {
    const printWindow = window.open('', '_blank');

    if (!printWindow) {
        alert('Por favor permite ventanas emergentes para imprimir el comprobante.');
        return;
    }

    const styles = `
        <style>
            @page {
                size: 58mm auto;
                margin: 0mm;
            }
            body { 
                font-family: 'Courier New', monospace; 
                width: 100%;
                margin: 0; 
                padding: 1px; 
                color: #000;
                box-sizing: border-box;
            }
            .header { text-align: center; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 5px; }
            .title { font-size: 18px; font-weight: bold; margin: 0; text-transform: uppercase; }
            .subtitle { font-size: 12px; margin: 3px 0; }
            .info-row { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 12px; }
            .client-box { border: 2px solid #000; padding: 5px; margin: 5px 0; text-align: center; }
            .client-name { font-size: 18px; font-weight: bold; display: block; }
            .due-date { font-size: 16px; font-weight: bold; text-align: center; margin: 5px 0; }
            .section-title { font-weight: bold; border-bottom: 2px solid #000; margin-top: 10px; margin-bottom: 4px; font-size: 14px; text-transform: uppercase; }
            .item-row { margin-bottom: 5px; border-bottom: 1px dotted #000; padding-bottom: 2px; }
            .item-header { display: flex; justify-content: space-between; align-items: flex-start; font-weight: bold; font-size: 14px; }
            .item-header span:first-child { max-width: 75%; }
            .item-note { font-style: italic; font-size: 12px; margin-left: 0; display: block; margin-top: 2px; }
            .totals { margin-top: 10px; border-top: 2px dashed #000; padding-top: 5px; }
            .total-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px; font-weight: bold; }
            .balance { font-size: 18px; font-weight: 900; margin-top: 5px; border-top: 1px solid #000; padding-top: 2px; }
            .footer { text-align: center; margin-top: 15px; font-size: 10px; }
        </style>
    `;

    const itemsHtml = items.map(item => `
        <div class="item-row">
            <div class="item-header">
                <span>${item.qty} ${item.unit || ''} x ${item.name}</span>
                <span>${formatCurrency(item.total || 0)}</span>
            </div>
            ${item.note ? `<div class="item-note">📝 ${item.note}</div>` : ''}
        </div>
    `).join('');

    const content = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Encargo #${preorder.id || 'Nuevo'}</title>
            ${styles}
        </head>
        <body>
            <div class="header">
                <h1 class="title">ORDEN DE ENCARGO</h1>
                <p class="subtitle">${companyName}</p>
                <p>Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
            </div>

            <div class="client-box">
                <span style="font-size:12px">CLIENTE</span><br>
                <span class="client-name">${preorder.clientName}</span>
                <span>${preorder.clientPhone || 'Sin teléfono'}</span>
            </div>

            <div class="due-date">
                ENTREGA: ${preorder.dueDate} - ${preorder.dueTime}
                <br>
                <span style="font-size:14px; font-weight:normal">${preorder.deliveryType === 'delivery' ? '🚗 DELIVERY' : '🏪 RETIRO EN TIENDA'}</span>
            </div>

            <div class="section-title">DETALLE PRODUCTOS</div>
            <div class="items-list">
                ${itemsHtml}
            </div>

            <div class="totals">
                <div class="total-row">
                    <span>Total Estimado:</span>
                    <span>${formatCurrency(preorder.totalAmount)}</span>
                </div>
                <div class="total-row">
                    <span>Abono (${preorder.paymentMethod || 'Efec.'}):</span>
                    <span>${formatCurrency(preorder.depositAmount)}</span>
                </div>
                <div class="total-row balance">
                    <span>POR PAGAR:</span>
                    <span>${formatCurrency(preorder.totalAmount - preorder.depositAmount)}</span>
                </div>
            </div>

            ${preorder.notes ? `
                <div class="section-title">NOTA GENERAL</div>
                <p style="font-size: 16px; font-weight: bold;">${preorder.notes}</p>
            ` : ''}

            <div class="footer">
                <p>Gracias por su preferencia!</p>
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
