export type GoalType = 'directive' | 'project' | 'achievement' | 'routine' | 'task' | 'event';
export type RelationshipType = 'child';

// Resolution status - stored in database
export type ResolutionStatus = 'pending' | 'completed' | 'failed' | 'skipped';

// Display status - computed from resolution_status + dates
export type DisplayStatus = 'upcoming' | 'active' | 'late' | 'completed' | 'tardy' | 'failed' | 'skipped';

/**
 * Compute the display status for a goal based on its resolution status and dates.
 * - If resolution_status is 'completed', check if it was on time (completed) or late (tardy)
 * - If resolution_status is 'failed' or 'skipped', return that
 * - If resolution_status is 'pending', compute from dates (upcoming/active/late)
 */
export function getDisplayStatus(goal: Goal): DisplayStatus {
    const now = Date.now();
    const resolvedAt = goal.resolved_at?.getTime();
    const startTimestamp = goal.start_timestamp?.getTime() ?? goal.start_date?.getTime();
    const endTimestamp = goal.due_date?.getTime() ?? goal.end_timestamp?.getTime();

    switch (goal.resolution_status) {
        case 'completed':
            // Check if tardy (resolved after due/end date)
            if (resolvedAt && endTimestamp && resolvedAt > endTimestamp) {
                return 'tardy';
            }
            return 'completed';
        case 'failed':
            return 'failed';
        case 'skipped':
            return 'skipped';
        default:
            // Pending or undefined - compute temporal state
            if (startTimestamp && now < startTimestamp) {
                return 'upcoming';
            }
            if (endTimestamp && now > endTimestamp) {
                return 'late';
            }
            return 'active';
    }
}

// dates, time, timestamps as Date, durations as timestamp (number) as decided by whether you want timezone conversions or not.
export interface Goal {
    id: number;
    name: string;
    description?: string;
    goal_type: GoalType;
    priority?: 'high' | 'medium' | 'low';
    start_timestamp?: Date;
    end_timestamp?: Date;
    resolution_status?: ResolutionStatus;
    resolved_at?: Date;
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

    // For events only:
    parent_id?: number;
    parent_type?: 'task' | 'routine';
    routine_instance_id?: string;
    is_deleted?: boolean;

    // Modified for tasks:
    due_date?: Date;
    start_date?: Date;
    // Note: scheduled_timestamp is now event-only for tasks
    // Note: duration is now event-only for tasks

    // Google Calendar sync fields:
    gcal_event_id?: string;
    gcal_calendar_id?: string;
    gcal_sync_enabled?: boolean;
    gcal_last_sync?: Date;
    gcal_sync_direction?: 'bidirectional' | 'to_gcal' | 'from_gcal';
    is_gcal_imported?: boolean;

    // Modification tracking for conflict detection
    updated_at?: Date;
}

// Utility functions for timezone conversion
export interface CalendarResponse {
    events: Goal[];
    unscheduled_tasks: Goal[];
    routines: Goal[];
    achievements: Goal[];
    parents?: Goal[];
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
    parent?: Goal;
    type: 'event';
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
    color?: string | {
        background: string;
        border: string;
        highlight: { background: string; border: string; };
        hover: { background: string; border: string; };
    };
    x?: number;
    y?: number;
    size?: number;
    borderWidth?: number;
    font?: {
        size?: number;
        color?: string;
        bold?: {
            color?: string;
            size?: number;
            mod?: string;
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

export type ApiGoal = Omit<Goal, 'start_timestamp' | 'end_timestamp' | 'next_timestamp' | 'scheduled_timestamp' | 'routine_time' | 'due_date' | 'start_date' | 'gcal_last_sync' | 'updated_at' | 'resolved_at'> & {
    start_timestamp?: number | null;
    end_timestamp?: number | null;
    next_timestamp?: number | null;
    scheduled_timestamp?: number | null;
    routine_time?: number | null;
    due_date?: number | null;
    start_date?: number | null;
    gcal_last_sync?: number | null;
    updated_at?: number | null;
    resolved_at?: number | null;
};
