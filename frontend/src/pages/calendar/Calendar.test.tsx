import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { goalToLocal } from '../../shared/utils/time';
import { Goal } from '../../types/goals';

// Import the API
jest.mock('../../shared/utils/api', () => ({
    fetchCalendarData: jest.fn(),
    createGoal: jest.fn(),
    updateGoal: jest.fn()
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
}); 