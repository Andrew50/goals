import { validateGoal, validateRelationship } from './goalValidation';
import { Goal } from '../../types/goals';

describe('validateGoal', () => {
    test('returns empty array for valid task', () => {
        const goal: Goal = {
            id: 1,
            name: 'Test Task',
            goal_type: 'task',
        };
        expect(validateGoal(goal)).toEqual([]);
    });

    test('returns error when goal_type is missing', () => {
        const goal: Partial<Goal> = {
            id: 1,
            name: 'Test',
        };
        expect(validateGoal(goal as Goal)).toContain('Goal type is required');
    });

    test('returns error when name is missing', () => {
        const goal: Goal = {
            id: 1,
            name: '',
            goal_type: 'task',
        };
        expect(validateGoal(goal)).toContain('Name is required');
    });

    test('validates event requirements', () => {
        const invalidEvent: Goal = {
            id: 1,
            name: 'Event',
            goal_type: 'event',
        };
        const errors = validateGoal(invalidEvent);
        expect(errors).toContain('Events must have a parent task or routine');
        expect(errors).toContain('Events must have a scheduled time');
        expect(errors).toContain('Events must have a duration');

        const validEvent: Goal = {
            id: 1,
            name: 'Event',
            goal_type: 'event',
            parent_id: 1,
            scheduled_timestamp: new Date(2023, 0, 1, 10, 0),
            duration: 60,
        };
        expect(validateGoal(validEvent)).toEqual([]);
    });

    test('validates routine requirements', () => {
        const invalidRoutine: Goal = {
            id: 1,
            name: 'Routine',
            goal_type: 'routine',
        };
        const errors = validateGoal(invalidRoutine);
        expect(errors).toContain('Frequency is required');
        expect(errors).toContain('Start Date is required');
        expect(errors).toContain('Duration is required');

        const routineWithInvalidFrequency: Goal = {
            id: 1,
            name: 'Routine',
            goal_type: 'routine',
            frequency: 'invalid',
            start_timestamp: new Date(2023, 0, 1),
            duration: 60,
        };
        expect(validateGoal(routineWithInvalidFrequency)).toContain('Invalid frequency format');

        const routineWithZeroInterval: Goal = {
            id: 1,
            name: 'Routine',
            goal_type: 'routine',
            frequency: '0D',
            start_timestamp: new Date(2023, 0, 1),
            duration: 60,
        };
        expect(validateGoal(routineWithZeroInterval)).toContain('Frequency interval must be at least 1');

        // Test with frequency that has colon but empty days string
        // The regex (?::(.+))? means if colon exists, days must have at least one char
        // So '1W:' doesn't match the regex and fails "Invalid frequency format"
        // We need a frequency that matches but has empty days - but that's not possible with this regex
        // Instead, test with '1W' (no colon) - this matches but days is undefined
        // The validation checks: if (unit === 'W' && (!days || days.split(',').length === 0))
        // For '1W', days is undefined, so !days is true, triggering the error
        const weeklyRoutineWithoutDays: Goal = {
            id: 1,
            name: 'Routine',
            goal_type: 'routine',
            frequency: '1W', // No days specified - matches regex but days is undefined
            start_timestamp: new Date(2023, 0, 1),
            duration: 60,
        };
        const weeklyErrors = validateGoal(weeklyRoutineWithoutDays);
        expect(weeklyErrors).toContain('At least one day must be selected for weekly frequency');

        const validRoutine: Goal = {
            id: 1,
            name: 'Routine',
            goal_type: 'routine',
            frequency: '1W:0,1',
            start_timestamp: new Date(2023, 0, 1),
            duration: 60,
        };
        expect(validateGoal(validRoutine)).toEqual([]);
    });

    test('validates project requirements', () => {
        const invalidProject: Goal = {
            id: 1,
            name: 'Project',
            goal_type: 'project',
        };
        expect(validateGoal(invalidProject)).toContain('Start Date is required');

        const validProject: Goal = {
            id: 1,
            name: 'Project',
            goal_type: 'project',
            start_timestamp: new Date(2023, 0, 1),
        };
        expect(validateGoal(validProject)).toEqual([]);
    });

    test('validates achievement requirements', () => {
        const invalidAchievement: Goal = {
            id: 1,
            name: 'Achievement',
            goal_type: 'achievement',
        };
        expect(validateGoal(invalidAchievement)).toContain('Start Date is required');

        const validAchievement: Goal = {
            id: 1,
            name: 'Achievement',
            goal_type: 'achievement',
            start_timestamp: new Date(2023, 0, 1),
        };
        expect(validateGoal(validAchievement)).toEqual([]);
    });

    test('validates timestamp fields are Date objects', () => {
        const goalWithInvalidTimestamp: Goal = {
            id: 1,
            name: 'Task',
            goal_type: 'task',
            start_timestamp: 'not a date' as any,
        };
        const errors = validateGoal(goalWithInvalidTimestamp);
        expect(errors.some(e => e.includes('must be a valid Date object'))).toBe(true);
    });

    test('accepts unset dates (Date with time 0)', () => {
        const goalWithUnsetDate: Goal = {
            id: 1,
            name: 'Task',
            goal_type: 'task',
            start_timestamp: new Date(0),
        };
        // Should not error on unset dates (they're valid Date objects)
        const errors = validateGoal(goalWithUnsetDate);
        expect(errors.some(e => e.includes('must be a valid Date object'))).toBe(false);
    });
});

