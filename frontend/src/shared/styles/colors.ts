import { Goal } from '../../types/goals';

export const getGoalColor = (goal: Goal): string => {
    const baseColors = {
        directive: '#b39ddb',  // muted purple
        project: '#90caf9',    // soft blue
        achievement: '#f48fb1', // light red
        routine: '#ffecb3',    // pale yellow
        task: '#a5d6a7'        // pastel green
    };

    // If completed, return a muted/grayed out version of the color
    if (goal.completed) {
        return `${baseColors[goal.goal_type]}80`; // Adding 50 for 50% opacity
    }

    return baseColors[goal.goal_type];
};

