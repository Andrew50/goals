import React, { useState, useEffect, useRef, useCallback } from 'react';

import axios from 'axios';
import { Network as VisNetwork } from 'vis-network/standalone';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, Box, FormControlLabel, Checkbox } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddLinkIcon from '@mui/icons-material/AddLink';
import DeleteIcon from '@mui/icons-material/Delete';
import { createResizeObserver } from '../utils/resizeObserver';
import { Relationship, NetworkNode, NetworkEdge, Goal, RelationshipType } from '../types';
import GoalMenu, { createRelationship } from './GoalMenu';
//import GoalView from '../../../GoalView';
import { privateRequest } from '../utils/api';
import { buildHierarchy } from '../utils/buildHierarchy';

interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

const formatNetworkNode = (goal: Goal): NetworkNode => {
  const colorMap = {
    directive: '#9370DB', // purple
    project: '#4682B4',   // steel blue
    achievement: '#CD5C5C', // indian red
    routine: '#DAA520',   // goldenrod
    task: '#3CB371'       // medium sea green
  }
  return {
    ...goal,
    label: goal.name,
    title: goal.name + ' (' + goal.goal_type + ')',
    color: colorMap[goal.goal_type]
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

    const handleClick = (params: any, goalDialogMode: "edit" | "view") => {
      console.log('Delete mode:', deleteModeRef.current);
      if (!networkRef.current) {
        console.log('No network');
        return;
      }
      params.event.preventDefault();

      if (deleteModeRef.current) {
        if (params.nodes.length > 0) {
          console.log('Deleting node:', params.nodes[0]);
          handleDeleteNode(params.nodes[0]);
        } else if (params.edges.length > 0) {
          console.log('Deleting edge:', params.edges[0]);
          const edgeId = params.edges[0];
          handleDeleteEdge(edgeId);
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
            top: 10,
            right: 10,
            bottom: 10,
            left: 10
          },
          font: { size: 14 },
          widthConstraint: {
            maximum: 150
          }
        },
        edges: {
          arrows: {
            to: {
              enabled: true,
              scaleFactor: 1
            }
          },
          font: {
            size: 0,
            //align: 'middle'
          },
          smooth: {
            enabled: true,
            type: 'cubicBezier',
            roundness: 0.5
          },
          width: 2
        },
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'UD',
            sortMethod: 'directed',
            nodeSpacing: 150,
            levelSeparation: 150,
            parentCentralization: true,
            edgeMinimization: false,
            blockShifting: true,
            //shakeTowards: 'roots'
          }
        },
        manipulation: {
          enabled: false,
          addNode: true,
          addEdge: async function (data: any, callback: Function) {
            try {
              setPendingRelationship({
                from: data.from,
                to: data.to
              });
              setDialogMode('relationship');
              callback(data);
            } catch (err) {
              console.error('Edge creation error:', err);
              callback(null);
            }
          },
          editEdge: false,
          deleteNode: true,
          deleteEdge: true,
        },
        interaction: {
          navigationButtons: false,
          hover: true,
          dragNodes: true,
          dragView: true,
          zoomView: true,
          selectable: true,
          selectConnectedEdges: true,
          hoverConnectedEdges: true,
        },
        physics: {
          enabled: false
        }
      }



      if (networkContainer.current && networkData) {
        /*


        const nodeLevels: { [key: number]: number } = {};
        networkData.edges.forEach(edge => {
          if (edge.relationship_type === 'child') {
            if (edge.from && edge.to) {
              nodeLevels[edge.to] = (nodeLevels[edge.from] || 0) + 1;
            }
          } else if (edge.relationship_type === 'queue') {
            if (edge.from && edge.to) {
              nodeLevels[edge.to] = nodeLevels[edge.from] || 0;
            }
          }
        });

        const formattedNodes = networkData.nodes.map(node => {
          return {
            ...node,
            level: node.id !== undefined ? nodeLevels[node.id] || 0 : 0
          }
        });

        const formattedData = {
          //nodes: networkData.nodes,
          nodes: formattedNodes,
          edges: networkData.edges.map(edge => {
            const isQueue = edge.relationship_type === 'queue';
            return {
              ...edge,
              id: `${edge.from}-${edge.to}`,
              label: undefined,
              color: isQueue ? '#ff9800' : '#2196F3',
              arrows: {
                to: {
                  enabled: true
                }
              },
              dashes: isQueue,
              smooth: {
                enabled: true,
                type: isQueue ? 'curvedCW' : 'cubicBezier',
                roundness: isQueue ? 0.2 : 0.5
              },
              physics: !isQueue,
              //constraints: {
              //  type: isQueue ? 'fixed' : undefined,
              //  vertical: isQueue ? 0 : undefined
              //}
              //layout: isQueue ? { hierarchical: false } : undefined
            };
          })
        };*/
        const formattedData = buildHierarchy(networkData);
        const network = new VisNetwork(
          networkContainer.current,
          formattedData,
          options
        );



        network.on('click', (params: any) => handleClick(params, 'view'));
        network.on('oncontext', (params: any) => handleClick(params, 'edit'));
        networkRef.current = network;
      }

    };

    // Initial data load and network setup
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
          const newNode = formatNetworkNode(goal);
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
      await createRelationship(fromId, toId, relationshipType);
      if (networkData) {
        const newEdge: NetworkEdge = {
          from: fromId,
          to: toId,
          relationship_type: relationshipType as 'child' | 'queue',
          //id: `${fromId}-${toId}`
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
                <MenuItem value="queue">Queue</MenuItem>
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
