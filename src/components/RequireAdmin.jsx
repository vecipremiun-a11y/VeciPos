import React from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

const RequireAdmin = ({ children }) => {
    const { currentUser, isLoading } = useStore();

    if (isLoading && !currentUser) {
        return <div className="p-10 text-center text-white">Verificando permisos...</div>;
    }

    if (!currentUser || currentUser.role !== 'super_admin') {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
};

export default RequireAdmin;
