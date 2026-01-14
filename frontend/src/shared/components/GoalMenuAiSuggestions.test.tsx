import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import GoalMenu from './GoalMenu';
import { getAutofillSuggestions, privateRequest } from '../utils/api';
import { Goal } from '../../types/goals';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// Mock the API modules
jest.mock('../utils/api', () => {
    const actual = jest.requireActual('../utils/api');
    return {
        ...actual,
        getAutofillSuggestions: jest.fn(),
        privateRequest: jest.fn(),
        getGoalRelations: jest.fn(() => Promise.resolve({ parents: [], children: [] })),
        getTaskEvents: jest.fn(() => Promise.resolve({ events: [], total_duration: 0 })),
    };
});

describe('GoalMenu AI Suggestions', () => {
    const mockGoal: Goal = {
        id: 1,
        name: 'Initial Name',
        goal_type: 'task',
        priority: 'medium',
        resolution_status: 'pending'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (getAutofillSuggestions as jest.Mock).mockResolvedValue({
            suggestions: ['Suggested Value 1', 'Suggested Value 2']
        });
        (privateRequest as jest.Mock).mockImplementation((endpoint) => {
            if (endpoint === 'list') return Promise.resolve([]);
            return Promise.resolve([]);
        });
    });

    afterEach(() => {
        act(() => {
            GoalMenu.close();
        });
    });

    test('fetches and applies name suggestions on focus', async () => {
        await act(async () => {
            GoalMenu.open(mockGoal, 'edit');
        });
        
        // Wait for it to render
        const nameInput = await screen.findByLabelText(/Name/i);
        
        // Focus triggers fetch
        await act(async () => {
            fireEvent.focus(nameInput);
        });
        
        await waitFor(() => {
            expect(getAutofillSuggestions).toHaveBeenCalled();
        });

        // Suggestions should appear
        const suggestionChip = await screen.findByText('Suggested Value 1');
        expect(suggestionChip).toBeInTheDocument();

        // Clicking suggestion applies it
        await act(async () => {
            fireEvent.click(suggestionChip);
        });
        expect(nameInput).toHaveValue('Suggested Value 1');
    });

    test('applies top suggestion on Enter press', async () => {
        await act(async () => {
            GoalMenu.open(mockGoal, 'edit');
        });
        
        const nameInput = await screen.findByLabelText(/Name/i);
        
        await act(async () => {
            fireEvent.focus(nameInput);
        });
        
        await screen.findByText('Suggested Value 1');
        
        // Press Enter on input
        await act(async () => {
            fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter' });
        });
        
        expect(nameInput).toHaveValue('Suggested Value 1');
    });

    test('clears suggestions on blur', async () => {
        await act(async () => {
            GoalMenu.open(mockGoal, 'edit');
        });
        
        const nameInput = await screen.findByLabelText(/Name/i);
        
        await act(async () => {
            fireEvent.focus(nameInput);
        });
        
        await screen.findByText('Suggested Value 1');
        
        // Blur should trigger clearing after a delay
        await act(async () => {
            fireEvent.blur(nameInput);
        });
        
        // Wait for the timeout in GoalMenu
        await waitFor(() => {
            expect(screen.queryByText('Suggested Value 1')).not.toBeInTheDocument();
        }, { timeout: 1000 });
    });
});

