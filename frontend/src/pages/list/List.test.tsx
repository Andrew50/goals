import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import List from './List';
import { deleteEvent, deleteGoal, duplicateGoal, privateRequest, resolveGoal, updateEvent, updateGoal } from '../../shared/utils/api';
import GoalMenu from '../../shared/components/GoalMenu';

jest.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: (options: { count: number }) => ({
        getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({
            index,
            start: index * 56,
            end: (index + 1) * 56,
            size: 56,
            key: index,
        })),
        getTotalSize: () => options.count * 56,
        measureElement: () => {},
    }),
}));

jest.mock('../../shared/components/GoalMenu', () => ({
    __esModule: true,
    default: { open: jest.fn() },
}));

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
    deleteGoal: jest.fn(),
    duplicateGoal: jest.fn(),
    updateGoal: jest.fn(),
    resolveGoal: jest.fn(),
    deleteEvent: jest.fn(),
    updateEvent: jest.fn(),
}));

const task = {
    id: 1,
    name: 'Task one',
    description: 'First task',
    goal_type: 'task',
    priority: 'high',
    resolution_status: 'pending',
    frequency: 'daily',
    duration: 30,
    start_timestamp: Date.UTC(2026, 0, 2),
    end_timestamp: Date.UTC(2026, 0, 3),
    scheduled_timestamp: Date.UTC(2026, 0, 2, 15),
    next_timestamp: Date.UTC(2026, 0, 4),
};

const eventGoal = {
    id: 2,
    name: 'Event two',
    description: 'An event',
    goal_type: 'event',
    resolution_status: 'completed',
    duration: 1440,
};

function page(items = [task, eventGoal], total = 250) {
    return {
        items,
        total,
        facets: { frequency: ['daily', 'weekly'] },
    };
}

