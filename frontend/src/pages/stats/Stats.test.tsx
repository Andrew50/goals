import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Stats from './Stats';
import { privateRequest } from '../../shared/utils/api';
import GoalMenu from '../../shared/components/GoalMenu';

jest.mock('../../shared/components/GoalMenu', () => ({
    __esModule: true,
    default: { open: jest.fn() },
}));

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
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    });

    test('draws the year, opens a day, and sorts effort rows', async () => {
        const year = new Date().getFullYear();
        const today = new Date();
        const iso = (date: Date) => {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${date.getFullYear()}-${month}-${day}`;
        };
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const scores = [0, 0.25, 0.5, 0.75, 1];
        const daily_stats = [yesterday, today, tomorrow].map((date, index) => ({
            date: iso(date),
            score: scores[index],
            total_events: index === 0 ? 0 : 4,
            completed_events: index,
            weighted_total: 4,
            weighted_completed: index,
        }));
        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (String(url).startsWith('stats/effort')) {
                return Promise.resolve([
                    {
                        goal_id: 1,
                        goal_name: 'Deep work',
                        goal_type: 'task',
                        total_events: 4,
                        completed_events: 3,
                        total_duration_minutes: 120,
                        weighted_completion_rate: 0.8,
                        children_count: 2,
                    },
                    {
                        goal_id: 2,
                        goal_name: 'Errand',
                        goal_type: 'routine',
                        total_events: 1,
                        completed_events: 1,
                        total_duration_minutes: 20,
                        weighted_completion_rate: 1,
                        children_count: 0,
                    },
                ]);
            }
            if (String(url).startsWith('stats/routines')) return Promise.resolve([]);
            return Promise.resolve({ year, daily_stats });
        });

        renderWithProviders(<Stats />, { initialEntries: ['/stats'] });
        await waitFor(() => {
            expect(document.querySelector(`[data-date="${iso(yesterday)}"]`)).toBeTruthy();
        });
        const cell = document.querySelector(`[data-date="${iso(yesterday)}"]`) as HTMLElement;
        fireEvent.mouseEnter(cell);
        fireEvent.mouseMove(cell, { clientX: 12, clientY: 20 });
        expect(screen.getByText(/Score:/)).toBeInTheDocument();
        fireEvent.click(cell);
        fireEvent.mouseLeave(cell);
        fireEvent.click(document.querySelector(`[data-date="${iso(tomorrow)}"]`) as HTMLElement);

        fireEvent.click(screen.getByRole('button', { name: '←' }));
        fireEvent.click(screen.getByRole('button', { name: '→' }));
        fireEvent.click(screen.getByRole('button', { name: 'Effort' }));
        expect(await screen.findByText('Deep work')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('Sort by number of descendants'));
        fireEvent.click(screen.getByTitle('Sort by number of descendants'));
        fireEvent.click(screen.getByTitle('Sort by completed events'));
        fireEvent.click(screen.getByTitle('Sort by weighted completion'));
        fireEvent.click(screen.getByTitle('Sort by time spent'));
        fireEvent.click(screen.getByTitle('Expand children'));
        fireEvent.click(screen.getByText('Deep work'));
        expect(GoalMenu.open).toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Deep' } });
        fireEvent.change(screen.getByLabelText('Type:'), { target: { value: 'task' } });
        fireEvent.change(screen.getByDisplayValue('All time'), { target: { value: '1m' } });
    });
});

