import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Query from './Query';

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    readyState: WebSocket.CONNECTING,
})) as any;

describe('Query', () => {
    test('renders query page', () => {
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('authToken', 'test-token');
        localStorage.setItem('username', 'testuser');

        renderWithProviders(<Query />, {
            withAuth: true,
            initialEntries: ['/query'],
        });

        // Look for the send button or the message input
        expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/type your message here/i)).toBeInTheDocument();
    });
});

