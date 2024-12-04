import axios, { AxiosResponse, Method } from 'axios';
import { Goal, RelationshipType } from '../../types/goals';
const API_URL = process.env.REACT_APP_API_URL;
if (!API_URL) {
    throw new Error('REACT_APP_API_URL is not set');
}

function cloneGoal(goal: Goal): Goal {
    return JSON.parse(JSON.stringify(goal));
}

function prepareGoalForAPI(goal: Goal): Goal {
    const goalCopy = cloneGoal(goal);
    return goalToUTC(goalCopy);
}

function processGoalFromAPI(goal: Goal): Goal {
    return goalToLocal(goal);
}

export async function privateRequest<T>(
    endpoint: string,
    method: Method = 'GET',
    data?: any,
    params?: any
): Promise<T> {
    const token = localStorage.getItem('authToken');
    try {
        // Convert request data to UTC
        //const utcData = convertToUTC(data);

        const response: AxiosResponse<T> = await axios({
            url: `${API_URL}/${endpoint}`,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            // data: utcData,
            data,
            params,
        });

        // Convert response data to local timezone
        return response.data as T;
        //return convertToLocal(response.data) as T;
    } catch (error) {
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
    try {
        const response: AxiosResponse<T> = await axios({
            url: `${API_URL}/${endpoint}`,
            method,
            data,
            params,
        });
        return response.data;
    } catch (error) {
        console.error(`API request failed for ${endpoint}:`, error);
        throw error;
    }
}

export async function updateRoutines(): Promise<void> {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const timestamp = endOfDay.getTime();

    console.log(`Sending routine update request for ${endOfDay.toLocaleString()}`);
    try {
        await privateRequest(
            `routine/${timestamp}`,
            'POST'
        );
        console.log('Routine update request completed successfully');
    } catch (error) {
        console.error("Failed to update routines:", error);
        throw error;
    }
}
export const toLocalTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp + new Date().getTimezoneOffset() * 60 * 1000;
};

export const toUTCTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp - new Date().getTimezoneOffset() * 60 * 1000;
};

// Goal conversion utilities
export const goalToLocal = (goal: Goal): Goal => {
    if (goal._tz === 'user') {
        throw new Error('Goal is already in user timezone');
    }

    return {
        ...goal,
        start_timestamp: toLocalTimestamp(goal.start_timestamp),
        end_timestamp: toLocalTimestamp(goal.end_timestamp),
        next_timestamp: toLocalTimestamp(goal.next_timestamp),
        scheduled_timestamp: toLocalTimestamp(goal.scheduled_timestamp),
        routine_time: toLocalTimestamp(goal.routine_time),
        _tz: 'user'
    };
};

export const goalToUTC = (goal: Goal): Goal => {
    if (goal._tz === undefined || goal._tz === 'utc') {
        throw new Error('Goal is already in UTC timezone');
    }

    return {
        ...goal,
        start_timestamp: toUTCTimestamp(goal.start_timestamp),
        end_timestamp: toUTCTimestamp(goal.end_timestamp),
        next_timestamp: toUTCTimestamp(goal.next_timestamp),
        scheduled_timestamp: toUTCTimestamp(goal.scheduled_timestamp),
        routine_time: toUTCTimestamp(goal.routine_time),
        _tz: 'utc'
    };
};



// Goal CRUD operations
export async function createGoal(goal: Goal): Promise<Goal> {
    const preparedGoal = prepareGoalForAPI(goal);
    const response = await privateRequest<Goal>('goals/create', 'POST', preparedGoal);
    return processGoalFromAPI(response);
}

export async function updateGoal(goalId: number, goal: Goal): Promise<Goal> {
    const preparedGoal = prepareGoalForAPI(goal);
    console.log('updateGoalRoutineTime', preparedGoal.routine_time);
    const response = await privateRequest<Goal>(`goals/${goalId}`, 'PUT', preparedGoal);
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
    await privateRequest('relationships', 'POST', {
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
    await privateRequest('relationships', 'DELETE', {
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