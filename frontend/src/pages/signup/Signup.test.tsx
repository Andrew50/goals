import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Signup from './Signup';

jest.mock('../../shared/utils/api', () => ({
    publicRequest: jest.fn(),
}));

describe('Signup', () => {
    test('renders signup page', () => {
        renderWithProviders(<Signup />, {
            initialEntries: ['/signup'],
        });

        expect(screen.getByLabelText(/username/i) || screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    });

    test('shows generic invalid-credentials message (no technical details) on 409', async () => {
        const { publicRequest } = require('../../shared/utils/api');
        (publicRequest as jest.Mock).mockRejectedValue({ response: { status: 409 }, message: 'Request failed with status code 409' });

        renderWithProviders(<Signup />, {
            initialEntries: ['/signup'],
        });

        await userEvent.type(screen.getByLabelText(/username/i), 'alice');
        await userEvent.type(screen.getByLabelText(/password/i), 'pw');
        await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

        expect(await screen.findByText('Incorrect username/password')).toBeInTheDocument();
        expect(screen.queryByText(/status code/i)).not.toBeInTheDocument();
    });

    test('shows generic server-error message on 5xx', async () => {
        const { publicRequest } = require('../../shared/utils/api');
        (publicRequest as jest.Mock).mockRejectedValue({ response: { status: 500 }, message: 'Request failed with status code 500' });

        renderWithProviders(<Signup />, {
            initialEntries: ['/signup'],
        });

        await userEvent.type(screen.getByLabelText(/username/i), 'alice');
        await userEvent.type(screen.getByLabelText(/password/i), 'pw');
        await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

        expect(await screen.findByText('Server error')).toBeInTheDocument();
        expect(screen.queryByText(/status code/i)).not.toBeInTheDocument();
    });
});

