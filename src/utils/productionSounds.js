// ===== Sonidos para nuevos pedidos en Producción =====
// Generados con WebAudio API (sin archivos externos). Cada sonido dura ~3s
// y está diseñado para escucharse sobre ruido ambiente de cocina.

const buildContext = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 18;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    const master = ctx.createGain();
    master.gain.value = 1.0; // volumen máximo
    compressor.connect(master).connect(ctx.destination);
    return { ctx, out: compressor };
};

const tone = (ctx, out, { freq, start, dur, type = 'square', vol = 0.7 }) => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.008);
    gain.gain.setValueAtTime(vol, now + start + Math.max(0, dur - 0.04));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(out);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
};

const sweep = (ctx, out, { fromFreq, toFreq, start, dur, type = 'sawtooth', vol = 0.7 }) => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromFreq, now + start);
    osc.frequency.linearRampToValueAtTime(toFreq, now + start + dur);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.012);
    gain.gain.setValueAtTime(vol, now + start + Math.max(0, dur - 0.05));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(out);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
};

// ===== Definición de los 6 sonidos =====
// Selección curada: 6 notificaciones profesionales y agradables, cada una con
// una personalidad clara. Todas ~2-3s, no repetitivas, mezcla de sensaciones
// (suave, urgente, elegante, cálido) para cubrir distintos gustos de cocina.
const SOUND_BUILDERS = {
    // 1. ⭐ RECOMENDADO — Notificación moderna estilo iOS/Apple
    // Tono cristal con armónico, golpe sutil, reverb sintetizada
    'crystal-ping': (ctx, out) => {
        // Pre-impacto sutil
        sweep(ctx, out, { fromFreq: 2400, toFreq: 1800, start: 0, dur: 0.06, type: 'sine', vol: 0.5 });
        // Cristal principal — Si5 (1975Hz) sostenido con decay natural
        const ping = (freq, start, dur, vol) => {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
            osc.connect(gain).connect(out);
            osc.start(now + start);
            osc.stop(now + start + dur + 0.02);
        };
        ping(1975.53, 0.05, 2.5, 0.7);  // Si6
        ping(2637.02, 0.05, 2.0, 0.45); // Mi7 (3a)
        ping(3951.07, 0.05, 1.5, 0.25); // Si7 (8a)
        // Toque de calidez bajo
        ping(987.77, 0.05, 1.2, 0.4);
    },

    // 2. ⭐ Campana Zen — relajante, profesional, perfecta para ambientes
    'zen-chime': (ctx, out) => {
        const bell = (freq, start, dur, vol) => {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
            osc.connect(gain).connect(out);
            osc.start(now + start);
            osc.stop(now + start + dur + 0.02);
        };
        // Campana principal con armónicos típicos de campana real
        const fundamental = 587.33; // Re5
        bell(fundamental,         0,    2.8, 0.75);
        bell(fundamental * 2,     0,    2.2, 0.45);
        bell(fundamental * 2.76,  0,    1.8, 0.30); // armónico no entero (campana)
        bell(fundamental * 5.4,   0,    1.2, 0.18);
        // Segunda nota más alta a los 0.6s (resolución)
        bell(fundamental * 1.5,   0.6,  2.4, 0.55); // La5
        bell(fundamental * 3,     0.6,  1.8, 0.35);
    },

    // 3. ⭐ Pop suave + brillo — clásico de notificación, corto y limpio
    'soft-pop': (ctx, out) => {
        // "Pop" inicial cálido
        sweep(ctx, out, { fromFreq: 200, toFreq: 800, start: 0, dur: 0.08, type: 'sine', vol: 0.85 });
        // Cuerpo del tono principal (Sol5 → Do6)
        tone(ctx, out, { freq: 783.99,  start: 0.06, dur: 0.5, type: 'triangle', vol: 0.7 });
        tone(ctx, out, { freq: 1046.5,  start: 0.18, dur: 1.6, type: 'triangle', vol: 0.7 });
        // Capa de brillo
        tone(ctx, out, { freq: 2093,    start: 0.18, dur: 1.4, type: 'sine',     vol: 0.45 });
        // Cola que se desvanece
        tone(ctx, out, { freq: 1568,    start: 0.18, dur: 1.8, type: 'sine',     vol: 0.35 });
    },

    // 4. ⭐ Llegada cinematográfica — whoosh + impacto + acorde resolutivo
    'cinematic-arrival': (ctx, out) => {
        // Whoosh aproximándose (1.4s)
        sweep(ctx, out, { fromFreq: 100,  toFreq: 1400, start: 0, dur: 1.4, type: 'sawtooth', vol: 0.55 });
        sweep(ctx, out, { fromFreq: 200,  toFreq: 2800, start: 0, dur: 1.4, type: 'sine',     vol: 0.35 });
        // Impacto al llegar
        sweep(ctx, out, { fromFreq: 800,  toFreq: 80,   start: 1.35, dur: 0.18, type: 'square', vol: 0.85 });
        // Acorde resolutivo Do mayor sostenido (1.5s)
        const chord = [523.25, 659.25, 783.99, 1046.5];
        chord.forEach((f) => {
            tone(ctx, out, { freq: f,     start: 1.5, dur: 1.45, type: 'triangle', vol: 0.55 });
            tone(ctx, out, { freq: f * 2, start: 1.5, dur: 1.20, type: 'sine',     vol: 0.30 });
        });
    },

    // 5. ⭐ Doble ding profesional — corto, elegante, no invasivo
    'double-ding': (ctx, out) => {
        const ding = (freq, start, dur, vol) => {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
            osc.connect(gain).connect(out);
            osc.start(now + start);
            osc.stop(now + start + dur + 0.02);
        };
        // Primer ding — Mi6
        ding(1318.51, 0,    1.4, 0.75);
        ding(2637.02, 0,    1.0, 0.35);
        // Segundo ding — Sol6 (3a mayor) a los 0.35s
        ding(1567.98, 0.35, 1.8, 0.75);
        ding(3135.96, 0.35, 1.2, 0.35);
        // Tercer ding más alto — Do7 (resolución) a los 0.8s
        ding(2093.00, 0.8,  2.2, 0.7);
        ding(4186.01, 0.8,  1.5, 0.30);
    },

    // 6. ⭐ Marimba digital cálida — ascendente Do-Mi-Sol-Do, 4 notas
    'warm-marimba': (ctx, out) => {
        const note = (freq, start, vol = 0.7) => {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 1.4);
            osc.connect(gain).connect(out);
            osc.start(now + start);
            osc.stop(now + start + 1.45);
            // Armónico para riqueza de marimba
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.value = freq * 4;
            gain2.gain.setValueAtTime(0.0001, now + start);
            gain2.gain.exponentialRampToValueAtTime(vol * 0.35, now + start + 0.008);
            gain2.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.5);
            osc2.connect(gain2).connect(out);
            osc2.start(now + start);
            osc2.stop(now + start + 0.55);
        };
        // 4 notas ascendentes Do5-Mi5-Sol5-Do6 + acorde final
        note(523.25, 0.0);   // Do5
        note(659.25, 0.18);  // Mi5
        note(783.99, 0.36);  // Sol5
        note(1046.5, 0.54);  // Do6
        // Acorde final sostenido (los 4 al final)
        note(523.25, 0.9, 0.5);
        note(659.25, 0.9, 0.5);
        note(783.99, 0.9, 0.5);
        note(1046.5, 0.9, 0.65);
    },
};

