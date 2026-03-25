import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { turso } from '../lib/turso';

export async function generateAccountStatementPDF({
    client,
    pendingSales,
    allSales,
    totalDebt,
    creditLimit,
    creditEnabled,
    clientStatus,
    activeCompanyId,
    currentCurrency,
    users
}) {
    // 1. Cargar datos de la empresa
    let company = { business_name: 'Mi Empresa', address: '', tax_id: '', phone: '', email: '' };
    try {
        const res = await turso.execute({
            sql: `SELECT receipt_business_name as business_name, receipt_address as address, receipt_tax_id as tax_id, receipt_phone as phone, receipt_email as email FROM companies WHERE id = ?`,
            args: [activeCompanyId]
        });
        if (res.rows.length > 0) {
            const d = res.rows[0];
            company = { business_name: d.business_name || 'Mi Empresa', address: d.address || '', tax_id: d.tax_id || '', phone: d.phone || '', email: d.email || '' };
        }
    } catch (e) { console.warn('Could not load company info for PDF:', e); }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = 0;

    const PRIMARY = [0, 150, 136];       // teal
    const PRIMARY_LIGHT = [224, 242, 241]; // light teal bg
    const RED = [211, 47, 47];
    const GREEN = [46, 125, 50];
    const ORANGE = [230, 126, 34];
    const BLACK = [33, 33, 33];
    const DARK_GRAY = [66, 66, 66];
    const MED_GRAY = [117, 117, 117];
    const LIGHT_GRAY = [224, 224, 224];
    const BG_GRAY = [245, 245, 245];
    const WHITE = [255, 255, 255];

    // ══════════════ HEADER BAND ══════════════
    doc.setFillColor(...PRIMARY);
    doc.rect(0, 0, pageWidth, 36, 'F');

    // Company name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...WHITE);
    doc.text(company.business_name.toUpperCase(), margin, 14);

    // Company details under name
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255, 180);
    const details = [company.address, company.tax_id ? `RUT: ${company.tax_id}` : '', company.phone, company.email].filter(Boolean);
    if (details.length > 0) doc.text(details.join('  ·  '), margin, 21);

    // Title right side
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...WHITE);
    doc.text('ESTADO DE CUENTA', pageWidth - margin, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }), pageWidth - margin, 21, { align: 'right' });

    y = 44;

    // ══════════════ CLIENT SECTION ══════════════
    doc.setFillColor(...BG_GRAY);
    doc.roundedRect(margin, y, contentWidth, 28, 2, 2, 'F');
    doc.setDrawColor(...LIGHT_GRAY);
    doc.roundedRect(margin, y, contentWidth, 28, 2, 2, 'S');

    // Left column: client info
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text(client.name, margin + 5, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...DARK_GRAY);
    const clientLine1 = [client.rut ? `RUT: ${client.rut}` : null, client.phone ? `Tel: ${client.phone}` : null].filter(Boolean).join('   ·   ');
    if (clientLine1) doc.text(clientLine1, margin + 5, y + 14);
    const clientLine2 = [client.email, client.address].filter(Boolean).join('   ·   ');
    if (clientLine2) doc.text(clientLine2, margin + 5, y + 20);

    // Right: status + debt
    const statusMap = { active: { label: 'ACTIVO', color: GREEN }, credit_blocked: { label: 'CRÉD. BLOQUEADO', color: ORANGE }, blocked: { label: 'BLOQUEADO', color: RED } };
    const st = statusMap[clientStatus] || statusMap.active;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const stW = doc.getTextWidth(st.label) + 8;
    doc.setFillColor(...st.color);
    doc.roundedRect(pageWidth - margin - stW - 3, y + 3, stW, 7, 1.5, 1.5, 'F');
    doc.setTextColor(...WHITE);
    doc.text(st.label, pageWidth - margin - stW / 2 - 3, y + 7.8, { align: 'center' });

    // Debt amount on right
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...(totalDebt > 0 ? RED : GREEN));
    doc.text(`Deuda: ${fmtCurrency(totalDebt, currentCurrency)}`, pageWidth - margin - 5, y + 18, { align: 'right' });

    if (creditLimit > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...MED_GRAY);
        doc.text(`Límite: ${fmtCurrency(creditLimit, currentCurrency)}`, pageWidth - margin - 5, y + 23, { align: 'right' });
    }

    y += 34;

    // ══════════════ SALES TABLE ══════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text('Detalle de Ventas Pendientes', margin, y);
    y += 2;

    if (pendingSales.length > 0) {
        const tableRows = pendingSales.map(sale => {
            const seller = users?.find(u => u.id === sale.user_id);
            const boleta = `B-${String(sale.id).padStart(5, '0')}`;
            const fecha = new Date(sale.date).toLocaleDateString('es-CL');
            const vence = sale.payment_due_date ? new Date(sale.payment_due_date).toLocaleDateString('es-CL') : '-';
            let estado = 'Pendiente';
            if (sale.payment_due_date && new Date(sale.payment_due_date) < new Date()) {
                const days = Math.floor((Date.now() - new Date(sale.payment_due_date).getTime()) / 86400000);
                estado = `Vencido (${days}d)`;
            } else if (sale.payment_due_date) {
                const days = Math.floor((new Date(sale.payment_due_date).getTime() - Date.now()) / 86400000);
                if (days <= 3) estado = `Vence ${days}d`;
            }

            // Build item details
            let items = '';
            try {
                const parsed = Array.isArray(sale.items) ? sale.items : JSON.parse(sale.items || '[]');
                items = parsed.map(i => `${i.name || i.product_name} x${i.quantity}`).join(', ');
            } catch (_) {
                items = sale.summary || '';
            }

            return [boleta, fecha, items || sale.summary || '-', seller?.name || '-', vence, estado, fmtCurrency(parseFloat(sale.total), currentCurrency)];
        });

        autoTable(doc, {
            startY: y,
            head: [['N° Boleta', 'Fecha', 'Productos', 'Vendedor', 'Vence', 'Estado', 'Monto']],
            body: tableRows,
            theme: 'grid',
            styles: {
                fontSize: 7.5,
                cellPadding: 2.5,
                textColor: BLACK,
                lineColor: LIGHT_GRAY,
                lineWidth: 0.3,
                fillColor: WHITE
            },
            headStyles: {
                fillColor: PRIMARY,
                textColor: WHITE,
                fontStyle: 'bold',
                fontSize: 7.5,
                halign: 'center'
            },
            alternateRowStyles: {
                fillColor: [250, 250, 250]
            },
            columnStyles: {
                0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
                1: { cellWidth: 20, halign: 'center' },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 22 },
                4: { cellWidth: 20, halign: 'center' },
                5: { cellWidth: 22, halign: 'center' },
                6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 5) {
                    const val = data.cell.raw || '';
                    if (val.includes('Vencido')) {
                        data.cell.styles.textColor = RED;
                        data.cell.styles.fontStyle = 'bold';
                    } else if (val.includes('Vence')) {
                        data.cell.styles.textColor = ORANGE;
                    }
                }
                if (data.section === 'body' && data.column.index === 6) {
                    data.cell.styles.textColor = RED;
                }
            },
            margin: { left: margin, right: margin }
        });

        y = doc.lastAutoTable.finalY + 2;

        // ── Total bar ──
        doc.setFillColor(...PRIMARY);
        doc.rect(pageWidth - margin - 65, y, 65, 10, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...WHITE);
        doc.text('TOTAL DEUDA:', pageWidth - margin - 61, y + 7);
        doc.text(fmtCurrency(totalDebt, currentCurrency), pageWidth - margin - 3, y + 7, { align: 'right' });

        y += 16;
    } else {
        y += 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...MED_GRAY);
        doc.text('No hay ventas pendientes.', margin, y);
        y += 10;
    }

    // ══════════════ PAYMENT HISTORY ══════════════
    const paidSales = allSales.filter(s => s.payment_method === 'Crédito' && s.status === 'paid');
    if (paidSales.length > 0 && y < 230) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...BLACK);
        doc.text('Historial de Pagos Realizados', margin, y);
        y += 2;

        const histRows = paidSales.slice(0, 20).map(sale => {
            const boleta = `B-${String(sale.id).padStart(5, '0')}`;
            return [
                boleta,
                new Date(sale.date).toLocaleDateString('es-CL'),
                sale.summary || '-',
                'Pagado',
                fmtCurrency(parseFloat(sale.total), currentCurrency)
            ];
        });

        autoTable(doc, {
            startY: y,
            head: [['N° Boleta', 'Fecha', 'Detalle', 'Estado', 'Monto']],
            body: histRows,
            theme: 'grid',
            styles: {
                fontSize: 7,
                cellPadding: 2,
                textColor: DARK_GRAY,
                lineColor: LIGHT_GRAY,
                lineWidth: 0.2,
                fillColor: WHITE
            },
            headStyles: {
                fillColor: [100, 100, 100],
                textColor: WHITE,
                fontStyle: 'bold',
                fontSize: 7
            },
            alternateRowStyles: {
                fillColor: [252, 252, 252]
            },
            columnStyles: {
                0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
                1: { cellWidth: 22, halign: 'center' },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 18, halign: 'center', textColor: GREEN, fontStyle: 'bold' },
                4: { cellWidth: 24, halign: 'right' }
            },
            margin: { left: margin, right: margin }
        });

        y = doc.lastAutoTable.finalY + 6;
    }

    // ══════════════ FOOTER ══════════════
    doc.setDrawColor(...LIGHT_GRAY);
    doc.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...PRIMARY);
    doc.text(company.business_name, margin, pageHeight - 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MED_GRAY);
    doc.text('Documento informativo · No válido como factura', pageWidth - margin, pageHeight - 10, { align: 'right' });

    // Save
    const fileName = `Estado_Cuenta_${client.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
}

function fmtCurrency(amount, currency) {
    if (currency === 'CLP') {
        return '$' + Math.round(amount).toLocaleString('es-CL');
    }
    return '$' + amount.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
