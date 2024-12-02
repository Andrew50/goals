import axios, { AxiosResponse, Method } from 'axios';
import { Goal } from '../types';
//import { goalToLocal, goalToUTC } from '../utils / timezone';

const API_URL = process.env.REACT_APP_API_URL;
if (!API_URL) {
    throw new Error('REACT_APP_API_URL is not set');
}

// Helper to check if something is a Goal object
const isGoal = (obj: any): obj is Goal => {
    return obj && typeof obj === 'object' && 'goal_type' in obj;
};

// Helper to convert data to UTC before sending to backend
/*const convertToUTC = (data: any): any => {
if (!data) return data;

// Handle arrays
if (Array.isArray(data)) {
    return data.map(item => convertToUTC(item));
}

// Handle Goal objects
if (isGoal(data)) {
    return goalToUTC(data);
}

return data;
};

// Helper to convert response data to local timezone
const convertToLocal = (data: any): any => {
    if (!data) return data;

    // Handle arrays
    if (Array.isArray(data)) {
        return data.map(item => convertToLocal(item));
    }

    // Handle Goal objects
    if (isGoal(data)) {
        return goalToLocal(data);
    }

    return data;
};*/

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