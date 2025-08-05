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

    // If completed, return a muted/grayed out version of the color
    if (goal.completed) {
        return `${baseColor}80`; // Adding 80 for 50% opacity
    }

    return baseColor;
};

// Priority-based border styling
export type Priority = 'high' | 'medium' | 'low';

const priorityBorders: Record<Priority, string> = {
    high: '2px solid #d32f2f',     // Red, uniform border weight
    medium: '2px solid #ffa726',   // Orange for medium priority
    low: '2px solid #9e9e9e'       // Gray for low priority
};

export const getPriorityBorder = (priority?: Priority): string => {
    return priority ? priorityBorders[priority] : 'none';
};

// Helper to get the priority border color (just the color, not the full border style)
export const getPriorityBorderColor = (priority?: Priority): string => {
    const priorityColors: Record<Priority, string> = {
        high: '#d32f2f',     // Red for highest priority
        medium: '#ffa726',   // Orange for medium priority
        low: '#9e9e9e'       // Gray for low priority
    };
    return priority ? priorityColors[priority] : '#e0e0e0'; // Default light gray
};

// Combined styling helper that provides comprehensive styling for calendar events
export const getGoalStyle = (goal: Goal, parent?: Goal): {
    backgroundColor: string;
    border: string;
    textColor: string;
    borderColor: string;
} => {
    const backgroundColor = getGoalColor(goal);

    // Use event's own priority if set, otherwise fall back to parent's priority
    const effectivePriority = goal.priority || parent?.priority;

    const border = getPriorityBorder(effectivePriority);
    const borderColor = getPriorityBorderColor(effectivePriority);

    return {
        backgroundColor,
        border,
        textColor: '#ffffff', // White text for good contrast on colored backgrounds
        borderColor // Use priority-based border color for FullCalendar
    };
};