export const PRODUCTION_SOUNDS = [
    { id: 'crystal-ping',      label: 'Ping Cristal',           description: 'Notificación moderna brillante (recomendado)' },
    { id: 'zen-chime',         label: 'Campana Zen',            description: 'Campana relajante con armónicos naturales' },
    { id: 'soft-pop',          label: 'Pop Suave',              description: 'Toque cálido con cola brillante, no invasivo' },
    { id: 'cinematic-arrival', label: 'Llegada Cinematográfica', description: 'Whoosh + impacto + acorde resolutivo' },
    { id: 'double-ding',       label: 'Triple Ding Elegante',    description: 'Tres notas ascendentes profesionales' },
    { id: 'warm-marimba',      label: 'Marimba Cálida',         description: 'Melodía ascendente Do-Mi-Sol-Do' },
];

export const DEFAULT_PRODUCTION_SOUND = 'crystal-ping';
const STORAGE_KEY = 'production_sound';

export const getProductionSound = () => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && SOUND_BUILDERS[saved]) return saved;
    } catch { /* noop */ }
    return DEFAULT_PRODUCTION_SOUND;
};

export const setProductionSound = (id) => {
    if (!SOUND_BUILDERS[id]) return;
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
};

export const playProductionSound = (id = getProductionSound()) => {
    try {
        const builder = SOUND_BUILDERS[id] || SOUND_BUILDERS[DEFAULT_PRODUCTION_SOUND];
        const built = buildContext();
        if (!built) return;
        builder(built.ctx, built.out);
        // Cerrar contexto después de que termine
        setTimeout(() => { try { built.ctx.close(); } catch { /* noop */ } }, 3500);
    } catch { /* ignore audio errors */ }
};
