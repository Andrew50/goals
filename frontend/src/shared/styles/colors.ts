import { Goal, GoalType } from '../../types/goals';

const baseColors: Record<GoalType, string> = {
    directive: '#8B7CB3',   // muted lavender
    project: '#5B8BA0',     // soft slate blue
    achievement: '#B87A7A', // muted rose
    routine: '#B8A06D',     // soft gold/amber
    task: '#7A9A7A',        // muted sage green
    event: '#B88D6D'        // soft copper
};

export const getBaseColor = (goalType: GoalType): string => {
    return baseColors[goalType];
};

export const dimIfCompleted = (hex: string, completed?: boolean): string => {
    return completed ? `${hex}80` : hex; // "80" = 50% alpha
};

// Helper to determine the effective type for color determination
export const getEffectiveType = (goal: Goal): GoalType => {
    // For events, use the parent type if available, otherwise fall back to 'event'
    if (goal.goal_type === 'event' && goal.parent_type) {
        return goal.parent_type as GoalType;
    }
    return goal.goal_type;
};

export const getGoalColor = (goal: Goal): string => {
    const effectiveType = getEffectiveType(goal);
    const baseColor = baseColors[effectiveType];

    // If completed, failed, or skipped, return a muted/grayed out version of the color
    if (goal.resolution_status && goal.resolution_status !== 'pending') {
        return `${baseColor}80`; // Adding 80 for 50% opacity
    }

    return baseColor;
};

// Priority-based border styling
export type Priority = 'high' | 'medium' | 'low';

export const getPriorityBorder = (_priority?: Priority): string => {
    // Priority is not drawn as an outline. High priority uses an inset bar
    // (see Day and Projects) via getPriorityBorderColor('high').
    return 'none';
};

// Helper to get the priority border color (just the color, not the full border style)
export const getPriorityBorderColor = (priority?: Priority): string => {
    const priorityColors: Record<Priority, string> = {
        high: '#C45B5B',     // Muted brick red
        medium: '#B8834A',   // Soft amber
        low: '#7A8A9A'       // Steel gray
    };
    return priority ? priorityColors[priority] : '#9AA0A8'; // Default neutral gray
};

// Combined styling helper that provides comprehensive styling for calendar events
export const getGoalStyle = (goal: Goal, _parent?: Goal): {
    backgroundColor: string;
    border: string;
    textColor: string;
    borderColor: string;
} => {
    const backgroundColor = getGoalColor(goal);

    return {
        backgroundColor,
        border: 'none',
        textColor: '#ffffff', // White text for good contrast on colored backgrounds
        // Match the fill so calendar events and network nodes are one color,
        // not a type fill wrapped in a priority ring.
        borderColor: backgroundColor
    };
};

