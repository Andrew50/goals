// Initialize node levels
import { NetworkNode, NetworkEdge } from '../../types/goals';
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

    // Add a helper function to calculate node "centrality" based on connections
    const calculateNodeCentrality = (nodeId: number): number => {
        const childCount = outgoingChildEdges[nodeId]?.length || 0;
        const queueCount = outgoingQueueEdges[nodeId]?.length || 0;
        const parentCount = incomingChildEdges[nodeId]?.length || 0;
        const totalConnections = childCount + queueCount + parentCount;

        // Prioritize nodes that are "bridges" between different parts of the graph
        const isConnector = childCount > 0 && parentCount > 0 ? 3 : 1;
        // Also consider the balance of incoming vs outgoing connections
        const connectionBalance = Math.abs(childCount + queueCount - parentCount);
        return (totalConnections * isConnector) - (connectionBalance * 0.5);
    };

    // Calculate initial positions using a force-directed approach
    const nodePositions: { [key: number]: { x: number, y: number } } = {};
    const processedNodes = new Set<number>();
    const spacing = 300; // Increased base spacing

    // Group nodes by their connection patterns
    const nodeGroups: { [key: string]: number[] } = {
        roots: rootNodes,
        connectors: [],
        leaves: [],
        others: []
    };

    const sortedNodes = [...nodes].sort((a, b) =>
        calculateNodeCentrality(b) - calculateNodeCentrality(a)
    );

    sortedNodes.forEach(nodeId => {
        if (rootNodes.includes(nodeId)) return; // Already in roots

        const hasParents = incomingChildEdges[nodeId].length > 0;
        const hasChildren = outgoingChildEdges[nodeId].length > 0;
        const hasQueue = outgoingQueueEdges[nodeId].length > 0;

        if (hasParents && (hasChildren || hasQueue)) {
            nodeGroups.connectors.push(nodeId);
        } else if (!hasChildren && !hasQueue) {
            nodeGroups.leaves.push(nodeId);
        } else {
            nodeGroups.others.push(nodeId);
        }
    });

    // Helper function to calculate repulsion from existing nodes
    const calculateRepulsion = (x: number, y: number): { x: number, y: number } => {
        let repulsionX = 0;
        let repulsionY = 0;
        processedNodes.forEach(existingId => {
            const existing = nodePositions[existingId];
            const dx = x - existing.x;
            const dy = y - existing.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < spacing) {
                const force = (spacing - distance) / distance;
                repulsionX += dx * force;
                repulsionY += dy * force;
            }
        });
        return { x: repulsionX, y: repulsionY };
    };

    const findBestPosition = (nodeId: number): { x: number, y: number } => {
        const connectedNodes = [
            ...incomingChildEdges[nodeId] || [],
            ...outgoingChildEdges[nodeId] || [],
            ...outgoingQueueEdges[nodeId] || []
        ].filter(id => processedNodes.has(id));

        let baseX = 0, baseY = 0;

        if (connectedNodes.length > 0) {
            // Start with the average position of connected nodes
            let weightedX = 0;
            let weightedY = 0;
            let totalWeight = 0;

            connectedNodes.forEach(connectedId => {
                const pos = nodePositions[connectedId];
                const weight = calculateNodeCentrality(connectedId);
                weightedX += pos.x * weight;
                weightedY += pos.y * weight;
                totalWeight += weight;
            });

            baseX = weightedX / totalWeight;
            baseY = weightedY / totalWeight;

            // Add directional bias based on relationship type
            const parentCount = incomingChildEdges[nodeId].length;
            const childCount = outgoingChildEdges[nodeId].length;
            const verticalBias = (childCount - parentCount) * spacing * 0.3;
            baseY += verticalBias;
        } else {
            // For disconnected nodes, place in a spiral
            const angle = processedNodes.size * (Math.PI * 0.618033988749895);
            const radius = spacing * Math.sqrt(processedNodes.size / 2);
            baseX = Math.cos(angle) * radius;
            baseY = Math.sin(angle) * radius;
        }

        // Apply repulsion from existing nodes
        const repulsion = calculateRepulsion(baseX, baseY);
        return {
            x: baseX + repulsion.x,
            y: baseY + repulsion.y
        };
    };

    // Place nodes in order: roots -> connectors -> others -> leaves
    const placementOrder = [
        ...nodeGroups.roots,
        ...nodeGroups.connectors,
        ...nodeGroups.others,
        ...nodeGroups.leaves
    ];

    // Place first node at center
    if (placementOrder.length > 0) {
        nodePositions[placementOrder[0]] = { x: 0, y: 0 };
        processedNodes.add(placementOrder[0]);
    }

    // Place remaining nodes
    placementOrder.slice(1).forEach(nodeId => {
        if (!processedNodes.has(nodeId)) {
            nodePositions[nodeId] = findBestPosition(nodeId);
            processedNodes.add(nodeId);
        }
    });

    // Format nodes with calculated positions
    const formattedNodes = networkData.nodes.map((node: NetworkNode) => {
        const pos = nodePositions[node.id];
        return {
            ...node,
            x: pos.x,
            y: pos.y,
            fixed: {
                x: true,
                y: true
            }
        };
    });

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
                    type: edge.relationship_type === 'queue' ? 'curvedCW' : 'straightCross',
                    roundness: edge.relationship_type === 'queue' ? 0.2 : 0.1
                },
                physics: true, // Enable physics for all edges
            };
        })
    };

    return formattedData;
}
