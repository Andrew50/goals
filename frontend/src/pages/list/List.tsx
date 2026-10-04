import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import React, { useEffect, useState, useMemo, useRef, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Goal, ApiGoal, ResolutionStatus } from '../../types/goals'; // Import ApiGoal
import { getGoalStyle } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import './List.css';
import '../../shared/styles/badges.css';
import NewButton from '../../shared/components/NewButton';
import { SearchBar } from '../../shared/components/SearchBar';
import { formatFrequency } from '../../shared/utils/frequency';
import { deleteGoal, duplicateGoal, updateGoal, resolveGoal, deleteEvent, updateEvent } from '../../shared/utils/api';

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

const PAGE_SIZE = 100;
const GOAL_TYPE_OPTIONS = ['directive', 'project', 'achievement', 'routine', 'task', 'event'];
const PRIORITY_OPTIONS = ['__none__', 'low', 'medium', 'high'];
const STATUS_OPTIONS = ['pending', 'completed', 'failed', 'skipped'];

type DateRange = { from?: string; to?: string };

type ListPageResponse = {
    items: ApiGoal[];
    total: number;
    facets?: { frequency: string[] };
};

type ListGoal = Goal & {
    startLabel: string;
    endLabel: string;
    scheduledLabel: string;
    nextLabel: string;
};

function formatDay(value?: Date | null): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
    return value.toLocaleDateString();
}

function toListGoal(apiGoal: ApiGoal): ListGoal {
    const goal = goalToLocal(apiGoal);
    return {
        ...goal,
        startLabel: formatDay(goal.start_timestamp),
        endLabel: formatDay(goal.end_timestamp),
        scheduledLabel: formatDay(goal.scheduled_timestamp),
        nextLabel: formatDay(goal.next_timestamp),
    };
}

function dateInputStartMs(value?: string): number | undefined {
    if (!value) return undefined;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return undefined;
    return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function dateInputEndMs(value?: string): number | undefined {
    if (!value) return undefined;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return undefined;
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}
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

type ListRowProps = {
    goal: ListGoal;
    selected: boolean;
    disabled: boolean;
    index: number;
    measureRef: (node: HTMLTableRowElement | null) => void;
    onToggle: (id: number, checked: boolean) => void;
    onOpen: (goal: Goal) => void;
    onContext: (event: React.MouseEvent, goal: Goal) => void;
};

const ListRow = memo(function ListRow({
    goal,
    selected,
    disabled,
    index,
    measureRef,
    onToggle,
    onOpen,
    onContext,
}: ListRowProps) {
    const goalStyle = getGoalStyle(goal);
    return (
        <tr
            data-index={index}
            ref={measureRef}
            className="table-row"
            style={{ borderLeft: `4px solid ${goalStyle.backgroundColor}` }}
            onClick={() => onOpen(goal)}
            onContextMenu={(event) => onContext(event, goal)}
        >
            <td className="selection-cell" onClick={(event) => event.stopPropagation()} style={{ width: '40px' }}>
                <input
                    type="checkbox"
                    aria-label={`Select ${goal.name}`}
                    checked={selected}
                    onChange={(event) => {
                        event.stopPropagation();
                        onToggle(goal.id, event.target.checked);
                    }}
                    disabled={disabled}
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
                    <span className="priority-badge" data-priority={goal.priority}>
                        {goal.priority}
                    </span>
                )}
            </td>
            <td className="table-cell">
                <span className={`status-badge ${goal.resolution_status === 'completed' ? 'completed' : goal.resolution_status === 'failed' ? 'failed' : goal.resolution_status === 'skipped' ? 'skipped' : 'in-progress'}`}>
                    {goal.resolution_status === 'completed' ? 'Completed' :
                        goal.resolution_status === 'failed' ? 'Failed' :
                            goal.resolution_status === 'skipped' ? 'Skipped' : 'In Progress'}
                </span>
            </td>
            <td className="table-cell">{goal.startLabel}</td>
            <td className="table-cell">{goal.endLabel}</td>
            <td className="table-cell">{goal.scheduledLabel}</td>
            <td className="table-cell">{goal.nextLabel}</td>
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
});

