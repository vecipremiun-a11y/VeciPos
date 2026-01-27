import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { LogOut, LayoutDashboard, Building2, ArrowLeft } from 'lucide-react';

const AdminLayout = () => {
    const { logout, currentUser } = useStore();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const isActive = (path) => location.pathname === path;

    return (
        <div className="flex h-screen bg-[#09090b] text-white overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 bg-[#18181b] border-r border-white/10 flex flex-col">
                <div className="p-6 border-b border-white/10">
                    <h1 className="text-xl font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                        POS Admin PO
                    </h1>
                    <p className="text-xs text-gray-500 mt-1">Super Admin Panel</p>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <Link
                        to="/admin"
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/admin')
                                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                            }`}
                    >
                        <LayoutDashboard size={20} />
                        <span>Dashboard</span>
                    </Link>

                    <Link
                        to="/admin/companies"
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/admin/companies')
                                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                            }`}
                    >
                        <Building2 size={20} />
                        <span>Empresas</span>
                    </Link>
                </nav>

                <div className="p-4 border-t border-white/10 space-y-2">
                    <Link
                        to="/dashboard"
                        className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-white/5 hover:text-white transition-all"
                    >
                        <ArrowLeft size={20} />
                        <span>Volver al POS</span>
                    </Link>

                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-all"
                    >
                        <LogOut size={20} />
                        <span>Cerrar Sesión</span>
                    </button>

                    <div className="px-4 py-2 mt-2">
                        <div className="text-xs text-gray-600">Conectado como</div>
                        <div className="text-sm font-medium text-gray-300 truncate">{currentUser?.name}</div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-[#09090b]">
                <Outlet />
            </main>
        </div>
    );
};

export default AdminLayout;
