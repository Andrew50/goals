const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

// Generate test token (matching the auth helper)
const token = jwt.sign(
    {
        user_id: 1,
        username: 'testuser',
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // Expires in 24 hours
        iat: Math.floor(Date.now() / 1000) // Add issued at time
    },
    'development_jwt_secret_key_change_in_production'
);

console.log('Generated token:', token);

// Create test routine via API
const createRoutine = async () => {
    const routineData = {
        name: 'Test Routine',
        goal_type: 'routine',
        description: 'Test routine for E2E testing',
        priority: 'medium',
        frequency: '1D',
        start_timestamp: Date.now(),
        routine_time: Date.now(),
        duration: 60,
        user_id: 1
    };

    try {
        console.log('Creating routine via API...');
        const response = await fetch('http://localhost:6060/goals/create', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(routineData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to create routine:', response.status, errorText);
            return;
        }

        const result = await response.json();
        console.log('Created routine:', result);

        // Generate routine events
        console.log('Generating routine events...');
        const endOfWeek = Date.now() + (7 * 24 * 60 * 60 * 1000);
        const routineResponse = await fetch(`http://localhost:6060/routine/${endOfWeek}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!routineResponse.ok) {
            const errorText = await routineResponse.text();
            console.error('Failed to generate routine events:', routineResponse.status, errorText);
            return;
        }

        console.log('Routine events generated successfully');

        // Verify by fetching calendar data
        console.log('Verifying calendar data...');
        const calendarResponse = await fetch('http://localhost:6060/calendar', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (calendarResponse.ok) {
            const calendarData = await calendarResponse.json();
            console.log('Routines found:', calendarData.routines.length);
            console.log('Events found:', calendarData.events.length);
        }

    } catch (error) {
        console.error('Error:', error);
    }
};

createRoutine(); 