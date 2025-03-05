import { Goal, CalendarResponse, CalendarEvent, CalendarTask } from '../../types/goals';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';

const ROUTINE_GENERATION_DAYS = 30; // Reduced from 90 to 30 days for performance
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
        // If no date range is provided, use current date and load one month
        const currentDate = new Date();
        const start = dateRange?.start || new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const end = dateRange?.end || new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        // Convert to timestamp for API request
        const startTimestamp = start.getTime();
        const endTimestamp = end.getTime();

        // Add date range params to the request
        const response = await privateRequest<CalendarResponse>(`calendar?start=${startTimestamp}&end=${endTimestamp}`);

        // Validate response data
        if (!response || !response.routines || !response.scheduled_tasks || !response.unscheduled_tasks || !response.achievements) {
            console.error('Invalid calendar response format:', response);
            return {
                events: [],
                unscheduledTasks: [],
                achievements: []
            };
        }

        // Convert routines to local timezone before generating events
        const localRoutines = response.routines.map(goalToLocal);

        // Generate routine events with local timezone data, but only within the date range
        let routineEvents: CalendarEvent[] = [];
        try {
            routineEvents = localRoutines.map(routine =>
                generateRoutineEvents(routine, currentDate, start, end)
            ).flat();
        } catch (error) {
            console.error('Error generating routine events:', error);
            routineEvents = [];
        }

        // Handle scheduled tasks with local timezone
        let scheduledEvents: CalendarEvent[] = [];
        try {
            scheduledEvents = response.scheduled_tasks
                .map(goalToLocal)
                .filter(item => {
                    // Filter tasks that fall within the date range
                    if (!item.scheduled_timestamp) return false;
                    const taskDate = new Date(item.scheduled_timestamp);
                    return taskDate >= start && taskDate <= end;
                })
                .map(item => {
                    const isAllDay = item.duration === 1440;
                    const timestamp = new Date(item.scheduled_timestamp!);

                    try {
                        const start = new Date(
                            timestamp.getUTCFullYear(),
                            timestamp.getUTCMonth(),
                            timestamp.getUTCDate(),
                            timestamp.getUTCHours(),
                            timestamp.getUTCMinutes(),
                            timestamp.getUTCSeconds()
                        );

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
                    } catch (error) {
                        console.error('Error processing scheduled event:', error, item);
                        return null;
                    }
                })
                .filter(Boolean) as CalendarEvent[];
        } catch (error) {
            console.error('Error processing scheduled events:', error);
            scheduledEvents = [];
        }

        // Handle unscheduled tasks with local timezone - limiting to most recent ones
        let unscheduledTasks: CalendarTask[] = [];
        try {
            unscheduledTasks = response.unscheduled_tasks
                .map(goalToLocal)
                .filter(item => !item.scheduled_timestamp)
                .map(item => ({
                    id: (item.id || Date.now()).toString(),
                    title: item.name,
                    type: mapGoalTypeToTaskType(item.goal_type),
                    goal: item
                } as CalendarTask));

            // Sort by end_timestamp and limit to 50 tasks for performance
            unscheduledTasks.sort((a, b) => {
                return (b.goal.end_timestamp || 0) - (a.goal.end_timestamp || 0);
            });
            unscheduledTasks = unscheduledTasks.slice(0, 50);
        } catch (error) {
            console.error('Error processing unscheduled tasks:', error);
            unscheduledTasks = [];
        }

        // Handle achievements with local timezone - only those within date range
        let achievementEvents: CalendarEvent[] = [];
        try {
            achievementEvents = response.achievements
                .map(goalToLocal)
                .filter(achievement => {
                    if (!achievement.end_timestamp) return false;
                    const achievementDate = new Date(achievement.end_timestamp);
                    return achievementDate >= start && achievementDate <= end;
                })
                .map(achievement => {
                    try {
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
                    } catch (error) {
                        console.error('Error processing achievement event:', error, achievement);
                        return null;
                    }
                })
                .filter(Boolean) as CalendarEvent[];
        } catch (error) {
            console.error('Error processing achievement events:', error);
            achievementEvents = [];
        }

        return {
            events: [...routineEvents, ...scheduledEvents, ...achievementEvents],
            unscheduledTasks,
            achievements: achievementEvents
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

const generateRoutineEvents = (
    routine: Goal,
    currentDate: Date,
    rangeStart: Date,
    rangeEnd: Date
): CalendarEvent[] => {
    const isAllDay = routine.duration === 1440;

    // Only check routine_time if it's not an all-day event
    if (!isAllDay && !routine.routine_time || !routine.start_timestamp) {
        console.warn(`Routine ${routine.name} is missing required time fields`);
        return [];
    }

    const events: CalendarEvent[] = [];

    // Use the provided range start date as the starting point
    const initialStartDate = new Date(
        Math.max(routine.start_timestamp, rangeStart.getTime())
    );

    // Use the provided range end date as the end point
    const end = rangeEnd;

    // Only create routineTimeDate if it's not an all-day event
    let routineHours = 0;
    let routineMinutes = 0;
    if (!isAllDay) {
        const routineTimeDate = new Date(routine.routine_time!);
        routineHours = routineTimeDate.getUTCHours();
        routineMinutes = routineTimeDate.getUTCMinutes();
    }

    // Parse frequency pattern: {multiplier}{unit}[:days]
    const frequencyMatch = routine.frequency?.match(/^(\d+)([DWMY])(?::(.+))?$/);
    if (!frequencyMatch) {
        console.warn(`Invalid frequency format for routine ${routine.name}`);
        return [];
    }

    const [_, intervalStr, unit, daysStr] = frequencyMatch;
    const interval = parseInt(intervalStr);
    const selectedDays = daysStr?.split(',').map(Number) || [];

    let currentDateIter = new Date(initialStartDate);
    while (currentDateIter <= end) {
        let shouldCreateEvent = true;

        // For weekly frequency, check if current day is in selected days
        if (unit === 'W' && selectedDays.length > 0) {
            const currentDay = currentDateIter.getDay(); // 0-6, Sunday-Saturday
            if (!selectedDays.includes(currentDay)) {
                shouldCreateEvent = false;
            }
        }

        if (shouldCreateEvent) {
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
        }

        // Move to next day
        currentDateIter.setDate(currentDateIter.getDate() + 1);

        // If we've moved past the interval, adjust to the next interval start
        if (unit !== 'W' || !selectedDays.length) {
            const daysSinceStart = Math.floor(
                (currentDateIter.getTime() - initialStartDate.getTime()) / (1000 * 60 * 60 * 24)
            );

            let intervalDays;
            switch (unit) {
                case 'D':
                    intervalDays = interval;
                    break;
                case 'W':
                    intervalDays = interval * 7;
                    break;
                case 'M':
                    intervalDays = interval * 30;
                    break;
                case 'Y':
                    intervalDays = interval * 365;
                    break;
                default:
                    intervalDays = interval;
            }

            if (daysSinceStart % intervalDays === 0) {
                // Skip to the start of the next interval
                currentDateIter.setDate(
                    initialStartDate.getDate() + Math.floor(daysSinceStart / intervalDays) * intervalDays
                );
            }
        }
    }

    return events;
}; 
