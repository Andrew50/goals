export type GoalType = 'directive' | 'project' | 'achievement' | 'routine' | 'task';
export type RelationshipType = 'child' | 'queue';
export interface Goal {
    id: number;
    name: string;
    description?: string;
    goal_type: GoalType;
    priority?: 'high' | 'medium' | 'low';
    start_timestamp?: number;
    end_timestamp?: number;
    completed?: boolean;
    frequency?: string;
    next_timestamp?: number;
    routine_name?: string;
    routine_description?: string;
    routine_type?: 'task' | 'achievement';
    routine_duration?: number;
    routine_time?: number;
    scheduled_timestamp?: number;
    duration?: number;
    _tz?: 'utc' | 'user';
}

// Utility functions for timezone conversion
export const toLocalTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp + new Date().getTimezoneOffset() * 60 * 1000;
};

export const toUTCTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp - new Date().getTimezoneOffset() * 60 * 1000;
};

// Goal conversion utilities
export const goalToLocal = (goal: Goal): Goal => {
    if (goal._tz === 'user') {
        throw new Error('Goal is already in user timezone');
    }

    return {
        ...goal,
        start_timestamp: toLocalTimestamp(goal.start_timestamp),
        end_timestamp: toLocalTimestamp(goal.end_timestamp),
        next_timestamp: toLocalTimestamp(goal.next_timestamp),
        scheduled_timestamp: toLocalTimestamp(goal.scheduled_timestamp),
        routine_time: toLocalTimestamp(goal.routine_time),
        _tz: 'user'
    };
};

export const goalToUTC = (goal: Goal): Goal => {
    if (goal._tz === undefined || goal._tz === 'utc') {
        throw new Error('Goal is already in UTC timezone');
    }

    return {
        ...goal,
        start_timestamp: toUTCTimestamp(goal.start_timestamp),
        end_timestamp: toUTCTimestamp(goal.end_timestamp),
        next_timestamp: toUTCTimestamp(goal.next_timestamp),
        scheduled_timestamp: toUTCTimestamp(goal.scheduled_timestamp),
        routine_time: toUTCTimestamp(goal.routine_time),
        _tz: 'utc'
    };
};

export interface CalendarResponse {
    scheduled_tasks: Goal[];
    unscheduled_tasks: Goal[];
    routines: Goal[];
    achievements: Goal[];
}
export interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    type?: 'meeting' | 'task' | 'appointment';
    goal: Goal;
}
export interface CalendarTask {
    id: string;
    title: string;
    type: 'meeting' | 'task' | 'appointment';
    goal: Goal;
}

export interface Relationship {
    from_id: number;
    to_id: number;
    relationship_type: string;
}

export type NetworkNode = Goal & {
    label: string;
    title?: string;
    color?: string;
};

export interface NetworkEdge {
    from: number;
    to: number;
    label?: string;
    arrows?: string;
    relationship_type?: RelationshipType;
}
