import React, { useEffect, useRef, useCallback } from 'react';
import { DataSet, Network as VisNetwork } from 'vis-network/standalone';
import { getGoalSubgraph } from '../utils/api';
import { Goal, NetworkNode } from '../../types/goals';
import { buildHierarchy } from '../../pages/network/buildHierarchy';
import { formatNetworkNode } from '../utils/formatNetworkNode';

interface MiniNetworkGraphProps {
  centerId?: number;
  height?: number;
  onNodeClick?: (node: Goal) => void;
}

// vis-network draws arrow length as `15 * scaleFactor + 3 * edgeWidth`, in the
// same units as node boxes. The head is sized from the clear gap between boxes,
// so a long link cannot grow a head that is larger than the nodes.
const MINI_FONT = 13;
const MINI_MAX_LABEL = 130;
const MINI_GAP = 22;
const MINI_EDGE_WIDTH = 1.25;

function estimateBox(label: string): { w: number; h: number } {
  const text = label || '';
  const raw = Math.max(28, text.length * MINI_FONT * 0.56);
  const lines = Math.max(1, Math.ceil(raw / MINI_MAX_LABEL));
  return {
    w: Math.min(MINI_MAX_LABEL, raw) + 18,
    h: lines * MINI_FONT * 1.2 + 14,
  };
}

function edgeReach(box: { w: number; h: number }, angle: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const horiz = c < 1e-4 ? Infinity : (box.w / 2) / c;
  const vert = s < 1e-4 ? Infinity : (box.h / 2) / s;
  return Math.min(horiz, vert);
}

function arrowScaleForGap(gap: number): number {
  const clear = Number.isFinite(gap) ? gap : MINI_GAP;
  const length = Math.max(6, Math.min(clear * 0.4, 11));
  const scale = (length - 3 * MINI_EDGE_WIDTH) / 15;
  return Math.max(0.08, Math.min(scale, 0.55));
}

function layoutMiniNodes(
  nodes: Array<{ id: number; label?: string; name?: string }>,
  edges: Array<{ from: number; to: number }>,
  centerId?: number
): Map<number, { x: number; y: number }> {
  if (!nodes.length) return new Map();
  const boxes = new Map<number, { w: number; h: number }>();
  nodes.forEach((node) => boxes.set(node.id, estimateBox(String(node.label || node.name || ''))));
  const ids = nodes.map((node) => node.id);
  const center = centerId != null && ids.includes(centerId) ? centerId : ids[0];
  const neighbors = new Map<number, number[]>();
  ids.forEach((id) => neighbors.set(id, []));
  edges.forEach((edge) => {
    if (!neighbors.has(edge.from) || !neighbors.has(edge.to) || edge.from === edge.to) return;
    neighbors.get(edge.from)!.push(edge.to);
    neighbors.get(edge.to)!.push(edge.from);
  });

  const level = new Map<number, number>();
  const queue = [center];
  level.set(center, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of neighbors.get(id) || []) {
      if (level.has(next)) continue;
      level.set(next, (level.get(id) || 0) + 1);
      queue.push(next);
    }
  }
  let strayLevel = Math.max(0, ...Array.from(level.values())) + 1;
  ids.forEach((id) => {
    if (!level.has(id)) level.set(id, strayLevel);
  });

  const byLevel = new Map<number, number[]>();
  level.forEach((depth, id) => {
    if (!byLevel.has(depth)) byLevel.set(depth, []);
    byLevel.get(depth)!.push(id);
  });

  const positions = new Map<number, { x: number; y: number }>();
  positions.set(center, { x: 0, y: 0 });
  const half = (id: number) => {
    const box = boxes.get(id) || { w: 40, h: 24 };
    return Math.hypot(box.w, box.h) / 2;
  };

  let previousRadius = 0;
  const depths = Array.from(byLevel.keys()).filter((depth) => depth > 0).sort((a, b) => a - b);
  depths.forEach((depth) => {
    const group = byLevel.get(depth) || [];
    const count = group.length;
    const previousIds = depth === 1 ? [center] : (byLevel.get(depth - 1) || []);
    const previousHalf = Math.max(...previousIds.map(half));
    const outerHalf = Math.max(...group.map(half));
    let radius = previousRadius + previousHalf + outerHalf + MINI_GAP;
    for (let attempt = 0; attempt < 16 && count > 1; attempt += 1) {
      const chord = 2 * radius * Math.sin(Math.PI / count);
      const needed = Math.max(...group.map((id, index) => {
        const next = boxes.get(group[(index + 1) % count]) || { w: 40, h: 24 };
        const current = boxes.get(id) || { w: 40, h: 24 };
        return (current.w + next.w) / 2 + MINI_GAP;
      }));
      if (chord >= needed) break;
      radius *= 1.12;
    }
    group.forEach((id, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    previousRadius = radius;
  });

  return positions;
}

const miniNetworkOptions = {
  nodes: {
    shape: 'box' as const,
    margin: { top: 6, right: 8, bottom: 6, left: 8 },
    widthConstraint: { maximum: MINI_MAX_LABEL },
    font: { size: MINI_FONT },
    borderWidth: 1,
    chosen: false
  },
  edges: {
    arrows: { to: { enabled: true, scaleFactor: 0.2 } },
    smooth: { enabled: true, type: 'curvedCW' as const, roundness: 0.04 },
    width: MINI_EDGE_WIDTH,
    color: { inherit: 'from' as const, opacity: 0.9 }
  },
  physics: { enabled: false },
  manipulation: { enabled: false },
  interaction: { dragNodes: false, dragView: true, zoomView: true, hover: true, keyboard: { enabled: false } }
};

function boxOf(node: any): { w: number; h: number } {
  const width = node?.shape?.width;
  const height = node?.shape?.height;
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return { w: width, h: height };
  }
  return estimateBox(String(node?.options?.label || node?.label || ''));
}

