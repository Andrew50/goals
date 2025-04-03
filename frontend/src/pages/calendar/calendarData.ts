import { Goal, CalendarResponse, CalendarEvent, CalendarTask } from '../../types/goals';
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
    //console.log('===== CALENDAR DATA FETCH STARTED =====');
    //console.log('Date range:', dateRange);

    try {
        // If no date range is provided, use current date and load one month
        const currentDate = new Date();
        const start = dateRange?.start || new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const end = dateRange?.end || new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        // Limit the date range to prevent processing too much data
        // Don't load more than 60 days of data at once
        const maxRangeMs = 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds
        const actualEnd = new Date(Math.min(end.getTime(), start.getTime() + maxRangeMs));

        //console.log(`Fetching calendar data from ${start.toISOString()} to ${actualEnd.toISOString()}`);
        //console.log(`Local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}, offset: ${new Date().getTimezoneOffset()} minutes`);

        // Cache to prevent duplicate task processing
        const processedGoalIds = new Set<number>();
        const processedEventIds = new Set<string>();

        // Add date range params to the request
        //console.log('Making API request to calendar endpoint');
        const response = await privateRequest<CalendarResponse>('calendar');
        /* console.log('Raw API response structure:', {
         hasRoutines: !!response?.routines,
             routinesCount: response?.routines?.length || 0,
                 hasScheduledTasks: !!response?.scheduled_tasks,
                     scheduledTasksCount: response?.scheduled_tasks?.length || 0,
                         hasUnscheduledTasks: !!response?.unscheduled_tasks,
                             unscheduledTasksCount: response?.unscheduled_tasks?.length || 0,
                                 hasAchievements: !!response?.achievements,
                                     achievementsCount: response?.achievements?.length || 0
 
     });*/

        if (!response?.unscheduled_tasks || response.unscheduled_tasks.length === 0) {
            console.warn('No unscheduled tasks found in API response');
        } else {
            //console.log('Sample unscheduled task:', response.unscheduled_tasks[0]);
        }

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

        // Log the counts before any filtering
        /*console.log(`Pre-filtering counts: 
        Routines: ${ safeResponse.routines.length }, 
                Scheduled tasks: ${ safeResponse.scheduled_tasks.length }, 
                Unscheduled tasks: ${ safeResponse.unscheduled_tasks.length },
        Achievements: ${ safeResponse.achievements.length } `);
        */

        // Create a map to track potential duplicates
        const eventTracker = new Map<string, number>();

        // Helper function to track event creations by key (date + name)
        const trackEvent = (date: Date, name: string, type: string) => {
            const key = `${date.toISOString().split('T')[0]} -${name} `;
            const count = eventTracker.get(key) || 0;
            eventTracker.set(key, count + 1);

            if (count > 0) {
                console.warn(`⚠️ POTENTIAL DUPLICATE: ${type} "${name}" on ${date.toISOString().split('T')[0]} (occurrence #${count + 1})`);
            }
            return key;
        };

        // Convert routines to local timezone before generating events
        //console.log('===== CONVERTING ROUTINES TO LOCAL TIMEZONE =====');
        const localRoutines = safeResponse.routines.map(routine => {
            try {
                // Force _tz to be undefined to prevent error if object structure is incomplete
                const normalizedRoutine = { ...routine, _tz: routine._tz || undefined };
                return goalToLocal(normalizedRoutine);
            } catch (error) {
                console.error('Error converting routine to local timezone:', error, routine);
                // Mark the goal so we know it's still in UTC format
                return { ...routine, _failed_conversion: true };
            }
        });

        // Generate routine events with local timezone data, but only within the date range
        let routineEvents: CalendarEvent[] = [];
        try {
            routineEvents = localRoutines
                .filter(routine => !routine._failed_conversion) // Only process properly converted routines
                .map(routine => {
                    try {
                        const events = generateRoutineEvents(routine, currentDate, start, actualEnd);

                        // Deduplicate routine events by checking against processed event IDs
                        return events.filter(event => {
                            if (processedEventIds.has(event.id)) {
                                //console.log(`Skipping duplicate routine event: ${ event.id } `);
                                return false;
                            }
                            processedEventIds.add(event.id);
                            return true;
                        });
                    } catch (error) {
                        console.error('Error generating routine events:', error, routine);
                        return [];
                    }
                }).flat();

            // No hard limit on routine events - they're already date filtered by generateRoutineEvents
        } catch (error) {
            console.error('Error generating all routine events:', error);
            routineEvents = [];
        }

        //console.log(`Generated ${ routineEvents.length } routine events within date range`);

        // Handle scheduled tasks with local timezone
        let scheduledEvents: CalendarEvent[] = [];
        try {
            //console.log(`Processing ${ safeResponse.scheduled_tasks.length } scheduled tasks`);

            const tasksWithTimestamp = safeResponse.scheduled_tasks.filter(task => !!task.scheduled_timestamp);
            //console.log(`Found ${ tasksWithTimestamp.length } tasks with scheduled_timestamp`);

            // Log the first few scheduled tasks for debugging with more detail
            if (tasksWithTimestamp.length > 0) {
                //console.log('Sample scheduled tasks with full details:', tasksWithTimestamp.slice(0, 3));
            }

            scheduledEvents = tasksWithTimestamp
                .map(task => {
                    // Skip if we've already processed this goal ID
                    if (processedGoalIds.has(task.id)) {
                        //console.log(`Skipping duplicate task: ${ task.id } (${ task.name })`);
                        return null;
                    }
                    processedGoalIds.add(task.id);

                    try {
                        // Log before conversion
                        //console.log(`Converting task[${ task.id }]"${task.name}" with timestamp ${ task.scheduled_timestamp } (${ task.scheduled_timestamp ? new Date(task.scheduled_timestamp).toISOString() : 'undefined' })`);
                        //console.log(`Task timezone flag before conversion: _tz = ${ task._tz || 'undefined' } `);

                        // Force _tz to be undefined to prevent error if object structure is incomplete
                        const normalizedTask = { ...task, _tz: task._tz || undefined };
                        const localTask = goalToLocal(normalizedTask);

                        // Log after conversion
                        //console.log(`Task[${ localTask.id }]"${localTask.name}" after conversion: ${ localTask.scheduled_timestamp } (${ localTask.scheduled_timestamp ? new Date(localTask.scheduled_timestamp).toISOString() : 'undefined' })`);
                        //console.log(`Task timezone flag after conversion: _tz = ${ localTask._tz || 'undefined' } `);

                        return localTask;
                    } catch (error) {
                        console.error('Error converting scheduled task to local timezone:', error, task);
                        // Mark the goal so we know it's still in UTC format
                        return { ...task, _failed_conversion: true };
                    }
                })
                .filter(item => {
                    if (!item) return false;

                    // Skip goals that failed conversion
                    if (item._failed_conversion) {
                        //console.log(`Task ${ item.id } (${ item.name }) skipped due to failed timezone conversion`);
                        return false;
                    }

                    // Filter tasks that fall within the date range
                    if (!item.scheduled_timestamp) {
                        //console.log(`Task ${ item.id } (${ item.name }) has no scheduled_timestamp`);
                        return false;
                    }

                    // Log the timestamp and date for debugging
                    const taskDate = new Date(item.scheduled_timestamp);

                    // Filter based on date range
                    const isInRange = taskDate >= start && taskDate <= actualEnd;

                    if (!isInRange) {
                        //console.log(`Task ${ item.id } (${ item.name }) excluded: outside date range(${ taskDate.toISOString() })`);
                    }

                    return isInRange;
                })
                .map(item => {
                    try {
                        // Use non-null assertion to tell TypeScript that item is not null at this point
                        const nonNullItem = item!;
                        const isAllDay = nonNullItem.duration === 1440;

                        //console.log(`Creating calendar event for task: [${ nonNullItem.id }] "${nonNullItem.name}"`);
                        //console.log(`Timestamp before: ${ nonNullItem.scheduled_timestamp }, ISO: ${ timestamp.toISOString() } `);
                        //console.log(`Task _tz flag: ${ nonNullItem._tz || 'undefined' }, _failed_conversion: ${ nonNullItem._failed_conversion ? 'true' : 'false' } `);

                        // Instead of manually constructing a new Date object from components,
                        // which can cause timezone issues, use the timestamp directly
                        const start = new Date(nonNullItem.scheduled_timestamp!);

                        // Log timezone information
                        //console.log(`Start date: ${ start.toISOString() }, local string: ${ start.toLocaleString() }, timezone offset: ${ start.getTimezoneOffset() } `);

                        // Ensure the goal_type is properly set to 'task' to get the correct color
                        if (!nonNullItem.goal_type) {
                            nonNullItem.goal_type = 'task';
                            //console.log(`Setting goal_type to 'task' for ${ nonNullItem.name }`);
                        }

                        // Create end date based on duration
                        const endDate = isAllDay
                            ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
                            : new Date(start.getTime() + (nonNullItem.duration || 60) * 60 * 1000);

                        // Generate a unique ID for this event
                        const eventId = `scheduled - ${nonNullItem.id} `;

                        // Skip if we've already created an event with this ID
                        if (processedEventIds.has(eventId)) {
                            //console.log(`Skipping duplicate event ID: ${ eventId } `);
                            return null;
                        }
                        processedEventIds.add(eventId);

                        // Track this event creation to detect duplicates
                        const eventKey = trackEvent(start, nonNullItem.name, 'scheduled');

                        const calendarEvent = {
                            id: eventId,
                            title: nonNullItem.name,
                            start: isAllDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0) : start,
                            end: endDate,
                            type: 'scheduled',
                            goal: nonNullItem,
                            allDay: isAllDay,
                            timezone: 'local',
                            _debug_key: eventKey // Add a debug key to track duplicates
                        } as CalendarEvent;

                        //console.log(`Created calendar event: ${ calendarEvent.id }, ${ calendarEvent.title } `);
                        //console.log(`Event start: ${ calendarEvent.start.toISOString() }, end: ${ calendarEvent.end.toISOString() } `);

                        return calendarEvent;
                    } catch (error) {
                        console.error('Error processing scheduled event:', error, item);
                        return null;
                    }
                })
                .filter(Boolean) as CalendarEvent[]; // This final filter ensures we only have non-null values
        } catch (error) {
            console.error('Error processing scheduled events:', error);
            scheduledEvents = [];
        }

        // Handle unscheduled tasks with local timezone - limiting to most recent ones
        let unscheduledTasks: CalendarTask[] = [];
        try {
            unscheduledTasks = safeResponse.unscheduled_tasks
                .map(task => {
                    // Skip if we've already processed this goal ID
                    if (processedGoalIds.has(task.id)) {
                        //console.log(`Skipping duplicate task: ${ task.id } (${ task.name })`);
                        return null;
                    }
                    processedGoalIds.add(task.id);

                    try {
                        // Force _tz to be undefined to prevent error if object structure is incomplete
                        const normalizedTask = { ...task, _tz: task._tz || undefined };
                        const localTask = goalToLocal(normalizedTask);

                        return localTask;
                    } catch (error) {
                        console.error('Error processing unscheduled task:', error, task);
                        return null;
                    }
                })
                .filter(Boolean) // This filter removes null values but TypeScript still thinks items could be null
                .map(item => {
                    // Use non-null assertion to tell TypeScript that item is not null at this point
                    const nonNullItem = item!;
                    return {
                        id: (nonNullItem.id || Date.now()).toString(),
                        title: nonNullItem.name,
                        type: mapGoalTypeToTaskType(nonNullItem.goal_type),
                        goal: nonNullItem
                    } as CalendarTask;
                });

            // Sort by end_timestamp and limit to 100 tasks for performance
            unscheduledTasks.sort((a, b) => {
                return (b.goal.end_timestamp || 0) - (a.goal.end_timestamp || 0);
            });
            unscheduledTasks = unscheduledTasks.slice(0, 100);
            //console.log(`Processed ${ unscheduledTasks.length } unscheduled tasks`);
        } catch (error) {
            console.error('Error processing unscheduled tasks:', error);
            unscheduledTasks = [];
        }

        // Handle achievements with local timezone - only those within date range
        let achievementEvents: CalendarEvent[] = [];
        try {
            achievementEvents = safeResponse.achievements
                .map(achievement => {
                    // Skip if we've already processed this goal ID
                    if (processedGoalIds.has(achievement.id)) {
                        //console.log(`Skipping duplicate achievement: ${ achievement.id } (${ achievement.name })`);
                        return null;
                    }
                    processedGoalIds.add(achievement.id);

                    try {
                        // Force _tz to be undefined to prevent error if object structure is incomplete
                        const normalizedAchievement = { ...achievement, _tz: achievement._tz || undefined };
                        return goalToLocal(normalizedAchievement);
                    } catch (error) {
                        console.error('Error processing achievement event:', error, achievement);
                        return null;
                    }
                })
                .filter(Boolean) // This filter removes null values but TypeScript still thinks items could be null
                .map(achievement => {
                    try {
                        // Use non-null assertion to tell TypeScript that achievement is not null at this point
                        const nonNullAchievement = achievement!;
                        const end = new Date(nonNullAchievement.end_timestamp!);
                        return {
                            id: `achievement - ${nonNullAchievement.id || Date.now()} `,
                            title: nonNullAchievement.name,
                            start: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0), // Set to start of day
                            end: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999), // Set to end of day
                            type: 'achievement',
                            goal: nonNullAchievement,
                            allDay: true // Always true for achievements
                        } as CalendarEvent;
                    } catch (error) {
                        console.error('Error processing achievement event:', error, achievement);
                        return null;
                    }
                })
                .filter(Boolean) as CalendarEvent[]; // This final filter ensures we only have non-null values
        } catch (error) {
            console.error('Error processing achievement events:', error);
            achievementEvents = [];
        }

        // After all event creation - Find potential duplicates in the full data set for debugging
        // Count how many events share the same date and name
        // This won't catch all duplicates but is helpful for spotting obvious issues
        // Remove unused duplicatesCount
        eventTracker.forEach((count, key) => {
            if (count > 1) {
                // We have a potential duplicate
                //console.log(`Potential duplicate event: ${key} (${count} occurrences)`);
            }
        });
        //console.log(`Found potential duplicate event keys out of ${ eventTracker.size } total`);

        // Combine all events with proper date filtering
        const allEvents = [...scheduledEvents, ...routineEvents, ...achievementEvents];
        //console.log(`Combined ${ allEvents.length } total events after date range filtering`);

        // No artificial limits - all events within date range should be included
        return {
            events: allEvents,
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

        // Get today's date at midnight for comparison
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Make sure we don't generate events for days before today
        const effectiveRangeStart = new Date(Math.max(today.getTime(), rangeStart.getTime()));

        const events: CalendarEvent[] = [];

        // Use the effective range start date as the starting point
        const initialStartDate = new Date(Math.max(routine.start_timestamp, effectiveRangeStart.getTime()));
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
            console.warn(`Invalid frequency format for routine ${routine.name}: ${routine.frequency} `);
            return [];
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const [_unused, intervalStr, unit, daysStr] = frequencyMatch;
        const interval = parseInt(intervalStr);

        if (isNaN(interval) || interval <= 0) {
            console.warn(`Invalid interval for routine ${routine.name}: ${intervalStr} `);
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
                        id: `routine - ${routine.id} -${currentDateIter.getTime()} `,
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
        return events.slice(0, 100);
    } catch (error) {
        console.error('Unexpected error in generateRoutineEvents:', error, routine);
        return [];
    }
}; 
