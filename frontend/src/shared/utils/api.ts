import axios, { AxiosResponse, Method, type AxiosError } from 'axios';
import { Goal, RelationshipType } from '../../types/goals';
import { goalToUTC, goalToLocal } from './time';
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
        if (error.response.status === 404) {
            window.location.href = '/signin';
            throw error
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
// Goal CRUD operations
export async function createGoal(goal: Goal): Promise<Goal> {
    console.log(goal)
    const preparedGoal = prepareGoalForAPI(goal);
    console.log(preparedGoal)
    const response = await privateRequest<Goal>('goals/create', 'POST', preparedGoal);
    return processGoalFromAPI(response);
}

export async function updateGoal(goalId: number, goal: Goal): Promise<Goal> {
    console.log(goal)
    const preparedGoal = prepareGoalForAPI(goal);
    console.log(preparedGoal)
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
