import { Goal } from '../../types/goals';

export const getGoalColor = (goal: Goal): string => {
    const baseColors = {
        directive: '#9370DB',  // purple
        project: '#4682B4',    // steel blue
        achievement: '#CD5C5C', // indian red
        routine: '#DAA520',    // goldenrod
        task: '#81c784',       // lighter green
        event: '#FF8C00'       // dark orange
    };

    // If completed, return a muted/grayed out version of the color
    if (goal.completed) {
        return `${baseColors[goal.goal_type]}80`; // Adding 80 for 50% opacity
    }

    return baseColors[goal.goal_type];
};

