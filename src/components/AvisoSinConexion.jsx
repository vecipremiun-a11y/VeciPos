import React, { useEffect, useState } from 'react';
import { CloudOff, AlertTriangle } from 'lucide-react';
import { hayConexion, alCambiarConexion, esOfflineManual } from '../lib/conectividad';
import { estadoCatalogoLocal } from '../lib/db/catalogoLocal';
import { useStore } from '../store/useStore';

// Barra fija que avisa que el POS está trabajando sin internet.
//
// Sin esto el cajero no tenía forma de saberlo: seguía vendiendo y recién se
// enteraba al ver que algo no cuadraba. Lo importante del mensaje es que
// tranquiliza —se puede seguir vendiendo— y dice qué va a pasar después.
//
// Además dice qué catálogo quedó guardado, porque no es lo mismo quedarse sin
// internet con los productos al día que quedarse sin internet y sin catálogo:
// en el segundo caso la búsqueda no va a encontrar nada y hay que saberlo ANTES
// de que se forme la fila, no cuando el cliente ya está en la caja.

/** "hace 3 min", "hace 2 h", "hace 4 días". */
function hace(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

const AvisoSinConexion = () => {
    const [online, setOnline] = useState(hayConexion);
    // Distinto cartel según QUIÉN decidió: no es lo mismo 'se cayó el internet'
    // que 'lo puse yo porque el sistema andaba lento'.
    const [porDecision, setPorDecision] = useState(esOfflineManual);
    const [catalogo, setCatalogo] = useState(null);
    const activeCompanyId = useStore((s) => s.activeCompanyId);

    useEffect(() => alCambiarConexion((hay) => { setOnline(hay); setPorDecision(esOfflineManual()); }), []);

    // Se consulta al caer la conexión, no todo el tiempo: mientras hay internet
    // este cartel no se muestra y el dato no le sirve a nadie.
    useEffect(() => {
        if (online || !activeCompanyId) return;
        let vigente = true;
        estadoCatalogoLocal(activeCompanyId)
            .then((e) => { if (vigente) setCatalogo(e); })
            .catch(() => { if (vigente) setCatalogo(null); });
        return () => { vigente = false; };
    }, [online, activeCompanyId]);

    if (online) return null;

    const sinCatalogo = catalogo && catalogo.productos === 0;
    const edad = catalogo?.ultimoSync ? hace(catalogo.ultimoSync) : null;

    return (
        <div className={`fixed bottom-0 left-0 right-0 z-[9998] px-4 py-2 flex items-center justify-center gap-2 text-sm font-bold shadow-2xl animate-in slide-in-from-bottom duration-200 ${sinCatalogo ? 'bg-red-500 text-white' : 'bg-amber-500 text-black'}`}>
            {sinCatalogo
                ? <AlertTriangle size={16} className="shrink-0" />
                : <CloudOff size={16} className="shrink-0" />}
            <span className="text-center">
                {sinCatalogo ? (
                    <>Sin conexión y sin catálogo guardado · No vas a poder buscar productos hasta que vuelva el internet. Las ventas que alcances a hacer igual se guardan.</>
                ) : porDecision ? (
                    <>
                        {/* Lo prendió una persona. Decir "sin conexión" acá sería
                            mentir: puede haber internet de sobra y el modo estar
                            puesto porque el sistema andaba lento. */}
                        Modo offline puesto por vos · Las ventas se guardan en este equipo y se envían cuando lo apagues.
                        {catalogo && (
                            <span className="font-medium opacity-80">
                                {' '}({catalogo.productos.toLocaleString('es-CL')} productos guardados{edad ? `, actualizados ${edad}` : ''})
                            </span>
                        )}
                    </>
                ) : (
                    <>
                        Sin conexión · Podés seguir vendiendo: las ventas se guardan y se envían solas al volver el internet.
                        {catalogo && (
                            <span className="font-medium opacity-80">
                                {' '}({catalogo.productos.toLocaleString('es-CL')} productos guardados{edad ? `, actualizados ${edad}` : ''})
                            </span>
                        )}
                    </>
                )}
            </span>
        </div>
    );
};

export default AvisoSinConexion;
