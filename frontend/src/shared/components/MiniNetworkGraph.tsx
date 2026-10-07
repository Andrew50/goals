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
// same units as node shapes, then scales the whole scene by the camera zoom.
// The head has to be derived from the node and the edge. Multiplying by zoom
// or by edge thickness makes the head grow faster than the nodes.
const MINI_EDGE_WIDTH = 2;

function miniArrowScaleFactor(nodeExtent: number, edgeLength: number): number {
  const node = Number.isFinite(nodeExtent) && nodeExtent > 0 ? nodeExtent : 36;
  const edge = Number.isFinite(edgeLength) && edgeLength > 0 ? edgeLength : node * 3;
  // About two-thirds of the smaller node, and never more than a fifth of the edge.
  const target = Math.min(node * 0.85, edge * 0.22);
  const length = Math.max(10, Math.min(target, 36));
  const scale = (length - 3 * MINI_EDGE_WIDTH) / 15;
  return Math.max(0.2, Math.min(scale, 2));
}

const miniNetworkOptions = {
  nodes: {
    shape: 'box' as const,
    margin: { top: 16, right: 16, bottom: 16, left: 16 },
    widthConstraint: { maximum: 320 },
    font: { size: 20 },
    borderWidth: 3,
    chosen: false
  },
  edges: {
    arrows: { to: { enabled: true, scaleFactor: 0.2 } },
    smooth: { enabled: true, type: 'curvedCW' as const, roundness: 0.05 },
    width: MINI_EDGE_WIDTH,
    color: { inherit: 'from' as const, opacity: 0.9 }
  },
  physics: { enabled: false },
  manipulation: { enabled: false },
  interaction: { dragNodes: false, dragView: true, zoomView: true, hover: true, keyboard: { enabled: false } }
};

function measuredNodeExtent(node: any): number {
  const width = node?.shape?.width;
  const height = node?.shape?.height;
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return Math.min(width, height);
  }
  const size = node?.options?.size;
  return typeof size === 'number' && size > 0 ? size : 36;
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
    if (!network || !el || !edges || el.clientWidth < 40 || el.clientHeight < 40) return;
    try {
      network.fit({ animation: false });
      const bodyNodes = network.body?.nodes || {};
      const updates = edges.get().map((edge: any) => {
        const from = bodyNodes[edge.from];
        const to = bodyNodes[edge.to];
        const edgeLength = from && to ? Math.hypot((to.x ?? 0) - (from.x ?? 0), (to.y ?? 0) - (from.y ?? 0)) : 0;
        return {
          id: edge.id,
          width: MINI_EDGE_WIDTH,
          arrows: {
            to: {
              enabled: true,
              type: 'arrow',
              scaleFactor: miniArrowScaleFactor(
                Math.min(measuredNodeExtent(from), measuredNodeExtent(to)),
                edgeLength
              ),
            },
          },
        };
      });
      if (updates.length) edges.update(updates);
      network.fit({ animation: false });
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
      nodesDataSetRef.current.add(laidOut.nodes);
      const nodeById = new Map<number, { x: number; y: number; size: number }>();
      (laidOut.nodes || []).forEach((n: any) => {
        nodeById.set(n.id, {
          x: typeof n.x === 'number' ? n.x : 0,
          y: typeof n.y === 'number' ? n.y : 0,
          size: typeof n.size === 'number' ? n.size : 30,
        });
      });
      const miniEdges = (laidOut.edges || networkEdges).map((e: any) => {
        const from = nodeById.get(e.from);
        const to = nodeById.get(e.to);
        const edgeLength = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
        const nodeSize = Math.min(from?.size ?? 30, to?.size ?? 30);
        return {
          ...e,
          id: `${e.from}-${e.to}`,
          width: MINI_EDGE_WIDTH,
          arrows: {
            to: {
              enabled: true,
              type: 'arrow',
              scaleFactor: miniArrowScaleFactor(nodeSize, edgeLength),
            }
          },
          smooth: { enabled: true, type: 'curvedCW', roundness: 0.05 }
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


