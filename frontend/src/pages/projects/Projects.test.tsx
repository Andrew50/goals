import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import Projects from './Projects';
import { privateRequest } from '../../shared/utils/api';
import GoalMenu from '../../shared/components/GoalMenu';

jest.mock('../../shared/components/GoalMenu', () => ({
    __esModule: true,
    default: { open: jest.fn() },
}));

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
}));

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const project = { id: 10, name: 'Bridge', goal_type: 'project', resolution_status: 'pending', priority: 'high' };
const emptyProject = { id: 11, name: 'Empty', goal_type: 'project', resolution_status: 'pending' };
const doneProject = { id: 12, name: 'Finished', goal_type: 'project', resolution_status: 'completed' };

const achievements = [
    { id: 1, name: 'Overdue', goal_type: 'achievement', resolution_status: 'pending', priority: 'high', end_timestamp: now - 2 * day },
    { id: 2, name: 'Today', goal_type: 'achievement', resolution_status: 'pending', end_timestamp: now },
    { id: 3, name: 'Tomorrow', goal_type: 'achievement', resolution_status: 'pending', end_timestamp: now + day },
    { id: 4, name: 'This week', goal_type: 'achievement', resolution_status: 'pending', end_timestamp: now + 5 * day },
    { id: 5, name: 'Later', goal_type: 'achievement', resolution_status: 'pending', end_timestamp: now + 20 * day },
    { id: 6, name: 'Undated', goal_type: 'achievement', resolution_status: 'pending' },
    { id: 7, name: 'Done item', goal_type: 'achievement', resolution_status: 'completed', end_timestamp: now + day },
    { id: 8, name: 'Orphan', goal_type: 'achievement', resolution_status: 'pending' },
];

const edges = [
    [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7],
].map(([from, to]) => ({ from, to, relationship_type: 'child' }));

describe('Projects', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (url === 'achievements') return Promise.resolve(achievements);
            if (url === 'network') {
                return Promise.resolve({
                    nodes: [project, emptyProject, doneProject, ...achievements],
                    edges,
                });
            }
            return Promise.resolve([]);
        });
        (GoalMenu.open as jest.Mock).mockClear();
    });

    test('renders projects page', async () => {
        renderWithProviders(<Projects />, {
            withGoalMenu: true,
            initialEntries: ['/projects'],
        });

        await waitFor(() => {
            const searchInput = screen.queryByLabelText(/search/i);
            expect(searchInput || screen.getByText(/projects/i)).toBeTruthy();
        });
    });

    test('groups achievements, filters them, and opens the goal menu', async () => {
        renderWithProviders(<Projects />, { initialEntries: ['/projects'] });
        expect(await screen.findByText('Overdue')).toBeInTheDocument();
        expect(screen.getByText(/Overdue by/)).toBeInTheDocument();
        expect(screen.getByText('Due today')).toBeInTheDocument();
        expect(screen.getByText('Due tomorrow')).toBeInTheDocument();
        expect(screen.getByText(/Due in/)).toBeInTheDocument();
        expect(screen.getByText('No due date')).toBeInTheDocument();
        expect(screen.getByText('Done')).toBeInTheDocument();
        expect(screen.getAllByText('Empty').length).toBeGreaterThan(0);
        expect(screen.getByText('No active achievements')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'In Progress' }));
        expect(screen.queryByText('Done item')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
        expect(screen.getByText('Done item')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'All' }));

        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Overdue' } });
        await waitFor(() => expect(screen.getByText('Overdue')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Bridge'));
        fireEvent.click(screen.getByText('Overdue'));
        fireEvent.contextMenu(screen.getByText('Overdue'));
        fireEvent.click(screen.getAllByText('Empty')[0]);
        const created = (GoalMenu.open as jest.Mock).mock.calls;
        expect(created.length).toBeGreaterThan(0);

        fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]);
        const createCall = (GoalMenu.open as jest.Mock).mock.calls.find((call) => call[1] === 'create');
        await createCall[2]({ id: 20, name: 'New project', goal_type: 'project' });
        await createCall[2]({ id: 21, name: 'New task', goal_type: 'task' });
        expect(await screen.findByText('New project')).toBeInTheDocument();
    });

    test('shows an empty state when the network cannot be loaded', async () => {
        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (url === 'achievements') return Promise.resolve([]);
            return Promise.reject(new Error('network'));
        });
        renderWithProviders(<Projects />, { initialEntries: ['/projects'] });
        expect(await screen.findByText('No projects found')).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]);
        expect(GoalMenu.open).toHaveBeenCalled();
    });
});
