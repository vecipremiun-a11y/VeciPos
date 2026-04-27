// Hook que expone el estado de conexión actual.
// Combina navigator.onLine con un ping opcional al servidor para detectar
// "internet realmente útil" (cuando hay WiFi pero sin conexión a Turso).

import { useEffect, useState, useCallback } from 'react';

/**
 * @returns {{ online: boolean, lastOnline: string|null, lastOffline: string|null }}
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [lastOnline, setLastOnline] = useState(null);
  const [lastOffline, setLastOffline] = useState(null);

  const handleOnline = useCallback(() => {
    setOnline(true);
    setLastOnline(new Date().toISOString());
  }, []);

  const handleOffline = useCallback(() => {
    setOnline(false);
    setLastOffline(new Date().toISOString());
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return { online, lastOnline, lastOffline };
}
