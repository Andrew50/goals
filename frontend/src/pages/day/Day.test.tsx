import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Day from './Day';
import { privateRequest, updateEvent } from '../../shared/utils/api';

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
            expect(screen.getByText('To Do')).toBeInTheDocument();
        });
    });

    test('shows a start-end range and keeps all-day events unlabeled as clocks', async () => {
        const start = new Date(2026, 9, 1, 9, 0, 0, 0).getTime();
        (privateRequest as jest.Mock).mockResolvedValue([
            {
                id: 1,
                name: 'Deep work',
                goal_type: 'event',
                priority: 'medium',
                resolution_status: 'pending',
                scheduled_timestamp: start,
                duration: 90,
                parent_id: 10,
            },
            {
                id: 2,
                name: 'Focus block',
                goal_type: 'event',
                priority: 'low',
                resolution_status: 'pending',
                scheduled_timestamp: start + 3 * 60 * 60 * 1000,
                parent_id: 10,
            },
            {
                id: 3,
                name: 'Travel day',
                goal_type: 'event',
                priority: 'low',
                resolution_status: 'completed',
                scheduled_timestamp: start,
                duration: 1440,
                parent_id: 10,
            },
        ]);

        renderWithProviders(<Day />, {
            withGoalMenu: true,
            initialEntries: ['/day'],
        });

        await waitFor(() => {
            expect(screen.getByText('Deep work')).toBeInTheDocument();
        });

        expect(screen.getByText(/9:00.*10:30/)).toBeInTheDocument();
        expect(screen.getByText(/12:00.*1:00/)).toBeInTheDocument();
        expect(screen.getByText('All day')).toBeInTheDocument();
    });

    test('shows align arrows on the event and applies them', async () => {
        const morning = new Date(2020, 0, 15, 9, 0, 0, 0).getTime();
        const late = new Date(2020, 0, 15, 11, 0, 0, 0).getTime();
        (privateRequest as jest.Mock).mockResolvedValue([
            {
                id: 1,
                name: 'Deep work',
                goal_type: 'event',
                priority: 'medium',
                resolution_status: 'pending',
                scheduled_timestamp: morning,
                duration: 60,
                parent_id: 10,
            },
            {
                id: 2,
                name: 'Lunch',
                goal_type: 'event',
                priority: 'low',
                resolution_status: 'pending',
                scheduled_timestamp: late,
                duration: 60,
                parent_id: 10,
            },
        ]);
        (updateEvent as jest.Mock).mockResolvedValue({});

        renderWithProviders(<Day />, {
            withGoalMenu: true,
            initialEntries: ['/day?date=2020-01-15'],
        });

        const endAtNext = await screen.findByRole('button', { name: /End at 11:00/i });
        const deepWork = screen.getByText('Deep work').closest('.task-card');
        const lunch = screen.getByText('Lunch').closest('.task-card');
        expect(deepWork).toContainElement(endAtNext);
        expect(lunch).toContainElement(screen.getByRole('button', { name: /Start at 10:00/i }));
        expect(document.querySelector('.day-seam')).toBeNull();

        fireEvent.click(endAtNext);
        await waitFor(() => {
            expect(updateEvent).toHaveBeenCalledWith(1, expect.objectContaining({
                duration: 120,
                move_reason: 'Adjusted in Day view',
            }));
        });

        fireEvent.click(screen.getByRole('button', { name: /Start at 10:00/i }));
        await waitFor(() => {
            expect(updateEvent).toHaveBeenCalledWith(2, expect.objectContaining({
                duration: 120,
                move_reason: 'Adjusted in Day view',
            }));
        });
        const upCall = (updateEvent as jest.Mock).mock.calls.find((call) => call[0] === 2);
        expect(upCall[1].scheduled_timestamp).toEqual(new Date(2020, 0, 15, 10, 0, 0, 0));
    });

    test('aligns to the time neighbor instead of skipping a block in the other column', async () => {
        const morning = new Date(2020, 0, 15, 9, 0, 0, 0).getTime();
        (privateRequest as jest.Mock).mockResolvedValue([
            {
                id: 1,
                name: 'Deep work',
                goal_type: 'event',
                priority: 'medium',
                resolution_status: 'pending',
                scheduled_timestamp: morning,
                duration: 60,
                parent_id: 10,
            },
            {
                id: 2,
                name: 'Errand',
                goal_type: 'event',
                priority: 'low',
                resolution_status: 'completed',
                scheduled_timestamp: morning + 90 * 60 * 1000,
                duration: 30,
                parent_id: 10,
            },
            {
                id: 3,
                name: 'Lunch',
                goal_type: 'event',
                priority: 'low',
                resolution_status: 'pending',
                scheduled_timestamp: morning + 3 * 60 * 60 * 1000,
                duration: 60,
                parent_id: 10,
            },
        ]);

        renderWithProviders(<Day />, {
            withGoalMenu: true,
            initialEntries: ['/day?date=2020-01-15'],
        });

        await screen.findByText('Lunch');
        const deepWork = screen.getByText('Deep work').closest('.task-card');
        const lunch = screen.getByText('Lunch').closest('.task-card');
        expect(deepWork?.querySelector('button')?.getAttribute('aria-label')).toMatch(/End at 10:30/i);
        expect(lunch?.querySelector('button')?.getAttribute('aria-label')).toMatch(/Start at 11:00/i);
        expect(screen.queryByRole('button', { name: /End at 12:00/i })).toBeInTheDocument();
    });
});

