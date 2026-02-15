import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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

            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 text-gray-700 font-medium transition-colors shadow-sm"
            >
                <ArrowLeft className="w-4 h-4" />
                Regresar
            </motion.button>
        </div>
    );
};

export default AccessDenied;
