import { CalendarResponse, CalendarEvent, CalendarTask, CalendarTasksResponse, ApiGoal } from '../../types/goals';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';

export interface TransformedCalendarData {
    events: CalendarEvent[];
    unscheduledTasks: CalendarTask[];
    achievements: CalendarEvent[];
}

interface DateRange {
    start: Date;
    end: Date;
}

export const fetchCalendarData = async (dateRange?: DateRange): Promise<TransformedCalendarData> => {
    try {
        const params =
            dateRange && dateRange.start && dateRange.end
                ? {
                    start: dateRange.start.getTime(),
                    end: dateRange.end.getTime(),
                }
                : undefined;

        const response = await privateRequest<CalendarResponse>('calendar', 'GET', undefined, params);

        if (!response) {
            console.error('Empty calendar response');
            return { events: [], unscheduledTasks: [], achievements: [] };
        }

        const parentsById = new Map(
            (response.parents || []).map(parent => [parent.id, parent])
        );

        const events: CalendarEvent[] = (response.events || []).map(apiEvent => {
            const event = goalToLocal(apiEvent as ApiGoal);
            const parent = event.parent_id != null ? parentsById.get(event.parent_id) : undefined;
            const parentGoal = parent ? goalToLocal(parent as ApiGoal) : undefined;

            return {
                id: `event-${event.id}`,
                title: event.name,
                start: new Date(event.scheduled_timestamp!),
                end: new Date(event.scheduled_timestamp!.getTime() + (event.duration! * 60 * 1000)),
                type: 'event',
                goal: event,
                parent: parentGoal,
                allDay: event.duration === 1440
            };
        });

        return {
            events,
            unscheduledTasks: [],
            achievements: []
        };
    } catch (error) {
        console.error('Failed to fetch calendar data:', error);
        return {
            events: [],
            unscheduledTasks: [],
            achievements: []
        };
    }
};

export const fetchCalendarTasks = async (): Promise<CalendarTask[]> => {
    try {
        const response = await privateRequest<CalendarTasksResponse>('calendar/tasks');
        if (!response) {
            return [];
        }
        return (response.tasks || []).map(apiTask => {
            const goal = goalToLocal({
                id: apiTask.id,
                name: apiTask.name,
                goal_type: apiTask.goal_type,
                duration: apiTask.duration,
                priority: apiTask.priority,
                start_timestamp: apiTask.start_timestamp ?? undefined,
                end_timestamp: apiTask.end_timestamp ?? undefined,
                resolution_status: apiTask.resolution_status,
            } as ApiGoal);
            const next = apiTask.next_uncompleted;
            return {
                id: String(apiTask.id),
                title: apiTask.name,
                type: mapGoalTypeToTaskType(apiTask.goal_type),
                goal,
                eventCount: apiTask.event_count ?? 0,
                completedEventCount: apiTask.completed_event_count ?? 0,
                pastUncompletedCount: apiTask.past_uncompleted_count ?? 0,
                futureUncompletedCount: apiTask.future_uncompleted_count ?? 0,
                nextEventDate: typeof next === 'number' ? new Date(next) : undefined,
            };
        });
    } catch (error) {
        console.error('Failed to fetch calendar tasks:', error);
        return [];
    }
};

const mapGoalTypeToTaskType = (goalType: string): 'meeting' | 'task' | 'appointment' => {
    switch (goalType) {
        case 'routine':
            return 'appointment';
        case 'project':
            return 'meeting';
        case 'achievement':
            return 'task';
        case 'directive':
            return 'task';
        default:
            return 'task';
    }
};
