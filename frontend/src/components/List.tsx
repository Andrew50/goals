import { privateRequest } from '../utils/api';
import React, { useEffect, useState, useMemo } from 'react';
import { Goal, GoalType } from '../types';
import { goalColors } from '../theme/colors';
import GoalMenu from './GoalMenu';

const List: React.FC = () => {
    const [list, setList] = useState<Goal[]>([]);
    const [filters, setFilters] = useState<Partial<Record<keyof Goal, any>>>({});

    useEffect(() => {
        privateRequest<Goal[]>('list').then(setList);
    }, []);

    // Dynamically generate filter options based on the data
    const filterOptions = useMemo(() => {
        const options: Record<string, Set<any>> = {};

        list.forEach(item => {
            Object.entries(item).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    if (!options[key]) {
                        options[key] = new Set();
                    }
                    options[key].add(value);
                }
            });
        });

        return options;
    }, [list]);

    // Filter the list based on selected filters
    const filteredList = useMemo(() => {
        return list.filter(item => {
            return Object.entries(filters).every(([key, value]) => {
                if (!value) return true;
                return item[key as keyof Goal] === value;
            });
        });
    }, [list, filters]);

    const handleFilterChange = (field: keyof Goal, value: any) => {
        setFilters(prev => ({
            ...prev,
            [field]: value === '' ? undefined : value,
        }));
    };

    const handleGoalClick = (goal: Goal) => {
        GoalMenu.open(goal, 'view');
    };

    const handleGoalContextMenu = (event: React.MouseEvent, goal: Goal) => {
        event.preventDefault(); // Prevent default context menu
        GoalMenu.open(goal, 'edit', (updatedGoal) => {
            // Update the list with the edited/deleted goal
            setList(prevList => {
                if (!updatedGoal.id) {
                    // Goal was deleted
                    return prevList.filter(g => g.id !== goal.id);
                }
                // Goal was updated
                return prevList.map(g => g.id === updatedGoal.id ? updatedGoal : g);
            });
        });
    };

    const handleCreateGoal = () => {
        GoalMenu.open({} as Goal, 'create', (newGoal) => {
            // Add the new goal to the list
            setList(prevList => [...prevList, newGoal]);
        });
    };

    return (
        <div className="p-4 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Goals</h2>
                <button
                    onClick={handleCreateGoal}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
                >
                    <span className="text-xl">+</span>
                    <span>New Goal</span>
                </button>
            </div>

            <div className="filter-controls mb-6 flex flex-wrap gap-4 bg-white p-4 rounded-lg shadow-sm">
                {Object.entries(filterOptions).map(([field, values]) => {
                    if (values.size <= 1) return null;

                    return (
                        <div key={field} className="filter-control">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {field.replace(/_/g, ' ')}
                            </label>
                            <select
                                onChange={(e) => handleFilterChange(field as keyof Goal, e.target.value)}
                                value={filters[field as keyof Goal] || ''}
                                className="border rounded-md py-1.5 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">All</option>
                                {Array.from(values).map(value => (
                                    <option key={value} value={value}>
                                        {value.toString()}
                                    </option>
                                ))}
                            </select>
                        </div>
                    );
                })}
            </div>

            <div className="goals-list grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredList.map(goal => {
                    const goalColor = goalColors[goal.goal_type];
                    return (
                        <div
                            key={goal.id}
                            className="rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md cursor-pointer"
                            style={{
                                borderLeft: `4px solid ${goalColor}`,
                                backgroundColor: `${goalColor}10`,
                            }}
                            onClick={() => handleGoalClick(goal)}
                            onContextMenu={(e) => handleGoalContextMenu(e, goal)}
                        >
                            <div className="p-4">
                                <h3 className="font-bold text-lg mb-2">{goal.name}</h3>
                                <p className="text-gray-600 mb-3 text-sm">{goal.description}</p>
                                <div className="flex flex-wrap gap-2 text-sm">
                                    <span
                                        className="px-2 py-1 rounded-full text-xs"
                                        style={{
                                            backgroundColor: `${goalColor}30`,
                                            color: goalColor
                                        }}
                                    >
                                        {goal.goal_type}
                                    </span>
                                    {goal.priority && (
                                        <span className="px-2 py-1 rounded-full bg-gray-100 text-xs">
                                            {goal.priority}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default List;