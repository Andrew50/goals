import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/contexts/AuthContext';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { isAuthenticated, authReady } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (!authReady || isAuthenticated) {
            return;
        }
        navigate('/signin', {
            state: { from: location.pathname },
            replace: true
        });
    }, [authReady, isAuthenticated, location, navigate]);

    if (!authReady || !isAuthenticated) {
        return null;
    }

    return <>{children}</>;
};

export default ProtectedRoute; 