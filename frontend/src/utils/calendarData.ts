import { Goal, CalendarResponse, CalendarEvent, CalendarTask } from '../types';
import { privateRequest } from './api';

export interface TransformedCalendarData {
    events: CalendarEvent[];
    unscheduledTasks: CalendarTask[];
    achievements: CalendarEvent[];
}


export const fetchCalendarData = async (): Promise<TransformedCalendarData> => {
    try {
        const response = await privateRequest<CalendarResponse>('calender');
        console.log(response);
        const currentDate = new Date();
        const routineEvents = response.routines.map(routine =>
            generateRoutineEvents(routine, currentDate)
        ).flat();
        const scheduledEvents = [...response.routines, ...response.assigned_tasks]
            .filter(item => item.scheduled_timestamp)
            .map(item => ({
                id: `scheduled-${item.id || Date.now()}`,
                title: item.name,
                start: new Date(item.scheduled_timestamp!),
                end: new Date(new Date(item.scheduled_timestamp!).setHours(
                    new Date(item.scheduled_timestamp!).getHours() + 1
                )),
                type: mapGoalTypeToTaskType(item.goal_type)
            } as CalendarEvent));
        const unscheduledTasks = [...response.routines, ...response.assigned_tasks]
            .filter(item => !item.scheduled_timestamp)
            .map(item => ({
                id: (item.id || Date.now()).toString(),
                title: item.name,
                type: mapGoalTypeToTaskType(item.goal_type)
            }));
        const achievementEvents = response.achievements.map(achievement => {
            const completionTime = achievement.completed ?
                (typeof achievement.completed === 'number' ? achievement.completed : Date.now())
                : Date.now();

            return {
                id: `achievement-${achievement.id || Date.now()}`,
                title: achievement.name,
                start: new Date(completionTime),
                end: new Date(new Date(completionTime).setHours(
                    new Date(completionTime).getHours() + 1
                )),
                type: 'task' as const
            };
        });
        console.log(routineEvents);

        return {
            events: [...routineEvents, ...scheduledEvents] as CalendarEvent[],
            unscheduledTasks: unscheduledTasks as CalendarTask[],
            achievements: achievementEvents as CalendarEvent[]
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

const generateRoutineEvents = (routine: Goal, currentDate: Date): CalendarEvent[] => {
    const initialStartDate = new Date(Math.max(routine.start_timestamp!, currentDate.getTime() + 24 * 60 * 60 * 1000));
    const end = routine.end_timestamp ? new Date(routine.end_timestamp) : new Date('2029-12-31');
    const events: CalendarEvent[] = [];

    let currentDateIter = new Date(initialStartDate);
    while (currentDateIter <= end) {
        const eventStart = new Date(currentDateIter);
        const eventEnd = new Date(eventStart);
        eventEnd.setHours(eventEnd.getHours() + 1);

        events.push({
            id: `routine-${routine.id}-${currentDateIter.getTime()}`,
            title: routine.name,
            start: eventStart,
            end: eventEnd,
            type: 'task',
            goal: routine
        });

        // Increment based on frequency
        switch (routine.frequency) {
            case 'P1D':
                currentDateIter.setDate(currentDateIter.getDate() + 1);
                break;
            case 'P1W':
                currentDateIter.setDate(currentDateIter.getDate() + 7);
                break;
            // Add other frequency patterns as needed
        }
    }

    return events;
}; 