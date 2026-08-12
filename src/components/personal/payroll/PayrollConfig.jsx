import React, { useState, useEffect } from 'react';
import { useStore } from '../../../store/useStore';
import { Save, Clock, DollarSign, Gift, Calendar, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';

const PayrollConfig = () => {
    const { personalConfig, fetchPersonalConfig, updatePersonalConfig } = useStore();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [form, setForm] = useState({});

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setLoading(true);
        const cfg = await fetchPersonalConfig();
        setForm({
            late_tolerance_minutes: cfg?.late_tolerance_minutes ?? 10,
            late_discount_enabled: cfg?.late_discount_enabled ?? 0,
            late_discount_per_minute: cfg?.late_discount_per_minute ?? 0,
            absence_discount_enabled: cfg?.absence_discount_enabled ?? 1,
            vacation_paid: cfg?.vacation_paid ?? 1,
            medical_paid: cfg?.medical_paid ?? 1,
            permission_paid: cfg?.permission_paid ?? 0,
            bonus_punctuality_enabled: cfg?.bonus_punctuality_enabled ?? 0,
            bonus_punctuality_amount: cfg?.bonus_punctuality_amount ?? 0,
            bonus_attendance_enabled: cfg?.bonus_attendance_enabled ?? 0,
            bonus_attendance_amount: cfg?.bonus_attendance_amount ?? 0,
            working_days_per_month: cfg?.working_days_per_month ?? 30,
            working_hours_per_day: cfg?.working_hours_per_day ?? 8,
            absence_from_missing_attendance: cfg?.absence_from_missing_attendance ?? 0,
        });
        setLoading(false);
    };

    const handleSave = async () => {
        setSaving(true);
        const result = await updatePersonalConfig(form);
        if (result.success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            alert(result.error || 'Error al guardar');
        }
        setSaving(false);
    };

    const toggle = (field) => setForm(f => ({ ...f, [field]: f[field] ? 0 : 1 }));
    const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

    const formatCLP = (v) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(v || 0);

    if (loading) return <div className="text-center p-10 text-[var(--color-text-muted)]">Cargando configuración...</div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-[var(--color-text)]">Configuración de Nómina</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">Define reglas de cálculo para remuneraciones</p>
                </div>
                <button onClick={handleSave} disabled={saving} className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all",
                    saved ? "bg-emerald-500 text-white" : "btn-primary"
                )}>
                    {saved ? <><CheckCircle size={16} /> Guardado</> : <><Save size={16} /> Guardar</>}
                </button>
            </div>

            {/* Jornada */}
            <section className="glass-card p-5 space-y-4">
                <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2"><Calendar size={18} /> Jornada Laboral</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1 block">Días laborales por mes</label>
                        <input type="number" className="glass-input w-full" value={form.working_days_per_month}
                            onChange={e => set('working_days_per_month', parseInt(e.target.value) || 30)} min={1} max={31} />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1 block">Horas por jornada</label>
                        <input type="number" className="glass-input w-full" value={form.working_hours_per_day}
                            onChange={e => set('working_hours_per_day', parseFloat(e.target.value) || 8)} min={1} max={24} step={0.5} />
                    </div>
                </div>
            </section>

            {/* Atrasos */}
            <section className="glass-card p-5 space-y-4">
                <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2"><Clock size={18} /> Atrasos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1 block">Tolerancia (minutos)</label>
                        <input type="number" className="glass-input w-full" value={form.late_tolerance_minutes}
                            onChange={e => set('late_tolerance_minutes', parseInt(e.target.value) || 0)} min={0} />
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Minutos de gracia antes de marcar atraso</p>
                    </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                    <div>
                        <p className="text-sm font-medium text-[var(--color-text)]">Descuento por atraso</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">Descontar automáticamente por minutos de atraso</p>
                    </div>
                    <button onClick={() => toggle('late_discount_enabled')} className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        form.late_discount_enabled ? "bg-cyan-500" : "bg-gray-600"
                    )}>
                        <div className={cn("w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all", form.late_discount_enabled ? "left-6" : "left-0.5")} />
                    </button>
                </div>
                {form.late_discount_enabled ? (
                    <div>
                        <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1 block">Descuento por minuto de atraso ($)</label>
                        <input type="number" className="glass-input w-full md:w-48" value={form.late_discount_per_minute}
                            onChange={e => set('late_discount_per_minute', parseFloat(e.target.value) || 0)} min={0} step={100} />
                    </div>
                ) : null}
            </section>

            {/* Faltas */}
            <section className="glass-card p-5 space-y-4">
                <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2"><AlertCircle size={18} /> Faltas y Ausencias</h3>
                <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                    <div>
                        <p className="text-sm font-medium text-[var(--color-text)]">Descontar faltas injustificadas</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">Descuenta 1 día de sueldo por cada falta sin justificación</p>
                    </div>
                    <button onClick={() => toggle('absence_discount_enabled')} className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        form.absence_discount_enabled ? "bg-cyan-500" : "bg-gray-600"
                    )}>
                        <div className={cn("w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all", form.absence_discount_enabled ? "left-6" : "left-0.5")} />
                    </button>
                </div>

                {/* Solo sirve si la empresa usa el kiosco. Con esto encendido y sin
                    marcas, se descuenta a todos por todos los días. */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                    <div className="pr-3">
                        <p className="text-sm font-medium text-[var(--color-text)]">Contar día sin marca como falta</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                            Un día con turno y sin marca de entrada se toma como inasistencia.
                            <strong className="text-amber-400"> Activalo solo si usás el control de asistencia</strong>, o
                            se le descontará a todos por días que sí trabajaron.
                        </p>
                    </div>
                    <button onClick={() => toggle('absence_from_missing_attendance')} className={cn(
                        "w-12 h-6 rounded-full transition-all relative shrink-0",
                        form.absence_from_missing_attendance ? "bg-cyan-500" : "bg-gray-600"
                    )}>
                        <div className={cn("w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all", form.absence_from_missing_attendance ? "left-6" : "left-0.5")} />
                    </button>
                </div>

                <h4 className="text-xs font-bold text-[var(--color-text-muted)] uppercase mt-2">¿Qué ausencias se pagan?</h4>
                {[
                    { field: 'vacation_paid', label: 'Vacaciones', emoji: '🟣', desc: 'Pagar días de vacaciones como día trabajado' },
                    { field: 'medical_paid', label: 'Licencia Médica', emoji: '🔴', desc: 'Pagar días de licencia médica' },
                    { field: 'permission_paid', label: 'Permisos', emoji: '🟡', desc: 'Pagar permisos personales autorizados' },
                ].map(item => (
                    <div key={item.field} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                        <div className="flex items-center gap-3">
                            <span className="text-lg">{item.emoji}</span>
                            <div>
                                <p className="text-sm font-medium text-[var(--color-text)]">{item.label}</p>
                                <p className="text-[11px] text-[var(--color-text-muted)]">{item.desc}</p>
                            </div>
                        </div>
                        <button onClick={() => toggle(item.field)} className={cn(
                            "w-12 h-6 rounded-full transition-all relative",
                            form[item.field] ? "bg-cyan-500" : "bg-gray-600"
                        )}>
                            <div className={cn("w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all", form[item.field] ? "left-6" : "left-0.5")} />
                        </button>
                    </div>
                ))}
            </section>

            {/* Bonos Automáticos */}
            <section className="glass-card p-5 space-y-4">
                <h3 className="font-bold text-[var(--color-text)] flex items-center gap-2"><Gift size={18} /> Bonos Automáticos</h3>

                {[
                    { enabledField: 'bonus_punctuality_enabled', amountField: 'bonus_punctuality_amount', label: 'Bono Puntualidad', emoji: '🎯', desc: 'Se otorga si el empleado no tuvo ningún atraso en el periodo' },
                    { enabledField: 'bonus_attendance_enabled', amountField: 'bonus_attendance_amount', label: 'Bono Asistencia Completa', emoji: '📈', desc: 'Se otorga si el empleado no tuvo faltas injustificadas en el periodo' },
                ].map(item => (
                    <div key={item.enabledField} className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--glass-border)]">
                            <div className="flex items-center gap-3">
                                <span className="text-lg">{item.emoji}</span>
                                <div>
                                    <p className="text-sm font-medium text-[var(--color-text)]">{item.label}</p>
                                    <p className="text-[11px] text-[var(--color-text-muted)]">{item.desc}</p>
                                </div>
                            </div>
                            <button onClick={() => toggle(item.enabledField)} className={cn(
                                "w-12 h-6 rounded-full transition-all relative",
                                form[item.enabledField] ? "bg-cyan-500" : "bg-gray-600"
                            )}>
                                <div className={cn("w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all", form[item.enabledField] ? "left-6" : "left-0.5")} />
                            </button>
                        </div>
                        {form[item.enabledField] ? (
                            <div className="ml-12">
                                <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase mb-1 block">Monto del bono ($)</label>
                                <input type="number" className="glass-input w-full md:w-48" value={form[item.amountField]}
                                    onChange={e => set(item.amountField, parseFloat(e.target.value) || 0)} min={0} step={1000} />
                            </div>
                        ) : null}
                    </div>
                ))}
            </section>
        </div>
    );
};

export default PayrollConfig;
