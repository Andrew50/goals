import { formatNetworkNode } from './formatNetworkNode';
import { Goal } from '../../types/goals';

// Mock getGoalStyle to return predictable values
jest.mock('../styles/colors', () => ({
    getGoalStyle: jest.fn((goal: Goal) => ({
        backgroundColor: '#ffffff',
        border: '2px solid #000000',
        textColor: '#000000',
        borderColor: '#000000',
    })),
    getGoalColor: jest.fn(),
    getBaseColor: jest.fn(),
    getPriorityBorder: jest.fn(),
    getPriorityBorderColor: jest.fn(),
    getEffectiveType: jest.fn(),
    dimIfCompleted: jest.fn(),
}));

describe('formatNetworkNode', () => {
    beforeEach(() => {
        // CRA/Jest resets mock implementations between tests; ensure a default return value.
        const { getGoalStyle } = require('../styles/colors');
        getGoalStyle.mockReturnValue({
            backgroundColor: '#ffffff',
            border: '2px solid #000000',
            textColor: '#000000',
            borderColor: '#000000',
        });
    });

    test('formats a goal into a network node', () => {
        const goal: Goal = {
            id: 1,
            name: 'Test Goal',
            goal_type: 'task',
        };

        const node = formatNetworkNode(goal);

        expect(node).toMatchObject({
            id: 1,
            name: 'Test Goal',
            goal_type: 'task',
            label: 'Test Goal',
            title: 'Test Goal (task)',
        });
        expect(node.color).toBeDefined();
        expect(node.borderWidth).toBe(2);
        expect(node.font).toBeDefined();
    });

    test('extracts border width from border string', () => {
        const goal: Goal = {
            id: 1,
            name: 'Test',
            goal_type: 'task',
        };

        const node = formatNetworkNode(goal);
        expect(node.borderWidth).toBe(2);
    });

    test('handles different border widths', () => {
        // Mock getGoalStyle to return different border width
        const { getGoalStyle } = require('../styles/colors');
        getGoalStyle.mockReturnValueOnce({
            backgroundColor: '#ffffff',
            border: '5px solid #000000',
            textColor: '#000000',
            borderColor: '#000000',
        });

        const goal: Goal = {
            id: 1,
            name: 'Test',
            goal_type: 'task',
        };

        const node = formatNetworkNode(goal);
        expect(node.borderWidth).toBe(5);
    });

    test('handles missing border width gracefully', () => {
        const { getGoalStyle } = require('../styles/colors');
        getGoalStyle.mockReturnValueOnce({
            backgroundColor: '#ffffff',
            border: 'solid #000000', // No width
            textColor: '#000000',
            borderColor: '#000000',
        });

        const goal: Goal = {
            id: 1,
            name: 'Test',
            goal_type: 'task',
        };

        const node = formatNetworkNode(goal);
        expect(node.borderWidth).toBe(0);
    });

    test('preserves all goal properties', () => {
        const goal: Goal = {
            id: 42,
            name: 'Complex Goal',
            goal_type: 'project',
            priority: 'high',
            start_timestamp: new Date(2023, 0, 1),
        };

        const node = formatNetworkNode(goal);

        expect(node.id).toBe(42);
        expect(node.name).toBe('Complex Goal');
        expect(node.goal_type).toBe('project');
        expect(node.priority).toBe('high');
        expect(node.start_timestamp).toEqual(new Date(2023, 0, 1));
    });
});

