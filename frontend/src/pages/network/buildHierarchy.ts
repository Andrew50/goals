// Initialize node levels
import { NetworkNode, NetworkEdge } from '../../types/goals';
import { getGoalColor } from '../../shared/styles/colors';

const BASE_SPACING = 300;  // Base distance between nodes
const MIN_DISTANCE = 300;  // Minimum distance between nodes (prevent overlap)
const REPULSION_STRENGTH = 1.0;  // Increased repulsion strength
const ATTRACTION_STRENGTH = 0.8;  // How strongly connected nodes attract each other
const PERIPHERAL_FACTOR = .5;  // How much to push out nodes with few connections
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

    // Group nodes by their connection patterns
    const nodeGroups: { [key: string]: number[] } = {
        roots: rootNodes,
        connectors: [],
        leaves: [],
        others: [],
        isolated: []  // New group for nodes with no connections
    };

    const sortedNodes = [...nodes].sort((a, b) =>
        calculateNodeCentrality(b) - calculateNodeCentrality(a)
    );

    sortedNodes.forEach(nodeId => {
        if (rootNodes.includes(nodeId)) return; // Already in roots

        const hasParents = incomingChildEdges[nodeId].length > 0;
        const hasChildren = outgoingChildEdges[nodeId].length > 0;
        const hasQueue = outgoingQueueEdges[nodeId].length > 0;
        const hasConnections = hasParents || hasChildren || hasQueue;

        if (!hasConnections) {
            nodeGroups.isolated.push(nodeId);
        } else if (hasParents && (hasChildren || hasQueue)) {
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

            // Strong repulsion when nodes are too close
            if (distance < MIN_DISTANCE) {
                // Force increases exponentially as distance approaches 0
                const force = Math.pow(MIN_DISTANCE / Math.max(distance, 1), 2) * REPULSION_STRENGTH;
                repulsionX += dx * force;
                repulsionY += dy * force;
            }
            // Normal repulsion for nodes within spacing range
            else if (distance < BASE_SPACING * 2) {
                const force = (BASE_SPACING - distance) / distance * REPULSION_STRENGTH;
                repulsionX += dx * force;
                repulsionY += dy * force;
            }
        });

        return { x: repulsionX, y: repulsionY };
    };

    const calculateNodeImportance = (nodeId: number): number => {
        const childCount = outgoingChildEdges[nodeId]?.length || 0;
        const queueCount = outgoingQueueEdges[nodeId]?.length || 0;
        const parentCount = incomingChildEdges[nodeId]?.length || 0;

        // Calculate recursive children count (depth-first search)
        const getRecursiveChildCount = (id: number, visited = new Set<number>()): number => {
            if (visited.has(id)) return 0;
            visited.add(id);

            let count = outgoingChildEdges[id]?.length || 0;
            outgoingChildEdges[id]?.forEach(childId => {
                count += getRecursiveChildCount(childId, visited);
            });
            return count;
        };

        const recursiveChildren = getRecursiveChildCount(nodeId);
        const totalConnections = childCount + queueCount + parentCount;

        // Weighted importance score
        return (recursiveChildren * 2) + totalConnections;
    };

    const findBestPosition = (nodeId: number): { x: number, y: number } => {
        const connectedNodes = [
            ...incomingChildEdges[nodeId] || [],
            ...outgoingChildEdges[nodeId] || [],
            ...outgoingQueueEdges[nodeId] || []
        ].filter(id => processedNodes.has(id));

        let baseX = 0, baseY = 0;

        if (connectedNodes.length > 0) {
            // Calculate weighted center based on connected nodes
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

            // Adjust vertical positioning based on hierarchy
            const verticalBias = (childCount - parentCount) * BASE_SPACING * 0.4;
            baseY += verticalBias;

            // Push peripheral nodes (those with few connections) further out
            const totalConnections = parentCount + childCount + outgoingQueueEdges[nodeId].length;
            if (totalConnections <= 2) {
                const distanceFromCenter = Math.sqrt(baseX * baseX + baseY * baseY);
                const scaleFactor = PERIPHERAL_FACTOR;
                baseX *= scaleFactor;
                baseY *= scaleFactor;
            }
        } else {
            // Use golden ratio for even spacing
            const goldenRatio = 1.618033988749895;
            const angle = processedNodes.size * (Math.PI * goldenRatio);
            const radius = BASE_SPACING * Math.sqrt(processedNodes.size) * PERIPHERAL_FACTOR;
            baseX = Math.cos(angle) * radius;
            baseY = Math.sin(angle) * radius;
        }

        // Apply repulsion and ensure minimum distance
        const repulsion = calculateRepulsion(baseX, baseY);
        let finalX = baseX + repulsion.x;
        let finalY = baseY + repulsion.y;

        // Iteratively adjust position if too close to any existing node
        let iterations = 0;
        const MAX_ITERATIONS = 10;

        while (iterations < MAX_ITERATIONS) {
            let tooClose = false;

            // Convert Set to Array for iteration
            for (const existingId of Array.from(processedNodes)) {
                const existing = nodePositions[existingId];
                const dx = finalX - existing.x;
                const dy = finalY - existing.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < MIN_DISTANCE) {
                    tooClose = true;
                    // Move away from the too-close node
                    const angle = Math.atan2(dy, dx);
                    const moveDistance = MIN_DISTANCE - distance;
                    finalX += Math.cos(angle) * moveDistance;
                    finalY += Math.sin(angle) * moveDistance;
                    break;
                }
            }

            if (!tooClose) break;
            iterations++;
        }

        return { x: finalX, y: finalY };
    };

    // Place nodes in order: roots -> connectors -> others -> leaves -> isolated
    const placementOrder = [
        ...nodeGroups.roots,
        ...nodeGroups.connectors,
        ...nodeGroups.others,
        ...nodeGroups.leaves,
        ...nodeGroups.isolated
    ];

    // For isolated nodes, place them in a circle around the periphery
    const placeIsolatedNode = (nodeId: number, index: number) => {
        const totalIsolated = nodeGroups.isolated.length;
        const angle = (index / totalIsolated) * 2 * Math.PI;
        const radius = 800; // Large radius to place them far from the center
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        return { x, y };
    };

    // Place nodes
    placementOrder.forEach((nodeId, index) => {
        if (!processedNodes.has(nodeId)) {
            if (nodeGroups.isolated.includes(nodeId)) {
                const isolatedIndex = nodeGroups.isolated.indexOf(nodeId);
                nodePositions[nodeId] = placeIsolatedNode(nodeId, isolatedIndex);
            } else {
                nodePositions[nodeId] = findBestPosition(nodeId);
            }
            processedNodes.add(nodeId);
        }
    });

    // Format nodes with calculated positions and sizes
    const formattedNodes = networkData.nodes.map((node: NetworkNode) => {
        const pos = nodePositions[node.id];
        const importance = calculateNodeImportance(node.id);

        // More dramatic node size scaling
        const baseSize = 30;        // Smaller base size for less important nodes
        const maxSize = 200;        // Larger max size for important nodes
        const scalingFactor = 12;   // Increased from 8 for more dramatic scaling
        const size = Math.min(baseSize + (importance * scalingFactor), maxSize);

        // More dramatic font scaling
        const minFontSize = 14;
        const maxFontSize = 28;     // Increased max font size
        const fontSize = Math.max(minFontSize, Math.min(size / 2.5, maxFontSize));

        return {
            ...node,
            size,
            font: {
                size: fontSize,
                color: '#ffffff',
                bold: {
                    color: '#ffffff',
                    size: fontSize,
                    mod: 'bold'
                }
            },
            color: {
                background: getGoalColor(node),
                opacity: Math.min(0.5 + (importance * 0.2), 1)  // More dramatic opacity scaling
            }
        };
    });

    // Helper to calculate edge importance
    const calculateEdgeImportance = (fromId: number, toId: number): number => {
        const fromImportance = calculateNodeImportance(fromId);
        const toImportance = calculateNodeImportance(toId);
        return (fromImportance + toImportance) / 2;
    };

    const formattedData = {
        nodes: formattedNodes,
        edges: networkData.edges.map(edge => {
            const edgeImportance = calculateEdgeImportance(edge.from, edge.to);
            const fromNode = networkData.nodes.find(n => n.id === edge.from);

            // Get the parent node's color
            const parentColor = fromNode ? getGoalColor(fromNode) : '#2196F3';

            // Scale edge width based on importance
            const baseWidth = 1;
            const maxWidth = 8;
            const width = Math.max(baseWidth, Math.min(baseWidth + (edgeImportance * 0.5), maxWidth));

            // Scale arrow size with edge width
            const arrowScale = Math.max(0.5, Math.min(width * 0.3, 2));

            return {
                ...edge,
                id: `${edge.from}-${edge.to}`,
                width: width,
                color: {
                    color: edge.relationship_type === 'queue' ? '#ff9800' : parentColor,
                    opacity: Math.min(0.4 + (edgeImportance * 0.1), 0.9)  // More visible edges
                },
                arrows: {
                    to: {
                        enabled: true,
                        scaleFactor: arrowScale,
                        type: edge.relationship_type === 'queue' ? 'vee' : 'arrow'
                    }
                },
                dashes: edge.relationship_type === 'queue',
                smooth: {
                    enabled: true,
                    type: 'curvedCW',
                    roundness: edge.relationship_type === 'queue' ? 0.3 : 0.2,
                    forceDirection: 'radial'
                }
            };
        })
    };

    // Update the network options in Network.tsx to enable clustering
    const options = {
        // ... existing options ...
        nodes: {
            // ... existing node options ...
            scaling: {
                min: 30,
                max: 80,
                label: {
                    enabled: true,
                    min: 14,
                    max: 20
                }
            }
        },
        physics: {
            enabled: true,
            barnesHut: {
                gravitationalConstant: -3000,  // Stronger gravity for tighter clusters
                centralGravity: 0.5,          // Stronger pull toward center
                springLength: 200,            // Longer springs for better spacing
                springConstant: 0.04,
                damping: 0.09,
                avoidOverlap: 0.5            // Increased overlap avoidance
            },
            stabilization: {
                enabled: true,
                iterations: 1000,
                updateInterval: 50
            }
        },
        layout: {
            improvedLayout: true,
            clusterThreshold: 150,
            hierarchical: {
                enabled: false
            }
        }
    };

    return formattedData;
}
