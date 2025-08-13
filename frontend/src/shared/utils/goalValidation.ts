import { Goal, RelationshipType } from '../../types/goals';

function isUnsetDate(val: any) {
    return !(val instanceof Date) || val.getTime() === 0;
}

export function validateRelationship(fromGoal: Goal, toGoal: Goal, relationshipType: RelationshipType): string | null {
    // Events cannot have children
    if (relationshipType === 'child' && fromGoal.goal_type === 'event') {
        return 'Events cannot have children.';
    }

    // Events cannot be in relationships
    if (toGoal.goal_type === 'event') {
        return 'Events cannot be targets of relationships.';
    }

    // If the relationship being formed is 'child'
    if (relationshipType === 'child') {
        if (fromGoal.goal_type === 'task') {
            return 'Tasks cannot have children (i.e., cannot be parents).';
        }
        // Tasks should not be children of routines
        if (fromGoal.goal_type === 'routine' && toGoal.goal_type === 'task') {
            return 'Tasks cannot be children of routines.';
        }
        // Routines should not be children of tasks (but tasks can't be parents anyway due to check above)
        if (toGoal.goal_type === 'routine' && fromGoal.goal_type !== 'routine') {
            // Only allow routines to be children of other routines, projects, directives, or achievements
            if (!['routine', 'project', 'directive', 'achievement'].includes(fromGoal.goal_type)) {
                return 'Routines can only be children of routines, projects, directives, or achievements.';
            }
        }
    }

    if (relationshipType === 'queue') {
        if (fromGoal.goal_type !== 'achievement') {
            return 'Queue relationships can only start from an Achievement.';
        }
        if (toGoal.goal_type !== 'achievement') {
            // Corrected the confusing message here, queue is between achievements
            return 'Queue relationships can only connect to another Achievement.';
        }
    }
    return null; // Return null if validation passes
}


export function validateGoal(goal: Goal): string[] {
    const validationErrors: string[] = [];
    if (!goal.goal_type) {
        validationErrors.push('Goal type is required');
    }
    if (!goal.name) {
        validationErrors.push('Name is required');
    }
    if (goal.goal_type) {
        switch (goal.goal_type) {
            case 'event':
                if (!goal.parent_id) {
                    validationErrors.push('Events must have a parent task or routine');
                }
                if (isUnsetDate(goal.scheduled_timestamp)) {
                    validationErrors.push('Events must have a scheduled time');
                }
                if (!goal.duration) {
                    validationErrors.push('Events must have a duration');
                }
                break;
            case 'routine':
                if (!goal.frequency) {
                    validationErrors.push('Frequency is required');
                } else {
                    const frequencyMatch = goal.frequency.match(/^\d+[DWMY](?::(.+))?$/);
                    if (!frequencyMatch) {
                        validationErrors.push('Invalid frequency format');
                    } else {
                        const [interval, unit, days] = goal.frequency.match(/^(\d+)([DWMY])(?::(.+))?$/) || [];
                        if (interval && parseInt(interval) < 1) {
                            validationErrors.push('Frequency interval must be at least 1');
                        }
                        if (unit === 'W' && (!days || days.split(',').length === 0)) {
                            validationErrors.push('At least one day must be selected for weekly frequency');
                        }
                    }
                }
                if (isUnsetDate(goal.start_timestamp)) {
                    validationErrors.push('Start Date is required');
                }
                if (!goal.duration) {
                    validationErrors.push('Duration is required');
                }
                break;
            case 'task':
                // Duration is no longer required for tasks - it will be calculated from child events
                break;
            case 'project':
            case 'achievement':
                if (isUnsetDate(goal.start_timestamp)) {
                    validationErrors.push('Start Date is required');
                }
                break;
        }
    }

    // Validate timestamp fields are Date objects if they exist
    const timestampFields: (keyof Goal)[] = [
        'start_timestamp',
        'end_timestamp',
        'scheduled_timestamp',
        'routine_time',
        'next_timestamp',
        'due_date',
        'start_date'
    ];

    timestampFields.forEach(field => {
        const value = goal[field];
        if (value !== null && value !== undefined && !(value instanceof Date)) {
            validationErrors.push(`${field} must be a valid Date object instead of ${typeof value}`);
            console.trace()
        }
    });

    return validationErrors
}
