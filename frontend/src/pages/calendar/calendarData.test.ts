import { fetchCalendarData, fetchCalendarTasks } from './calendarData';
import { privateRequest } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
}));

const api = privateRequest as jest.Mock;

describe('calendarData', () => {
    beforeEach(() => {
        api.mockReset();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        (console.error as jest.Mock).mockRestore();
    });

    test('returns empty collections when the calendar response is missing', async () => {
        api.mockResolvedValueOnce(null);
        await expect(fetchCalendarData()).resolves.toEqual({
            events: [],
            unscheduledTasks: [],
            achievements: [],
        });
        expect(api).toHaveBeenCalledWith('calendar', 'GET', undefined, undefined);
    });

    test('maps ranged events and attaches known parents', async () => {
        const start = new Date('2026-10-01T00:00:00Z');
        const end = new Date('2026-10-08T00:00:00Z');
        api.mockResolvedValueOnce({
            parents: [{ id: 9, name: 'Daily', goal_type: 'routine', frequency: '1D' }],
            events: [
                {
                    id: 1,
                    name: 'Standup',
                    goal_type: 'event',
                    scheduled_timestamp: start.getTime(),
                    duration: 30,
                    parent_id: 9,
                },
                {
                    id: 2,
                    name: 'All day',
                    goal_type: 'event',
                    scheduled_timestamp: start.getTime(),
                    duration: 1440,
                    parent_id: null,
                },
                {
                    id: 3,
                    name: 'Orphan',
                    goal_type: 'event',
                    scheduled_timestamp: start.getTime(),
                    duration: 15,
                    parent_id: 404,
                },
            ],
        });

        const data = await fetchCalendarData({ start, end });

        expect(api).toHaveBeenCalledWith('calendar', 'GET', undefined, {
            start: start.getTime(),
            end: end.getTime(),
        });
        expect(data.events.map((event) => event.title)).toEqual(['Standup', 'All day', 'Orphan']);
        expect(data.events[0].parent?.name).toBe('Daily');
        expect(data.events[0].allDay).toBe(false);
        expect(data.events[0].end.getTime() - data.events[0].start.getTime()).toBe(30 * 60 * 1000);
        expect(data.events[1].allDay).toBe(true);
        expect(data.events[1].parent).toBeUndefined();
        expect(data.events[2].parent).toBeUndefined();
        expect(data.unscheduledTasks).toEqual([]);
        expect(data.achievements).toEqual([]);
    });

    test('treats a response without events as an empty calendar', async () => {
        api.mockResolvedValueOnce({});
        const data = await fetchCalendarData();
        expect(data.events).toEqual([]);
    });

    test('returns empty collections when the calendar request fails', async () => {
        api.mockRejectedValueOnce(new Error('down'));
        await expect(fetchCalendarData({ start: new Date(), end: new Date() })).resolves.toEqual({
            events: [],
            unscheduledTasks: [],
            achievements: [],
        });
    });

    test('maps task goal types and optional counts', async () => {
        const next = 1700000000000;
        api.mockResolvedValueOnce({
            tasks: [
                {
                    id: 1,
                    name: 'Routine',
                    goal_type: 'routine',
                    duration: 20,
                    priority: 'high',
                    start_timestamp: next,
                    end_timestamp: null,
                    resolution_status: 'pending',
                    event_count: 2,
                    completed_event_count: 1,
                    past_uncompleted_count: 0,
                    future_uncompleted_count: 1,
                    next_uncompleted: next,
                },
                { id: 2, name: 'Project', goal_type: 'project' },
                { id: 3, name: 'Achievement', goal_type: 'achievement' },
                { id: 4, name: 'Directive', goal_type: 'directive' },
                { id: 5, name: 'Other', goal_type: 'task' },
            ],
        });

        const tasks = await fetchCalendarTasks();

        expect(tasks.map((task) => task.type)).toEqual([
            'appointment',
            'meeting',
            'task',
            'task',
            'task',
        ]);
        expect(tasks[0].nextEventDate).toEqual(new Date(next));
        expect(tasks[0].eventCount).toBe(2);
        expect(tasks[0].goal.start_timestamp).toEqual(new Date(next));
        expect(tasks[1].eventCount).toBe(0);
        expect(tasks[1].completedEventCount).toBe(0);
        expect(tasks[1].pastUncompletedCount).toBe(0);
        expect(tasks[1].futureUncompletedCount).toBe(0);
        expect(tasks[1].nextEventDate).toBeUndefined();
    });

    test('returns no tasks for an empty or failed response', async () => {
        api.mockResolvedValueOnce(null);
        await expect(fetchCalendarTasks()).resolves.toEqual([]);

        api.mockResolvedValueOnce({});
        await expect(fetchCalendarTasks()).resolves.toEqual([]);

        api.mockRejectedValueOnce(new Error('down'));
        await expect(fetchCalendarTasks()).resolves.toEqual([]);
    });
});
