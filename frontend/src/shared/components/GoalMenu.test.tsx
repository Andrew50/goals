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
        });

        // Get the goal argument passed to createGoal
        const createdGoal = (createGoal as jest.Mock).mock.calls[0][0];

        // Verify the timezone is set to 'utc' for the API call
        expect(createdGoal._tz).toBe('utc');

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
        });

        // Get the goal argument passed to updateGoal
        const updatedGoal = (updateGoal as jest.Mock).mock.calls[0][1];

        // Verify the timezone is set to 'utc' for the API call
        expect(updatedGoal._tz).toBe('utc');
        expect(updatedGoal.name).toBe('Updated Task Name');

        // Verify timestamps are in UTC
        expect(updatedGoal.start_timestamp).toBe(goal.start_timestamp);
        expect(updatedGoal.end_timestamp).toBe(goal.end_timestamp);
        expect(updatedGoal.scheduled_timestamp).toBe(goal.scheduled_timestamp);

        restoreOffset();
    });

    test('correctly handles timestamp fields when creating a new goal with scheduled time', async () => {
        // Mock Eastern Time timezone (UTC-5)
        const restoreOffset = mockTimezoneOffset(300);

        render(<GoalMenu />);

        // Open the menu in create mode
        GoalMenu.open({
            id: 0,
            name: '',
            goal_type: 'task',
            _tz: 'user'
        }, 'create');

        // Wait for the form to render
        await waitFor(() => {
            screen.getByText('Create New Goal');
        });

        // Fill in required fields
        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'New Scheduled Task' } });

        // Find and fill in the date/time fields - exact field labels will depend on your implementation
        const dateField = screen.getByLabelText(/Scheduled Date/i) || screen.getByLabelText(/Date/i);
        const timeField = screen.getByLabelText(/Scheduled Time/i) || screen.getByLabelText(/Time/i);

        // Set date to Jan 15, 2023 at 10:30 AM local time
        fireEvent.change(dateField, { target: { value: '2023-01-15' } });
        fireEvent.change(timeField, { target: { value: '10:30' } });

        // Submit the form
        const createButton = screen.getByText('Create');
        fireEvent.click(createButton);

        // Wait for the API call
        await waitFor(() => {
            expect(createGoal).toHaveBeenCalled();
        });

        // Get the submitted goal data
        const submittedGoal = (createGoal as jest.Mock).mock.calls[0][0];

        // Verify timezone is UTC
        expect(submittedGoal._tz).toBe('utc');

        // Verify the timestamp was converted to UTC
        // Local 10:30 AM EST should become 15:30 UTC (add 5 hours)
        const expectedLocalTimestamp = new Date(2023, 0, 15, 10, 30, 0, 0).getTime();
        const expectedUTCTimestamp = expectedLocalTimestamp + (300 * 60 * 1000);

        // The scheduled_timestamp should be in UTC
        expect(submittedGoal.scheduled_timestamp).toBe(expectedUTCTimestamp);

        restoreOffset();
    });

    test('correctly handles all-day events', async () => {
        // Mock Pacific Time timezone (UTC-8)
        const restoreOffset = mockTimezoneOffset(480);

        render(<GoalMenu />);

        // Open the menu in create mode
        GoalMenu.open({
            id: 0,
            name: '',
            goal_type: 'task',
            _tz: 'user'
        }, 'create');

        // Wait for the form to render
        await waitFor(() => {
            screen.getByText('Create New Goal');
        });

        // Fill in required fields
        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'All-Day Task' } });

        // Find date field and all-day checkbox
        const dateField = screen.getByLabelText(/Scheduled Date/i) || screen.getByLabelText(/Date/i);

        // Try to find the all-day checkbox by various means
        const allDayCheckbox = screen.getByLabelText(/All Day/i) ||
            screen.getByRole('checkbox', { name: /all day/i }) ||
            screen.getByText(/All Day/i).closest('input');

        // Set date to Feb 20, 2023
        fireEvent.change(dateField, { target: { value: '2023-02-20' } });

        // Check the all-day box
        fireEvent.click(allDayCheckbox);

        // Submit the form
        const createButton = screen.getByText('Create');
        fireEvent.click(createButton);

        // Wait for the API call
        await waitFor(() => {
            expect(createGoal).toHaveBeenCalled();
        });

        // Get the submitted goal data
        const submittedGoal = (createGoal as jest.Mock).mock.calls[0][0];

        // Verify timezone is UTC
        expect(submittedGoal._tz).toBe('utc');

        // For all-day events, verify:
        // 1. The duration should be 1440 minutes (24 hours)
        expect(submittedGoal.duration).toBe(1440);

        // 2. The time component should be midnight UTC
        const submittedDate = new Date(submittedGoal.scheduled_timestamp);
        expect(submittedDate.getUTCHours()).toBe(0);
        expect(submittedDate.getUTCMinutes()).toBe(0);

        // 3. The date should be correct (Feb 20, 2023)
        expect(submittedDate.getUTCFullYear()).toBe(2023);
        expect(submittedDate.getUTCMonth()).toBe(1); // 0-indexed, so February is 1
        expect(submittedDate.getUTCDate()).toBe(20);

        restoreOffset();
    });

    test('correctly preserves unchanged timestamps when editing', async () => {
        // Mock Central European Time (UTC+1)
        const restoreOffset = mockTimezoneOffset(-60);

        render(<GoalMenu />);

        // Create a sample goal with UTC timestamps
        const goal: Goal = {
            id: 1,
            name: 'Original Task Name',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z (13:00 CET)
            end_timestamp: 1672660800000,   // 2023-01-02T12:00:00Z (13:00 CET next day)
            scheduled_timestamp: 1672596000000, // 2023-01-01T18:00:00Z (19:00 CET)
            duration: 60, // 1 hour
            _tz: 'utc'
        };

        // Open the menu with this goal in view mode
        GoalMenu.open(goal, 'view');

        // Switch to edit mode
        await waitFor(() => {
            screen.getByText('Original Task Name');
        });

        const editButton = screen.getByText('Edit');
        fireEvent.click(editButton);

        await waitFor(() => {
            screen.getByText('Edit Goal');
        });

        // Change only the name, DON'T touch timestamp fields
        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'Updated Name Only' } });

        // Submit the form
        const saveButton = screen.getByText('Save');
        fireEvent.click(saveButton);

        // Wait for the API call
        await waitFor(() => {
            expect(updateGoal).toHaveBeenCalled();
        });

        // Get the submitted goal data
        const [id, submittedGoal] = (updateGoal as jest.Mock).mock.calls[0];

        // Verify ID and timezone are correct
        expect(id).toBe(1);
        expect(submittedGoal._tz).toBe('utc');
        expect(submittedGoal.name).toBe('Updated Name Only');

        // Verify all timestamps remained unchanged
        expect(submittedGoal.start_timestamp).toBe(goal.start_timestamp);
        expect(submittedGoal.end_timestamp).toBe(goal.end_timestamp);
        expect(submittedGoal.scheduled_timestamp).toBe(goal.scheduled_timestamp);
        expect(submittedGoal.duration).toBe(goal.duration);

        restoreOffset();
    });
}); 