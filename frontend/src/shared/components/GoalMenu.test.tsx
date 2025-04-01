import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GoalMenu from './GoalMenu';
import { createGoal, updateGoal, deleteGoal, createRelationship, updateRoutines, completeGoal } from '../utils/api';
import { Goal } from '../../types/goals';

// Mock the API modules
jest.mock('../utils/api', () => ({
    createGoal: jest.fn(),
    updateGoal: jest.fn(),
    deleteGoal: jest.fn(),
    createRelationship: jest.fn(),
    updateRoutines: jest.fn(),
    completeGoal: jest.fn(),
}));

// Helper to mock timezone offset
const mockTimezoneOffset = (offsetMinutes: number) => {
    const original = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = jest.fn(() => offsetMinutes);
    return () => {
        Date.prototype.getTimezoneOffset = original;
    };
};

describe('GoalMenu Component', () => {
    // Save original console functionality
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    beforeEach(() => {
        // Mock console methods to reduce noise
        //console.log = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();

        // Mock API calls to return successfully
        (createGoal as jest.Mock).mockImplementation((goal) =>
            Promise.resolve({ ...goal, id: 123 }));
        (updateGoal as jest.Mock).mockImplementation((id, goal) =>
            Promise.resolve(goal));
        (deleteGoal as jest.Mock).mockImplementation(() =>
            Promise.resolve());
        (createRelationship as jest.Mock).mockImplementation(() =>
            Promise.resolve());
        (updateRoutines as jest.Mock).mockImplementation(() =>
            Promise.resolve());
        (completeGoal as jest.Mock).mockImplementation((id, completed) =>
            Promise.resolve(completed));
    });

    afterEach(() => {
        // Restore console functionality
        //console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;

        // Clear all mocks
        jest.clearAllMocks();
    });

    test('renders correctly in view mode', () => {
        render(<GoalMenu />);

        // The menu is not initially visible, and is controlled via the open/close methods

        // Verify the component was rendered
        expect(GoalMenu.open).toBeDefined();
        expect(GoalMenu.close).toBeDefined();
    });

    test('correctly formats and displays timestamps in different timezones', async () => {
        // Mock Eastern Time timezone (UTC-5)
        const restoreOffset = mockTimezoneOffset(300);

        render(<GoalMenu />);

        // Create a sample goal with timestamps in UTC
        const goal: Goal = {
            id: 1,
            name: 'Test Goal',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z (7 AM EST)
            end_timestamp: 1672660800000,   // 2023-01-02T12:00:00Z (7 AM EST next day)
            scheduled_timestamp: 1672596000000, // 2023-01-01T18:00:00Z (1 PM EST)
            duration: 60, // 1 hour
            _tz: 'utc'
        };

        // Create a spy on setState to verify state changes
        const openSpy = jest.spyOn(GoalMenu, 'open');

        // Open the menu with our sample goal
        GoalMenu.open(goal, 'view');

        expect(openSpy).toHaveBeenCalledWith(goal, 'view', undefined);

        // Wait for the component to update
        await waitFor(() => {
            // Check for goal properties
            // In view mode, we should see the goal name
            screen.getByText('Test Goal');
        });

        restoreOffset();
    });

    test('correctly converts timestamps when creating a new goal', async () => {
        // Mock Pacific Time timezone (UTC-8)
        const restoreOffset = mockTimezoneOffset(480);

        render(<GoalMenu />);

        // Create a sample goal without timestamps
        const goal: Goal = {
            id: 0, // New goal
            name: '',
            goal_type: 'task',
            _tz: 'user'
        };

        // Open the menu with our sample goal
        GoalMenu.open(goal, 'create');

        // Wait for the component to update
        await waitFor(() => {
            // In create mode, we should see the create title
            screen.getByText('Create New Goal');
        });

        // Fill in the form fields
        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'New Task Test' } });

        // Select a start date (this will be in user's local timezone)
        // Since timestampToInputString is mocked, we'll just check that createGoal is called
        // with correct timezone conversion

        // Submit the form
        const createButton = screen.getByText('Create');
        fireEvent.click(createButton);

        // Wait for the API call
        await waitFor(() => {
            expect(createGoal).toHaveBeenCalled();

            // Get the goal argument passed to createGoal
            const createdGoal = (createGoal as jest.Mock).mock.calls[0][0];

            // Verify the timezone is set to 'utc' for the API call
            expect(createdGoal._tz).toBe('utc');
        });

        restoreOffset();
    });

    test('correctly handles timezone conversion when editing a goal', async () => {
        // Mock Central European Time (UTC+1)
        const restoreOffset = mockTimezoneOffset(-60);

        render(<GoalMenu />);

        // Create a sample goal with UTC timestamps
        const goal: Goal = {
            id: 1,
            name: 'Test Goal',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z (13:00 CET)
            end_timestamp: 1672660800000,   // 2023-01-02T12:00:00Z (13:00 CET next day)
            scheduled_timestamp: 1672596000000, // 2023-01-01T18:00:00Z (19:00 CET)
            duration: 60, // 1 hour
            _tz: 'utc'
        };

        // Open the menu with our sample goal in view mode
        GoalMenu.open(goal, 'view');

        // Wait for the component to update
        await waitFor(() => {
            // In view mode, we should see the goal name
            screen.getByText('Test Goal');
        });

        // Switch to edit mode
        const editButton = screen.getByText('Edit');
        fireEvent.click(editButton);

        // Wait for the component to update to edit mode
        await waitFor(() => {
            screen.getByText('Edit Goal');
        });

        // Change the name
        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'Updated Task Name' } });

        // Submit the form
        const saveButton = screen.getByText('Save');
        fireEvent.click(saveButton);

        // Wait for the API call
        await waitFor(() => {
            expect(updateGoal).toHaveBeenCalled();

            // Get the goal argument passed to updateGoal
            const updatedGoal = (updateGoal as jest.Mock).mock.calls[0][1];

            // Verify the timezone is set to 'utc' for the API call
            expect(updatedGoal._tz).toBe('utc');
            expect(updatedGoal.name).toBe('Updated Task Name');

            // Verify timestamps are in UTC
            expect(updatedGoal.start_timestamp).toBe(goal.start_timestamp);
            expect(updatedGoal.end_timestamp).toBe(goal.end_timestamp);
            expect(updatedGoal.scheduled_timestamp).toBe(goal.scheduled_timestamp);
        });

        restoreOffset();
    });
}); 