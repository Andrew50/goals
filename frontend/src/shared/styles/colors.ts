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

export const getPriorityBorder = (priority?: Priority): string => {
    // NOTE: Priority border highlighting is disabled (returns transparent)
    // To re-enable with priority-based borders:
    // const borders: Record<Priority, string> = {
    //     high: '2px solid #C45B5B',     // Muted brick red
    //     medium: '2px solid #B8834A',   // Soft amber
    //     low: '2px solid #7A8A9A'       // Steel gray
    // };
    // return priority ? borders[priority] : 'none';
    return '2px solid transparent';
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

