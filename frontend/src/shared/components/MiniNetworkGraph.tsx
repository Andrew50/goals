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

const MiniNetworkGraph: React.FC<MiniNetworkGraphProps> = ({ centerId, height = 220, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<VisNetwork | null>(null);
  const nodesDataSetRef = useRef<DataSet<any> | null>(null);
  const edgesDataSetRef = useRef<DataSet<any> | null>(null);


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
      const miniEdges = (laidOut.edges || networkEdges).map((e: any) => {
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
  }, [centerId, onNodeClick]);

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


