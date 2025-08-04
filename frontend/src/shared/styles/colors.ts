import { Goal, GoalType } from '../../types/goals';

const baseColors: Record<GoalType, string> = {
    directive: '#9370DB',  // purple
    project: '#4682B4',    // steel blue
    achievement: '#CD5C5C', // indian red
    routine: '#DAA520',    // goldenrod
    task: '#81c784',       // lighter green
    event: '#FF8C00'       // dark orange
};

export const getBaseColor = (goalType: GoalType): string => {
    return baseColors[goalType];
};

export const dimIfCompleted = (hex: string, completed?: boolean): string => {
    return completed ? `${hex}80` : hex; // "80" = 50% alpha
};

export const getGoalColor = (goal: Goal): string => {
    const baseColor = baseColors[goal.goal_type];

    // If completed, return a muted/grayed out version of the color
    if (goal.completed) {
        return `${baseColor}80`; // Adding 80 for 50% opacity
    }

    return baseColor;
};

