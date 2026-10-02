import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cacheTheme } from '../styles/injectThemeVariables';
import { ThemeProvider, useTheme } from './ThemeContext';

const mockThemeApi = {
    token: null as string | null,
    listeners: [] as Array<(token: string | null) => void>,
    request: async (_endpoint?: string, _method?: string, _data?: any) => ({ theme_name: 'dark' }),
};

jest.mock('../utils/api', () => ({
    getAccessToken: () => mockThemeApi.token,
    onAccessTokenChange: (listener: (token: string | null) => void) => {
        mockThemeApi.listeners.push(listener);
        return () => {
            mockThemeApi.listeners = mockThemeApi.listeners.filter((item) => item !== listener);
        };
    },
    privateRequest: (endpoint?: string, method?: string, data?: any) => mockThemeApi.request(endpoint, method, data),
}));

function ThemeProbe() {
    const { themeName, isLoading, setTheme, availableThemes } = useTheme();
    return (
        <div>
            <span>{isLoading ? 'loading' : 'ready'}</span>
            <span>{themeName}</span>
            <span>{availableThemes.length}</span>
            <button type="button" onClick={() => setTheme('green')}>Use green</button>
        </div>
    );
}

describe('ThemeContext', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        mockThemeApi.token = null;
        mockThemeApi.listeners = [];
        mockThemeApi.request = async () => ({ theme_name: 'dark' });
    });

    test('stays on the cached theme until a token arrives', async () => {
        cacheTheme('purple');
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );
        await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
        expect(screen.getByText('purple')).toBeInTheDocument();
        expect(screen.getByText('6')).toBeInTheDocument();
    });

    test('loads a valid theme after sign-in and ignores an unknown name', async () => {
        mockThemeApi.token = 'token';
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );
        await waitFor(() => expect(screen.getByText('dark')).toBeInTheDocument());

        mockThemeApi.request = async () => ({ theme_name: 'nope' });
        mockThemeApi.listeners[0]?.('next');
        await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
        expect(screen.getByText('dark')).toBeInTheDocument();
    });

    test('keeps the current theme when loading or saving fails', async () => {
        mockThemeApi.token = 'token';
        mockThemeApi.request = async () => {
            throw new Error('down');
        };
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );
        await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: 'Use green' }));
        expect(screen.getByText('green')).toBeInTheDocument();
    });

    test('requires a provider', () => {
        function Bare() {
            useTheme();
            return null;
        }
        expect(() => render(<Bare />)).toThrow('useTheme must be used within a ThemeProvider');
    });
});
