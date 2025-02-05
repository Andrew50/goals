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
    duration?: number; // minuites
    _tz?: 'utc' | 'user';
    position_x?: number;
    position_y?: number;
}

// Utility functions for timezone conversion
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
    allDay?: boolean;
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
    display?: 'auto' | 'block' | 'list-item' | 'background' | 'none';
    goal: Goal;
    type: 'scheduled' | 'routine' | 'achievement' | 'all-day';
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
    x?: number;
    y?: number;
    size?: number;
    font?: {
        size: number;
        color: string;
        bold: {
            color: string;
            size: number;
            mod: string;
        };
    };
};

export interface NetworkEdge {
    from: number;
    to: number;
    id?: string;
    label?: string;
    relationship_type?: RelationshipType;
    width?: number;
    color?: {
        color: string;
        opacity: number;
    };
    arrows?: {
        to: {
            enabled: boolean;
            scaleFactor: number;
            type: string;
        };
    };
    dashes?: boolean;
    smooth?: {
        enabled: boolean;
        type: string;
        roundness: number;
        forceDirection: string;
    };
}
