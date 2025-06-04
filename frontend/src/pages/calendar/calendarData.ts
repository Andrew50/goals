import { CalendarResponse, CalendarEvent, CalendarTask, ApiGoal } from '../../types/goals';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import { getGoalColor } from '../../shared/styles/colors';

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
        // Make API request to calendar endpoint
        const response = await privateRequest<CalendarResponse>('calendar');

        if (!response) {
            console.error('Empty calendar response');
            return {
                events: [],
                unscheduledTasks: [],
                achievements: []
            };
        }

        // Process events - much simpler now!
        const events: CalendarEvent[] = (response.events || []).map(apiEvent => {
            // Convert API goal to local timezone
            const event = goalToLocal(apiEvent as ApiGoal);

            // Find the parent if available
            const parent = response.parents?.find(p => p.id === event.parent_id);
            const parentGoal = parent ? goalToLocal(parent as ApiGoal) : undefined;

            // Create calendar event
            const calendarEvent: CalendarEvent = {
                id: `event-${event.id}`,
                title: event.name, // Always inherited from parent
                start: new Date(event.scheduled_timestamp!),
                end: new Date(event.scheduled_timestamp!.getTime() + (event.duration! * 60 * 1000)),
                type: 'event', // Always 'event' now
                goal: event, // The event goal
                parent: parentGoal, // The parent task/routine
                allDay: event.duration === 1440,
                backgroundColor: getGoalColor(parentGoal || event),
                borderColor: getGoalColor(parentGoal || event),
                textColor: '#fff'
            };

            return calendarEvent;
        });

        // Process unscheduled tasks
        const unscheduledTasks: CalendarTask[] = (response.unscheduled_tasks || []).map(apiTask => {
            const task = goalToLocal(apiTask as ApiGoal);

            return {
                id: task.id.toString(),
                title: task.name,
                type: mapGoalTypeToTaskType(task.goal_type),
                goal: task
            };
        });

        // Process achievements if needed (keeping for compatibility)
        const achievements: CalendarEvent[] = (response.achievements || []).map(apiAchievement => {
            const achievement = goalToLocal(apiAchievement as ApiGoal);

            if (!achievement.end_timestamp) {
                return null;
            }

            const end = new Date(achievement.end_timestamp);
            return {
                id: `achievement-${achievement.id}`,
                title: achievement.name,
                start: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0),
                end: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999),
                type: 'event',
                goal: achievement,
                allDay: true,
                backgroundColor: getGoalColor(achievement),
                borderColor: getGoalColor(achievement),
                textColor: '#fff'
            };
        }).filter(Boolean) as CalendarEvent[];

        return {
            events,
            unscheduledTasks,
            achievements
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
