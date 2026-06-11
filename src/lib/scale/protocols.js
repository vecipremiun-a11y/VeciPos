// Parsers de protocolo de báscula. Cada uno toma una línea de texto del puerto
// serie y devuelve { weight, unit, stable, raw } si reconoce un frame válido,
// o null si no.
//
// `stable` puede ser:
//   - true / false  → si el protocolo trae bandera explícita
//   - undefined     → no aplica; el caller hace detección por repetición
//
// El peso siempre se devuelve normalizado en kg.

const toKg = (value, unit) => {
    const u = unit.toLowerCase();
    if (u === 'g') return value / 1000;
    if (u === 'lb') return value * 0.453592;
    return value; // kg
};

// XSeries / BPlus / Mavin — "ST,GS,+   0.281kg" / "US,NT,+   0.000kg"
// ST = stable, US = unstable; GS = gross, NT = net.
const xseries = {
    id: 'xseries',
    label: 'XSeries / BPlus / Mavin',
    parse(line) {
        const m = /\b(ST|US)\s*,\s*\w+\s*,\s*([+-]?\d+(?:\.\d+)?)\s*(kg|g|lb)/i.exec(line);
        if (!m) return null;
        const weight = toKg(parseFloat(m[2]), m[3]);
        return { weight, unit: 'kg', stable: m[1].toUpperCase() === 'ST', raw: line };
    },
};

// Aclas — variantes ASCII, típico "+0001.234 kg ST" o "S +1.234 kg".
const aclas = {
    id: 'aclas',
    label: 'Aclas',
    parse(line) {
        const m = /([+-]?\d+(?:\.\d+)?)\s*(kg|g)\s*(ST|US)?/i.exec(line);
        if (!m) return null;
        const weight = toKg(parseFloat(m[1]), m[2]);
        const stable = m[3] ? m[3].toUpperCase() === 'ST' : undefined;
        return { weight, unit: 'kg', stable, raw: line };
    },
};

// CAS / Toledo / clásicas — "S +1.234 kg", "U  0.250 kg" (S=stable, U=unstable)
const casToledo = {
    id: 'casToledo',
    label: 'CAS / Toledo / clásicas',
    parse(line) {
        const m = /^\s*([SU])\s+([+-]?\d+(?:\.\d+)?)\s*(kg|g)/i.exec(line);
        if (m) {
            const weight = toKg(parseFloat(m[2]), m[3]);
            return { weight, unit: 'kg', stable: m[1].toUpperCase() === 'S', raw: line };
        }
        // Algunos modelos clásicos no envían bandera — solo peso
        const m2 = /([+-]?\d+(?:\.\d+)?)\s*(kg|g)/i.exec(line);
        if (!m2) return null;
        return { weight: toKg(parseFloat(m2[1]), m2[2]), unit: 'kg', stable: undefined, raw: line };
    },
};

// Digi — "ST 1.234 kg" / "US 0.000 kg" / "+0001.234kg"
const digi = {
    id: 'digi',
    label: 'Digi',
    parse(line) {
        const stMatch = /\b(ST|US)\b/i.exec(line);
        const m = /([+-]?\d+(?:\.\d+)?)\s*(kg|g)/i.exec(line);
        if (!m) return null;
        const stable = stMatch ? stMatch[1].toUpperCase() === 'ST' : undefined;
        return { weight: toKg(parseFloat(m[1]), m[2]), unit: 'kg', stable, raw: line };
    },
};

// Genérico — extrae cualquier "NUM kg" o "NUM g" sin asumir formato fijo.
// El caller hace la detección de estabilidad por repetición de lecturas.
const generic = {
    id: 'generic',
    label: 'Genérico (auto)',
    parse(line) {
        const m = /([+-]?\d+(?:[.,]\d+)?)\s*(kg|g|lb)/i.exec(line);
        if (!m) return null;
        const weight = toKg(parseFloat(m[1].replace(',', '.')), m[2]);
        return { weight, unit: 'kg', stable: undefined, raw: line };
    },
};

export const parsers = { xseries, aclas, casToledo, digi, generic };

export const PROTOCOL_OPTIONS = [
    { id: 'generic',   label: 'Genérico (auto)',           description: 'Funciona con la mayoría de básculas ASCII. Recomendado si no estás seguro.' },
    { id: 'xseries',   label: 'XSeries / BPlus / Mavin',   description: 'Común en POS chileno. Frame "ST,GS,+ 0.281kg".' },
    { id: 'aclas',     label: 'Aclas',                     description: 'Muy usado en panaderías y carnicerías en Chile.' },
    { id: 'casToledo', label: 'CAS / Toledo / clásicas',   description: 'Marcas industriales tradicionales (incluye Toledo).' },
    { id: 'digi',      label: 'Digi',                       description: 'Básculas Digi (japonesas) — formato ASCII con ST/US.' },
];
