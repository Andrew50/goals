export type GoalType = 'directive' | 'project' | 'achievement' | 'routine' | 'task';
export type RelationshipType = 'child' | 'queue';

// dates, time, timestamps as Date, durations as timestamp (number) as decided by whether you want timezone conversions or not.
export interface Goal {
    id: number;
    name: string;
    description?: string;
    goal_type: GoalType;
    priority?: 'high' | 'medium' | 'low';
    start_timestamp?: Date;
    end_timestamp?: Date;
    completed?: boolean;
    frequency?: string;
    next_timestamp?: Date;
    routine_name?: string;
    routine_description?: string;
    routine_type?: 'task' | 'achievement';
    routine_duration?: number;
    routine_time?: Date;
    scheduled_timestamp?: Date;
    duration?: number; // minuites
    _tz?: 'utc' | 'user';
    position_x?: number;
    position_y?: number;
    _failed_conversion?: boolean; // Flag to track failed timezone conversions
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
export type ApiGoal = Omit<Goal, 'start_timestamp' | 'end_timestamp' | 'next_timestamp' | 'scheduled_timestamp' | 'routine_time'> & {
  start_timestamp?: number | null;
  end_timestamp?: number | null;
  next_timestamp?: number | null;
  scheduled_timestamp?: number | null;
  routine_time?: number | null;
};
