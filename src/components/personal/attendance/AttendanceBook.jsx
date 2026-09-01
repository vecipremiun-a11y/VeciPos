import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useStore } from '../../../store/useStore';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    BookOpen, Download, Printer, ShieldCheck, ShieldAlert, AlertTriangle,
    Loader2, Receipt as ReceiptIcon,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatRut } from '../../../utils/rutValidation';
import { summarizeDay, weeklyReport, buildAlerts, LEGAL_DEFAULTS } from '../../../utils/laborHours';
import AttendanceReceipt from './AttendanceReceipt';

/**
 * Libro de Asistencia.
 *
 * Es la vista que se le muestra a un fiscalizador y el informe de horas que se
 * le entrega al trabajador: identidad con RUT, marcas con folio, horas
 * trabajadas contra horas pactadas, y el estado de la cadena de integridad.
 *
 * El cálculo vive en utils/laborHours.js (funciones puras); acá solo se arma
 * la pantalla, el CSV y la hoja imprimible.
 */

const hhmm = (iso) => (iso ? format(new Date(iso), 'HH:mm') : '—');
const h2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

// Agrupa las marcas crudas por trabajador y por día.
function groupRecords(rows) {
    const byUser = new Map();
    for (const r of rows) {
        const uid = r.user_id;
        if (!byUser.has(uid)) {
            byUser.set(uid, {
                userId: uid,
                name: r.name || r.user_name || 'Sin nombre',
                rut: r.rut || r.user_rut || null,
                weeklyHours: Number(r.labor_weekly_hours ?? LEGAL_DEFAULTS.weeklyHours),
                exemptArt22: Number(r.labor_exempt_art22) === 1,
                days: new Map(),
            });
        }
        const u = byUser.get(uid);
        if (!u.days.has(r.date)) u.days.set(r.date, []);
        u.days.get(r.date).push(r);
    }

    return [...byUser.values()]
        .map(u => ({
            ...u,
            days: [...u.days.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, recs]) => ({ ...summarizeDay(date, recs), records: recs })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const AttendanceBook = () => {
    const {
        fetchAttendanceByRangeRaw, staffMembers, fetchStaffMembers,
        personalConfig, fetchPersonalConfig, verifyAttendanceChain,
        availableCompanies, activeCompanyId,
    } = useStore();

    const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [selectedUser, setSelectedUser] = useState('');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [chain, setChain] = useState(null);
    const [checkingChain, setCheckingChain] = useState(false);
    const [receipt, setReceipt] = useState(null);

    const company = (availableCompanies || []).find(c => c.id === activeCompanyId);
    const companyName = company?.name || '';

    const limits = useMemo(() => ({
        ...LEGAL_DEFAULTS,
        dailyMaxHours: Number(personalConfig?.legal_daily_max_hours ?? LEGAL_DEFAULTS.dailyMaxHours),
        maxOvertimeDaily: Number(personalConfig?.legal_max_overtime_daily ?? LEGAL_DEFAULTS.maxOvertimeDaily),
    }), [personalConfig]);

    const defaultWeekly = Number(personalConfig?.legal_weekly_hours ?? LEGAL_DEFAULTS.weeklyHours);

    useEffect(() => {
        fetchStaffMembers();
        fetchPersonalConfig();
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchAttendanceByRangeRaw(startDate, endDate, selectedUser || null);
            setRows(data || []);
        } catch {
            setRows([]);
        }
        setLoading(false);
    }, [startDate, endDate, selectedUser, fetchAttendanceByRangeRaw]);

    useEffect(() => { load(); }, [load]);

    const workers = useMemo(() => {
        const grouped = groupRecords(rows);
        return grouped.map(u => {
            const pacted = u.weeklyHours || defaultWeekly;
            return {
                ...u,
                weeks: weeklyReport(u.days, { weeklyPacted: pacted, exemptArt22: u.exemptArt22 }),
                alerts: buildAlerts(u.days, { weeklyPacted: pacted, limits, exemptArt22: u.exemptArt22 }),
                totalWorked: u.days.reduce((a, d) => a + d.worked, 0),
                pacted,
            };
        });
    }, [rows, defaultWeekly, limits]);

    const missingRut = workers.filter(w => !w.rut);
    const allAlerts = workers.flatMap(w => w.alerts.map(a => ({ ...a, worker: w.name })));

    const handleVerify = async () => {
        setCheckingChain(true);
        setChain(await verifyAttendanceChain({ fromSeq: 1, limit: 5000 }));
        setCheckingChain(false);
    };

    const handleCsv = () => {
        const head = [
            'Empresa', 'Trabajador', 'RUT', 'Fecha', 'Folio', 'Movimiento', 'Hora',
            'Origen', 'Sucursal', 'Dispositivo', 'Estado', 'Motivo/Nota',
        ];
        const lines = [head.join(';')];
        for (const w of workers) {
            for (const d of w.days) {
                for (const r of d.records) {
                    lines.push([
                        companyName,
                        w.name,
                        w.rut ? formatRut(w.rut) : '',
                        d.date,
                        r.seq ?? '',
                        r.type === 'entry' ? 'Entrada' : 'Salida',
                        r.recorded_at ? format(new Date(r.recorded_at), 'HH:mm:ss') : '',
                        r.source || '',
                        r.branch || '',
                        r.device_label || '',
                        Number(r.is_corrected) ? 'ANULADA' : 'Vigente',
                        (r.void_reason || r.notes || '').replace(/[;\n\r]/g, ' '),
                    ].join(';'));
                }
            }
        }
        // BOM para que Excel en español no rompa los acentos.
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `libro-asistencia_${startDate}_${endDate}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handlePrint = () => {
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        w.document.write(buildBookHtml(workers, { companyName, startDate, endDate, chain }));
        w.document.close();
        w.focus();
        w.print();
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Filtros y acciones */}
            <div className="glass-card p-4 flex flex-col lg:flex-row gap-4 lg:items-end justify-between">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Desde</label>
                        <input type="date" className="glass-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Hasta</label>
                        <input type="date" className="glass-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-[200px]">
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Trabajador</label>
                        <select className="glass-input bg-[var(--color-surface)]" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
                            <option value="">Todos</option>
                            {staffMembers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button onClick={handleVerify} disabled={checkingChain} className="btn-secondary flex items-center gap-2">
                        {checkingChain ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                        Verificar integridad
                    </button>
                    <button onClick={handleCsv} className="btn-secondary flex items-center gap-2">
                        <Download size={16} />
                        CSV
                    </button>
                    <button onClick={handlePrint} className="btn-primary flex items-center gap-2">
                        <Printer size={16} />
                        Imprimir libro
                    </button>
                </div>
            </div>

            {/* Estado de la cadena */}
            {chain && (
                <div className={cn(
                    'glass-card p-4 flex items-start gap-3',
                    chain.intact ? 'border-green-500/30' : 'border-red-500/40',
                )}>
                    {chain.intact
                        ? <ShieldCheck size={20} className="text-green-400 mt-0.5 shrink-0" />
                        : <ShieldAlert size={20} className="text-red-400 mt-0.5 shrink-0" />}
                    <div className="text-sm">
                        <p className={chain.intact ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                            {chain.intact
                                ? `Cadena íntegra: ${chain.checked} marcas verificadas, ninguna alterada.`
                                : `Se detectaron ${chain.problems.length} problemas en ${chain.checked} marcas verificadas.`}
                        </p>
                        {!chain.intact && (
                            <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                                {chain.problems.slice(0, 10).map((p, i) => (
                                    <li key={i}>Folio {p.seq}: {p.detail}</li>
                                ))}
                                {chain.problems.length > 10 && <li>…y {chain.problems.length - 10} más.</li>}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* Trabajadores sin RUT: el registro no identifica a nadie ante un tercero */}
            {missingRut.length > 0 && (
                <div className="glass-card p-4 border-amber-500/40 flex items-start gap-3">
                    <AlertTriangle size={20} className="text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-sm">
                        <p className="text-amber-400 font-medium">
                            {missingRut.length === 1 ? 'Un trabajador no tiene RUT' : `${missingRut.length} trabajadores no tienen RUT`} en su ficha.
                        </p>
                        <p className="text-[var(--color-text-muted)]">
                            Sin RUT el registro no identifica a la persona ante un tercero. Complétalo en
                            Usuarios: {missingRut.map(w => w.name).join(', ')}.
                        </p>
                    </div>
                </div>
            )}

            {/* Alertas de jornada */}
            {allAlerts.length > 0 && (
                <div className="glass-card p-4">
                    <h3 className="font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
                        <AlertTriangle size={16} className="text-amber-400" />
                        Alertas de jornada ({allAlerts.length})
                    </h3>
                    <ul className="space-y-1.5 text-sm max-h-64 overflow-y-auto">
                        {allAlerts.map((a, i) => (
                            <li key={i} className="flex gap-2">
                                <span className={cn(
                                    'shrink-0 font-mono text-xs px-1.5 py-0.5 rounded',
                                    a.level === 'error' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400',
                                )}>
                                    {a.date}
                                </span>
                                <span className="text-[var(--color-text-muted)]">
                                    <strong className="text-[var(--color-text)]">{a.worker}:</strong> {a.message}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {loading && (
                <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">Cargando el libro…</div>
            )}

            {!loading && workers.length === 0 && (
                <div className="glass-card p-8 text-center text-[var(--color-text-muted)]">
                    <BookOpen size={32} className="mx-auto mb-2 opacity-40" />
                    No hay marcas registradas en este período.
                </div>
            )}

            {/* Un bloque por trabajador */}
            {!loading && workers.map(w => (
                <div key={w.userId} className="glass-card p-0 overflow-hidden">
                    <div className="px-5 py-4 border-b border-[var(--glass-border)] flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                            <h3 className="font-semibold text-[var(--color-text)]">{w.name}</h3>
                            <p className="text-xs text-[var(--color-text-muted)]">
                                {w.rut ? formatRut(w.rut) : <span className="text-amber-400">sin RUT registrado</span>}
                                {' · '}
                                {w.exemptArt22
                                    ? 'Excluido de limitación de jornada (Art. 22)'
                                    : `Jornada pactada: ${w.pacted} h semanales`}
                            </p>
                        </div>
                        <p className="text-sm text-[var(--color-text-muted)]">
                            Total del período: <strong className="text-[var(--color-text)]">{h2(w.totalWorked)} h</strong>
                        </p>
                    </div>

                    {/* Resumen semanal: es el informe de horas del trabajador */}
                    {!w.exemptArt22 && w.weeks.length > 0 && (
                        <div className="px-5 py-3 border-b border-[var(--glass-border)] overflow-x-auto">
                            <table className="w-full text-sm min-w-[560px]">
                                <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                                    <tr>
                                        <th className="text-left py-1.5">Semana desde</th>
                                        <th className="text-right py-1.5">Pactadas</th>
                                        <th className="text-right py-1.5">Trabajadas</th>
                                        <th className="text-right py-1.5">Extraordinarias</th>
                                        <th className="text-right py-1.5">Déficit</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--glass-border)]">
                                    {w.weeks.map(wk => (
                                        <tr key={wk.weekStart}>
                                            <td className="py-1.5">{format(new Date(`${wk.weekStart}T12:00:00`), "d 'de' MMM", { locale: es })}</td>
                                            <td className="py-1.5 text-right text-[var(--color-text-muted)]">{h2(wk.pacted)}</td>
                                            <td className="py-1.5 text-right font-medium">{h2(wk.worked)}</td>
                                            <td className={cn('py-1.5 text-right', wk.overtime > 0 && 'text-amber-400')}>{h2(wk.overtime)}</td>
                                            <td className={cn('py-1.5 text-right', wk.deficit > 0 && 'text-[var(--color-text-muted)]')}>{h2(wk.deficit)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Detalle día por día con folios */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm min-w-[720px]">
                            <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)] text-xs uppercase text-[var(--color-text-muted)]">
                                <tr>
                                    <th className="px-5 py-2.5">Fecha</th>
                                    <th className="px-5 py-2.5">Marcas del día</th>
                                    <th className="px-5 py-2.5 text-right">Horas</th>
                                    <th className="px-5 py-2.5">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--glass-border)]">
                                {w.days.map(d => (
                                    <tr key={d.date} className="hover:bg-[var(--glass-bg)] transition-colors align-top">
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            {format(new Date(`${d.date}T12:00:00`), 'dd-MM-yyyy')}
                                            <span className="block text-xs text-[var(--color-text-muted)] capitalize">
                                                {format(new Date(`${d.date}T12:00:00`), 'EEEE', { locale: es })}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {d.records.map(r => (
                                                    <button
                                                        key={r.id}
                                                        onClick={() => setReceipt({ ...r, name: w.name, rut: w.rut })}
                                                        title="Ver comprobante"
                                                        className={cn(
                                                            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors',
                                                            Number(r.is_corrected)
                                                                ? 'border-red-500/30 text-red-400/70 line-through'
                                                                : r.type === 'entry'
                                                                    ? 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                                                                    : 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10',
                                                        )}
                                                    >
                                                        <ReceiptIcon size={11} />
                                                        {r.type === 'entry' ? 'E' : 'S'} {hhmm(r.recorded_at)}
                                                        {r.seq != null && <span className="opacity-60">#{r.seq}</span>}
                                                        {r.source !== 'kiosk' && <span className="opacity-60">({r.source})</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-right font-medium whitespace-nowrap">{h2(d.worked)}</td>
                                        <td className="px-5 py-3 text-xs">
                                            {d.incomplete
                                                ? <span className="text-red-400">Jornada sin cerrar</span>
                                                : <span className="text-[var(--color-text-muted)]">Completa</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {receipt && (
                <AttendanceReceipt
                    receipt={receipt}
                    companyName={companyName}
                    onClose={() => setReceipt(null)}
                />
            )}
        </div>
    );
};

// Hoja imprimible del libro. Se arma como string para abrirla en su propia
// ventana: no pasa por la impresión de boletas.
function buildBookHtml(workers, { companyName, startDate, endDate, chain }) {
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    const styles = [
        '@page { margin: 12mm; }',
        'body { font: 11px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }',
        'h1 { font-size: 16px; margin: 0 0 2px; }',
        'h2 { font-size: 13px; margin: 18px 0 2px; page-break-after: avoid; }',
        '.meta { font-size: 10px; color: #555; margin-bottom: 10px; }',
        '.who { font-size: 10px; color: #444; margin-bottom: 6px; }',
        'table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }',
        'th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: left; }',
        'th { background: #f2f2f2; font-size: 10px; text-transform: uppercase; }',
        'td.num, th.num { text-align: right; }',
        '.void { color: #999; text-decoration: line-through; }',
        '.sign { margin-top: 10px; font-size: 10px; }',
        '.sign span { display: inline-block; border-top: 1px solid #999; width: 220px; margin-top: 26px; padding-top: 3px; }',
        '.worker { page-break-inside: avoid; }',
        '.chain { font-size: 10px; color: #444; margin-bottom: 10px; }',
    ].join('\n');

    const chainLine = chain
        ? (chain.intact
            ? `Integridad verificada: ${chain.checked} marcas, cadena sin alteraciones.`
            : `ATENCIÓN: ${chain.problems.length} inconsistencias detectadas en la cadena de integridad.`)
        : 'Integridad no verificada en esta impresión.';

    const blocks = workers.map(w => {
        const weekRows = w.exemptArt22 ? '' : w.weeks.map(wk => `
            <tr>
              <td>${wk.weekStart}</td>
              <td class="num">${h2(wk.pacted)}</td>
              <td class="num">${h2(wk.worked)}</td>
              <td class="num">${h2(wk.overtime)}</td>
              <td class="num">${h2(wk.deficit)}</td>
            </tr>`).join('');

        const dayRows = w.days.map(d => {
            const marks = d.records.map(r => {
                const label = `${r.type === 'entry' ? 'E' : 'S'} ${hhmm(r.recorded_at)} #${r.seq ?? '-'}`;
                return Number(r.is_corrected)
                    ? `<span class="void">${esc(label)}</span>`
                    : esc(label);
            }).join(' &nbsp; ');
            return `
            <tr>
              <td>${d.date}</td>
              <td>${marks}</td>
              <td class="num">${h2(d.worked)}</td>
              <td>${d.incomplete ? 'Sin cerrar' : 'Completa'}</td>
            </tr>`;
        }).join('');

        return `
        <div class="worker">
          <h2>${esc(w.name)}</h2>
          <div class="who">
            RUT: ${w.rut ? esc(formatRut(w.rut)) : 'no registrado'} &nbsp;|&nbsp;
            ${w.exemptArt22
                ? 'Excluido de limitación de jornada (Art. 22 inc. 2° del Código del Trabajo)'
                : `Jornada pactada: ${w.pacted} horas semanales`}
            &nbsp;|&nbsp; Total del período: ${h2(w.totalWorked)} h
          </div>
          ${weekRows ? `<table>
            <thead><tr><th>Semana desde</th><th class="num">Pactadas</th><th class="num">Trabajadas</th><th class="num">Extraordinarias</th><th class="num">Déficit</th></tr></thead>
            <tbody>${weekRows}</tbody></table>` : ''}
          <table>
            <thead><tr><th>Fecha</th><th>Marcas (E entrada / S salida · #folio)</th><th class="num">Horas</th><th>Estado</th></tr></thead>
            <tbody>${dayRows}</tbody>
          </table>
          <div class="sign"><span>Firma del trabajador</span></div>
        </div>`;
    }).join('');

    return [
        '<!doctype html><html lang="es"><head><meta charset="utf-8">',
        '<title>Libro de Asistencia</title>',
        '<style>' + styles + '</style></head><body>',
        '<h1>LIBRO DE ASISTENCIA</h1>',
        `<div class="meta">${esc(companyName)} &nbsp;|&nbsp; Período: ${startDate} al ${endDate}` +
        ` &nbsp;|&nbsp; Emitido el ${format(new Date(), "dd-MM-yyyy 'a las' HH:mm")}</div>`,
        `<div class="chain">${esc(chainLine)}</div>`,
        blocks,
        '</body></html>',
    ].join('\n');
}

export default AttendanceBook;