describe('List', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (String(url).startsWith('goals/')) {
                return Promise.resolve({ ...task });
            }
            return Promise.resolve(page());
        });
        (resolveGoal as jest.Mock).mockResolvedValue({ resolution_status: 'completed' });
        (updateEvent as jest.Mock).mockResolvedValue({});
        (deleteGoal as jest.Mock).mockResolvedValue(undefined);
        (deleteEvent as jest.Mock).mockResolvedValue(undefined);
        (duplicateGoal as jest.Mock).mockResolvedValue({ ...task, id: 9 });
        (updateGoal as jest.Mock).mockResolvedValue({ ...task });
        (GoalMenu.open as jest.Mock).mockClear();
        window.confirm = jest.fn(() => true);
    });

    test('renders list page', async () => {
        renderWithProviders(<List />, {
            withGoalMenu: true,
            initialEntries: ['/list'],
        });

        await waitFor(() => {
            expect(screen.getByLabelText(/search/i)).toBeInTheDocument();
        });
    });

    test('filters, sorts, pages, and bulk-edits the loaded goals', async () => {
        renderWithProviders(<List />, { initialEntries: ['/list'] });
        await screen.findByText('Task one');
        expect(screen.getByText('All day')).toBeInTheDocument();
        expect(screen.getByText('30 min')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Select all'));
        fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
        await waitFor(() => expect(resolveGoal).toHaveBeenCalledWith(1, 'completed'));
        expect(updateEvent).toHaveBeenCalledWith(2, { resolution_status: 'completed' });
        await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());

        await screen.findByText('Task one');
        fireEvent.click(screen.getByLabelText('Select Task one'));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Mark in progress' }));
        await waitFor(() => expect(resolveGoal).toHaveBeenCalledWith(1, 'pending'));

        await screen.findByText('Task one');
        fireEvent.click(screen.getByLabelText('Select all'));
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        expect(duplicateGoal).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText('Select all'));
        await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
        fireEvent.click(screen.getByLabelText('Select Task one'));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Select priority'), { target: { value: 'low' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply priority' }));
        await waitFor(() => expect(updateGoal).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());

        fireEvent.click(screen.getByLabelText('Select Task one'));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        await waitFor(() => expect(duplicateGoal).toHaveBeenCalledWith(1));
        await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());

        fireEvent.click(screen.getByLabelText('Select all'));
        (window.confirm as jest.Mock).mockReturnValueOnce(false);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(deleteGoal).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(deleteGoal).toHaveBeenCalledWith(1));
        expect(deleteEvent).toHaveBeenCalledWith(2, false);

        await screen.findByText('Task one');
        fireEvent.click(screen.getByText('Task one'));
        await waitFor(() => expect(GoalMenu.open).toHaveBeenCalled());
        fireEvent.contextMenu(screen.getByText('Event two'));

        fireEvent.click(screen.getByText('Name'));
        fireEvent.click(screen.getByText('Name'));
        fireEvent.click(screen.getByText('Name'));
        await waitFor(() => expect(screen.getByText(/of 250/)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

        fireEvent.click(screen.getByRole('button', { name: 'Toggle filters' }));
        const filters = screen.getByText('Filters').closest('.filters-section') as HTMLElement;
        fireEvent.click(within(filters).getByLabelText('task'));
        fireEvent.click(within(filters).getByLabelText('Clear Type'));
        fireEvent.click(within(filters).getByLabelText('task'));
        fireEvent.click(within(filters).getByLabelText('task'));
        fireEvent.click(within(filters).getByLabelText('High'));
        fireEvent.click(within(filters).getByLabelText('pending'));
        fireEvent.click(within(filters).getByLabelText('daily'));
        const dateInputs = within(filters).getAllByDisplayValue('');
        const dateField = dateInputs.find((node) => (node as HTMLInputElement).type === 'date') as HTMLInputElement;
        fireEvent.change(dateField, { target: { value: '2026-01-02' } });
        fireEvent.click(within(filters).getByLabelText('Clear Start Date from'));
        fireEvent.click(within(filters).getByLabelText('All day'));
        fireEvent.click(within(filters).getByLabelText('Clear Duration'));
        fireEvent.click(screen.getByRole('button', { name: 'Reset All' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]);
        expect(GoalMenu.open).toHaveBeenCalled();
    });

    test('shows a load error and falls back when a goal cannot be opened', async () => {
        (privateRequest as jest.Mock).mockRejectedValue(new Error('down'));
        const failed = renderWithProviders(<List />, { initialEntries: ['/list'] });
        expect(await screen.findByText('Could not load goals. Try again.')).toBeInTheDocument();
        failed.unmount();

        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (String(url).startsWith('goals/')) return Promise.reject(new Error('missing'));
            return Promise.resolve(page([task], 1));
        });
        renderWithProviders(<List />, { initialEntries: ['/list'] });
        await screen.findByText('Task one');
        fireEvent.click(screen.getByText('Task one'));
        await waitFor(() => expect(GoalMenu.open).toHaveBeenCalled());
    });

    test('recovers when a bulk action fails', async () => {
        (resolveGoal as jest.Mock).mockRejectedValue(new Error('nope'));
        (deleteGoal as jest.Mock).mockRejectedValue(new Error('nope'));
        (duplicateGoal as jest.Mock).mockRejectedValue(new Error('nope'));
        (updateGoal as jest.Mock).mockRejectedValue(new Error('nope'));
        renderWithProviders(<List />, { initialEntries: ['/list'] });
        await screen.findByText('Task one');
        const selectTask = () => {
            fireEvent.click(screen.getByLabelText('Select Task one'));
            expect(screen.getByText('1 selected')).toBeInTheDocument();
        };
        const waitUntilCleared = () => waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
        selectTask();
        fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
        await waitUntilCleared();
        selectTask();
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        await waitFor(() => expect(duplicateGoal).toHaveBeenCalled());
        await waitUntilCleared();
        selectTask();
        fireEvent.change(screen.getByLabelText('Select priority'), { target: { value: 'high' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply priority' }));
        await waitFor(() => expect(updateGoal).toHaveBeenCalled());
        await waitUntilCleared();
        selectTask();
        fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
        expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
        selectTask();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(deleteGoal).toHaveBeenCalled());
    });
});
