import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import React, { useEffect, useState, useMemo } from 'react';
import { Goal, ApiGoal } from '../../types/goals'; // Import ApiGoal
import { getGoalStyle } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import './List.css';
import Fuse from 'fuse.js';
import { formatFrequency } from '../../shared/utils/frequency';

type FieldType = 'text' | 'enum' | 'number' | 'boolean' | 'date';
type ColumnKey = keyof Goal;

type FieldConfig = {
    key: ColumnKey;
    label: string;
    width?: string;
    type: FieldType;
    sortable?: boolean;
    filterable?: boolean;
};

const FIELD_CONFIG: FieldConfig[] = [
    { key: 'name', label: 'Name', width: '15%', type: 'text', sortable: true, filterable: false },
    { key: 'goal_type', label: 'Type', width: '8%', type: 'enum', sortable: true, filterable: true },
    { key: 'description', label: 'Description', width: '20%', type: 'text', sortable: false, filterable: false },
    { key: 'priority', label: 'Priority', width: '7%', type: 'enum', sortable: true, filterable: true },
    { key: 'completed', label: 'Status', width: '8%', type: 'boolean', sortable: true, filterable: true },
    { key: 'start_timestamp', label: 'Start Date', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'end_timestamp', label: 'End Date', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'scheduled_timestamp', label: 'Scheduled', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'next_timestamp', label: 'Next Due', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'frequency', label: 'Frequency', width: '5%', type: 'enum', sortable: true, filterable: true },
    { key: 'duration', label: 'Duration', width: '5%', type: 'number', sortable: true, filterable: true },
];

type DateRange = { from?: string; to?: string };
type FiltersState = {
    goal_type?: string;
    priority?: string; // 'low' | 'medium' | 'high' | '__none__'
    completed?: boolean;
    frequency?: string;
    duration?: number;
    start_timestamp?: DateRange;
    end_timestamp?: DateRange;
    scheduled_timestamp?: DateRange;
    next_timestamp?: DateRange;
};