const List: React.FC = () => {
    const [list, setList] = useState<ListGoal[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [frequencyFacets, setFrequencyFacets] = useState<string[]>([]);
    const [filters, setFilters] = useState<FiltersState>({});
    const [sortConfig, setSortConfig] = useState<{
        key: keyof Goal | null;
        direction: 'asc' | 'desc';
    }>({ key: null, direction: 'asc' });
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isBulkWorking, setIsBulkWorking] = useState(false);
    const [bulkPriority, setBulkPriority] = useState<string>('');
    const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
    const tableRef = useRef<HTMLDivElement | null>(null);
    const facetsLoadedRef = useRef(false);

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 200);
        return () => clearTimeout(handle);
    }, [searchQuery]);

    const filterKey = JSON.stringify({ filters, debouncedSearch, sortConfig });
    const filterKeyRef = useRef(filterKey);

    useEffect(() => {
        if (filterKeyRef.current !== filterKey) {
            filterKeyRef.current = filterKey;
            if (offset !== 0) {
                setOffset(0);
                return;
            }
        }

        let cancelled = false;
        const load = async () => {
            setListLoading(true);
            setListError(null);
            try {
                const params = new URLSearchParams();
                params.set('limit', String(PAGE_SIZE));
                params.set('offset', String(offset));
                if (!facetsLoadedRef.current) params.set('include_facets', '1');
                if (debouncedSearch) params.set('q', debouncedSearch);
                if (sortConfig.key) {
                    params.set('sort', String(sortConfig.key));
                    params.set('dir', sortConfig.direction);
                }
                const appendCsv = (key: string, values?: string[]) => {
                    if (values && values.length > 0) params.set(key, values.join(','));
                };
                appendCsv('goal_type', filters.goal_type);
                appendCsv('priority', filters.priority);
                appendCsv('resolution_status', filters.resolution_status);
                appendCsv('frequency', filters.frequency);
                if (filters.duration !== undefined) params.set('duration', String(filters.duration));
                const addRange = (prefix: string, range?: DateRange) => {
                    const from = dateInputStartMs(range?.from);
                    const to = dateInputEndMs(range?.to);
                    if (from !== undefined) params.set(`${prefix}_from`, String(from));
                    if (to !== undefined) params.set(`${prefix}_to`, String(to));
                };
                addRange('start', filters.start_timestamp);
                addRange('end', filters.end_timestamp);
                addRange('scheduled', filters.scheduled_timestamp);
                addRange('next', filters.next_timestamp);

                const page = await privateRequest<ListPageResponse>(`list?${params.toString()}`);
                if (cancelled) return;
                if (page.facets?.frequency) {
                    setFrequencyFacets(page.facets.frequency);
                    facetsLoadedRef.current = true;
                }
                setTotal(page.total ?? 0);
                setList((page.items ?? []).map(toListGoal));
            } catch (error) {
                console.error('Failed to fetch list:', error);
                if (!cancelled) {
                    setListError('Could not load goals. Try again.');
                    setList([]);
                    setTotal(0);
                }
            } finally {
                if (!cancelled) setListLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
        // filterKey already changes when the filter, search, and sort fields change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterKey, offset, refreshTrigger]);

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

    // Visible IDs and selection meta. The server already filtered and sorted this page.
    const visibleIds = useMemo(() => list.map(g => g.id), [list]);
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

    // Clear selection when the server query changes, not when the selection itself changes.
    const selectionQueryRef = useRef(filterKey);
    useEffect(() => {
        if (selectionQueryRef.current !== filterKey) {
            selectionQueryRef.current = filterKey;
            setSelectedIds(new Set());
        }
    }, [filterKey]);

    const toggleSelectOne = useCallback((goalId: number, checked: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(goalId); else next.delete(goalId);
            return next;
        });
    }, []);

    const toggleSelectAllVisible = (checked: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) {
                visibleIds.forEach(id => next.add(id));
            } else {
                visibleIds.forEach(id => next.delete(id));
            }
            return next;
        });
    };

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
                const status: ResolutionStatus = completed ? 'completed' : 'pending';
                if (g.goal_type === 'event') {
                    await updateEvent(g.id, { resolution_status: status });
                } else {
                    await resolveGoal(g.id, status);
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

    const openFullGoal = useCallback(async (goal: Goal, mode: 'view' | 'edit') => {
        const refresh = () => setRefreshTrigger(prev => prev + 1);
        try {
            const full = await privateRequest<ApiGoal>(`goals/${goal.id}`);
            GoalMenu.open(goalToLocal(full), mode, refresh);
        } catch (error) {
            console.error('Failed to load goal:', error);
            GoalMenu.open(goal, mode, refresh);
        }
    }, []);

    const handleGoalClick = useCallback((goal: Goal) => {
        openFullGoal(goal, 'view');
    }, [openFullGoal]);

    const handleGoalContextMenu = useCallback((event: React.MouseEvent, goal: Goal) => {
        event.preventDefault();
        openFullGoal(goal, 'edit');
    }, [openFullGoal]);

    const handleCreateGoal = () => {
        GoalMenu.open({} as Goal, 'create', (newGoal) => {
            // Trigger a refresh instead of manually updating the list
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleSort = (key: keyof Goal) => {
        setSortConfig(prevConfig => {
            // If clicking a different column, start with ascending
            if (prevConfig.key !== key) {
                return { key, direction: 'asc' };
            }
            // If clicking the same column, cycle: asc -> desc -> no sort
            if (prevConfig.direction === 'asc') {
                return { key, direction: 'desc' };
            }
            // If currently descending, reset to no sort
            return { key: null, direction: 'asc' };
        });
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
            const options = cfg.key === 'goal_type'
                ? GOAL_TYPE_OPTIONS
                : cfg.key === 'frequency'
                    ? frequencyFacets
                    : cfg.key === 'priority'
                        ? PRIORITY_OPTIONS
                        : cfg.key === 'resolution_status'
                            ? STATUS_OPTIONS
                            : [];
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

    const rowVirtualizer = useVirtualizer({
        count: list.length,
        getScrollElement: () => tableRef.current,
        estimateSize: () => 56,
        overscan: 8,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
    const paddingBottom = virtualRows.length > 0
        ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
        : 0;
    const pageStart = total === 0 ? 0 : offset + 1;
    const pageEnd = Math.min(offset + list.length, total);
    const columnCount = FIELD_CONFIG.length + 1;

    return (
        <div className="list-container">
            <div className="list-content">
                <div className="list-header">
                    <h2 className="list-title">Goals</h2>
                    <NewButton onClick={handleCreateGoal} />
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
                            items={[]}
                            serverSearch
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onResults={() => {}}
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


                <div className="list-pagination">
                    <span>{listLoading ? 'Loading…' : `${pageStart}–${pageEnd} of ${total}`}</span>
                    <button
                        type="button"
                        onClick={() => setOffset(current => Math.max(0, current - PAGE_SIZE))}
                        disabled={listLoading || offset === 0}
                    >
                        Previous
                    </button>
                    <button
                        type="button"
                        onClick={() => setOffset(current => current + PAGE_SIZE)}
                        disabled={listLoading || offset + list.length >= total}
                    >
                        Next
                    </button>
                </div>
                {listError && <div className="list-error">{listError}</div>}

                <div className="table-container">
                    <div className="table-wrapper" ref={tableRef}>
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
                                            disabled={list.length === 0}
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
                                {paddingTop > 0 && (
                                    <tr><td colSpan={columnCount} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>
                                )}
                                {virtualRows.map(virtualRow => {
                                    const goal = list[virtualRow.index];
                                    return (
                                        <ListRow
                                            key={goal.id}
                                            goal={goal}
                                            index={virtualRow.index}
                                            selected={selectedIds.has(goal.id)}
                                            disabled={isBulkWorking}
                                            measureRef={rowVirtualizer.measureElement}
                                            onToggle={toggleSelectOne}
                                            onOpen={handleGoalClick}
                                            onContext={handleGoalContextMenu}
                                        />
                                    );
                                })}
                                {paddingBottom > 0 && (
                                    <tr><td colSpan={columnCount} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default List;
