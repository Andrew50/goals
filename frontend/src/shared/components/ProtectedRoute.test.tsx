import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import ProtectedRoute from './ProtectedRoute';

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
    ...jest.requireActual('react-router-dom'),
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/protected' }),
}));

describe('ProtectedRoute', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
        localStorage.removeItem('testMode');
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
    });

    test('renders children when authenticated', () => {
        // AuthProvider reads auth state from localStorage on first render.
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('authToken', 'test-token');
        localStorage.setItem('username', 'testuser');

        renderWithProviders(
            <ProtectedRoute>
                <div>Protected Content</div>
            </ProtectedRoute>,
            {
                withAuth: true,
            }
        );

        expect(screen.getByText('Protected Content')).toBeInTheDocument();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('redirects to signin when not authenticated', () => {
        // Ensure unauthenticated state
        localStorage.removeItem('testMode');
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');

        renderWithProviders(
            <ProtectedRoute>
                <div>Protected Content</div>
            </ProtectedRoute>,
            {
                withAuth: false,
            }
        );

        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
        expect(mockNavigate).toHaveBeenCalledWith('/signin', {
            state: { from: '/protected' },
            replace: true,
        });
    });
});

