import { Goal } from '../../types/goals';

export const getGoalColor = (goal: Goal): string => {
    const baseColors = {
        directive: '#b39ddb',  // soft purple
        project: '#90caf9',    // soft blue
        achievement: '#ef9a9a', // soft red
        routine: '#ffe082',    // soft gold
        task: '#aed581'        // soft green
    };

    // If completed, return a muted/grayed out version of the color
    if (goal.completed) {
        return `${baseColors[goal.goal_type]}80`; // Adding 50 for 50% opacity
    }

    return baseColors[goal.goal_type];
};

