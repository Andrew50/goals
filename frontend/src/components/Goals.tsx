import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-network/standalone/esm/vis-network';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel, Box } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { createResizeObserver } from '../utils/resizeObserver';

interface Goal {
  id?: number;
  name: string;
  goal_type: string;
}

interface Relationship {
  from_id: number;
  to_id: number;
  relationship_type: string;
}

interface NetworkNode {
  id: number;
  label: string;
  title?: string;
  color?: string;
}

interface NetworkEdge {
  from: number;
  to: number;
  label?: string;
  arrows?: string;
}

const Goals: React.FC = () => {
  // State for new goal
  const [newGoal, setNewGoal] = useState<Goal>({
    name: '',
    goal_type: 'task'
  });

  // State for new relationship
  const [newRelationship, setNewRelationship] = useState<Relationship>({
    from_id: 0,
    to_id: 0,
    relationship_type: 'parent'
  });

  // State for existing goals
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const goalTypes = ['task', 'routine', 'directive', 'achievement'];
  const relationshipTypes = ['parent', 'child', 'next'];

  const networkContainer = useRef<HTMLDivElement>(null);
  const [network, setNetwork] = useState<Network | null>(null);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);

  // Add new state for relationship dialog
  const [isRelationshipDialogOpen, setIsRelationshipDialogOpen] = useState(false);
  const [pendingRelationship, setPendingRelationship] = useState<{ from: number, to: number } | null>(null);

  // Function to get color based on goal type
  const getNodeColor = (goalType: string) => {
    const colors = {
      task: '#FF9999',
      routine: '#99FF99',
      directive: '#9999FF',
      achievement: '#FFFF99',
      habit: '#FF99FF'
    };
    return colors[goalType as keyof typeof colors] || '#CCCCCC';
  };

  // Function to handle right-click edit
  const handleEditGoal = async (goalId: number, goalData: Goal) => {
    try {
      const response = await axios.put(`http://localhost:5057/goals/${goalId}`, goalData);
      if (response.status === 200) {
        await fetchGoals();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update goal');
    }
  };

  // Modified updateNetwork function
  const updateNetwork = async () => {
    try {
      // Fetch all goals and relationships
      const goalsResponse = await axios.get('http://localhost:5057/goals');
      const relationshipsResponse = await axios.get('http://localhost:5057/goals/relationships');

      const goals = goalsResponse.data;
      const relationships = relationshipsResponse.data;

      // Create nodes and edges for the network
      const nodes = goals.map((goal: Goal) => ({
        id: goal.id,
        label: goal.name,
        title: `${goal.name} (${goal.goal_type})`,
        color: getNodeColor(goal.goal_type)
      }));

      const edges = relationships.map((rel: Relationship) => ({
        from: rel.from_id,
        to: rel.to_id,
        label: rel.relationship_type,
        arrows: 'to'
      }));

      // Modified options
      const options = {
        nodes: {
          shape: 'box',
          margin: {
            top: 10,
            right: 10,
            bottom: 10,
            left: 10
          },
          font: {
            size: 14
          }
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
        manipulation: {
          enabled: true,
          addNode: false,
          addEdge: (data: any, callback: Function) => {
            setPendingRelationship({ from: data.from, to: data.to });
            setNewRelationship({
              from_id: data.from,
              to_id: data.to,
              relationship_type: 'parent'  // default value
            });
            setIsRelationshipDialogOpen(true);
            // Don't call callback here - we'll handle the edge creation after dialog
          },
          editEdge: false,
          deleteNode: false,
          deleteEdge: false,
          controlNodeStyle: {
            shape: 'dot',
            size: 6,
            color: {
              background: '#ff0000',
              border: '#cc0000',
              highlight: {
                background: '#ff0000',
                border: '#cc0000'
              }
            },
            borderWidth: 2,
            borderWidthSelected: 2
          }
        },
        interaction: {
          navigationButtons: true,
          hover: true,
          dragNodes: true,
          dragView: true,
          zoomView: true,
          selectable: true,
          selectConnectedEdges: true,
          hoverConnectedEdges: true,
        },
        configure: {
          enabled: true,
          filter: 'nodes,edges',
          container: undefined,
          showButton: true
        }
      };

      // Create the network
      if (networkContainer.current) {
        const network = new Network(
          networkContainer.current,
          { nodes, edges },
          options
        );

        // Handle right-click context menu
        network.on('oncontext', (params) => {
          params.event.preventDefault();
          const nodeId = network.getNodeAt(params.pointer.DOM);
          if (nodeId) {
            const goal = goals.find((g: Goal) => g.id === nodeId);
            if (goal) {
              setSelectedGoal(goal);
              setIsEditDialogOpen(true);
            }
          }
        });

        setNetwork(network);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load network');
    }
  };

  // Update network when goals or relationships change
  useEffect(() => {
    updateNetwork();
  }, [goals]);

  const fetchGoals = async () => {
    try {
      const response = await axios.get('http://localhost:5057/goals');
      setGoals(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch goals');
    }
  };

  const fetchRelationships = async () => {
    try {
      await axios.get('http://localhost:5057/goals/relationships');
      updateNetwork(); // This will refresh the network visualization
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch relationships');
    }
  };

  const handleCreateGoal = async () => {
    try {
      const response = await axios.post('http://localhost:5057/goals/create', newGoal);
      if (response.status === 200 || response.status === 201) {
        await fetchGoals(); // Refresh the goals list
        setIsCreateDialogOpen(false);
        setNewGoal({ name: '', goal_type: 'task' });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create goal');
    }
  };

  const handleCreateLink = async (fromId: number, toId: number, relationshipType: string) => {
    try {
      const response = await axios.post('http://localhost:5057/goals/create_relationship', {
        from_id: fromId,
        to_id: toId,
        relationship_type: relationshipType
      });
      if (response.status === 200 || response.status === 201) {
        await fetchRelationships();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create relationship');
    }
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  // Add new state for edit dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

  useEffect(() => {
    if (networkContainer.current && network) {
      const observer = createResizeObserver(() => {
        network.fit();
      });

      observer.observe(networkContainer.current);
      return () => observer.disconnect();
    }
  }, [network]);

  // Add a new handler function for deleting goals
  const handleDeleteGoal = async (goalId: number) => {
    try {
      const response = await axios.delete(`http://localhost:5057/goals/${goalId}`);
      if (response.status === 200) {
        await fetchGoals();
        setIsEditDialogOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete goal');
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

      {/* Floating Action Button - fixed styling */}
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
        onClick={() => setIsCreateDialogOpen(true)}
      >
        <AddIcon style={{ fontSize: '20px', color: '#666666' }} />
      </Button>

      {/* Edit Goal Dialog */}
      <Dialog open={isEditDialogOpen} onClose={() => setIsEditDialogOpen(false)}>
        <DialogTitle>Edit Goal</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Goal Name"
            fullWidth
            autoComplete="off"
            value={selectedGoal?.name || ''}
            onChange={(e) => setSelectedGoal(selectedGoal ? { ...selectedGoal, name: e.target.value } : null)}
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>Goal Type</InputLabel>
            <Select
              value={selectedGoal?.goal_type || ''}
              onChange={(e) => setSelectedGoal(selectedGoal ? { ...selectedGoal, goal_type: e.target.value } : null)}
            >
              {goalTypes.map(type => (
                <MenuItem key={type} value={type}>{type}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
          <Button
            onClick={() => {
              if (selectedGoal?.id) {
                handleDeleteGoal(selectedGoal.id);
              }
            }}
            color="error"
          >
            Delete
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (selectedGoal && selectedGoal.id) {
                  handleEditGoal(selectedGoal.id, selectedGoal);
                  setIsEditDialogOpen(false);
                }
              }}
              color="primary"
            >
              Save
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Create Goal Dialog */}
      <Dialog open={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)}>
        <DialogTitle>Create New Goal</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Goal Name"
            fullWidth
            autoComplete="off"
            value={newGoal.name}
            onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>Goal Type</InputLabel>
            <Select
              value={newGoal.goal_type}
              onChange={(e) => setNewGoal({ ...newGoal, goal_type: e.target.value })}
            >
              {goalTypes.map(type => (
                <MenuItem key={type} value={type}>{type}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateGoal} color="primary">Create</Button>
        </DialogActions>
      </Dialog>

      {/* Relationship Type Dialog */}
      <Dialog
        open={isRelationshipDialogOpen}
        onClose={() => {
          setIsRelationshipDialogOpen(false);
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
            setIsRelationshipDialogOpen(false);
            setPendingRelationship(null);
            updateNetwork();
          }}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pendingRelationship) {
                handleCreateLink(
                  pendingRelationship.from,
                  pendingRelationship.to,
                  newRelationship.relationship_type
                );
                setIsRelationshipDialogOpen(false);
                setPendingRelationship(null);
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

export default Goals;
