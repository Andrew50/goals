import jwt from 'jsonwebtoken';

/**
 * Generates a JWT test token for authentication during E2E tests
 * 
 * @param userId The user ID to include in the token
 * @returns A signed JWT token
 */
export function generateTestToken(userId: number): string {
    // This is a simple JWT for testing purposes only
    // In a real app, we would use a proper secret from environment variables
    const testSecret = 'test-secret-key-for-e2e-tests-only';

    const payload = {
        user_id: userId,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Expires in 24 hours
    };

    return jwt.sign(payload, testSecret);
} 