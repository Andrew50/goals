import { privateRequest, goalToLocal } from '../utils/api';
import React, { useEffect, useState, useMemo } from 'react';
import { Goal, GoalType } from '../types';
import { goalColors } from '../theme/colors';
import GoalMenu from './GoalMenu';

const List: React.FC = () => {
    const [list, setList] = useState<Goal[]>([]);
    const [filters, setFilters] = useState<Partial<Record<keyof Goal, any>>>({});
    const [sortConfig, setSortConfig] = useState<{
        key: keyof Goal | null;
        direction: 'asc' | 'desc';
    }>({ key: null, direction: 'asc' });
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        privateRequest<Goal[]>('list').then(goals => {
            setList(goals.map(goalToLocal));
        });
    }, [refreshTrigger]);

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

    // Add sorted list computation
    const sortedList = useMemo(() => {
        const sorted = [...filteredList];
        if (sortConfig.key) {
            sorted.sort((a, b) => {
                const aValue = a[sortConfig.key!];
                const bValue = b[sortConfig.key!];

                if (aValue === null || aValue === undefined) return 1;
                if (bValue === null || bValue === undefined) return -1;

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sorted;
    }, [filteredList, sortConfig]);

    const handleFilterChange = (field: keyof Goal, value: any) => {
        setFilters(prev => ({
            ...prev,
            [field]: value === '' ? undefined : value,
        }));
    };

    const handleGoalClick = (goal: Goal) => {
        GoalMenu.open(goal, 'view', (updatedGoal) => {
            // Trigger a refresh instead of manually updating the list
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleGoalContextMenu = (event: React.MouseEvent, goal: Goal) => {
        event.preventDefault(); // Prevent default context menu
        GoalMenu.open(goal, 'edit', (updatedGoal) => {
            // Trigger a refresh instead of manually updating the list
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleCreateGoal = () => {
        GoalMenu.open({} as Goal, 'create', (newGoal) => {
            // Trigger a refresh instead of manually updating the list
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleSort = (key: keyof Goal) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const renderFilterInput = (field: string, values: Set<any>) => {
        const isDateField = field.includes('time') || field.includes('date');

        if (isDateField) {
            return (
                <input
                    type="date"
                    onChange={(e) => handleFilterChange(field as keyof Goal, e.target.value)}
                    value={filters[field as keyof Goal] || ''}
                    className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
                />
            );
        }

        return (
            <select
                onChange={(e) => handleFilterChange(field as keyof Goal, e.target.value)}
                value={filters[field as keyof Goal] || ''}
                className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
            >
                <option value="">All</option>
                {Array.from(values).map(value => (
                    <option key={value} value={value}>
                        {value.toString()}
                    </option>
                ))}
            </select>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto py-10 px-6">
                <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-8">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4 md:mb-0">Goals</h2>
                    <button
                        onClick={handleCreateGoal}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors duration-200 flex items-center gap-2 shadow-sm hover:shadow-md text-sm font-medium"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>New Goal</span>
                    </button>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
                    <h3 className="text-lg font-semibold text-gray-700 mb-4">Filters</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {Object.entries(filterOptions).map(([field, values]) => {
                            if (values.size <= 1) return null;

                            return (
                                <div key={field} className="filter-control">
                                    <label className="block text-sm font-medium text-gray-600 mb-2 capitalize">
                                        {field.replace(/_/g, ' ')}
                                    </label>
                                    {renderFilterInput(field, values)}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="w-full table-fixed">
                            <thead>
                                <tr className="text-left border-b border-gray-200 bg-gray-100">
                                    {[
                                        { key: 'name' as keyof Goal, label: 'Name', width: '15%' },
                                        { key: 'goal_type' as keyof Goal, label: 'Type', width: '8%' },
                                        { key: 'description' as keyof Goal, label: 'Description', width: '20%' },
                                        { key: 'priority' as keyof Goal, label: 'Priority', width: '7%' },
                                        { key: 'completed' as keyof Goal, label: 'Status', width: '8%' },
                                        { key: 'start_timestamp' as keyof Goal, label: 'Start Date', width: '8%' },
                                        { key: 'end_timestamp' as keyof Goal, label: 'End Date', width: '8%' },
                                        { key: 'scheduled_timestamp' as keyof Goal, label: 'Scheduled', width: '8%' },
                                        { key: 'next_timestamp' as keyof Goal, label: 'Next Due', width: '8%' },
                                        { key: 'frequency' as keyof Goal, label: 'Frequency', width: '5%' },
                                        { key: 'duration' as keyof Goal, label: 'Duration', width: '5%' }
                                    ].map(({ key, label, width }) => (
                                        <th
                                            key={key}
                                            className="px-4 py-3 cursor-pointer hover:bg-gray-200 select-none"
                                            style={{ width }}
                                            onClick={() => handleSort(key)}
                                        >
                                            <div className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                                                {label}
                                                {sortConfig.key === key && (
                                                    <span className="text-blue-500">
                                                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                                    </span>
                                                )}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedList.map(goal => {
                                    const goalColor = goalColors[goal.goal_type];
                                    return (
                                        <tr
                                            key={goal.id}
                                            className="hover:bg-gray-50 cursor-pointer transition-all border-b border-gray-200 last:border-0"
                                            style={{
                                                borderLeft: `4px solid ${goalColor}`,
                                            }}
                                            onClick={() => handleGoalClick(goal)}
                                            onContextMenu={(e) => handleGoalContextMenu(e, goal)}
                                        >
                                            <td className="px-4 py-3 font-medium text-sm text-gray-800">{goal.name}</td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className="px-2 py-1 rounded-full text-xs whitespace-nowrap"
                                                    style={{
                                                        backgroundColor: `${goalColor}20`,
                                                        color: goalColor
                                                    }}
                                                >
                                                    {goal.goal_type}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600 text-sm">{goal.description}</td>
                                            <td className="px-4 py-3">
                                                {goal.priority && (
                                                    <span className="px-2 py-1 rounded-full bg-gray-100 text-xs text-gray-700">
                                                        {goal.priority}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded-full text-xs ${goal.completed
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-yellow-100 text-yellow-700'
                                                    }`}>
                                                    {goal.completed ? 'Completed' : 'In Progress'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {goal.start_timestamp && new Date(goal.start_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {goal.end_timestamp && new Date(goal.end_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {goal.scheduled_timestamp && new Date(goal.scheduled_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {goal.next_timestamp && new Date(goal.next_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {goal.frequency && (
                                                    <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs">
                                                        {goal.frequency}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {goal.duration && (
                                                    <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 text-xs">
                                                        {goal.duration} min
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default List;
