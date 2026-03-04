import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Projects from './Projects';
import { privateRequest } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
}));

describe('Projects', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock)
            .mockResolvedValueOnce([]) // achievements
            .mockResolvedValueOnce({ nodes: [], edges: [] }); // network
    });

    test('renders projects page', async () => {
        renderWithProviders(<Projects />, {
            withGoalMenu: true,
            initialEntries: ['/projects'],
        });

        await waitFor(() => {
            // Look for search bar by aria-label or project content
            const searchInput = screen.queryByLabelText(/search/i);
            expect(searchInput || screen.getByText(/projects/i)).toBeTruthy();
        });
    });
});

