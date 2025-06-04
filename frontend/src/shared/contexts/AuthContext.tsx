import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { publicRequest, privateRequest, updateRoutines } from "../utils/api";

interface SigninResponse {
    token: string;
    message: string;
    username?: string;
}

interface GoogleAuthUrlResponse {
    auth_url: string;
    state: string;
}

interface AuthContextType {
    isAuthenticated: boolean;
    username: string | null;
    token: string | null;
    setIsAuthenticated: (value: boolean) => void;
    scheduleRoutineUpdate: () => void;
    login: (username: string, password: string) => Promise<string>;
    googleLogin: (googleToken: string) => Promise<string>;
    handleGoogleCallback: (code: string, state: string) => Promise<string>;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    username: null,
    token: null,
    setIsAuthenticated: () => { },
    scheduleRoutineUpdate: () => { },
    login: async () => '',
    googleLogin: async () => '',
    handleGoogleCallback: async () => '',
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

    const googleLogin = useCallback(async (googleToken: string): Promise<string> => {
        // For our backend OAuth flow, we need to:
        // 1. Get the auth URL from our backend
        // 2. Redirect user to Google
        // 3. Handle the callback from our backend

        try {
            // Get Google OAuth URL from our backend
            const authUrlResponse = await publicRequest<GoogleAuthUrlResponse>(
                'auth/google',
                'GET'
            );

            // Store the state for verification
            localStorage.setItem('google_oauth_state', authUrlResponse.state);

            // Redirect to Google OAuth
            window.location.href = authUrlResponse.auth_url;

            // This function won't return normally as we're redirecting
            return 'Redirecting to Google...';
        } catch (error: any) {
            console.error('Google OAuth initiation failed:', error);
            throw new Error(error.message || 'Failed to initiate Google login');
        }
    }, []);

    // Add a method to handle the OAuth callback
    const handleGoogleCallback = useCallback(async (code: string, state: string): Promise<string> => {
        console.log('🔄 [AUTH] Starting Google OAuth callback processing...');
        console.log('📄 [AUTH] Received code:', code?.substring(0, 50) + '...');
        console.log('🔑 [AUTH] Received state:', state);

        try {
            // Verify state matches what we stored
            const storedState = localStorage.getItem('google_oauth_state');
            console.log('🔍 [AUTH] Stored state:', storedState);
            console.log('🔍 [AUTH] Received state:', state);

            if (state !== storedState) {
                console.error('❌ [AUTH] State mismatch! Stored:', storedState, 'Received:', state);
                throw new Error('Invalid state parameter');
            }

            console.log('✅ [AUTH] State verification passed');

            // Exchange code for token with our backend
            const url = `auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
            console.log('🌐 [AUTH] Making request to:', url);

            const response = await publicRequest<SigninResponse>(url, 'GET');

            console.log('✅ [AUTH] Successfully received response from backend');
            console.log('📋 [AUTH] Response message:', response.message);
            console.log('👤 [AUTH] Username from response:', response.username);

            // Store token and update auth state
            localStorage.setItem('authToken', response.token);

            // Extract username from the response
            const username = response.username || 'Google User';
            localStorage.setItem('username', username);

            setUsername(username);
            setIsAuthenticated(true);

            console.log('✅ [AUTH] Updated local auth state');

            // Clean up OAuth state
            localStorage.removeItem('google_oauth_state');
            console.log('🧹 [AUTH] Cleaned up OAuth state');

            // Update routines
            try {
                console.log('🔄 [AUTH] Updating routines...');
                await updateRoutines();
                console.log('✅ [AUTH] Routines updated successfully');
            } catch (error) {
                console.error('❌ [AUTH] Failed to update routines on Google login:', error);
            }

            scheduleRoutineUpdate();
            console.log('⏰ [AUTH] Scheduled routine update');

            console.log('🎉 [AUTH] Google OAuth callback completed successfully');
            return response.message;
        } catch (error: any) {
            console.error('❌ [AUTH] Google OAuth callback failed:', error);
            console.error('❌ [AUTH] Error details:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status,
                statusText: error.response?.statusText
            });

            localStorage.removeItem('google_oauth_state');
            throw new Error(error.message || 'Google login failed');
        }
    }, [scheduleRoutineUpdate]);

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            username,
            token: getToken(),
            setIsAuthenticated,
            scheduleRoutineUpdate,
            login,
            googleLogin,
            handleGoogleCallback,
            logout
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext); 