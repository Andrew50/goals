import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Root from './Root';

// Mock lazy-loaded component
jest.mock('./components/CalendarPreview', () => ({
    __esModule: true,
    default: () => <div data-testid="calendar-preview">Calendar Preview</div>,
}));

describe('Root', () => {
    test('renders root page with welcome message', () => {
        renderWithProviders(<Root />, {
            withAuth: true,
            initialEntries: ['/'],
        });

        expect(screen.getByText(/Plan with Precision/i)).toBeInTheDocument();
    });
});

