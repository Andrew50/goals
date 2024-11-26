// Initialize node levels
import { NetworkNode, NetworkEdge } from '../types';
export function buildHierarchy(networkData: { nodes: NetworkNode[], edges: NetworkEdge[] }) {
    const nodeLevels: { [key: number]: number | null } = {};
    const nodes = networkData.nodes.map((node: NetworkNode) => node.id);

    // Initialize levels to null
    nodes.forEach((nodeId: number | undefined) => {
        if (nodeId !== undefined) {
            nodeLevels[nodeId] = null;
        }
    });

    // Build adjacency lists
    const incomingChildEdges: { [key: number]: number[] } = {};
    const outgoingChildEdges: { [key: number]: number[] } = {};
    const outgoingQueueEdges: { [key: number]: number[] } = {};

    nodes.forEach((nodeId: number | undefined) => {
        if (nodeId !== undefined) {
            incomingChildEdges[nodeId] = [];
            outgoingChildEdges[nodeId] = [];
            outgoingQueueEdges[nodeId] = [];
        }
    });

    networkData.edges.forEach(edge => {
        if (edge.relationship_type === 'child') {
            incomingChildEdges[edge.to].push(edge.from);
            outgoingChildEdges[edge.from].push(edge.to);
        } else if (edge.relationship_type === 'queue') {
            outgoingQueueEdges[edge.from].push(edge.to);
        }
    });

    // Find root nodes (nodes with no incoming 'child' edges)
    const rootNodes = nodes.filter((nodeId: number | undefined) => {
        if (nodeId !== undefined) {
            return incomingChildEdges[nodeId].length === 0;
        }
        return false;
    });

    // Initialize a queue for BFS traversal
    const queue = [...rootNodes];

    // Set level 0 for root nodes
    rootNodes.forEach(nodeId => {
        if (nodeId !== undefined) {
            nodeLevels[nodeId] = 0;
        }
    });

    // BFS traversal to assign levels
    while (queue.length > 0) {
        const currentNodeId = queue.shift()!;
        const currentLevel = nodeLevels[currentNodeId]!;

        // Process 'child' relationships
        outgoingChildEdges[currentNodeId].forEach(childId => {
            const proposedLevel = currentLevel + 1;
            if (nodeLevels[childId] == null || nodeLevels[childId]! < proposedLevel) {
                nodeLevels[childId] = proposedLevel;
                queue.push(childId);
            }
        });

        // Process 'queue' relationships
        outgoingQueueEdges[currentNodeId].forEach(queueNodeId => {
            const proposedLevel = currentLevel;
            if (nodeLevels[queueNodeId] == null || nodeLevels[queueNodeId]! < proposedLevel) {
                nodeLevels[queueNodeId] = proposedLevel;
                queue.push(queueNodeId);
            }
        });
    }

    // Set levels for all nodes, default to 0 if level not assigned
    const formattedNodes = networkData.nodes.map((node: NetworkNode) => ({
        ...node,
        level: nodeLevels[node.id] !== null ? nodeLevels[node.id]! : 0,
    }));

    const formattedData = {
        nodes: formattedNodes,
        edges: networkData.edges.map(edge => {
            const isQueue = edge.relationship_type === 'queue';
            return {
                ...edge,
                id: `${edge.from}-${edge.to}`,
                label: undefined,
                color: isQueue ? '#ff9800' : '#2196F3',
                arrows: {
                    to: {
                        enabled: true
                    }
                },
                dashes: isQueue,
                smooth: {
                    enabled: true,
                    type: isQueue ? 'curvedCW' : 'cubicBezier',
                    roundness: isQueue ? 0.2 : 0.5
                },
                physics: !isQueue,
            };
        })

    };
    return formattedData;
}