describe('validateRelationship', () => {
    const createGoal = (overrides: Partial<Goal>): Goal => ({
        id: 1,
        name: 'Test',
        goal_type: 'task',
        ...overrides,
    });

    test('allows valid child relationship', () => {
        const parent = createGoal({ goal_type: 'project' });
        const child = createGoal({ goal_type: 'task' });
        expect(validateRelationship(parent, child, 'child')).toBeNull();
    });

    test('prevents events from having children', () => {
        const event = createGoal({ goal_type: 'event' });
        const child = createGoal({ goal_type: 'task' });
        expect(validateRelationship(event, child, 'child')).toBe('Events cannot have children.');
    });

    test('prevents events from being targets', () => {
        const parent = createGoal({ goal_type: 'project' });
        const event = createGoal({ goal_type: 'event' });
        expect(validateRelationship(parent, event, 'child')).toBe('Events cannot be targets of relationships.');
    });

    test('prevents tasks from having children', () => {
        const task = createGoal({ goal_type: 'task' });
        const child = createGoal({ goal_type: 'task' });
        expect(validateRelationship(task, child, 'child')).toBe('Tasks cannot have children (i.e., cannot be parents).');
    });

    test('allows achievements only as children of projects', () => {
        const routine = createGoal({ goal_type: 'routine' });
        const achievement = createGoal({ goal_type: 'achievement' });
        expect(validateRelationship(routine, achievement, 'child')).toBe('Achievements can only be children of projects.');

        const project = createGoal({ goal_type: 'project' });
        expect(validateRelationship(project, achievement, 'child')).toBeNull();
    });

    test('prevents tasks from being children of routines', () => {
        const routine = createGoal({ goal_type: 'routine' });
        const task = createGoal({ goal_type: 'task' });
        expect(validateRelationship(routine, task, 'child')).toBe('Tasks cannot be children of routines.');
    });

    test('allows routines as children of valid parent types', () => {
        const project = createGoal({ goal_type: 'project' });
        const routine = createGoal({ goal_type: 'routine' });
        expect(validateRelationship(project, routine, 'child')).toBeNull();

        const directive = createGoal({ goal_type: 'directive' });
        expect(validateRelationship(directive, routine, 'child')).toBeNull();

        const achievement = createGoal({ goal_type: 'achievement' });
        expect(validateRelationship(achievement, routine, 'child')).toBeNull();

        const parentRoutine = createGoal({ goal_type: 'routine' });
        expect(validateRelationship(parentRoutine, routine, 'child')).toBeNull();
    });

    test('prevents routines from being children of invalid parent types', () => {
        // Tasks can't be parents at all, so this check happens first
        const task = createGoal({ goal_type: 'task' });
        const routine = createGoal({ goal_type: 'routine' });
        // The validation checks if task can be parent first, which fails
        expect(validateRelationship(task, routine, 'child')).toBe('Tasks cannot have children (i.e., cannot be parents).');
        
        // Events also can't be parents at all
        const event = createGoal({ goal_type: 'event' });
        expect(validateRelationship(event, routine, 'child')).toBe('Events cannot have children.');
    });
});

