import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';

const AccessDenied = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-in fade-in duration-500">
            <div className="bg-red-50 p-4 rounded-full mb-6">
                <Lock className="w-16 h-16 text-red-500" />
            </div>

            <h1 className="text-3xl font-bold text-gray-900 mb-2">Acceso Denegado</h1>
            <p className="text-gray-500 max-w-md mb-8">
                No tienes los permisos necesarios para ver esta página.
                Si crees que es un error, contacta a tu administrador.
            </p>

            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 hover:scale-105 active:scale-95 text-gray-700 font-medium transition-all duration-200 shadow-sm"
            >
                <ArrowLeft className="w-4 h-4" />
                Regresar
            </button>
        </div>
    );
};

export default AccessDenied;
