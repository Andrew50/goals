import { Goal, CalendarResponse, CalendarEvent, CalendarTask } from '../../types/goals';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';

// Reduced from 30 to 14 days for better performance
const ROUTINE_GENERATION_DAYS = 14;
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

        // Limit the date range to prevent processing too much data
        // Don't load more than 60 days of data at once
        const maxRangeMs = 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds
        const actualEnd = new Date(Math.min(end.getTime(), start.getTime() + maxRangeMs));

        // Convert to timestamp for API request
        const startTimestamp = start.getTime();
        const endTimestamp = actualEnd.getTime();

        console.log(`Fetching calendar data from ${start.toISOString()} to ${actualEnd.toISOString()}`);

        // Add date range params to the request
        console.log('Making API request to calender endpoint');
        const response = await privateRequest<CalendarResponse>('calender');
        console.log('Raw API response:', response);

        // Validate response data
        if (!response) {
            console.error('Empty calendar response');
            return {
                events: [],
                unscheduledTasks: [],
                achievements: []
            };
        }

        // Ensure all required properties exist
        const safeResponse = {
            routines: response.routines || [],
            scheduled_tasks: response.scheduled_tasks || [],
            unscheduled_tasks: response.unscheduled_tasks || [],
            achievements: response.achievements || []
        };

        // Limit the number of items to process
        const MAX_ITEMS = 100;
        const limitedRoutines = safeResponse.routines.slice(0, MAX_ITEMS);
        const limitedScheduledTasks = safeResponse.scheduled_tasks.slice(0, MAX_ITEMS);
        const limitedUnscheduledTasks = safeResponse.unscheduled_tasks.slice(0, MAX_ITEMS);
        const limitedAchievements = safeResponse.achievements.slice(0, MAX_ITEMS);

        // Convert routines to local timezone before generating events
        const localRoutines = limitedRoutines.map(routine => {
            try {
                return goalToLocal(routine);
            } catch (error) {
                console.error('Error converting routine to local timezone:', error, routine);
                return routine; // Return original if conversion fails
            }
        });

        // Generate routine events with local timezone data, but only within the date range
        let routineEvents: CalendarEvent[] = [];
        try {
            routineEvents = localRoutines.map(routine => {
                try {
                    return generateRoutineEvents(routine, currentDate, start, actualEnd);
                } catch (error) {
                    console.error('Error generating routine events:', error, routine);
                    return [];
                }
            }).flat();

            // Limit the number of routine events to prevent performance issues
            routineEvents = routineEvents.slice(0, MAX_ITEMS * 2);
        } catch (error) {
            console.error('Error generating all routine events:', error);
            routineEvents = [];
        }

        // Handle scheduled tasks with local timezone
        let scheduledEvents: CalendarEvent[] = [];
        try {
            console.log(`Processing ${limitedScheduledTasks.length} scheduled tasks`);

            const tasksWithTimestamp = limitedScheduledTasks.filter(task => !!task.scheduled_timestamp);
            console.log(`Found ${tasksWithTimestamp.length} tasks with scheduled_timestamp`);

            // Log the first few scheduled tasks for debugging
            if (tasksWithTimestamp.length > 0) {
                console.log('Sample scheduled tasks:', tasksWithTimestamp.slice(0, 3).map(task => ({
                    id: task.id,
                    name: task.name,
                    scheduled_timestamp: task.scheduled_timestamp,
                    timestamp_date: new Date(task.scheduled_timestamp!).toISOString()
                })));
            }

            scheduledEvents = limitedScheduledTasks
                .map(task => {
                    try {
                        return goalToLocal(task);
                    } catch (error) {
                        console.error('Error converting scheduled task to local timezone:', error, task);
                        return task; // Return original if conversion fails
                    }
                })
                .filter(item => {
                    // Filter tasks that fall within the date range
                    if (!item.scheduled_timestamp) {
                        console.log(`Task ${item.id} (${item.name}) has no scheduled_timestamp`);
                        return false;
                    }

                    // Log the timestamp and date for debugging
                    const taskDate = new Date(item.scheduled_timestamp);
                    console.log(`Task ${item.id} (${item.name}) timestamp: ${item.scheduled_timestamp}, date: ${taskDate.toISOString()}`);

                    // Expand the date range slightly to ensure edge cases are included
                    const expandedStart = new Date(start);
                    expandedStart.setDate(expandedStart.getDate() - 1);

                    const expandedEnd = new Date(actualEnd);
                    expandedEnd.setDate(expandedEnd.getDate() + 1);

                    const inRange = taskDate >= expandedStart && taskDate <= expandedEnd;

                    if (!inRange) {
                        console.log(`Task ${item.id} (${item.name}) is outside date range: ${taskDate.toISOString()}, range: ${expandedStart.toISOString()} to ${expandedEnd.toISOString()}`);
                    }

                    return inRange;
                })
                .map(item => {
                    try {
                        const isAllDay = item.duration === 1440;
                        const timestamp = new Date(item.scheduled_timestamp!);

                        const start = new Date(
                            timestamp.getFullYear(),
                            timestamp.getMonth(),
                            timestamp.getDate(),
                            timestamp.getHours(),
                            timestamp.getMinutes(),
                            timestamp.getSeconds()
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
            unscheduledTasks = limitedUnscheduledTasks
                .map(task => {
                    try {
                        return goalToLocal(task);
                    } catch (error) {
                        console.error('Error converting unscheduled task to local timezone:', error, task);
                        return task; // Return original if conversion fails
                    }
                })
                .filter(item => !item.scheduled_timestamp)
                .map(item => ({
                    id: (item.id || Date.now()).toString(),
                    title: item.name,
                    type: mapGoalTypeToTaskType(item.goal_type),
                    goal: item
                } as CalendarTask));

            // Sort by end_timestamp and limit to 100 tasks for performance
            unscheduledTasks.sort((a, b) => {
                return (b.goal.end_timestamp || 0) - (a.goal.end_timestamp || 0);
            });
            unscheduledTasks = unscheduledTasks.slice(0, 100);
            console.log(`Processed ${unscheduledTasks.length} unscheduled tasks`);
        } catch (error) {
            console.error('Error processing unscheduled tasks:', error);
            unscheduledTasks = [];
        }

        // Handle achievements with local timezone - only those within date range
        let achievementEvents: CalendarEvent[] = [];
        try {
            achievementEvents = limitedAchievements
                .map(achievement => {
                    try {
                        return goalToLocal(achievement);
                    } catch (error) {
                        console.error('Error converting achievement to local timezone:', error, achievement);
                        return achievement; // Return original if conversion fails
                    }
                })
                .filter(achievement => {
                    if (!achievement.end_timestamp) return false;
                    const achievementDate = new Date(achievement.end_timestamp);
                    return achievementDate >= start && achievementDate <= actualEnd;
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

        // Combine all events and limit the total number
        const allEvents = [...routineEvents, ...scheduledEvents, ...achievementEvents];
        const limitedEvents = allEvents.slice(0, MAX_ITEMS * 3);

        console.log(`Calendar data loaded: ${limitedEvents.length} events, ${unscheduledTasks.length} tasks`);
        console.log(`Events breakdown: ${routineEvents.length} routines, ${scheduledEvents.length} scheduled tasks, ${achievementEvents.length} achievements`);

        return {
            events: limitedEvents,
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
    try {
        // Validate inputs
        if (!routine || !routine.id) {
            console.warn('Invalid routine provided to generateRoutineEvents');
            return [];
        }

        const isAllDay = routine.duration === 1440;

        // Only check routine_time if it's not an all-day event
        if (!isAllDay && !routine.routine_time) {
            // Use a default time (9:00 AM) for routines missing routine_time instead of skipping them
            console.warn(`Routine ${routine.name} is missing routine_time, using default time`);
            // Create a timestamp for 9:00 AM today
            const defaultTime = new Date();
            defaultTime.setHours(9, 0, 0, 0);
            routine.routine_time = defaultTime.getTime();
        }

        if (!routine.start_timestamp) {
            console.warn(`Routine ${routine.name} is missing start_timestamp`);
            return [];
        }

        // Ensure we have valid date ranges
        if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
            console.warn('Invalid date range for routine event generation');
            return [];
        }

        const events: CalendarEvent[] = [];

        // Use the provided range start date as the starting point
        const initialStartDate = new Date(Math.max(routine.start_timestamp, rangeStart.getTime()));
        const end = rangeEnd;

        // Only create routineTimeDate if it's not an all-day event
        let routineHours = 0;
        let routineMinutes = 0;
        if (!isAllDay && routine.routine_time) {
            try {
                const routineTimeDate = new Date(routine.routine_time);
                routineHours = routineTimeDate.getHours();
                routineMinutes = routineTimeDate.getMinutes();
            } catch (error) {
                console.error('Error parsing routine time:', error, routine);
                return [];
            }
        }

        // Parse frequency pattern: {multiplier}{unit}[:days]
        if (!routine.frequency) {
            console.warn(`Routine ${routine.name} is missing frequency`);
            return [];
        }

        const frequencyMatch = routine.frequency.match(/^(\d+)([DWMY])(?::(.+))?$/);
        if (!frequencyMatch) {
            console.warn(`Invalid frequency format for routine ${routine.name}: ${routine.frequency}`);
            return [];
        }

        const [_, intervalStr, unit, daysStr] = frequencyMatch;
        const interval = parseInt(intervalStr);

        if (isNaN(interval) || interval <= 0) {
            console.warn(`Invalid interval for routine ${routine.name}: ${intervalStr}`);
            return [];
        }

        // Parse selected days for weekly routines
        let selectedDays: number[] = [];
        if (unit === 'W' && daysStr) {
            try {
                selectedDays = daysStr.split(',').map(Number);
                // Validate day numbers (0-6)
                selectedDays = selectedDays.filter(day => !isNaN(day) && day >= 0 && day <= 6);
            } catch (error) {
                console.error('Error parsing selected days:', error, daysStr);
                // Continue with empty selectedDays
            }
        }

        // Limit the number of iterations to prevent infinite loops
        const MAX_ITERATIONS = 500;
        let iterations = 0;

        let currentDateIter = new Date(initialStartDate);
        while (currentDateIter <= end && iterations < MAX_ITERATIONS) {
            iterations++;

            let shouldCreateEvent = true;

            // For weekly frequency, check if current day is in selected days
            if (unit === 'W' && selectedDays.length > 0) {
                const currentDay = currentDateIter.getDay(); // 0-6, Sunday-Saturday
                if (!selectedDays.includes(currentDay)) {
                    shouldCreateEvent = false;
                }
            }

            if (shouldCreateEvent) {
                try {
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
                } catch (error) {
                    console.error('Error creating routine event:', error, routine);
                    // Continue to next iteration
                }
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

        if (iterations >= MAX_ITERATIONS) {
            console.warn(`Reached maximum iterations for routine ${routine.name}`);
        }

        // Limit the number of events to return
        return events.slice(0, 50);
    } catch (error) {
        console.error('Unexpected error in generateRoutineEvents:', error, routine);
        return [];
    }
}; 
