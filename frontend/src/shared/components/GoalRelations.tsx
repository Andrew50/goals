import React, { useEffect, useRef, useState, useMemo } from 'react';
import { DataSet, Network as VisNetwork } from 'vis-network/standalone';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List, ListItem, ListItemText, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import Fuse from 'fuse.js';
import { Goal, ApiGoal, NetworkNode, NetworkEdge } from '../../types/goals';
import { privateRequest, createRelationship, deleteRelationship } from '../utils/api';
import { goalToLocal } from '../utils/time';
import { getGoalStyle } from '../styles/colors';
import { validateRelationship } from '../utils/goalValidation';

interface GoalRelationsProps {
  goal: Goal;
  onClose: () => void;
  onUpdate?: () => void;
}

const GoalRelations: React.FC<GoalRelationsProps> = ({ goal, onClose, onUpdate }) => {
  const [allGoals, setAllGoals] = useState<Goal[]>([]);
  const [networkData, setNetworkData] = useState<{ nodes: NetworkNode[]; edges: NetworkEdge[] }>({ nodes: [], edges: [] });
  const [parentQuery, setParentQuery] = useState('');
  const [childQuery, setChildQuery] = useState('');
  const networkRef = useRef<VisNetwork | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch all goals for fuzzy search
  useEffect(() => {
    privateRequest<ApiGoal[]>('list').then(res => {
      setAllGoals(res.map(goalToLocal));
    });
  }, []);

  // Fetch network data and filter relatives
  useEffect(() => {
    privateRequest<{ nodes: ApiGoal[]; edges: NetworkEdge[] }>('network').then(res => {
      const nodes = res.nodes.map(g => {
        const local = goalToLocal(g);
        return { ...local, label: local.name, color: getGoalStyle(local).backgroundColor } as NetworkNode;
      });
      const edges = res.edges.map(e => ({ ...e, id: `${e.from}-${e.to}` }));
      const relatedEdges = edges.filter(e => e.from === goal.id || e.to === goal.id);
      const ids = new Set<number>();
      relatedEdges.forEach(e => { ids.add(e.from); ids.add(e.to); });
      const relatedNodes = nodes.filter(n => ids.has(n.id));
      setNetworkData({ nodes: relatedNodes, edges: relatedEdges });
    });
  }, [goal.id]);

  // Initialize vis-network
  useEffect(() => {
    if (!containerRef.current) return;
    if (networkRef.current) networkRef.current.destroy();
    const nodesDS = new DataSet(networkData.nodes);
    const edgesDS = new DataSet(networkData.edges.map(e => ({
      ...e,
      dashes: e.relationship_type === 'queue',
      color: { color: e.relationship_type === 'queue' ? '#ff9800' : '#2196f3' },
      arrows: { to: { enabled: true, scaleFactor: 0.5 } }
    })));
    networkRef.current = new VisNetwork(containerRef.current, { nodes: nodesDS, edges: edgesDS }, { physics: false, layout: { hierarchical: false } });
    networkRef.current.fit();
    return () => { networkRef.current?.destroy(); };
  }, [networkData]);

  const parents = useMemo(() => networkData.edges
    .filter(e => e.relationship_type === 'child' && e.to === goal.id)
    .map(e => networkData.nodes.find(n => n.id === e.from)!)
    .filter(Boolean), [networkData, goal.id]);

  const children = useMemo(() => networkData.edges
    .filter(e => e.relationship_type === 'child' && e.from === goal.id)
    .map(e => networkData.nodes.find(n => n.id === e.to)!)
    .filter(Boolean), [networkData, goal.id]);

  const fuse = useMemo(() => new Fuse(allGoals, { keys: ['name'], threshold: 0.3 }), [allGoals]);

  const addRelation = async (candidate: Goal, type: 'parent' | 'child') => {
    const fromGoal = type === 'parent' ? candidate : goal;
    const toGoal = type === 'parent' ? goal : candidate;
    const error = validateRelationship(fromGoal, toGoal, 'child');
    if (error) { alert(error); return; }
    await createRelationship(fromGoal.id!, toGoal.id!, 'child');
    if (onUpdate) onUpdate();
    onClose();
  };

  const removeRelation = async (candidate: Goal, type: 'parent' | 'child') => {
    const fromId = type === 'parent' ? candidate.id! : goal.id!;
    const toId = type === 'parent' ? goal.id! : candidate.id!;
    await deleteRelationship(fromId, toId, 'child');
    if (onUpdate) onUpdate();
    onClose();
  };

  const parentResults = parentQuery ? fuse.search(parentQuery).map(r => r.item).filter(g => g.id !== goal.id) : [];
  const childResults = childQuery ? fuse.search(childQuery).map(r => r.item).filter(g => g.id !== goal.id) : [];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Relationships</DialogTitle>
      <DialogContent>
        <div ref={containerRef} style={{ height: '200px', border: '1px solid #ccc', marginBottom: '1rem' }} />
        <List dense>
          {parents.map(p => (
            <ListItem key={`parent-${p.id}`} secondaryAction={
              <IconButton edge="end" onClick={() => removeRelation(p, 'parent')}><DeleteIcon /></IconButton>
            }>
              <ListItemText primary={`Parent: ${p.name}`} />
            </ListItem>
          ))}
          {children.map(c => (
            <ListItem key={`child-${c.id}`} secondaryAction={
              <IconButton edge="end" onClick={() => removeRelation(c, 'child')}><DeleteIcon /></IconButton>
            }>
              <ListItemText primary={`Child: ${c.name}`} />
            </ListItem>
          ))}
        </List>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <TextField label="Add Parent" value={parentQuery} onChange={e => setParentQuery(e.target.value)} fullWidth />
          <IconButton onClick={() => setParentQuery('')}><CloseIcon /></IconButton>
        </div>
        {parentResults.slice(0, 5).map(g => (
          <ListItem key={`parent-add-${g.id}`} button onClick={() => addRelation(g, 'parent')}>
            <ListItemText primary={g.name} />
            <AddIcon />
          </ListItem>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <TextField label="Add Child" value={childQuery} onChange={e => setChildQuery(e.target.value)} fullWidth />
          <IconButton onClick={() => setChildQuery('')}><CloseIcon /></IconButton>
        </div>
        {childResults.slice(0, 5).map(g => (
          <ListItem key={`child-add-${g.id}`} button onClick={() => addRelation(g, 'child')}>
            <ListItemText primary={g.name} />
            <AddIcon />
          </ListItem>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GoalRelations;
