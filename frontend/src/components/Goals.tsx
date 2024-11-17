import React, { useState, useEffect } from 'react';

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

  const goalTypes = ['task', 'routine', 'directive', 'achievement', 'habit'];
  const relationshipTypes = ['parent', 'child', 'next'];

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:3000/goals/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newGoal),
      });

      if (!response.ok) throw new Error('Failed to create goal');

      const createdGoal = await response.json();
      setGoals([...goals, createdGoal]);
      setSuccess('Goal created successfully!');
      setNewGoal({ name: '', goal_type: 'task' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleCreateRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:3000/goals/create_relationship', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newRelationship),
      });

      if (!response.ok) throw new Error('Failed to create relationship');

      setSuccess('Relationship created successfully!');
      setNewRelationship({
        from_id: 0,
        to_id: 0,
        relationship_type: 'parent'
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Goals Management</h2>

      {/* Error and Success Messages */}
      {error && <p className="text-red-500 mb-4">{error}</p>}
      {success && <p className="text-green-500 mb-4">{success}</p>}

      {/* Create Goal Form */}
      <div className="mb-8">
        <h3 className="text-xl font-semibold mb-2">Create New Goal</h3>
        <form onSubmit={handleCreateGoal} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Goal Name"
              value={newGoal.name}
              onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
              className="border p-2 rounded w-full"
              required
            />
          </div>
          <div>
            <select
              value={newGoal.goal_type}
              onChange={(e) => setNewGoal({ ...newGoal, goal_type: e.target.value })}
              className="border p-2 rounded w-full"
            >
              {goalTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Create Goal
          </button>
        </form>
      </div>

      {/* Create Relationship Form */}
      <div className="mb-8">
        <h3 className="text-xl font-semibold mb-2">Create Relationship</h3>
        <form onSubmit={handleCreateRelationship} className="space-y-4">
          <div>
            <input
              type="number"
              placeholder="From Goal ID"
              value={newRelationship.from_id || ''}
              onChange={(e) => setNewRelationship({
                ...newRelationship,
                from_id: parseInt(e.target.value)
              })}
              className="border p-2 rounded w-full"
              required
            />
          </div>
          <div>
            <input
              type="number"
              placeholder="To Goal ID"
              value={newRelationship.to_id || ''}
              onChange={(e) => setNewRelationship({
                ...newRelationship,
                to_id: parseInt(e.target.value)
              })}
              className="border p-2 rounded w-full"
              required
            />
          </div>
          <div>
            <select
              value={newRelationship.relationship_type}
              onChange={(e) => setNewRelationship({
                ...newRelationship,
                relationship_type: e.target.value
              })}
              className="border p-2 rounded w-full"
            >
              {relationshipTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Create Relationship
          </button>
        </form>
      </div>

      {/* Display Goals */}
      <div>
        <h3 className="text-xl font-semibold mb-2">Existing Goals</h3>
        <div className="grid grid-cols-1 gap-4">
          {goals.map((goal) => (
            <div key={goal.id} className="border p-4 rounded">
              <p><strong>ID:</strong> {goal.id}</p>
              <p><strong>Name:</strong> {goal.name}</p>
              <p><strong>Type:</strong> {goal.goal_type}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Goals;
