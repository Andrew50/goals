import { Goal, RelationshipType } from '../../types/goals';

export function validateRelationship(fromGoal: Goal, toGoal: Goal, relationshipType: RelationshipType): string | null {
    // Check if source is a task
    if (fromGoal.goal_type === 'task') {
        return 'Tasks cannot have children';
    }

    // Check directive to achievement connection
    if (fromGoal.goal_type === 'directive' && toGoal.goal_type === 'achievement') {
        return 'Directives cannot directly connect to achievements';
    }

    // Check queue relationship constraints
    if (relationshipType === 'queue') {
        if (fromGoal.goal_type !== 'achievement') {
            return 'Queue relationships can only be created on achievements';
        }
        if (toGoal.goal_type !== 'task') {
            return 'Queue relationships can only connect to tasks';
        }
    }

    return null; // Return null if validation passes
} 


export function validateGoal(goal:Goal): string[] {
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
    return validationErrors
}
