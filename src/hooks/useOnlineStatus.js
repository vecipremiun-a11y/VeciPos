// Hook que expone el estado de conexión actual.
//
// Pregunta al monitor de conectividad (src/lib/conectividad.js), que late contra
// /api/ping y sabe si el servidor CONTESTA. Antes miraba `navigator.onLine`, que
// solo dice si el equipo está conectado a una red: con el WiFi del local prendido
// y el internet caído contestaba "sí hay conexión", así que el cartel de "Modo
// offline" del POS no aparecía justo cuando hacía falta —mientras el aviso de
// abajo, que sí usa el monitor, decía lo contrario—.

import { useEffect, useState } from 'react';
import { hayConexion, alCambiarConexion } from '../lib/conectividad';

/**
 * @returns {{ online: boolean, lastOnline: string|null, lastOffline: string|null }}
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(hayConexion);
  const [lastOnline, setLastOnline] = useState(null);
  const [lastOffline, setLastOffline] = useState(null);

  useEffect(() => {
    // Puede haber cambiado entre el primer render y el efecto.
    setOnline(hayConexion());
    return alCambiarConexion((hay) => {
      setOnline(hay);
      if (hay) setLastOnline(new Date().toISOString());
      else setLastOffline(new Date().toISOString());
    });
  }, []);

  return { online, lastOnline, lastOffline };
}
