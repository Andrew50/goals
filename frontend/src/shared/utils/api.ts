import axios, { AxiosResponse, Method } from 'axios';
import { Goal, RelationshipType, ApiGoal } from '../../types/goals'; // Import ApiGoal
import { goalToUTC, goalToLocal } from './time';

const API_URL = process.env.REACT_APP_API_URL;
if (!API_URL) {
    throw new Error('REACT_APP_API_URL is not set');
}

// Configure axios defaults to handle connection issues
axios.defaults.timeout = 10000; // 10 second timeout
axios.defaults.headers.common['Accept'] = 'application/json';
axios.defaults.headers.common['Content-Type'] = 'application/json';

// Add retry logic for connection issues
const axiosRetry = async (fn: () => Promise<any>, retries = 3): Promise<any> => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            if (i === retries - 1) throw error;
            if (error.code === 'ERR_NETWORK' || error.code === 'ECONNRESET') {
                console.log(`Network error, retrying (${i + 1}/${retries})...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // exponential backoff
            } else {
                throw error; // Don't retry non-network errors
            }
        }
    }
};

// Takes a frontend Goal (Date objects) and returns an ApiGoal (numeric timestamps)
function prepareGoalForAPI(goal: Goal): ApiGoal {
    // No need to clone here, goalToUTC creates a new object structure
    // and doesn't mutate the original goal.
    // Passing the original goal directly avoids the Date -> string conversion issue.
    console.log("Original goal before goalToUTC:", goal); // Optional: keep for debugging if needed
    console.log("Type of scheduled_timestamp before goalToUTC:", typeof goal.scheduled_timestamp); // Should be 'object' (Date) or 'undefined'

    return goalToUTC(goal); // goalToUTC returns ApiGoal
}

// Takes an ApiGoal (numeric timestamps) from API and returns a frontend Goal (Date objects)
function processGoalFromAPI(apiGoal: ApiGoal): Goal {
    // goalToLocal expects ApiGoal and returns Goal
    return goalToLocal(apiGoal);
}

export async function privateRequest<T>(
    endpoint: string,
    method: Method = 'GET',
    data?: any,
    params?: any
): Promise<T> {
    const token = localStorage.getItem('authToken');
    try {
        const response: AxiosResponse<T> = await axios({
            url: `${API_URL}/${endpoint}`,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            data,
            params,
        });

        return response.data as T;
    } catch (error: any) {
        if (error.response?.status === 401) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('routineUpdateTimeout');
            localStorage.removeItem('nextRoutineUpdate');
            throw error;
        } else {
            console.error(`API request failed for ${endpoint}:`, error);
            throw error;
        }
    }
}

export async function publicRequest<T>(
    endpoint: string,
    method: Method = 'GET',
    data?: any,
    params?: any
): Promise<T> {
    return axiosRetry(async () => {
        const response: AxiosResponse<T> = await axios({
            url: `${API_URL}/${endpoint}`,
            method,
            data,
            params,
            timeout: 10000,
        });
        return response.data;
    });
}

export async function updateRoutines(to_timestamp?: number): Promise<void> {
    //console.log('updateRoutines called')

    try {
        const lastUpdate = parseInt(localStorage?.getItem('lastRoutineUpdate') || '0', 10);
        const now = Date.now();
        const DEBOUNCE_INTERVAL = 3 * 1000; // 3 seconds

        if (now - lastUpdate < DEBOUNCE_INTERVAL) {
            //console.log('Skipping routine update - too soon since last update');
            return;
        }

        if (!to_timestamp) {
            // Create events for the next 7 days instead of just today
            const endOfWeek = new Date();
            endOfWeek.setDate(endOfWeek.getDate() + 7);
            endOfWeek.setHours(23, 59, 59, 999);
            to_timestamp = endOfWeek.getTime();
        }

        //console.log('updateRoutines request made')
        await privateRequest(`routine/${to_timestamp}`, 'POST');

        try {
            // Wrap localStorage access in try-catch
            localStorage?.setItem('lastRoutineUpdate', now.toString());
        } catch (storageError) {
            console.warn('Could not access localStorage for lastRoutineUpdate:', storageError);
        }

        //console.log('Routine update request completed successfully');
    } catch (error) {
        console.error("Failed to update routines:", error);
        throw error;
    }
}
// Goal CRUD operations
export async function createGoal(goal: Goal): Promise<Goal> {
    //console.log(goal)
    const preparedGoal = prepareGoalForAPI(goal); // preparedGoal is ApiGoal
    //console.log(preparedGoal)
    // API returns ApiGoal
    const response = await privateRequest<ApiGoal>('goals/create', 'POST', preparedGoal);
    // Convert ApiGoal from response to Goal
    return processGoalFromAPI(response);
}

export async function updateGoal(goalId: number, goal: Goal): Promise<Goal> {
    //console.log(goal)
    console.log(typeof goal.scheduled_timestamp)
    const preparedGoal = prepareGoalForAPI(goal); // preparedGoal is ApiGoal
    //console.log(preparedGoal)
    // API returns ApiGoal
    const response = await privateRequest<ApiGoal>(`goals/${goalId}`, 'PUT', preparedGoal);
    // Convert ApiGoal from response to Goal
    return processGoalFromAPI(response);
}

export async function deleteGoal(goalId: number): Promise<void> {
    await privateRequest(`goals/${goalId}`, 'DELETE');
}

// Node relationship operations
export async function createRelationship(
    fromId: number,
    toId: number,
    relationshipType: RelationshipType
): Promise<void> {
    await privateRequest('goals/relationship', 'POST', {
        from_id: fromId,
        to_id: toId,
        relationship_type: relationshipType
    });
}

export async function deleteRelationship(
    fromId: number,
    toId: number,
    relationshipType: RelationshipType
): Promise<void> {
    await privateRequest('goals/relationship', 'DELETE', {
        from_id: fromId,
        to_id: toId,
        relationship_type: relationshipType
    });
}

// Add this new function
export async function completeGoal(goalId: number, completed: boolean): Promise<boolean> {
    const response = await privateRequest<{ completed: boolean }>(
        `goals/${goalId}/complete`,
        'PUT',
        { id: goalId, completed }
    );
    return response.completed;
    //return processGoalFromAPI(response);
}

// Event-specific API calls
export const createEvent = async (event: {
    parent_id: number;
    parent_type: string;
    scheduled_timestamp: Date;
    duration: number;
}): Promise<Goal> => {
    const apiEvent = {
        ...event,
        scheduled_timestamp: event.scheduled_timestamp.getTime()
    };
    const response = await privateRequest<ApiGoal>('events', 'POST', apiEvent);
    return processGoalFromAPI(response);
};

export const completeEvent = async (eventId: number): Promise<{
    event_completed: boolean;
    parent_task_id: number | null;
    parent_task_name: string;
    has_future_events: boolean;
    should_prompt_task_completion: boolean;
}> => {
    return privateRequest(`events/${eventId}/complete`, 'PUT');
};

export const deleteEvent = async (eventId: number, deleteFuture: boolean = false): Promise<void> => {
    await privateRequest(`events/${eventId}/delete?delete_future=${deleteFuture}`, 'DELETE');
};

export const splitEvent = async (eventId: number): Promise<Goal[]> => {
    const response = await privateRequest<ApiGoal[]>(`events/${eventId}/split`, 'POST');
    return response.map(processGoalFromAPI);
};

export const getTaskEvents = async (taskId: number): Promise<{
    task_id: number;
    events: Goal[];
    total_duration: number;
    next_scheduled: Date | null;
    last_scheduled: Date | null;
}> => {
    const response = await privateRequest<{
        task_id: number;
        events: ApiGoal[];
        total_duration: number;
        next_scheduled: number | null;
        last_scheduled: number | null;
    }>(`events/task/${taskId}`, 'GET');

    return {
        task_id: response.task_id,
        events: response.events.map(processGoalFromAPI),
        total_duration: response.total_duration,
        next_scheduled: response.next_scheduled ? new Date(response.next_scheduled) : null,
        last_scheduled: response.last_scheduled ? new Date(response.last_scheduled) : null,
    };
};

export const updateRoutineEvent = async (
    eventId: number,
    newTimestamp: Date,
    updateScope: 'single' | 'all' | 'future'
): Promise<Goal[]> => {
    console.log('🔄 [API] updateRoutineEvent called with:', {
        eventId,
        newTimestamp: newTimestamp.toISOString(),
        newTimestampMs: newTimestamp.getTime(),
        updateScope
    });

    // Build query parameters in case the backend expects them in the URL. Send them in the body as well for backward-compat.
    const query = `new_timestamp=${newTimestamp.getTime()}&update_scope=${updateScope}`;
    const url = `events/${eventId}/routine-update?${query}`;

    console.log('📡 [API] Making request to:', url);
    console.log('📦 [API] Request body:', {
        new_timestamp: newTimestamp.getTime(),
        update_scope: updateScope
    });

    try {
        const response = await privateRequest<ApiGoal[]>(
            url,
            'PUT',
            {
                // Keep the body payload to maintain compatibility with older backend versions
                new_timestamp: newTimestamp.getTime(),
                update_scope: updateScope
            }
        );

        console.log('✅ [API] updateRoutineEvent response:', response);
        const goals = response.map(processGoalFromAPI);
        console.log('🎯 [API] Processed goals:', goals.length, 'events');
        return goals;
    } catch (error) {
        console.error('❌ [API] updateRoutineEvent failed:', error);
        throw error;
    }
};

export const updateEvent = async (eventId: number, updates: {
    scheduled_timestamp?: Date;
    duration?: number;
    completed?: boolean;
    move_reason?: string;
}): Promise<Goal> => {
    const apiUpdates = {
        ...updates,
        scheduled_timestamp: updates.scheduled_timestamp ? updates.scheduled_timestamp.getTime() : undefined
    };
    const response = await privateRequest<ApiGoal>(`events/${eventId}/update`, 'PUT', apiUpdates);
    return processGoalFromAPI(response);
};

export const getRescheduleOptions = async (eventId: number, lookAheadDays: number = 7): Promise<{
    suggestions: Array<{
        timestamp: Date;
        reason: string;
        score: number;
    }>;
}> => {
    const response = await privateRequest<{
        suggestions: Array<{
            timestamp: number;
            reason: string;
            score: number;
        }>;
    }>(`events/${eventId}/reschedule-options?look_ahead_days=${lookAheadDays}`);

    return {
        suggestions: response.suggestions.map(s => ({
            ...s,
            timestamp: new Date(s.timestamp)
        }))
    };
};

export const getSmartScheduleOptions = async (options: {
    duration: number;
    lookAheadDays?: number;
    preferredTimeStart?: number; // Hour of day (0-23)
    preferredTimeEnd?: number;   // Hour of day (0-23)
    startAfterTimestamp?: Date;  // For rescheduling - start suggestions after this time
}): Promise<{
    suggestions: Array<{
        timestamp: Date;
        reason: string;
        score: number;
    }>;
}> => {
    const requestData = {
        duration: options.duration,
        look_ahead_days: options.lookAheadDays,
        preferred_time_start: options.preferredTimeStart,
        preferred_time_end: options.preferredTimeEnd,
        start_after_timestamp: options.startAfterTimestamp ? options.startAfterTimestamp.getTime() : undefined
    };

    const response = await privateRequest<{
        suggestions: Array<{
            timestamp: number;
            reason: string;
            score: number;
        }>;
    }>('events/smart-schedule', 'POST', requestData);

    return {
        suggestions: response.suggestions.map(s => ({
            ...s,
            timestamp: new Date(s.timestamp)
        }))
    };
};

// Add types for task date validation errors
export interface TaskDateRangeViolation {
    violation_type: string; // "before_start" or "after_end"
    event_timestamp: number;
    task_start: number | null;
    task_end: number | null;
    suggested_task_start: number | null;
    suggested_task_end: number | null;
}

export interface TaskDateValidationError {
    error_type: string; // "task_date_range_violation"
    message: string;
    violation: TaskDateRangeViolation;
}

export const expandTaskDateRange = async (options: {
    task_id: number;
    new_start_timestamp?: Date;
    new_end_timestamp?: Date;
}): Promise<Goal> => {
    const requestData = {
        task_id: options.task_id,
        new_start_timestamp: options.new_start_timestamp ? options.new_start_timestamp.getTime() : undefined,
        new_end_timestamp: options.new_end_timestamp ? options.new_end_timestamp.getTime() : undefined,
    };

    const response = await privateRequest<ApiGoal>('goals/expand-date-range', 'POST', requestData);
    return processGoalFromAPI(response);
};
