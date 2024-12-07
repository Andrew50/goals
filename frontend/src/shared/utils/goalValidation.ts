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