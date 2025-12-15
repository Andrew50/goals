import { buildHierarchy, formatEdgesForGraph, calculateNewNodePosition, saveNodePosition, BASE_SPACING } from './buildHierarchy';
import { NetworkNode, NetworkEdge } from '../../types/goals';

// Mock dependencies
jest.mock('../../shared/styles/colors', () => ({
    getGoalStyle: jest.fn((node: NetworkNode) => ({
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

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn().mockResolvedValue({}),
}));

beforeEach(() => {
    // CRA/Jest resets mock implementations between tests; ensure a default return value.
    const { getGoalStyle } = require('../../shared/styles/colors');
    getGoalStyle.mockReturnValue({
        backgroundColor: '#ffffff',
        border: '2px solid #000000',
        textColor: '#000000',
        borderColor: '#000000',
    });
});

describe('buildHierarchy', () => {
    test('returns empty arrays for empty input', async () => {
        const result = await buildHierarchy({ nodes: [], edges: [] });
        expect(result.nodes).toEqual([]);
        expect(result.edges).toEqual([]);
    });

    test('handles single node', async () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Node 1', goal_type: 'task', label: 'Node 1' },
        ];
        const edges: NetworkEdge[] = [];

        const result = await buildHierarchy({ nodes, edges });

        expect(result.nodes).toHaveLength(1);
        expect(result.edges).toEqual([]);
        expect(result.nodes[0].id).toBe(1);
        expect(result.nodes[0]).toHaveProperty('x');
        expect(result.nodes[0]).toHaveProperty('y');
    });

    test('handles simple tree structure', async () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Root', goal_type: 'project', label: 'Root' },
            { id: 2, name: 'Child 1', goal_type: 'task', label: 'Child 1' },
            { id: 3, name: 'Child 2', goal_type: 'task', label: 'Child 2' },
        ];
        const edges: NetworkEdge[] = [
            { from: 1, to: 2, relationship_type: 'child' },
            { from: 1, to: 3, relationship_type: 'child' },
        ];

        const result = await buildHierarchy({ nodes, edges });

        expect(result.nodes).toHaveLength(3);
        expect(result.edges).toHaveLength(2);
        expect(result.nodes.find(n => n.id === 1)).toBeDefined();
    });

    test('handles DAG (directed acyclic graph)', async () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'A', goal_type: 'project', label: 'A' },
            { id: 2, name: 'B', goal_type: 'task', label: 'B' },
            { id: 3, name: 'C', goal_type: 'task', label: 'C' },
            { id: 4, name: 'D', goal_type: 'task', label: 'D' },
        ];
        const edges: NetworkEdge[] = [
            { from: 1, to: 2, relationship_type: 'child' },
            { from: 1, to: 3, relationship_type: 'child' },
            { from: 2, to: 4, relationship_type: 'child' },
            { from: 3, to: 4, relationship_type: 'child' },
        ];

        const result = await buildHierarchy({ nodes, edges });

        expect(result.nodes).toHaveLength(4);
        expect(result.edges).toHaveLength(4);
    });

    test('handles disconnected graph', async () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Node 1', goal_type: 'task', label: 'Node 1' },
            { id: 2, name: 'Node 2', goal_type: 'task', label: 'Node 2' },
        ];
        const edges: NetworkEdge[] = [];

        const result = await buildHierarchy({ nodes, edges });

        expect(result.nodes).toHaveLength(2);
        expect(result.edges).toEqual([]);
    });

    test('preserves stored node positions', async () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Fixed', goal_type: 'task', label: 'Fixed', position_x: 100, position_y: 200 },
            { id: 2, name: 'Free', goal_type: 'task', label: 'Free' },
        ];
        const edges: NetworkEdge[] = [
            { from: 1, to: 2, relationship_type: 'child' },
        ];

        const result = await buildHierarchy({ nodes, edges });

        const fixedNode = result.nodes.find(n => n.id === 1);
        expect(fixedNode?.x).toBe(100);
        expect(fixedNode?.y).toBe(200);
    });

    test('respects savePositions option', async () => {
        const { privateRequest } = require('../../shared/utils/api');
        privateRequest.mockClear();

        const nodes: NetworkNode[] = [
            { id: 1, name: 'Node', goal_type: 'task', label: 'Node' },
        ];
        const edges: NetworkEdge[] = [];

        // Should save by default
        await buildHierarchy({ nodes, edges });
        expect(privateRequest).toHaveBeenCalled();

        privateRequest.mockClear();

        // Should not save when savePositions is false
        await buildHierarchy({ nodes, edges }, { savePositions: false });
        expect(privateRequest).not.toHaveBeenCalled();
    });

    test('respects custom baseSpacing', async () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Node', goal_type: 'task', label: 'Node' },
        ];
        const edges: NetworkEdge[] = [];

        const result = await buildHierarchy({ nodes, edges }, { baseSpacing: 1000 });
        // The spacing affects layout, so we just verify it doesn't crash
        expect(result.nodes).toHaveLength(1);
    });
});

