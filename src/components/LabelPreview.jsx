import React, { useRef, useState, useLayoutEffect } from 'react';
import { LABEL_STYLES, DEFAULT_STYLE, layoutText, HRI_H, elContent, canvasH, canvasW } from '../lib/thermalLabel';

/**
 * Dibuja una etiqueta usando el MISMO descriptor que genera el TSPL, así la vista
 * previa y lo que sale impreso siempre coinciden.
 * data = { name, priceText, barcodeUrl }
 * `responsive`: se adapta al ancho del contenedor (así nunca se ve cortada en
 * pantallas angostas); si no, usa `width` fijo.
 */
export default function LabelPreview({ styleId = DEFAULT_STYLE, data, width = 260, responsive = false }) {
    const stl = LABEL_STYLES[styleId] || LABEL_STYLES[DEFAULT_STYLE];
    const boxRef = useRef(null);
    const [measured, setMeasured] = useState(0);

    // Mide el contenedor real para escalar la etiqueta sin recortarla.
    useLayoutEffect(() => {
        if (!responsive || !boxRef.current) return;
        const el = boxRef.current;
        const update = () => setMeasured(el.clientWidth);
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [responsive]);

    const W0 = canvasW(stl);              // 400 normal · 800 en los acostados
    const H0 = canvasH(stl);              // 240 normal · 384 en los acostados
    const w = responsive ? measured : width;
    const s = w / W0;                     // escala px por dot
    const height = H0 * s;
    const px = (v) => `${v * s}px`;

    const renderEl = (el, i) => {
        const rx = el.x ?? 0, rw = el.w ?? W0;

        if (el.kind === 'line') {
            const lx = el.full ? rx : rx + rw * 0.08;
            const lw = el.full ? rw : rw * 0.84;
            return <div key={i} style={{ position: 'absolute', left: px(lx), top: px(el.y), width: px(lw), height: Math.max(1, 3 * s), background: '#000' }} />;
        }
        if (el.kind === 'dashed') {
            return <div key={i} style={{ position: 'absolute', left: px(rx + 12), top: px(el.y), width: px(rw - 24), borderTop: '1.5px dashed #000' }} />;
        }
        if (el.kind === 'dashedBox') {
            return <div key={i} style={{ position: 'absolute', left: px(rx), top: px(el.y), width: px(rw), height: px(el.h), border: `${Math.max(1, 2 * s)}px dashed #000` }} />;
        }
        if (el.kind === 'barcode') {
            if (!data?.barcodeUrl) {
                return <div key={i} style={{ position: 'absolute', left: px(rx), top: px(el.y), width: px(rw), textAlign: 'center', fontSize: px(28), color: '#c00' }}>sin código</div>;
            }
            return <img key={i} src={data.barcodeUrl} alt="" style={{ position: 'absolute', left: px(rx), top: px(el.y), width: px(rw), height: px(el.h + HRI_H), objectFit: 'contain' }} />;
        }

        const content = elContent(el, data);
        if (!content) return null;

        const band = el.invert && (
            <div style={{ position: 'absolute', left: px(el.bandX ?? 0), top: px(el.bandY ?? el.y), width: px(el.bandW ?? W0), height: px(el.bandH ?? el.h), background: '#000' }} />
        );

        // ACOSTADOS: se imprimen como imagen dibujada, así que la letra crece con
        // la caja (sin el tope de las fuentes internas). Mismo cálculo que el canvas.
        if (stl.rotated) {
            const lines = layoutText(el, content, W0).map(t => t.text);
            const n = Math.max(1, lines.length);
            const gap = n > 1 ? el.h * 0.06 : 0;
            const perH = (el.h - gap * (n - 1)) / n;
            const boxY = el.invert ? (el.bandY ?? el.y) : el.y;
            const boxH = el.invert ? (el.bandH ?? el.h) : el.h;
            const lineH = perH;                       // alto real de cada línea
            const totalH = lineH * n + gap * (n - 1);
            const top0 = boxY + (boxH - totalH) / 2;
            return (
                <React.Fragment key={i}>
                    {band}
                    {lines.map((ln, j) => (
                        <div key={j} style={{
                            position: 'absolute', left: px(rx), top: px(top0 + j * (lineH + gap)),
                            width: px(rw), height: px(lineH), lineHeight: px(lineH),
                            fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 800,
                            fontSize: px(perH / 0.72),
                            color: el.invert ? '#fff' : '#000',
                            whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden',
                            textDecoration: el.strike ? 'line-through' : 'none',
                        }}>
                            {/* El signo de moneda va más chico, al alto de los dígitos */}
                            {(() => {
                                const mm = /^([^0-9]+)([0-9].*)$/.exec(String(ln));
                                if (!(el.kind === 'price' || el.kind === 'oldPrice') || !mm) return ln;
                                return (<><span style={{ fontSize: '0.78em' }}>{mm[1]}</span>{mm[2]}</>);
                            })()}
                        </div>
                    ))}
                </React.Fragment>
            );
        }

        // Mismo cálculo de fuente y centrado (horizontal y vertical) que el TSPL.
        return (
            <React.Fragment key={i}>
                {band}
                {layoutText(el, content, W0).map((t, j) => {
                    // Las fuentes TSPL son de ancho fijo: usamos monoespaciada y
                    // derivamos el tamaño del ancho real de carácter, para que la
                    // vista previa ocupe lo mismo que la impresión.
                    const charW = t.w / Math.max(1, t.text.length);
                    return (
                        <React.Fragment key={j}>
                            <div style={{
                                position: 'absolute', left: px(t.x), top: px(t.y),
                                width: px(t.w), height: px(t.h), lineHeight: px(t.h),
                                fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 700,
                                fontSize: px(charW / 0.6),
                                color: el.invert ? '#fff' : '#000',
                                whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden',
                            }}>
                                {t.text}
                            </div>
                            {/* Tachado del precio anterior */}
                            {el.strike && (
                                <div style={{
                                    position: 'absolute', left: px(t.x), top: px(t.y + t.h / 2),
                                    width: px(t.w), height: Math.max(1, 3 * s), background: '#000',
                                }} />
                            )}
                        </React.Fragment>
                    );
                })}
            </React.Fragment>
        );
    };

    return (
        <div ref={boxRef} style={{
            position: 'relative',
            width: responsive ? '100%' : width,
            height, background: '#fff', borderRadius: 3, overflow: 'hidden',
        }}>
            {w > 0 && (
                <>
                    {stl.border && (
                        <div style={{
                            position: 'absolute', left: px(stl.border.x), top: px(stl.border.y),
                            width: px(stl.border.x2 - stl.border.x), height: px(stl.border.y2 - stl.border.y),
                            border: `${Math.max(1, stl.border.t * s)}px solid #000`, borderRadius: 2,
                        }} />
                    )}
                    {stl.elements.map(renderEl)}
                </>
            )}
        </div>
    );
}
