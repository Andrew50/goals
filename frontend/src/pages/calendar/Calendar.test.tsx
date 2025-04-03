import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { goalToLocal } from '../../shared/utils/time';
import { Goal } from '../../types/goals';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// Import GoalMenu
import GoalMenu from '../../shared/components/GoalMenu';

// Import the API
jest.mock('../../shared/utils/api', () => ({
    fetchCalendarData: jest.fn(),
    createGoal: jest.fn(),
    updateGoal: jest.fn()
}));

// Add a mock for GoalMenu
jest.mock('../../shared/components/GoalMenu', () => ({
    __esModule: true,
    default: {
        open: jest.fn(),
        close: jest.fn()
    }
}));

// Mock TaskList component since it uses react-dnd
jest.mock('./TaskList', () => {
    return {
        __esModule: true,
        default: jest.fn(({ tasks, onAddTask }) => (
            <div data-testid="tasklist-mock">
                <button onClick={onAddTask}>Add Task</button>
                <div data-testid="unscheduled-tasks">
                    {tasks.map((task: any, index: number) => (
                        <div key={index} data-testid={`task-${index}`}>{task.title}</div>
                    ))}
                </div>
            </div>
        ))
    };
});

// Mock dynamic imports for FullCalendar
jest.mock('@fullcalendar/react', () => ({
    __esModule: true,
    default: jest.fn(props => (
        <div data-testid="fullcalendar-mock">
            {props.events && (
                <div data-testid="calendar-events">
                    {props.events.map((event: any, index: number) => (
                        <div key={index} data-testid={`event-${index}`}>
                            {event.title}: {new Date(event.start).toISOString()}
                        </div>
                    ))}
                </div>
            )}
        </div>
    ))
}));

jest.mock('@fullcalendar/daygrid', () => ({
    __esModule: true,
    default: 'dayGridPlugin'
}));

jest.mock('@fullcalendar/timegrid', () => ({
    __esModule: true,
    default: 'timeGridPlugin'
}));

jest.mock('@fullcalendar/interaction', () => ({
    __esModule: true,
    default: 'interactionPlugin',
    Draggable: jest.fn()
}));

// Mock the calendarData module
jest.mock('./calendarData', () => ({
    fetchCalendarData: jest.fn().mockImplementation(() => {
        return Promise.resolve({
            events: [],
            unscheduledTasks: []
        });
    })
}));

// Test wrapper component with DndProvider
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <DndProvider backend={HTML5Backend}>
            {children}
        </DndProvider>
    );
};

// Import the component after mocks are set up
// This is necessary to avoid the component trying to use the real modules during import
const importCalendar = () => import('./Calendar').then(module => module.default);

// Helper to mock timezone offset
const mockTimezoneOffset = (offsetMinutes: number) => {
    const original = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = jest.fn(() => offsetMinutes);
    return () => {
        Date.prototype.getTimezoneOffset = original;
    };
};

