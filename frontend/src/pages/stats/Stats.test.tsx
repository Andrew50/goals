import React from 'react';
import { screen, waitFor } from '@testing-library/react';
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
        });
    });

    test('renders stats page from the year endpoint only', async () => {
        renderWithProviders(<Stats />, {
            withGoalMenu: true,
            initialEntries: ['/stats'],
        });

        await waitFor(() => {
            expect(screen.getByText(/completion stats/i)).toBeInTheDocument();
        });

        const urls = (privateRequest as jest.Mock).mock.calls.map((call) => String(call[0]));
        expect(urls.some((url) => url.startsWith('stats?'))).toBe(true);
        expect(urls.some((url) => url.includes('stats/extended'))).toBe(false);
        expect(urls.some((url) => url.includes('stats/rescheduling'))).toBe(false);
        expect(urls.some((url) => url.includes('stats/analytics'))).toBe(false);
    });

    test('shows an error when year stats fail', async () => {
        (privateRequest as jest.Mock).mockRejectedValue(new Error('timeout'));

        renderWithProviders(<Stats />, {
            withGoalMenu: true,
            initialEntries: ['/stats'],
        });

        expect(await screen.findByText(/could not load stats/i)).toBeInTheDocument();
    });
});

