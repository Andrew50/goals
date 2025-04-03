import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { goalToLocal } from '../../shared/utils/time';
import { Goal } from '../../types/goals';

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

        // Import and render the Calendar component
        const Calendar = await importCalendar();
        render(<Calendar />);

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
        render(<Calendar />);

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

        // Clean up
        restoreDST();
    });

    test('handles date click to open GoalMenu with correct local time', async () => {
        // Mock timezone to PST (-8 hours, offset 480 minutes)
        const restoreOffset = mockTimezoneOffset(480);

        // Reset/spy on the GoalMenu.open method without reassigning GoalMenu
        const mockGoalMenuOpen = jest.fn();
        const originalOpen = GoalMenu.open;
        GoalMenu.open = mockGoalMenuOpen;

        // Get the Calendar component
        const Calendar = await importCalendar();
        render(<Calendar />);

        // Wait for calendar to load
        await waitFor(() => {
            expect(screen.getByTestId('fullcalendar-mock')).toBeInTheDocument();
        });

        // Get the handleDateClick function
        // We're testing this in isolation since it's difficult to simulate a date click directly
        const calendarInstance = (Calendar as any).prototype;
        const handleDateClick = calendarInstance.handleDateClick;

        // Mock date click event at a specific time (10:30 AM PST on January 15, 2023)
        const mockDateClickEvent = {
            date: new Date(2023, 0, 15, 10, 30), // Local time
            dateStr: '2023-01-15',
            allDay: false,
            resource: null,
            dayEl: document.createElement('div'),
            jsEvent: {} as MouseEvent,
            view: {}
        };

        // Call the handler directly
        handleDateClick.call({ state: { events: [] } }, mockDateClickEvent);

        // Verify GoalMenu.open was called with a goal having the correct scheduled_timestamp
        expect(mockGoalMenuOpen).toHaveBeenCalled();

        // Extract the goal that was passed to GoalMenu.open
        const goalPassedToMenu = mockGoalMenuOpen.mock.calls[0][0];

        // The scheduled_timestamp should be in local time (PST)
        expect(goalPassedToMenu._tz).toBe('user');
        expect(goalPassedToMenu.scheduled_timestamp).toBe(mockDateClickEvent.date.getTime());

        // Verify the time is correct (10:30 AM)
        const scheduledDate = new Date(goalPassedToMenu.scheduled_timestamp);
        expect(scheduledDate.getHours()).toBe(10);
        expect(scheduledDate.getMinutes()).toBe(30);

        // Restore original method at the end
        GoalMenu.open = originalOpen;
        restoreOffset();
    });

    test('handles event drag to update goal with correct UTC time', async () => {
        // Mock timezone to EST (-5 hours, offset 300 minutes)
        const restoreOffset = mockTimezoneOffset(300);

        // Set up mock for updateGoal
        const { updateGoal } = require('../../shared/utils/api');
        (updateGoal as jest.Mock).mockResolvedValue({});

        // Create a sample UTC goal (will be displayed in local time)
        const utcGoal: Goal = {
            id: 1,
            name: 'Draggable Task',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z (7:00 AM EST)
            end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z (8:00 AM EST)
            scheduled_timestamp: 1672574400000, // Same as start
            duration: 60, // 1 hour
            _tz: 'utc'
        };

        // Mock API response with our task
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValue({
            scheduled_tasks: [utcGoal],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Import and render the Calendar component
        const Calendar = await importCalendar();
        render(<Calendar />);

        // Wait for the calendar to load
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Get the handleEventDrop function
        const calendarInstance = (Calendar as any).prototype;
        const handleEventDrop = calendarInstance.handleEventDrop;

        // Create a mock event drop with a new time (10:30 AM EST on January 2, 2023)
        const newStartDate = new Date(2023, 0, 2, 10, 30); // Local time (EST)
        const newEndDate = new Date(2023, 0, 2, 11, 30);   // 1 hour later

        const mockDropEvent = {
            event: {
                id: '1', // Should match the goal ID
                title: 'Draggable Task',
                start: newStartDate,
                end: newEndDate,
                allDay: false,
                extendedProps: {
                    goal: utcGoal,
                    type: 'scheduled'
                }
            },
            oldEvent: {
                // Previous state, not needed for this test
            },
            delta: {}, // Time difference, not needed for this test
            revert: jest.fn(),
            jsEvent: {},
            view: {}
        };

        // Call the handler directly
        await handleEventDrop.call({ state: { events: [] }, setState: jest.fn() }, mockDropEvent);

        // Verify updateGoal was called
        expect(updateGoal).toHaveBeenCalled();

        // Get the arguments passed to updateGoal
        const [id, updatedGoal] = (updateGoal as jest.Mock).mock.calls[0];

        // Verify goal ID
        expect(id).toBe(1);

        // Verify timezone is UTC
        expect(updatedGoal._tz).toBe('utc');

        // Verify the new scheduled_timestamp is in UTC
        // 10:30 AM EST = 15:30 UTC (add 5 hours)
        const expectedLocalTimestamp = newStartDate.getTime();
        const expectedUTCTimestamp = expectedLocalTimestamp + (300 * 60 * 1000);

        expect(updatedGoal.scheduled_timestamp).toBe(expectedUTCTimestamp);

        // Verify the time in UTC
        const scheduledUTCDate = new Date(updatedGoal.scheduled_timestamp);
        expect(scheduledUTCDate.getUTCHours()).toBe(15); // 10:30 AM EST + 5h = 15:30 UTC 
        expect(scheduledUTCDate.getUTCMinutes()).toBe(30);

        restoreOffset();
    });

    test('handles event resize to update duration correctly', async () => {
        // Mock timezone to CST (-6 hours, offset 360 minutes)
        const restoreOffset = mockTimezoneOffset(360);

        // Set up mock for updateGoal
        const { updateGoal } = require('../../shared/utils/api');
        (updateGoal as jest.Mock).mockResolvedValue({});

        // Create a sample UTC goal
        const utcGoal: Goal = {
            id: 1,
            name: 'Resizable Task',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z (6:00 AM CST)
            end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z (7:00 AM CST)
            scheduled_timestamp: 1672574400000, // Same as start
            duration: 60, // 1 hour
            _tz: 'utc'
        };

        // Mock API response with our task
        const { fetchCalendarData } = require('../../shared/utils/api');
        (fetchCalendarData as jest.Mock).mockResolvedValue({
            scheduled_tasks: [utcGoal],
            unscheduled_tasks: [],
            routines: [],
            achievements: []
        });

        // Import and render the Calendar component
        const Calendar = await importCalendar();
        render(<Calendar />);

        // Wait for the calendar to load
        await waitFor(() => {
            expect(fetchCalendarData).toHaveBeenCalled();
        });

        // Get the handleEventResize function
        const calendarInstance = (Calendar as any).prototype;
        const handleEventResize = calendarInstance.handleEventResize;

        // Same start time but 2 hours duration instead of 1
        const sameStartDate = new Date(2023, 0, 1, 6, 0); // Local time (CST)
        const newEndDate = new Date(2023, 0, 1, 8, 0);   // 2 hours later

        const mockResizeEvent = {
            event: {
                id: '1', // Should match the goal ID
                title: 'Resizable Task',
                start: sameStartDate, // Start time stays the same
                end: newEndDate,      // End time changes
                allDay: false,
                extendedProps: {
                    goal: utcGoal,
                    type: 'scheduled'
                }
            },
            prevEvent: {
                // Previous state, not needed for this test
            },
            endDelta: {}, // Time difference, not needed for this test
            revert: jest.fn(),
            jsEvent: {},
            view: {}
        };

        // Call the handler directly
        await handleEventResize.call({ state: { events: [] }, setState: jest.fn() }, mockResizeEvent);

        // Verify updateGoal was called
        expect(updateGoal).toHaveBeenCalled();

        // Get the arguments passed to updateGoal
        const [id, updatedGoal] = (updateGoal as jest.Mock).mock.calls[0];

        // Verify goal ID
        expect(id).toBe(1);

        // Verify timezone is UTC
        expect(updatedGoal._tz).toBe('utc');

        // The scheduled_timestamp should remain the same
        expect(updatedGoal.scheduled_timestamp).toBe(utcGoal.scheduled_timestamp);

        // The duration should now be 120 minutes (2 hours)
        expect(updatedGoal.duration).toBe(120);

        restoreOffset();
    });
}); 