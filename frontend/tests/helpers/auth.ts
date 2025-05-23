import jwt from 'jsonwebtoken';
import type { StorageState } from '@playwright/test';

/**
 * Generates a JWT test token.
 * @param userId The user ID.
 * @param username Optional username.
 * @returns A signed JWT token.
 */
export function generateTestToken(userId: number, username?: string): string {
    const testSecret = process.env.JWT_SECRET || 'default_secret'; // Match backend default
    const effectiveUsername = username || `testuser${userId}`;
    const payload = {
        user_id: userId,
        username: effectiveUsername,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Expires in 24 hours
    };
    return jwt.sign(payload, testSecret);
}

/**
 * Generates the Playwright StorageState object needed for authentication.
 * @param userId The user ID for whom to generate the state.
 * @param username Optional username.
 * @param baseURL The base URL of the application (needed for origin).
 * @returns A Playwright StorageState object.
 */
export function generateStorageState(userId: number, username?: string, baseURL: string = 'http://localhost:3030'): StorageState {
    const effectiveUsername = username || `testuser${userId}`;
    const token = generateTestToken(userId, effectiveUsername);

    return {
        cookies: [], // Add any necessary cookies here if required
        origins: [
            {
                origin: baseURL, // Use the provided baseURL
                localStorage: [
                    { name: 'authToken', value: token },
                    { name: 'userId', value: String(userId) },
                    { name: 'username', value: effectiveUsername }
                ],
            },
        ],
    };
}