describe('formatEdgesForGraph', () => {
    test('formats edges with visual properties', () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Parent', goal_type: 'project', label: 'Parent' },
            { id: 2, name: 'Child', goal_type: 'task', label: 'Child' },
        ];
        const edges: NetworkEdge[] = [
            { from: 1, to: 2, relationship_type: 'child' },
        ];

        const formatted = formatEdgesForGraph(nodes, edges);

        expect(formatted).toHaveLength(1);
        expect(formatted[0]).toHaveProperty('id', '1-2');
        expect(formatted[0]).toHaveProperty('width');
        expect(formatted[0]).toHaveProperty('color');
        expect(formatted[0]).toHaveProperty('arrows');
        expect(formatted[0]?.arrows?.to?.enabled).toBe(true);
    });

    test('handles multiple edges', () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'A', goal_type: 'task', label: 'A' },
            { id: 2, name: 'B', goal_type: 'task', label: 'B' },
            { id: 3, name: 'C', goal_type: 'task', label: 'C' },
        ];
        const edges: NetworkEdge[] = [
            { from: 1, to: 2, relationship_type: 'child' },
            { from: 1, to: 3, relationship_type: 'child' },
        ];

        const formatted = formatEdgesForGraph(nodes, edges);

        expect(formatted).toHaveLength(2);
    });

    test('handles empty edges', () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Node', goal_type: 'task', label: 'Node' },
        ];
        const edges: NetworkEdge[] = [];

        const formatted = formatEdgesForGraph(nodes, edges);

        expect(formatted).toEqual([]);
    });

    test('calculates descendant counts for edge width', () => {
        const nodes: NetworkNode[] = [
            { id: 1, name: 'Root', goal_type: 'project', label: 'Root' },
            { id: 2, name: 'Child', goal_type: 'task', label: 'Child' },
            { id: 3, name: 'Grandchild', goal_type: 'task', label: 'Grandchild' },
        ];
        const edges: NetworkEdge[] = [
            { from: 1, to: 2, relationship_type: 'child' },
            { from: 2, to: 3, relationship_type: 'child' },
        ];

        const formatted = formatEdgesForGraph(nodes, edges);

        // Root-to-child edge should have higher width (more descendants)
        const rootEdge = formatted.find(e => e.from === 1);
        const childEdge = formatted.find(e => e.from === 2);
        expect(rootEdge).toBeDefined();
        expect(childEdge).toBeDefined();
        if (rootEdge && childEdge && rootEdge.width !== undefined && childEdge.width !== undefined) {
            expect(rootEdge.width).toBeGreaterThanOrEqual(childEdge.width);
        }
    });
});

describe('calculateNewNodePosition', () => {
    test('returns origin for first node', () => {
        const newNode: NetworkNode = { id: 1, name: 'New', goal_type: 'task', label: 'New' };
        const position = calculateNewNodePosition(newNode, []);
        expect(position).toEqual({ x: 0, y: 0 });
    });

    test('places nodes in golden ratio spiral', () => {
        const existingNodes: NetworkNode[] = [
            { id: 1, name: 'Node 1', goal_type: 'task', label: 'Node 1' },
        ];
        const newNode: NetworkNode = { id: 2, name: 'New', goal_type: 'task', label: 'New' };

        const position = calculateNewNodePosition(newNode, existingNodes);

        expect(position).toHaveProperty('x');
        expect(position).toHaveProperty('y');
        expect(typeof position.x).toBe('number');
        expect(typeof position.y).toBe('number');
    });

    test('increases radius with more nodes', () => {
        const newNode: NetworkNode = { id: 10, name: 'New', goal_type: 'task', label: 'New' };
        const fewNodes: NetworkNode[] = Array.from({ length: 3 }, (_, i) => ({
            id: i + 1,
            name: `Node ${i + 1}`,
            goal_type: 'task' as const,
            label: `Node ${i + 1}`,
        }));
        const manyNodes: NetworkNode[] = Array.from({ length: 10 }, (_, i) => ({
            id: i + 1,
            name: `Node ${i + 1}`,
            goal_type: 'task' as const,
            label: `Node ${i + 1}`,
        }));

        const posFew = calculateNewNodePosition(newNode, fewNodes);
        const posMany = calculateNewNodePosition(newNode, manyNodes);

        const distFew = Math.sqrt(posFew.x ** 2 + posFew.y ** 2);
        const distMany = Math.sqrt(posMany.x ** 2 + posMany.y ** 2);

        expect(distMany).toBeGreaterThan(distFew);
    });
});

describe('saveNodePosition', () => {
    test('saves valid coordinates', async () => {
        const { privateRequest } = require('../../shared/utils/api');
        privateRequest.mockClear();

        const result = await saveNodePosition(1, 100, 200);

        expect(result).toBe(true);
        expect(privateRequest).toHaveBeenCalledWith('network/1/position', 'PUT', { x: 100, y: 200 });
    });

    test('skips invalid coordinates', async () => {
        const { privateRequest } = require('../../shared/utils/api');
        privateRequest.mockClear();

        const result1 = await saveNodePosition(1, NaN, 200);
        const result2 = await saveNodePosition(1, 100, Infinity);

        expect(result1).toBe(false);
        expect(result2).toBe(false);
        expect(privateRequest).not.toHaveBeenCalled();
    });

    test('handles API errors gracefully', async () => {
        const { privateRequest } = require('../../shared/utils/api');
        privateRequest.mockRejectedValueOnce(new Error('API error'));

        const result = await saveNodePosition(1, 100, 200);

        expect(result).toBe(false);
    });
});

