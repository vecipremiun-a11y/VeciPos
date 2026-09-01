import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Clock, Calendar, DollarSign, FileText, Umbrella, CheckSquare, Maximize2, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

import DailyPanel from '../components/personal/attendance/DailyPanel';
import KioskView from '../components/personal/attendance/KioskView';
import AttendanceTable from '../components/personal/attendance/AttendanceTable';
import AttendanceBook from '../components/personal/attendance/AttendanceBook';
import CorrectionsInbox from '../components/personal/corrections/CorrectionsInbox';
import ShiftCalendar from '../components/personal/shifts/ShiftCalendar';
import AbsencesList from '../components/personal/absences/AbsencesList';
import PayrollDashboard from '../components/personal/payroll/PayrollDashboard';
import VacationRequests from '../components/personal/vacations/VacationRequests';
import VacationBalances from '../components/personal/vacations/VacationBalances';
import ReportsDashboard from '../components/personal/reports/ReportsDashboard';
import PayrollConfig from '../components/personal/payroll/PayrollConfig'; // Import new component

const Personal = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('attendance');
    const [attendanceSubTab, setAttendanceSubTab] = useState('daily');
    const [vacationSubTab, setVacationSubTab] = useState('requests');

    const tabs = [
        { id: 'attendance', label: 'Asistencia', icon: Clock },
        { id: 'corrections', label: 'Correcciones', icon: CheckSquare },
        { id: 'shifts', label: 'Turnos', icon: Calendar },
        { id: 'absences', label: 'Ausencias', icon: FileText },
        { id: 'payroll', label: 'Pagos', icon: DollarSign },
        { id: 'vacations', label: 'Vacaciones', icon: Umbrella },
{ id: 'reports', label: 'Reportes', icon: FileText },
          { id: 'config', label: 'Configuración', icon: Settings }
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-[var(--color-text)]">Gestión de Personal</h1>
                <p className="text-[var(--color-text-muted)]">Administra asistencia, turnos y pagos.</p>
            </div>

            {/* Tabs Navigation */}
            <div className="flex overflow-x-auto border-b border-[var(--glass-border)] no-scrollbar">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "flex items-center gap-2 px-6 py-3 border-b-2 transition-colors whitespace-nowrap",
                            activeTab === tab.id
                                ? "border-[var(--color-primary)] text-[var(--color-primary)] font-medium"
                                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--glass-border)]"
                        )}
                    >
                        <tab.icon size={18} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="min-h-[500px] animate-in fade-in duration-300">
                {activeTab === 'attendance' && (
                    <div className="space-y-6">
                        <div className="flex gap-1 p-1 bg-[var(--color-surface)] rounded-xl w-fit border border-[var(--glass-border)]">
                            <button onClick={() => setAttendanceSubTab('daily')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", attendanceSubTab === 'daily' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>Panel del Día</button>
                            <button onClick={() => setAttendanceSubTab('kiosk')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", attendanceSubTab === 'kiosk' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>Modo Kiosco</button>
                            <button onClick={() => setAttendanceSubTab('history')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", attendanceSubTab === 'history' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>Historial</button>
                            <button onClick={() => setAttendanceSubTab('book')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", attendanceSubTab === 'book' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>Libro de Asistencia</button>
                        </div>

                        {attendanceSubTab === 'daily' && <DailyPanel />}
                        {attendanceSubTab === 'kiosk' && (
                            <div className="space-y-4">
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => navigate('/kiosk/asistencia')}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
                                    >
                                        <Maximize2 size={16} />
                                        Abrir en pantalla completa
                                    </button>
                                </div>
                                <KioskView />
                            </div>
                        )}
                        {attendanceSubTab === 'history' && <AttendanceTable />}
                        {attendanceSubTab === 'book' && <AttendanceBook />}
                    </div>
                )}

                {activeTab === 'corrections' && <CorrectionsInbox />}
                {activeTab === 'shifts' && <ShiftCalendar />}
                {activeTab === 'absences' && <AbsencesList />}
                {activeTab === 'payroll' && <PayrollDashboard />}

                {activeTab === 'vacations' && (
                    <div className="space-y-6">
                        <div className="flex gap-1 p-1 bg-[var(--color-surface)] rounded-xl w-fit border border-[var(--glass-border)]">
                            <button onClick={() => setVacationSubTab('requests')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", vacationSubTab === 'requests' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>Solicitudes</button>
                            <button onClick={() => setVacationSubTab('balances')} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", vacationSubTab === 'balances' ? "bg-[var(--glass-bg)] shadow-sm text-[var(--color-text)] border border-[var(--glass-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")}>Saldos</button>
                        </div>
                        {vacationSubTab === 'requests' && <VacationRequests />}
                        {vacationSubTab === 'balances' && <VacationBalances />}
                    </div>
                )}

                {activeTab === 'reports' && <ReportsDashboard />}
                {activeTab === 'config' && <PayrollConfig />}
            </div>
        </div>
    );
};

export default Personal;