function gapBetween(from: any, to: any): number {
  if (!from || !to) return MINI_GAP;
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return MINI_GAP;
  const angle = Math.atan2(dy, dx);
  return distance - edgeReach(boxOf(from), angle) - edgeReach(boxOf(to), angle + Math.PI);
}

const MiniNetworkGraph: React.FC<MiniNetworkGraphProps> = ({ centerId, height = 220, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<VisNetwork | null>(null);
  const nodesDataSetRef = useRef<DataSet<any> | null>(null);
  const edgesDataSetRef = useRef<DataSet<any> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const fitToContainer = useCallback(() => {
    const network = networkRef.current as any;
    const el = containerRef.current;
    const edges = edgesDataSetRef.current;
    const nodes = nodesDataSetRef.current;
    if (!network || !el || !edges || !nodes || el.clientWidth < 40 || el.clientHeight < 40) return;
    try {
      network.fit({ animation: false, maxZoomLevel: 1.45 });
      const bodyNodes = network.body?.nodes || {};
      let spread = 1;
      edges.get().forEach((edge: any) => {
        const from = bodyNodes[edge.from];
        const to = bodyNodes[edge.to];
        if (!from || !to) return;
        const gap = gapBetween(from, to);
        if (gap >= MINI_GAP) return;
        const dx = (to.x ?? 0) - (from.x ?? 0);
        const dy = (to.y ?? 0) - (from.y ?? 0);
        const distance = Math.hypot(dx, dy);
        if (distance < 1) return;
        const angle = Math.atan2(dy, dx);
        const needed = MINI_GAP + edgeReach(boxOf(from), angle) + edgeReach(boxOf(to), angle + Math.PI);
        spread = Math.max(spread, needed / distance);
      });
      if (spread > 1.02) {
        nodes.update(nodes.get().map((node: any) => ({
          id: node.id,
          x: (bodyNodes[node.id]?.x ?? node.x ?? 0) * spread,
          y: (bodyNodes[node.id]?.y ?? node.y ?? 0) * spread,
        })));
        network.fit({ animation: false, maxZoomLevel: 1.45 });
      }
      const placed = network.body?.nodes || {};
      const updates = edges.get().map((edge: any) => ({
        id: edge.id,
        width: MINI_EDGE_WIDTH,
        arrows: {
          to: {
            enabled: true,
            type: 'arrow',
            scaleFactor: arrowScaleForGap(gapBetween(placed[edge.from], placed[edge.to])),
          },
        },
      }));
      if (updates.length) edges.update(updates);
      network.fit({ animation: false, maxZoomLevel: 1.45 });
    } catch (_) {}
  }, []);


  const renderGraph = useCallback(async () => {
    if (!containerRef.current) {
      console.warn('[MiniNetworkGraph] renderGraph: no container');
      return;
    }

    if (centerId == null) {
      console.warn('[MiniNetworkGraph] renderGraph: no centerId');
      return;
    }

    try {
      console.log('[MiniNetworkGraph] renderGraph: fetching subgraph for centerId', centerId);
      const subgraph = await getGoalSubgraph(centerId);
      console.log('[MiniNetworkGraph] renderGraph: fetched subgraph', { 
        nodes: subgraph.nodes.length, 
        edges: subgraph.edges.length,
        truncated: subgraph.truncated
      });

      // Map to vis nodes
      const formattedNodes: NetworkNode[] = subgraph.nodes.map(n => formatNetworkNode(n));
      // Ignore any persisted positions for the mini graph so we can compact layout
      const miniNodes: NetworkNode[] = (formattedNodes as any[]).map((n: any) => ({
        ...n,
        position_x: undefined,
        position_y: undefined
      }));
      console.log('[MiniNetworkGraph] renderGraph: formattedNodes', { count: formattedNodes.length });

      // Convert edges to NetworkEdge format
      const networkEdges = subgraph.edges.map(e => ({
        from: e.from,
        to: e.to,
        relationship_type: e.relationship_type as 'child',
        id: `${e.from}-${e.to}`
      }));

      // Layout with hierarchy (local spacing, do not persist positions)
      const laidOut = await buildHierarchy(
        { nodes: miniNodes, edges: networkEdges },
        { savePositions: false, baseSpacing: 2 }
      );
      console.log('[MiniNetworkGraph] renderGraph: layout', { nodes: laidOut.nodes?.length, edges: (laidOut.edges || networkEdges)?.length });

      if (!nodesDataSetRef.current) nodesDataSetRef.current = new DataSet([]);
      if (!edgesDataSetRef.current) edgesDataSetRef.current = new DataSet([]);

      // Replace data
      nodesDataSetRef.current.clear();
      edgesDataSetRef.current.clear();
      const positions = layoutMiniNodes(laidOut.nodes || [], laidOut.edges || networkEdges, centerId);
      const compactNodes = (laidOut.nodes || []).map((node: any) => {
        const at = positions.get(node.id) || { x: 0, y: 0 };
        const font = typeof node.font === 'object' && node.font ? node.font : {};
        return {
          ...node,
          x: at.x,
          y: at.y,
          shape: 'box',
          margin: { top: 6, right: 8, bottom: 6, left: 8 },
          widthConstraint: { maximum: MINI_MAX_LABEL },
          font: {
            ...font,
            size: MINI_FONT,
            bold: { ...(font.bold || {}), size: MINI_FONT, color: font.color },
          },
        };
      });
      nodesDataSetRef.current.add(compactNodes);
      const nodeById = new Map(compactNodes.map((node: any) => [node.id, node]));
      const miniEdges = (laidOut.edges || networkEdges).map((edge: any) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        return {
          ...edge,
          id: `${edge.from}-${edge.to}`,
          width: MINI_EDGE_WIDTH,
          arrows: {
            to: {
              enabled: true,
              type: 'arrow',
              scaleFactor: arrowScaleForGap(gapBetween(from, to)),
            }
          },
          smooth: { enabled: true, type: 'curvedCW', roundness: 0.04 }
        };
      });
      edgesDataSetRef.current.add(miniEdges);
      console.log('[MiniNetworkGraph] renderGraph: datasets updated', {
        nodes: nodesDataSetRef.current.get().length,
        edges: edgesDataSetRef.current.get().length
      });

      if (!networkRef.current) {
        console.log('[MiniNetworkGraph] renderGraph: creating network instance');
        networkRef.current = new VisNetwork(
          containerRef.current,
          { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current },
          miniNetworkOptions
        );

        networkRef.current.on('click', (params: any) => {
          const nodeId = networkRef.current?.getNodeAt(params.pointer.DOM);
          const nodeData = (nodeId != null && nodesDataSetRef.current) ? nodesDataSetRef.current.get(nodeId) : null;
          console.log('[MiniNetworkGraph] click', { nodeId, hasData: !!nodeData });
          if (nodeData && onNodeClick) onNodeClick(nodeData as Goal);
        });
      } else {
        console.log('[MiniNetworkGraph] renderGraph: updating network data');
        try {
          networkRef.current.setData({ nodes: nodesDataSetRef.current!, edges: edgesDataSetRef.current! });
        } catch (err) {
          console.warn('[MiniNetworkGraph] renderGraph: setData failed, recreating network', err);
          try {
            networkRef.current?.destroy();
          } catch (_) {}
          networkRef.current = new VisNetwork(
            containerRef.current,
            { nodes: nodesDataSetRef.current!, edges: edgesDataSetRef.current! },
            miniNetworkOptions
          );
        }
      }

      if (containerRef.current && typeof ResizeObserver !== 'undefined' && !resizeObserverRef.current) {
        resizeObserverRef.current = new ResizeObserver(() => fitToContainer());
        resizeObserverRef.current.observe(containerRef.current);
      }

      // Fit once the container has its real size. A fit during dialog open
      // locks the camera to a too-small panel and leaves the arrows oversized
      // relative to the nodes.
      const nodeCount = nodesDataSetRef.current?.get().length || 0;
      if (networkRef.current && nodeCount > 0) {
        requestAnimationFrame(() => fitToContainer());
        setTimeout(() => fitToContainer(), 180);
      }
    } catch (e) {
      console.error('[MiniNetworkGraph] renderGraph: error', e);
    }
  }, [centerId, onNodeClick, fitToContainer]);

  useEffect(() => {
    console.log('[MiniNetworkGraph] effect: renderGraph invoked', { centerId });
    renderGraph();
  }, [renderGraph, centerId]);

  useEffect(() => {
    const handler = (evt: Event) => {
      console.log('[MiniNetworkGraph] event: network:relationships-changed', evt);
      renderGraph();
    };
    window.addEventListener('network:relationships-changed', handler as EventListener);
    return () => {
      window.removeEventListener('network:relationships-changed', handler as EventListener);
      console.log('[MiniNetworkGraph] cleanup: destroying network instance');
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (networkRef.current) {
        try { networkRef.current.destroy(); } catch (_) {}
        networkRef.current = null;
      }
      nodesDataSetRef.current = null;
      edgesDataSetRef.current = null;
    };
  }, [renderGraph]);

  return (
    <div ref={containerRef} style={{ height: `${height}px`, width: '100%' }} />
  );
};

export default MiniNetworkGraph;


