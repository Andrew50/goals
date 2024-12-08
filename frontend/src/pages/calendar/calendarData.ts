import { Goal, CalendarResponse, CalendarEvent, CalendarTask } from '../../types/goals';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';

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
        console.log(response.routines);
        const localRoutines = response.routines.map(goalToLocal);
        console.log(localRoutines);

        // Generate routine events with local timezone data
        const routineEvents = localRoutines.map(routine =>
            generateRoutineEvents(routine, currentDate)
        ).flat();

        // Handle scheduled tasks with local timezone
        const scheduledEvents = response.scheduled_tasks
            .map(goalToLocal)
            .filter(item => item.scheduled_timestamp)
            .map(item => {
                const isAllDay = item.duration === 1440;

                // Parse the timestamp maintaining local time, as the timestamp has already been converted to client tz
                const timestamp = new Date(item.scheduled_timestamp!);
                const start = new Date(
                    timestamp.getUTCFullYear(),
                    timestamp.getUTCMonth(),
                    timestamp.getUTCDate(),
                    timestamp.getUTCHours(),
                    timestamp.getUTCMinutes(),
                    timestamp.getUTCSeconds()
                );

                console.log('Original timestamp:', item.scheduled_timestamp);
                console.log('Constructed local date:', start);

                return {
                    id: `scheduled-${item.id || Date.now()}`,
                    title: item.name,
                    start: isAllDay ? new Date(start.setHours(0, 0, 0, 0)) : start,
                    end: isAllDay
                        ? new Date(start.setHours(23, 59, 59, 999))
                        : new Date(start.getTime() + (item.duration || 60) * 60 * 1000),
                    type: 'scheduled',
                    goal: item,
                    allDay: isAllDay,
                    timezone: 'local'
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

        // Handle achievements with local timezone - all achievements are all-day events
        const achievementEvents = response.achievements
            .map(goalToLocal)
            .filter(achievement => achievement.end_timestamp)
            .map(achievement => {
                const end = new Date(achievement.end_timestamp!);
                return {
                    id: `achievement-${achievement.id || Date.now()}`,
                    title: achievement.name,
                    start: new Date(end.setHours(0, 0, 0, 0)), // Set to start of day
                    end: new Date(end.setHours(23, 59, 59, 999)), // Set to end of day
                    type: 'achievement',
                    goal: achievement,
                    allDay: true // Always true for achievements
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
    const isAllDay = routine.duration === 1440;

    // Create start date at the beginning of tomorrow in client's timezone
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const initialStartDate = new Date(Math.max(routine.start_timestamp, tomorrow.getTime()));
    const end = new Date(currentDate);
    end.setDate(end.getDate() + ROUTINE_GENERATION_DAYS);

    // Create a date object with the routine time in local timezone
    //const routineTimeDate = new Date(routine.routine_time + 'Z');
    const routineTimeDate = new Date(routine.routine_time);
    //const routineHours = routineTimeDate.getHours();
    //const routineMinutes = routineTimeDate.getMinutes();
    const routineHours = routineTimeDate.getUTCHours();
    const routineMinutes = routineTimeDate.getUTCMinutes();

    let currentDateIter = new Date(initialStartDate);
    while (currentDateIter <= end) {
        const eventStart = new Date(currentDateIter);

        if (isAllDay) {
            eventStart.setHours(0, 0, 0, 0);
        } else {
            eventStart.setHours(routineHours, routineMinutes, 0, 0);
        }

        const eventEnd = new Date(eventStart);
        if (isAllDay) {
            eventEnd.setHours(23, 59, 59, 999);
        } else {
            const durationInMinutes = routine.duration || 60;
            eventEnd.setMinutes(eventStart.getMinutes() + durationInMinutes);
        }

        events.push({
            id: `routine-${routine.id}-${currentDateIter.getTime()}`,
            title: routine.name,
            start: eventStart,
            end: eventEnd,
            type: 'routine',
            goal: routine,
            allDay: isAllDay
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
