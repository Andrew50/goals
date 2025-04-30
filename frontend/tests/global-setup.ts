import fs from 'fs';
import path from 'path';
import { generateStorageState } from './helpers/auth';
import type { FullConfig } from '@playwright/test';

// Define the path for the authentication state file
const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storageState.json');

async function globalSetup(config: FullConfig) {
    console.log('Executing global setup...');

    // Determine the baseURL from the Playwright config
    // Use the first project's baseURL or a default fallback
    const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000';
    console.log(`Using baseURL: ${baseURL} for storage state origin.`);

    // Define the default user for the global authenticated state
    const defaultUserId = 1;
    const defaultUsername = `testuser${defaultUserId}`;

    // Generate the storage state object using the helper
    const storageState = generateStorageState(defaultUserId, defaultUsername, baseURL);

    try {
        // Ensure the .auth directory exists
        const dir = path.dirname(STORAGE_STATE_PATH);
        if (!fs.existsSync(dir)) {
            console.log(`Creating directory: ${dir}`);
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write the storage state to the file
        console.log(`Writing storage state to: ${STORAGE_STATE_PATH}`);
        fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2)); // Pretty print JSON
        console.log('Storage state saved successfully.');

    } catch (error) {
        console.error('Error during global setup:', error);
        // Optionally re-throw or exit process if setup failure should stop tests
        // throw error; 
    }

    console.log('Global setup finished.');
}

export default globalSetup;

