import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DataSet, Network as VisNetwork } from 'vis-network/standalone';
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddLinkIcon from '@mui/icons-material/AddLink';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { createResizeObserver } from '../../shared/utils/resizeObserver';
import { NetworkNode, NetworkEdge, Goal, RelationshipType, ApiGoal } from '../../types/goals'; // Import ApiGoal
import GoalMenu from '../../shared/components/GoalMenu';
import { privateRequest, createRelationship } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import {
  buildHierarchy,
  saveNodePosition,
  calculateNewNodePosition
} from './buildHierarchy';
import { getGoalStyle } from '../../shared/styles/colors';
import { validateRelationship } from '../../shared/utils/goalValidation';

// Expect ApiGoal from the backend, return NetworkNode (which extends Goal)
const formatNetworkNode = (localGoal: Goal): NetworkNode => {
  const { backgroundColor, border, textColor, borderColor } = getGoalStyle(localGoal);

  // Extract border width from border string (e.g., '3px solid #d32f2f' -> 3)
  const borderWidthMatch = border.match(/(\d+)px/);
  const borderWidth = borderWidthMatch ? parseInt(borderWidthMatch[1], 10) : 0;

  return {
    ...localGoal,
    label: localGoal.name,
    title: `${localGoal.name} (${localGoal.goal_type})`,
    color: {
      background: backgroundColor,
      border: borderColor,
      highlight: { background: backgroundColor, border: borderColor },
      hover: { background: backgroundColor, border: borderColor }
    },
    borderWidth,
    font: { color: textColor }
  };
};

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
  const draggedNodeRef = useRef<number | null>(null);

  // Handle clicks (and context clicks) to open the GoalMenu or perform deletion
  const handleClick = useCallback((params: any, goalDialogMode: "edit" | "view") => {
    if (!networkRef.current) return;
    params.event.preventDefault();

    if (addEdgeMode) return; // Do not open menu in edge mode

    if (deleteModeRef.current) {
      if (params.nodes.length > 0) {
        // We'll handle this after handleDeleteNode is defined
        const nodeId = params.nodes[0];
        if (networkRef.current && nodesDataSetRef.current && edgesDataSetRef.current) {
          privateRequest('goals/' + nodeId, 'DELETE')
            .then(() => {
              nodesDataSetRef.current?.remove(nodeId);
              const currentEdges = edgesDataSetRef.current?.get();
              currentEdges?.forEach(edge => {
                if (edge.from === nodeId || edge.to === nodeId) {
                  edgesDataSetRef.current?.remove(edge.id);
                }
              });
            })
            .catch(error => {
              console.error('Failed to delete node:', error);
            });
        }
      } else if (params.edges.length > 0) {
        // We'll handle this after handleDeleteEdge is defined
        const edgeId = params.edges[0];
        if (edgesDataSetRef.current) {
          const [fromId, toId] = edgeId.split('-').map(Number);
          privateRequest(`goals/relationship/${fromId}/${toId}`, 'DELETE')
            .then(() => {
              edgesDataSetRef.current?.remove(edgeId);
            })
            .catch(error => {
              console.error('Failed to delete edge:', error);
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
          console.log('[Network] onSuccess priority:', updatedGoal.priority);

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
  }, [addEdgeMode]);

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
      keyboard: { enabled: true, bindToWindow: false }
    },
    manipulation: {
      enabled: false,
      addNode: true,
      addEdge: async function (data: any, callback: Function) {
        try {
          setPendingRelationship({ from: data.from, to: data.to });
          setDialogMode('relationship');
          callback(data);
        } catch (err) {
          console.error('Edge creation error:', err);
          callback(null);
        }
      },
      initiallyActive: false,
      editEdge: false,
      deleteNode: true,
      deleteEdge: true
    }
  }), []);

  // Helper: Given a node ID, find connected elements (for hover highlighting)
  const findConnectedElements = (nodeId: number, edges: NetworkEdge[]): { nodes: Set<number>, edges: Set<string> } => {
    const visited = new Set<number>();
    const connectedEdges = new Set<string>();

    const traverseUpward = (currentId: number) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      edges.forEach(edge => {
        if (edge.to === currentId) {
          connectedEdges.add(`${edge.from}-${edge.to}`);
          traverseUpward(edge.from);
        }
      });
    };

    const traverseDownward = (currentId: number) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      edges.forEach(edge => {
        if (edge.from === currentId) {
          connectedEdges.add(`${edge.from}-${edge.to}`);
          traverseDownward(edge.to);
        }
      });
    };

    visited.clear();
    traverseUpward(nodeId);
    visited.clear();
    traverseDownward(nodeId);

    return { nodes: visited, edges: connectedEdges };
  };

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
  }, []);

  // Full network refresh: re-fetch nodes+edges, preserve x/y when possible, and redraw
  const refreshFullNetwork = useCallback(async () => {
    if (!nodesDataSetRef.current || !edgesDataSetRef.current) return;
    try {
      const currentNodes = nodesDataSetRef.current.get();
      const byId = new Map(currentNodes.map((n: any) => [n.id, n]));

      const { nodes, edges } = await privateRequest<{ nodes: ApiGoal[], edges: NetworkEdge[] }>('network');

      const formattedNodes = nodes.map((n: ApiGoal) => {
        const local = goalToLocal(n);
        const formatted = formatNetworkNode(local);
        const existing = byId.get(formatted.id);
        return { ...formatted, x: existing?.x, y: existing?.y };
      });

      // Replace nodes (remove missing, add/update present)
      const serverIds = new Set(formattedNodes.map((n: any) => n.id));
      const toRemove = currentNodes.filter((n: any) => !serverIds.has(n.id)).map((n: any) => n.id);
      if (toRemove.length) nodesDataSetRef.current.remove(toRemove);
      nodesDataSetRef.current.update(formattedNodes);

      // Replace edges
      const formattedEdges = edges.map((e: any) => ({ ...e, id: `${e.from}-${e.to}` }));
      const currentEdges = edgesDataSetRef.current.get();
      const serverEdgeIds = new Set(formattedEdges.map((e: any) => e.id));
      const edgesToRemove = currentEdges.filter((e: any) => !serverEdgeIds.has(e.id)).map((e: any) => e.id);
      if (edgesToRemove.length) edgesDataSetRef.current.remove(edgesToRemove);
      edgesDataSetRef.current.update(formattedEdges);

      networkRef.current?.redraw();
    } catch (e) {
      console.error('Failed to refresh full network:', e);
    }
  }, []);

  // Initialize the network once on mount
  useEffect(() => {
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

        // Create the network instance - always create it even with empty data
        if (networkContainer.current) {
          networkRef.current = new VisNetwork(
            networkContainer.current,
            { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current },
            options
          );

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
                    console.error('Failed to save node position:', error);
                  }
                }
                draggedNodeRef.current = null;
              }, 50);
            }
          });

          networkRef.current.on('hoverNode', (params) => {
            if (edgesDataSetRef.current) {
              const currentEdges = edgesDataSetRef.current.get();
              const { edges: connectedEdges } = findConnectedElements(params.node, currentEdges);
              networkRef.current?.setSelection({ nodes: [], edges: Array.from(connectedEdges) });
            }
          });

          networkRef.current.on('blurNode', () => {
            networkRef.current?.setSelection({ nodes: [], edges: [] });
          });

          networkRef.current.on('click', (params: any) => handleClick(params, 'view'));
          networkRef.current.on('oncontext', (params: any) => handleClick(params, 'edit'));

          networkRef.current.once('stabilizationIterationsDone', () => {
            networkRef.current?.setOptions({ physics: { enabled: false } });
          });
        }
      } catch (error) {
        console.error('Error initializing network:', error);
        // Even if there's an error, try to create an empty network so buttons work
        if (networkContainer.current && !networkRef.current) {
          nodesDataSetRef.current = new DataSet([]);
          edgesDataSetRef.current = new DataSet([]);
          networkRef.current = new VisNetwork(
            networkContainer.current,
            { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current },
            options
          );
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
    };
  }, [handleClick, options]);

  // Listen for relationship changes from other components (e.g., GoalMenu)
  useEffect(() => {
    const handler = () => {
      refreshFullNetwork().catch((err) => console.error('Network full refresh failed:', err));
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
      deleteModeRef.current = !deleteMode;
      setDeleteMode(!deleteMode);
      setAddNodeMode(false);
      setAddEdgeMode(false);
    } else {
      //console.log('No network');
    }
  };

  // Toggle edge-add mode
  const handleAddEdgeMode = () => {
    if (networkRef.current) {
      setAddEdgeMode(!addEdgeMode);
      setAddNodeMode(false);
      setDeleteMode(false);
      deleteModeRef.current = false;
      networkRef.current.addEdgeMode();
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
            console.error('Failed to save new node position:', error);
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
  const handleCreateRelationship = async (fromId: number, toId: number, relationshipType: RelationshipType) => {
    try {
      const fromNode = nodesDataSetRef.current?.get(fromId);
      const toNode = nodesDataSetRef.current?.get(toId);
      if (!fromNode || !toNode) {
        console.error('Could not find goals for relationship');
        return;
      }
      const error = validateRelationship(fromNode, toNode, relationshipType);
      if (error) {
        alert(error);
        setDialogMode(null);
        setPendingRelationship(null);
        return;
      }
      await createRelationship(fromId, toId, relationshipType);
      const newEdge: NetworkEdge = {
        from: fromId,
        to: toId,
        relationship_type: relationshipType as 'child' | 'queue',
        id: `${fromId}-${toId}`
      };
      edgesDataSetRef.current?.add(newEdge);
      // Escalate to full refresh to avoid stale edges across the graph
      try {
        window.dispatchEvent(new CustomEvent('network:relationships-changed', { detail: { fromId, toId, relationshipType } }));
      } catch (e) {}
    } catch (err) {
      console.error('Error creating relationship:', err);
    }
    setDialogMode(null);
    setPendingRelationship(null);
    setTimeout(() => {
      if (networkRef.current) {
        networkRef.current.addEdgeMode();
      }
    }, 100);
  };

  // Helper function to refresh edges for a specific node
  const refreshEdgesForNode = async (nodeId: number) => {
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
    } catch (error) {
      console.error('Failed to refresh edges for node:', nodeId, error);
    }
  };

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

  // Helper function to remove node and its edges from the network
  const removeNodeFromNetwork = (nodeId: number) => {
    if (nodesDataSetRef.current && edgesDataSetRef.current) {
      // Remove the node
      nodesDataSetRef.current.remove(nodeId);

      // Remove all edges connected to this node
      const currentEdges = edgesDataSetRef.current.get();
      const edgesToRemove = currentEdges
        .filter(edge => edge.from === nodeId || edge.to === nodeId)
        .map(edge => edge.id);

      if (edgesToRemove.length > 0) {
        edgesDataSetRef.current.remove(edgesToRemove);
      }
    }
  };

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
      console.error('Error reorganizing network:', error);
    }
  };

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <div ref={networkContainer} style={{ height: '100%', width: '100%' }} />

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

      <Dialog
        open={dialogMode === 'relationship'}
        onClose={() => {
          setDialogMode(null);
          setPendingRelationship(null);
        }}
      >
        <DialogTitle>Select Relationship Type</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="dense">
            <InputLabel>Relationship Type</InputLabel>
            <Select
              value={'child'} // You can bind this to local state if you wish to support changes
              onChange={(e) => {
                // Update relationship type if needed
              }}
            >
              <MenuItem value="child">Child</MenuItem>
              <MenuItem
                value="queue"
                disabled={
                  pendingRelationship && nodesDataSetRef.current
                    ? (() => {
                      const fromNode = nodesDataSetRef.current.get(pendingRelationship.from);
                      const toNode = nodesDataSetRef.current.get(pendingRelationship.to);
                      return fromNode?.goal_type !== 'achievement' || toNode?.goal_type !== 'task';
                    })()
                    : false
                }
              >
                Queue
              </MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogMode(null);
            setPendingRelationship(null);
          }}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pendingRelationship) {
                handleCreateRelationship(
                  pendingRelationship.from,
                  pendingRelationship.to,
                  'child' // or use a dynamic value if desired
                );
              }
            }}
            color="primary"
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default NetworkView;
