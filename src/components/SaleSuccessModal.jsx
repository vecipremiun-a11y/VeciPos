import React, { useState } from 'react';
import { X, Printer, ShoppingCart, FileText, Send } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { useRef } from 'react';

const SaleSuccessModal = ({ isOpen, onClose, saleDetails, onNewSale, seller }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const receiptRef = useRef(null);

    if (!isOpen || !saleDetails) return null;

    const generatePDF = () => {
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [58, 200] // 58mm width, arbitrary long height
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
        const date = new Date().toLocaleString('es-CL');
        const ticketId = `T-${Date.now().toString().slice(-6)}`;

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

        saleDetails.items.forEach(item => {
            // Split name if too long
            const splitName = doc.splitTextToSize(item.name, 54);
            doc.text(splitName, 2, yPos);
            yPos += splitName.length * 3;

            doc.text(`${item.quantity} x $${item.price.toLocaleString('es-CL')}`, 2, yPos);
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
        doc.text(`$${saleDetails.total.toLocaleString('es-CL')}`, 56, yPos, { align: 'right' });
        yPos += 6;

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

    const handleWhatsAppShare = () => {
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const fullNumber = `569${cleanNumber}`;
        const sellerName = seller?.name || 'Vendedor';
        const date = new Date().toLocaleString('es-CL');
        const ticketId = `T-${Date.now().toString().slice(-6)}`;

        const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
        const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;

        const formatMoney = (amount) => `$${amount.toLocaleString('es-CL')}`;

        let receiptText = `*COMPROBANTE VECI*\n`;
        receiptText += `Sotomayor 1460-A\n\n`;
        receiptText += `Boleta: ${ticketId}\n`;
        receiptText += `Fecha: ${date}\n`;
        receiptText += `Vend: ${sellerName}\n`;
        receiptText += `--------------------------------\n`;
        receiptText += `\`\`\``;

        receiptText += `DESCRIPCION           TOTAL\n`;
        receiptText += `---------------------------\n`;

        saleDetails.items.forEach(item => {
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
        window.open(`https://wa.me/${fullNumber}?text=${encodedMessage}`, '_blank');
    };
    const handlePrint = () => {
        const printWindow = window.open('', '', 'width=300,height=600');
        const sellerName = seller?.name || 'Vendedor';
        const date = new Date().toLocaleString('es-CL');
        const ticketId = `T-${Date.now().toString().slice(-6)}`;

        const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
        const change = saleDetails.paymentDetails?.change || 0;

        // Check for various casing of 'cash' or 'efectivo'
        const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
        const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;

        printWindow.document.write(`
            <html>
                <head>
                    <title>Ticket de Venta</title>
                    <style>
                        @page { margin: 0; }
                        body { 
                            font-family: 'Courier New', monospace; 
                            width: 58mm; 
                            margin: 0; 
                            padding: 5px; 
                            font-size: 12px;
                            line-height: 1.2;
                        }
                        .text-center { text-align: center; }
                        .text-right { text-align: right; }
                        .bold { font-weight: bold; }
                        .header { margin-bottom: 10px; }
                        .separator { border-top: 1px dashed black; margin: 8px 0; }
                        .item { margin-bottom: 4px; }
                        .item-name { 
                            width: 100%; 
                            font-weight: bold; 
                            white-space: nowrap; 
                            overflow: hidden; 
                            text-overflow: ellipsis; 
                        }
                        .item-details { 
                            display: flex; 
                            justify-content: space-between; 
                        }
                        .totals { margin-top: 10px; }
                        .footer { margin-top: 20px; font-size: 10px; }
                    </style>
                </head>
                <body>
                    <div class="header text-center">
                        <h2 style="margin:0; font-size: 16px;">VECI</h2>
                        <div style="font-size: 10px;">Sotomayor 1460-A</div>
                        <br/>
                        <div style="font-size: 10px; text-align: left;">
                            <div>Boleta: ${ticketId}</div>
                            <div>Fecha: ${date}</div>
                            <div>Vend: ${sellerName}</div> 
                        </div>
                    </div>

                    <div class="separator"></div>

                    <div style="font-size: 10px; font-weight: bold; display: flex; justify-content: space-between;">
                        <span>DESCRIPCIÓN</span>
                        <span> TOTAL</span>
                    </div>
                    <div class="separator"></div>

                    ${saleDetails.items.map(item => `
                        <div class="item">
                            <div class="item-name">${item.name}</div>
                            <div class="item-details">
                                <span>${item.quantity} x $${item.price.toLocaleString('es-CL')}</span>
                                <span>$${(item.price * item.quantity).toLocaleString('es-CL')}</span>
                            </div>
                        </div>
                    `).join('')}
                    
                    <div class="separator"></div>
                    
                    <div class="totals">
                        <div style="display: flex; justify-content: space-between; font-size: 14px;" class="bold">
                            <span>TOTAL</span>
                            <span>$${saleDetails.total.toLocaleString('es-CL')}</span>
                        </div>
                        <br/>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Medio Pago:</span>
                            <span>${paymentLabel}</span>
                        </div>
                         ${isCash ? `
                            <div style="display: flex; justify-content: space-between;">
                                <span>Pagó con:</span>
                                <span>$${Number(amountPaid).toLocaleString('es-CL')}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Vuelto:</span>
                                <span>$${Number(change).toLocaleString('es-CL')}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="footer text-center">
                        <div>¡GRACIAS POR SU COMPRA!</div>
                        <div style="margin-top: 5px;">Vuelva pronto</div>
                    </div>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onNewSale(); // Close/New Sale on backdrop click
                }
            }}
        >
            <div className="glass-card w-full max-w-md relative animate-[float_0.5s_ease-out] flex flex-col items-center text-center p-8 bg-[#0f0f2d]">
                <button
                    onClick={onNewSale} // Close triggers new sale/cleanup
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>

                <h2 className="text-2xl font-bold text-white mb-2">¡Venta completada!</h2>
                <p className="text-4xl font-bold text-[var(--color-primary)] mb-8">
                    ${saleDetails.total.toLocaleString('es-CL')}
                </p>

                <div className="w-full text-left bg-white/5 rounded-xl p-4 mb-6 border border-white/10">
                    <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
                        <Send size={14} />
                        Enviar por WhatsApp
                    </label>
                    <div className="flex gap-2">
                        <div className="flex items-center justify-center px-3 bg-black/40 rounded-lg border border-white/10 text-gray-400 font-mono">
                            +56 9
                        </div>
                        <input
                            type="tel"
                            placeholder="12345678"
                            className="glass-input flex-1 font-mono text-lg tracking-wider"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 8))}
                            autoFocus
                        />
                    </div>
                </div>

                <button
                    onClick={handleWhatsAppShare}
                    disabled={phoneNumber.length < 8}
                    className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-6 shadow-lg shadow-green-900/20"
                >
                    <Send size={20} />
                    Compartir por WhatsApp
                </button>

                <div className="grid grid-cols-3 gap-3 w-full">
                    <button
                        onClick={handlePrint}
                        className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-xs text-gray-300"
                    >
                        <Printer size={20} />
                        Imprimir
                    </button>
                    <button
                        onClick={onNewSale}
                        className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/20 border border-[var(--color-primary)]/30 transition-colors text-xs text-[var(--color-primary)] font-bold"
                    >
                        <ShoppingCart size={20} />
                        Nueva Venta
                    </button>
                    <button className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 transition-colors text-xs text-blue-400">
                        <FileText size={20} />
                        Factura
                    </button>
                </div>
            </div>


            {/* Hidden Receipt for Image Generation */}
            <div style={{ position: 'absolute', top: -9999, left: -9999, visibility: 'visible' }}>
                <div ref={receiptRef} style={{
                    width: '58mm',
                    padding: '10px',
                    background: 'white',
                    color: 'black',
                    fontFamily: 'Courier New, monospace',
                    fontSize: '12px',
                    lineHeight: '1.2'
                }}>
                    <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>VECI</h2>
                        <div style={{ fontSize: '10px' }}>Sotomayor 1460-A</div>
                        <br />
                        <div style={{ textAlign: 'left', fontSize: '10px' }}>
                            <div>Boleta: {`T-${Date.now().toString().slice(-6)}`}</div>
                            <div>Fecha: {new Date().toLocaleString('es-CL')}</div>
                            <div>Vend: {seller?.name || 'Vendedor'}</div>
                        </div>
                    </div>

                    <div style={{ borderTop: '1px dashed black', margin: '8px 0' }}></div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 'bold' }}>
                        <span>DESCRIPCIÓN</span>
                        <span>TOTAL</span>
                    </div>

                    <div style={{ borderTop: '1px dashed black', margin: '8px 0' }}></div>

                    {saleDetails.items.map((item, idx) => (
                        <div key={idx} style={{ marginBottom: '4px' }}>
                            <div style={{ width: '100%', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.name}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>{item.quantity} x ${item.price.toLocaleString('es-CL')}</span>
                                <span>${(item.price * item.quantity).toLocaleString('es-CL')}</span>
                            </div>
                        </div>
                    ))}

                    <div style={{ borderTop: '1px dashed black', margin: '8px 0' }}></div>

                    <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
                            <span>TOTAL</span>
                            <span>${saleDetails.total.toLocaleString('es-CL')}</span>
                        </div>
                        <br />
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Medio Pago:</span>
                            <span>{['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod) ? 'Efectivo' : saleDetails.paymentMethod}</span>
                        </div>
                        {['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod) && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Pagó con:</span>
                                    <span>${Number(saleDetails.paymentDetails?.amount || saleDetails.total).toLocaleString('es-CL')}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Vuelto:</span>
                                    <span>${Number(saleDetails.paymentDetails?.change || 0).toLocaleString('es-CL')}</span>
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px' }}>
                        <div>¡GRACIAS POR SU COMPRA!</div>
                        <div style={{ marginTop: '5px' }}>Vuelva pronto</div>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default SaleSuccessModal;
