import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children }) => {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="vscode-boot">
                <div className="vscode-boot-spinner" />
                <span>Loading Code Sync…</span>
            </div>
        );
    }
    if (!user) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
    return children;
};

export default ProtectedRoute;
