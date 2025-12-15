import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Day from './Day';
import { privateRequest } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
    updateEvent: jest.fn(),
}));

describe('Day', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockResolvedValue([]);
    });

    test('renders day page', async () => {
        renderWithProviders(<Day />, {
            withGoalMenu: true,
            initialEntries: ['/day'],
        });

        await waitFor(() => {
            // For today's date, Day renders the title "Today's Tasks" and no "Today" button.
            expect(screen.getByText(/today's tasks/i)).toBeInTheDocument();
        });
    });
});

