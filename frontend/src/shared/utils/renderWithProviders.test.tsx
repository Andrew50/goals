import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders, withMockTimezone } from './renderWithProviders';
import { useAuth } from '../contexts/AuthContext';
import { useGoalMenu } from '../contexts/GoalMenuContext';

jest.mock('./testUtils', () => ({
    mockTimezone: jest.fn(() => jest.fn())
}));

function getMockTimezone(): jest.Mock {
    return (jest.requireMock('./testUtils') as { mockTimezone: jest.Mock }).mockTimezone;
}

function AuthProbe() {
    const { isAuthenticated, username } = useAuth();
    return (
        <div>
            <div data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</div>
            <div data-testid="username">{username || ''}</div>
        </div>
    );
}

function GoalMenuProbe() {
    // Just accessing the hook will throw if provider is missing.
    useGoalMenu();
    return <div data-testid="goal-menu">ok</div>;
}

describe('renderWithProviders', () => {
    beforeEach(() => {
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('authToken', 'test-token');
        localStorage.setItem('username', 'testuser');
    });

    test('renders with router only by default', () => {
        renderWithProviders(<div>hello</div>, { initialEntries: ['/'] });
        expect(screen.getByText('hello')).toBeInTheDocument();
    });

    test('supports AuthProvider, GoalMenuProvider, and DnD provider wrappers', () => {
        renderWithProviders(
            <div>
                <AuthProbe />
                <GoalMenuProbe />
            </div>,
            {
                withAuth: true,
                withGoalMenu: true,
                withDnd: true,
                initialEntries: ['/test']
            }
        );

        expect(screen.getByTestId('goal-menu')).toHaveTextContent('ok');
        expect(screen.getByTestId('auth')).toHaveTextContent('yes');
        expect(screen.getByTestId('username')).toHaveTextContent('testuser');
    });
});

describe('withMockTimezone', () => {
    test('restores timezone after a sync function', () => {
        const restore = jest.fn();
        getMockTimezone().mockReturnValueOnce(restore);

        withMockTimezone(300, () => {
            // no-op
        });
        expect(restore).toHaveBeenCalledTimes(1);
    });

    test('restores timezone after an async function', async () => {
        const restore = jest.fn();
        getMockTimezone().mockReturnValueOnce(restore);

        withMockTimezone(300, async () => {
            await Promise.resolve();
        });

        // Let the promise .finally() chain run.
        await Promise.resolve();
        await Promise.resolve();
        expect(restore).toHaveBeenCalledTimes(1);
    });

    test('restores timezone even if the function throws', () => {
        const restore = jest.fn();
        getMockTimezone().mockReturnValueOnce(restore);

        expect(() =>
            withMockTimezone(300, () => {
                throw new Error('boom');
            })
        ).toThrow('boom');
        expect(restore).toHaveBeenCalledTimes(1);
    });
});


