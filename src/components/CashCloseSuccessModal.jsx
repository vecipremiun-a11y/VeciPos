import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X, ExternalLink, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const CashCloseSuccessModal = ({ isOpen, onClose, data, onSendWhatsApp }) => {
    if (!isOpen || !data) return null;

    const {
        registerId,
        user,
        openingTime,
        closingTime,
        openingAmount,
        salesBreakdown,
        movementsIn,
        movementsOut,
        expectedBalance,
        realBalance,
        difference,
        observations
    } = data;

    const generateWhatsAppMessage = () => {
        const dateStr = format(new Date(closingTime), "d 'de' MMMM 'de' yyyy", { locale: es });
        const timeStr = format(new Date(closingTime), 'HH:mm');
        const openTimeStr = format(new Date(openingTime), 'HH:mm');

        return `*ACTA DE CIERRE DE CAJA*
*Fecha:* ${dateStr}
*Hora de cierre:* ${timeStr}

*VENDEDOR:* ${user?.name || 'Usuario'}
*TURNO:* #${registerId}
*Apertura:* ${openTimeStr}
*Monto apertura:* $${openingAmount.toLocaleString('es-CL')}

*RESUMEN DEL TURNO:*
*Ventas en efectivo:* $${salesBreakdown?.cash?.toLocaleString('es-CL') || 0}
*Ventas tarjetas:* $${salesBreakdown?.card?.toLocaleString('es-CL') || 0}
*Ventas transfer:* $${salesBreakdown?.transfer?.toLocaleString('es-CL') || 0}
*Total Ventas:* $${salesBreakdown?.total?.toLocaleString('es-CL') || 0}

*Ingresos adicionales:* $${movementsIn.toLocaleString('es-CL')}
*Retiros:* $${movementsOut.toLocaleString('es-CL')}

*SALDOS:*
*Saldo esperado:* $${expectedBalance.toLocaleString('es-CL')}
*Saldo real contado:* $${realBalance.toLocaleString('es-CL')}
*Diferencia:* $${difference.toLocaleString('es-CL')} (${difference >= 0 ? 'Sobra' : 'Falta'})

*Observaciones:* ${observations || 'Sin observaciones'}

*Sistema POS-VECI*`;
    };

    const handleWhatsAppClick = () => {
        const message = generateWhatsAppMessage();
        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className="glass-card w-full max-w-md relative animate-[float_0.3s_ease-out] p-0 overflow-hidden flex flex-col !bg-[#0f0f2d]/95">

                {/* Header with Check */}
                <div className="p-8 pb-4 flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(34,197,94,0.3)]">
                        <CheckCircle size={40} className="text-green-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-green-500 mb-1">¡Caja Cerrada Exitosamente!</h2>
                    <p className="text-gray-400 text-sm">Turno #{registerId} cerrado correctamente</p>
                </div>

                {/* Summary Card */}
                <div className="px-6 py-2">
                    <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">Saldo esperado:</span>
                            <span className="font-bold text-white">${expectedBalance.toLocaleString('es-CL')}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm border-t border-white/5 pt-2">
                            <span className="text-gray-400">Saldo real:</span>
                            <span className="font-bold text-[var(--color-primary)] text-lg">${realBalance.toLocaleString('es-CL')}</span>
                        </div>
                    </div>
                </div>

                <div className="p-6 pt-2 text-center text-sm text-gray-500">
                    <p className="mb-4">Enviar Acta de Cierre</p>

                    <button
                        onClick={handleWhatsAppClick}
                        className="w-full py-4 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black font-bold flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] shadow-lg mb-3"
                    >
                        <MessageCircle size={20} />
                        Enviar por WhatsApp
                    </button>

                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 font-medium transition-colors"
                    >
                        Cerrar y Salir
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default CashCloseSuccessModal;
