import { Goal } from '../../types/goals';
import {
    dimIfCompleted,
    getBaseColor,
    getEffectiveType,
    getGoalColor,
    getGoalStyle,
    getPriorityBorder,
    getPriorityBorderColor,
} from './colors';

function goal(overrides: Partial<Goal> = {}): Goal {
    return {
        id: 1,
        name: 'Goal',
        goal_type: 'task',
        ...overrides,
    };
}

describe('colors', () => {
    test('returns a base color for every goal type', () => {
        expect(getBaseColor('directive')).toMatch(/^#/);
        expect(getBaseColor('project')).toMatch(/^#/);
        expect(getBaseColor('achievement')).toMatch(/^#/);
        expect(getBaseColor('routine')).toMatch(/^#/);
        expect(getBaseColor('task')).toMatch(/^#/);
        expect(getBaseColor('event')).toMatch(/^#/);
    });

    test('dims completed colors and keeps pending colors solid', () => {
        expect(dimIfCompleted('#112233', true)).toBe('#11223380');
        expect(dimIfCompleted('#112233', false)).toBe('#112233');
        expect(dimIfCompleted('#112233')).toBe('#112233');
    });

    test('uses the parent type for events and the goal type otherwise', () => {
        expect(getEffectiveType(goal({ goal_type: 'event', parent_type: 'routine' }))).toBe('routine');
        expect(getEffectiveType(goal({ goal_type: 'event' }))).toBe('event');
        expect(getEffectiveType(goal({ goal_type: 'project' }))).toBe('project');
    });

    test('mutes resolved goals and keeps pending goals solid', () => {
        const pending = getGoalColor(goal());
        const done = getGoalColor(goal({ resolution_status: 'completed' }));
        const failed = getGoalColor(goal({ resolution_status: 'failed' }));
        expect(done).toBe(`${pending}80`);
        expect(failed).toBe(`${pending}80`);
        expect(getGoalColor(goal({ resolution_status: 'pending' }))).toBe(pending);
    });

    test('does not draw a priority outline and still names a priority color', () => {
        expect(getPriorityBorder('high')).toBe('none');
        expect(getPriorityBorder()).toBe('none');
        expect(getPriorityBorderColor('high')).toMatch(/^#/);
        expect(getPriorityBorderColor('medium')).toMatch(/^#/);
        expect(getPriorityBorderColor('low')).toMatch(/^#/);
        expect(getPriorityBorderColor()).toBe('#9AA0A8');
    });

    test('styles a goal from its fill color', () => {
        const style = getGoalStyle(goal({ goal_type: 'event', parent_type: 'task', resolution_status: 'skipped' }));
        expect(style.border).toBe('none');
        expect(style.textColor).toBe('#ffffff');
        expect(style.borderColor).toBe(style.backgroundColor);
        expect(style.backgroundColor.endsWith('80')).toBe(true);
    });
});
