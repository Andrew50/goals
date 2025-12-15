import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Signin from './Signin';

describe('Signin', () => {
    test('renders signin page', () => {
        renderWithProviders(<Signin />, {
            withAuth: true,
            initialEntries: ['/signin'],
        });

        expect(screen.getByLabelText(/username/i) || screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    });
});

