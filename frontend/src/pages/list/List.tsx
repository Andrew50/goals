import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Goal, ApiGoal, ResolutionStatus } from '../../types/goals'; // Import ApiGoal
import { getGoalStyle } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import './List.css';
import '../../shared/styles/badges.css';
import { SearchBar } from '../../shared/components/SearchBar';
import { formatFrequency } from '../../shared/utils/frequency';
import { deleteGoal, duplicateGoal, updateGoal, completeGoal, deleteEvent, updateEvent } from '../../shared/utils/api';

type FieldType = 'text' | 'enum' | 'number' | 'boolean' | 'date';
type ColumnKey = keyof Goal;

type FieldConfig = {
    key: ColumnKey;
    label: string;
    width?: string;
    type: FieldType;
    sortable?: boolean;
    filterable?: boolean;
    multi?: boolean; // whether the filter supports multi-selection
};

const FIELD_CONFIG: FieldConfig[] = [
    { key: 'name', label: 'Name', width: '15%', type: 'text', sortable: true, filterable: false },
    { key: 'goal_type', label: 'Type', width: '8%', type: 'enum', sortable: true, filterable: true, multi: true },
    { key: 'description', label: 'Description', width: '20%', type: 'text', sortable: false, filterable: false },
    { key: 'priority', label: 'Priority', width: '7%', type: 'enum', sortable: true, filterable: true, multi: true },
    { key: 'resolution_status', label: 'Status', width: '8%', type: 'enum', sortable: true, filterable: true, multi: true },
    { key: 'start_timestamp', label: 'Start Date', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'end_timestamp', label: 'End Date', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'scheduled_timestamp', label: 'Scheduled', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'next_timestamp', label: 'Next Due', width: '8%', type: 'date', sortable: true, filterable: true },
    { key: 'frequency', label: 'Frequency', width: '5%', type: 'enum', sortable: true, filterable: true, multi: true },
    { key: 'duration', label: 'Duration', width: '5%', type: 'number', sortable: true, filterable: true },
];

