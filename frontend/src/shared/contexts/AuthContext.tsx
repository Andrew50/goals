import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { publicRequest, privateRequest, updateRoutines } from "../utils/api";

interface SigninResponse {
    token: string;
    message: string;
}

interface AuthContextType {
    isAuthenticated: boolean;
    username: string | null;
    token: string | null;
    setIsAuthenticated: (value: boolean) => void;
    scheduleRoutineUpdate: () => void;
    login: (username: string, password: string) => Promise<string>;
    loginWithGoogle: (credential: string) => Promise<string>;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    username: null,
    token: null,
    setIsAuthenticated: () => { },
    scheduleRoutineUpdate: () => { },
    login: async () => '',
    loginWithGoogle: async () => '',
    logout: () => { },
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Initialize from localStorage first
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
        return !!localStorage.getItem('authToken');
    });

    // Add username state
    const [username, setUsername] = useState<string | null>(() => {
        return localStorage.getItem('username');
    });

    // Add token getter function
    const getToken = (): string | null => {
        return localStorage.getItem('authToken');
    };

    // Function to validate token and update auth state if invalid
    const validateAndUpdateAuthState = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            setIsAuthenticated(false);
            return;
        }

        try {
            // Try to make a request to validate the token using privateRequest
            await privateRequest('auth/validate', 'GET');
            // Token is valid, we're already authenticated
        } catch (error) {
            console.error('Token validation failed:', error);
            localStorage.removeItem('authToken');
            localStorage.removeItem('routineUpdateTimeout');
            localStorage.removeItem('nextRoutineUpdate');
            localStorage.removeItem('username');
            setIsAuthenticated(false);
            setUsername(null);
        }
    }, []);

    // Validate token on mount
    useEffect(() => {
        validateAndUpdateAuthState();
    }, [validateAndUpdateAuthState]);

    const scheduleRoutineUpdate = useCallback(() => {
        // Clear any existing timeout
        const existingTimeoutId = localStorage.getItem('routineUpdateTimeout');
        if (existingTimeoutId) {
            window.clearTimeout(parseInt(existingTimeoutId));
        }

        // Calculate time until next update (end of day)
        const now = new Date();
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        const msUntilEndOfDay = endOfDay.getTime() - now.getTime();

        //console.log(`Scheduling next routine update for ${endOfDay.toLocaleString()}`);

        const timeoutId = window.setTimeout(async () => {
            try {
                await updateRoutines();
                scheduleRoutineUpdate();
            } catch (error) {
                console.error('Failed to update routines:', error);
            }
            localStorage.removeItem('routineUpdateTimeout');
        }, msUntilEndOfDay);

        // Store the timeout ID
        localStorage.setItem('routineUpdateTimeout', timeoutId.toString());
        localStorage.setItem('nextRoutineUpdate', endOfDay.getTime().toString());
    }, []);

    // Modify this useEffect to only handle scheduling, not immediate updates
    useEffect(() => {
        if (isAuthenticated) {
            scheduleRoutineUpdate();
        }
    }, [isAuthenticated, scheduleRoutineUpdate]);

    const logout = useCallback(() => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('routineUpdateTimeout');
        localStorage.removeItem('nextRoutineUpdate');
        localStorage.removeItem('username');
        setUsername(null);
        setIsAuthenticated(false);
    }, []);

    const login = useCallback(async (username: string, password: string): Promise<string> => {
        const response = await publicRequest<SigninResponse>(
            'auth/signin',
            'POST',
            { username, password }
        );

        try {
            localStorage?.setItem("authToken", response.token);
            localStorage?.setItem("username", username);
        } catch (error) {
            console.warn('Could not access localStorage during login:', error);
        }

        setUsername(username);
        setIsAuthenticated(true);

        // Immediately update routines on login
        try {
            await updateRoutines();
            //console.log('Initial routine update completed successfully');
        } catch (error) {
            console.error('Failed to update routines on login:', error);
        }

        // Then schedule the next update
        scheduleRoutineUpdate();

        return response.message;
    }, [scheduleRoutineUpdate]);

    const loginWithGoogle = useCallback(async (credential: string): Promise<string> => {
        const response = await publicRequest<SigninResponse>(
            'auth/google',
            'POST',
            { token: credential }
        );

        try {
            localStorage?.setItem('authToken', response.token);
            const payload = JSON.parse(atob(response.token.split('.')[1]));
            const usernameFromToken = payload.username;
            if (usernameFromToken) {
                localStorage?.setItem('username', usernameFromToken);
                setUsername(usernameFromToken);
            }
        } catch (error) {
            console.warn('Could not process token from Google login:', error);
        }

        setIsAuthenticated(true);

        try {
            await updateRoutines();
        } catch (error) {
            console.error('Failed to update routines on login:', error);
        }

        scheduleRoutineUpdate();

        return response.message;
    }, [scheduleRoutineUpdate]);

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            username,
            token: getToken(),
            setIsAuthenticated,
            scheduleRoutineUpdate,
            login,
            loginWithGoogle,
            logout
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
