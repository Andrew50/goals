import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { publicRequest, updateRoutines } from "../utils/api";

interface SigninResponse {
    token: string;
    message: string;
}

interface AuthContextType {
    isAuthenticated: boolean;
    setIsAuthenticated: (value: boolean) => void;
    scheduleRoutineUpdate: () => void;
    login: (username: string, password: string) => Promise<string>;
}

export const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    setIsAuthenticated: () => { },
    scheduleRoutineUpdate: () => { },
    login: async () => '',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
        return !!localStorage.getItem('authToken');
    });

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
                publicRequest(
                    `routine/${endOfDay.getTime()}`,
                    'POST'
                )
                    .then(() => console.log('Catch-up routine update completed successfully'))
                    .catch(error => console.error('Failed to update routines:', error));
            }
            scheduleRoutineUpdate();
        }
    }, [isAuthenticated, scheduleRoutineUpdate]);

    const login = useCallback(async (username: string, password: string): Promise<string> => {
        const response = await publicRequest<SigninResponse>(
            'auth/signin',
            'POST',
            { username, password }
        );

        localStorage.setItem("authToken", response.token);
        setIsAuthenticated(true);

        try {
            await updateRoutines();
            scheduleRoutineUpdate();
        } catch (routineErr) {
            console.error("Failed to update routines:", routineErr);
        }

        return response.message;
    }, [scheduleRoutineUpdate]);

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            setIsAuthenticated,
            scheduleRoutineUpdate,
            login
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext); 