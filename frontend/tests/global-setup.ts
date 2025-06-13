import fs from 'fs';
import path from 'path';
import { generateStorageState } from './helpers/auth';
import type { FullConfig } from '@playwright/test';

// Define the path for the authentication state file
const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storageState.json');

async function globalSetup(config: FullConfig) {
    console.log('Executing global setup...');

    // Get worker index from environment variable
    const workerIndex = parseInt(process.env.TEST_WORKER_INDEX || '0');
    const basePort = 3031;
    const workerPort = basePort + workerIndex;

    console.log(`Setting up for worker ${workerIndex} on port ${workerPort}`);

    // Determine the baseURL from the worker-specific port
    const baseURL = `http://localhost:${workerPort}`;
    console.log(`Using baseURL: ${baseURL} for storage state origin.`);

    // Define the default user for the global authenticated state
    const defaultUserId = 1;
    // Use the default username from the helper (which is 'testuser')
    // Don't override it here to match the test database

    // Generate the storage state object using the helper
    const storageState = generateStorageState(defaultUserId, undefined, baseURL);

    // Add a test mode flag to prevent immediate token validation
    storageState.origins[0].localStorage.push({
        name: 'testMode',
        value: 'true'
    });

    // Add worker-specific information
    storageState.origins[0].localStorage.push({
        name: 'workerIndex',
        value: workerIndex.toString()
    });

    try {
        // Ensure the .auth directory exists
        const dir = path.dirname(STORAGE_STATE_PATH);
        if (!fs.existsSync(dir)) {
            console.log(`Creating directory: ${dir}`);
            fs.mkdirSync(dir, { recursive: true });
        }

        // Create worker-specific storage state file
        const workerStorageStatePath = path.join(dir, `storageState-worker-${workerIndex}.json`);
        console.log(`Writing worker-specific storage state to: ${workerStorageStatePath}`);
        fs.writeFileSync(workerStorageStatePath, JSON.stringify(storageState, null, 2));

        // Also write to the default location for backward compatibility
        console.log(`Writing storage state to: ${STORAGE_STATE_PATH}`);
        fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2)); // Pretty print JSON
        console.log('Storage state saved successfully.');

    } catch (error) {
        console.error('Error during global setup:', error);
        // Optionally re-throw or exit process if setup failure should stop tests
        // throw error; 
    }

    console.log(`Global setup finished for worker ${workerIndex}.`);
}

export default globalSetup;