const List: React.FC = () => {
    const [list, setList] = useState<Goal[]>([]);
    const [filters, setFilters] = useState<FiltersState>({});
    const [sortConfig, setSortConfig] = useState<{
        key: keyof Goal | null;
        direction: 'asc' | 'desc';
    }>({ key: null, direction: 'asc' });
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    useEffect(() => {
        // Expect ApiGoal[] from the API
        privateRequest<ApiGoal[]>('list').then(apiGoals => {
            // Now map ApiGoal[] to Goal[] using goalToLocal
            setList(apiGoals.map(goalToLocal));
        });
    }, [refreshTrigger]);

    // Enum options derived from current list for declared enum fields
    const enumOptions = useMemo(() => {
        const unique = <K extends keyof Goal>(key: K): Array<string | number | boolean> => {
            const set = new Set<string | number | boolean>();
            list.forEach(item => {
                const v = item[key] as unknown as string | number | boolean | undefined | null;
                if (v !== undefined && v !== null) set.add(v);
            });
            return Array.from(set);
        };
        return {
            goal_type: unique('goal_type'),
            frequency: unique('frequency'),
            priority: ['__none__', 'low', 'medium', 'high'] as const,
        } as const;
    }, [list]);

    const fuse = useMemo(() => {
        return new Fuse(list, {
            keys: ['name', 'description'],
            threshold: 0.3, // Adjust this value to control the fuzziness
        });
    }, [list]);

    const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K] | undefined) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const filteredList = useMemo(() => {
        let filtered = list;

        const inRange = (val?: string | number | null, range?: DateRange): boolean => {
            if (val === undefined || val === null) return range === undefined; // treat no value as pass unless a range is set
            if (!range || (!range.from && !range.to)) return true;
            const t = new Date(val as any).getTime();
            const from = range.from ? new Date(range.from).getTime() : -Infinity;
            const to = range.to ? new Date(range.to).getTime() : Infinity;
            return t >= from && t <= to;
        };

        // Enum and primitive filters
        if (filters.goal_type !== undefined) {
            filtered = filtered.filter(g => g.goal_type === filters.goal_type);
        }
        if (filters.frequency !== undefined) {
            filtered = filtered.filter(g => g.frequency === filters.frequency);
        }
        if (filters.completed !== undefined) {
            filtered = filtered.filter(g => g.completed === filters.completed);
        }
        if (filters.priority !== undefined) {
            if (filters.priority === '__none__') {
                filtered = filtered.filter(g => g.priority === undefined || g.priority === null);
            } else {
                filtered = filtered.filter(g => g.priority === filters.priority);
            }
        }
        if (filters.duration !== undefined) {
            filtered = filtered.filter(g => (g.duration as any) === filters.duration);
        }

        // Date range filters
        filtered = filtered.filter(g => inRange(g.start_timestamp as any, filters.start_timestamp));
        filtered = filtered.filter(g => inRange(g.end_timestamp as any, filters.end_timestamp));
        filtered = filtered.filter(g => inRange(g.scheduled_timestamp as any, filters.scheduled_timestamp));
        filtered = filtered.filter(g => inRange(g.next_timestamp as any, filters.next_timestamp));

        // Apply search query to the filtered list
        if (searchQuery) {
            const searchResults = fuse.search(searchQuery);
            filtered = filtered.filter(item =>
                searchResults.some(result => result.item.id === item.id)
            );
        }

        return filtered;
    }, [list, filters, searchQuery, fuse]);

    // Add sorted list computation (type-aware)
    const sortedList = useMemo(() => {
        const sorted = [...filteredList];
        if (sortConfig.key) {
            const cfg = FIELD_CONFIG.find(c => c.key === sortConfig.key);
            const type = cfg?.type ?? 'text';
            sorted.sort((a, b) => {
                const aValue = a[sortConfig.key!];
                const bValue = b[sortConfig.key!];

                // Undefined/nulls go last
                if (aValue === null || aValue === undefined) return 1;
                if (bValue === null || bValue === undefined) return -1;

                let cmp = 0;
                if (type === 'date') {
                    const at = new Date(aValue as any).getTime();
                    const bt = new Date(bValue as any).getTime();
                    cmp = at === bt ? 0 : at < bt ? -1 : 1;
                } else if (type === 'number') {
                    const an = Number(aValue as any);
                    const bn = Number(bValue as any);
                    cmp = an === bn ? 0 : an < bn ? -1 : 1;
                } else if (type === 'boolean') {
                    const ab = Boolean(aValue as any) ? 1 : 0;
                    const bb = Boolean(bValue as any) ? 1 : 0;
                    cmp = ab - bb;
                } else {
                    const as = String(aValue as any);
                    const bs = String(bValue as any);
                    cmp = as.localeCompare(bs);
                }
                return sortConfig.direction === 'asc' ? cmp : -cmp;
            });
        }
        return sorted;
    }, [filteredList, sortConfig]);

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

    const renderFilterControl = (cfg: FieldConfig) => {
        if (!cfg.filterable) return null;
        if (cfg.type === 'date') {
            const range = filters[cfg.key as keyof FiltersState] as DateRange | undefined;
            return (
                <div className="grid grid-cols-2 gap-2">
                    <div className="filter-input-wrapper">
                        <input
                            type="date"
                            placeholder="From"
                            onChange={(e) => {
                                const v = e.target.value || undefined;
                                const prev = (filters[cfg.key as keyof FiltersState] as DateRange | undefined) || {};
                                updateFilter(cfg.key as keyof FiltersState, { ...prev, from: v } as any);
                            }}
                            value={range?.from || ''}
                            className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
                            spellCheck="false"
                            autoComplete="off"
                        />
                        {(range?.from) && (
                            <button
                                type="button"
                                className="filter-clear"
                                onClick={() => {
                                    const prev = (filters[cfg.key as keyof FiltersState] as DateRange | undefined) || {};
                                    const next: DateRange = { ...prev };
                                    delete next.from;
                                    if (!next.to) {
                                        updateFilter(cfg.key as keyof FiltersState, undefined);
                                    } else {
                                        updateFilter(cfg.key as keyof FiltersState, next as any);
                                    }
                                }}
                                aria-label={`Clear ${cfg.label} from`}
                            >
                                ×
                            </button>
                        )}
                    </div>
                    <div className="filter-input-wrapper">
                        <input
                            type="date"
                            placeholder="To"
                            onChange={(e) => {
                                const v = e.target.value || undefined;
                                const prev = (filters[cfg.key as keyof FiltersState] as DateRange | undefined) || {};
                                updateFilter(cfg.key as keyof FiltersState, { ...prev, to: v } as any);
                            }}
                            value={range?.to || ''}
                            className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
                            spellCheck="false"
                            autoComplete="off"
                        />
                        {(range?.to) && (
                            <button
                                type="button"
                                className="filter-clear"
                                onClick={() => {
                                    const prev = (filters[cfg.key as keyof FiltersState] as DateRange | undefined) || {};
                                    const next: DateRange = { ...prev };
                                    delete next.to;
                                    if (!next.from) {
                                        updateFilter(cfg.key as keyof FiltersState, undefined);
                                    } else {
                                        updateFilter(cfg.key as keyof FiltersState, next as any);
                                    }
                                }}
                                aria-label={`Clear ${cfg.label} to`}
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>
            );
        }
        if (cfg.type === 'boolean') {
            const value = (filters[cfg.key as keyof FiltersState] as boolean | undefined);
            return (
                <div className="filter-input-wrapper">
                    <select
                        onChange={(e) => {
                            const v = e.target.value;
                            updateFilter(cfg.key as keyof FiltersState, (v === '' ? undefined : (v === 'true')) as any);
                        }}
                        value={value === undefined ? '' : value ? 'true' : 'false'}
                        className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
                    >
                        <option value="">All</option>
                        <option value="false">In Progress</option>
                        <option value="true">Completed</option>
                    </select>
                    {(value !== undefined) && (
                        <button
                            type="button"
                            className="filter-clear"
                            onClick={() => updateFilter(cfg.key as keyof FiltersState, undefined)}
                            aria-label={`Clear ${cfg.label}`}
                        >
                            ×
                        </button>
                    )}
                </div>
            );
        }
        if (cfg.type === 'number') {
            const value = filters[cfg.key as keyof FiltersState] as number | undefined;
            return (
                <div className="filter-input-wrapper">
                    <input
                        type="number"
                        onChange={(e) => {
                            const raw = e.target.value;
                            updateFilter(cfg.key as keyof FiltersState, (raw === '' ? undefined : Number(raw)) as any);
                        }}
                        value={value ?? ''}
                        className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
                        spellCheck="false"
                        autoComplete="off"
                    />
                    {(value !== undefined) && (
                        <button
                            type="button"
                            className="filter-clear"
                            onClick={() => updateFilter(cfg.key as keyof FiltersState, undefined)}
                            aria-label={`Clear ${cfg.label}`}
                        >
                            ×
                        </button>
                    )}
                </div>
            );
        }
        if (cfg.type === 'enum') {
            const value = filters[cfg.key as keyof FiltersState] as string | undefined;
            const options = cfg.key === 'goal_type' ? enumOptions.goal_type : cfg.key === 'frequency' ? enumOptions.frequency : cfg.key === 'priority' ? enumOptions.priority : [];
            const sortedValues = cfg.key === 'priority' ? options : [...options].sort((a, b) => a.toString().localeCompare(b.toString()));
            return (
                <div className="filter-input-wrapper">
                    <select
                        onChange={(e) => updateFilter(cfg.key as keyof FiltersState, (e.target.value || undefined) as any)}
                        value={value || ''}
                        className="border border-gray-300 rounded-md py-2 px-3 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full text-sm"
                    >
                        <option value="">All</option>
                        {sortedValues.map(v => {
                            const str = String(v);
                            const label = cfg.key === 'priority'
                                ? (str === '__none__' ? 'None' : str.charAt(0).toUpperCase() + str.slice(1))
                                : str;
                            return (
                                <option key={str} value={str}>{label}</option>
                            );
                        })}
                    </select>
                    {(value !== undefined && value !== '') && (
                        <button
                            type="button"
                            className="filter-clear"
                            onClick={() => updateFilter(cfg.key as keyof FiltersState, undefined)}
                            aria-label={`Clear ${cfg.label}`}
                        >
                            ×
                        </button>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="list-container">
            <div className="list-content">
                <div className="list-header">
                    <h2 className="list-title">Goals</h2>
                    <button
                        onClick={handleCreateGoal}
                        className="new-goal-button"
                    >
                        <svg className="new-goal-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>New Goal</span>
                    </button>
                </div>

                <div className="search-section">
                    <input
                        type="text"
                        placeholder="Search goals..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input"
                        spellCheck="false"
                        autoComplete="off"
                    />
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="filter-toggle-button"
                    >
                        <svg className="filter-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707l-5.414 5.414a1 1 0 00-.293.707v4.586a1 1 0 01-.293.707l-2 2A1 1 0 0112 20v-5.586a1 1 0 00-.293-.707L6.293 7.707A1 1 0 016 7V4z" />
                        </svg>
                    </button>
                </div>

                {showFilters && (
                    <div className="filters-section show">
                        <div className="filters-header">
                            <h3 className="filters-title">Filters</h3>
                            <button
                                onClick={() => {
                                    setFilters({});
                                    setSearchQuery('');
                                }}
                                className="reset-filters-button"
                            >
                                Reset All
                            </button>
                        </div>
                        <div className="filters-grid">
                            {FIELD_CONFIG.filter(c => c.filterable).map(cfg => (
                                <div key={String(cfg.key)} className="filter-control">
                                    <label className="filter-label">{cfg.label}</label>
                                    {renderFilterControl(cfg)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="table-container">
                    <div className="table-wrapper">
                        <table className="goals-table">
                            <thead className="table-header">
                                <tr>
                                    {FIELD_CONFIG.map(({ key, label, width }) => (
                                        <th
                                            key={key}
                                            style={{ width }}
                                            onClick={() => handleSort(key)}
                                        >
                                            <div className="header-content">
                                                {label}
                                                {sortConfig.key === key && (
                                                    <span className="sort-indicator">
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
                                    const goalStyle = getGoalStyle(goal);
                                    return (
                                        <tr
                                            key={goal.id}
                                            className="table-row"
                                            style={{
                                                borderLeft: `4px solid ${goalStyle.backgroundColor}`,
                                                border: goalStyle.border,
                                            }}
                                            onClick={() => handleGoalClick(goal)}
                                            onContextMenu={(e) => handleGoalContextMenu(e, goal)}
                                        >
                                            <td className="table-cell">{goal.name}</td>
                                            <td className="table-cell">
                                                <span
                                                    className="goal-type-badge"
                                                    style={{
                                                        backgroundColor: `${goalStyle.backgroundColor}20`,
                                                        color: goalStyle.backgroundColor
                                                    }}
                                                >
                                                    {goal.goal_type}
                                                </span>
                                            </td>
                                            <td className="table-cell">{goal.description}</td>
                                            <td className="table-cell">
                                                {goal.priority && (
                                                    <span
                                                        className="priority-badge"
                                                        data-priority={goal.priority}
                                                    >
                                                        {goal.priority}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="table-cell">
                                                <span className={`status-badge ${goal.completed ? 'completed' : 'in-progress'}`}>
                                                    {goal.completed ? 'Completed' : 'In Progress'}
                                                </span>
                                            </td>
                                            <td className="table-cell">
                                                {goal.start_timestamp && new Date(goal.start_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="table-cell">
                                                {goal.end_timestamp && new Date(goal.end_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="table-cell">
                                                {goal.scheduled_timestamp && new Date(goal.scheduled_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="table-cell">
                                                {goal.next_timestamp && new Date(goal.next_timestamp).toLocaleDateString()}
                                            </td>
                                            <td className="table-cell">
                                                {goal.frequency && (
                                                    <span className="frequency-badge">
                                                        {formatFrequency(goal.frequency)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="table-cell">
                                                {goal.duration && (
                                                    <span className="duration-badge">
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
