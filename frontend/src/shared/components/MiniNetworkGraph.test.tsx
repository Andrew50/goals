import React from 'react';
import { act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import MiniNetworkGraph from './MiniNetworkGraph';
import { getGoalSubgraph } from '../utils/api';
import { buildHierarchy } from '../../pages/network/buildHierarchy';
import { Network } from 'vis-network/standalone';

jest.mock('../utils/api', () => ({
    privateRequest: jest.fn(),
    getGoalSubgraph: jest.fn(),
}));

jest.mock('../../pages/network/buildHierarchy', () => ({
    buildHierarchy: jest.fn(async (graph: { nodes?: unknown[]; edges?: unknown[] }) => graph),
}));

jest.mock('vis-network/standalone', () => {
    const instances: any[] = [];
    class DataSet {
        private data: any[];
        constructor(initial?: any[]) {
            this.data = Array.isArray(initial) ? [...initial] : [];
        }
        add = (items?: any) => {
            const list = items == null ? [] : Array.isArray(items) ? items : [items];
            this.data.push(...list);
        };
        update = () => undefined;
        remove = () => undefined;
        clear = () => {
            this.data = [];
        };
        get = (id?: any) => {
            if (id == null) return this.data;
            return this.data.find((item) => item.id === id) ?? null;
        };
    }
    class Network {
        static instances = instances;
        body: { nodes: Record<string, any> };
        handlers: Record<string, Function>;
        setData = jest.fn();
        constructor(_container: unknown, data?: { nodes?: { get: () => any[] } }) {
            const nodes = data?.nodes?.get?.() || [];
            const map: Record<string, any> = {};
            nodes.forEach((node, index) => {
                const vertical = index === 1;
                const sameSpot = index === 2;
                map[node.id] = {
                    x: sameSpot || vertical ? 0 : index * 40,
                    y: sameSpot ? 0 : vertical ? 8 : 0,
                    shape: { width: 80, height: 28 },
                    options: { label: node.label },
                    label: node.label,
                };
            });
            this.body = { nodes: map };
            this.handlers = {};
            instances.push(this);
        }
        destroy = () => undefined;
        fit = () => undefined;
        on = (event: string, cb: Function) => {
            this.handlers[event] = cb;
        };
        off = () => undefined;
        getNodeAt = () => {
            const ids = Object.keys(this.body.nodes);
            if (!ids.length) return null;
            const id = Number(ids[0]);
            return Number.isNaN(id) ? ids[0] : id;
        };
    }
    return { DataSet, Network };
});

const subgraph = {
    nodes: [
        { id: 1, name: 'Center', goal_type: 'task' },
        { id: 2, name: 'A'.repeat(80), goal_type: 'project' },
        { id: 3, name: 'Sibling', goal_type: 'routine' },
        { id: 4, name: '', goal_type: 'achievement' },
        { id: 5, name: 'Stray', goal_type: 'directive' },
    ],
    edges: [
        { from: 1, to: 2, relationship_type: 'child' },
        { from: 1, to: 3, relationship_type: 'child' },
        { from: 2, to: 2, relationship_type: 'child' },
        { from: 1, to: 99, relationship_type: 'child' },
    ],
    truncated: false,
};

describe('MiniNetworkGraph', () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

    beforeEach(() => {
        (Network as any).instances.length = 0;
        (getGoalSubgraph as jest.Mock).mockResolvedValue(subgraph);
        (buildHierarchy as jest.Mock).mockImplementation(async (graph) => graph || { nodes: [], edges: [] });
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 240 });
    });

    afterEach(() => {
        if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
        if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
    });

    test('renders mini network graph container', () => {
        renderWithProviders(<MiniNetworkGraph centerId={1} />, {
            withGoalMenu: true,
        });

        expect(document.querySelector('div')).toBeInTheDocument();
    });

    test('lays out a subgraph and refits when relationships change', async () => {
        const onNodeClick = jest.fn();
        const view = renderWithProviders(
            <MiniNetworkGraph centerId={1} onNodeClick={onNodeClick} />,
            { withGoalMenu: true }
        );

        await waitFor(() => {
            expect(getGoalSubgraph).toHaveBeenCalledWith(1);
            expect((Network as any).instances.length).toBeGreaterThan(0);
        });

        const network = (Network as any).instances[0];
        act(() => {
            network.handlers.click?.({ pointer: { DOM: { x: 1, y: 1 } } });
        });
        expect(onNodeClick).toHaveBeenCalled();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 220));
        });

        (getGoalSubgraph as jest.Mock).mockRejectedValueOnce(new Error('subgraph down'));
        act(() => {
            window.dispatchEvent(new Event('network:relationships-changed'));
        });
        await waitFor(() => {
            expect(getGoalSubgraph).toHaveBeenCalledTimes(2);
        });

        view.unmount();
    });

    test('handles empty network data', async () => {
        (getGoalSubgraph as jest.Mock).mockResolvedValue({ nodes: [], edges: [], truncated: false });
        renderWithProviders(<MiniNetworkGraph centerId={1} />, {
            withGoalMenu: true,
        });

        await waitFor(() => {
            expect(document.querySelector('div')).toBeInTheDocument();
        });
    });

    test('handles missing centerId', () => {
        renderWithProviders(<MiniNetworkGraph />, {
            withGoalMenu: true,
        });

        expect(document.querySelector('div')).toBeInTheDocument();
    });
});
