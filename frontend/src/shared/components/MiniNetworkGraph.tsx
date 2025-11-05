import React, { useEffect, useRef, useCallback } from 'react';
import { DataSet, Network as VisNetwork } from 'vis-network/standalone';
import { privateRequest } from '../utils/api';
import { goalToLocal } from '../utils/time';
import { ApiGoal, NetworkEdge, Goal, NetworkNode } from '../../types/goals';
import { buildHierarchy } from '../../pages/network/buildHierarchy';
import { formatNetworkNode } from '../utils/formatNetworkNode';

interface MiniNetworkGraphProps {
  centerId?: number;
  height?: number;
  onNodeClick?: (node: Goal) => void;
}

const MiniNetworkGraph: React.FC<MiniNetworkGraphProps> = ({ centerId, height = 220, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<VisNetwork | null>(null);
  const nodesDataSetRef = useRef<DataSet<any> | null>(null);
  const edgesDataSetRef = useRef<DataSet<any> | null>(null);

  const computeSubgraph = useCallback((allNodes: ApiGoal[], allEdges: NetworkEdge[]) => {
    console.log('[MiniNetworkGraph] computeSubgraph:start', {
      centerId,
      totalNodes: allNodes?.length,
      totalEdges: allEdges?.length
    });
    if (centerId == null) {
      console.warn('[MiniNetworkGraph] computeSubgraph: no centerId');
      return { nodes: [] as ApiGoal[], edges: [] as NetworkEdge[] };
    }

    const childEdges = allEdges.filter(e => e.relationship_type === 'child');
    console.log('[MiniNetworkGraph] computeSubgraph: childEdges', { count: childEdges.length });

    // Build adjacency maps
    const parentsByChild = new Map<number, number[]>();
    const childrenByParent = new Map<number, number[]>();
    for (const e of childEdges) {
      if (!parentsByChild.has(e.to)) parentsByChild.set(e.to, []);
      parentsByChild.get(e.to)!.push(e.from);
      if (!childrenByParent.has(e.from)) childrenByParent.set(e.from, []);
      childrenByParent.get(e.from)!.push(e.to);
    }

    // BFS for ancestors
    const ancestors = new Set<number>();
    const queueUp: number[] = [centerId];
    const seenUp = new Set<number>([centerId]);
    while (queueUp.length > 0) {
      const current = queueUp.shift()!;
      const parents = parentsByChild.get(current) || [];
      for (const p of parents) {
        if (!seenUp.has(p)) {
          ancestors.add(p);
          seenUp.add(p);
          queueUp.push(p);
        }
      }
    }

    // BFS for descendants
    const descendants = new Set<number>();
    const queueDown: number[] = [centerId];
    const seenDown = new Set<number>([centerId]);
    while (queueDown.length > 0) {
      const current = queueDown.shift()!;
      const children = childrenByParent.get(current) || [];
      for (const c of children) {
        if (!seenDown.has(c)) {
          descendants.add(c);
          seenDown.add(c);
          queueDown.push(c);
        }
      }
    }

    const idSet = new Set<number>([centerId]);
    ancestors.forEach(id => idSet.add(id));
    descendants.forEach(id => idSet.add(id));

    const filteredNodes = allNodes.filter(n => n.id != null && idSet.has(n.id!));
    const filteredEdges = childEdges.filter(e => idSet.has(e.from) && idSet.has(e.to));

    console.log('[MiniNetworkGraph] computeSubgraph:result', {
      ancestorCount: ancestors.size,
      descendantCount: descendants.size,
      nodeCount: filteredNodes.length,
      edgeCount: filteredEdges.length
    });

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [centerId]);

  const renderGraph = useCallback(async () => {
    if (!containerRef.current) {
      console.warn('[MiniNetworkGraph] renderGraph: no container');
      return;
    }

    try {
      console.log('[MiniNetworkGraph] renderGraph: fetching network');
      const { nodes, edges } = await privateRequest<{ nodes: ApiGoal[]; edges: NetworkEdge[] }>('network');
      console.log('[MiniNetworkGraph] renderGraph: fetched network', { nodes: nodes.length, edges: edges.length });
      const sub = computeSubgraph(nodes, edges);
      console.log('[MiniNetworkGraph] renderGraph: subgraph', { nodes: sub.nodes.length, edges: sub.edges.length });

      // Map to local + vis nodes
      const formattedNodes: NetworkNode[] = sub.nodes.map(n => formatNetworkNode(goalToLocal(n as ApiGoal) as unknown as Goal));
      // Ignore any persisted positions for the mini graph so we can compact layout
      const miniNodes: NetworkNode[] = (formattedNodes as any[]).map((n: any) => ({
        ...n,
        position_x: undefined,
        position_y: undefined
      }));
      console.log('[MiniNetworkGraph] renderGraph: formattedNodes', { count: formattedNodes.length });

      // Layout with hierarchy (local spacing, do not persist positions)
      const laidOut = await buildHierarchy(
        { nodes: miniNodes, edges: sub.edges },
        { savePositions: false, baseSpacing: 2 }
      );
      console.log('[MiniNetworkGraph] renderGraph: layout', { nodes: laidOut.nodes?.length, edges: (laidOut.edges || sub.edges)?.length });

      if (!nodesDataSetRef.current) nodesDataSetRef.current = new DataSet([]);
      if (!edgesDataSetRef.current) edgesDataSetRef.current = new DataSet([]);

      // Replace data
      nodesDataSetRef.current.clear();
      edgesDataSetRef.current.clear();
      nodesDataSetRef.current.add(laidOut.nodes);
      const miniEdges = (laidOut.edges || sub.edges).map((e: any) => {
        const currentScale = e?.arrows?.to?.scaleFactor ?? 0.4;
        return {
          ...e,
          id: `${e.from}-${e.to}`,
          width: Math.max(3, e.width ? e.width * 2 : 3),
          arrows: {
            to: {
              enabled: true,
              type: e?.arrows?.to?.type || 'arrow',
              scaleFactor: Math.max(1.4, currentScale * 3)
            }
          },
          smooth: { ...(e.smooth || { enabled: true, type: 'curvedCW' }), roundness: 0.05 }
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
          {
            nodes: {
              shape: 'box',
              margin: { top: 16, right: 16, bottom: 16, left: 16 },
              widthConstraint: { maximum: 320 },
              font: { size: 20 },
              borderWidth: 3,
              chosen: false
            },
            edges: {
              arrows: { to: { enabled: true, scaleFactor: 1.4 } },
              smooth: { enabled: true, type: 'curvedCW', roundness: 0.05 },
              width: 3,
              color: { inherit: 'from', opacity: 0.9 }
            },
            physics: { enabled: false },
            manipulation: { enabled: false },
            interaction: { dragNodes: false, dragView: true, zoomView: true, hover: true, keyboard: { enabled: false } }
          }
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
            {
              nodes: {
                shape: 'box',
                margin: { top: 16, right: 16, bottom: 16, left: 16 },
                widthConstraint: { maximum: 320 },
                font: { size: 20 },
                borderWidth: 3,
                chosen: false
              },
              edges: {
                arrows: { to: { enabled: true, scaleFactor: 1.4 } },
                smooth: { enabled: true, type: 'curvedCW', roundness: 0.05 },
                width: 3,
                color: { inherit: 'from', opacity: 0.9 }
              },
              physics: { enabled: false },
              manipulation: { enabled: false },
              interaction: { dragNodes: false, dragView: true, zoomView: true, hover: true, keyboard: { enabled: false } }
            }
          );
        }
      }

      // Fit view to content when there is something to show
      const nodeCount = nodesDataSetRef.current?.get().length || 0;
      if (networkRef.current && nodeCount > 0) {
        requestAnimationFrame(() => {
          try {
            // Ensure entire mini-network is visible
            networkRef.current && networkRef.current.fit({ animation: false as any });
            // Do a second fit shortly after to account for font/layout paints
            setTimeout(() => {
              try { networkRef.current && networkRef.current.fit({ animation: false as any }); } catch (_) {}
            }, 80);
            // After fitting, zoom out slightly so edges are visually shorter within the container
            setTimeout(() => {
              try {
                const currentScale = (networkRef.current as any)?.getScale?.() ?? 1;
                (networkRef.current as any)?.moveTo?.({ scale: currentScale * 0.8 });
              } catch (_) {}
            }, 120);
            console.log('[MiniNetworkGraph] renderGraph: fit applied (double)');
          } catch (_) {}
        });
      }
    } catch (e) {
      console.error('[MiniNetworkGraph] renderGraph: error', e);
    }
  }, [computeSubgraph, onNodeClick]);

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


