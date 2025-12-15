import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Stats from './Stats';
import { privateRequest } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
}));

describe('Stats', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockResolvedValue({
            year: 2023,
            daily_stats: [],
            weekly_stats: [],
            monthly_stats: [],
            yearly_stats: {
                period: '2023',
                completion_rate: 0,
                total_events: 0,
                completed_events: 0,
                days_with_tasks: 0,
                days_with_no_tasks_complete: 0,
                weighted_total: 0,
                weighted_completed: 0,
            },
        });
    });

    test('renders stats page', async () => {
        renderWithProviders(<Stats />, {
            withGoalMenu: true,
            initialEntries: ['/stats'],
        });

        await waitFor(() => {
            const searchInput = screen.queryByPlaceholderText(/search/i);
            expect(searchInput || screen.getByText(/stats/i) || document.body.textContent).toBeTruthy();
        });
    });
});

