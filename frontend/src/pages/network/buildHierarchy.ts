import { NetworkNode, NetworkEdge } from '../../types/goals';
import { getGoalColor } from '../../shared/styles/colors';
import { privateRequest } from '../../shared/utils/api';

// =====================================================
// Simulation & Layout Parameters
// =====================================================
export const BASE_SPACING = 500;         // Base distance used to set ideal edge length
const NUM_ITERATIONS = 1000;              // Number of simulation iterations
const REPULSION_CONSTANT = 1000000; //100000       // Controls repulsive force strength
const ATTRACTION_CONSTANT = 0.05;   //0.01          // Controls attractive (spring) force strength
const GRAVITY_CONSTANT = 0.03;           // Pulls nodes toward center (radial gravity)
const DAMPING = 0.85;                    // Damping factor to stabilize the simulation

// =====================================================
// Helper: Choose a root node (prefer one with no incoming 'child' edges)
// =====================================================
function findRootNode(nodes: NetworkNode[], edges: NetworkEdge[]): number {
    const incoming = new Set<number>();
    edges.forEach(edge => {
        if (edge.relationship_type === 'child') {
            incoming.add(edge.to);
        }
    });
    // Return the first node without incoming child edges; if none, return the first node.
    for (const node of nodes) {
        if (!incoming.has(node.id)) return node.id;
    }
    return nodes[0].id;
}

// =====================================================
// Helper: Compute BFS Levels from the root to help set initial radii
// =====================================================
function computeBFSLevels(
    nodes: NetworkNode[],
    edges: NetworkEdge[],
    rootId: number
): { [id: number]: number } {
    const levels: { [id: number]: number } = {};
    const queue: number[] = [rootId];
    levels[rootId] = 0;
    const visited = new Set<number>([rootId]);

    while (queue.length) {
        const current = queue.shift()!;
        edges.forEach(edge => {
            // (We treat the graph as undirected for setting up an initial radial layout.)
            if (edge.from === current && !visited.has(edge.to)) {
                levels[edge.to] = levels[current] + 1;
                visited.add(edge.to);
                queue.push(edge.to);
            }
            if (edge.to === current && !visited.has(edge.from)) {
                levels[edge.from] = levels[current] + 1;
                visited.add(edge.from);
                queue.push(edge.from);
            }
        });
    }
    return levels;
}

// =====================================================
// Helper: Compute Node Degrees (number of connected edges)
// =====================================================
function computeNodeDegrees(
    nodes: NetworkNode[],
    edges: NetworkEdge[]
): { [id: number]: number } {
    const degrees: { [id: number]: number } = {};
    nodes.forEach(node => {
        degrees[node.id] = 0;
    });
    edges.forEach(edge => {
        degrees[edge.from] = (degrees[edge.from] || 0) + 1;
        degrees[edge.to] = (degrees[edge.to] || 0) + 1;
    });
    return degrees;
}

// =====================================================
// Helper: Initialize Node Positions
// Nodes with stored positions remain fixed. Others are placed roughly on a circle,
// with the BFS level (distance from the root) setting the ideal radius – adjusted so that
// high‑degree nodes start closer to the center.
// =====================================================
function initializePositions(
    nodes: NetworkNode[],
    levels: { [id: number]: number },
    degrees: { [id: number]: number },
    maxDegree: number
): { [id: number]: { x: number; y: number } } {
    const positions: { [id: number]: { x: number; y: number } } = {};

    nodes.forEach(node => {
        // Use stored positions if available
        if (typeof node.position_x === 'number' && typeof node.position_y === 'number') {
            positions[node.id] = { x: node.position_x, y: node.position_y };
        } else {
            // Use BFS level as a starting point; if missing, default to level 3.
            const level = levels[node.id] !== undefined ? levels[node.id] : 3;
            const degree = degrees[node.id] || 0;
            // Pull nodes with high degree inward:
            const degreeFactor = 1 - 0.3 * (degree / maxDegree); // will be in roughly [0.7, 1.0]
            const idealRadius = level * BASE_SPACING * degreeFactor;
            const angle = Math.random() * 2 * Math.PI;
            positions[node.id] = {
                x: Math.cos(angle) * idealRadius,
                y: Math.sin(angle) * idealRadius,
            };
        }
    });
    return positions;
}

