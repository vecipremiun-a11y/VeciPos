import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, CheckCircle2 } from 'lucide-react';
import bwipjs from 'bwip-js';
import { formatCurrency } from '../utils/formatCurrency';
import { printPreventa } from '../utils/printPreventa';
import { useStore } from '../store/useStore';

const PreventaSuccessModal = ({ isOpen, onClose, preventaData }) => {
    const barcodeRef = useRef(null);
    const { currentUser } = useStore();

    useEffect(() => {
        if (!isOpen || !preventaData?.code || !barcodeRef.current) return;
        try {
            bwipjs.toCanvas(barcodeRef.current, {
                bcid: 'code128',
                text: preventaData.code,
                scale: 3,
                height: 14,
                includetext: true,
                textxalign: 'center',
                textsize: 10,
            });
        } catch (e) {
            console.error('Barcode render error:', e);
        }
    }, [isOpen, preventaData?.code]);

    if (!isOpen || !preventaData) return null;

    const { code, items, total, companyName, companyPhone, companyAddress, headerMessage, footerMessage, format } = preventaData;
    const vendedorName = currentUser?.name || currentUser?.username || 'Vendedor';

    const handlePrint = () => {
        printPreventa(code, items, total, vendedorName, {
            name: companyName,
            phone: companyPhone || '',
            address: companyAddress || '',
            headerMessage: headerMessage || '',
            footerMessage: footerMessage || ''
        }, format || '80mm');
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative glass-card rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-[var(--glass-border)] animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-green-400">
                        <CheckCircle2 size={24} />
                        <h2 className="text-lg font-bold">Preventa Creada</h2>
                    </div>
                    <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <X size={20} />
                    </button>
                </div>

                {/* Barcode */}
                <div className="flex flex-col items-center bg-white rounded-xl p-4 mb-4">
                    <canvas ref={barcodeRef} />
                    <p className="text-black font-mono font-bold text-lg mt-2 tracking-widest">{code}</p>
                </div>

                {/* Items summary */}
                <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                    {items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm text-[var(--color-text-muted)]">
                            <span className="truncate mr-2">{item.quantity}x {item.name}</span>
                            <span className="whitespace-nowrap">{formatCurrency(item.price * item.quantity)}</span>
                        </div>
                    ))}
                </div>

                {/* Total */}
                <div className="flex justify-between items-center text-xl font-bold text-[var(--color-text)] border-t border-[var(--glass-border)] pt-3 mb-4">
                    <span>Total</span>
                    <span className="neon-text">{formatCurrency(total)}</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                    <button
                        onClick={handlePrint}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
                    >
                        <Printer size={18} />
                        Imprimir Ticket
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] text-[var(--color-text)] font-bold py-3 rounded-xl border border-[var(--glass-border)] transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default PreventaSuccessModal;
