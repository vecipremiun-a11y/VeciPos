import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudOff, Cloud, Wifi, X, Loader2 } from 'lucide-react';
import { esOfflineManual, ponerOfflineManual, alCambiarConexion, hayConexion } from '../lib/conectividad';
import { useStore } from '../store/useStore';
import { pendingOpsApi } from '../lib/db/localdb';

/**
 * Interruptor para trabajar sin conexión a propósito.
 *
 * Por qué existe: el monitor automático comprueba si el servidor contesta con
 * un `SELECT 1`, que es una LECTURA. El 3-sep-2026 la base servía lecturas en
 * 140 ms con las ESCRITURAS colgadas — el sistema se creía online, y cada venta
 * esperaba los 12 segundos del corte antes de guardarse. Con gente esperando en
 * la caja, eso es media hora perdida en una tarde.
 *
 * Ninguna comprobación automática va a anticipar todos los casos raros. Este
 * botón le da la decisión a quien está mirando la caja: si las ventas se traban,
 * lo aprieta y trabaja offline al instante, sin esperar a que el sistema se dé
 * cuenta solo.
 *
 * Prendido, las ventas se guardan en el equipo y se envían cuando se apague.
 * No se pierde ninguna.
 */
const BotonModoOffline = () => {
    const [manual, setManual] = useState(esOfflineManual);
    const [online, setOnline] = useState(hayConexion);
    const [confirmando, setConfirmando] = useState(false);
    const [porSubir, setPorSubir] = useState(0);
    const [comprobando, setComprobando] = useState(false);
    // Se intentó volver a online y el servidor no contestó.
    const [noVolvio, setNoVolvio] = useState(false);
    const activeCompanyId = useStore((s) => s.activeCompanyId);

    useEffect(() => alCambiarConexion(setOnline), []);

    const alternar = async () => {
        // Prender no necesita confirmación: guardar en el equipo siempre es
        // seguro. Volver a online sí, porque si la base sigue mal las ventas
        // vuelven a trabarse — y ahí conviene saber cuántas hay esperando.
        if (manual) {
            let cuantas = 0;
            try {
                const todas = await pendingOpsApi.list(activeCompanyId);
                cuantas = todas.filter((o) => o.status !== 'synced').length;
            } catch { /* Dexie no disponible */ }
            setPorSubir(cuantas);
            setNoVolvio(false);
            setConfirmando(true);
            return;
        }
        await ponerOfflineManual(true);
        setManual(true);
    };

    // Se espera la comprobación real antes de decir nada.
    //
    // Si no hay internet, el sistema queda offline igual —ninguna venta corre
    // riesgo— pero hay que DECIRLO: poner el botón en gris sin avisar deja al
    // cajero creyendo que está conectado cuando no lo está.
    const volverOnline = async () => {
        setComprobando(true);
        setNoVolvio(false);
        const volvio = await ponerOfflineManual(false);
        setManual(false);
        setComprobando(false);
        if (volvio) setConfirmando(false);
        else setNoVolvio(true);
    };

    return (
        <>
            <button
                onClick={alternar}
                title={manual
                    ? 'Estás trabajando sin conexión a propósito. Tocá para volver a conectarte.'
                    : 'Trabajar sin conexión: las ventas se guardan en este equipo y se envían después. Útil si las ventas se están demorando.'}
                className={[
                    // Píldora, para que combine con el selector de empresa y la
                    // campana que tiene al lado en la barra de arriba.
                    'shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full border text-sm font-bold transition-all active:scale-95',
                    // Tres estados, y la diferencia importa:
                    //   ÁMBAR SÓLIDO → lo puso el cajero. Nada lo saca salvo él.
                    //   ÁMBAR TENUE  → se cayó solo. Vuelve solo cuando vuelva.
                    //   GRIS         → todo bien, y el botón está para usarse.
                    // Antes el segundo caso se veía igual que el tercero: parecía
                    // que había conexión cuando no la había.
                    manual
                        ? 'bg-amber-500 border-amber-400 text-black hover:bg-amber-400'
                        : !online
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25'
                            : 'bg-white/5 border-white/10 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text)]',
                ].join(' ')}
            >
                {manual || !online ? <CloudOff size={16} /> : <Cloud size={16} />}
                {/* En pantallas chicas queda solo el ícono: la barra de arriba ya va
                    justa de espacio con la empresa, la campana y el usuario. */}
                <span className="hidden lg:inline">
                    {manual ? 'Sin conexión' : !online ? 'Sin internet' : 'Modo offline'}
                </span>
                {/* Cuando el corte lo decidió el sistema (no el cajero), se avisa para
                    que no crea que el botón está fallando. */}
                {!manual && !online && (
                    <span className="hidden xl:inline font-medium opacity-70">(se cayó solo)</span>
                )}
            </button>

            {confirmando && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
                    <div className="glass-card modal-solido w-full max-w-sm relative p-5">
                        <button
                            onClick={() => setConfirmando(false)}
                            className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                            aria-label="Cerrar"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
                                <Wifi size={20} />
                            </div>
                            <h2 className="text-base font-bold text-[var(--color-text)]">
                                Volver a trabajar con conexión
                            </h2>
                        </div>

                        {porSubir > 0 ? (
                            <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                                    <Loader2 size={14} className="animate-spin" />
                                    {porSubir} venta{porSubir === 1 ? '' : 's'} lista{porSubir === 1 ? '' : 's'} para subir
                                </div>
                                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                    Se envían solas apenas se confirme la conexión. No hace falta
                                    hacer nada más.
                                </p>
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
                                No queda ninguna venta guardada en este equipo.
                            </p>
                        )}

                        {/* Resultado de la comprobación: no hubo internet.
                            No es un error ni se perdió nada — solo que el
                            sistema sigue trabajando sin conexión, y hay que
                            decirlo en vez de dejar el botón en gris. */}
                        {noVolvio && (
                            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
                                    <CloudOff size={14} />
                                    Todavía no hay conexión
                                </div>
                                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                    El servidor no contestó, así que el sistema sigue trabajando sin
                                    conexión. <span className="text-[var(--color-text)]">No se perdió ninguna venta</span>:
                                    se siguen guardando en el equipo y suben solas apenas
                                    vuelva el internet. No hace falta que hagas nada.
                                </p>
                            </div>
                        )}

                        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                            Si el servidor sigue lento, las ventas pueden volver a demorar.
                            Podés apagarlo de nuevo cuando quieras desde el mismo botón.
                        </p>

                        <div className="flex gap-2 pt-4">
                            <button
                                onClick={() => setConfirmando(false)}
                                disabled={comprobando}
                                className="flex-1 py-2.5 rounded-lg border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-sm font-semibold disabled:opacity-50"
                            >
                                {noVolvio ? 'Entendido' : 'Seguir sin conexión'}
                            </button>
                            <button
                                onClick={volverOnline}
                                disabled={comprobando}
                                className="flex-1 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                                {comprobando
                                    ? <><Loader2 size={14} className="animate-spin" /> Comprobando…</>
                                    : <><Wifi size={14} /> {noVolvio ? 'Probar de nuevo' : 'Conectar'}</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};

export default BotonModoOffline;
