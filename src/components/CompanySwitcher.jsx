import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { ChevronDown, Building2, Check, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const CompanySwitcher = () => {
    const { availableCompanies, activeCompanyId, setActiveCompanyId, currentUser } = useStore();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    const currentCompany = availableCompanies.find(c => c.id === activeCompanyId) || { name: 'Empresa', id: 'default' };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSwitch = async (companyId) => {
        if (companyId === activeCompanyId) return;
        setIsOpen(false);
        const res = await setActiveCompanyId(companyId);
        if (!res.success) {
            alert("Error al cambiar empresa: " + res.error);
        }
    };

    const handleCreateLink = () => {
        setIsOpen(false);
        navigate('/admin/companies');
    };

    if (availableCompanies.length <= 1 && currentUser?.role !== 'super_admin') {
        // Just show the name if there's nothing to switch to (and not admin)
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10 text-sm text-gray-300">
                <Building2 size={14} />
                <span className="font-medium truncate max-w-[150px]">{currentCompany.name}</span>
            </div>
        );
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 transition-all text-sm group"
            >
                <div className="p-1 bg-indigo-500/20 rounded-full text-indigo-400">
                    <Building2 size={14} />
                </div>
                <span className="font-medium text-white truncate max-w-[150px]">
                    {currentCompany.name}
                </span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-[#18181b] border border-white/10 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2 border-b border-white/5">
                        <span className="text-xs text-gray-500 font-medium px-2">Cambiar Empresa</span>
                    </div>

                    <div className="max-h-60 overflow-y-auto p-1">
                        {availableCompanies.map((company) => (
                            <button
                                key={company.id}
                                onClick={() => handleSwitch(company.id)}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${company.id === activeCompanyId
                                        ? 'bg-indigo-500/10 text-indigo-400'
                                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                                    }`}
                            >
                                <div className="flex flex-col items-start truncate">
                                    <span className="font-medium truncate w-full text-left">{company.name}</span>
                                    {company.role && <span className="text-[10px] opacity-60 uppercase">{company.role}</span>}
                                </div>
                                {company.id === activeCompanyId && <Check size={14} />}
                            </button>
                        ))}
                    </div>

                    {currentUser?.role === 'super_admin' && (
                        <div className="p-1 border-t border-white/5">
                            <button
                                onClick={handleCreateLink}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-green-400 hover:bg-green-500/10 transition-colors"
                            >
                                <Plus size={14} />
                                <span>Crear Nueva Empresa</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CompanySwitcher;
