// API endpoint: /api/sii/lookup-rut
// Consulta datos de contribuyente en el SII por RUT

import https from 'https';

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 10000);
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-CL,es;q=0.9',
            },
            rejectUnauthorized: false, // SII certs can be problematic
        }, (res) => {
            let data = '';
            res.setEncoding('latin1'); // SII uses ISO-8859-1
            res.on('data', chunk => data += chunk);
            res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, body: data }); });
        });
        req.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const rut = req.query?.rut;
    if (!rut) {
        return res.status(400).json({ error: 'Parámetro rut requerido' });
    }

    // Clean RUT: remove dots and dash, separate body and dv
    const clean = rut.replace(/\./g, '').replace(/-/g, '');
    if (clean.length < 2) {
        return res.status(400).json({ error: 'RUT inválido' });
    }

    const rutBody = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();

    try {
        // SII public endpoint for taxpayer info
        const siiUrl = `https://zeus.sii.cl/cvc_cgi/stc/getstc?RUT=${rutBody}&DV=${dv}&PRG=STC&OPC=NOR`;

        const response = await httpsGet(siiUrl);

        if (response.status !== 200) {
            return res.status(502).json({ error: 'SII no disponible', status: response.status });
        }

        const html = response.body;

        // Parse the HTML response from SII
        const data = parseSiiResponse(html);

        if (!data) {
            return res.status(404).json({ error: 'Contribuyente no encontrado en SII', found: false });
        }

        return res.status(200).json({
            found: true,
            rut: `${rutBody}-${dv}`,
            ...data,
        });

    } catch (e) {
        console.error('Error consultando SII:', e.message);
        return res.status(500).json({ error: 'Error al consultar SII: ' + e.message });
    }
}

function parseSiiResponse(html) {
    // The SII response contains a table with taxpayer data
    // We need to extract: Razón Social, Giro/Actividad, Dirección, Comuna

    if (!html || html.includes('NO ENCONTRADO') || html.includes('no encontrado')) {
        return null;
    }

    const result = {};

    // Extract Razón Social - appears in bold in the response
    const razonMatch = html.match(/<font[^>]*><b>\s*(.+?)\s*<\/b><\/font>/i);
    if (razonMatch) {
        result.razon_social = cleanHtmlText(razonMatch[1]);
    }

    // Try to extract from table rows
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        if (cells.length >= 2) {
            const label = cleanHtmlText(cells[0]).toLowerCase();
            const value = cleanHtmlText(cells[1]);

            if (!value) continue;

            if (label.includes('actividad') || label.includes('giro')) {
                // Could have multiple activities, take the first/primary
                if (!result.giro) {
                    result.giro = value;
                }
            }

            if (label.includes('direcci') || label.includes('domicilio')) {
                if (!result.direccion) {
                    result.direccion = value;
                }
            }

            if (label.includes('comuna')) {
                if (!result.comuna) {
                    result.comuna = value;
                }
            }

            if (label.includes('nombre') || label.includes('raz')) {
                if (!result.razon_social) {
                    result.razon_social = value;
                }
            }
        }
    }

    // Also try regex patterns common in SII pages
    if (!result.razon_social) {
        // Pattern: text between specific markers
        const nameMatch = html.match(/Raz[oó]n Social\s*:?\s*<[^>]*>([^<]+)/i)
            || html.match(/Nombre\s*:?\s*<[^>]*>([^<]+)/i);
        if (nameMatch) result.razon_social = cleanHtmlText(nameMatch[1]);
    }

    if (!result.giro) {
        const giroMatch = html.match(/Actividad[^:]*:?\s*<[^>]*>([^<]+)/i)
            || html.match(/Giro\s*:?\s*<[^>]*>([^<]+)/i);
        if (giroMatch) result.giro = cleanHtmlText(giroMatch[1]);
    }

    // Return null if we couldn't extract any useful data
    if (!result.razon_social && !result.giro) {
        return null;
    }

    return {
        razon_social: result.razon_social || '',
        giro: result.giro || '',
        direccion: result.direccion || '',
        comuna: result.comuna || '',
    };
}

function cleanHtmlText(text) {
    if (!text) return '';
    return text
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}
