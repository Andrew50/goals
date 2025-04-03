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
import { NetworkNode, NetworkEdge, Goal, RelationshipType } from '../../types/goals';
import GoalMenu from '../../shared/components/GoalMenu';
import { privateRequest, createRelationship } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import {
  buildHierarchy,
  saveNodePosition,
  calculateNewNodePosition
} from './buildHierarchy';
import { getGoalColor } from '../../shared/styles/colors';
import { validateRelationship } from '../../shared/utils/goalValidation';

const formatNetworkNode = (goal: Goal, inlineUpdate: boolean = false): NetworkNode => {
  let localGoal: Goal;
  if (!inlineUpdate) {
    localGoal = goalToLocal(goal);
  } else {
    localGoal = goal;
  }
  return {
    ...localGoal,
    label: localGoal.name,
    title: `${localGoal.name} (${localGoal.goal_type})`,
    color: getGoalColor(localGoal)
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
      const node = nodesDataSetRef.current.get(nodeId);
      if (node) {
        GoalMenu.open(node, goalDialogMode, (goal: Goal) => {
          // After editing/viewing, update the node's properties
          const updatedNode = formatNetworkNode(goal);
          nodesDataSetRef.current?.update(updatedNode);
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
        color: '#ffffff',
        bold: { color: '#ffffff', size: 14, mod: 'bold' }
      },
      widthConstraint: { maximum: 150 },
      fixed: { x: false, y: false },
      borderWidth: 0,
      chosen: false,
      color: {
        border: 'transparent',
        highlight: { border: 'transparent', background: '#ffffff' },
        hover: { border: 'transparent', background: '#f0f0f0' }
      }
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

  // Initialize the network once on mount
  useEffect(() => {
    const initializeNetwork = async () => {
      try {
        // Fetch initial data and format nodes
        const response = await privateRequest<{ nodes: NetworkNode[], edges: NetworkEdge[] }>('network');
        response.nodes = response.nodes.map(node => formatNetworkNode(node));
        // Calculate positions and styling using the full hierarchy algorithm
        const formattedData = await buildHierarchy(response);

        // Create DataSets for nodes and edges (used by vis‑network)
        nodesDataSetRef.current = new DataSet(formattedData.nodes);
        edgesDataSetRef.current = new DataSet(formattedData.edges);

        // Create the network instance
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
      GoalMenu.open({} as Goal, 'create', (goal: Goal) => {
        const newNode = formatNetworkNode(goal, true);
        // Get existing nodes from the DataSet and calculate a new position
        const existingNodes = nodesDataSetRef.current?.get() || [];
        const position = calculateNewNodePosition(newNode, existingNodes);
        newNode.x = position.x;
        newNode.y = position.y;
        nodesDataSetRef.current?.add(newNode);
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
