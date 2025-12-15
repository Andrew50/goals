import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
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
});

