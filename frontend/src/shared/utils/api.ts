import axios, { AxiosResponse, Method } from 'axios';
import { Goal, RelationshipType, ApiGoal } from '../../types/goals'; // Import ApiGoal
import { goalToUTC, goalToLocal } from './time';
const API_URL = process.env.REACT_APP_API_URL;
if (!API_URL) {
    throw new Error('REACT_APP_API_URL is not set');
}


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
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);
            to_timestamp = endOfDay.getTime();
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
