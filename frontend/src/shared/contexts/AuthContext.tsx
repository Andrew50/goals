import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { publicRequest, privateRequest, updateRoutines } from "../utils/api";

interface SigninResponse {
    token: string;
    message: string;
}

interface AuthContextType {
    isAuthenticated: boolean;
    username: string | null;
    setIsAuthenticated: (value: boolean) => void;
    scheduleRoutineUpdate: () => void;
    login: (username: string, password: string) => Promise<string>;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    username: null,
    setIsAuthenticated: () => { },
    scheduleRoutineUpdate: () => { },
    login: async () => '',
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

        console.log(`Scheduling next routine update for ${endOfDay.toLocaleString()}`);

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

    // Check and reschedule on mount if needed
    useEffect(() => {
        if (isAuthenticated) {
            const nextUpdate = localStorage.getItem('nextRoutineUpdate');
            if (!nextUpdate || new Date().getTime() > parseInt(nextUpdate)) {
                const endOfDay = new Date();
                endOfDay.setHours(23, 59, 59, 999);
                console.log(`Catching up missed routine update for ${endOfDay.toLocaleString()}`);
                privateRequest(
                    `routine/${endOfDay.getTime()}`,
                    'POST'
                )
                    .then(() => console.log('Catch-up routine update completed successfully'))
                    .catch(error => console.error('Failed to update routines:', error));
            }
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

        // First store the token
        localStorage.setItem("authToken", response.token);
        localStorage.setItem("username", username);
        setUsername(username);

        // Then set auth state
        setIsAuthenticated(true);

        // Wait for next tick to ensure auth state is updated
        await new Promise(resolve => setTimeout(resolve, 0));

        try {
            await updateRoutines();
            scheduleRoutineUpdate();
        } catch (routineErr) {
            console.error("Failed to update routines:", routineErr);
            // Don't throw the error as it's not critical for login
        }

        return response.message;
    }, [scheduleRoutineUpdate]);

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            username,
            setIsAuthenticated,
            scheduleRoutineUpdate,
            login,
            logout
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext); 