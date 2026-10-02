import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { publicRequest, refreshAccessToken, updateRoutines } from '../utils/api';

jest.mock('../utils/api', () => ({
    publicRequest: jest.fn(),
    refreshAccessToken: jest.fn(),
    setAccessToken: jest.fn(),
    updateRoutines: jest.fn(),
}));

const authRef: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
    const auth = useAuth();
    authRef.current = auth;
    return (
        <div>
            <span>{auth.authReady ? 'ready' : 'pending'}</span>
            <span>{auth.isAuthenticated ? 'in' : 'out'}</span>
            <span>{auth.username || 'none'}</span>
            <span>{auth.token || 'no-token'}</span>
            <button type="button" onClick={() => auth.login('ada', 'secret')}>login</button>
            <button type="button" onClick={() => auth.logout()}>logout</button>
            <button type="button" onClick={() => auth.googleLogin()}>google</button>
            <button type="button" onClick={() => auth.handleGoogleCallback('code-value', 'state-value')}>callback</button>
            <button type="button" onClick={() => auth.scheduleRoutineUpdate()}>schedule</button>
            <button type="button" onClick={() => auth.setIsAuthenticated(true)}>mark-in</button>
        </div>
    );
}

describe('AuthContext', () => {
    beforeEach(() => {
        localStorage.clear();
        (publicRequest as jest.Mock).mockResolvedValue({
            token: 'session',
            message: 'welcome',
            username: 'ada',
            auth_url: 'https://accounts.example/auth',
            state: 'state-value',
        });
        (refreshAccessToken as jest.Mock).mockResolvedValue(null);
        (updateRoutines as jest.Mock).mockResolvedValue(undefined);
    });

    test('restores a test-mode session from storage', async () => {
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('username', 'stored-user');
        localStorage.setItem('authToken', 'stored-token');
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
        expect(screen.getByText('in')).toBeInTheDocument();
        expect(screen.getByText('stored-user')).toBeInTheDocument();
        expect(screen.getByText('stored-token')).toBeInTheDocument();
        expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    test('applies a refreshed session and clears it when refresh fails', async () => {
        (refreshAccessToken as jest.Mock).mockResolvedValueOnce({ token: 'fresh', username: 'ada' });
        const { unmount } = render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await waitFor(() => expect(screen.getByText('fresh')).toBeInTheDocument());
        expect(screen.getByText('ada')).toBeInTheDocument();
        expect(localStorage.getItem('username')).toBe('ada');
        unmount();

        (refreshAccessToken as jest.Mock).mockResolvedValue(null);
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await waitFor(() => expect(screen.getAllByText('out').length).toBeGreaterThan(0));
    });

    test('logs in, survives a routine update failure, and logs out', async () => {
        (updateRoutines as jest.Mock).mockRejectedValueOnce(new Error('routines'));
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await screen.findByText('ready');
        fireEvent.click(screen.getByRole('button', { name: 'login' }));
        await waitFor(() => expect(screen.getByText('in')).toBeInTheDocument());
        expect(screen.getByText('ada')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'logout' }));
        await waitFor(() => expect(screen.getByText('out')).toBeInTheDocument());
        expect(publicRequest).toHaveBeenCalledWith('auth/logout', 'GET');
    });

    test('logs out when a force-logout event fires and when the window refocuses', async () => {
        jest.useFakeTimers();
        (refreshAccessToken as jest.Mock).mockResolvedValue({ token: 'fresh', username: 'ada' });
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await act(async () => {
            await Promise.resolve();
        });
        const callsBefore = (refreshAccessToken as jest.Mock).mock.calls.length;
        window.dispatchEvent(new Event('app:force-logout'));
        fireEvent(window, new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await act(async () => {
            jest.advanceTimersByTime(200);
        });
        expect((refreshAccessToken as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
        jest.useRealTimers();
    });

    test('starts Google login and handles the callback', async () => {
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await screen.findByText('ready');
        await authRef.current!.googleLogin();
        expect(localStorage.getItem('google_oauth_state')).toBe('state-value');

        localStorage.setItem('google_oauth_state', 'other');
        await expect(authRef.current!.handleGoogleCallback('code-value', 'state-value')).rejects.toThrow(
            'Invalid state parameter'
        );

        localStorage.setItem('google_oauth_state', 'state-value');
        localStorage.setItem('google_oauth_purpose', 'login');
        (updateRoutines as jest.Mock).mockRejectedValueOnce(new Error('routines'));
        await expect(authRef.current!.handleGoogleCallback('code-value', 'state-value')).resolves.toBe('welcome');
        await waitFor(() => expect(screen.getByText('session')).toBeInTheDocument());
        expect(localStorage.getItem('google_oauth_state')).toBeNull();
    });

    test('reports Google login and callback failures', async () => {
        (publicRequest as jest.Mock).mockRejectedValueOnce(new Error('oauth down'));
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await screen.findByText('ready');
        await expect(authRef.current!.googleLogin()).rejects.toThrow('oauth down');

        localStorage.setItem('google_oauth_state', 'state-value');
        (publicRequest as jest.Mock).mockRejectedValueOnce(new Error('callback down'));
        await expect(authRef.current!.handleGoogleCallback('code-value', 'state-value')).rejects.toThrow(
            'callback down'
        );
        expect(localStorage.getItem('google_oauth_state')).toBeNull();
    });

    test('schedules the end-of-day routine update and retries after a failure', async () => {
        jest.useFakeTimers();
        localStorage.setItem('routineUpdateTimeout', '42');
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('authToken', 'stored-token');
        (updateRoutines as jest.Mock).mockRejectedValueOnce(new Error('later'));
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await act(async () => {
            jest.advanceTimersByTime(24 * 60 * 60 * 1000);
        });
        expect(updateRoutines).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('useAuth returns the default context outside a provider', () => {
        render(<Probe />);
        expect(screen.getByText('out')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'mark-in' }));
        expect(screen.getByText('out')).toBeInTheDocument();
    });
});
