// FASE 5.5 · Banner discreto cuando hay nueva versión de la app disponible.
// Se monta una sola vez en App.jsx. No invasivo durante una venta — está
// fijo abajo a la derecha en desktop, full-width abajo en mobile.

import React, { useEffect, useState } from 'react';
import { subscribePwaUpdate } from '../lib/pwaUpdate';
import { RefreshCw, X } from 'lucide-react';

const PWAUpdatePrompt = () => {
  const [state, setState] = useState({ needRefresh: false, firstSeen: null });
  const [dismissed, setDismissed] = useState(() => {
    try {
      const v = localStorage.getItem('pwa_update_dismissed_at');
      if (!v) return false;
      const age = Date.now() - Number(v);
      return age < 60 * 60 * 1000;
    } catch { return false; }
  });

  useEffect(() => {
    const unsub = subscribePwaUpdate(s => setState(s));
    return unsub;
  }, []);

  if (!state.needRefresh || dismissed) return null;

  const handleApply = () => {
    state.applyUpdate?.({ reason: 'user' });
  };

  const handleDismiss = () => {
    state.dismiss?.();
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[9999] bottom-4 right-4 max-w-sm md:max-w-md
                 bg-[var(--surface-elevated,#1a2238)] border border-[var(--primary,#3b82f6)]
                 rounded-xl shadow-2xl shadow-blue-500/20 p-4
                 flex items-start gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      <div className="bg-blue-500/20 rounded-lg p-2 mt-0.5 flex-shrink-0">
        <RefreshCw className="w-5 h-5 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">Nueva versión disponible</p>
        <p className="text-xs text-gray-300 mt-0.5">
          Hay una actualización lista. Se aplicará automáticamente en 30 min de
          inactividad — o puedes recargar ahora para tenerla ya.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={handleApply}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold
                       py-1.5 px-3 rounded-md transition-colors"
          >
            Aplicar ahora
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-gray-400 hover:text-white text-xs font-medium
                       py-1.5 px-3 rounded-md transition-colors"
          >
            Más tarde
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-gray-500 hover:text-white p-1 flex-shrink-0"
        aria-label="Cerrar"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default PWAUpdatePrompt;
