import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Signin from './Signin';

jest.mock('../../shared/utils/api', () => ({
    publicRequest: jest.fn(),
    privateRequest: jest.fn(),
    updateRoutines: jest.fn(),
}));

describe('Signin', () => {
    beforeEach(() => {
        // Ensure we start unauthenticated so the Signin page doesn't auto-redirect.
        localStorage.removeItem('authToken');
        localStorage.removeItem('testMode');
    });

    test('renders signin page', () => {
        const { privateRequest } = require('../../shared/utils/api');
        (privateRequest as jest.Mock).mockRejectedValue({ response: { status: 401 } });

        renderWithProviders(<Signin />, {
            withAuth: true,
            initialEntries: ['/signin'],
        });

        expect(screen.getByLabelText(/username/i) || screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    });

    test('shows generic invalid-credentials message (no technical details) on 401', async () => {
        const { publicRequest, privateRequest } = require('../../shared/utils/api');
        (privateRequest as jest.Mock).mockRejectedValue({ response: { status: 401 } });
        (publicRequest as jest.Mock).mockRejectedValue({ response: { status: 401 }, message: 'Request failed with status code 401' });

        renderWithProviders(<Signin />, {
            withAuth: true,
            initialEntries: ['/signin'],
        });

        await userEvent.type(screen.getByLabelText(/username/i), 'alice');
        await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
        await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

        expect(await screen.findByText('Incorrect username/password')).toBeInTheDocument();
        expect(screen.queryByText(/status code/i)).not.toBeInTheDocument();
    });

    test('shows generic server-error message on non-credential failures', async () => {
        const { publicRequest, privateRequest } = require('../../shared/utils/api');
        (privateRequest as jest.Mock).mockRejectedValue({ response: { status: 401 } });
        (publicRequest as jest.Mock).mockRejectedValue({ response: { status: 500 }, message: 'Request failed with status code 500' });

        renderWithProviders(<Signin />, {
            withAuth: true,
            initialEntries: ['/signin'],
        });

        await userEvent.type(screen.getByLabelText(/username/i), 'alice');
        await userEvent.type(screen.getByLabelText(/password/i), 'whatever');
        await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

        expect(await screen.findByText('Server error')).toBeInTheDocument();
        expect(screen.queryByText(/status code/i)).not.toBeInTheDocument();
    });
});