// =====================================================
// Main function: buildHierarchy
// Runs the simulation and formats nodes/edges for the vis‑network.
// =====================================================
export async function buildHierarchy(networkData: {
    nodes: NetworkNode[];
    edges: NetworkEdge[];
}) {
    console.log('Initial nodes:', networkData.nodes);

    // 1. Determine the root and compute initial data.
    const rootId = findRootNode(networkData.nodes, networkData.edges);
    const levels = computeBFSLevels(networkData.nodes, networkData.edges, rootId);
    const degrees = computeNodeDegrees(networkData.nodes, networkData.edges);
    const maxDegree = Math.max(...Object.values(degrees));

    // 2. Initialize positions and velocities.
    let positions = initializePositions(networkData.nodes, levels, degrees, maxDegree);
    const velocities: { [id: number]: { x: number; y: number } } = {};
    networkData.nodes.forEach(node => {
        velocities[node.id] = { x: 0, y: 0 };
    });

    // 3. Mark nodes with stored positions as fixed.
    const fixedNodes = new Set<number>();
    networkData.nodes.forEach(node => {
        if (typeof node.position_x === 'number' && typeof node.position_y === 'number') {
            fixedNodes.add(node.id);
            positions[node.id] = { x: node.position_x, y: node.position_y };
        }
    });

    // 4. Run the force-directed simulation.
    for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
        // Initialize per-node force accumulators.
        const forces: { [id: number]: { x: number; y: number } } = {};
        networkData.nodes.forEach(node => {
            forces[node.id] = { x: 0, y: 0 };
        });

        // a) Repulsive forces between every pair of nodes.
        for (let i = 0; i < networkData.nodes.length; i++) {
            const nodeA = networkData.nodes[i];
            for (let j = i + 1; j < networkData.nodes.length; j++) {
                const nodeB = networkData.nodes[j];
                const dx = positions[nodeA.id].x - positions[nodeB.id].x;
                const dy = positions[nodeA.id].y - positions[nodeB.id].y;
                let distanceSq = dx * dx + dy * dy;
                let distance = Math.sqrt(distanceSq);
                if (distance < 0.1) {
                    distance = 0.1;
                    distanceSq = 0.01;
                }
                const forceMagnitude = REPULSION_CONSTANT / distanceSq;
                const fx = (dx / distance) * forceMagnitude;
                const fy = (dy / distance) * forceMagnitude;
                forces[nodeA.id].x += fx;
                forces[nodeA.id].y += fy;
                forces[nodeB.id].x -= fx;
                forces[nodeB.id].y -= fy;
            }
        }

        // b) Attractive (spring) forces along edges.
        networkData.edges.forEach(edge => {
            const source = edge.from;
            const target = edge.to;
            const dx = positions[target].x - positions[source].x;
            const dy = positions[target].y - positions[source].y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 0.1) {
                distance = 0.1;
            }
            // Here the ideal distance is simply BASE_SPACING.
            const idealDistance = BASE_SPACING;
            const displacement = distance - idealDistance;
            const forceMagnitude = ATTRACTION_CONSTANT * displacement;
            const fx = (dx / distance) * forceMagnitude;
            const fy = (dy / distance) * forceMagnitude;
            forces[source].x += fx;
            forces[source].y += fy;
            forces[target].x -= fx;
            forces[target].y -= fy;
        });

        // c) Gravity (central force). Pull nodes toward the center (0,0), with high‐degree nodes pulled more strongly.
        networkData.nodes.forEach(node => {
            if (fixedNodes.has(node.id)) return;
            const pos = positions[node.id];
            const degree = degrees[node.id] || 1;
            const gravityForceX = -GRAVITY_CONSTANT * (degree / maxDegree) * pos.x;
            const gravityForceY = -GRAVITY_CONSTANT * (degree / maxDegree) * pos.y;
            forces[node.id].x += gravityForceX;
            forces[node.id].y += gravityForceY;
        });

        // d) Update velocities and positions (except for fixed nodes).
        networkData.nodes.forEach(node => {
            if (fixedNodes.has(node.id)) return;
            velocities[node.id].x = (velocities[node.id].x + forces[node.id].x) * DAMPING;
            velocities[node.id].y = (velocities[node.id].y + forces[node.id].y) * DAMPING;
            positions[node.id].x += velocities[node.id].x;
            positions[node.id].y += velocities[node.id].y;
        });
    }

    // 5. Update node positions and save to the backend.
    const savePromises: Promise<any>[] = [];
    networkData.nodes.forEach(node => {
        node.position_x = positions[node.id].x;
        node.position_y = positions[node.id].y;
        savePromises.push(saveNodePosition(node.id, positions[node.id].x, positions[node.id].y));
    });
    await Promise.all(savePromises);

    // 6. Format nodes for vis‑network (with size, font, and color based on node degree).
    const formattedNodes = networkData.nodes.map(node => {
        const degree = degrees[node.id] || 1;
        const baseSize = 30;
        const maxSize = 200;
        const scalingFactor = 10;
        const size = Math.min(baseSize + degree * scalingFactor, maxSize);
        const minFontSize = 14;
        const maxFontSize = 28;
        const fontSize = Math.max(minFontSize, Math.min(size / 2.5, maxFontSize));

        return {
            ...node,
            x: positions[node.id].x,
            y: positions[node.id].y,
            size,
            font: {
                size: fontSize,
                color: '#ffffff',
                bold: { color: '#ffffff', size: fontSize, mod: 'bold' },
            },
            color: {
                background: getGoalColor(node),
                opacity: Math.min(0.5 + degree * 0.05, 1),
            },
        };
    });

    // 7. Format edges with visual properties (width, color, arrows).
    const formattedEdges = networkData.edges.map(edge => {
        const importance = ((degrees[edge.from] || 0) + (degrees[edge.to] || 0)) / 2;
        const baseWidth = 1;
        const width = Math.max(baseWidth, Math.min(baseWidth + importance * 0.5, 8));
        const fromNode = networkData.nodes.find(n => n.id === edge.from);
        const parentColor = fromNode ? getGoalColor(fromNode) : '#2196F3';
        const arrowScale = Math.max(0.5, Math.min(width * 0.3, 2));
        return {
            ...edge,
            id: `${edge.from}-${edge.to}`,
            width,
            color: {
                color: edge.relationship_type === 'queue' ? '#ff9800' : parentColor,
                opacity: Math.min(0.4 + importance * 0.1, 0.9),
            },
            arrows: {
                to: {
                    enabled: true,
                    scaleFactor: arrowScale,
                    type: edge.relationship_type === 'queue' ? 'vee' : 'arrow',
                },
            },
            dashes: edge.relationship_type === 'queue',
            smooth: {
                enabled: true,
                type: 'curvedCW',
                roundness: edge.relationship_type === 'queue' ? 0.3 : 0.2,
                forceDirection: 'radial',
            },
        };
    });

    console.log('Final node positions:', positions);
    return { nodes: formattedNodes, edges: formattedEdges };
}

// =====================================================
// Function: calculateNewNodePosition
// When adding a single new node, this uses a golden-ratio spiral for an initial guess.
// =====================================================
export function calculateNewNodePosition(
    newNode: NetworkNode,
    processedNodes: NetworkNode[]
): { x: number; y: number } {
    const goldenRatio = 1.618033988749895;
    const total = processedNodes.length;
    const angle = total * (Math.PI * goldenRatio);
    const radius = BASE_SPACING * Math.sqrt(total + 1);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

// =====================================================
// Function: saveNodePosition
// Sends the updated node position to the backend.
// =====================================================
export async function saveNodePosition(nodeId: number, x: number, y: number) {
    try {
        await privateRequest(`network/${nodeId}/position`, 'PUT', { x, y });
        return true;
    } catch (error) {
        console.error('Error saving node position:', error);
        return false;
    }
}
