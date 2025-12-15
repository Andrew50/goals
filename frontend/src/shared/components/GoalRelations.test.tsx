import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import GoalRelations from './GoalRelations';
import { privateRequest, createRelationship, deleteRelationship } from '../utils/api';
import { Goal } from '../../types/goals';

jest.mock('../utils/api', () => ({
    privateRequest: jest.fn(),
    createRelationship: jest.fn(),
    deleteRelationship: jest.fn(),
}));

// Note: vis-network is already mocked in setupTests.ts, but we need to ensure fit() exists
// The mock in setupTests should already have it, but if not, this will override

describe('GoalRelations', () => {
    const mockGoal: Goal = {
        id: 1,
        name: 'Test Goal',
        goal_type: 'task',
    };

    const mockNetworkData = {
        nodes: [
            { id: 1, name: 'Test Goal', goal_type: 'task' },
            { id: 2, name: 'Parent Goal', goal_type: 'project' },
            { id: 3, name: 'Child Goal', goal_type: 'task' },
        ],
        edges: [
            { from: 2, to: 1, relationship_type: 'child' },
            { from: 1, to: 3, relationship_type: 'child' },
        ],
    };

    beforeEach(() => {
        (privateRequest as jest.Mock)
            .mockResolvedValueOnce([]) // list
            .mockResolvedValueOnce(mockNetworkData); // network
        (createRelationship as jest.Mock).mockResolvedValue({});
        (deleteRelationship as jest.Mock).mockResolvedValue({});
    });

    test('renders goal relations dialog', async () => {
        renderWithProviders(
            <GoalRelations goal={mockGoal} onClose={jest.fn()} />,
            {
                withGoalMenu: true,
            }
        );

        await waitFor(() => {
            expect(screen.getByText('Relationships')).toBeInTheDocument();
        });
    });

    test('displays parent and child relationships', async () => {
        renderWithProviders(
            <GoalRelations goal={mockGoal} onClose={jest.fn()} />,
            {
                withGoalMenu: true,
            }
        );

        await waitFor(() => {
            expect(screen.getByText(/Parent: Parent Goal/i)).toBeInTheDocument();
            expect(screen.getByText(/Child: Child Goal/i)).toBeInTheDocument();
        });
    });

    test('allows searching for goals to add', async () => {
        const allGoals: Goal[] = [
            { id: 4, name: 'New Parent', goal_type: 'project' },
            { id: 5, name: 'New Child', goal_type: 'task' },
        ];

        // Override the default beforeEach mock queue so our list search uses `allGoals`.
        (privateRequest as jest.Mock)
            .mockReset()
            .mockResolvedValueOnce(allGoals) // list
            .mockResolvedValueOnce(mockNetworkData); // network

        renderWithProviders(
            <GoalRelations goal={mockGoal} onClose={jest.fn()} />,
            {
                withGoalMenu: true,
            }
        );

        await waitFor(() => {
            const parentInput = screen.getByLabelText(/Add Parent/i);
            expect(parentInput).toBeInTheDocument();
            fireEvent.change(parentInput, { target: { value: 'New' } });
        });

        await waitFor(() => {
            expect(screen.getByText('New Parent')).toBeInTheDocument();
        });
    });
});

