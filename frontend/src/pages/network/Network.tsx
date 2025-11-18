import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DataSet, Network as VisNetwork } from 'vis-network/standalone';
import {
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  List,
  ListItem,
  ListItemText
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddLinkIcon from '@mui/icons-material/AddLink';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { createResizeObserver } from '../../shared/utils/resizeObserver';
import { NetworkEdge, Goal, RelationshipType, ApiGoal, NetworkNode } from '../../types/goals'; // Import ApiGoal
import GoalMenu from '../../shared/components/GoalMenu';
import { privateRequest, createRelationship, deleteRelationship } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import {
  buildHierarchy,
  saveNodePosition,
  calculateNewNodePosition,
  formatEdgesForGraph
} from './buildHierarchy';
import { formatNetworkNode } from '../../shared/utils/formatNetworkNode';
import { validateRelationship } from '../../shared/utils/goalValidation';
import { SearchBar } from '../../shared/components/SearchBar';
import { getGoalStyle } from '../../shared/styles/colors';
import '../../shared/styles/badges.css';

// Node formatting moved to shared util

type DialogMode = 'create' | 'edit' | 'view' | 'relationship' | null;

const NetworkView: React.FC = () => {
  const networkContainer = useRef<HTMLDivElement>(null);
  const networkRef = useRef<VisNetwork | null>(null);
  const nodesDataSetRef = useRef<DataSet<any> | null>(null);
  const edgesDataSetRef = useRef<DataSet<any> | null>(null);

  const [pendingRelationship, setPendingRelationship] = useState<{ from: number, to: number } | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [addNodeMode, setAddNodeMode] = useState(false);
  const [addEdgeMode, setAddEdgeMode] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const deleteModeRef = useRef(deleteMode);
  const addEdgeModeRef = useRef(addEdgeMode);
  const draggedNodeRef = useRef<number | null>(null);
  const [searchItems, setSearchItems] = useState<Goal[]>([]);
  const [searchResults, setSearchResults] = useState<Array<{ item: Goal; score: number }>>([]);
  const lastFocusedIdRef = useRef<number | null>(null);
  const shouldAutoFocusRef = useRef<boolean>(false);
  const [edgeItems, setEdgeItems] = useState<NetworkEdge[]>([]);
  const isHoveringRef = useRef<boolean>(false);
  const prevHoverGreenEdgeIdsRef = useRef<Set<string | number>>(new Set());
  const filteredSearchItems = useMemo(() => {
    return (searchItems || []).filter(g => g && g.goal_type !== 'event');
  }, [searchItems]);

  // Debug logger for focused instrumentation
  const debug = (...args: any[]) => console.log('[NetworkDebug]', ...args);

  // vis‑network configuration options
  const options = useMemo(() => ({
    nodes: {
      shape: 'box',
      margin: { top: 12, right: 12, bottom: 12, left: 12 },
      font: {
        size: 14,
        bold: { size: 14, mod: 'bold' }
      },
      widthConstraint: { maximum: 150 },
      fixed: { x: false, y: false },
      borderWidth: 1, // Default border width for nodes without priority
      chosen: false
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      smooth: {
        enabled: true,
        type: 'curvedCW',
        roundness: 0.2,
        forceDirection: 'none'
      },
      width: 1.5,
      color: {
        inherit: 'from',
        opacity: 0.7,
        hover: '#2B7CE9',
        highlight: '#2B7CE9'
      }
    },
    physics: { enabled: false },
    interaction: {
      dragNodes: true,
      dragView: true,
      zoomView: true,
      hover: true,
      navigationButtons: false,
      keyboard: { enabled: true, bindToWindow: true }
    },
    manipulation: {
      enabled: false,
      addNode: true,
      addEdge: async function (data: any, callback: Function) {
        try {
          debug('manipulation.addEdge invoked', data);
            // Disallow creating an edge from a node to itself
            if (data && data.from === data.to) {
              try {
                alert('Cannot create a relationship from a node to itself.');
              } catch {}
              debug('Blocked self-edge creation attempt', data);
              // Prevent vis from adding a temporary edge; keep addEdgeMode active for another try
              callback(null);
              try {
                (networkRef.current as any)?.addEdgeMode?.();
              } catch {}
              return;
            }
          // Immediately create a child relationship and skip the menu
          await handleCreateRelationship(data.from, data.to, 'child');
          // Prevent vis from adding a temporary edge; we'll manage via dataset updates
          callback(null);
        } catch (err) {
          // console.error('Edge creation error:', err);
          debug('Edge creation error', err);
          callback(null);
        }
      },
      initiallyActive: false,
      editEdge: false,
      deleteNode: true,
      deleteEdge: true
    }
  }), []);

  // Helper: Given a node ID, find connected elements split by direction (for hover highlighting)
  const findConnectedElements = (nodeId: number, edges: NetworkEdge[]): {
    edgesUp: Set<string | number>,
    edgesDown: Set<string | number>
  } => {
    const visitedUp = new Set<number>();
    const visitedDown = new Set<number>();
    const edgesUp = new Set<string | number>();
    const edgesDown = new Set<string | number>();

    const traverseUpward = (currentId: number) => {
      if (visitedUp.has(currentId)) return;
      visitedUp.add(currentId);
      edges.forEach(edge => {
        if (edge.to === currentId) {
          edgesUp.add((edge as any).id ?? `${(edge as any).from}-${(edge as any).to}`);
          traverseUpward((edge as any).from as number);
        }
      });
    };

    const traverseDownward = (currentId: number) => {
      if (visitedDown.has(currentId)) return;
      visitedDown.add(currentId);
      edges.forEach(edge => {
        if (edge.from === currentId) {
          edgesDown.add((edge as any).id ?? `${(edge as any).from}-${(edge as any).to}`);
          traverseDownward((edge as any).to as number);
        }
      });
    };

    traverseUpward(nodeId);
    traverseDownward(nodeId);

    return { edgesUp, edgesDown };
  };

  // ---- Insights: compute structural issues and highlight sets ----
  const findSccs = useCallback((nodeIdsArr: number[], childrenById: Map<number, Set<number>>) => {
    const indexMap = new Map<number, number>();
    const lowLinkMap = new Map<number, number>();
    const onStack = new Set<number>();
    const stack: number[] = [];
    let index = 0;
    const sccs: number[][] = [];
    const nodeSet = new Set(nodeIdsArr);

    const strongConnect = (v: number) => {
      indexMap.set(v, index);
      lowLinkMap.set(v, index);
      index += 1;
      stack.push(v);
      onStack.add(v);

      const neighbors = childrenById.get(v) || new Set<number>();
      neighbors.forEach((w) => {
        if (!nodeSet.has(w)) return;
        if (!indexMap.has(w)) {
          strongConnect(w);
          lowLinkMap.set(v, Math.min(lowLinkMap.get(v)!, lowLinkMap.get(w)!));
        } else if (onStack.has(w)) {
          lowLinkMap.set(v, Math.min(lowLinkMap.get(v)!, indexMap.get(w)!));
        }
      });

      if (lowLinkMap.get(v) === indexMap.get(v)) {
        const component: number[] = [];
        while (true) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === v) break;
        }
        sccs.push(component);
      }
    };

    nodeIdsArr.forEach((v) => {
      if (!indexMap.has(v)) strongConnect(v);
    });
    return sccs;
  }, []);

  const findTriangles = useCallback((nodeSet: Set<number>, childrenById: Map<number, Set<number>>) => {
    const triangles: Array<[number, number, number]> = [];
    const seen = new Set<string>();
    nodeSet.forEach((a) => {
      const aChildren = childrenById.get(a);
      if (!aChildren || aChildren.size === 0) return;
      aChildren.forEach((b) => {
        if (!nodeSet.has(b)) return;
        const bChildren = childrenById.get(b);
        if (!bChildren || bChildren.size === 0) return;
        bChildren.forEach((c) => {
          if (!nodeSet.has(c)) return;
          // Require distinct nodes to avoid treating self-loops or degenerate cases as cycles
          if (a === b || b === c || a === c) return;
          if (aChildren.has(c)) {
            const key = `${a}-${b}-${c}`;
            if (!seen.has(key)) {
              seen.add(key);
              triangles.push([a, b, c]);
            }
          }
        });
      });
    });
    try {
      debug('findTriangles result', {
        count: triangles.length,
        samples: triangles.slice(0, 5)
      });
    } catch {}
    return triangles;
  }, []);

  const [showSuggestions, setShowSuggestions] = useState(false);

  const insights = useMemo(() => {
    if (!showSuggestions) {
      return {
        idToGoal: new Map<number, Goal>(),
        roots: [],
        leaves: [],
        mutualPairs: [],
        sccs: [],
        triangles: [],
        selfLoopNodes: new Set<number>(),
        highlightSets: {
          roots: { nodes: new Set<number>(), edges: new Set<string>() },
          leaves: { nodes: new Set<number>(), edges: new Set<string>() },
          mutual: { nodes: new Set<number>(), edges: new Set<string>() },
          cycles: { nodes: new Set<number>(), edges: new Set<string>() },
          triangles: { nodes: new Set<number>(), edges: new Set<string>() }
        }
      };
    }
    const idToGoal = new Map<number, Goal>();
    const nodeIds: number[] = [];
    (searchItems || []).forEach((g) => {
      if (g && typeof g.id === 'number') {
        idToGoal.set(g.id, g);
        nodeIds.push(g.id);
      }
    });
    const nodeSet = new Set(nodeIds);

    const childrenById = new Map<number, Set<number>>();
    const parentsById = new Map<number, Set<number>>();
    const selfLoopNodes = new Set<number>();
    nodeIds.forEach((id) => {
      childrenById.set(id, new Set<number>());
      parentsById.set(id, new Set<number>());
    });
    (edgeItems || []).forEach((e) => {
      const from = (e as any).from as number;
      const to = (e as any).to as number;
      if (!nodeSet.has(from) || !nodeSet.has(to)) return;
      childrenById.get(from)!.add(to);
      parentsById.get(to)!.add(from);
      if (from === to) {
        selfLoopNodes.add(from);
      }
    });

    const roots: number[] = nodeIds.filter((id) => (parentsById.get(id)?.size || 0) === 0);
    const leaves: number[] = nodeIds.filter((id) => {
      const g = idToGoal.get(id);
      if (!g) return false;
      if (g.goal_type === 'event') return false;
      return (childrenById.get(id)?.size || 0) === 0;
    });

    const mutualPairs: Array<[number, number]> = [];
    const seenPair = new Set<string>();
    nodeIds.forEach((u) => {
      const uChildren = childrenById.get(u);
      if (!uChildren) return;
      uChildren.forEach((v) => {
        if (u === v) return;
        const vChildren = childrenById.get(v);
        if (vChildren && vChildren.has(u)) {
          const a = Math.min(u, v);
          const b = Math.max(u, v);
          const key = `${a}-${b}`;
          if (!seenPair.has(key)) {
            seenPair.add(key);
            mutualPairs.push([a, b]);
          }
        }
      });
    });

    const sccsRaw = findSccs(nodeIds, childrenById);
    const sccs = sccsRaw.filter((comp) => comp.length >= 3);
    const triangles = findTriangles(nodeSet, childrenById);

    const edgeId = (from: number, to: number) => `${from}-${to}`;
    const withinEdges = (ids: number[]) => {
      const s = new Set(ids);
      const res = new Set<string>();
      s.forEach((u) => {
        const ch = childrenById.get(u);
        if (!ch) return;
        ch.forEach((v) => {
          if (s.has(v)) res.add(edgeId(u, v));
        });
      });
      return res;
    };

    const rootsNodes = new Set<number>(roots);
    const rootsEdges = new Set<string>();

    const leavesNodes = new Set<number>(leaves);
    const leavesEdges = new Set<string>();

    const mutualNodes = new Set<number>();
    const mutualEdges = new Set<string>();
    mutualPairs.forEach(([a, b]) => {
      mutualNodes.add(a); mutualNodes.add(b);
      mutualEdges.add(edgeId(a, b));
      mutualEdges.add(edgeId(b, a));
    });

    const cycleNodes = new Set<number>();
    const cycleEdges = new Set<string>();
    sccs.forEach((comp) => {
      comp.forEach((id) => cycleNodes.add(id));
      withinEdges(comp).forEach((eid) => cycleEdges.add(eid));
    });

    const triangleNodes = new Set<number>();
    const triangleEdges = new Set<string>();
    triangles.forEach(([a, b, c]) => {
      triangleNodes.add(a); triangleNodes.add(b); triangleNodes.add(c);
      triangleEdges.add(edgeId(a, b));
      triangleEdges.add(edgeId(b, c));
      triangleEdges.add(edgeId(a, c));
    });

    try {
      debug('Insights cycle stats', {
        nodeCount: nodeIds.length,
        selfLoopNodes: Array.from(selfLoopNodes),
        sccsRawCount: sccsRaw.length,
        sccsRawSizesSample: sccsRaw.slice(0, 5).map((g) => g.length),
        sccsUsedCount: sccs.length,
        sccsUsedSizesSample: sccs.slice(0, 5).map((g) => g.length),
        trianglesCount: triangles.length,
        trianglesSample: triangles.slice(0, 5)
      });
    } catch {}

    return {
      idToGoal,
      roots,
      leaves,
      mutualPairs,
      sccs,
      triangles,
      selfLoopNodes,
      highlightSets: {
        roots: { nodes: rootsNodes, edges: rootsEdges },
        leaves: { nodes: leavesNodes, edges: leavesEdges },
        mutual: { nodes: mutualNodes, edges: mutualEdges },
        cycles: { nodes: cycleNodes, edges: cycleEdges },
        triangles: { nodes: triangleNodes, edges: triangleEdges }
      }
    };
  }, [searchItems, edgeItems, findSccs, findTriangles, showSuggestions]);

  // Apply highlights for all issue types (always active)
  useEffect(() => {
    const network: any = networkRef.current as any;
    if (!network || !network.body) return;
    if (isHoveringRef.current) return; // don't override hover-time selection
    const nodes = new Set<number>();
    const edges = new Set<string>();
    try {
      Object.values(insights.highlightSets).forEach((s) => {
        s.nodes.forEach((n) => nodes.add(n));
        s.edges.forEach((e) => edges.add(e));
      });
      network.setSelection({ nodes: Array.from(nodes), edges: Array.from(edges) });
    } catch (e) {
      debug('applyHighlights selection failed', e);
    }
  }, [insights]);

  // Helper function to refresh edges for a specific node
  const refreshEdgesForNode = useCallback(async (nodeId: number) => {
    if (!edgesDataSetRef.current) return;

    try {
      // Fetch current network data from backend
      const networkData = await privateRequest<{ nodes: ApiGoal[], edges: NetworkEdge[] }>('network');

      // Find edges that involve this node
      const nodeEdges = networkData.edges.filter(edge =>
        edge.from === nodeId || edge.to === nodeId
      );

      // Get current edges from the DataSet
      const currentEdges = edgesDataSetRef.current.get();
      const currentEdgeIds = new Set(currentEdges.map(e => e.id));

      // Add new edges that aren't already in the DataSet
      const newEdges = nodeEdges
        .map(edge => ({
          ...edge,
          id: `${edge.from}-${edge.to}`
        }))
        .filter(edge => !currentEdgeIds.has(edge.id));

      if (newEdges.length > 0) {
        edgesDataSetRef.current.add(newEdges);
      }

      // Remove edges that no longer exist on the backend
      const backendEdgeIds = new Set(nodeEdges.map(e => `${e.from}-${e.to}`));
      const edgesToRemove = currentEdges
        .filter(edge =>
          (edge.from === nodeId || edge.to === nodeId) &&
          !backendEdgeIds.has(edge.id)
        )
        .map(edge => edge.id);

      if (edgesToRemove.length > 0) {
        edgesDataSetRef.current.remove(edgesToRemove);
      }
      // Recompute and apply edge styles after syncing this node's edges
      try {
        if (nodesDataSetRef.current && edgesDataSetRef.current) {
          const nodes = (nodesDataSetRef.current.get() || []) as unknown as NetworkNode[];
          const allEdges = (edgesDataSetRef.current.get() || []) as unknown as NetworkEdge[];
          const styledEdges = formatEdgesForGraph(nodes, allEdges);
          edgesDataSetRef.current.update(styledEdges);
        }
      } catch (e) {
        debug('Failed to recompute edge styles in refreshEdgesForNode', e);
      }
    } catch (error) {
      // console.error('Failed to refresh edges for node:', nodeId, error);
      debug('Failed to refresh edges for node', { nodeId, error });
    }
  }, []);

  const wireEdgeItems = useCallback(() => {
    if (!edgesDataSetRef.current) return undefined as unknown as () => void;
    const ds: any = edgesDataSetRef.current as any;
    const refresh = () => {
      try {
        setEdgeItems((ds.get() || []) as NetworkEdge[]);
      } catch {
        setEdgeItems([]);
      }
    };
    refresh();
    ds.on('add', refresh);
    ds.on('update', refresh);
    ds.on('remove', refresh);
    return () => {
      try {
        ds.off('add', refresh);
        ds.off('update', refresh);
        ds.off('remove', refresh);
      } catch {
        // ignore
      }
    };
  }, []);

  // (handleClick moved below refreshFullNetwork)

  const focusNode = useCallback((id: number) => {
    if (!networkRef.current) return;
    try {
      networkRef.current.selectNodes([id]);
      networkRef.current.fit({
        nodes: [id],
        animation: { duration: 400, easingFunction: 'easeInOutQuad' }
      });
    } catch (e) {
      // no-op
    }
  }, []);

  const wireSearchItems = useCallback(() => {
    if (!nodesDataSetRef.current) return undefined as unknown as () => void;
    const ds: any = nodesDataSetRef.current as any;
    const refresh = () => {
      try {
        setSearchItems((ds.get() || []) as Goal[]);
      } catch {
        setSearchItems([]);
      }
    };
    refresh();
    ds.on('add', refresh);
    ds.on('update', refresh);
    ds.on('remove', refresh);
    return () => {
      try {
        ds.off('add', refresh);
        ds.off('update', refresh);
        ds.off('remove', refresh);
      } catch {
        // ignore
      }
    };
  }, []);

  // Full network refresh: re-fetch nodes+edges, preserve x/y when possible, and redraw
  const refreshFullNetwork = useCallback(async () => {
    if (!nodesDataSetRef.current || !edgesDataSetRef.current) return;
    try {
      const currentNodes = nodesDataSetRef.current.get();
      const byId = new Map(currentNodes.map((n: any) => [n.id, n]));

      const { nodes, edges } = await privateRequest<{ nodes: ApiGoal[], edges: NetworkEdge[] }>('network');

      // Choose layout strategy based on how many nodes already have saved positions
      const formattedNodesRaw = nodes.map((n: ApiGoal) => {
        const local = goalToLocal(n);
        return formatNetworkNode(local);
      });

      const positionedCount = formattedNodesRaw.filter((n: any) =>
        typeof n.position_x === 'number' && typeof n.position_y === 'number'
      ).length;
      const mostHavePositions =
        formattedNodesRaw.length > 0 &&
        positionedCount / formattedNodesRaw.length >= 0.8;

      let formattedNodes: NetworkNode[];
      let formattedEdges: NetworkEdge[];

      if (mostHavePositions) {
        // Fast path: re‑use stored positions and only recompute edge styling
        formattedNodes = formattedNodesRaw.map((n: any) => {
          const existing = byId.get(n.id);
          return {
            ...n,
            x: existing?.x ?? n.position_x,
            y: existing?.y ?? n.position_y
          };
        }) as unknown as NetworkNode[];
        formattedEdges = formatEdgesForGraph(
          formattedNodes,
          edges as unknown as NetworkEdge[]
        );
      } else {
        // Slow path: run full layout to compute positions
        const laidOut = await buildHierarchy(
          {
            nodes: formattedNodesRaw as unknown as NetworkNode[],
            edges: edges as unknown as NetworkEdge[]
          },
          { savePositions: true }
        );
        formattedNodes = laidOut.nodes as unknown as NetworkNode[];
        formattedEdges = laidOut.edges as unknown as NetworkEdge[];
      }

      // Replace nodes (remove missing, add/update present)
      const serverIds = new Set(formattedNodes.map((n: any) => n.id));
      const toRemove = currentNodes.filter((n: any) => !serverIds.has(n.id)).map((n: any) => n.id);
      if (toRemove.length) nodesDataSetRef.current.remove(toRemove);
      nodesDataSetRef.current.update(formattedNodes);

      // Replace edges
      const currentEdges = edgesDataSetRef.current.get();
      const serverEdgeIds = new Set(formattedEdges.map((e: any) => e.id));
      const edgesToRemove = currentEdges.filter((e: any) => !serverEdgeIds.has(e.id)).map((e: any) => e.id);
      if (edgesToRemove.length) edgesDataSetRef.current.remove(edgesToRemove);
      edgesDataSetRef.current.update(formattedEdges);

      networkRef.current?.redraw();
    } catch (e) {
      // console.error('Failed to refresh full network:', e);
      debug('Failed to refresh full network', e);
    }
  }, []);

  // Refresh a single node from the server, normalize, update dataset, refresh edges, and redraw
  const refreshNodeById = useCallback(async (nodeId: number) => {
    if (!nodesDataSetRef.current || !edgesDataSetRef.current) return;
    try {
      const apiGoal = await privateRequest<ApiGoal>(`goals/${nodeId}`);
      const local = goalToLocal(apiGoal);
      const formatted = formatNetworkNode(local);
      const existing = nodesDataSetRef.current.get(nodeId);
      nodesDataSetRef.current.update({ ...formatted, x: existing?.x, y: existing?.y });
      await refreshEdgesForNode(nodeId);
      networkRef.current?.redraw();
    } catch (e) {
      // If the node no longer exists or failed, fall back to a full refresh
      await refreshFullNetwork();
    }
  }, [refreshEdgesForNode, refreshFullNetwork]);

  // (moved refreshFullNetwork earlier)

  // Handle clicks (and context clicks) to open the GoalMenu or perform deletion
  const handleClick = useCallback((params: any, goalDialogMode: "edit" | "view") => {
    debug('handleClick invoked', {
      goalDialogMode,
      addEdgeMode: addEdgeModeRef.current,
      deleteMode: deleteModeRef.current,
      nodes: params?.nodes,
      edges: params?.edges
    });
    if (!networkRef.current) return;
    params.event.preventDefault();

    if (addEdgeModeRef.current) {
      debug('In addEdgeMode; ignoring click to avoid opening menus');
      return; // Do not open menu in edge mode
    }

    if (deleteModeRef.current) {
      if (params.nodes.length > 0) {
        // We'll handle this after handleDeleteNode is defined
        const nodeId = params.nodes[0];
        if (networkRef.current && nodesDataSetRef.current && edgesDataSetRef.current) {
          debug('Attempting to delete node', nodeId);
          privateRequest('goals/' + nodeId, 'DELETE')
            .then(() => {
              debug('Node deleted on backend; removing locally', nodeId);
              nodesDataSetRef.current?.remove(nodeId);
              const currentEdges = edgesDataSetRef.current?.get();
              currentEdges?.forEach(edge => {
                if (edge.from === nodeId || edge.to === nodeId) {
                  edgesDataSetRef.current?.remove(edge.id);
                }
              });
              // Recompute styles after deletions
              try {
                if (nodesDataSetRef.current && edgesDataSetRef.current) {
                  const nodes = (nodesDataSetRef.current.get() || []) as unknown as NetworkNode[];
                  const edgesAll = (edgesDataSetRef.current.get() || []) as unknown as NetworkEdge[];
                  const styled = formatEdgesForGraph(nodes, edgesAll);
                  edgesDataSetRef.current.update(styled);
                }
              } catch (e) {
                debug('Failed to recompute edge styles after node delete', e);
              }
            })
            .catch(error => {
              // console.error('Failed to delete node:', error);
              debug('Failed to delete node', { nodeId, error });
            });
        }
      } else if (params.edges.length > 0) {
        // We'll handle this after handleDeleteEdge is defined
        const edgeId = params.edges[0];
        if (edgesDataSetRef.current) {
          const [fromId, toId] = edgeId.split('-').map(Number);
          const edgeData = edgesDataSetRef.current.get(edgeId as any);
          const edgeObj = (Array.isArray(edgeData) ? edgeData[0] : edgeData) as Partial<NetworkEdge> | undefined;
          const relationshipType = edgeObj?.relationship_type as RelationshipType | undefined;
          debug('Attempting to delete edge', { edgeId, fromId, toId, relationshipType });
          const runDelete = relationshipType
            ? deleteRelationship(fromId, toId, relationshipType)
            : privateRequest(`goals/relationship/${fromId}/${toId}`, 'DELETE');
          Promise.resolve(runDelete)
            .then(() => {
              debug('Edge deleted on backend; removing locally', edgeId);
              edgesDataSetRef.current?.remove(edgeId);
              // Recompute styles after deletion
              try {
                if (nodesDataSetRef.current && edgesDataSetRef.current) {
                  const nodes = (nodesDataSetRef.current.get() || []) as unknown as NetworkNode[];
                  const edgesAll = (edgesDataSetRef.current.get() || []) as unknown as NetworkEdge[];
                  const styled = formatEdgesForGraph(nodes, edgesAll);
                  edgesDataSetRef.current.update(styled);
                }
              } catch (e) {
                debug('Failed to recompute edge styles after edge delete', e);
              }
            })
            .catch(error => {
              // console.error('Failed to delete edge:', error);
              debug('Failed to delete edge', { edgeId, relationshipType, error });
            });
        }
      }
      return;
    }

    const nodeId = networkRef.current.getNodeAt(params.pointer.DOM);
    if (nodeId && nodesDataSetRef.current) {
      const nodeData = nodesDataSetRef.current?.get(nodeId);
      if (nodeData) {
        // GoalMenu expects a Goal object (with Dates)
        // nodeData from DataSet might still be ApiGoal-like if not fully processed,
        // Assuming nodeData here is effectively a Goal or NetworkNode.
        GoalMenu.open(nodeData as Goal, goalDialogMode, async (updatedGoal: Goal) => {
          // console.log('[Network] onSuccess priority:', updatedGoal.priority);

          if (updatedGoal.id) {
            const exists = await checkNodeExists(updatedGoal.id);
            if (!exists) {
              await refreshFullNetwork();
              return;
            }
            await refreshNodeById(updatedGoal.id);
          } else {
            await refreshFullNetwork();
          }
        });
      }
    }
  }, [refreshFullNetwork, refreshNodeById]);

  // Initialize the network once on mount
  useEffect(() => {
    // keep ref in sync
    addEdgeModeRef.current = addEdgeMode;
  }, [addEdgeMode]);

  // Initialize the network once on mount
  useEffect(() => {
    let cleanupSearchItems: (() => void) | undefined;
    let cleanupEdgeItems: (() => void) | undefined;
    const initializeNetwork = async () => {
      try {
        // Fetch initial data (nodes should be ApiGoal compatible)
        const response = await privateRequest<{ nodes: ApiGoal[], edges: NetworkEdge[] }>('network');
        //response.nodes.map(goalToLocal) 
        // Format nodes from ApiGoal[] to NetworkNode[] (which extends Goal)
        const formattedNodes = response.nodes.map(apiNode => formatNetworkNode(goalToLocal(apiNode)));
        // Calculate positions and styling using the full hierarchy algorithm
        const formattedData = await buildHierarchy({ nodes: formattedNodes, edges: response.edges });

        // Create DataSets for nodes and edges (used by vis‑network)
        // Always create DataSets even if empty to ensure network functionality
        nodesDataSetRef.current = new DataSet(formattedData.nodes);
        edgesDataSetRef.current = new DataSet(formattedData.edges);
        cleanupSearchItems = wireSearchItems();
        cleanupEdgeItems = wireEdgeItems();

        // Create the network instance - always create it even with empty data
        if (networkContainer.current) {
          networkRef.current = new VisNetwork(
            networkContainer.current,
            { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current },
            options
          );
          debug('Vis network instance created');

          // Ensure container does not show focus outline or steal focus
          try {
            networkContainer.current.setAttribute('tabindex', '-1');
            (networkContainer.current as HTMLElement).style.outline = 'none';
          } catch {}

          // Drag events: record the node id on drag start...
          networkRef.current.on('dragStart', (params: any) => {
            if (params.nodes && params.nodes.length > 0) {
              draggedNodeRef.current = params.nodes[0];
            }
          });

          // ...and on drag end, update the backend and the DataSet
          networkRef.current.on('dragEnd', async (params: any) => {
            const draggedNodeId = draggedNodeRef.current;
            if (draggedNodeId && nodesDataSetRef.current) {
              setTimeout(async () => {
                const position = networkRef.current?.getPositions([draggedNodeId])[draggedNodeId];
                if (position) {
                  try {
                    await saveNodePosition(draggedNodeId, position.x, position.y);
                    nodesDataSetRef.current?.update({ id: draggedNodeId, x: position.x, y: position.y });
                  } catch (error) {
                    // console.error('Failed to save node position:', error);
                    debug('Failed to save node position', { draggedNodeId, error });
                  }
                }
                draggedNodeRef.current = null;
              }, 50);
            }
          });

          networkRef.current.on('hoverNode', (params) => {
            if (!edgesDataSetRef.current) return;
            isHoveringRef.current = true;
            // Reset any previously colored edges
            try {
              const idsToReset = Array.from(prevHoverGreenEdgeIdsRef.current);
              if (idsToReset.length > 0) {
                const defaultColor = { inherit: 'from', opacity: 0.7, hover: '#2B7CE9', highlight: '#2B7CE9' };
                edgesDataSetRef.current.update(idsToReset.map((id) => ({ id, color: defaultColor })));
                prevHoverGreenEdgeIdsRef.current.clear();
              }
            } catch {}
            try {
              const currentEdges = edgesDataSetRef.current.get();
              const { edgesUp, edgesDown } = findConnectedElements(params.node, currentEdges);
              // Color parents (upward) edges green
              const greenColor = { inherit: 'from', opacity: 0.7, hover: '#2e7d32', highlight: '#2e7d32' };
              const upIds = Array.from(edgesUp);
              if (upIds.length > 0) {
                edgesDataSetRef.current.update(upIds.map((id) => ({ id, color: greenColor })));
                prevHoverGreenEdgeIdsRef.current = new Set(upIds);
              }
              // Select both sets without using spread on Set (for older TS targets)
              const combinedSet = new Set<string | number>();
              edgesUp.forEach((id) => combinedSet.add(id));
              edgesDown.forEach((id) => combinedSet.add(id));
              networkRef.current?.setSelection({ nodes: [], edges: Array.from(combinedSet) });
            } catch {}
          });

          networkRef.current.on('blurNode', () => {
            // Restore edge colors and clear selection
            try {
              const idsToReset = Array.from(prevHoverGreenEdgeIdsRef.current);
              if (edgesDataSetRef.current && idsToReset.length > 0) {
                const defaultColor = { inherit: 'from', opacity: 0.7, hover: '#2B7CE9', highlight: '#2B7CE9' };
                edgesDataSetRef.current.update(idsToReset.map((id) => ({ id, color: defaultColor })));
              }
              prevHoverGreenEdgeIdsRef.current.clear();
            } catch {}
            networkRef.current?.setSelection({ nodes: [], edges: [] });
            isHoveringRef.current = false;
          });

          networkRef.current.on('click', (params: any) => handleClick(params, 'view'));
          networkRef.current.on('oncontext', (params: any) => handleClick(params, 'edit'));

          networkRef.current.once('stabilizationIterationsDone', () => {
            networkRef.current?.setOptions({ physics: { enabled: false } });
          });
        }
      } catch (error) {
        // console.error('Error initializing network:', error);
        debug('Error initializing network', error);
        // Even if there's an error, try to create an empty network so buttons work
        if (networkContainer.current && !networkRef.current) {
          nodesDataSetRef.current = new DataSet([]);
          edgesDataSetRef.current = new DataSet([]);
          cleanupSearchItems = wireSearchItems();
          cleanupEdgeItems = wireEdgeItems();
          networkRef.current = new VisNetwork(
            networkContainer.current,
            { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current },
            options
          );

          // Ensure container does not show focus outline or steal focus
          try {
            networkContainer.current.setAttribute('tabindex', '-1');
            (networkContainer.current as HTMLElement).style.outline = 'none';
          } catch {}
          debug('Fallback empty Vis network instance created');
        }
      }
    };

    initializeNetwork();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        networkRef.current?.disableEditMode();
        setAddNodeMode(false);
        setAddEdgeMode(false);
        setDeleteMode(false);
        deleteModeRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      networkRef.current?.destroy();
      if (cleanupSearchItems) {
        try { cleanupSearchItems(); } catch {}
      }
      if (cleanupEdgeItems) {
        try { cleanupEdgeItems(); } catch {}
      }
    };
  }, [options, handleClick, wireSearchItems, wireEdgeItems]);

  // Listen for relationship changes from other components (e.g., GoalMenu)
  useEffect(() => {
    const handler = () => {
      debug('Received network:relationships-changed event; triggering full refresh');
      refreshFullNetwork().catch((err) => {
        // console.error('Network full refresh failed:', err);
        debug('Network full refresh failed (from event)', err);
      });
    };
    window.addEventListener('network:relationships-changed', handler as EventListener);
    return () => window.removeEventListener('network:relationships-changed', handler as EventListener);
  }, [refreshFullNetwork]);

  // Resize observer so the network always fits the container
  useEffect(() => {
    if (networkContainer.current && networkRef.current) {
      const observer = createResizeObserver(() => {
        networkRef.current?.fit();
      });
      observer.observe(networkContainer.current);
      return () => observer.disconnect();
    }
  }, []);

  // Toggle delete mode
  const handleDeleteMode = () => {
    if (networkRef.current) {
      const next = !deleteMode;
      debug('DeleteMode button clicked', { prev: deleteMode, next, refBefore: deleteModeRef.current });
      deleteModeRef.current = !deleteMode;
      setDeleteMode(!deleteMode);
      setAddNodeMode(false);
      setAddEdgeMode(false);
      debug('DeleteMode state updated', { refAfter: deleteModeRef.current });
    } else {
      //console.log('No network');
    }
  };

  // Toggle edge-add mode
  const handleAddEdgeMode = () => {
    if (networkRef.current) {
      const next = !addEdgeMode;
      debug('AddEdgeMode button clicked', { prev: addEdgeMode, next });
      setAddEdgeMode(!addEdgeMode);
      setAddNodeMode(false);
      setDeleteMode(false);
      deleteModeRef.current = false;
      if (next) {
        debug('Enabling Vis addEdgeMode');
        networkRef.current.addEdgeMode();
      } else {
        debug('Disabling Vis edit mode');
        networkRef.current.disableEditMode();
      }
    } else {
      //console.log('No network');
    }
  };

  // Add node: open the GoalMenu, then compute its position using calculateNewNodePosition
  const handleAddNode = () => {
    if (networkRef.current && nodesDataSetRef.current) {
      setAddNodeMode(true);
      setAddEdgeMode(false);
      setDeleteMode(false);
      deleteModeRef.current = false;
      // GoalMenu creates a Goal object
      GoalMenu.open({} as Goal, 'create', async (newGoal: Goal) => {
        // GoalMenu returns a new Goal object.
        const newNode = formatNetworkNode(newGoal); // Use server response, then re-sync from server below
        // Get existing nodes from the DataSet and calculate a new position
        const existingNodes = nodesDataSetRef.current?.get() || [];
        const position = calculateNewNodePosition(newNode, existingNodes);
        newNode.x = position.x;
        newNode.y = position.y;
        nodesDataSetRef.current?.add(newNode);
        networkRef.current?.redraw();

        // Refresh edges for the new node (in case relationships were created in GoalMenu)
        if (newGoal.id) {
          await refreshEdgesForNode(newGoal.id);

          // Persist the new node position
          try {
            await saveNodePosition(newGoal.id, position.x, position.y);
          } catch (error) {
            // console.error('Failed to save new node position:', error);
            debug('Failed to save new node position', { nodeId: newGoal.id, error });
          }

          // Fit the view to show the new node
          setTimeout(() => {
            networkRef.current?.fit({
              nodes: [newGoal.id],
              animation: {
                duration: 500,
                easingFunction: 'easeInOutQuad'
              }
            });
          }, 100);

          // Re-sync from server to ensure normalization and styles are authoritative
          await refreshNodeById(newGoal.id);
        }

        setAddNodeMode(false);
      });
    }
  };

  // Create a relationship edge between two nodes
  async function handleCreateRelationship(fromId: number, toId: number, relationshipType: RelationshipType) {
    try {
      debug('handleCreateRelationship called', { fromId, toId, relationshipType });
      // Disallow self-relationships
      if (fromId === toId) {
        try {
          alert('Cannot create a relationship from a node to itself.');
        } catch {}
        debug('Blocked self-relationship attempt', { fromId, toId, relationshipType });
        setDialogMode(null);
        setPendingRelationship(null);
        setTimeout(() => {
          try { networkRef.current?.addEdgeMode(); } catch {}
        }, 100);
        return;
      }
      const fromNode = nodesDataSetRef.current?.get(fromId);
      const toNode = nodesDataSetRef.current?.get(toId);
      if (!fromNode || !toNode) {
        // console.error('Could not find goals for relationship');
        debug('Could not find goals for relationship', { fromId, toId, fromNode: !!fromNode, toNode: !!toNode });
        setTimeout(() => {
          if (networkRef.current) {
            networkRef.current.addEdgeMode();
            debug('Re-enabled Vis addEdgeMode after missing node');
          }
        }, 100);
        return;
      }
      const error = validateRelationship(fromNode, toNode, relationshipType);
      if (error) {
        alert(error);
        debug('Relationship validation error', { error, fromId, toId, relationshipType });
        setDialogMode(null);
        setPendingRelationship(null);
        setTimeout(() => {
          if (networkRef.current) {
            networkRef.current.addEdgeMode();
            debug('Re-enabled Vis addEdgeMode after validation error');
          }
        }, 100);
        return;
      }
      await createRelationship(fromId, toId, relationshipType);
      debug('createRelationship API success', { fromId, toId, relationshipType });
      const newEdge: NetworkEdge = {
        from: fromId,
        to: toId,
        relationship_type: relationshipType,
        id: `${fromId}-${toId}`
      };
      edgesDataSetRef.current?.add(newEdge);
      debug('Added new edge to DataSet', newEdge);
      // Immediately recompute and apply edge styles for consistency
      try {
        const nodes = (nodesDataSetRef.current?.get() || []) as NetworkNode[];
        const edgesAll = (edgesDataSetRef.current?.get() || []) as NetworkEdge[];
        const styled = formatEdgesForGraph(nodes, edgesAll);
        edgesDataSetRef.current?.update(styled);
        debug('Recomputed edge styles after relationship creation');
      } catch (e) {
        debug('Failed to recompute edge styles after relationship creation', e);
      }
      // Escalate to full refresh to avoid stale edges across the graph
      try {
        window.dispatchEvent(new CustomEvent('network:relationships-changed', { detail: { fromId, toId, relationshipType } }));
        debug('Dispatched relationships-changed event');
      } catch (e) { /* no-op */ }
    } catch (err) {
      // console.error('Error creating relationship:', err);
      debug('Error creating relationship', err);
    }
    setDialogMode(null);
    setPendingRelationship(null);
    debug('Relationship dialog closed and state cleared');
    setTimeout(() => {
      if (networkRef.current) {
        networkRef.current.addEdgeMode();
        debug('Re-enabled Vis addEdgeMode after relationship flow');
      }
    }, 100);
  }

  // (moved refreshEdgesForNode earlier)

  // Helper function to check if a node still exists on the backend
  const checkNodeExists = async (nodeId: number): Promise<boolean> => {
    try {
      await privateRequest(`goals/${nodeId}`);
      return true;
    } catch (error) {
      // If we get a 404 or similar error, the node was deleted
      return false;
    }
  };

  // (removed unused helper removeNodeFromNetwork)

  // Add this new function inside NetworkView component:
  const handleReorganizeNetwork = async () => {
    if (!networkRef.current || !nodesDataSetRef.current || !edgesDataSetRef.current) return;

    try {
      const currentNodes = nodesDataSetRef.current.get();
      const currentEdges = edgesDataSetRef.current.get();

      // Reset positions to null in the DataSet first
      const nodesWithNullPositions = currentNodes.map(node => ({
        ...node,
        position_x: null,
        position_y: null,
        x: undefined,  // Clear vis-network positions too
        y: undefined
      }));

      // Update the network data with null positions
      nodesDataSetRef.current.update(nodesWithNullPositions);

      // Recalculate all positions with fresh data
      const reorganizedData = await buildHierarchy({
        nodes: nodesWithNullPositions,
        edges: currentEdges
      });

      // Update the network with new positions
      nodesDataSetRef.current.update(reorganizedData.nodes);
      edgesDataSetRef.current.update(reorganizedData.edges);

      // Optional: fit the view to show all nodes
      networkRef.current.fit();
    } catch (error) {
      // console.error('Error reorganizing network:', error);
      debug('Error reorganizing network', error);
    }
  };

  const collectEdgesForNodes = useCallback((ids: number[]) => {
    const s = new Set(ids);
    const result = new Set<string>();
    (edgeItems || []).forEach((e) => {
      const from = (e as any).from as number;
      const to = (e as any).to as number;
      if (s.has(from) && s.has(to)) {
        result.add(`${from}-${to}`);
      }
    });
    return Array.from(result);
  }, [edgeItems]);

  const issueRows = useMemo(() => {
    type IssueType = 'root' | 'leaf' | 'pair' | 'cycle' | 'triangle';
    type IssueRowNode = { kind: 'node', key: string, id: number, name: string, types: IssueType[] };
    type IssueRowCycleGroup = { kind: 'cycleGroup', key: string, ids: number[], names: string[] };
    const typeOrder: IssueType[] = ['root', 'leaf', 'pair', 'cycle', 'triangle'];
    const nodeToTypes = new Map<number, Set<IssueType>>();

    const ensure = (id: number) => {
      if (!nodeToTypes.has(id)) nodeToTypes.set(id, new Set<IssueType>());
      return nodeToTypes.get(id)!;
    };

    // Roots and leaves
    insights.roots.forEach((id) => ensure(id).add('root'));
    insights.leaves.forEach((id) => {
      const goalType = insights.idToGoal.get(id)?.goal_type;
      if (goalType !== 'routine' && goalType !== 'event' && goalType !== 'task' && goalType !== 'achievement') {
        ensure(id).add('leaf');
      }
    });

    // Mutual pairs
    insights.mutualPairs.forEach(([a, b]) => {
      ensure(a).add('pair');
      ensure(b).add('pair');
    });

    // Cycles (SCCs ≥ 3)
    insights.sccs.forEach((comp) => {
      comp.forEach((id) => ensure(id).add('cycle'));
    });

    // Triangles
    insights.triangles.forEach(([a, b, c]) => {
      // Normalize triangles as cycles in suggestions
      ensure(a).add('cycle');
      ensure(b).add('cycle');
      ensure(c).add('cycle');
    });

    // Self-loop cycles (size-1 cycles) - valid cycles only if an explicit self edge exists
    insights.selfLoopNodes.forEach((id) => {
      ensure(id).add('cycle');
    });

    // Precompute nodes that belong to any cycle group (SCC>=3 or triangle) to suppress per-node cycle chips
    const preGroupKey = (ids: number[]) => ids.slice().sort((x, y) => x - y).join('-');
    const preGroupsSet = new Set<string>();
    const allGroupNodesForSuppression = new Set<number>();
    insights.sccs.forEach((comp) => {
      const key = preGroupKey(comp);
      if (!preGroupsSet.has(key)) {
        preGroupsSet.add(key);
        comp.forEach((id) => allGroupNodesForSuppression.add(id));
      }
    });
    insights.triangles.forEach(([a, b, c]) => {
      const unique = Array.from(new Set([a, b, c]));
      if (unique.length < 3) return;
      const key = preGroupKey(unique);
      if (!preGroupsSet.has(key)) {
        preGroupsSet.add(key);
        unique.forEach((id) => allGroupNodesForSuppression.add(id));
      }
    });

    // Build sorted node rows (dedupe: triangle => cycle)
    let nodeRows: IssueRowNode[] = Array.from(nodeToTypes.entries())
      .map(([id, types]) => {
        const normalized = new Set<IssueType>();
        types.forEach((t) => normalized.add(t === 'triangle' ? 'cycle' : t));
        const ordered = typeOrder.filter((t) => normalized.has(t));
        let filteredOrdered = ordered.filter((t) => t !== 'triangle');
        // Suppress 'cycle' chip on node rows if node is represented in a cycle group and has no self-loop
        if (filteredOrdered.includes('cycle') && allGroupNodesForSuppression.has(id) && !insights.selfLoopNodes.has(id)) {
          filteredOrdered = filteredOrdered.filter((t) => t !== 'cycle');
        }
        return {
          kind: 'node' as const,
          key: `issue-node-${id}`,
          id,
          name: insights.idToGoal.get(id)?.name || `Goal ${id}`,
          types: filteredOrdered as IssueType[]
        } as IssueRowNode;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    // Remove node rows that have no suggestion types left
    const beforeFilterCount = nodeRows.length;
    nodeRows = nodeRows.filter((r) => (r.types && r.types.length > 0));
    try {
      if (beforeFilterCount !== nodeRows.length) {
        debug('Filtered empty-type node suggestions', { before: beforeFilterCount, after: nodeRows.length });
      }
    } catch {}

    // Log reasons for nodes marked as cycle
    try {
      const cycleNodesWithReasons = nodeRows
        .filter((r) => (r.types || []).includes('cycle'))
        .map((r) => {
          const inScc = insights.sccs.some((g) => g.includes(r.id));
          const inTriangle = insights.triangles.some(([a, b, c]) => a === r.id || b === r.id || c === r.id);
          const hasSelfLoop = insights.selfLoopNodes.has(r.id);
          return {
            id: r.id,
            name: r.name,
            inScc,
            inTriangle,
            hasSelfLoop
          };
        });
      debug('Cycle node rows (reasons)', cycleNodesWithReasons.slice(0, 50));
      const suspiciousSingles = cycleNodesWithReasons.filter((x) => !x.inScc && !x.inTriangle && !x.hasSelfLoop);
      if (suspiciousSingles.length > 0) {
        debug('Suspicious cycle nodes (no SCC/triangle/self-loop)', suspiciousSingles);
      }
    } catch {}

    // Build grouped cycle rows from SCCs and Triangles, deduped by id-set key
    const groupKey = (ids: number[]) => ids.slice().sort((x, y) => x - y).join('-');
    const groupsSet = new Set<string>();
    const groups: number[][] = [];

    insights.sccs.forEach((comp) => {
      const key = groupKey(comp);
      if (!groupsSet.has(key)) {
        groupsSet.add(key);
        groups.push(comp.slice().sort((x, y) => x - y));
      }
    });
    insights.triangles.forEach(([a, b, c]) => {
      // Deduplicate ids within a triangle to prevent degenerate groups
      const unique = Array.from(new Set([a, b, c]));
      if (unique.length < 3) return; // skip non-3-node groups
      const key = groupKey(unique);
      if (!groupsSet.has(key)) {
        groupsSet.add(key);
        groups.push(unique.slice().sort((x, y) => x - y));
      }
    });

    try {
      debug('Cycle groups (raw)', {
        count: groups.length,
        sizesSample: groups.slice(0, 10).map((g) => g.length),
        sample: groups.slice(0, 5)
      });
    } catch {}

    const filteredGroups = groups.filter((ids) => ids.length >= 2 || (ids.length === 1 && insights.selfLoopNodes.has(ids[0])));
    try {
      const singles = filteredGroups.filter((g) => g.length === 1);
      if (singles.length > 0) {
        debug('Filtered groups contain singles (should be self-loops only)', {
          singles,
          selfLoopNodes: Array.from(insights.selfLoopNodes)
        });
      }
      debug('Cycle groups (filtered)', {
        count: filteredGroups.length,
        sizesSample: filteredGroups.slice(0, 10).map((g) => g.length),
        sample: filteredGroups.slice(0, 5)
      });
    } catch {}

    const cycleGroupRows: IssueRowCycleGroup[] = filteredGroups.map((ids) => ({
      kind: 'cycleGroup' as const,
      key: `cycle-group-${groupKey(ids)}`,
      ids,
      names: ids.map((id) => insights.idToGoal.get(id)?.name || `Goal ${id}`)
    } as IssueRowCycleGroup));

    return ([] as Array<IssueRowNode | IssueRowCycleGroup>).concat(cycleGroupRows, nodeRows);
  }, [insights]);

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 65px)', overflow: 'hidden' }}>
      <div ref={networkContainer} style={{ height: '100%', width: '100%', outline: 'none' }} tabIndex={-1} />

      <div style={{ position: 'absolute', top: '1rem', right: '1rem', width: 'min(420px, 40vw)', zIndex: 2 }}>
        <SearchBar
          items={filteredSearchItems}
          keys={['name', 'description']}
          placeholder="Find a goal…"
          debounceMs={200}
          excludeGoalTypes={['event']}
          onChange={(q) => {
            // Only auto-focus when the user changes the input
            shouldAutoFocusRef.current = true;
          }}
          onResults={(results, ids) => {
            setSearchResults(results || []);
            if (!ids || ids.length === 0) {
              networkRef.current?.selectNodes([]);
              lastFocusedIdRef.current = null;
              shouldAutoFocusRef.current = false;
              return;
            }
            if (shouldAutoFocusRef.current) {
              const id = ids[0];
              if (id !== lastFocusedIdRef.current && nodesDataSetRef.current?.get(id)) {
                focusNode(id);
                lastFocusedIdRef.current = id;
              }
              // Prevent re-focusing unless input changes again
              shouldAutoFocusRef.current = false;
            }
          }}
        />

        {searchResults && searchResults.length > 0 && (
          <div
            style={{
              marginTop: '0.5rem',
              background: '#ffffff',
              border: '1px solid #e0e0e0',
              borderRadius: '10px',
              boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
              overflow: 'hidden'
            }}
            role="listbox"
            aria-label="Search results"
          >
            <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: '1fr', gap: '8px', maxHeight: '40vh', overflowY: 'auto' }}>
              {searchResults.map((r, idx) => {
                const g = r.item;
                const { backgroundColor, textColor, border, borderColor } = getGoalStyle(g);
                return (
                  <div
                    key={`res-${g.id}-${idx}`}
                    onClick={() => {
                      if (g.id) {
                        shouldAutoFocusRef.current = false;
                        lastFocusedIdRef.current = g.id;
                        focusNode(g.id);
                      }
                    }}
                    role="option"
                    aria-selected={lastFocusedIdRef.current === g.id}
                    tabIndex={0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: border || `2px solid ${borderColor}`,
                      background: backgroundColor,
                      color: textColor,
                      cursor: 'pointer'
                    }}
                  >
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: borderColor,
                        flex: '0 0 auto'
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <span
                        className="goal-type-badge"
                        style={{
                          backgroundColor: `${backgroundColor}20`,
                          display: 'inline-block',
                          maxWidth: '100%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {g.name}
                      </span>
                      <div style={{ opacity: 0.9, fontSize: '12px', lineHeight: 1.2, marginTop: '2px' }}>
                        {g.goal_type}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: '0.5rem' }}>
          <Accordion
            disableGutters
            expanded={showSuggestions}
            onChange={(_, expanded) => setShowSuggestions(expanded)}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{
                minHeight: 'auto',
                px: '0.75rem',
                py: '0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                background: '#ffffff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                '& .MuiAccordionSummary-content': {
                  margin: 0,
                  alignItems: 'center'
                }
              }}
            >
              <Typography variant="body2" style={{ fontSize: '0.95rem' }}>Suggestions</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <div style={{ display: 'grid', gap: '8px' }}>
                <List dense style={{ maxHeight: 288, overflowY: 'auto' }}>
                  {issueRows.map((row) => {
                    const isCycleGroup = (row as any).kind === 'cycleGroup';
                    if (isCycleGroup) {
                      const group = row as any;
                      return (
                        <ListItem
                          key={group.key}
                          button
                          onClick={() => {
                            const network: any = networkRef.current as any;
                            const ids: number[] = group.ids || [];
                            if (!ids || ids.length === 0) return;
                            if (!network || !network.body) { focusNode(ids[0]); return; }
                            try {
                              const edges = collectEdgesForNodes(ids);
                              network.setSelection({ nodes: ids, edges });
                              network.fit({ nodes: ids, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
                            } catch (e) { debug('cycle group focus failed', e); }
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                            <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              {(group.ids || []).map((id: number) => {
                                const goal = insights.idToGoal.get(id) as Goal | undefined;
                                const { backgroundColor } = goal ? getGoalStyle(goal) : { backgroundColor: '#666666' };
                                const name = goal?.name || `Goal ${id}`;
                                return (
                                  <span
                                    key={`cycle-group-name-${id}`}
                                    className="goal-type-badge"
                                    style={{
                                      display: 'inline-block',
                                      padding: '2px 8px',
                                      borderRadius: '999px',
                                      backgroundColor: `${backgroundColor}20`,
                                      fontWeight: 600,
                                      maxWidth: '100%',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis'
                                    }}
                                    title={name}
                                  >
                                    {name}
                                  </span>
                                );
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <div
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  lineHeight: 1.5,
                                  background: '#ffebee',
                                  color: '#b71c1c',
                                  flex: '0 0 auto'
                                }}
                                aria-label="Cycle tag"
                              >
                                Cycle
                              </div>
                            </div>
                          </div>
                        </ListItem>
                      );
                    }
                    const node = row as any;
                    return (
                      <ListItem
                        key={node.key}
                        button
                        onClick={() => {
                          const network: any = networkRef.current as any;
                          if (!network || !network.body) { focusNode(node.id); return; }
                          try { network.setSelection({ nodes: [node.id], edges: [] }); network.fit({ nodes: [node.id], animation: { duration: 400, easingFunction: 'easeInOutQuad' } }); } catch (e) { debug('issue focus failed', e); }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                            <span
                              className="goal-type-badge"
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                backgroundColor: `${((insights.idToGoal.get(node.id) && getGoalStyle(insights.idToGoal.get(node.id) as Goal).backgroundColor) || '#666666')}20`,
                                fontWeight: 600,
                                maxWidth: '100%',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                              title={node.name}
                            >
                              {node.name}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {(node.types || []).map((t: string) => (
                              <div
                                key={`${node.key}-${t}`}
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  lineHeight: 1.5,
                                  background: t === 'root' ? '#e3f2fd'
                                    : t === 'leaf' ? '#e8f5e9'
                                    : t === 'pair' ? '#fff3e0'
                                    : (t === 'cycle' || t === 'triangle') ? '#ffebee'
                                    : '#ede7f6',
                                  color: t === 'root' ? '#0d47a1'
                                    : t === 'leaf' ? '#1b5e20'
                                    : t === 'pair' ? '#e65100'
                                    : (t === 'cycle' || t === 'triangle') ? '#b71c1c'
                                    : '#4a148c',
                                  flex: '0 0 auto'
                                }}
                                aria-label={`${t} tag`}
                              >
                                {t === 'root' ? 'No Parents'
                                  : t === 'leaf' ? 'No Children'
                                  : t === 'pair' ? 'Mutual'
                                  : (t === 'cycle' || t === 'triangle') ? 'Cycle'
                                  : 'Cycle'}
                              </div>
                            ))}
                          </div>
                        </div>
                      </ListItem>
                    );
                  })}
                </List>
              </div>
            </AccordionDetails>
          </Accordion>
        </div>
      </div>

      <Button
        variant="contained"
        color="primary"
        style={{
          position: 'absolute',
          top: '1rem',
          left: '1rem',
          minWidth: '32px',
          width: '32px',
          height: '32px',
          padding: '0',
          borderRadius: '4px',
          backgroundColor: addNodeMode ? '#e8f5e9' : '#f3f3f3',
          border: '1px solid #c1c1c1',
          boxShadow: 'none'
        }}
        onClick={handleAddNode}
      >
        <AddIcon style={{ fontSize: '20px', color: addNodeMode ? '#2e7d32' : '#666666' }} />
      </Button>

      <Button
        variant="contained"
        color="primary"
        style={{
          position: 'absolute',
          top: '4rem',
          left: '1rem',
          minWidth: '32px',
          width: '32px',
          height: '32px',
          padding: '0',
          borderRadius: '4px',
          backgroundColor: addEdgeMode ? '#e3f2fd' : '#f3f3f3',
          border: '1px solid #c1c1c1',
          boxShadow: 'none'
        }}
        onClick={handleAddEdgeMode}
      >
        <AddLinkIcon style={{ fontSize: '20px', color: addEdgeMode ? '#1976d2' : '#666666' }} />
      </Button>

      <Button
        variant="contained"
        color="primary"
        style={{
          position: 'absolute',
          top: '7rem',
          left: '1rem',
          minWidth: '32px',
          width: '32px',
          height: '32px',
          padding: '0',
          borderRadius: '4px',
          backgroundColor: deleteMode ? '#ffebee' : '#f3f3f3',
          border: '1px solid #c1c1c1',
          boxShadow: 'none'
        }}
        onClick={handleDeleteMode}
      >
        <DeleteIcon style={{ fontSize: '20px', color: deleteMode ? '#f44336' : '#666666' }} />
      </Button>

      <Button
        variant="contained"
        color="primary"
        style={{
          position: 'absolute',
          top: '10rem',
          left: '1rem',
          minWidth: '32px',
          width: '32px',
          height: '32px',
          padding: '0',
          borderRadius: '4px',
          backgroundColor: '#f3f3f3',
          border: '1px solid #c1c1c1',
          boxShadow: 'none'
        }}
        onClick={handleReorganizeNetwork}
        title="Reorganize Network"
      >
        <RefreshIcon style={{ fontSize: '20px', color: '#666666' }} />
      </Button>

    </div>
  );
};

export default NetworkView;