type DateRange = { from?: string; to?: string };
type FiltersState = {
    goal_type?: string[];
    priority?: string[]; // 'low' | 'medium' | 'high' | '__none__'
    resolution_status?: ResolutionStatus[];
    frequency?: string[];
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
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isBulkWorking, setIsBulkWorking] = useState(false);
    const [bulkPriority, setBulkPriority] = useState<string>('');
    const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

    // Debug refs to track previous values for logging
    const prevSelectedSizeRef = useRef<number>(0);
    const prevFiltersRef = useRef<string>(JSON.stringify(filters));
    const prevSearchRef = useRef<string>(searchQuery);

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

    const [searchIds, setSearchIds] = useState<Set<number>>(new Set());

    const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K] | undefined) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const toggleValueInArray = <T,>(arr: T[] | undefined, value: T, checked: boolean): T[] | undefined => {
        const current = arr ?? [];
        if (checked) {
            if (!current.some(v => v === value)) return [...current, value];
            return current;
        }
        const next = current.filter(v => v !== value);
        return next.length > 0 ? next : undefined;
    };

    const filteredList = useMemo(() => {
        let filtered = list;

        // Hide soft-deleted events from the List view
        filtered = filtered.filter(g => !(g.goal_type === 'event' && g.is_deleted === true));

        const inRange = (val?: string | number | null, range?: DateRange): boolean => {
            if (val === undefined || val === null) return range === undefined; // treat no value as pass unless a range is set
            if (!range || (!range.from && !range.to)) return true;
            const t = new Date(val as any).getTime();
            const from = range.from ? new Date(range.from).getTime() : -Infinity;
            const to = range.to ? new Date(range.to).getTime() : Infinity;
            return t >= from && t <= to;
        };

        // Build selected sets for O(1) membership checks
        const goalTypeSet = (filters.goal_type && filters.goal_type.length > 0) ? new Set(filters.goal_type) : undefined;
        const frequencySet = (filters.frequency && filters.frequency.length > 0) ? new Set(filters.frequency) : undefined;
        const prioritySet = (filters.priority && filters.priority.length > 0) ? new Set(filters.priority) : undefined;
        const resolutionStatusSet = (filters.resolution_status && filters.resolution_status.length > 0) ? new Set(filters.resolution_status) : undefined;

        // Enum and primitive filters with multi-selection
        if (goalTypeSet) {
            filtered = filtered.filter(g => g.goal_type !== undefined && goalTypeSet.has(g.goal_type as any));
        }
        if (frequencySet) {
            filtered = filtered.filter(g => g.frequency !== undefined && frequencySet.has(g.frequency as any));
        }
        if (resolutionStatusSet) {
            filtered = filtered.filter(g => resolutionStatusSet.has(g.resolution_status || 'pending'));
        }
        if (prioritySet) {
            filtered = filtered.filter(g => {
                const hasNone = prioritySet.has('__none__' as any);
                if (g.priority === undefined || g.priority === null) {
                    return hasNone;
                }
                return prioritySet.has(g.priority as any);
            });
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
            filtered = filtered.filter(item => searchIds.has(item.id));
        }

        return filtered;
    }, [list, filters, searchQuery, searchIds]);

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

    // Visible IDs and selection meta
    const visibleIds = useMemo(() => sortedList.map(g => g.id), [sortedList]);
    const numSelectedVisible = useMemo(() => visibleIds.filter(id => selectedIds.has(id)).length, [visibleIds, selectedIds]);
    const allVisibleSelected = useMemo(() => visibleIds.length > 0 && numSelectedVisible === visibleIds.length, [visibleIds, numSelectedVisible]);
    const isIndeterminate = useMemo(() => numSelectedVisible > 0 && !allVisibleSelected, [numSelectedVisible, allVisibleSelected]);

    // Keep header checkbox indeterminate UI in sync
    useEffect(() => {
        if (headerCheckboxRef.current) {
            headerCheckboxRef.current.indeterminate = isIndeterminate;
        }
    }, [isIndeterminate]);

    // Prune selection when list refreshes
    useEffect(() => {
        if (selectedIds.size === 0) return;
        const present = new Set(list.map(g => g.id));
        const next = new Set<number>();
        selectedIds.forEach(id => { if (present.has(id)) next.add(id); });
        if (next.size !== selectedIds.size) setSelectedIds(next);
    }, [list, selectedIds]);

    // Clear selection when filters or search change (not when selection changes)
    useEffect(() => {
        const prevSelectedSize = prevSelectedSizeRef.current;
        const prevFiltersStr = prevFiltersRef.current;
        const prevSearch = prevSearchRef.current;
        const currFiltersStr = JSON.stringify(filters);

        const changedBecauseSelectedSize = prevSelectedSize !== selectedIds.size;
        const changedBecauseFilters = prevFiltersStr !== currFiltersStr;
        const changedBecauseSearch = prevSearch !== searchQuery;

        console.log('[List] Clear-selection effect fired', {
            selectedSize: selectedIds.size,
            changedBecauseSelectedSize,
            changedBecauseFilters,
            changedBecauseSearch,
        });

        if (selectedIds.size > 0 && (changedBecauseFilters || changedBecauseSearch)) {
            console.log('[List] Clearing selection due to filters/search change');
            setSelectedIds(new Set());
        }

        prevSelectedSizeRef.current = selectedIds.size;
        prevFiltersRef.current = currFiltersStr;
        prevSearchRef.current = searchQuery;
    }, [filters, searchQuery, selectedIds.size]);

    const toggleSelectOne = (goalId: number, checked: boolean) => {
        console.log('[List] toggleSelectOne', { goalId, checked, beforeIds: Array.from(selectedIds) });
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(goalId); else next.delete(goalId);
            console.log('[List] toggleSelectOne -> nextIds', Array.from(next));
            return next;
        });
    };

    const toggleSelectAllVisible = (checked: boolean) => {
        console.log('[List] toggleSelectAllVisible', { checked, visibleIds });
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) {
                visibleIds.forEach(id => next.add(id));
            } else {
                visibleIds.forEach(id => next.delete(id));
            }
            console.log('[List] toggleSelectAllVisible -> nextIds', Array.from(next));
            return next;
        });
    };

    // Log whenever selectedIds reference changes
    useEffect(() => {
        console.log('[List] selectedIds changed', Array.from(selectedIds));
    }, [selectedIds]);

    const getSelectedGoals = (): Goal[] => list.filter(g => selectedIds.has(g.id));

    const refreshAndClearSelection = () => {
        setSelectedIds(new Set());
        setRefreshTrigger(prev => prev + 1);
    };

    const handleBulkComplete = async (completed: boolean) => {
        if (selectedIds.size === 0) return;
        setIsBulkWorking(true);
        const selectedGoals = getSelectedGoals();
        try {
            await Promise.all(selectedGoals.map(async (g) => {
                if (g.goal_type === 'event') {
                    await updateEvent(g.id, { completed });
                } else {
                    await completeGoal(g.id, completed);
                }
            }));
            refreshAndClearSelection();
        } catch (e) {
            console.error('Bulk complete failed:', e);
            refreshAndClearSelection();
        } finally {
            setIsBulkWorking(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm('Delete selected items? This cannot be undone.')) return;
        setIsBulkWorking(true);
        const selectedGoals = getSelectedGoals();
        try {
            await Promise.all(selectedGoals.map(async (g) => {
                if (g.goal_type === 'event') {
                    await deleteEvent(g.id, false);
                } else {
                    await deleteGoal(g.id);
                }
            }));
            refreshAndClearSelection();
        } catch (e) {
            console.error('Bulk delete failed:', e);
            refreshAndClearSelection();
        } finally {
            setIsBulkWorking(false);
        }
    };

    const handleBulkDuplicate = async () => {
        if (selectedIds.size === 0) return;
        const selectedGoals = getSelectedGoals();
        const hasEvent = selectedGoals.some(g => g.goal_type === 'event');
        if (hasEvent) return;
        setIsBulkWorking(true);
        try {
            await Promise.all(selectedGoals.map(async (g) => {
                await duplicateGoal(g.id);
            }));
            refreshAndClearSelection();
        } catch (e) {
            console.error('Bulk duplicate failed:', e);
            refreshAndClearSelection();
        } finally {
            setIsBulkWorking(false);
        }
    };

    const handleBulkPriorityApply = async () => {
        if (!bulkPriority) return;
        if (selectedIds.size === 0) return;
        const selectedGoals = getSelectedGoals();
        const hasEvent = selectedGoals.some(g => g.goal_type === 'event');
        if (hasEvent) return;
        setIsBulkWorking(true);
        try {
            await Promise.all(selectedGoals.map(async (g) => {
                await updateGoal(g.id, { ...g, priority: bulkPriority as 'high' | 'medium' | 'low' });
            }));
            setBulkPriority('');
            refreshAndClearSelection();
        } catch (e) {
            console.error('Bulk priority failed:', e);
            refreshAndClearSelection();
        } finally {
            setIsBulkWorking(false);
        }
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
            const selected = (filters[cfg.key as keyof FiltersState] as boolean[] | undefined) ?? undefined;
            if (cfg.multi) {
                const isSelected = (val: boolean) => selected ? selected.includes(val) : false;
                return (
                    <div className="filter-input-wrapper">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                                type="checkbox"
                                checked={isSelected(false)}
                                onChange={(e) => {
                                    const next = toggleValueInArray(selected, false, e.target.checked);
                                    updateFilter(cfg.key as keyof FiltersState, next as any);
                                }}
                                aria-label="In Progress"
                            />
                            <span>In Progress</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <input
                                type="checkbox"
                                checked={isSelected(true)}
                                onChange={(e) => {
                                    const next = toggleValueInArray(selected, true, e.target.checked);
                                    updateFilter(cfg.key as keyof FiltersState, next as any);
                                }}
                                aria-label="Completed"
                            />
                            <span>Completed</span>
                        </label>
                        {(selected && selected.length > 0) && (
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
            // Fallback single-select UI
            const value = (filters[cfg.key as keyof FiltersState] as unknown as boolean | undefined);
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
            const isAllDaySelected = value === 1440;
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
                        disabled={isAllDaySelected}
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
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
                        <input
                            type="checkbox"
                            checked={isAllDaySelected}
                            onChange={(e) => {
                                updateFilter(cfg.key as keyof FiltersState, (e.target.checked ? 1440 : undefined) as any);
                            }}
                            aria-label="All day"
                        />
                        <span>All day</span>
                    </label>
                </div>
            );
        }
        if (cfg.type === 'enum') {
            const selected = filters[cfg.key as keyof FiltersState] as string[] | undefined;
            const options = cfg.key === 'goal_type' ? enumOptions.goal_type : cfg.key === 'frequency' ? enumOptions.frequency : cfg.key === 'priority' ? enumOptions.priority : [];
            const sortedValues = cfg.key === 'priority' ? options : [...options].sort((a, b) => a.toString().localeCompare(b.toString()));
            if (cfg.multi) {
                const selectedSet = new Set(selected ?? []);
                return (
                    <div className="filter-input-wrapper">
                        <div className="grid grid-cols-1 gap-1">
                            {sortedValues.map(v => {
                                const str = String(v);
                                const label = cfg.key === 'priority'
                                    ? (str === '__none__' ? 'None' : str.charAt(0).toUpperCase() + str.slice(1))
                                    : str;
                                const isChecked = selectedSet.has(str);
                                return (
                                    <label key={str} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                                const next = toggleValueInArray(selected, str, e.target.checked);
                                                updateFilter(cfg.key as keyof FiltersState, next as any);
                                            }}
                                            aria-label={label}
                                        />
                                        <span>{label}</span>
                                    </label>
                                );
                            })}
                        </div>
                        {(selected && selected.length > 0) && (
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
            // Fallback single-select UI
            const value = (filters[cfg.key as keyof FiltersState] as unknown as string | undefined);
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

                <div className="toolbar-row">
                    {selectedIds.size > 0 ? (
                        <div className="bulk-actions-bar">
                            <div className="bulk-actions-left">
                                <span>{selectedIds.size} selected</span>
                                <button
                                    type="button"
                                    className="bulk-actions-button"
                                    onClick={() => handleBulkComplete(true)}
                                    disabled={isBulkWorking}
                                    aria-label="Mark completed"
                                >
                                    Mark completed
                                </button>
                                <button
                                    type="button"
                                    className="bulk-actions-button"
                                    onClick={() => handleBulkComplete(false)}
                                    disabled={isBulkWorking}
                                    aria-label="Mark in progress"
                                >
                                    Mark in progress
                                </button>
                                <div className="bulk-priority">
                                    <select
                                        className="bulk-actions-select"
                                        value={bulkPriority}
                                        onChange={(e) => setBulkPriority(e.target.value)}
                                        disabled={isBulkWorking}
                                        aria-label="Select priority"
                                    >
                                        <option value="">Set priority…</option>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    className="bulk-actions-button"
                                    onClick={handleBulkPriorityApply}
                                    disabled={isBulkWorking || !bulkPriority}
                                    aria-label="Apply priority"
                                >
                                    Apply
                                </button>
                                <button
                                    type="button"
                                    className="bulk-actions-button"
                                    onClick={() => {
                                        // Open GoalMenu in edit mode with a blank template, prefilled with common filtered values
                                        const template: Partial<Goal> = {};
                                        // Prefill goal_type if a single filter value is set
                                        if (filters.goal_type && filters.goal_type.length === 1) {
                                            (template as any).goal_type = filters.goal_type[0];
                                        }
                                        // Prefill priority if exactly one selected
                                        if (filters.priority && filters.priority.length === 1 && filters.priority[0] !== '__none__') {
                                            (template as any).priority = filters.priority[0];
                                        }
                // Prefill resolution_status if exactly one status filter selected
                if (filters.resolution_status && filters.resolution_status.length === 1) {
                    (template as any).resolution_status = filters.resolution_status[0];
                                        }

                                        const blank: Goal = {
                                            id: -1,
                                            name: '',
                                            goal_type: (template as any).goal_type || 'task',
                                            ...template as any,
                                        } as Goal;

                                        const selectedGoals = getSelectedGoals();

                                        const submit = async (updated: Goal) => {
                                            setIsBulkWorking(true);
                                            try {
                                                // Compute changed fields vs the template blank
                                                const changed: Partial<Goal> = {};
                                                const keys: (keyof Goal)[] = [
                                                    'name', 'description', 'goal_type', 'priority', 'resolution_status', 'start_timestamp', 'end_timestamp', 'scheduled_timestamp', 'next_timestamp', 'frequency', 'duration', 'due_date', 'start_date', 'routine_time'
                                                ];
                                                for (const k of keys) {
                                                    const newVal = (updated as any)[k];
                                                    const oldVal = (blank as any)[k];
                                                    const isDate = newVal instanceof Date || oldVal instanceof Date;
                                                    const equal = isDate
                                                        ? (newVal instanceof Date && oldVal instanceof Date && newVal.getTime() === oldVal.getTime())
                                                        : newVal === oldVal;
                                                    if (!equal && newVal !== undefined) {
                                                        (changed as any)[k] = newVal;
                                                    }
                                                }

                                                // Apply changed fields to all selected
                                                await Promise.all(selectedGoals.map(async (g) => {
                                                    // Skip goal_type changes for events
                                                    const payload: Partial<Goal> = { ...changed };
                                                    if (g.goal_type === 'event') {
                                                        // Map applicable fields to updateEvent
                                                        const eventUpdates: any = {};
                                                        if (payload.name !== undefined) eventUpdates.name = payload.name;
                                                        if (payload.description !== undefined) eventUpdates.description = payload.description;
                                                        if (payload.priority !== undefined) eventUpdates.priority = payload.priority;
                                                        if (payload.duration !== undefined) eventUpdates.duration = payload.duration;
                                                        if (payload.resolution_status !== undefined) eventUpdates.resolution_status = payload.resolution_status;
                                                        if (payload.scheduled_timestamp !== undefined) eventUpdates.scheduled_timestamp = payload.scheduled_timestamp as any;
                                                        if (Object.keys(eventUpdates).length > 0) {
                                                            await updateEvent(g.id, eventUpdates);
                                                        }
                                                    } else {
                                                        // Non-events
                                                        const goalUpdates: Goal = { ...g, ...payload } as Goal;
                                                        await updateGoal(g.id, goalUpdates);
                                                    }
                                                }));
                                                refreshAndClearSelection();
                                            } finally {
                                                setIsBulkWorking(false);
                                            }
                                        };

                                        // Use GoalMenu with submit override
                                        (GoalMenu as any).openWithSubmitOverride(blank, 'edit', async (u: Goal) => submit(u), () => { });
                                    }}
                                    disabled={isBulkWorking}
                                    aria-label="Bulk edit"
                                >
                                    Edit…
                                </button>
                                <button
                                    type="button"
                                    className="bulk-actions-button"
                                    onClick={handleBulkDuplicate}
                                    disabled={isBulkWorking || list.filter(g => selectedIds.has(g.id)).some(g => g.goal_type === 'event')}
                                    aria-label="Duplicate"
                                >
                                    Duplicate
                                </button>
                                <button
                                    type="button"
                                    className="bulk-actions-button danger"
                                    onClick={handleBulkDelete}
                                    disabled={isBulkWorking}
                                    aria-label="Delete"
                                >
                                    Delete
                                </button>
                            </div>
                            <div className="bulk-actions-right">
                                <button
                                    type="button"
                                    className="bulk-actions-button secondary"
                                    onClick={() => setSelectedIds(new Set())}
                                    disabled={isBulkWorking}
                                    aria-label="Clear selection"
                                >
                                    Clear selection
                                </button>
                            </div>
                        </div>
                    ) : (
                        <SearchBar
                            items={list}
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onResults={(_, ids) => setSearchIds(new Set(ids))}
                            showFilterToggle
                            filterActive={showFilters}
                            onFilterToggle={() => setShowFilters(v => !v)}
                            useLegacyListStyles
                        />
                    )}
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
                                    <th className="selection-header" style={{ width: '40px', cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
                                        <input
                                            ref={headerCheckboxRef}
                                            type="checkbox"
                                            aria-label="Select all"
                                            checked={allVisibleSelected}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                toggleSelectAllVisible(!allVisibleSelected);
                                            }}
                                            disabled={sortedList.length === 0}
                                        />
                                    </th>
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
                                                borderLeft: `4px solid ${goalStyle.backgroundColor}`
                                            }}
                                            onClick={() => handleGoalClick(goal)}
                                            onContextMenu={(e) => handleGoalContextMenu(e, goal)}
                                        >
                                            <td className="selection-cell" onClick={(e) => e.stopPropagation()} style={{ width: '40px' }}>
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Select ${goal.name}`}
                                                    checked={selectedIds.has(goal.id)}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        toggleSelectOne(goal.id, e.target.checked);
                                                    }}
                                                    disabled={isBulkWorking}
                                                />
                                            </td>
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
                                                <span className={`status-badge ${goal.resolution_status === 'completed' ? 'completed' : goal.resolution_status || 'pending'}`}>
                                                    {goal.resolution_status === 'completed' ? 'Completed' : 
                                                     goal.resolution_status === 'failed' ? 'Failed' : 
                                                     goal.resolution_status === 'skipped' ? 'Skipped' : 'In Progress'}
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
                                                        {goal.duration === 1440 ? 'All day' : `${goal.duration} min`}
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
