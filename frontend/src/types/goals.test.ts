import { getDisplayStatus, Goal } from './goals';

function goal(overrides: Partial<Goal> = {}): Goal {
    return {
        id: 1,
        name: 'Goal',
        goal_type: 'task',
        resolution_status: 'pending',
        ...overrides,
    };
}

describe('getDisplayStatus', () => {
    const now = Date.now();

    test('treats a routine past its end as completed while it is still pending', () => {
        expect(getDisplayStatus(goal({
            goal_type: 'routine',
            resolution_status: 'pending',
            end_timestamp: new Date(now - 1000),
        }))).toBe('completed');
    });

    test('does not override a routine that was already resolved', () => {
        expect(getDisplayStatus(goal({
            goal_type: 'routine',
            resolution_status: 'failed',
            end_timestamp: new Date(now - 1000),
        }))).toBe('failed');
        expect(getDisplayStatus(goal({
            goal_type: 'routine',
            resolution_status: 'skipped',
            end_timestamp: new Date(now - 1000),
        }))).toBe('skipped');
    });

    test('marks a completion tardy when it was resolved after the end', () => {
        expect(getDisplayStatus(goal({
            resolution_status: 'completed',
            end_timestamp: new Date(now - 5000),
            resolved_at: new Date(now - 1000),
        }))).toBe('tardy');
    });

    test('marks an on-time completion as completed', () => {
        expect(getDisplayStatus(goal({
            resolution_status: 'completed',
            due_date: new Date(now + 5000),
            resolved_at: new Date(now),
        }))).toBe('completed');
    });

    test('derives upcoming, late, and active from a pending goal', () => {
        expect(getDisplayStatus(goal({
            start_timestamp: new Date(now + 60_000),
        }))).toBe('upcoming');
        expect(getDisplayStatus(goal({
            start_date: new Date(now + 60_000),
        }))).toBe('upcoming');
        expect(getDisplayStatus(goal({
            due_date: new Date(now - 60_000),
        }))).toBe('late');
        expect(getDisplayStatus(goal({
            end_timestamp: new Date(now - 60_000),
        }))).toBe('late');
        expect(getDisplayStatus(goal())).toBe('active');
    });
});
