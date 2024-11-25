import React, { useState, useEffect, useRef } from 'react';

import axios from 'axios';
import { Network as VisNetwork } from 'vis-network/standalone';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, Box, FormControlLabel, Checkbox } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddLinkIcon from '@mui/icons-material/AddLink';
import { createResizeObserver } from '../utils/resizeObserver';
import { Relationship, NetworkNode, NetworkEdge, Goal } from '../types';
import GoalMenu, { createRelationship } from './GoalMenu';
//import GoalView from '../../../GoalView';
import { privateRequest } from '../utils/api';

interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

const formatNetworkNode = (goal: Goal): NetworkNode => {
  const colorMap = {
    achievement: '#00ff00',
    task: '#0000ff',
    routine: '#ff0000',
    directive: '#0000ff',
    project: '#ff0000'
  }
  return {
    ...goal,
    label: goal.goal_type,
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
      relationship_type: 'parent'
    });
    const networkContainer = useRef<HTMLDivElement>(null);
    const [network, setNetwork] = useState<VisNetwork | null>(null);
    const [pendingRelationship, setPendingRelationship] = useState<{ from: number, to: number } | null>(null);
    const [networkData, setNetworkData] = useState<NetworkData | null>(null);
    const [dialogMode, setDialogMode] = useState<DialogMode>(null);

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
          font: { size: 14 }
        },
        edges: {
          font: {
            size: 12,
            align: 'middle'
          },
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0.1
          }
        },
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'UD',
            sortMethod: 'directed',
            nodeSpacing: 14,
            levelSeparation: 150
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
          deleteNode: false,
          deleteEdge: false,
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
        }
      }

      if (networkContainer.current && networkData) {
        const formattedData = {
          nodes: networkData.nodes,
          edges: networkData.edges.map(edge => ({
            ...edge,
            // Set different colors and styles based on relationship type
            color: {
              color: edge.relationship_type === 'queue' ? '#ff9800' : '#666666'
            },
            // Use dashed lines for queue relationships
            dashes: edge.relationship_type === 'queue',
            // Add labels to edges
            label: edge.relationship_type,
            // For queue relationships, force them to be on the same level
            length: edge.relationship_type === 'queue' ? 200 : undefined,
            // For queue relationships, use horizontal layout
            smooth: edge.relationship_type === 'queue'
              ? {
                enabled: true,
                type: 'curvedCW',
                roundness: 0.2
              }
              : {
                enabled: true,
                type: 'continuous',
                roundness: 0.5
              }
          }))
        };
        const network = new VisNetwork(
          networkContainer.current,
          formattedData,
          options
        );




        const handleClick = (params: any, goalDialogMode: "edit" | "view") => {
          params.event.preventDefault();
          const nodeId = network.getNodeAt(params.pointer.DOM);
          if (nodeId && networkData) {
            const node = networkData.nodes.find(n => n.id === nodeId);
            if (node) {
              GoalMenu.open(node, goalDialogMode, (goal: Goal) => {
                fetchNetwork();
              });
            }
          }
        }
        // Handle right-click for editing
        network.on('oncontext', (params: any) => {
          handleClick(params, 'edit');
        });
        network.on('click', (params: any) => {
          handleClick(params, 'view');
        });
        setNetwork(network);
      }

    };

    // Initial data load and network setup
    useEffect(() => {
      const loadInitialData = async () => {
        await fetchNetwork();
        await updateNetwork();
      };

      loadInitialData();
    }, []); // Only run on mount

    // Update network when networkData changes
    useEffect(() => {
      if (networkData) {
        updateNetwork();
      }
    }, [networkData]); // Only update when networkData changes

    const fetchNetwork = async () => {
      const response = await privateRequest<NetworkData>('network');
      response.nodes = response.nodes.map(node => formatNetworkNode(node))
      setNetworkData(response);
    };



    useEffect(() => {
      if (networkContainer.current && network) {
        const observer = createResizeObserver(() => {
          network.fit();
        });

        observer.observe(networkContainer.current);
        return () => observer.disconnect();
      }
    }, [network]);


    const handleAddNode = () => {
      if (network && networkData) {
        GoalMenu.open({} as Goal, 'create', (goal: Goal) => {
          const newNode = formatNetworkNode(goal);
          networkData.nodes.push(newNode);
          setNetworkData({ ...networkData });
        });
      }
    }
    // Add this function to handle edge creation
    const handleAddEdge = () => {
      if (network) {
        network.addEdgeMode();
      }
    }

    const handleCreateRelationship = async (fromId: number, toId: number, relationshipType: string) => {
      await createRelationship(fromId, toId, relationshipType);
      //await fetchNetwork(); // Refresh the network after creating relationship
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
            backgroundColor: '#f3f3f3',
            border: '1px solid #c1c1c1',
            boxShadow: 'none'
          }}
          sx={{
            '&:hover': {
              backgroundColor: '#e6e6e6',
              boxShadow: 'none'
            }
          }}
          onClick={handleAddNode}
        >
          <AddIcon style={{ fontSize: '20px', color: '#666666' }} />
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
            backgroundColor: '#f3f3f3',
            border: '1px solid #c1c1c1',
            boxShadow: 'none'
          }}
          sx={{
            '&:hover': {
              backgroundColor: '#e6e6e6',
              boxShadow: 'none'
            }
          }}
          onClick={handleAddEdge}
        >
          <AddLinkIcon style={{ fontSize: '20px', color: '#666666' }} />
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
                <MenuItem value="parent">Parent</MenuItem>
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
                    newRelationship.relationship_type
                  ).then(() => {
                    setDialogMode(null);
                    setPendingRelationship(null);
                  });
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
