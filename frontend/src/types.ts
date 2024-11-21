export type GoalType = 'directive' | 'project' | 'achievement' | 'routine' | 'task';
export interface Goal {
    id?: number;
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
}
export interface CalendarResponse {
    assigned_tasks: Goal[];
    unassigned_tasks: Goal[];
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
}
