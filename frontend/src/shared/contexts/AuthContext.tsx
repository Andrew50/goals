import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onForceLogout } from '../utils/authEvents';
import { publicRequest, refreshAccessToken, setAccessToken, updateRoutines } from "../utils/api";
 // test auth token expiration functio0nality by running:
 /*
 localStorage.removeItem('authToken'); 
 localStorage.setItem('testMode','false');
 */
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
    authReady: boolean;
    username: string | null;
    token: string | null;
    setIsAuthenticated: (value: boolean) => void;
    scheduleRoutineUpdate: () => void;
    login: (username: string, password: string) => Promise<string>;
    googleLogin: () => Promise<string>;
    handleGoogleCallback: (code: string, state: string) => Promise<string>;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    authReady: true,
    username: null,
    token: null,
    setIsAuthenticated: () => { },
    scheduleRoutineUpdate: () => { },
    login: async () => '',
    googleLogin: async () => '',
    handleGoogleCallback: async () => '',
    logout: () => { },
});

function isTestMode(): boolean {
    try {
        return localStorage.getItem('testMode') === 'true';
    } catch {
        return false;
    }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => isTestMode());
    const [authReady, setAuthReady] = useState<boolean>(() => isTestMode());
    const [username, setUsername] = useState<string | null>(() => (
        isTestMode() ? localStorage.getItem('username') : null
    ));
    const [token, setToken] = useState<string | null>(() => (
        isTestMode() ? localStorage.getItem('authToken') : null
    ));

    const logout = useCallback(() => {
        publicRequest('auth/logout', 'GET').catch(() => { });
        setAccessToken(null);
        localStorage.removeItem('authToken');
        localStorage.removeItem('routineUpdateTimeout');
        localStorage.removeItem('nextRoutineUpdate');
        localStorage.removeItem('username');
        setToken(null);
        setUsername(null);
        setIsAuthenticated(false);
        setAuthReady(true);
    }, []);

    const applySession = useCallback((accessToken: string, nextUsername?: string | null) => {
        setAccessToken(accessToken);
        setToken(accessToken);
        if (nextUsername) {
            setUsername(nextUsername);
            try {
                localStorage.setItem('username', nextUsername);
            } catch {
                // ignore storage errors
            }
        }
        setIsAuthenticated(true);
    }, []);

    const restoreSession = useCallback(async () => {
        if (isTestMode()) {
            setIsAuthenticated(true);
            const storedUsername = localStorage.getItem('username');
            const storedToken = localStorage.getItem('authToken');
            if (storedUsername) {
                setUsername(storedUsername);
            }
            if (storedToken) {
                setToken(storedToken);
            }
            setAuthReady(true);
            return;
        }

        const refreshed = await refreshAccessToken();
        if (refreshed?.token) {
            applySession(refreshed.token, refreshed.username || null);
        } else {
            setToken(null);
            setUsername(null);
            setIsAuthenticated(false);
        }
        setAuthReady(true);
    }, [applySession]);

    // Restore the session from the refresh cookie before treating the user as signed out.
    useEffect(() => {
        restoreSession();

        const unsubscribe = onForceLogout(() => {
            logout();
        });

        let refocusDebounce: number | undefined;
        const debouncedValidate = () => {
            if (isTestMode()) return;
            if (refocusDebounce) window.clearTimeout(refocusDebounce);
            refocusDebounce = window.setTimeout(() => {
                restoreSession();
            }, 150);
        };

        const onWindowFocus = () => debouncedValidate();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') debouncedValidate();
        };

        window.addEventListener('focus', onWindowFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            unsubscribe();
            window.removeEventListener('focus', onWindowFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (refocusDebounce) window.clearTimeout(refocusDebounce);
        };
    }, [restoreSession, logout]);

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

    const login = useCallback(async (username: string, password: string): Promise<string> => {
        const response = await publicRequest<SigninResponse>(
            'auth/signin',
            'POST',
            { username, password }
        );

        applySession(response.token, response.username || username);

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
    }, [applySession, scheduleRoutineUpdate]);

    const googleLogin = useCallback(async (): Promise<string> => {
        try {
            const authUrlResponse = await publicRequest<GoogleAuthUrlResponse>(
                'auth/google',
                'GET'
            );

            localStorage.setItem('google_oauth_state', authUrlResponse.state);
            localStorage.setItem('google_oauth_purpose', 'login');

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
            const purpose = localStorage.getItem('google_oauth_purpose') || 'login';
            const url = `auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&purpose=${encodeURIComponent(purpose)}`;
            console.log('🌐 [AUTH] Making request to:', url);

            const response = await publicRequest<SigninResponse>(url, 'GET');

            console.log('✅ [AUTH] Successfully received response from backend');
            console.log('📋 [AUTH] Response message:', response.message);
            console.log('👤 [AUTH] Username from response:', response.username);

            const nextUsername = response.username || 'Google User';
            applySession(response.token, nextUsername);

            console.log('✅ [AUTH] Updated local auth state');

            localStorage.removeItem('google_oauth_state');
            localStorage.removeItem('google_oauth_purpose');
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
            localStorage.removeItem('google_oauth_purpose');
            throw new Error(error.message || 'Google login failed');
        }
    }, [applySession, scheduleRoutineUpdate]);

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            authReady,
            username,
            token,
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