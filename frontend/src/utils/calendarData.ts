import { Goal, CalendarResponse, CalendarEvent, CalendarTask, goalToLocal } from '../types';
import { privateRequest } from './api';

const ROUTINE_GENERATION_DAYS = 90;
export interface TransformedCalendarData {
    events: CalendarEvent[];
    unscheduledTasks: CalendarTask[];
    achievements: CalendarEvent[];
}


export const fetchCalendarData = async (): Promise<TransformedCalendarData> => {
    try {
        const response = await privateRequest<CalendarResponse>('calender');
        const currentDate = new Date();

        // Convert routines to local timezone before generating events
        const localRoutines = response.routines.map(goalToLocal);

        // Generate routine events with local timezone data
        const routineEvents = localRoutines.map(routine =>
            generateRoutineEvents(routine, currentDate)
        ).flat();

        // Handle scheduled tasks with local timezone
        const scheduledEvents = response.scheduled_tasks
            .map(goalToLocal)
            .filter(item => item.scheduled_timestamp)
            .map(item => {
                const start = new Date(item.scheduled_timestamp!);
                return {
                    id: `scheduled-${item.id || Date.now()}`,
                    title: item.name,
                    start,
                    end: new Date(start.getTime() + (item.duration || 60) * 60 * 1000),
                    type: 'scheduled',
                    goal: item,
                    allDay: item.duration === 1440  // true if duration is 24 hours
                } as CalendarEvent;
            });

        // Handle unscheduled tasks with local timezone
        const unscheduledTasks = response.unscheduled_tasks
            .map(goalToLocal)  // Convert to local timezone first
            .filter(item => !item.scheduled_timestamp)
            .map(item => ({
                id: (item.id || Date.now()).toString(),
                title: item.name,
                type: mapGoalTypeToTaskType(item.goal_type),
                goal: item
            } as CalendarTask));

        // Handle achievements with local timezone
        const achievementEvents = response.achievements
            .map(goalToLocal)
            .map(achievement => {
                const completionTime = achievement.completed ?
                    (typeof achievement.completed === 'number' ? achievement.completed : Date.now())
                    : Date.now();
                const start = new Date(completionTime);

                return {
                    id: `achievement-${achievement.id || Date.now()}`,
                    title: achievement.name,
                    start,
                    end: new Date(start.getTime() + 60 * 60 * 1000),
                    type: 'achievement',
                    goal: achievement,
                    allDay: false
                } as CalendarEvent;
            });


        return {
            events: [...routineEvents, ...scheduledEvents, ...achievementEvents] as CalendarEvent[],
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
    if (!routine.routine_time || !routine.start_timestamp) {
        console.warn(`Routine ${routine.name} is missing required time fields`);
        return [];
    }

    const events: CalendarEvent[] = [];
    const initialStartDate = new Date(Math.max(routine.start_timestamp, currentDate.getTime()));
    const end = new Date(currentDate);
    end.setDate(end.getDate() + ROUTINE_GENERATION_DAYS);

    // Extract hours and minutes from routine_time
    const routineHours = Math.floor(routine.routine_time / (60 * 60 * 1000));
    const routineMinutes = Math.floor((routine.routine_time % (60 * 60 * 1000)) / (60 * 1000));

    let currentDateIter = new Date(initialStartDate);
    while (currentDateIter <= end) {
        const eventStart = new Date(currentDateIter);
        eventStart.setHours(routineHours, routineMinutes, 0, 0);

        const eventEnd = new Date(eventStart);
        const durationInMinutes = routine.duration || 60;
        eventEnd.setMinutes(eventStart.getMinutes() + durationInMinutes);

        events.push({
            id: `routine-${routine.id}-${currentDateIter.getTime()}`,
            title: routine.name,
            start: eventStart,
            end: eventEnd,
            type: 'routine',
            goal: routine,
            allDay: routine.duration === 1440  // true if duration is 24 hours
        } as CalendarEvent);

        // Move to next occurrence based on frequency
        if (routine.frequency === 'P1D') {
            currentDateIter.setDate(currentDateIter.getDate() + 1);
        } else if (routine.frequency === 'P1W') {
            currentDateIter.setDate(currentDateIter.getDate() + 7);
        }
    }

    return events;
}; 