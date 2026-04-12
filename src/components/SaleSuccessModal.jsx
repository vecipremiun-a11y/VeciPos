import React, { useState, useEffect, useRef } from 'react';
import { X, Printer, ShoppingCart, FileText, Send, Receipt, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import html2canvas from 'html2canvas';
import bwipjs from 'bwip-js';

import { turso } from '../lib/turso';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatCurrency';

// Extraer TED XML del DTE firmado
function extractTED(xmlFirmado) {
    if (!xmlFirmado) return null;
    const match = xmlFirmado.match(/<TED[\s\S]*?<\/TED>/);
    return match ? match[0] : null;
}

// Generar imagen PDF417 del timbre
async function generateTimbreImage(tedXml) {
    if (!tedXml) return null;
    try {
        const canvas = document.createElement('canvas');
        bwipjs.toCanvas(canvas, {
            bcid: 'pdf417',
            text: tedXml,
            scale: 2,
            columns: 7,
            rowmult: 2,
            eclevel: 5,
        });
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error('Error generating PDF417 timbre:', e);
        return null;
    }
}

const SaleSuccessModal = ({ isOpen, onClose, saleDetails, onNewSale, seller }) => {
    const { activeCompanyId, currentCurrency } = useStore();
    const [phoneNumber, setPhoneNumber] = useState('');
    const receiptRef = useRef(null);
    const [receiptConfig, setReceiptConfig] = useState({
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
    });

    const [dteInfo, setDteInfo] = useState(null);
    const [timbreImg, setTimbreImg] = useState(null);

    // Polling para obtener info del DTE emitido
    useEffect(() => {
        if (!isOpen || !activeCompanyId || !saleDetails?.tipoDte) {
            setDteInfo(null);
            setTimbreImg(null);
            return;
        }
        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 10;

        const poll = async () => {
            try {
                const result = await turso.execute({
                    sql: `SELECT folio, tipo_dte AS tipo, estado AS status, track_id, xml_firmado FROM sii_dtes 
                          WHERE company_id = ? AND tipo_dte = ?
                          ORDER BY created_at DESC LIMIT 1`,
                    args: [activeCompanyId, saleDetails.tipoDte]
                });
                if (!cancelled && result.rows.length > 0) {
                    const row = result.rows[0];
                    setDteInfo(row);
                    // Generar timbre PDF417
                    const ted = extractTED(row.xml_firmado);
                    if (ted) {
                        const img = await generateTimbreImage(ted);
                        if (!cancelled) setTimbreImg(img);
                    }
                    return; // Stop polling
                }
            } catch (e) {
                // ignore
            }
            attempts++;
            if (!cancelled && attempts < maxAttempts) {
                setTimeout(poll, 2000);
            }
        };

        const timer = setTimeout(poll, 3000);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [isOpen, activeCompanyId, saleDetails?.tipoDte]);

    // Cargar configuración de boletas cuando se abre el modal
    useEffect(() => {
        const loadReceiptConfig = async () => {
            if (!isOpen || !activeCompanyId) return;

            try {
                const result = await turso.execute({
                    sql: `SELECT 
                            receipt_business_name as business_name,
                            receipt_address as address,
                            receipt_tax_id as tax_id,
                            receipt_phone as phone,
                            receipt_email as email,
                            receipt_header_message as header_message,
                            receipt_footer_message as footer_message,
                            receipt_show_tax_id as show_tax_id,
                            receipt_show_phone as show_phone,
                            receipt_show_email as show_email,
                            receipt_format as format
                          FROM companies WHERE id = ?`,
                    args: [activeCompanyId]
                });

                if (result.rows.length > 0) {
                    const data = result.rows[0];
                    setReceiptConfig({
                        business_name: data.business_name || 'VECI',
                        address: data.address || 'Sotomayor 1460-A',
                        tax_id: data.tax_id,
                        phone: data.phone,
                        email: data.email,
                        header_message: data.header_message,
                        footer_message: data.footer_message || '¡GRACIAS POR SU COMPRA!\nVuelva pronto',
                        show_tax_id: data.show_tax_id === 1,
                        show_phone: data.show_phone === 1,
                        show_email: data.show_email === 1,
                        format: data.format || '58mm'
                    });
                }
            } catch (e) {
                console.error('Error loading receipt config:', e);
            }
        };

        loadReceiptConfig();
    }, [isOpen, activeCompanyId]);

    if (!isOpen || !saleDetails) return null;

    const generatePDF = () => {
        const fmt = receiptConfig.format || '58mm';
        const pdfWidth = fmt === 'a4' ? 210 : (fmt === '80mm' ? 80 : 58);
        const pdfFormat = fmt === 'a4' ? 'a4' : [pdfWidth, 200];
        const centerX = pdfWidth / 2;
        const maxTextWidth = pdfWidth - 4;

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: pdfFormat
        });

        doc.setFont('courier', 'bold');
        doc.setFontSize(fmt === 'a4' ? 14 : 10);

        let yPos = fmt === 'a4' ? 20 : 10;

        // Header - Nombre del Negocio
        doc.text(receiptConfig.business_name, centerX, yPos, { align: 'center' });
        yPos += 5;

        // Dirección
        doc.setFont('courier', 'normal');
        doc.setFontSize(fmt === 'a4' ? 10 : 8);
        doc.text(receiptConfig.address, centerX, yPos, { align: 'center' });
        yPos += 4;

        // RUT/NIT (si está configurado y habilitado)
        if (receiptConfig.show_tax_id && receiptConfig.tax_id) {
            doc.text(`RUT: ${receiptConfig.tax_id}`, centerX, yPos, { align: 'center' });
            yPos += 4;
        }

        // Teléfono
        if (receiptConfig.show_phone && receiptConfig.phone) {
            doc.text(`Tel: ${receiptConfig.phone}`, centerX, yPos, { align: 'center' });
            yPos += 4;
        }

        // Email
        if (receiptConfig.show_email && receiptConfig.email) {
            doc.text(receiptConfig.email, centerX, yPos, { align: 'center' });
            yPos += 4;
        }

        // Mensaje cabecera
        if (receiptConfig.header_message) {
            yPos += 2;
            const headerLines = doc.splitTextToSize(receiptConfig.header_message, maxTextWidth);
            headerLines.forEach(line => {
                doc.text(line, centerX, yPos, { align: 'center' });
                yPos += 3;
            });
        }

        yPos += 2;

        const sellerName = seller?.name || 'Vendedor';
        const date = new Date().toLocaleString('es-CL');
        const ticketId = `T-${Date.now().toString().slice(-6)}`;

        const dteLabel = saleDetails.tipoDte === 33 ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA';

        doc.setFontSize(fmt === 'a4' ? 9 : 7);
        if (dteInfo?.folio) {
            doc.text(`${dteLabel}`, centerX, yPos, { align: 'center' });
            yPos += 4;
            doc.text(`Folio: ${dteInfo.folio}`, centerX, yPos, { align: 'center' });
            yPos += 4;
        } else {
            doc.text(`Boleta: ${ticketId}`, 2, yPos);
            yPos += 4;
        }
        doc.text(`Fecha: ${date}`, 2, yPos);
        yPos += 4;
        doc.text(`Vend: ${sellerName}`, 2, yPos);
        yPos += 4;

        const separator = fmt === 'a4' ? '─'.repeat(80) : '--------------------------------';
        const rightX = pdfWidth - 2;

        doc.text(separator, 2, yPos);
        yPos += 5;

        // Items
        doc.setFont('courier', 'bold');
        doc.text('DESCRIPCIÓN', 2, yPos);
        doc.text('TOTAL', rightX, yPos, { align: 'right' });
        yPos += 4;
        doc.setFont('courier', 'normal');
        doc.text(separator, 2, yPos);
        yPos += 4;

        saleDetails.items.forEach(item => {
            const splitName = doc.splitTextToSize(item.name, maxTextWidth);
            doc.text(splitName, 2, yPos);
            yPos += splitName.length * 3;

            doc.text(`${item.quantity} x ${formatCurrency(item.price, currentCurrency)}`, 2, yPos);
            doc.text(`${formatCurrency(item.price * item.quantity, currentCurrency)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
        });

        doc.text(separator, 2, yPos);
        yPos += 5;

        // Totals
        const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
        const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;
        const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
        const change = saleDetails.paymentDetails?.change || 0;

        doc.setFont('courier', 'bold');
        doc.setFontSize(fmt === 'a4' ? 14 : 10);
        doc.text('TOTAL', 2, yPos);
        doc.text(`${formatCurrency(saleDetails.total, currentCurrency)}`, rightX, yPos, { align: 'right' });
        yPos += 6;

        doc.setFont('courier', 'normal');
        doc.setFontSize(fmt === 'a4' ? 10 : 8);
        doc.text('Medio Pago:', 2, yPos);
        doc.text(paymentLabel, rightX, yPos, { align: 'right' });
        yPos += 5;

        if (isCash) {
            doc.text('Pagó con:', 2, yPos);
            doc.text(`${formatCurrency(Number(amountPaid), currentCurrency)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
            doc.text('Vuelto:', 2, yPos);
            doc.text(`${formatCurrency(Number(change), currentCurrency)}`, rightX, yPos, { align: 'right' });
            yPos += 5;
        }

        // Footer personalizado
        yPos += 10;
        doc.setFontSize(fmt === 'a4' ? 10 : 8);
        const footerLines = receiptConfig.footer_message.split('\n');
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
            doc.text('Res. Ex. SII - Documento tributario electrónico', centerX, yPos, { align: 'center' });
            yPos += 4;
        }

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

        const formatMoney = (amount) => formatCurrency(amount, currentCurrency);

        let receiptText = `*COMPROBANTE ${receiptConfig.business_name}*\n`;
        receiptText += `${receiptConfig.address}\n`;

        if (receiptConfig.show_tax_id && receiptConfig.tax_id) {
            receiptText += `RUT: ${receiptConfig.tax_id}\n`;
        }
        if (receiptConfig.show_phone && receiptConfig.phone) {
            receiptText += `Tel: ${receiptConfig.phone}\n`;
        }
        if (receiptConfig.show_email && receiptConfig.email) {
            receiptText += `${receiptConfig.email}\n`;
        }

        if (receiptConfig.header_message) {
            receiptText += `\n_${receiptConfig.header_message}_\n`;
        }

        receiptText += `\n`;
        if (dteInfo?.folio) {
            const dteLabel = saleDetails.tipoDte === 33 ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA';
            receiptText += `*${dteLabel}*\n`;
            receiptText += `Folio: ${dteInfo.folio}\n`;
        } else {
            receiptText += `Boleta: ${ticketId}\n`;
        }
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

        receiptText += `\n${receiptConfig.footer_message.replace('\n', ' ')}`;

        const encodedMessage = encodeURIComponent(receiptText);
        window.open(`https://wa.me/${fullNumber}?text=${encodedMessage}`, '_blank');
    };
    const handlePrint = () => {
        const printWindow = window.open('', '', 'width=400,height=700');
        const sellerName = seller?.name || 'Vendedor';
        const date = new Date().toLocaleString('es-CL');
        const ticketId = `T-${Date.now().toString().slice(-6)}`;

        const amountPaid = saleDetails.paymentDetails?.amount || saleDetails.total;
        const change = saleDetails.paymentDetails?.change || 0;

        // Check for various casing of 'cash' or 'efectivo'
        const isCash = ['cash', 'efectivo', 'Efectivo'].includes(saleDetails.paymentMethod);
        const paymentLabel = isCash ? 'Efectivo' : saleDetails.paymentMethod;

        const fmt = receiptConfig.format || '58mm';
        const isA4 = fmt === 'a4';
        const is80 = fmt === '80mm';
        const pageSize = isA4 ? 'A4' : `${fmt} auto`;
        const pageMargin = isA4 ? '15mm' : '0';
        const bodyWidth = isA4 ? '190mm' : fmt;
        const bodyFont = isA4 ? '14px' : '12px';
        const headerFontSize = isA4 ? '24px' : (is80 ? '20px' : '18px');
        const addrFontSize = isA4 ? '13px' : '11px';
        const metaFontSize = isA4 ? '12px' : '10px';
        const descFontSize = isA4 ? '12px' : '10px';
        const itemFontSize = isA4 ? '13px' : '12px';
        const totalFontSize = isA4 ? '18px' : '14px';
        const footerFontSize = isA4 ? '13px' : '11px';

        printWindow.document.write(`
            <html>
                <head>
                    <title>Ticket de Venta</title>
                    <style>
                        @page { size: ${pageSize}; margin: ${pageMargin}; }
                        body { 
                            font-family: 'Courier New', monospace; 
                            width: ${bodyWidth}; 
                            ${isA4 ? 'max-width: 190mm; margin: 0 auto; padding: 10mm;' : 'margin: 0; padding: 5px;'}
                            font-size: ${bodyFont};
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
                        .footer { margin-top: 20px; font-size: ${footerFontSize}; }
                    </style>
                </head>
                <body>
                    <div class="header text-center">
                        <h1 style="margin: 0; font-size: ${headerFontSize}; font-weight: bold;">${receiptConfig.business_name}</h1>
                        <p style="margin: 5px 0; font-size: ${addrFontSize};">${receiptConfig.address}</p>
                        ${receiptConfig.show_tax_id && receiptConfig.tax_id ? `<p style="margin: 2px 0; font-size: ${metaFontSize};">RUT: ${receiptConfig.tax_id}</p>` : ''}
                        ${receiptConfig.show_phone && receiptConfig.phone ? `<p style="margin: 2px 0; font-size: ${metaFontSize};">Tel: ${receiptConfig.phone}</p>` : ''}
                        ${receiptConfig.show_email && receiptConfig.email ? `<p style="margin: 2px 0; font-size: ${metaFontSize};">${receiptConfig.email}</p>` : ''}
                        ${receiptConfig.header_message ? `<p style="margin: 10px 0; font-size: ${metaFontSize}; font-style: italic;">${receiptConfig.header_message}</p>` : ''}
                        <br/>
                        <div style="font-size: ${metaFontSize}; text-align: left;">
                            ${dteInfo?.folio 
                                ? `<div style="text-align: center; font-weight: bold; font-size: ${addrFontSize};">${saleDetails.tipoDte === 33 ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA'}</div>
                                   <div style="text-align: center;">Folio: ${dteInfo.folio}</div>`
                                : `<div>Boleta: ${ticketId}</div>`
                            }
                            <div>Fecha: ${date}</div>
                            <div>Vend: ${sellerName}</div> 
                        </div>
                    </div>

                    <div class="separator"></div>

                    <div style="font-size: ${descFontSize}; font-weight: bold; display: flex; justify-content: space-between;">
                        <span>DESCRIPCIÓN</span>
                        <span> TOTAL</span>
                    </div>
                    <div class="separator"></div>

                    ${saleDetails.items.map(item => `
                        <div class="item" style="font-size: ${itemFontSize};">
                            <div class="item-name">${item.name}</div>
                            <div class="item-details">
                                <span>${item.quantity} x ${formatCurrency(item.price, currentCurrency)}</span>
                                <span>${formatCurrency(item.price * item.quantity, currentCurrency)}</span>
                            </div>
                        </div>
                    `).join('')}
                    
                    <div class="separator"></div>
                    
                    <div class="totals">
                        <div style="display: flex; justify-content: space-between; font-size: ${totalFontSize};" class="bold">
                            <span>TOTAL</span>
                            <span>${formatCurrency(saleDetails.total, currentCurrency)}</span>
                        </div>
                        <br/>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Medio Pago:</span>
                            <span>${paymentLabel}</span>
                        </div>
                         ${isCash ? `
                            <div style="display: flex; justify-content: space-between;">
                                <span>Pagó con:</span>
                                <span>${formatCurrency(Number(amountPaid), currentCurrency)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Vuelto:</span>
                                <span>${formatCurrency(Number(change), currentCurrency)}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="footer text-center">
                        <div style="margin-top: 20px; text-align: center;">
                            ${receiptConfig.footer_message.split('\n').map(line => `<div style="margin: 3px 0;">${line}</div>`).join('')}
                        </div>
                    </div>
                    ${timbreImg ? `
                    <div style="text-align:center; margin-top:15px; padding-top:10px; border-top:1px dashed #ccc;">
                        <div style="font-size:8px; font-weight:bold; margin-bottom:5px;">Timbre Electrónico SII</div>
                        <img src="${timbreImg}" style="width:100%; max-width:${isA4 ? '300px' : '220px'};" />
                        <div style="font-size:7px; margin-top:3px;">Res. Ex. SII - Documento tributario electrónico</div>
                    </div>
                    ` : ''}
                </body>
            </html>
        `);
        printWindow.document.close();

        const doPrint = () => {
            printWindow.focus();
            printWindow.print();
            printWindow.close();
        };

        // Esperar a que la imagen del timbre cargue antes de imprimir
        if (timbreImg) {
            const img = printWindow.document.querySelector('img[src^="data:image"]');
            if (img && !img.complete) {
                img.onload = doPrint;
                img.onerror = doPrint; // imprimir igual si falla la imagen
                return;
            }
        }
        doPrint();
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

                {/* DTE Badge */}
                {saleDetails.tipoDte && (
                    <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold mb-3 ${
                        saleDetails.tipoDte === 33
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}>
                        {saleDetails.tipoDte === 33 ? <FileText size={16} /> : <Receipt size={16} />}
                        {saleDetails.tipoDte === 33 ? 'Factura Electrónica' : 'Boleta Electrónica'}
                        {dteInfo ? (
                            <span className="flex items-center gap-1 ml-1">
                                {dteInfo.status === 'accepted' ? (
                                    <CheckCircle2 size={14} className="text-green-400" />
                                ) : dteInfo.status === 'rejected' ? (
                                    <AlertTriangle size={14} className="text-red-400" />
                                ) : (
                                    <Clock size={14} className="text-yellow-400" />
                                )}
                                N° {dteInfo.folio}
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 ml-1">
                                <Clock size={14} className="text-yellow-400 animate-pulse" />
                                Emitiendo...
                            </span>
                        )}
                    </div>
                )}

                <p className="text-4xl font-bold text-[var(--color-primary)] mb-8">
                    {formatCurrency(saleDetails.total, currentCurrency)}
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
                        disabled={saleDetails?.tipoDte && !timbreImg}
                        className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-xs text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Printer size={20} />
                        {saleDetails?.tipoDte && !timbreImg ? 'Esperando timbre...' : 'Imprimir'}
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
                        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>{receiptConfig.business_name}</h2>
                        <div style={{ fontSize: '10px' }}>{receiptConfig.address}</div>
                        {receiptConfig.show_tax_id && receiptConfig.tax_id && (
                            <div style={{ fontSize: '10px' }}>RUT: {receiptConfig.tax_id}</div>
                        )}
                        {receiptConfig.show_phone && receiptConfig.phone && (
                            <div style={{ fontSize: '10px' }}>Tel: {receiptConfig.phone}</div>
                        )}
                        {receiptConfig.show_email && receiptConfig.email && (
                            <div style={{ fontSize: '10px' }}>{receiptConfig.email}</div>
                        )}
                        {receiptConfig.header_message && (
                            <div style={{ fontSize: '10px', marginTop: '8px', fontStyle: 'italic' }}>{receiptConfig.header_message}</div>
                        )}
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
                                <span>{item.quantity} x {formatCurrency(item.price, currentCurrency)}</span>
                                <span>{formatCurrency(item.price * item.quantity, currentCurrency)}</span>
                            </div>
                        </div>
                    ))}

                    <div style={{ borderTop: '1px dashed black', margin: '8px 0' }}></div>

                    <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
                            <span>TOTAL</span>
                            <span>{formatCurrency(saleDetails.total, currentCurrency)}</span>
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
                                    <span>{formatCurrency(Number(saleDetails.paymentDetails?.amount || saleDetails.total), currentCurrency)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Vuelto:</span>
                                    <span>{formatCurrency(Number(saleDetails.paymentDetails?.change || 0), currentCurrency)}</span>
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px' }}>
                        {receiptConfig.footer_message.split('\n').map((line, i) => (
                            <div key={i} style={{ marginTop: i > 0 ? '5px' : 0 }}>{line}</div>
                        ))}
                    </div>
                </div>
            </div>
        </div >
    );
};

export default SaleSuccessModal;
