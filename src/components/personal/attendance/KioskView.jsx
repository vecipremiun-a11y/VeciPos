import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { Clock, UserCheck, AlertTriangle, CheckCircle, Receipt } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import AttendanceReceipt from './AttendanceReceipt';

const KioskView = () => {
    const { getLaborProfileByPin, markAttendance, activeCompanyId, availableCompanies } = useStore();
    const [pin, setPin] = useState('');
    const [status, setStatus] = useState('idle'); // idle, processing, success, error
    const [message, setMessage] = useState('');
    const [userData, setUserData] = useState(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    // Comprobante de la última marca: folio + hash con que el trabajador se queda.
    const [receipt, setReceipt] = useState(null);
    const [showReceipt, setShowReceipt] = useState(false);

    const companyName = (availableCompanies || []).find(c => c.id === activeCompanyId)?.name || '';

    // Clock
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const handleNumberClick = (num) => {
        if (pin.length < 6) {
            setPin(prev => prev + num);
        }
    };

    // El comprobante se conserva al limpiar la pantalla: el trabajador puede
    // haberse ido y volver a pedirlo antes de que marque el siguiente.
    const handleClear = () => {
        setPin('');
        setStatus('idle');
        setMessage('');
    };

    const handleBackspace = () => {
        setPin(prev => prev.slice(0, -1));
    };

    const handleSubmit = async () => {
        if (!pin) return;
        setStatus('processing');
        setMessage('Verificando PIN...');

        try {
            // 1. Verify PIN
            const user = await getLaborProfileByPin(pin, activeCompanyId);

            if (!user) {
                setStatus('error');
                setMessage('PIN no reconocido');
                setTimeout(handleClear, 3000);
                return;
            }

            // 2. Marcar. El servidor decide si toca entrada o salida ('auto')
            // mirando la última marca vigente del día.
            const result = await markAttendance(user.id, 'auto', 'Kiosco', user.labor_branch || 'Principal');

            if (result.success) {
                setStatus('success');
                setUserData(user);
                setReceipt(result.receipt || null);
                // El servidor devuelve 'entry'/'exit'. Antes se comparaba contra
                // 'check_in', que nunca era cierto: toda marca decía SALIDA.
                setMessage(result.type === 'entry' ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA');

                setTimeout(() => {
                    handleClear();
                    setUserData(null);
                }, 8000);
            } else {
                setStatus('error');
                setMessage(result.error);
                setTimeout(handleClear, 4000);
            }

        } catch (error) {
            console.error("Kiosk Error:", error);
            setStatus('error');
            setMessage('Error de conexión');
            setTimeout(handleClear, 3000);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[600px] p-6 max-w-lg mx-auto">
            {/* Clock & Header */}
            <div className="text-center mb-8">
                <h1 className="text-4xl font-bold text-[var(--color-primary)] mb-2">
                    {format(currentTime, 'HH:mm:ss')}
                </h1>
                <p className="text-[var(--color-text-muted)] capitalize text-lg">
                    {format(currentTime, "EEEE, d 'de' MMMM", { locale: es })}
                </p>
            </div>

            {/* Display / Input */}
            <div className={cn(
                "w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 mb-6 text-center transition-all",
                status === 'success' && "bg-green-500/10 border-green-500/30",
                status === 'error' && "bg-red-500/10 border-red-500/30"
            )}>
                {status === 'success' ? (
                    <div className="flex flex-col items-center gap-3 animate-in zoom-in spin-in-1">
                        <CheckCircle size={48} className="text-green-500" />
                        <div>
                            <p className="text-green-400 font-bold text-xl">{message}</p>
                            <p className="text-[var(--color-text)] text-lg">{userData?.name}</p>
                            <p className="text-sm text-[var(--color-text-muted)]">
                                {receipt?.recordedAt ? format(new Date(receipt.recordedAt), 'HH:mm:ss') : format(new Date(), 'HH:mm')}
                            </p>
                            {receipt?.folio != null && (
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                    Folio N° {String(receipt.folio).padStart(6, '0')}
                                </p>
                            )}
                        </div>
                        {receipt && (
                            <button
                                onClick={() => setShowReceipt(true)}
                                className="btn-secondary flex items-center gap-2 text-sm"
                            >
                                <Receipt size={16} />
                                Ver / imprimir comprobante
                            </button>
                        )}
                    </div>
                ) : status === 'error' ? (
                    <div className="flex flex-col items-center gap-2 animate-in shake">
                        <AlertTriangle size={32} className="text-red-400" />
                        <p className="text-red-400 font-medium text-lg">{message}</p>
                    </div>
                ) : (
                    <div className="flex justify-center gap-2">
                        {/* PIN dots */}
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "w-4 h-4 rounded-full transition-all",
                                    i < pin.length ? "bg-[var(--color-primary)] scale-110" : "bg-[var(--glass-border)]"
                                )}
                            />
                        ))}
                        {pin.length === 0 && <span className="text-[var(--color-text-muted)] animate-pulse">Ingrese su PIN</span>}
                    </div>
                )}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-4 w-full max-w-xs mb-6">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button
                        key={num}
                        onClick={() => handleNumberClick(num.toString())}
                        disabled={status === 'processing' || status === 'success'}
                        className="h-16 rounded-xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-2xl font-medium text-[var(--color-text)] transition-colors active:scale-95 disabled:opacity-50"
                    >
                        {num}
                    </button>
                ))}
                <button
                    onClick={handleClear}
                    disabled={status === 'processing' || status === 'success'}
                    className="h-16 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium transition-colors active:scale-95 disabled:opacity-50"
                >
                    C
                </button>
                <button
                    onClick={() => handleNumberClick('0')}
                    disabled={status === 'processing' || status === 'success'}
                    className="h-16 rounded-xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-2xl font-medium text-[var(--color-text)] transition-colors active:scale-95 disabled:opacity-50"
                >
                    0
                </button>
                <button
                    onClick={handleBackspace}
                    disabled={status === 'processing' || status === 'success'}
                    className="h-16 rounded-xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] transition-colors active:scale-95 flex items-center justify-center disabled:opacity-50"
                >
                    ←
                </button>
            </div>

            {/* Action Button */}
            <button
                onClick={handleSubmit}
                disabled={pin.length < 4 || status === 'processing' || status === 'success'}
                className={cn(
                    "w-full max-w-xs py-4 rounded-xl font-bold text-lg transition-all",
                    pin.length >= 4
                        ? "btn-primary shadow-[0_0_20px_rgba(0,240,255,0.3)] hover:shadow-[0_0_30px_rgba(0,240,255,0.5)]"
                        : "bg-[var(--glass-border)] text-[var(--color-text-muted)] cursor-not-allowed"
                )}
            >
                {status === 'processing' ? 'Procesando...' : 'MARCAR ASISTENCIA'}
            </button>

            {showReceipt && receipt && (
                <AttendanceReceipt
                    receipt={receipt}
                    companyName={companyName}
                    onClose={() => setShowReceipt(false)}
                />
            )}
        </div>
    );
};

export default KioskView;
