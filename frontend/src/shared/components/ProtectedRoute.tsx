import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../shared/contexts/AuthContext';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const location = useLocation();

    if (!isAuthenticated) {
        return <Navigate to="/signin" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute; 