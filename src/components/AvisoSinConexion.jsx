import React, { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { hayConexion, alCambiarConexion } from '../lib/conectividad';

// Barra fija que avisa que el POS está trabajando sin internet.
//
// Sin esto el cajero no tenía forma de saberlo: seguía vendiendo y recién se
// enteraba al ver que algo no cuadraba. Lo importante del mensaje es que
// tranquiliza —se puede seguir vendiendo— y dice qué va a pasar después.

const AvisoSinConexion = () => {
    const [online, setOnline] = useState(hayConexion());

    useEffect(() => alCambiarConexion(setOnline), []);

    if (online) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 z-[9998] bg-amber-500 text-black px-4 py-2 flex items-center justify-center gap-2 text-sm font-bold shadow-2xl animate-in slide-in-from-bottom duration-200">
            <CloudOff size={16} className="shrink-0" />
            <span className="text-center">
                Sin conexión · Podés seguir vendiendo: las ventas se guardan y se envían solas al volver el internet.
            </span>
        </div>
    );
};

export default AvisoSinConexion;
