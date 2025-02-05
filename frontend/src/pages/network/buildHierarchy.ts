import { NetworkNode, NetworkEdge } from '../../types/goals';
import { getGoalColor } from '../../shared/styles/colors';
import { privateRequest } from '../../shared/utils/api';

// Constants used for node placement calculations
export const BASE_SPACING = 300;        // Base distance between nodes
export const MIN_DISTANCE = 300;        // Minimum distance to prevent overlap
export const REPULSION_STRENGTH = 1.0;    // Repulsion strength
export const ATTRACTION_STRENGTH = 0.8;   // (For potential tweaks)
export const PERIPHERAL_FACTOR = 0.5;     // Factor for pushing out peripheral nodes

/**
 * buildHierarchy calculates positions (and some visual properties) for nodes.
 * It uses stored positions where available and computes positions for nodes that lack them.
 */
export async function buildHierarchy(networkData: { nodes: NetworkNode[], edges: NetworkEdge[] }) {
    console.log('Initial nodes:', networkData.nodes);

    const nodePositions: { [key: number]: { x: number, y: number } } = {};
    const processedNodes = new Set<number>();

    // Build maps for hierarchy
    const nodeLevels: { [key: number]: number | null } = {};
    const incomingChildEdges: { [key: number]: number[] } = {};
    const outgoingChildEdges: { [key: number]: number[] } = {};
    const outgoingQueueEdges: { [key: number]: number[] } = {};

    networkData.nodes.forEach(node => {
        const nodeId = node.id;
        nodeLevels[nodeId] = null;
        incomingChildEdges[nodeId] = [];
        outgoingChildEdges[nodeId] = [];
        outgoingQueueEdges[nodeId] = [];
    });

    networkData.edges.forEach(edge => {
        if (edge.relationship_type === 'child') {
            incomingChildEdges[edge.to].push(edge.from);
            outgoingChildEdges[edge.from].push(edge.to);
        } else if (edge.relationship_type === 'queue') {
            outgoingQueueEdges[edge.from].push(edge.to);
        }
    });

    // Use stored positions where available
    networkData.nodes.forEach((node: NetworkNode) => {
        if (
            typeof node.position_x === 'number' &&
            typeof node.position_y === 'number'
        ) {
            nodePositions[node.id] = { x: node.position_x, y: node.position_y };
            processedNodes.add(node.id);
        }
    });
    console.log('Nodes with stored positions:', processedNodes.size);

    // For nodes without stored positions, compute positions
    if (processedNodes.size < networkData.nodes.length) {
        // Identify root nodes (nodes with no incoming 'child' edges)
        const rootNodes = networkData.nodes
            .map((node: NetworkNode) => node.id)
            .filter(nodeId => incomingChildEdges[nodeId].length === 0);
        rootNodes.forEach(nodeId => { nodeLevels[nodeId] = 0; });

        // Group nodes by connection type
        const nodeGroups: { [key: string]: number[] } = {
            roots: rootNodes,
            connectors: [],
            leaves: [],
            others: [],
            isolated: []
        };

        // Helper: centrality for ordering
        const calculateNodeCentrality = (nodeId: number): number => {
            const childCount = outgoingChildEdges[nodeId]?.length || 0;
            const queueCount = outgoingQueueEdges[nodeId]?.length || 0;
            const parentCount = incomingChildEdges[nodeId]?.length || 0;
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
            return (recursiveChildren * 2) + totalConnections;
        };

        // Categorize nodes (skipping already processed ones)
        const sortedNodes = [...networkData.nodes.map((node: NetworkNode) => node.id)]
            .sort((a, b) => calculateNodeCentrality(b) - calculateNodeCentrality(a));

        sortedNodes.forEach(nodeId => {
            if (rootNodes.includes(nodeId)) return;
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

        // Helper: repulsion calculation
        const calculateRepulsion = (x: number, y: number): { x: number, y: number } => {
            let repulsionX = 0, repulsionY = 0;
            processedNodes.forEach(existingId => {
                const existing = nodePositions[existingId];
                const dx = x - existing.x;
                const dy = y - existing.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < MIN_DISTANCE) {
                    const force = Math.pow(MIN_DISTANCE / Math.max(distance, 1), 2) * REPULSION_STRENGTH;
                    repulsionX += dx * force;
                    repulsionY += dy * force;
                } else if (distance < BASE_SPACING * 2) {
                    const force = (BASE_SPACING - distance) / distance * REPULSION_STRENGTH;
                    repulsionX += dx * force;
                    repulsionY += dy * force;
                }
            });
            return { x: repulsionX, y: repulsionY };
        };

        // Helper: determine best position for a node
        const findBestPosition = (nodeId: number): { x: number, y: number } => {
            const connectedNodes = [
                ...incomingChildEdges[nodeId],
                ...outgoingChildEdges[nodeId],
                ...outgoingQueueEdges[nodeId]
            ].filter(id => processedNodes.has(id));

            let baseX = 0, baseY = 0;
            if (connectedNodes.length > 0) {
                let weightedX = 0, weightedY = 0, totalWeight = 0;
                connectedNodes.forEach(connectedId => {
                    const pos = nodePositions[connectedId];
                    // Use the same centrality as a simple weight
                    const weight = calculateNodeCentrality(connectedId);
                    weightedX += pos.x * weight;
                    weightedY += pos.y * weight;
                    totalWeight += weight;
                });
                baseX = weightedX / totalWeight;
                baseY = weightedY / totalWeight;
                const parentCount = incomingChildEdges[nodeId].length;
                const childCount = outgoingChildEdges[nodeId].length;
                const verticalBias = (childCount - parentCount) * BASE_SPACING * 0.4;
                baseY += verticalBias;
                const totalConnections = parentCount + childCount + outgoingQueueEdges[nodeId].length;
                if (totalConnections <= 2) {
                    baseX *= PERIPHERAL_FACTOR;
                    baseY *= PERIPHERAL_FACTOR;
                }
            } else {
                const goldenRatio = 1.618033988749895;
                const angle = processedNodes.size * (Math.PI * goldenRatio);
                const radius = BASE_SPACING * Math.sqrt(processedNodes.size) * PERIPHERAL_FACTOR;
                baseX = Math.cos(angle) * radius;
                baseY = Math.sin(angle) * radius;
            }
            const repulsion = calculateRepulsion(baseX, baseY);
            let finalX = baseX + repulsion.x;
            let finalY = baseY + repulsion.y;
            let iterations = 0;
            const MAX_ITERATIONS = 10;
            while (iterations < MAX_ITERATIONS) {
                let tooClose = false;
                for (const existingId of Array.from(processedNodes)) {
                    const existing = nodePositions[existingId];
                    const dx = finalX - existing.x;
                    const dy = finalY - existing.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < MIN_DISTANCE) {
                        tooClose = true;
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

        // For isolated nodes, place them in a circle
        const placeIsolatedNode = (nodeId: number, index: number): { x: number, y: number } => {
            const totalIsolated = nodeGroups.isolated.length;
            const angle = (index / totalIsolated) * 2 * Math.PI;
            const radius = 800;
            return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        };

        const placementOrder = [
            ...nodeGroups.roots,
            ...nodeGroups.connectors,
            ...nodeGroups.others,
            ...nodeGroups.leaves,
            ...nodeGroups.isolated
        ].filter(nodeId => !processedNodes.has(nodeId));

        console.log('Placement order for unpositioned nodes:', placementOrder);

        const savePromises: Promise<any>[] = [];
        for (const nodeId of placementOrder) {
            let position;
            if (nodeGroups.isolated.includes(nodeId)) {
                const isolatedIndex = nodeGroups.isolated.indexOf(nodeId);
                position = placeIsolatedNode(nodeId, isolatedIndex);
            } else {
                position = findBestPosition(nodeId);
            }
            console.log(`Calculated position for node ${nodeId}:`, position);
            nodePositions[nodeId] = position;
            processedNodes.add(nodeId);

            const nodeIndex = networkData.nodes.findIndex(node => node.id === nodeId);
            if (nodeIndex !== -1) {
                networkData.nodes[nodeIndex].position_x = position.x;
                networkData.nodes[nodeIndex].position_y = position.y;
            }
            // (Optionally, you could push backend save promises here)
            savePromises.push(saveNodePosition(nodeId, position.x, position.y));
        }
        await Promise.all(savePromises);
        console.log('Final node positions:', nodePositions);
    }

    // Format nodes for vis‑network, adding visual properties (size, font, color)
    const formattedNodes = networkData.nodes.map((node: NetworkNode) => {
        const pos = nodePositions[node.id];
        const importance = (() => {
            const childCount = outgoingChildEdges[node.id]?.length || 0;
            const queueCount = outgoingQueueEdges[node.id]?.length || 0;
            const parentCount = incomingChildEdges[node.id]?.length || 0;
            return childCount + queueCount + parentCount;
        })();

        const baseSize = 30;
        const maxSize = 200;
        const scalingFactor = 12;
        const size = Math.min(baseSize + (importance * scalingFactor), maxSize);

        const minFontSize = 14;
        const maxFontSize = 28;
        const fontSize = Math.max(minFontSize, Math.min(size / 2.5, maxFontSize));

        return {
            ...node,
            x: pos.x,
            y: pos.y,
            size,
            font: {
                size: fontSize,
                color: '#ffffff',
                bold: { color: '#ffffff', size: fontSize, mod: 'bold' }
            },
            color: {
                background: getGoalColor(node),
                opacity: Math.min(0.5 + (importance * 0.2), 1)
            }
        };
    });

    // Format edges with visual properties
    const calculateEdgeImportance = (fromId: number, toId: number): number => {
        const fromImportance = (() => {
            const childCount = outgoingChildEdges[fromId]?.length || 0;
            const queueCount = outgoingQueueEdges[fromId]?.length || 0;
            const parentCount = incomingChildEdges[fromId]?.length || 0;
            return childCount + queueCount + parentCount;
        })();
        const toImportance = (() => {
            const childCount = outgoingChildEdges[toId]?.length || 0;
            const queueCount = outgoingQueueEdges[toId]?.length || 0;
            const parentCount = incomingChildEdges[toId]?.length || 0;
            return childCount + queueCount + parentCount;
        })();
        return (fromImportance + toImportance) / 2;
    };

    const formattedEdges = networkData.edges.map(edge => {
        const edgeImportance = calculateEdgeImportance(edge.from, edge.to);
        const fromNode = networkData.nodes.find(n => n.id === edge.from);
        const parentColor = fromNode ? getGoalColor(fromNode) : '#2196F3';
        const baseWidth = 1;
        const maxWidth = 8;
        const width = Math.max(baseWidth, Math.min(baseWidth + (edgeImportance * 0.5), maxWidth));
        const arrowScale = Math.max(0.5, Math.min(width * 0.3, 2));
        return {
            ...edge,
            id: `${edge.from}-${edge.to}`,
            width,
            color: {
                color: edge.relationship_type === 'queue' ? '#ff9800' : parentColor,
                opacity: Math.min(0.4 + (edgeImportance * 0.1), 0.9)
            },
            arrows: { to: { enabled: true, scaleFactor: arrowScale, type: edge.relationship_type === 'queue' ? 'vee' : 'arrow' } },
            dashes: edge.relationship_type === 'queue',
            smooth: {
                enabled: true,
                type: 'curvedCW',
                roundness: edge.relationship_type === 'queue' ? 0.3 : 0.2,
                forceDirection: 'radial'
            }
        };
    });

    return { nodes: formattedNodes, edges: formattedEdges };
}

/**
 * calculateNewNodePosition is used when adding a single node.
 * It uses a golden-ratio–based algorithm relative to the current count of processed nodes.
 */
export function calculateNewNodePosition(newNode: NetworkNode, processedNodes: NetworkNode[]): { x: number, y: number } {
    const goldenRatio = 1.618033988749895;
    const total = processedNodes.length;
    const angle = total * (Math.PI * goldenRatio);
    const radius = BASE_SPACING * Math.sqrt(total + 1) * PERIPHERAL_FACTOR;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * saveNodePosition updates the backend with a node’s new position.
 */
export async function saveNodePosition(nodeId: number, x: number, y: number) {
    try {
        await privateRequest(`network/${nodeId}/position`, 'PUT', { x, y });
        return true;
    } catch (error) {
        console.error('Error saving node position:', error);
        return false;
    }
}
