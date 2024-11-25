import React, { useState, useEffect, useRef } from 'react';

import axios from 'axios';
import { Network as VisNetwork } from 'vis-network/standalone';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, Box, FormControlLabel, Checkbox } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { createResizeObserver } from '../utils/resizeObserver';
import { Goal, Relationship, NetworkNode, NetworkEdge } from '../types';
import GoalDialog, { createRelationship } from './GoalDialog';
//import GoalView from '../../../GoalView';
import { privateRequest } from '../utils/api';

interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
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
          color: '#666666',
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0.5
          }
        },
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'UD',
            sortMethod: 'directed',
            nodeSpacing: 14
          }
        },
        manipulation: {
          enabled: true,
          addNode: true,
          addEdge: handleAddEdge,
          editEdge: false,
          deleteNode: false,
          deleteEdge: false
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
      };

      if (networkContainer.current && networkData) {
        const network = new VisNetwork(
          networkContainer.current,
          networkData,
          options
        );


        const handleClick = (params: any, goalDialogMode: DialogMode) => {
          params.event.preventDefault();
          const nodeId = network.getNodeAt(params.pointer.DOM);
          if (nodeId && networkData) {
            const node = networkData.nodes.find(n => n.id === nodeId);
            if (node) {
              GoalDialog.open(node, goalDialogMode, () => {
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
        try {
          await fetchNetwork();
          await updateNetwork();
        } catch (err) {
          console.error('Failed to load initial data:', err);
        }
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
      const networkData = await privateRequest<NetworkData>('network');
      console.log('Network data received:', networkData);
      setNetworkData(networkData);
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

    // Add this function to handle edge creation
    const handleAddEdge = (data: any, callback: Function) => {
      setPendingRelationship({
        from: data.from,
        to: data.to
      });
      setDialogMode('relationship');
      callback(null); // Cancel the default edge creation
    };

    const handleCreateRelationship = async (fromId: number, toId: number, relationshipType: string) => {
      try {
        await createRelationship(fromId, toId, relationshipType);
        await fetchNetwork(); // Refresh the network after creating relationship
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create relationship');
      }
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
          onClick={() => setDialogMode('create')}
        >
          <AddIcon style={{ fontSize: '20px', color: '#666666' }} />
        </Button>


        {/*<GoalDialog
          open={dialogMode === 'create' || dialogMode === 'edit'}
          onClose={() => {
            setDialogMode(null);
            setFormGoal({ name: '' });
            setSelectedGoal(null);
          }}
          goal={dialogMode === 'create' ? formGoal : (selectedGoal || {})}
          onChange={handleGoalChange}
          onSuccess={fetchNetwork}
          mode={(dialogMode === 'create' || dialogMode === 'edit') ? dialogMode : 'create'}
          error={error}
        />
        {dialogMode === 'view' && selectedGoal && (
          <GoalView
            onClose={() => {
              setDialogMode(null);
              setSelectedGoal(null);
            }}
            goal={selectedGoal}
          />
        )}*/}

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