describe('Calendar Component', () => {
    // Save original console functionality
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    beforeEach(() => {
        // Mock console methods to reduce noise
        //console.log = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();

        // Reset all mocks
        jest.clearAllMocks();

        // Mock the fetchCalendarData API call
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockImplementation(() => Promise.resolve({
            scheduled_tasks: [],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        }));
    });

    afterEach(() => {
        // Restore console functionality
        //console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    });

    test('Calendar loads and converts event times to local timezone', async () => {
        // Mock timezone to EST (-5 hours, offset 300 minutes)
        const restoreOffset = mockTimezoneOffset(300);

        // Prepare test data with UTC timestamps
        const utcTask: Goal = {
            id: 1,
            name: 'Test Task',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z (7:00 AM EST)
            end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z (8:00 AM EST)
            scheduled_timestamp: 1672574400000, // Same as start
            duration: 60, // 1 hour
            completed: false,
            _tz: 'utc'
        };

        // Set up mock API response
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValueOnce({
            events: [
                {
                    id: '1',
                    title: 'Test Task',
                    start: new Date(utcTask.start_timestamp!), // UTC date
                    end: new Date(utcTask.end_timestamp!),     // UTC date
                    allDay: false,
                    type: 'scheduled',
                    goal: utcTask
                }
            ],
            scheduled_tasks: [utcTask],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Import and render the Calendar component with DndProvider
        const Calendar = await importCalendar();
        render(
            <TestWrapper>
                <Calendar />
            </TestWrapper>
        );

        // Wait for the calendar to load and convert events
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Check that the event is converted to local time
        const localTask = goalToLocal(utcTask);
        expect(localTask.start_timestamp).toBe(utcTask.start_timestamp! - (300 * 60 * 1000));

        // Clean up
        restoreOffset();
    });

    test('Calendar handles DST transitions correctly', async () => {
        // Mock a function that simulates DST transitions
        const mockDSTOffset = () => {
            const original = Date.prototype.getTimezoneOffset;

            // Mock getTimezoneOffset to return different values based on date
            // March 12, 2023 was DST start in the US
            Date.prototype.getTimezoneOffset = function () {
                if (this.getMonth() === 2 && this.getDate() >= 12) { // After March 12
                    return 240; // EDT (-4 hours)
                } else {
                    return 300; // EST (-5 hours)
                }
            };

            return () => {
                Date.prototype.getTimezoneOffset = original;
            };
        };

        const restoreDST = mockDSTOffset();

        // Set up goals before and after DST transition
        const beforeDST: Goal = {
            id: 1,
            name: 'Before DST',
            goal_type: 'task',
            // March 11, 2023 at 12:00 UTC (7:00 AM EST)
            start_timestamp: new Date(Date.UTC(2023, 2, 11, 12, 0)).getTime(),
            end_timestamp: new Date(Date.UTC(2023, 2, 11, 13, 0)).getTime(),
            scheduled_timestamp: new Date(Date.UTC(2023, 2, 11, 12, 0)).getTime(),
            duration: 60,
            _tz: 'utc'
        };

        const afterDST: Goal = {
            id: 2,
            name: 'After DST',
            goal_type: 'task',
            // March 12, 2023 at 12:00 UTC (8:00 AM EDT)
            start_timestamp: new Date(Date.UTC(2023, 2, 12, 12, 0)).getTime(),
            end_timestamp: new Date(Date.UTC(2023, 2, 12, 13, 0)).getTime(),
            scheduled_timestamp: new Date(Date.UTC(2023, 2, 12, 12, 0)).getTime(),
            duration: 60,
            _tz: 'utc'
        };

        // Set up mock API response
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValueOnce({
            events: [
                {
                    id: '1',
                    title: 'Before DST',
                    start: new Date(beforeDST.start_timestamp!),
                    end: new Date(beforeDST.end_timestamp!),
                    allDay: false,
                    type: 'scheduled',
                    goal: beforeDST
                },
                {
                    id: '2',
                    title: 'After DST',
                    start: new Date(afterDST.start_timestamp!),
                    end: new Date(afterDST.end_timestamp!),
                    allDay: false,
                    type: 'scheduled',
                    goal: afterDST
                }
            ],
            scheduled_tasks: [beforeDST, afterDST],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Import and render the Calendar component
        const Calendar = await importCalendar();
        render(
            <TestWrapper>
                <Calendar />
            </TestWrapper>
        );

        // Wait for the calendar to load
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Convert goals to local time
        const localBeforeDST = goalToLocal(beforeDST);
        const localAfterDST = goalToLocal(afterDST);

        // Verify the offset differences
        // Before DST: 5 hours difference
        expect(localBeforeDST.start_timestamp).toBe(beforeDST.start_timestamp! - (300 * 60 * 1000));

        // After DST: 4 hours difference
        expect(localAfterDST.start_timestamp).toBe(afterDST.start_timestamp! - (240 * 60 * 1000));

        restoreDST();
    });

    test('handles date click to open GoalMenu with correct local time', async () => {
        // Mock timezone to PST (-8 hours, offset 480 minutes)
        const restoreOffset = mockTimezoneOffset(480);

        // Set up mock API response
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValueOnce({
            events: [],
            scheduled_tasks: [],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Import and render component
        const Calendar = await importCalendar();
        render(
            <TestWrapper>
                <Calendar />
            </TestWrapper>
        );

        // Wait for the calendar to load and fetch data
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Simulate a date click
        const mockClickDate = new Date(2023, 0, 1, 10, 0, 0); // Jan 1, 2023 10:00 AM
        const mockArg = { date: mockClickDate, allDay: false };

        // Get the FullCalendar instance prop callback
        const mockFC = screen.getByTestId('fullcalendar-mock');
        const props = require('@fullcalendar/react').default.mock.calls[0][0];

        // Manually call the dateClick callback to simulate a calendar click
        props.dateClick(mockArg);

        // Verify that the GoalMenu.open was called with correct time
        expect(GoalMenu.open).toHaveBeenCalled();

        // Check if the goal passed to GoalMenu.open has timestamp in user timezone
        const passedGoal = (GoalMenu.open as jest.Mock).mock.calls[0][0];
        expect(passedGoal._tz).toBe('user');

        restoreOffset();
    });

    test('handles event drag to update goal with correct UTC time', async () => {
        // Mock timezone to EST (-5 hours, offset 300 minutes)
        const restoreOffset = mockTimezoneOffset(300);

        // Prepare test data
        const originalTask: Goal = {
            id: 1,
            name: 'Test Task',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
            end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z
            scheduled_timestamp: 1672574400000,
            duration: 60,
            _tz: 'utc'
        };

        // Set up mock API response
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValueOnce({
            events: [{
                id: '1',
                title: 'Test Task',
                start: new Date(originalTask.start_timestamp!),
                end: new Date(originalTask.end_timestamp!),
                allDay: false,
                type: 'scheduled',
                goal: originalTask
            }],
            scheduled_tasks: [originalTask],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Mock updateGoal to return the updated goal
        const { updateGoal } = require('../../shared/utils/api');
        (updateGoal as jest.Mock).mockImplementation((id, goal) => {
            return Promise.resolve(goal);
        });

        // Import and render the Calendar component
        const Calendar = await importCalendar();
        render(
            <TestWrapper>
                <Calendar />
            </TestWrapper>
        );

        // Wait for the calendar to load
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Simulate drag event - create a new date 1 hour later
        const newStartDate = new Date(originalTask.start_timestamp! + 3600000);
        const newEndDate = new Date(originalTask.end_timestamp! + 3600000);

        // Create mock event objects for FullCalendar's eventDrop handler
        const mockEventDropArg = {
            event: {
                id: '1',
                title: 'Test Task',
                start: newStartDate,
                end: newEndDate,
                allDay: false,
                extendedProps: { goal: originalTask }
            },
            oldEvent: {
                start: new Date(originalTask.start_timestamp!),
                end: new Date(originalTask.end_timestamp!)
            },
            revert: jest.fn()
        };

        // Get the FullCalendar instance prop callback
        const props = require('@fullcalendar/react').default.mock.calls[0][0];

        // Manually call the eventDrop callback to simulate a drag
        await props.eventDrop(mockEventDropArg);

        // Verify updateGoal was called
        expect(updateGoal).toHaveBeenCalled();

        // Check that the goal sent to API had timestamps in UTC
        const updatedGoal = (updateGoal as jest.Mock).mock.calls[0][1];
        expect(updatedGoal._tz).toBe('utc');

        restoreOffset();
    });

    test('handles event resize to update duration correctly', async () => {
        // Mock timezone to CST (-6 hours, offset 360 minutes)
        const restoreOffset = mockTimezoneOffset(360);

        // Prepare test data
        const originalTask: Goal = {
            id: 1,
            name: 'Test Task',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
            end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z
            scheduled_timestamp: 1672574400000,
            duration: 60, // 1 hour
            _tz: 'utc'
        };

        // Set up mock API response
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValueOnce({
            events: [{
                id: '1',
                title: 'Test Task',
                start: new Date(originalTask.start_timestamp!),
                end: new Date(originalTask.end_timestamp!),
                allDay: false,
                type: 'scheduled',
                goal: originalTask
            }],
            scheduled_tasks: [originalTask],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Mock updateGoal to return the updated goal
        const { updateGoal } = require('../../shared/utils/api');
        (updateGoal as jest.Mock).mockImplementation((id, goal) => {
            return Promise.resolve(goal);
        });

        // Import and render the Calendar component
        const Calendar = await importCalendar();
        render(
            <TestWrapper>
                <Calendar />
            </TestWrapper>
        );

        // Wait for the calendar to load
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Simulate resize event - create a new end time 30 minutes later
        // This should make the event 90 minutes (1.5 hours) instead of 60 minutes
        const newEndDate = new Date(originalTask.end_timestamp! + 1800000);

        // Create mock event objects for FullCalendar's eventResize handler
        const mockEventResizeArg = {
            event: {
                id: '1',
                title: 'Test Task',
                start: new Date(originalTask.start_timestamp!),
                end: newEndDate,
                allDay: false,
                extendedProps: { goal: originalTask }
            },
            oldEvent: {
                start: new Date(originalTask.start_timestamp!),
                end: new Date(originalTask.end_timestamp!)
            },
            revert: jest.fn()
        };

        // Get the FullCalendar instance prop callback
        const props = require('@fullcalendar/react').default.mock.calls[0][0];

        // Manually call the eventResize callback
        await props.eventResize(mockEventResizeArg);

        // Verify updateGoal was called
        expect(updateGoal).toHaveBeenCalled();

        // Check that the duration was updated correctly
        const updatedGoal = (updateGoal as jest.Mock).mock.calls[0][1];
        expect(updatedGoal.duration).toBe(90); // 1.5 hours = 90 minutes

        restoreOffset();
    });
}); 