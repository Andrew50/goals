import { Goal, RelationshipType } from '../../types/goals';

export function validateRelationship(fromGoal: Goal, toGoal: Goal, relationshipType: RelationshipType): string | null {
    if (fromGoal.goal_type === 'task') {
        return 'Tasks cannot have children';
    }
    if (fromGoal.goal_type === 'directive' && toGoal.goal_type === 'achievement') {
        return 'Directives cannot directly connect to achievements';
    }
    if (relationshipType === 'queue') {
        if (fromGoal.goal_type !== 'achievement') {
            return 'Queue relationships can only be created on achievements';
        }
        if (toGoal.goal_type !== 'achievement') {
            return 'Queue relationships can only connect to tasks';
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
            case 'routine':
                if (!goal.frequency) {
                    validationErrors.push('Frequency is required');
                } else {
                    const frequencyMatch = goal.frequency.match(/^(\d+)([DWMY])(?::(.+))?$/);
                    if (!frequencyMatch) {
                        validationErrors.push('Invalid frequency format');
                    } else {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const [unused, interval, unit, days] = frequencyMatch;
                        if (parseInt(interval) < 1) {
                            validationErrors.push('Frequency interval must be at least 1');
                        }
                        if (unit === 'W' && (!days || days.split(',').length === 0)) {
                            validationErrors.push('At least one day must be selected for weekly frequency');
                        }
                    }
                }
                if (!goal.start_timestamp) {
                    validationErrors.push('Start Date is required');
                }
                if (!goal.routine_type) {
                    validationErrors.push('Routine type is required');
                }
                if (goal.routine_type === "task" && !goal.duration) {
                    validationErrors.push('Duration is required')
                }
                break;
            case 'task':
                if (!goal.duration) {
                    validationErrors.push('Duration is required');
                }
                break;
            case 'project':
            case 'achievement':
                if (!goal.start_timestamp) {
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
        'next_timestamp'
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
