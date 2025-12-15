import axios, { AxiosResponse, Method } from 'axios';
import { forceLogout } from './authEvents';
import { Goal, RelationshipType, ApiGoal, ResolutionStatus, DisplayStatus } from '../../types/goals';
import { goalToUTC, goalToLocal } from './time';

const API_URL = process.env.REACT_APP_API_URL;
if (!API_URL) {
    throw new Error('REACT_APP_API_URL is not set');
}

// Configure axios defaults to handle connection issues
axios.defaults.timeout = 10000; // 10 second timeout
axios.defaults.headers.common['Accept'] = 'application/json';
axios.defaults.headers.common['Content-Type'] = 'application/json';
axios.defaults.withCredentials = true; // Include cookies on cross-origin requests

// Global 401 handler: redirect flow via forceLogout on any 401 from our API
let axios401InterceptorInstalled = false;
let logoutCooldownUntilMs = 0;
if (!axios401InterceptorInstalled) {
    axios.interceptors.response.use(
        (response) => response,
        (error) => {
            const status = error?.response?.status;
            const url: string | undefined = error?.config?.url;
            const isFromApi =
                typeof url === 'string' &&
                typeof API_URL === 'string' &&
                url.startsWith(API_URL);
            if (status === 401 && isFromApi) {
                const now = Date.now();
                if (now >= logoutCooldownUntilMs) {
                    logoutCooldownUntilMs = now + 1000; // throttle duplicate events
                    try {
                        localStorage.removeItem('authToken');
                        localStorage.removeItem('routineUpdateTimeout');
                        localStorage.removeItem('nextRoutineUpdate');
                        localStorage.removeItem('username');
                    } catch {
                        // ignore storage errors
                    }
                    forceLogout();
                }
            }
            return Promise.reject(error);
        }
    );
    axios401InterceptorInstalled = true;
}

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
    params?: any,
    timeoutMs?: number
): Promise<T> {
    const token = localStorage.getItem('authToken');
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response: AxiosResponse<T> = await axios({
            url: `${API_URL}/${endpoint}`,
            method,
            headers,
            data,
            params,
            withCredentials: true,
            ...(timeoutMs ? { timeout: timeoutMs } : {}),
        });

        return response.data as T;
    } catch (error: any) {
        if (error.response?.status === 401) {
            // Clear storage as a fallback and broadcast a global logout event
            try {
                localStorage.removeItem('authToken');
                localStorage.removeItem('routineUpdateTimeout');
                localStorage.removeItem('nextRoutineUpdate');
                localStorage.removeItem('username');
            } catch (_) { }
            forceLogout();
            throw error;
        }

        console.error(`API request failed for ${endpoint}:`, error);
        throw error;
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
            withCredentials: true,
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

// Resolve a goal by setting its resolution status
export interface ResolveGoalResponse {
    resolution_status: ResolutionStatus;
    display_status: DisplayStatus;
    resolved_at: number | null;
}

export async function resolveGoal(
    goalId: number,
    status: ResolutionStatus
): Promise<ResolveGoalResponse> {
    return privateRequest<ResolveGoalResponse>(
        `goals/${goalId}/resolve`,
        'PUT',
        { resolution_status: status }
    );
}

// Convenience function for completing a goal (backward compatible name)
export async function completeGoal(goalId: number, completed: boolean): Promise<ResolutionStatus> {
    const status: ResolutionStatus = completed ? 'completed' : 'pending';
    const response = await resolveGoal(goalId, status);
    return response.resolution_status;
}

// Event-specific API calls
export const createEvent = async (event: {
    parent_id: number;
    parent_type: string;
    scheduled_timestamp: Date;
    duration: number;
    priority?: string;
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

// Duplicate goal
export interface DuplicateOptions {
    include_children?: boolean;
    keep_parent_links?: boolean;
    name_suffix?: string;
    clear_external_ids?: boolean;
}

export const duplicateGoal = async (goalId: number, options: DuplicateOptions = {}): Promise<Goal> => {
    const response = await privateRequest<ApiGoal>(`goals/${goalId}/duplicate`, 'POST', options);
    return processGoalFromAPI(response);
};

export const getTaskEvents = async (taskId: number): Promise<{
    task_id: number;
    events: Goal[];
    total_duration: number;
    next_scheduled: Date | null;
    last_scheduled: Date | null;
    event_count: number;
    completed_event_count: number;
    past_uncompleted_count: number;
    future_uncompleted_count: number;
    next_uncompleted: Date | null;
}> => {
    const response = await privateRequest<{
        task_id: number;
        events: ApiGoal[];
        total_duration: number;
        next_scheduled: number | null;
        last_scheduled: number | null;
        event_count: number;
        completed_event_count: number;
        past_uncompleted_count: number;
        future_uncompleted_count: number;
        next_uncompleted_timestamp: number | null;
    }>(`events/task/${taskId}`, 'GET');

    return {
        task_id: response.task_id,
        events: response.events.map(processGoalFromAPI),
        total_duration: response.total_duration,
        next_scheduled: response.next_scheduled ? new Date(response.next_scheduled) : null,
        last_scheduled: response.last_scheduled ? new Date(response.last_scheduled) : null,
        event_count: response.event_count,
        completed_event_count: response.completed_event_count,
        past_uncompleted_count: response.past_uncompleted_count,
        future_uncompleted_count: response.future_uncompleted_count,
        next_uncompleted: response.next_uncompleted_timestamp ? new Date(response.next_uncompleted_timestamp) : null,
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

export const updateRoutineEventProperties = async (
    eventId: number,
    updates: {
        duration?: number;
        name?: string;
        description?: string;
        priority?: string;
        scheduled_timestamp?: Date;
    },
    updateScope: 'single' | 'all' | 'future'
): Promise<Goal[]> => {
    console.log('🔄 [API] updateRoutineEventProperties called with:', {
        eventId,
        updates,
        updateScope
    });

    const requestData = {
        update_scope: updateScope,
        duration: updates.duration,
        name: updates.name,
        description: updates.description,
        priority: updates.priority,
        scheduled_timestamp: updates.scheduled_timestamp ? updates.scheduled_timestamp.getTime() : undefined
    };

    console.log('📡 [API] Making request to:', `events/${eventId}/routine-properties`);
    console.log('📦 [API] Request body:', requestData);

    try {
        const response = await privateRequest<ApiGoal[]>(
            `events/${eventId}/routine-properties`,
            'PUT',
            requestData
        );

        console.log('✅ [API] updateRoutineEventProperties response:', response);
        const goals = response.map(processGoalFromAPI);
        console.log('🎯 [API] Processed goals:', goals.length, 'events');
        return goals;
    } catch (error) {
        console.error('❌ [API] updateRoutineEventProperties failed:', error);
        throw error;
    }
};

export const updateEvent = async (eventId: number, updates: {
    scheduled_timestamp?: Date;
    duration?: number;
    resolution_status?: ResolutionStatus;
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
    eventName?: string;
    eventDescription?: string;
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
        start_after_timestamp: options.startAfterTimestamp ? options.startAfterTimestamp.getTime() : undefined,
        event_name: options.eventName,
        event_description: options.eventDescription,
    };

    const response = await privateRequest<{
        suggestions: Array<{
            timestamp: number;
            reason: string;
            score: number;
        }>;
    }>('events/smart-schedule', 'POST', requestData, undefined, 60000);

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

// Google Calendar Sync API functions
export interface GCalSyncRequest {
    calendar_id: string;
    sync_direction: 'bidirectional' | 'to_gcal' | 'from_gcal';
}

export interface GCalSyncConflict {
    goal_id: number;
    goal_name: string;
    gcal_event_id: string;
    local_updated_at: number;
    gcal_updated: string;
    local_summary: string;
    gcal_summary: string;
}

export interface GCalSyncResult {
    imported_events: number;
    exported_events: number;
    updated_events: number;
    errors: string[];
    conflicts: GCalSyncConflict[];
}

export const syncFromGoogleCalendar = async (request: GCalSyncRequest): Promise<GCalSyncResult> => {
    return privateRequest<GCalSyncResult>('gcal/sync-from', 'POST', request);
};

export const syncToGoogleCalendar = async (request: GCalSyncRequest): Promise<GCalSyncResult> => {
    return privateRequest<GCalSyncResult>('gcal/sync-to', 'POST', request);
};

export const syncBidirectionalGoogleCalendar = async (request: GCalSyncRequest): Promise<GCalSyncResult> => {
    return privateRequest<GCalSyncResult>('gcal/sync-bidirectional', 'POST', request);
};

export interface ResolveConflictRequest {
    goal_id: number;
    resolution: 'keep_local' | 'keep_gcal';
    gcal_event_id: string;
    calendar_id: string;
}

export const resolveGCalConflict = async (request: ResolveConflictRequest): Promise<void> => {
    await privateRequest('gcal/resolve-conflict', 'POST', request);
};

export const resetGCalSyncState = async (calendarId: string): Promise<void> => {
    await privateRequest(`gcal/reset-sync/${encodeURIComponent(calendarId)}`, 'POST');
};

export const deleteGCalEvent = async (goalId: number): Promise<void> => {
    await privateRequest(`gcal/event/${goalId}`, 'DELETE');
};

export interface GCalSettings {
    gcal_auto_sync_enabled?: boolean;
    gcal_default_calendar_id?: string;
}

export interface GCalSettingsResponse {
    gcal_auto_sync_enabled: boolean;
    gcal_default_calendar_id: string | null;
}

export const getGCalSettings = async (): Promise<GCalSettingsResponse> => {
    return privateRequest<GCalSettingsResponse>('gcal/settings', 'GET');
};

export const updateGCalSettings = async (settings: GCalSettings): Promise<GCalSettingsResponse> => {
    return privateRequest<GCalSettingsResponse>('gcal/settings', 'PUT', settings);
};

// Google Account Status
export interface GoogleStatusResponse {
    linked: boolean;
    email: string | null;
    calendars_synced: number;
}

export const getGoogleStatus = async (): Promise<GoogleStatusResponse> => {
    return privateRequest<GoogleStatusResponse>('auth/google-status', 'GET');
};

export const unlinkGoogleAccount = async (): Promise<void> => {
    await privateRequest('auth/google-unlink', 'POST');
};

// Routine recompute API – soft-delete future events and regenerate on the new schedule
export const recomputeRoutineFuture = async (
    routineId: number,
    fromTimestamp?: Date
): Promise<{ deleted: number; created: number }> => {
    const qs = fromTimestamp ? `?from_timestamp=${fromTimestamp.getTime()}` : '';
    return privateRequest<{ deleted: number; created: number }>(
        `routine/${routineId}/recompute-future${qs}`,
        'POST'
    );
};

export interface CalendarListEntry {
    id: string;
    summary: string;
    primary?: boolean;
    access_role: string;
}

export const getGoogleCalendars = async (): Promise<CalendarListEntry[]> => {
    return privateRequest<CalendarListEntry[]>('gcal/calendars', 'GET');
};
