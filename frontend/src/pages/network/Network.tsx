import React, { useState, useEffect, useRef } from 'react';
import { Network as VisNetwork } from 'vis-network/standalone';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, Box, FormControlLabel, Checkbox } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddLinkIcon from '@mui/icons-material/AddLink';
import DeleteIcon from '@mui/icons-material/Delete';
import { createResizeObserver } from '../../shared/utils/resizeObserver';
import { Relationship, NetworkNode, NetworkEdge, Goal, RelationshipType } from '../../types/goals';
import GoalMenu from '../../shared/components/GoalMenu';
import { privateRequest, createRelationship } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import { buildHierarchy } from './buildHierarchy';
import { getGoalColor } from '../../shared/styles/colors';
import { validateRelationship } from '../../shared/utils/goalValidation';

interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

const formatNetworkNode = (goal: Goal, inlineUpdate: boolean = false): NetworkNode => {
  let localGoal: Goal
  if (!inlineUpdate) {
    localGoal = goalToLocal(goal);
  } else {
    localGoal = goal
  }
  return {
    ...localGoal,
    label: localGoal.name,
    title: localGoal.name + ' (' + localGoal.goal_type + ')',
    color: getGoalColor(localGoal)
  }
}

type DialogMode = 'create' | 'edit' | 'view' | 'relationship' | null;
const NetworkView: React.FC
  = () => {
    const [newRelationship, setNewRelationship] = useState<Relationship>({
      from_id: 0,
      to_id: 0,
      relationship_type: 'child'
    });
    const networkContainer = useRef<HTMLDivElement>(null);
    const networkRef = useRef<VisNetwork | null>(null);
    const [pendingRelationship, setPendingRelationship] = useState<{ from: number, to: number } | null>(null);
    const [networkData, setNetworkData] = useState<NetworkData | null>(null);
    const [dialogMode, setDialogMode] = useState<DialogMode>(null);
    const [addNodeMode, setAddNodeMode] = useState(false);
    const [addEdgeMode, setAddEdgeMode] = useState(false);
    const [deleteMode, setDeleteMode] = useState(false);
    const deleteModeRef = useRef(deleteMode);

    const findConnectedElements = (
      nodeId: number,
      edges: NetworkEdge[],
      visited: Set<number> = new Set(),
      connectedEdges: Set<string> = new Set()
    ): { nodes: Set<number>, edges: Set<string> } => {
      // Helper functions for directional traversal
      const traverseUpward = (currentId: number) => {
        if (visited.has(currentId)) return;
        visited.add(currentId);

        // Find parent relationships (where current node is the 'to' node)
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

        // Find child relationships (where current node is the 'from' node)
        edges.forEach(edge => {
          if (edge.from === currentId) {
            connectedEdges.add(`${edge.from}-${edge.to}`);
            traverseDownward(edge.to);
          }
        });
      };

      // Start from the hovered node and traverse both up and down
      visited.clear(); // Reset visited set before starting
      traverseUpward(nodeId);

      visited.clear(); // Reset visited set before downward traversal
      traverseDownward(nodeId);

      return { nodes: visited, edges: connectedEdges };
    };

    const handleClick = (params: any, goalDialogMode: "edit" | "view") => {
      if (!networkRef.current) {
        console.log('No network');
        return;
      }
      params.event.preventDefault();

      // Prevent opening GoalMenu in 'relationship' mode
      if (addEdgeMode) {
        return;
      }

      if (deleteModeRef.current) {
        if (params.nodes.length > 0) {
          handleDeleteNode(params.nodes[0]);
        } else if (params.edges.length > 0) {
          handleDeleteEdge(params.edges[0]);
        }
        return;
      }

      const nodeId = networkRef.current?.getNodeAt(params.pointer.DOM);
      if (nodeId && networkData) {
        const node = networkData.nodes.find(n => n.id === nodeId);
        if (node) {
          GoalMenu.open(node, goalDialogMode, (goal: Goal) => {
            fetchNetwork();
          });
        }
      }
    }

    const updateNetwork = async () => {
      const options = {
        nodes: {
          shape: 'box',
          margin: {
            top: 12,
            right: 12,
            bottom: 12,
            left: 12
          },
          font: {
            size: 14,
            color: '#ffffff',
            bold: {
              color: '#ffffff',
              size: 14,
              mod: 'bold'
            }
          },
          widthConstraint: {
            maximum: 150
          },
          fixed: {
            x: false,
            y: false
          },
          borderWidth: 0,
          chosen: false,
          color: {
            border: 'transparent',
            highlight: {
              border: 'transparent',
              background: undefined
            },
            hover: {
              border: 'transparent',
              background: undefined
            }
          }
        },
        edges: {
          arrows: { to: { enabled: true, scaleFactor: 0.5 } },
          smooth: {
            enabled: true,
            type: 'curvedCW',
            roundness: 0.2,
            forceDirection: 'radial'
          },
          width: 1.5,
          color: {
            inherit: 'from',
            opacity: 0.7
          }
        },
        physics: {
          enabled: true,
          solver: 'repulsion',
          repulsion: {
            nodeDistance: 250,     // Reduced from 350 for tighter spacing
            centralGravity: 0.1,   // Keep light pull to center
            springLength: 0,       // No spring force
            springConstant: 0,     // No spring force
            damping: 0.9,         // High damping to reduce movement
            avoidOverlap: 1.0
          },
          stabilization: {
            enabled: true,
            iterations: 1000,
            updateInterval: 100,
            fit: true
          },
          maxVelocity: 5,          // Very low max velocity
          minVelocity: 0.1,        // When to consider system stable
          timestep: 0.1            // Smaller timestep for more stable movement
        },
        interaction: {
          dragNodes: true,
          dragView: true,
          zoomView: true,
          hover: true,
          navigationButtons: false,
          keyboard: {
            enabled: true,
            bindToWindow: true
          }
        },
        bounds: {
          min: {
            x: -1000,
            y: -1000
          },
          max: {
            x: 1000,
            y: 1000
          }
        }
      } as const;

      if (networkContainer.current && networkData) {
        const formattedData = buildHierarchy(networkData);
        const network = new VisNetwork(
          networkContainer.current,
          formattedData,
          options
        );

        // Add hover event handlers
        network.on('hoverNode', (params) => {
          if (networkData) {
            const { edges: connectedEdges } = findConnectedElements(params.node, networkData.edges);
            network.setSelection({
              nodes: [],
              edges: Array.from(connectedEdges)
            });
          }
        });

        network.on('blurNode', () => {
          network.setSelection({ nodes: [], edges: [] });
        });

        network.on('click', (params: any) => handleClick(params, 'view'));
        network.on('oncontext', (params: any) => handleClick(params, 'edit'));
        networkRef.current = network;

        network.once('stabilizationIterationsDone', () => {
          network.setOptions({ physics: { enabled: false } });
        });
      }
    };
    useEffect(() => {
      const loadInitialData = async () => {
        await fetchNetwork();
        await updateNetwork();
      };
      setDeleteMode(false);
      setAddNodeMode(false);
      setAddEdgeMode(false);
      deleteModeRef.current = deleteMode;
      loadInitialData();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          if (networkRef.current) {
            networkRef.current.disableEditMode();
          }
          setAddNodeMode(false);
          setAddEdgeMode(false);
          setDeleteMode(false);
          deleteModeRef.current = false;
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        if (networkRef.current) {
          networkRef.current.destroy();
        }
      }
    }, []); // Only run on mount

    // Update network when networkData changes
    useEffect(() => {
      if (networkData) {
        let position: any;
        let scale: any;
        if (networkRef.current && networkRef.current.getViewPosition) {
          position = networkRef.current.getViewPosition()
          scale = networkRef.current.getScale()
        }
        updateNetwork();
        if (networkRef.current) {
          networkRef.current.moveTo({ position, scale, animation: false });
        }
      }
    }, [networkData]); // Only update when networkData changes

    const fetchNetwork = async () => {
      const response = await privateRequest<NetworkData>('network');
      response.nodes = response.nodes.map(node => formatNetworkNode(node))
      console.log(response);

      setNetworkData(response);
    };

    useEffect(() => {
      if (networkContainer.current && networkRef.current) {
        const observer = createResizeObserver(() => {
          networkRef.current?.fit();
        });

        observer.observe(networkContainer.current);
        return () => observer.disconnect();
      }
    }, []);

    const handleDeleteMode = () => {
      if (networkRef.current) {
        deleteModeRef.current = !deleteMode;
        setDeleteMode(!deleteMode);
        setAddNodeMode(false);
        setAddEdgeMode(false);
        console.log('Delete mode:', deleteModeRef.current);
      } else {
        console.log('No network');
      }
    }
    const handleAddEdgeMode = () => {
      if (networkRef.current) {
        setAddEdgeMode(!addEdgeMode);
        setAddNodeMode(false);
        setDeleteMode(false);
        deleteModeRef.current = false;
        networkRef.current.addEdgeMode();
      } else {
        console.log('No network');
      }
    }

    const handleAddNode = () => {
      if (networkRef.current && networkData) {
        setAddNodeMode(true);
        setAddEdgeMode(false);
        setDeleteMode(false);
        deleteModeRef.current = false;
        GoalMenu.open({} as Goal, 'create', (goal: Goal) => {
          const newNode = formatNetworkNode(goal, true);
          networkData.nodes.push(newNode);
          setNetworkData({ ...networkData });
          setAddNodeMode(false);
        });
      }
    };
    const handleDeleteEdge = async (edgeId: string) => {
      if (networkData) {
        const [fromId, toId] = edgeId.split('-').map(Number);
        const edge = networkData.edges.find(e => e.from === fromId && e.to === toId);
        if (!edge) return;

        await privateRequest(`goals/relationship/${fromId}/${toId}`, 'DELETE');

        setNetworkData({
          ...networkData,
          edges: networkData.edges.filter(e => !(e.from === fromId && e.to === toId))
        });
      }
    };

    const handleDeleteNode = async (nodeId: number) => {
      if (networkData) {
        const newNetworkData = {
          nodes: networkData.nodes.filter(n => n.id !== nodeId),
          edges: networkData.edges.filter(e => e.from !== nodeId && e.to !== nodeId)
        };
        await privateRequest('goals/' + nodeId, 'DELETE');
        setNetworkData(newNetworkData);
      }
    }

    const handleCreateRelationship = async (fromId: number, toId: number, relationshipType: RelationshipType) => {
      if (networkData) {
        const fromGoal = networkData.nodes.find(n => n.id === fromId);
        const toGoal = networkData.nodes.find(n => n.id === toId);

        if (!fromGoal || !toGoal) {
          console.error('Could not find goals for relationship');
          return;
        }

        // Validate the relationship
        const error = validateRelationship(fromGoal, toGoal, relationshipType);
        if (error) {
          // You might want to show this error in a more user-friendly way
          alert(error);
          setDialogMode(null);
          setPendingRelationship(null);
          updateNetwork();
          return;
        }

        await createRelationship(fromId, toId, relationshipType);
        const newEdge: NetworkEdge = {
          from: fromId,
          to: toId,
          relationship_type: relationshipType as 'child' | 'queue',
        };

        setNetworkData({
          ...networkData,
          edges: [...networkData.edges, newEdge]
        });
      }
      setDialogMode(null);
      setPendingRelationship(null);
      setTimeout(() => {
        if (networkRef.current) {
          networkRef.current.addEdgeMode();
        } else {
          console.log('No network');
        }
      }, 100);
    };

    return (
      <div style={{
        position: 'relative',
        height: 'calc(100vh - 64px)', // Subtract AppBar height
        overflow: 'hidden'  // Prevent scrolling
      }}>
        <div ref={networkContainer} style={{
          height: '100%',
          width: '100%'
        }} />

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
          sx={{
            '&:hover': {
              backgroundColor: addNodeMode ? '#c8e6c9' : '#e6e6e6',
              boxShadow: 'none'
            }
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
          sx={{
            '&:hover': {
              backgroundColor: addEdgeMode ? '#bbdefb' : '#e6e6e6',
              boxShadow: 'none'
            }
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
          sx={{
            '&:hover': {
              backgroundColor: deleteMode ? '#ffcdd2' : '#e6e6e6',
              boxShadow: 'none'
            }
          }}
          onClick={handleDeleteMode}
        >
          <DeleteIcon style={{ fontSize: '20px', color: deleteMode ? '#f44336' : '#666666' }} />
        </Button>


        <Dialog
          open={dialogMode === 'relationship'}
          onClose={() => {
            setDialogMode(null);
            setPendingRelationship(null);
            updateNetwork(); // Refresh to remove temporary edge
          }}
        >
          <DialogTitle>Select Relationship Type</DialogTitle>
          <DialogContent>
            <FormControl fullWidth margin="dense">
              <InputLabel>Relationship Type</InputLabel>
              <Select
                value={newRelationship.relationship_type}
                onChange={(e) => setNewRelationship({
                  ...newRelationship,
                  relationship_type: e.target.value
                })}
              >
                <MenuItem value="child">Child</MenuItem>
                <MenuItem
                  value="queue"
                  disabled={
                    pendingRelationship && networkData ?
                      networkData.nodes.find(n => n.id === pendingRelationship.from)?.goal_type !== 'achievement' ||
                      networkData.nodes.find(n => n.id === pendingRelationship.to)?.goal_type !== 'task'
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
              updateNetwork();
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingRelationship) {
                  handleCreateRelationship(
                    pendingRelationship.from,
                    pendingRelationship.to,
                    newRelationship.relationship_type as RelationshipType
                  )
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
