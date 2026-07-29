import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Bike, RefreshCw, Clock, Navigation, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import 'leaflet/dist/leaflet.css';

// Delivery → Rastreo. Mapa en vivo con OpenStreetMap (gratis, sin API key) y la
// última posición que reportó cada repartidor mientras está en ruta.
const REFRESH_MS = 15000;

// Minutos desde un ISO (para saber si el dato está fresco).
const minsSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / 60000) : null);

export default function Tracking() {
    const { fetchDeliveryTracking } = useStore();
    const [data, setData] = useState({ couriers: [], deliveries: [] });
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);

    const mapRef = useRef(null);
    const mapObj = useRef(null);
    const markers = useRef(new Map());
    const Lref = useRef(null);

    // Carga de datos + refresco automático.
    const load = React.useCallback(async () => {
        const r = await fetchDeliveryTracking();
        if (r?.success) setData({ couriers: r.couriers || [], deliveries: r.deliveries || [] });
        setLoading(false);
    }, [fetchDeliveryTracking]);

    useEffect(() => {
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    // Mapa: se crea una sola vez (Leaflet es imperativo, no React).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const L = (await import('leaflet')).default;
            if (cancelled || !mapRef.current || mapObj.current) return;
            Lref.current = L;
            const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true })
                .setView([-33.45, -70.66], 12);   // Santiago por defecto
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap',
            }).addTo(map);
            mapObj.current = map;
            setTimeout(() => map.invalidateSize(), 100);
        })();
        return () => {
            cancelled = true;
            if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
        };
    }, []);

    // Marcadores: se actualizan en cada refresco sin recrear el mapa.
    useEffect(() => {
        const L = Lref.current;
        const map = mapObj.current;
        if (!L || !map) return;

        const withPos = data.couriers.filter(c => c.last_lat != null && c.last_lng != null);
        const seen = new Set();

        for (const c of withPos) {
            seen.add(c.id);
            const pos = [Number(c.last_lat), Number(c.last_lng)];
            const stale = (minsSince(c.last_seen_at) ?? 999) > 5;
            const html = `<div style="background:${stale ? '#6b7280' : '#06b6d4'};color:#000;font-weight:800;
                border-radius:9999px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;
                border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);font-size:16px">🛵</div>`;
            const icon = L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });

            if (markers.current.has(c.id)) {
                const m = markers.current.get(c.id);
                m.setLatLng(pos); m.setIcon(icon);
                m.setPopupContent(`<b>${c.name}</b><br/>${stale ? 'Sin señal reciente' : 'En vivo'}`);
            } else {
                const m = L.marker(pos, { icon }).addTo(map).bindPopup(`<b>${c.name}</b>`);
                markers.current.set(c.id, m);
            }
        }
        // Quitar los que ya no reportan.
        for (const [id, m] of markers.current) {
            if (!seen.has(id)) { m.remove(); markers.current.delete(id); }
        }
        // Encuadrar la primera vez que hay posiciones.
        if (withPos.length && !map._fitted) {
            map.fitBounds(withPos.map(c => [Number(c.last_lat), Number(c.last_lng)]), { padding: [50, 50], maxZoom: 15 });
            map._fitted = true;
        }
    }, [data]);

    const focus = (c) => {
        setSelected(c.id);
        const map = mapObj.current;
        if (map && c.last_lat != null) {
            map.setView([Number(c.last_lat), Number(c.last_lng)], 16, { animate: true });
            markers.current.get(c.id)?.openPopup();
        }
    };

    const activos = data.couriers.filter(c => c.status !== 'off');

    return (
        <div className="h-full flex flex-col gap-4 p-4 lg:p-6">
            <div className="flex items-center justify-between gap-3 shrink-0">
                <div>
                    <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <MapPin className="text-[var(--color-primary)]" /> Rastreo en vivo
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-xs lg:text-sm">
                        Dónde va cada repartidor. Se actualiza solo cada 15 segundos.
                    </p>
                </div>
                <button onClick={load} className="p-2.5 rounded-xl border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] shrink-0">
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
                {/* Mapa */}
                <div className="flex-1 min-h-[320px] rounded-2xl overflow-hidden border border-[var(--glass-border)] relative">
                    <div ref={mapRef} className="w-full h-full" style={{ minHeight: 320, background: '#0b0b17' }} />
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm gap-2">
                            <Loader2 className="animate-spin" size={18} /> Cargando mapa…
                        </div>
                    )}
                </div>

                {/* Panel lateral */}
                <div className="lg:w-[320px] shrink-0 overflow-y-auto space-y-2">
                    {activos.length === 0 ? (
                        <div className="glass-card p-6 text-center text-[var(--color-text-muted)]">
                            <Bike size={40} className="opacity-20 mx-auto mb-2" />
                            <p className="text-sm">Ningún repartidor en turno.</p>
                        </div>
                    ) : activos.map(c => {
                        const mins = minsSince(c.last_seen_at);
                        const sinSenal = mins == null || mins > 5;
                        const suyos = data.deliveries.filter(d => d.courier_id === c.id);
                        return (
                            <button key={c.id} onClick={() => focus(c)}
                                className={cn('w-full text-left glass-card p-3 transition-all',
                                    selected === c.id && 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/5')}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-bold text-[var(--color-text)] truncate">🛵 {c.name}</p>
                                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0',
                                        sinSenal ? 'text-[var(--color-text-muted)] border-[var(--glass-border)]'
                                            : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10')}>
                                        {sinSenal ? 'Sin señal' : 'En vivo'}
                                    </span>
                                </div>
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                    {suyos.length} envío{suyos.length !== 1 ? 's' : ''} en curso
                                    {mins != null && <> · <Clock size={10} className="inline" /> {mins} min</>}
                                </p>
                                {suyos.slice(0, 2).map(d => (
                                    <p key={d.id} className="text-[11px] text-[var(--color-text-muted)] truncate mt-1 flex items-center gap-1">
                                        <Navigation size={10} className="shrink-0" /> #{d.id} · {d.address}
                                    </p>
                                ))}
                                {c.last_lat == null && (
                                    <p className="text-[11px] text-amber-400 mt-1">Aún no comparte ubicación</p>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
