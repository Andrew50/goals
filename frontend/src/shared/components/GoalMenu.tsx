import React, { useState, useEffect, useCallback, ChangeEvent, useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useHistoryState } from '../hooks/useHistoryState';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    FormControlLabel,
    Checkbox,
    Box,
    Typography,
    Autocomplete,
    Chip,
    IconButton,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    FormControl,
    RadioGroup,
    Radio,
    Card,
    CardContent,
    Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { createGoal, updateGoal, deleteGoal, createRelationship, deleteRelationship, updateRoutines, completeGoal, completeEvent, deleteEvent, splitEvent, createEvent, getTaskEvents, updateEvent, updateRoutineEvent, updateRoutineEventProperties, TaskDateValidationError } from '../utils/api';
import { Goal, GoalType, NetworkEdge, ApiGoal } from '../../types/goals';
import {
    timestampToInputString,
    inputStringToTimestamp,
    timestampToDisplayString
} from '../utils/time';
import { validateGoal, validateRelationship } from '../utils/goalValidation'
import { formatFrequency } from '../utils/frequency';
import GoalRelations from "./GoalRelations";
import SmartScheduleDialog from "./SmartScheduleDialog";
import { getGoalColor } from '../styles/colors';
import { goalToLocal } from '../utils/time';
import { privateRequest } from '../utils/api';
import Fuse from 'fuse.js';

type Mode = 'create' | 'edit' | 'view';

interface GoalMenuProps {
    goal: Goal;
    mode: Mode;
    onClose: () => void;
    onSuccess: (goal: Goal) => void;
}

// Stats interfaces
interface RoutineStats {
    routine_id: number;
    routine_name: string;
    completion_rate: number;
    total_events: number;
    completed_events: number;
}

interface BasicGoalStats {
    completion_rate?: number;
    total_events: number;
    completed_events: number;
    reschedule_count?: number;
    avg_reschedule_distance_hours?: number;
    last_30_days_completion_rate?: number;
    parent_completion_rate?: number;
    parent_total_events?: number;
    parent_completed_events?: number;
    event_position?: number; // Which event this is (e.g., event 3 of 5)
    event_total?: number; // Total events for the parent
}

// Add routine update dialog state
interface RoutineUpdateDialogState {
    isOpen: boolean;
    updateType: 'scheduled_time' | 'duration' | 'other';
    originalGoal: Goal | null;
    updatedGoal: Goal | null;
    onConfirm: (scope: 'single' | 'all' | 'future') => Promise<void>;
}

const GoalMenu: React.FC<GoalMenuProps> = ({ goal: initialGoal, mode: initialMode, onClose, onSuccess }) => {
    const [isOpen, setIsOpen] = useState(true);
    const [relationsOpen, setRelationsOpen] = useState(false);
    const [parentGoals, setParentGoals] = useState<Goal[]>([]);
    const [childGoals, setChildGoals] = useState<Goal[]>([]);

    // Ensure start_timestamp is set for new goals in create mode
    const processedInitialGoal = useMemo(() => {
        const goalCopy = { ...initialGoal };

        if (goalCopy._tz === undefined) {
            goalCopy._tz = 'user';
        }

        // Set start_timestamp for create mode if not already set
        if (initialMode === 'create' && !goalCopy.start_timestamp) {
            // If we have a scheduled_timestamp (from calendar click), use that as start_timestamp
            // Otherwise default to today
            goalCopy.start_timestamp = goalCopy.scheduled_timestamp || new Date();
        }

        return goalCopy;
    }, [initialGoal, initialMode]);

    const [state, setState] = useHistoryState<{ goal: Goal; error: string; mode: Mode; }>(
        {
            goal: processedInitialGoal,
            error: '',
            mode: initialMode
        },
        {
            hotkeyScope: 'goalMenu',
            onUndo: (newState) => { },
            onRedo: (newState) => { }
        }
    );
    const [title, setTitle] = useState<string>('');
    const [allGoals, setAllGoals] = useState<Goal[]>([]);
    const [selectedParents, setSelectedParents] = useState<Goal[]>([]);
    const [parentSearchQuery, setParentSearchQuery] = useState('');
    const [relationshipType, setRelationshipType] = useState<'child' | 'queue'>('child');

    // Task events management
    const [taskEvents, setTaskEvents] = useState<Goal[]>([]);
    const [totalDuration, setTotalDuration] = useState<number>(0);
    const [showAddEvent, setShowAddEvent] = useState<boolean>(false);
    const [newEventScheduled, setNewEventScheduled] = useState<Date>(new Date());
    const [newEventDuration, setNewEventDuration] = useState<number>(60);

    // Smart schedule dialog management
    const [smartScheduleOpen, setSmartScheduleOpen] = useState<boolean>(false);
    const [smartScheduleContext, setSmartScheduleContext] = useState<{
        type: 'event' | 'new-task-event';
        duration: number;
        eventName?: string;
        currentScheduledTime?: Date;
    } | null>(null);

    // Stats management
    const [goalStats, setGoalStats] = useState<BasicGoalStats | null>(null);
    const [statsLoading, setStatsLoading] = useState<boolean>(false);

    // Add routine update dialog state
    const [routineUpdateDialog, setRoutineUpdateDialog] = useState<RoutineUpdateDialogState>({
        isOpen: false,
        updateType: 'other',
        originalGoal: null,
        updatedGoal: null,
        onConfirm: async () => { }
    });

    // Add routine delete dialog state
    const [routineDeleteDialog, setRoutineDeleteDialog] = useState<{
        isOpen: boolean;
        eventId: number | null;
        eventName: string;
        selectedScope: 'single' | 'all' | 'future';
    }>({
        isOpen: false,
        eventId: null,
        eventName: '',
        selectedScope: 'single'
    });

    // Fetch task events
    const fetchTaskEvents = useCallback(async (taskId: number) => {
        console.log('[GoalMenu] fetchTaskEvents called with taskId:', taskId);
        try {
            const taskEventsData = await getTaskEvents(taskId);
            console.log('[GoalMenu] fetchTaskEvents response:', taskEventsData);
            setTaskEvents(taskEventsData.events);
            setTotalDuration(taskEventsData.total_duration);
            console.log('[GoalMenu] Set taskEvents to:', taskEventsData.events.length, 'events');
        } catch (error) {
            console.error('Failed to fetch task events:', error);
            setTaskEvents([]);
            setTotalDuration(0);
        }
    }, []);

    // Fetch goal stats
    const fetchGoalStats = useCallback(async (goal: Goal) => {
        if (!goal.id || state.mode !== 'view') return;

        setStatsLoading(true);
        try {
            let stats: BasicGoalStats = {
                total_events: 0,
                completed_events: 0
            };

            if (goal.goal_type === 'routine') {
                // Fetch routine-specific stats
                const currentYear = new Date().getFullYear();
                const routineStatsResponse = await privateRequest<RoutineStats[]>(
                    `stats/routines/stats?year=${currentYear}`,
                    'POST',
                    { routine_ids: [goal.id] }
                );

                if (routineStatsResponse.length > 0) {
                    const routineStats = routineStatsResponse[0];
                    stats = {
                        completion_rate: routineStats.completion_rate,
                        total_events: routineStats.total_events,
                        completed_events: routineStats.completed_events
                    };
                }
            } else if (goal.goal_type === 'task' && taskEvents.length > 0) {
                // Calculate stats from task events
                const completedEvents = taskEvents.filter(event => event.completed).length;
                stats = {
                    completion_rate: taskEvents.length > 0 ? completedEvents / taskEvents.length : 0,
                    total_events: taskEvents.length,
                    completed_events: completedEvents
                };
            } else if (goal.goal_type === 'event') {
                console.log('[GoalMenu] Processing event stats. Parent ID:', goal.parent_id, 'Parent goals:', parentGoals);

                // For events, show completion statistics for all sibling events
                if (goal.parent_id && parentGoals.length > 0) {
                    const parent = parentGoals[0];
                    console.log('[GoalMenu] Found parent:', parent.name, 'type:', parent.goal_type, 'id:', parent.id);

                    let siblingEvents: any[] = [];

                    if (parent.goal_type === 'routine') {
                        try {
                            // Get all routine events (sibling events)
                            try {
                                console.log('[GoalMenu] Trying task events API for routine parent:', parent.id);
                                const taskEventsData = await getTaskEvents(parent.id!);
                                siblingEvents = taskEventsData.events;
                                console.log('[GoalMenu] Task events API worked for routine:', siblingEvents);
                            } catch (taskError) {
                                console.log('[GoalMenu] Task events API failed for routine, trying calendar data');
                                // Fallback: get calendar data and filter for this routine's events
                                try {
                                    const calendarData = await privateRequest<any>('calendar');
                                    // Filter events that belong to this routine
                                    siblingEvents = calendarData.events?.filter((e: any) =>
                                        e.parent_id === parent.id || e.routine_id === parent.id
                                    ).map((e: any) => ({
                                        id: e.id,
                                        scheduled_timestamp: e.scheduled_timestamp,
                                        completed: e.completed,
                                        ...e
                                    })) || [];
                                    console.log('[GoalMenu] Calendar data filtered events:', siblingEvents);
                                } catch (calendarError) {
                                    console.log('[GoalMenu] Calendar fallback also failed:', calendarError);
                                    siblingEvents = [];
                                }
                            }
                        } catch (error) {
                            console.error('[GoalMenu] Could not fetch routine events:', error);
                        }
                    } else if (parent.goal_type === 'task') {
                        try {
                            const taskEventsData = await getTaskEvents(parent.id!);
                            siblingEvents = taskEventsData.events;
                        } catch (error) {
                            console.log('Could not fetch task events:', error);
                        }
                    }

                    if (siblingEvents.length > 0) {
                        console.log('[GoalMenu] Found sibling events:', siblingEvents.length);
                        console.log('[GoalMenu] Sample sibling events:', siblingEvents.slice(0, 3).map(e => ({
                            id: e.id,
                            scheduled_timestamp: e.scheduled_timestamp,
                            completed: e.completed,
                            name: e.name
                        })));

                        // Calculate completion statistics for sibling events
                        const now = new Date();
                        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

                        // Filter events by time periods - include future events for better stats
                        const recentEvents = siblingEvents.filter(e => {
                            if (!e.scheduled_timestamp) return false;
                            const eventDate = new Date(e.scheduled_timestamp);
                            return eventDate >= tenDaysAgo && eventDate <= now;
                        });

                        // For all-time, include all events that have happened or are scheduled
                        const allEvents = siblingEvents.filter(e => e.scheduled_timestamp);

                        console.log('[GoalMenu] Filtered events:', {
                            total_siblings: siblingEvents.length,
                            recent_events: recentEvents.length,
                            all_events: allEvents.length,
                            recent_sample: recentEvents.slice(0, 2),
                            all_sample: allEvents.slice(0, 2)
                        });

                        // Calculate completion rates - handle boolean and undefined values
                        const recentCompletedEvents = recentEvents.filter(e => e.completed === true).length;
                        const allCompletedEvents = allEvents.filter(e => e.completed === true).length;

                        const recentCompletionRate = recentEvents.length > 0 ? recentCompletedEvents / recentEvents.length : 0;
                        const allTimeCompletionRate = allEvents.length > 0 ? allCompletedEvents / allEvents.length : 0;

                        console.log('[GoalMenu] Completion calculations:', {
                            recent_completed: recentCompletedEvents,
                            recent_total: recentEvents.length,
                            recent_rate: recentCompletionRate,
                            all_completed: allCompletedEvents,
                            all_total: allEvents.length,
                            all_rate: allTimeCompletionRate
                        });

                        // Calculate standard deviation of completion times (as a measure of consistency)
                        let completionStdev = 0;
                        if (allEvents.length > 1) {
                            const completionRates = allEvents.map(e => e.completed === true ? 1 : 0);
                            const mean = allTimeCompletionRate;
                            const variance = completionRates.reduce((sum: number, rate: number) => sum + Math.pow(rate - mean, 2), 0) / completionRates.length;
                            completionStdev = Math.sqrt(variance);
                        }

                        stats = {
                            completion_rate: recentCompletionRate,
                            total_events: allEvents.length,
                            completed_events: allCompletedEvents,
                            last_30_days_completion_rate: allTimeCompletionRate, // Reusing this field for all-time rate
                            reschedule_count: recentEvents.length, // Reusing this field for recent events count
                            avg_reschedule_distance_hours: completionStdev * 100 // Reusing this field for stdev %
                        };

                        console.log('[GoalMenu] Final calculated stats:', stats);
                    } else {
                        // No sibling events found
                        stats = {
                            completion_rate: 0,
                            total_events: 0,
                            completed_events: 0
                        };
                    }
                } else {
                    // No parent found
                    stats = {
                        completion_rate: goal.completed ? 1.0 : 0.0,
                        total_events: 1,
                        completed_events: goal.completed ? 1 : 0
                    };
                }

                console.log('[GoalMenu] Final event stats:', stats);
            }

            // Fetch rescheduling stats for tasks and routines with events
            if ((goal.goal_type === 'task' || goal.goal_type === 'routine') && stats.total_events > 0) {
                try {
                    const currentYear = new Date().getFullYear();
                    const reschedulingResponse = await privateRequest<any>(`stats/rescheduling?year=${currentYear}`);

                    // This is a simplified approach - in a real implementation, you'd want to filter by specific goal
                    stats.reschedule_count = reschedulingResponse.total_reschedules || 0;
                    stats.avg_reschedule_distance_hours = reschedulingResponse.avg_reschedule_distance_hours || 0;
                } catch (error) {
                    console.log('Could not fetch rescheduling stats:', error);
                }
            }

            setGoalStats(stats);
        } catch (error) {
            console.error('Failed to fetch goal stats:', error);
            setGoalStats(null);
        } finally {
            setStatsLoading(false);
        }
    }, [state.mode, taskEvents, parentGoals]);

    // Auto-show add event form for new tasks created from calendar clicks
    useEffect(() => {
        if (state.mode === 'create' &&
            state.goal.goal_type === 'task' &&
            state.goal.scheduled_timestamp &&
            !state.goal.id) {
            // This is a new task created from a calendar click
            setShowAddEvent(true);
            setNewEventScheduled(state.goal.scheduled_timestamp);
        }
    }, [state.mode, state.goal.goal_type, state.goal.scheduled_timestamp, state.goal.id]);

    // Auto-show add event form when user changes goal type to 'task' in create mode
    useEffect(() => {
        if (state.mode === 'create' &&
            state.goal.goal_type === 'task' &&
            state.goal.scheduled_timestamp &&
            !showAddEvent) {
            // User selected task type, show add event form with the scheduled timestamp
            setShowAddEvent(true);
            setNewEventScheduled(state.goal.scheduled_timestamp);
        }
    }, [state.goal.goal_type, state.mode, state.goal.scheduled_timestamp, showAddEvent]);

    // Fetch parent goals using traversal API
    const fetchParentGoals = useCallback(async (goalId: number, mode: Mode) => {
        console.log('[GoalMenu] fetchParentGoals called with goalId:', goalId);
        try {
            const hierarchyResponse = await privateRequest<ApiGoal[]>(`traversal/${goalId}`);
            console.log('[GoalMenu] fetchParentGoals hierarchyResponse:', hierarchyResponse);
            // Filter to only get parent goals (those that have a child relationship to current goal)
            const networkData = await privateRequest<{ nodes: ApiGoal[]; edges: NetworkEdge[] }>('network');
            console.log('[GoalMenu] fetchParentGoals networkData edges:', networkData.edges);
            const parentIds = networkData.edges
                .filter(e => e.relationship_type === 'child' && e.to === goalId)
                .map(e => e.from);
            console.log('[GoalMenu] fetchParentGoals parentIds:', parentIds);

            const parents = hierarchyResponse
                .filter(g => parentIds.includes(g.id!))
                .map(goalToLocal);
            console.log('[GoalMenu] fetchParentGoals parents:', parents);

            // Sort by hierarchy level (furthest parents first)
            setParentGoals(parents);

            // In edit mode, also populate selectedParents so they show in the selector
            if (mode === 'edit') {
                setSelectedParents(parents);
            }
        } catch (error) {
            console.error('Failed to fetch parent goals:', error);
            setParentGoals([]);
            if (mode === 'edit') {
                setSelectedParents([]);
            }
        }
    }, []);

    // Fetch child goals using traversal API
    const fetchChildGoals = useCallback(async (goalId: number, mode: Mode) => {
        console.log('[GoalMenu] fetchChildGoals called with goalId:', goalId);
        try {
            const hierarchyResponse = await privateRequest<ApiGoal[]>(`traversal/${goalId}`);
            console.log('[GoalMenu] fetchChildGoals hierarchyResponse:', hierarchyResponse);
            // Filter to only get child goals (those that have a child relationship from current goal)
            const networkData = await privateRequest<{ nodes: ApiGoal[]; edges: NetworkEdge[] }>('network');
            console.log('[GoalMenu] fetchChildGoals networkData edges:', networkData.edges);
            const childIds = networkData.edges
                .filter(e => e.relationship_type === 'child' && e.from === goalId)
                .map(e => e.to);
            console.log('[GoalMenu] fetchChildGoals childIds:', childIds);

            const children = hierarchyResponse
                .filter(g => childIds.includes(g.id!))
                .map(goalToLocal);
            console.log('[GoalMenu] fetchChildGoals children:', children);

            // Sort by hierarchy level (immediate children first)
            setChildGoals(children);
        } catch (error) {
            console.error('Failed to fetch child goals:', error);
            setChildGoals([]);
        }
    }, []);

    const open = useCallback((goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        //create copy, might need to be date.
        const goalCopy = { ...goal }

        console.log('[GoalMenu] open() called with goal:', goalCopy);
        console.log('[GoalMenu] goal.id:', goalCopy.id, 'goal.goal_type:', goalCopy.goal_type);

        if (goalCopy._tz === undefined) {
            goalCopy._tz = 'user';
        }

        // Allow events to be edited like other goal types
        const actualMode = initialMode;

        if (actualMode === 'create' && !goalCopy.start_timestamp) {
            // If we have a scheduled_timestamp (from calendar click), use that as start_timestamp
            // Otherwise default to today
            goalCopy.start_timestamp = goalCopy.scheduled_timestamp || new Date();
        }

        //queue relationships can only between achievements, default to achievement and force achievemnt in ui
        if (selectedParents.length > 0 && relationshipType === 'queue') {
            goalCopy.goal_type = 'achievement';
        }

        // Set default routine_type if goal type is 'routine' and routine_type is undefined
        if (goalCopy.goal_type === 'routine' && goalCopy.routine_type === undefined) {
            goalCopy.routine_type = 'task';
        }

        // Auto-fill routine_time with the clicked calendar time (stored in scheduled_timestamp)
        if (goalCopy.goal_type === 'routine' && goalCopy.routine_time === undefined) {
            goalCopy.routine_time = goalCopy.scheduled_timestamp || new Date();
        }

        setState({
            goal: goalCopy,
            mode: actualMode,
            error: ''
        });
        setTitle({
            'create': 'Create New Goal',
            'edit': 'Edit Goal',
            'view': 'View Goal'
        }[actualMode]);
        setIsOpen(true);

        console.log('[GoalMenu] About to check goal.id:', goalCopy.id, 'typeof:', typeof goalCopy.id);
        // Fetch parent and child goals if we have a goal ID
        if (goal.id) {
            console.log('[GoalMenu] Goal has ID:', goal.id, 'and goal_type:', goal.goal_type);
            fetchParentGoals(goal.id, actualMode);
            fetchChildGoals(goal.id, actualMode);

            // Fetch task events if this is a task
            if (goal.goal_type === 'task') {
                console.log('[GoalMenu] Fetching task events for task ID:', goal.id);
                fetchTaskEvents(goal.id);
            } else {
                console.log('[GoalMenu] Not a task, goal_type is:', goal.goal_type);
            }
        } else {
            console.log('[GoalMenu] Goal has no ID, skipping fetchTaskEvents');
            setParentGoals([]);
            setChildGoals([]);
            setTaskEvents([]);
            setTotalDuration(0);
        }

        // Reset stats when goal changes
        setGoalStats(null);
    }, [selectedParents, setState, relationshipType, fetchTaskEvents, fetchParentGoals, fetchChildGoals]);

    // Fetch stats when in view mode and goal is loaded
    useEffect(() => {
        if (state.mode === 'view' && state.goal.id) {
            fetchGoalStats(state.goal);
        }
    }, [state.mode, state.goal, taskEvents, fetchGoalStats]);

    // Debug taskEvents changes
    useEffect(() => {
        console.log('[GoalMenu] taskEvents updated:', { length: taskEvents.length, events: taskEvents });
    }, [taskEvents]);

    // Debug childGoals changes
    useEffect(() => {
        console.log('[GoalMenu] childGoals updated:', { length: childGoals.length, children: childGoals });
    }, [childGoals]);

    // Debug parentGoals changes
    useEffect(() => {
        console.log('[GoalMenu] parentGoals updated:', { length: parentGoals.length, parents: parentGoals });
    }, [parentGoals]);

    // Fetch parent and child goals when component mounts or goal changes
    useEffect(() => {
        if (state.goal.id && isOpen) {
            console.log('[GoalMenu] useEffect: Fetching relationships for goal ID:', state.goal.id);
            fetchParentGoals(state.goal.id, state.mode);
            fetchChildGoals(state.goal.id, state.mode);
        } else {
            console.log('[GoalMenu] useEffect: No goal ID or dialog closed, clearing relationships');
            setParentGoals([]);
            setChildGoals([]);
        }
    }, [state.goal.id, state.mode, isOpen, fetchParentGoals, fetchChildGoals]);

    const close = useCallback(() => {
        setIsOpen(false);
        setTimeout(() => {
            setState({
                goal: {} as Goal,
                error: '',
                mode: 'view'
            });
            setTitle('');
            setSelectedParents([]);
            setParentSearchQuery('');
            setRelationshipType('child');
            setTaskEvents([]);
            setTotalDuration(0);
            setShowAddEvent(false);
            setNewEventScheduled(new Date());
            setNewEventDuration(60);
            setSmartScheduleOpen(false);
            setSmartScheduleContext(null);
            setGoalStats(null);
            setStatsLoading(false);
            setChildGoals([]);
        }, 100);
    }, [setState]);

    const isViewOnly = state.mode === 'view';

    useEffect(() => {
        if (!isOpen) {
            onClose();
        }
    }, [isOpen, onClose]);

    // Set title based on initial mode when component mounts
    useEffect(() => {
        if (!title) {
            setTitle({
                'create': 'Create New Goal',
                'edit': 'Edit Goal',
                'view': 'View Goal'
            }[initialMode]);
        }
    }, [initialMode, title]);

    // Update title when mode changes
    useEffect(() => {
        const newTitle = {
            'create': 'Create New Goal',
            'edit': 'Edit Goal',
            'view': 'View Goal'
        }[state.mode];
        if (newTitle !== title) {
            setTitle(newTitle);
        }
    }, [state.mode, title]);

    // Fetch all goals when dialog opens
    useEffect(() => {
        if (isOpen) {
            privateRequest<ApiGoal[]>('list').then(res => {
                setAllGoals(res.map(goalToLocal));
            }).catch(error => {
                console.error('Failed to fetch goals:', error);
            });
        }
    }, [isOpen]);

    // NEW EFFECT: Automatically populate parentGoals and selectedParents for events once allGoals are available
    useEffect(() => {
        if (
            state.goal.goal_type === 'event' &&
            state.goal.parent_id &&
            allGoals.length > 0
        ) {
            const parent = allGoals.find(g => g.id === state.goal.parent_id);
            if (parent) {
                // Only update if we have not already set the parent
                setParentGoals(prev => (prev.length === 0 ? [parent] : prev));
                if (state.mode === 'edit') {
                    setSelectedParents(prev => (prev.length === 0 ? [parent] : prev));
                }
            }
        }
    }, [state.goal.goal_type, state.goal.parent_id, allGoals, state.mode]);

    // Create fuzzy search instance
    const fuse = useMemo(() => {
        return new Fuse(allGoals, {
            keys: ['name', 'description'],
            threshold: 0.3
        });
    }, [allGoals]);

    // Get filtered parent options based on search and validation
    const getParentOptions = useCallback(() => {
        if (!state.goal.goal_type) return [];

        // Filter out invalid parent options based on goal type
        let validGoals = allGoals.filter(g => {
            // Can't be parent of itself
            if (g.id === state.goal.id) return false;

            // Special handling for events - only tasks and routines can be parents
            if (state.goal.goal_type === 'event') {
                return g.goal_type === 'task' || g.goal_type === 'routine';
            }

            // Special handling for queue relationships - only achievements can be in queues
            if (relationshipType === 'queue') {
                return g.goal_type === 'achievement';
            }

            // For non-events, validate the relationship
            const error = validateRelationship(g, state.goal, relationshipType);
            return !error;
        });

        // Apply fuzzy search if there's a query
        if (parentSearchQuery) {
            const results = fuse.search(parentSearchQuery);
            const resultIds = new Set(results.map(r => r.item.id));
            validGoals = validGoals.filter(g => resultIds.has(g.id));
        }

        return validGoals.slice(0, 10); // Limit to 10 results
    }, [allGoals, state.goal, parentSearchQuery, fuse, relationshipType]);

    const handleChange = (newGoal: Goal) => {
        // If in view mode and completion status changed, update it on the server
        if (state.mode === 'view' && newGoal.completed !== state.goal.completed) {
            handleCompletionToggle(newGoal.completed || false);
            return;
        }

        // Set default frequency if goal type is 'routine' and frequency is undefined
        if (newGoal.goal_type === 'routine' && newGoal.frequency === undefined) {
            newGoal.frequency = '1D';
        }

        // Set default routine_type if goal type is 'routine' and routine_type is undefined
        if (newGoal.goal_type === 'routine' && newGoal.routine_type === undefined) {
            newGoal.routine_type = 'task';
        }

        // Auto-fill routine_time with the clicked calendar time (stored in scheduled_timestamp)
        if (newGoal.goal_type === 'routine' && newGoal.routine_time === undefined) {
            newGoal.routine_time = newGoal.scheduled_timestamp || new Date();
        }

        // For all changes, update the local state (no immediate prompting for routine events)
        setState({
            ...state,
            goal: newGoal
        });
    };

    const handleSubmit = async (another: boolean = false) => {
        if (another && state.mode !== 'create') {
            throw new Error('Cannot create another goal in non-create mode');
        }

        // Check if this is a routine event being modified
        if (state.mode === 'edit' && state.goal.goal_type === 'event' && state.goal.parent_type === 'routine') {
            // Determine what type of change this is
            const originalGoal = initialGoal;
            const updatedGoal = state.goal;

            let updateType: 'scheduled_time' | 'duration' | 'other' = 'other';
            let hasChanges = false;

            // Check for scheduled time changes
            if (originalGoal.scheduled_timestamp !== updatedGoal.scheduled_timestamp) {
                updateType = 'scheduled_time';
                hasChanges = true;
            }
            // Check for duration changes (including all-day checkbox)
            else if (originalGoal.duration !== updatedGoal.duration) {
                updateType = 'duration';
                hasChanges = true;
            }
            // Check for other property changes (name, description, priority)
            else if (
                originalGoal.name !== updatedGoal.name ||
                originalGoal.description !== updatedGoal.description ||
                originalGoal.priority !== updatedGoal.priority
            ) {
                updateType = 'other';
                hasChanges = true;
            }

            // If there are changes to a routine event, show the scope dialog
            if (hasChanges) {
                setRoutineUpdateDialog({
                    isOpen: true,
                    updateType,
                    originalGoal,
                    updatedGoal,
                    onConfirm: async (scope: 'single' | 'all' | 'future') => {
                        await handleRoutineEventUpdate(originalGoal, updatedGoal, updateType, scope);
                    }
                });
                return;
            }
        }

        // Validation checks
        const validationErrors = validateGoal(state.goal);

        if (validationErrors.length > 0) {
            setState({
                ...state,
                error: validationErrors.join('\n')
            });
            return;
        }

        // Validate parent relationship if selected
        if (selectedParents.length > 0 && (state.mode === 'create' || state.mode === 'edit') && state.goal.goal_type !== 'event') {
            // Special validation for queue relationships
            if (relationshipType === 'queue') {
                if (selectedParents.some(parent => parent.goal_type !== 'achievement')) {
                    setState({
                        ...state,
                        error: 'Queue relationships can only be created from achievements'
                    });
                    return;
                }
                if (state.goal.goal_type !== 'achievement') {
                    setState({
                        ...state,
                        error: 'Queue relationships can only be created to achievements'
                    });
                    return;
                }
            }

            // Check each parent for validation errors
            for (const parent of selectedParents) {
                const relationshipError = validateRelationship(parent, state.goal, relationshipType);
                if (relationshipError) {
                    setState({
                        ...state,
                        error: relationshipError
                    });
                    return;
                }
            }
        }

        // Special validation for events
        if (state.goal.goal_type === 'event' && state.mode === 'create') {
            if (selectedParents.length === 0) {
                setState({
                    ...state,
                    error: 'Events must have at least one parent task or routine'
                });
                return;
            }
            if (selectedParents.length > 1) {
                setState({
                    ...state,
                    error: 'Events can only have one parent task or routine'
                });
                return;
            }
            if (selectedParents.some(parent => parent.goal_type !== 'task' && parent.goal_type !== 'routine')) {
                setState({
                    ...state,
                    error: 'Events can only be created for tasks or routines'
                });
                return;
            }
        }

        // For routine events, we just proceed with the update
        // The parent component (Calendar) can handle any routine-specific rescheduling logic

        try {
            let updatedGoal: Goal;
            if (state.mode === 'create') {
                if (state.goal.goal_type === 'event') {
                    // Use createEvent API for events
                    updatedGoal = await createEvent({
                        parent_id: selectedParents[0].id!,
                        parent_type: selectedParents[0].goal_type,
                        scheduled_timestamp: state.goal.scheduled_timestamp || new Date(),
                        duration: state.goal.duration || 60
                    });
                } else {
                    // Use createGoal for non-events
                    updatedGoal = await createGoal(state.goal);

                    // For tasks, create any events that were added during creation
                    if (state.goal.goal_type === 'task' && taskEvents.length > 0) {
                        for (const event of taskEvents) {
                            if (!event.id || event.id <= 0) { // Only create events with temporary IDs
                                try {
                                    await createEvent({
                                        parent_id: updatedGoal.id!,
                                        parent_type: 'task',
                                        scheduled_timestamp: event.scheduled_timestamp!,
                                        duration: event.duration!
                                    });
                                } catch (error) {
                                    console.error('Failed to create event for new task:', error);
                                }
                            }
                        }
                    }

                    // Create parent relationships if selected
                    for (const parent of selectedParents) {
                        await createRelationship(
                            parent.id!,
                            updatedGoal.id!,
                            relationshipType
                        );
                    }
                }
            } else if (state.mode === 'edit' && state.goal.id) {
                updatedGoal = await updateGoal(state.goal.id, state.goal);

                // Handle parent relationships in edit mode (for non-events)
                if (state.goal.goal_type !== 'event') {
                    // Get current parent IDs
                    const currentParentIds = new Set(parentGoals.map(p => p.id!));
                    const selectedParentIds = new Set(selectedParents.map(p => p.id!));

                    // Find relationships to add (selected but not current)
                    const parentsToAdd = selectedParents.filter(p => !currentParentIds.has(p.id!));

                    // Find relationships to remove (current but not selected)
                    const parentsToRemove = parentGoals.filter(p => !selectedParentIds.has(p.id!));

                    // Add new relationships
                    for (const parent of parentsToAdd) {
                        await createRelationship(
                            parent.id!,
                            state.goal.id!,
                            relationshipType
                        );
                    }

                    // Remove old relationships
                    for (const parent of parentsToRemove) {
                        await deleteRelationship(
                            parent.id!,
                            state.goal.id!,
                            relationshipType
                        );
                    }
                }
            } else {
                throw new Error('Invalid mode or missing goal ID');
            }
            setState({
                ...state,
                goal: updatedGoal
            });
            if (state.goal.goal_type === 'routine') {
                await updateRoutines(); //update routines to make sure new one is good
            }
            if (onSuccess) {
                onSuccess(updatedGoal);
            }
            if (another) {
                const { id, ...restGoal } = updatedGoal;
                const newGoal: Goal = { ...restGoal, name: '', description: '' } as Goal;
                close();
                setTimeout(() => {
                    open(newGoal, 'create', onSuccess);
                }, 300);
            } else {
                close();
            }
        } catch (error) {
            console.error('Failed to submit goal:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to submit goal'
            });
        }
    };

    const handleRoutineEventUpdate = async (
        originalGoal: Goal,
        updatedGoal: Goal,
        updateType: 'scheduled_time' | 'duration' | 'other',
        scope: 'single' | 'all' | 'future'
    ) => {
        try {
            if (updateType === 'scheduled_time' && (scope === 'all' || scope === 'future')) {
                // Use the routine event update API for scheduled time changes
                const updatedEvents = await updateRoutineEvent(
                    updatedGoal.id!,
                    updatedGoal.scheduled_timestamp!,
                    scope
                );

                // Update the routine's default time as well
                if (updatedGoal.parent_id) {
                    const parentRoutine = allGoals.find(g => g.id === updatedGoal.parent_id);
                    if (parentRoutine) {
                        await updateGoal(parentRoutine.id!, {
                            ...parentRoutine,
                            routine_time: updatedGoal.scheduled_timestamp
                        });
                    }
                }

                setState({ ...state, goal: updatedEvents[0] || updatedGoal });
            } else if ((updateType === 'duration' || updateType === 'other') && (scope === 'all' || scope === 'future')) {
                // For duration or other property changes, update multiple events
                await updateMultipleRoutineEvents(updatedGoal, updateType === 'duration' ? 'duration' : 'other', scope);
            } else {
                // For single updates or other changes, use regular update
                const result = await updateGoal(updatedGoal.id!, updatedGoal);
                setState({ ...state, goal: result });
            }

            // Close the routine dialog
            setRoutineUpdateDialog({
                isOpen: false,
                updateType: 'other',
                originalGoal: null,
                updatedGoal: null,
                onConfirm: async () => { }
            });

            if (onSuccess) {
                onSuccess(updatedGoal);
            }
            close();
        } catch (error) {
            console.error('Failed to update routine event:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to update routine event'
            });
        }
    };

    const updateMultipleRoutineEvents = async (
        updatedGoal: Goal,
        changeType: 'duration' | 'other',
        scope: 'single' | 'all' | 'future'
    ) => {
        if (!updatedGoal.id) {
            throw new Error('Goal ID is required for updating routine events');
        }

        // Extract the updates from the goal based on change type
        const updates: {
            duration?: number;
            name?: string;
            description?: string;
            priority?: string;
            scheduled_timestamp?: Date;
        } = {};

        if (changeType === 'duration') {
            // For duration changes, only update the duration
            if (updatedGoal.duration !== undefined) {
                updates.duration = updatedGoal.duration;
            }
        } else {
            // For other changes, include all relevant properties except scheduled_timestamp
            // (scheduled_timestamp should be handled by the separate updateRoutineEvent API)
            if (updatedGoal.name) updates.name = updatedGoal.name;
            if (updatedGoal.description) updates.description = updatedGoal.description;
            if (updatedGoal.priority) updates.priority = updatedGoal.priority;
        }

        // Use the dedicated API for updating routine event properties
        const updatedEvents = await updateRoutineEventProperties(updatedGoal.id, updates, scope);

        // For 'all' or 'future' scope, also update the parent routine with the same changes
        if ((scope === 'all' || scope === 'future') && updatedGoal.parent_id) {
            const parentRoutine = allGoals.find(g => g.id === updatedGoal.parent_id);
            if (parentRoutine) {
                const routineUpdates: Partial<Goal> = {};

                // Apply the same changes to the parent routine
                if (changeType === 'duration' && updates.duration !== undefined) {
                    routineUpdates.duration = updates.duration;
                } else if (changeType === 'other') {
                    if (updates.name) routineUpdates.name = updates.name;
                    if (updates.description) routineUpdates.description = updates.description;
                    if (updates.priority && ['high', 'medium', 'low'].includes(updates.priority)) {
                        routineUpdates.priority = updates.priority as 'high' | 'medium' | 'low';
                    }
                }

                // Only update if we have changes to apply
                if (Object.keys(routineUpdates).length > 0) {
                    try {
                        await updateGoal(parentRoutine.id!, {
                            ...parentRoutine,
                            ...routineUpdates
                        });
                        console.log('Updated parent routine with changes:', routineUpdates);
                    } catch (error) {
                        console.warn('Failed to update parent routine:', error);
                        // Don't fail the entire operation if routine update fails
                    }
                }
            }
        }

        // Update the current goal state with the first updated event (the one being edited)
        const currentEvent = updatedEvents.find(event => event.id === updatedGoal.id);
        if (currentEvent) {
            setState({ ...state, goal: currentEvent });
        }

        return updatedEvents;
    };

    const handleDelete = async () => {
        if (!state.goal.id) {
            setState({
                ...state,
                error: 'Cannot delete goal without ID'
            });
            return;
        }
        console.log('[GoalMenu] handleDelete called', {
            goalId: state.goal.id,
            goalType: state.goal.goal_type,
            parentType: state.goal.parent_type
        });

        try {
            if (state.goal.goal_type === 'event') {
                if (state.goal.parent_type === 'routine') {
                    console.log('[GoalMenu] Deleting routine event – opening scope dialog');
                    // Open routine delete dialog instead of immediate confirm
                    setRoutineDeleteDialog({
                        isOpen: true,
                        eventId: state.goal.id!,
                        eventName: state.goal.name,
                        selectedScope: 'single'
                    });
                    return; // Wait for dialog confirmation
                } else {
                    console.log('[GoalMenu] Deleting single non-routine event', { eventId: state.goal.id });
                    // Regular (non-routine) event – delete single occurrence
                    await deleteEvent(state.goal.id, false);
                }
            } else {
                console.log('[GoalMenu] Deleting non-event goal', { goalId: state.goal.id });
                // Non-event goals
                await deleteGoal(state.goal.id);
            }

            if (onSuccess) {
                onSuccess(state.goal);
            }
            close();
        } catch (error) {
            console.error('Failed to delete goal:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to delete goal'
            });
        }
    };

    const handleCreateChild = () => {
        const parentGoal = state.goal;
        const newGoal: Goal = {} as Goal;

        close();
        setTimeout(() => {
            // Set the parent goal and relationship type, then open the dialog
            setSelectedParents([parentGoal]);
            setRelationshipType('child');
            open(newGoal, 'create', onSuccess);
        }, 100);
    };

    const handleCreateQueue = () => {
        const previousGoal = state.goal;
        const newGoal: Goal = { goal_type: 'achievement' } as Goal;

        close();
        setTimeout(() => {
            // Set the parent goal and relationship type, then open the dialog
            setSelectedParents([previousGoal]);
            setRelationshipType('queue');
            open(newGoal, 'create', onSuccess);
        }, 100);
    };

    const handleSplitEvent = async () => {
        if (!state.goal.id || !state.goal.scheduled_timestamp) return;

        try {
            const newEvents = await splitEvent(state.goal.id);
            onSuccess(newEvents[0]); // Return the first new event
            setIsOpen(false);
        } catch (error) {
            console.error('Failed to split event:', error);
            if (isTaskDateValidationError(error)) {
                showTaskDateWarning(error, `New event for "${state.goal.name}"`, handleSplitEvent);
            } else {
                setState({ ...state, error: 'Failed to split event' });
            }
        }
    };

    const priorityField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Priority:</strong> {state.goal.priority ? state.goal.priority.charAt(0).toUpperCase() + state.goal.priority.slice(1) : 'Not set'}
        </Box>
    ) : (
        <TextField
            label="Priority"
            select
            value={state.goal.priority || ''}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({
                ...state.goal,
                priority: e.target.value as 'high' | 'medium' | 'low'
            })}
            fullWidth
            margin="dense"
            disabled={isViewOnly}
        >
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="low">Low</MenuItem>
        </TextField>
    );
    const durationField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Duration:</strong> {(() => {
                const duration = state.goal.duration;
                if (!duration) return 'Not set';
                if (duration === 1440) return 'All Day';
                const hours = Math.floor(duration / 60);
                const minutes = duration % 60;
                return `${hours}h ${minutes}m`;
            })()}
        </Box>
    ) : (
        <Box>
            <FormControlLabel
                control={
                    <Checkbox
                        checked={state.goal.duration === 1440}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                            handleChange({
                                ...state.goal,
                                duration: e.target.checked ? 1440 : 60 // Default to 1 hour when unchecking
                            });
                        }}
                    />
                }
                label="All Day"
            />
            {state.goal.duration !== 1440 && (
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                    <TextField
                        label="Hours"
                        type="number"
                        value={(() => {
                            const hours = state.goal.duration ? Math.floor(state.goal.duration / 60) : '';
                            return hours;
                        })()}
                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                            const hours = e.target.value ? parseInt(e.target.value) : 0;
                            const minutes = state.goal.duration ? state.goal.duration % 60 : 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...state.goal,
                                duration: newDuration
                            });
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{
                            min: 0,
                            step: 1
                        }}
                        disabled={isViewOnly}
                        sx={{ width: '50%' }}
                    />
                    <TextField
                        label="Minutes"
                        type="number"
                        value={(() => {
                            const minutes = state.goal.duration ? state.goal.duration % 60 : '';
                            return minutes;
                        })()}
                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                            const minutes = e.target.value ? parseInt(e.target.value) : 0;
                            const hours = state.goal.duration ? Math.floor(state.goal.duration / 60) : 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...state.goal,
                                duration: newDuration
                            });
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{
                            min: 0,
                            max: 59,
                            step: 1
                        }}
                        disabled={isViewOnly}
                        sx={{ width: '50%' }}
                    />
                </Box>
            )}
        </Box>
    );
    const scheduleField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Scheduled Date:</strong> {timestampToDisplayString(state.goal.scheduled_timestamp)}
        </Box>
    ) : (
        <TextField
            label="Schedule Date"
            type="datetime-local"
            value={(() => {
                const rawTimestamp = state.goal.scheduled_timestamp;
                console.log(`[GoalMenu.tsx] scheduleField render: Raw timestamp=${rawTimestamp}, _tz=${state.goal._tz}`);
                const converted = timestampToInputString(rawTimestamp, 'datetime');
                console.log(`[GoalMenu.tsx] scheduleField render: Converted to input string=${converted}`);
                return converted;
            })()}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                const inputValue = e.target.value;
                const newTimestamp = inputStringToTimestamp(inputValue, 'datetime');
                //console.log('Schedule date changed:',
                //  'Input value:', inputValue,
                //  'Converted timestamp:', newTimestamp);
                handleChange({
                    ...state.goal,
                    scheduled_timestamp: newTimestamp
                });
            }}
            fullWidth
            margin="dense"
            InputLabelProps={{ shrink: true }}
            disabled={isViewOnly}
        />
    );

    const dateFields = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Start Date:</strong> {timestampToDisplayString(state.goal.start_timestamp, 'date')}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>End Date:</strong> {timestampToDisplayString(state.goal.end_timestamp, 'date')}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Start Date"
                type="date"
                value={timestampToInputString(state.goal.start_timestamp, 'date')}
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    const inputValue = e.target.value;
                    const convertedDate = inputStringToTimestamp(inputValue, "date");

                    handleChange({
                        ...state.goal,
                        start_timestamp: convertedDate
                    });
                }}
                fullWidth
                margin="dense"
                InputLabelProps={{ shrink: true }}
                disabled={isViewOnly}
            />
            <TextField
                label="End Date"
                type="date"
                value={timestampToInputString(state.goal.end_timestamp, 'date')}
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    handleChange({
                        ...state.goal,
                        end_timestamp: inputStringToTimestamp(e.target.value, 'end-date')
                    });
                }}
                fullWidth
                margin="dense"
                InputLabelProps={{ shrink: true }}
                disabled={isViewOnly}
            />
        </>
    );

    const completedField = (
        <FormControlLabel
            control={
                <Checkbox
                    checked={state.goal.completed || false}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange({
                        ...state.goal,
                        completed: e.target.checked
                    })}
                //disabled={isViewOnly}
                />
            }
            label="Completed"
        />
    );
    const frequencyField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Frequency:</strong> {formatFrequency(state.goal.frequency)}
        </Box>
    ) : (
        <Box sx={{ mb: 2 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: state.goal.frequency?.includes('W') ? 2 : 0
            }}>
                <Typography>Repeat every</Typography>
                <TextField
                    value={(() => {
                        const match = state.goal.frequency?.match(/^(\d+)[DWMY]/);
                        return match ? match[1] : '1';
                    })()}
                    onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                        const value = e.target.value;
                        const unit = state.goal.frequency?.match(/[DWMY]/)?.[0] || 'W';
                        const days = state.goal.frequency?.split(':')?.[1] || '';
                        const newFreq = `${value}${unit}${days ? ':' + days : ''}`;
                        //console.log(newFreq);
                        handleChange({
                            ...state.goal,
                            frequency: newFreq
                        });
                    }}
                    type="number"
                    inputProps={{
                        min: 1,
                        style: {
                            width: '60px',
                            padding: '8px',
                            textAlign: 'center'
                        }
                    }}
                    variant="outlined"
                    size="small"
                />
                <TextField
                    select
                    value={state.goal.frequency?.match(/[DWMY]/)?.[0] || 'D'}
                    onChange={(e: ChangeEvent<{ value: unknown }>) => {
                        const interval = state.goal.frequency?.match(/^\d+/)?.[0] || '1';

                        // If changing to weekly and we have a scheduled date, use its day of week
                        if (e.target.value === 'W' && state.goal.scheduled_timestamp) {
                            const date = new Date(state.goal.scheduled_timestamp);
                            const dayOfWeek = date.getDay(); // 0-6, where 0 is Sunday
                            const newFreq = `${interval}W:${dayOfWeek}`;
                            handleChange({
                                ...state.goal,
                                frequency: newFreq
                            });
                            return;
                        }

                        const days = e.target.value === 'W' && state.goal.frequency?.includes('W')
                            ? (state.goal.frequency?.split(':')?.[1] ? ':' + state.goal.frequency.split(':')[1] : '')
                            : '';
                        const newFreq = `${interval}${e.target.value}${days}`;
                        //console.log(newFreq);
                        handleChange({
                            ...state.goal,
                            frequency: newFreq
                        });
                    }}
                    sx={{ minWidth: 120 }}
                    size="small"
                >
                    <MenuItem value="D">day</MenuItem>
                    <MenuItem value="W">week</MenuItem>
                    <MenuItem value="M">month</MenuItem>
                    <MenuItem value="Y">year</MenuItem>
                </TextField>
            </Box>

            {state.goal.frequency?.includes('W') && (
                <Box>
                    <Typography sx={{ mb: 1 }}>Repeat on</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => {
                            const days = state.goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];
                            const isSelected = days.includes(index);

                            return (
                                <Box
                                    key={index}
                                    onClick={() => {
                                        const interval = state.goal.frequency?.match(/^\d+/)?.[0] || '1';
                                        let currentDays = state.goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];

                                        if (isSelected) {
                                            currentDays = currentDays.filter((d: number) => d !== index);
                                        } else {
                                            currentDays.push(index);
                                        }

                                        const newFreq = `${interval}W${currentDays.length ? ':' + currentDays.sort((a, b) => a - b).join(',') : ''}`;
                                        //console.log(newFreq);
                                        handleChange({
                                            ...state.goal,
                                            frequency: newFreq
                                        });
                                    }}
                                    sx={{
                                        width: 36,
                                        height: 36,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '50%',
                                        cursor: 'pointer',
                                        bgcolor: isSelected ? 'primary.main' : 'action.selected',
                                        color: isSelected ? 'primary.contrastText' : 'text.primary',
                                        '&:hover': {
                                            bgcolor: isSelected ? 'primary.dark' : 'action.selected',
                                        }
                                    }}
                                >
                                    {day}
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            )}
        </Box>
    );

    const commonFields = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Name:</strong> {state.goal.name || 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Goal Type:</strong> {state.goal.goal_type ? state.goal.goal_type.charAt(0).toUpperCase() + state.goal.goal_type.slice(1) : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Description:</strong> {state.goal.description || 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Name"
                value={state.goal.name || ''}
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({ ...state.goal, name: e.target.value })}
                fullWidth
                margin="dense"
                required={state.goal.goal_type !== 'event'}
                disabled={isViewOnly}
                placeholder={state.goal.goal_type === 'event' && selectedParents.length > 0 ? `Event: ${selectedParents[0].name}` : ''}
                helperText={state.goal.goal_type === 'event' ? 'Name will be auto-generated from parent goals' : ''}
                inputProps={{
                    spellCheck: 'false',
                    // Explicitly allow all characters
                    autoComplete: 'off'
                }}
            />
            <TextField
                label="Goal Type"
                value={state.goal.goal_type || ''}
                onChange={(e: ChangeEvent<{ value: unknown }>) => {
                    const newGoalType = e.target.value as GoalType;
                    const updates: Partial<Goal> = {
                        goal_type: newGoalType
                    };

                    // Set defaults based on goal type
                    if (newGoalType === 'event') {
                        // Events need duration and scheduled timestamp
                        if (!state.goal.duration) updates.duration = 60;
                        if (!state.goal.scheduled_timestamp) updates.scheduled_timestamp = new Date();
                    } else if (newGoalType === 'routine') {
                        // Routines always have routine_type as "task" and need duration
                        updates.routine_type = 'task';
                        if (!state.goal.duration) updates.duration = 60;
                        if (!state.goal.frequency) updates.frequency = '1D';
                        // If start_timestamp is not set and we have a scheduled_timestamp (from calendar click), use it
                        if (!state.goal.start_timestamp && state.goal.scheduled_timestamp) {
                            updates.start_timestamp = state.goal.scheduled_timestamp;
                        }
                    }

                    handleChange({
                        ...state.goal,
                        ...updates
                    });
                }}
                select
                fullWidth
                margin="dense"
                required
                disabled={isViewOnly || state.goal.goal_type === 'event'}
            >
                <MenuItem value="directive">Directive</MenuItem>
                <MenuItem value="project">Project</MenuItem>
                <MenuItem value="achievement">Achievement</MenuItem>
                <MenuItem value="routine">Routine</MenuItem>
                <MenuItem value="task">Task</MenuItem>
                <MenuItem value="event">Event</MenuItem>
            </TextField>
            <TextField
                label="Description"
                value={state.goal.description || ''}
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({ ...state.goal, description: e.target.value })}
                fullWidth
                margin="dense"
                multiline
                disabled={isViewOnly}
                inputProps={{
                    spellCheck: 'false',
                    // Explicitly allow all characters
                    autoComplete: 'off'
                }}
            />
        </>
    );

    // Parent selector field (available in create and edit modes, not shown for events in view mode as they have special display)
    const parentSelectorField = (state.mode === 'create' || state.mode === 'edit') ? (
        <Box sx={{ mt: 2, mb: 2 }}>
            <Autocomplete
                multiple
                value={selectedParents}
                onChange={(event, newValue) => {
                    setSelectedParents(newValue as Goal[]);
                }}
                inputValue={parentSearchQuery}
                onInputChange={(event, newInputValue) => {
                    setParentSearchQuery(newInputValue);
                }}
                options={getParentOptions()}
                getOptionLabel={(option) => option.name}
                renderOption={(props, option) => (
                    <Box component="li" {...props}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <Chip
                                label={option.goal_type}
                                size="small"
                                sx={{
                                    backgroundColor: getGoalColor(option),
                                    color: 'white',
                                    fontSize: '0.75rem'
                                }}
                            />
                            <Typography variant="body2" sx={{ flexGrow: 1 }}>
                                {option.name}
                            </Typography>
                        </Box>
                    </Box>
                )}
                renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                        <Chip
                            variant="outlined"
                            label={option.name}
                            size="small"
                            sx={{
                                backgroundColor: getGoalColor(option),
                                color: 'white',
                                '& .MuiChip-deleteIcon': {
                                    color: 'white'
                                }
                            }}
                            {...getTagProps({ index })}
                        />
                    ))
                }
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={
                            state.goal.goal_type === 'event'
                                ? "Parent Goal (Required)"
                                : relationshipType === 'queue'
                                    ? "Previous Goals in Queue (Required)"
                                    : "Parent Goals (Optional)"
                        }
                        placeholder="Search for parent goals..."
                        helperText={
                            state.goal.goal_type === 'event'
                                ? "Events must be associated with one task or routine"
                                : relationshipType === 'queue'
                                    ? "Select the achievements that should come before these ones"
                                    : "Select parent goals to create relationships"
                        }
                        required={state.goal.goal_type === 'event' || relationshipType === 'queue'}
                        error={(state.goal.goal_type === 'event' || relationshipType === 'queue') && selectedParents.length === 0}
                    />
                )}
                fullWidth
                clearOnBlur={false}
                selectOnFocus
                handleHomeEndKeys
                freeSolo={false}
            />
        </Box>
    ) : null;

    const routineFields = isViewOnly ? (
        <>
            {durationField}
            {state.goal.duration !== 1440 && (
                <Box sx={{ mb: 2 }}>
                    <strong>Scheduled Time:</strong> {timestampToDisplayString(state.goal.routine_time, 'time')}
                </Box>
            )}
        </>
    ) : (
        <>
            {durationField}
            {state.goal.duration !== 1440 && (
                <TextField
                    label="Scheduled Time"
                    type="time"
                    value={timestampToInputString(state.goal.routine_time, 'time')}
                    onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                        handleChange({
                            ...state.goal,
                            routine_time: inputStringToTimestamp(e.target.value, 'time')
                        });
                    }}
                    fullWidth
                    margin="dense"
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ step: 300 }}
                    disabled={isViewOnly}
                />
            )}
        </>
    );

    const renderTypeSpecificFields = () => {
        if (!state.goal.goal_type) return null;
        const project_and_achievement_fields = (
            <>
                {priorityField}
                {dateFields}
                {completedField}
            </>
        );
        switch (state.goal.goal_type) {
            case 'project':
                return project_and_achievement_fields;
            case 'achievement':
                return project_and_achievement_fields;
            case 'directive':
                return null;
            case 'routine':
                return (
                    <>
                        {priorityField}
                        {dateFields}
                        {frequencyField}
                        {routineFields}
                    </>
                );
            case 'task':
                return (
                    <>
                        {priorityField}
                        {dateFields}
                        {/* Task Events Section */}
                        <Box sx={{ mt: 2, mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                                    Events {taskEvents.length > 0 && `(${taskEvents.length})`}
                                </Typography>
                                {!isViewOnly && (
                                    <IconButton
                                        size="small"
                                        onClick={() => setShowAddEvent(true)}
                                        sx={{ color: 'primary.main' }}
                                    >
                                        <AddIcon />
                                    </IconButton>
                                )}
                            </Box>

                            {/* Total Duration Display */}
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="body2" color="text.secondary">
                                    Total Duration: {Math.floor(totalDuration / 60)}h {totalDuration % 60}m
                                </Typography>
                            </Box>

                            {/* Events List */}
                            {taskEvents.length > 0 ? (
                                <List dense>
                                    {taskEvents.map((event, index) => (
                                        <ListItem key={index} sx={{ px: 0 }}>
                                            <ListItemText
                                                primary={timestampToDisplayString(event.scheduled_timestamp)}
                                                secondary={`Duration: ${Math.floor((event.duration || 0) / 60)}h ${(event.duration || 0) % 60}m`}
                                            />
                                            {!isViewOnly && (
                                                <ListItemSecondaryAction>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleRemoveEvent(index)}
                                                        sx={{ color: 'error.main' }}
                                                    >
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </ListItemSecondaryAction>
                                            )}
                                        </ListItem>
                                    ))}
                                </List>
                            ) : (
                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                    No events scheduled. {!isViewOnly && 'Click + to add an event.'}
                                </Typography>
                            )}

                            {/* Add Event Form */}
                            {showAddEvent && (
                                <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Add New Event</Typography>
                                    <TextField
                                        label="Scheduled Time"
                                        type="datetime-local"
                                        value={timestampToInputString(newEventScheduled, 'datetime')}
                                        onChange={(e) => {
                                            const newTimestamp = inputStringToTimestamp(e.target.value, 'datetime');
                                            setNewEventScheduled(newTimestamp);
                                        }}
                                        fullWidth
                                        margin="dense"
                                        InputLabelProps={{ shrink: true }}
                                    />
                                    <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                                        <TextField
                                            label="Hours"
                                            type="number"
                                            value={Math.floor(newEventDuration / 60)}
                                            onChange={(e) => {
                                                const hours = parseInt(e.target.value) || 0;
                                                const minutes = newEventDuration % 60;
                                                setNewEventDuration(hours * 60 + minutes);
                                            }}
                                            margin="dense"
                                            inputProps={{ min: 0, step: 1 }}
                                            sx={{ width: '50%' }}
                                        />
                                        <TextField
                                            label="Minutes"
                                            type="number"
                                            value={newEventDuration % 60}
                                            onChange={(e) => {
                                                const minutes = parseInt(e.target.value) || 0;
                                                const hours = Math.floor(newEventDuration / 60);
                                                setNewEventDuration(hours * 60 + minutes);
                                            }}
                                            margin="dense"
                                            inputProps={{ min: 0, max: 59, step: 1 }}
                                            sx={{ width: '50%' }}
                                        />
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                                        <Button
                                            size="small"
                                            onClick={handleAddEvent}
                                            variant="contained"
                                        >
                                            Add Event
                                        </Button>
                                        <Button
                                            size="small"
                                            onClick={() => handleSmartSchedule('new-task-event', newEventDuration, state.goal.name)}
                                            variant="outlined"
                                            color="secondary"
                                        >
                                            Smart Schedule
                                        </Button>
                                        <Button
                                            size="small"
                                            onClick={() => setShowAddEvent(false)}
                                        >
                                            Cancel
                                        </Button>
                                    </Box>
                                </Box>
                            )}
                        </Box>
                        {completedField}
                    </>
                );
            case 'event':
                // Events should display their scheduled time and duration
                return (
                    <>
                        {scheduleField}
                        {durationField}
                        {completedField}

                        {/* Google Calendar Sync Settings */}
                        <Box sx={{ mt: 2, mb: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Google Calendar Sync
                            </Typography>

                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={state.goal.gcal_sync_enabled || false}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange({
                                            ...state.goal,
                                            gcal_sync_enabled: e.target.checked,
                                            gcal_sync_direction: e.target.checked ? 'bidirectional' : undefined
                                        })}
                                        disabled={isViewOnly}
                                    />
                                }
                                label="Sync with Google Calendar"
                            />

                            {state.goal.gcal_sync_enabled && (
                                <Box sx={{ ml: 3, mt: 1 }}>
                                    <TextField
                                        label="Sync Direction"
                                        select
                                        value={state.goal.gcal_sync_direction || 'bidirectional'}
                                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({
                                            ...state.goal,
                                            gcal_sync_direction: e.target.value as 'bidirectional' | 'to_gcal' | 'from_gcal'
                                        })}
                                        fullWidth
                                        margin="dense"
                                        size="small"
                                        disabled={isViewOnly}
                                    >
                                        <MenuItem value="bidirectional">Bidirectional (both ways)</MenuItem>
                                        <MenuItem value="to_gcal">To Google Calendar only</MenuItem>
                                        <MenuItem value="from_gcal">From Google Calendar only</MenuItem>
                                    </TextField>

                                    {state.goal.gcal_event_id && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                            Synced with Google Calendar event: {state.goal.gcal_event_id}
                                        </Typography>
                                    )}

                                    {state.goal.is_gcal_imported && (
                                        <Typography variant="caption" color="primary.main" sx={{ mt: 1, display: 'block' }}>
                                            ⚠️ This event was imported from Google Calendar
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </Box>
                    </>
                );
        }
    };

    const handleEdit = () => {
        setState({
            ...state,
            mode: 'edit'
        });
        setTitle('Edit Goal');
    };
    const handleRelations = () => { setRelationsOpen(true); };

    const handleSmartSchedule = (type: 'event' | 'new-task-event', duration: number, eventName?: string, currentScheduledTime?: Date) => {
        setSmartScheduleContext({ type, duration, eventName, currentScheduledTime });
        setSmartScheduleOpen(true);
    };

    const handleSmartScheduleSuccess = (timestamp: Date) => {
        if (!smartScheduleContext) return;

        const executeScheduleUpdate = async () => {
            if (smartScheduleContext.type === 'event') {
                // For existing events, update their scheduled timestamp
                if (state.goal.id && state.goal.goal_type === 'event') {
                    const updatedEvent = await updateEvent(state.goal.id, {
                        scheduled_timestamp: timestamp,
                        move_reason: 'Smart scheduled'
                    });
                    setState({
                        ...state,
                        goal: updatedEvent
                    });
                    if (onSuccess) {
                        onSuccess(updatedEvent);
                    }
                }
            } else if (smartScheduleContext.type === 'new-task-event') {
                // For new task events, set the timestamp and trigger the add event flow
                setNewEventScheduled(timestamp);
                setSmartScheduleOpen(false);
                setSmartScheduleContext(null);
                // Auto-trigger the add event after smart scheduling
                setTimeout(() => {
                    handleAddEvent();
                }, 100);
                return; // Don't close the dialog yet, let handleAddEvent handle it
            }

            setSmartScheduleOpen(false);
            setSmartScheduleContext(null);
        };

        executeScheduleUpdate().catch((error: any) => {
            console.error('Failed to smart schedule event:', error);

            // Check if it's a task date validation error
            if (isTaskDateValidationError(error)) {
                const validationError: TaskDateValidationError = typeof error === 'string' ? JSON.parse(error) : error;
                const eventName = smartScheduleContext.eventName || state.goal.name || 'Event';
                showTaskDateWarning(validationError, eventName, executeScheduleUpdate);
                return;
            }

            setState({
                ...state,
                error: 'Failed to update event schedule'
            });
        });
    };

    const handleSmartScheduleClose = () => {
        setSmartScheduleOpen(false);
        setSmartScheduleContext(null);
    };

    const handleCompletionToggle = async (completed: boolean) => {
        try {
            if (state.goal.goal_type === 'event') {
                console.log('[GoalMenu] Event completion toggle - Initial state:', {
                    id: state.goal.id,
                    completed: state.goal.completed,
                    newCompleted: completed
                });

                // Ensure we have a valid ID before proceeding
                if (!state.goal.id) {
                    setState({
                        ...state,
                        error: 'Cannot update event: missing event ID'
                    });
                    return;
                }

                // For all event completion/uncompletion, use event-specific APIs
                if (completed) {
                    // Completing an event - use the event completion API
                    const response = await completeEvent(state.goal.id);

                    // Update the completion status while preserving the ID
                    setState({
                        ...state,
                        goal: {
                            ...state.goal,
                            completed: true
                        }
                    });

                    // Check if we should prompt for task completion
                    if (response.should_prompt_task_completion && response.parent_task_id) {
                        if (window.confirm(`You've completed the last scheduled event for "${response.parent_task_name}". Is this task complete?`)) {
                            // Complete the parent task
                            await completeGoal(response.parent_task_id, true);
                        }
                    }

                    if (onSuccess) {
                        onSuccess({
                            ...state.goal,
                            completed: true
                        });
                    }
                } else {
                    // Uncompleting an event - use the event update API
                    console.log('[GoalMenu] Uncompleting event with ID:', state.goal.id);
                    const updatedEvent = await updateEvent(state.goal.id, {
                        completed: false
                    });

                    console.log('[GoalMenu] updateEvent response:', {
                        id: updatedEvent.id,
                        completed: updatedEvent.completed
                    });

                    // Ensure the ID is preserved from the original goal
                    const safeUpdatedEvent = {
                        ...updatedEvent,
                        id: updatedEvent.id || state.goal.id // Fallback to original ID if lost
                    };

                    console.log('[GoalMenu] Safe updated event:', {
                        id: safeUpdatedEvent.id,
                        completed: safeUpdatedEvent.completed
                    });

                    setState({
                        ...state,
                        goal: safeUpdatedEvent
                    });

                    if (onSuccess) {
                        onSuccess(safeUpdatedEvent);
                    }
                }
            } else {
                // For all non-events, use regular completion
                const completion = await completeGoal(state.goal.id!, completed);

                // Only update the completion status
                setState({
                    ...state,
                    goal: {
                        ...state.goal,
                        completed: completion
                    }
                });

                if (onSuccess) {
                    onSuccess(state.goal);
                }
            }
        } catch (error) {
            console.error('Failed to update completion status:', error);
            setState({
                ...state,
                error: 'Failed to update completion status'
            });
        }
    };

    // This logic should now be handled in the parent component
    // by passing appropriate callbacks to the GoalMenu.
    // For now, we'll just log the error.
    const showTaskDateWarning = (error: TaskDateValidationError, eventName: string, retryAction: () => Promise<void>) => {
        console.error("Task date validation error:", error);
    };

    const isTaskDateValidationError = (error: any): error is TaskDateValidationError => {
        return error && error.error_code === 'task_date_range_violation';
    };

    // Handle task date warning dialog actions


    // Helper function to create a temporary event object for unsaved tasks
    const makeTempEvent = (scheduledTime: Date, duration: number): Goal => ({
        id: 0, // Sentinel value for unsaved events
        name: 'New Event',
        goal_type: 'event' as GoalType,
        scheduled_timestamp: scheduledTime,
        duration: duration,
        completed: false,
        parent_type: 'task'
    });

    // Modify the handleAddEvent function to handle date validation errors
    const handleAddEvent = useCallback(async () => {
        const executeAddEvent = async () => {
            // Create temporary event object
            const tempEvent = makeTempEvent(newEventScheduled, newEventDuration);

            if (!state.goal.id) {
                // Task not yet saved - cache locally only
                setTaskEvents(prev => [...prev, tempEvent]);
                setTotalDuration(prev => prev + newEventDuration);
                setShowAddEvent(false);
                return;
            }

            // Task already exists - behave as before
            try {
                await createEvent({
                    parent_id: state.goal.id!,
                    parent_type: 'task',
                    scheduled_timestamp: newEventScheduled,
                    duration: newEventDuration
                });
                fetchTaskEvents(state.goal.id);
                setShowAddEvent(false);
            } catch (error) {
                console.error('Failed to add event:', error);
                if (isTaskDateValidationError(error)) {
                    showTaskDateWarning(error, "New Event", executeAddEvent);
                } else {
                    setState({ ...state, error: 'Failed to add event' });
                }
            }
        };

        try {
            await executeAddEvent();
        } catch (error) {
            console.error('Failed to create event:', error);

            // Check if it's a task date validation error
            if (isTaskDateValidationError(error)) {
                const validationError: TaskDateValidationError = typeof error === 'string' ? JSON.parse(error) : error;
                showTaskDateWarning(validationError, "New Event", executeAddEvent);
                return;
            }

            setState({
                ...state,
                error: 'Failed to create event'
            });
        }
    }, [state, newEventScheduled, newEventDuration, setState, fetchTaskEvents]);

    // Handle removing an event from the task
    const handleRemoveEvent = useCallback(async (eventIndex: number) => {
        const event = taskEvents[eventIndex];

        if (event.id && event.id > 0) {
            // For existing events, delete via API
            try {
                await deleteEvent(event.id, false);
            } catch (error) {
                console.error('Failed to delete event:', error);
                setState({
                    ...state,
                    error: 'Failed to delete event'
                });
                return;
            }
        }

        // Remove from local state
        const removedDuration = event.duration || 0;
        setTaskEvents(prev => prev.filter((_, index) => index !== eventIndex));
        setTotalDuration(prev => prev - removedDuration);
    }, [taskEvents, setState, state]);

    // Add handlers for routine delete dialog
    const handleRoutineDeleteConfirm = async () => {
        console.log('[GoalMenu] handleRoutineDeleteConfirm', routineDeleteDialog);
        if (!routineDeleteDialog.eventId) return;

        try {
            if (routineDeleteDialog.selectedScope === 'all') {
                console.log('[GoalMenu] Delete scope = ALL');

                // Delete the parent routine - backend will cascade delete all events
                const parentRoutineId = state.goal.parent_id;
                if (!parentRoutineId) {
                    console.warn('[GoalMenu] No parentRoutineId found, cannot delete all events');
                    throw new Error('Cannot find parent routine to delete all events');
                }

                console.log('[GoalMenu] Deleting parent routine goal (will cascade to all events)', { parentRoutineId });
                await deleteGoal(parentRoutineId);

                // Force refresh of routines to clean up any cached state
                console.log('[GoalMenu] Calling updateRoutines() after routine deletion');
                await updateRoutines();
            } else {
                const deleteFuture = routineDeleteDialog.selectedScope === 'future';
                console.log('[GoalMenu] Delete scope =', routineDeleteDialog.selectedScope, { deleteFuture });
                await deleteEvent(routineDeleteDialog.eventId, deleteFuture);

                // Refresh routines so calendar updates when deleting future occurrences
                if (deleteFuture) {
                    console.log('[GoalMenu] Calling updateRoutines() after deletion');
                    try {
                        await updateRoutines();
                    } catch (e) {
                        console.warn('Routine update after delete failed', e);
                    }
                }
            }

            // Close dialog and menu upon success
            setRoutineDeleteDialog({
                isOpen: false,
                eventId: null,
                eventName: '',
                selectedScope: 'single'
            });
            if (onSuccess) {
                onSuccess(state.goal);
            }
            close();
        } catch (error) {
            console.error('Failed to delete routine event:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to delete routine event'
            });
        }
    };

    const handleRoutineDeleteCancel = () => {
        setRoutineDeleteDialog({
            isOpen: false,
            eventId: null,
            eventName: '',
            selectedScope: 'single'
        });
    };

    // --------------------
    // Render
    // --------------------
    return (
        <Dialog
            open={isOpen}
            onClose={close}
            maxWidth="sm"
            fullWidth
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' && !event.shiftKey && !isViewOnly) {
                    event.preventDefault();
                    handleSubmit();
                }
            }}
        >
            {/* ---- Dialog Title ---- */}
            <DialogTitle>{title}</DialogTitle>
            {/* ---- Dialog Content ---- */}
            <DialogContent>
                {state.error && (
                    <Box sx={{ color: 'error.main', mb: 2 }}>{state.error}</Box>
                )}
                {/* Parent display (view mode only) */}
                {state.mode === 'view' && parentGoals.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
                            Parent
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {parentGoals.map((parent) => (
                                <Box
                                    key={parent.id}
                                    sx={{
                                        backgroundColor: getGoalColor(parent),
                                        color: 'white',
                                        px: 1.5,
                                        py: 0.75,
                                        borderRadius: '16px',
                                        fontSize: '0.875rem',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        '&:hover': {
                                            transform: 'translateY(-2px)',
                                            boxShadow: 2
                                        }
                                    }}
                                    onClick={() => open(parent, 'view')}
                                >
                                    {parent.name}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}

                {/* Child display (view mode only) */}
                {state.mode === 'view' && childGoals.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
                            Children
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {childGoals.map((child) => (
                                <Box
                                    key={child.id}
                                    sx={{
                                        backgroundColor: getGoalColor(child),
                                        color: 'white',
                                        px: 1.5,
                                        py: 0.75,
                                        borderRadius: '16px',
                                        fontSize: '0.875rem',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        '&:hover': {
                                            transform: 'translateY(-2px)',
                                            boxShadow: 2
                                        }
                                    }}
                                    onClick={() => open(child, 'view')}
                                >
                                    {child.name}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}

                {/* Stats display (view mode only) */}
                {state.mode === 'view' && (state.goal.goal_type === 'routine' || state.goal.goal_type === 'task' || state.goal.goal_type === 'event') && (
                    <Box sx={{ mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <AssessmentIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                            <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                                Statistics
                            </Typography>
                        </Box>

                        {statsLoading ? (
                            <Box sx={{ textAlign: 'center', py: 2 }}>
                                <Typography variant="body2" color="text.secondary">Loading stats...</Typography>
                            </Box>
                        ) : goalStats && (goalStats.total_events > 0 || state.goal.goal_type === 'routine' || state.goal.goal_type === 'event') ? (
                            <Card variant="outlined" sx={{ mb: 2 }}>
                                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                    {state.goal.goal_type === 'event' ? (
                                        <>
                                            <Box sx={{ textAlign: 'center', mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                                    Sibling Events Completion Statistics
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    Performance of all events from the same {state.goal.parent_type || 'parent'}
                                                </Typography>
                                            </Box>

                                            <Grid container spacing={2}>
                                                <Grid item xs={6}>
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                                            {goalStats.completion_rate !== undefined ?
                                                                (goalStats.completion_rate * 100).toFixed(1) : '0.0'}%
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            10-Day Completion Rate
                                                        </Typography>
                                                    </Box>
                                                </Grid>
                                                <Grid item xs={6}>
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'secondary.main' }}>
                                                            {goalStats.last_30_days_completion_rate !== undefined ?
                                                                (goalStats.last_30_days_completion_rate * 100).toFixed(1) : '0.0'}%
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            All-Time Completion Rate
                                                        </Typography>
                                                    </Box>
                                                </Grid>
                                                <Grid item xs={6}>
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                                                            {goalStats.completed_events}/{goalStats.total_events}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Events Completed
                                                        </Typography>
                                                    </Box>
                                                </Grid>
                                                <Grid item xs={6}>
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'info.main' }}>
                                                            {goalStats.avg_reschedule_distance_hours !== undefined ?
                                                                goalStats.avg_reschedule_distance_hours.toFixed(1) : '0.0'}%
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Consistency (StdDev)
                                                        </Typography>
                                                    </Box>
                                                </Grid>
                                                {goalStats.reschedule_count !== undefined && goalStats.reschedule_count > 0 && (
                                                    <Grid item xs={12}>
                                                        <Box sx={{ textAlign: 'center' }}>
                                                            <Typography variant="body2" color="text.secondary">
                                                                Recent Events (10 days): {goalStats.reschedule_count}
                                                            </Typography>
                                                        </Box>
                                                    </Grid>
                                                )}
                                            </Grid>
                                        </>
                                    ) : (
                                        <Grid container spacing={2}>
                                            {goalStats.completion_rate !== undefined && (
                                                <Grid item xs={6}>
                                                    <Box sx={{ textAlign: 'center' }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                                            {(goalStats.completion_rate * 100).toFixed(1)}%
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Completion Rate
                                                        </Typography>
                                                    </Box>
                                                </Grid>
                                            )}
                                            <Grid item xs={6}>
                                                <Box sx={{ textAlign: 'center' }}>
                                                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                                                        {goalStats.completed_events}/{goalStats.total_events}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Events Completed
                                                    </Typography>
                                                </Box>
                                            </Grid>

                                            {goalStats.reschedule_count !== undefined && goalStats.reschedule_count > 0 && (
                                                <>
                                                    <Grid item xs={6}>
                                                        <Box sx={{ textAlign: 'center' }}>
                                                            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'warning.main' }}>
                                                                {goalStats.reschedule_count}
                                                            </Typography>
                                                            <Typography variant="caption" color="text.secondary">
                                                                Reschedules
                                                            </Typography>
                                                        </Box>
                                                    </Grid>
                                                    {goalStats.avg_reschedule_distance_hours !== undefined && (
                                                        <Grid item xs={6}>
                                                            <Box sx={{ textAlign: 'center' }}>
                                                                <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'info.main' }}>
                                                                    {goalStats.avg_reschedule_distance_hours.toFixed(1)}h
                                                                </Typography>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    Avg Move Distance
                                                                </Typography>
                                                            </Box>
                                                        </Grid>
                                                    )}
                                                </>
                                            )}
                                        </Grid>
                                    )}
                                </CardContent>
                            </Card>
                        ) : (
                            <Box sx={{ textAlign: 'center', py: 2 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                    No statistics available yet.
                                    {state.goal.goal_type === 'task' ? ' Add some events to see stats.' : ' Complete some routine events to see stats.'}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                )}
                {commonFields}
                {parentSelectorField}
                {renderTypeSpecificFields()}
            </DialogContent>
            {/* ---- Dialog Actions ---- */}
            <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {state.mode === 'view' && (
                        <>
                            {state.goal.goal_type !== 'event' && (
                                <>
                                    <Button onClick={handleCreateChild} color="secondary">Create Child</Button>
                                    {state.goal.goal_type === 'achievement' && (
                                        <Button onClick={handleCreateQueue} color="secondary">Create Queue</Button>
                                    )}
                                    <Button onClick={handleEdit} color="primary">Edit</Button>
                                    <Button onClick={handleRelations} color="secondary">Relationships</Button>
                                </>
                            )}
                            {state.goal.goal_type === 'event' && (
                                <>
                                    <Button onClick={handleEdit} color="primary">Edit</Button>
                                    <Button onClick={() => handleSmartSchedule('event', state.goal.duration || 60, state.goal.name, state.goal.scheduled_timestamp)} color="secondary">Smart Schedule</Button>
                                    <Button onClick={handleSplitEvent} color="secondary">Split Event</Button>
                                </>
                            )}
                        </>
                    )}
                    {state.mode === 'edit' && (
                        <Button onClick={handleDelete} color="error">Delete</Button>
                    )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={close}>{isViewOnly ? 'Close' : 'Cancel'}</Button>
                    {!isViewOnly && (
                        <Button onClick={() => handleSubmit()} color="primary">{state.mode === 'create' ? 'Create' : 'Save'}</Button>
                    )}
                    {state.mode === 'create' && (
                        <Button onClick={() => handleSubmit(true)} color="primary">Create Another</Button>
                    )}
                </Box>
            </DialogActions>
            {/* ---- Nested Dialogs ---- */}
            {relationsOpen && <GoalRelations goal={state.goal} onClose={() => setRelationsOpen(false)} />}
            {smartScheduleOpen && smartScheduleContext && (
                <SmartScheduleDialog
                    open={smartScheduleOpen}
                    duration={smartScheduleContext.duration}
                    eventName={smartScheduleContext.eventName}
                    currentScheduledTime={smartScheduleContext.currentScheduledTime}
                    onClose={handleSmartScheduleClose}
                    onSelect={handleSmartScheduleSuccess}
                />
            )}
            {/* Routine Update Scope Dialog */}
            <Dialog
                open={routineUpdateDialog.isOpen}
                onClose={() => setRoutineUpdateDialog({ ...routineUpdateDialog, isOpen: false })}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Update Routine Event</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        You're modifying a routine event. What scope would you like to apply this change to?
                    </Typography>
                    {routineUpdateDialog.updateType === 'scheduled_time' && (
                        <Typography variant="body2" sx={{ mb: 2, color: 'info.main' }}>
                            This will change the scheduled time for the selected events.
                        </Typography>
                    )}
                    {routineUpdateDialog.updateType === 'duration' && (
                        <Typography variant="body2" sx={{ mb: 2, color: 'info.main' }}>
                            This will change the duration for the selected events.
                        </Typography>
                    )}
                    {routineUpdateDialog.updateType === 'other' && (
                        <Typography variant="body2" sx={{ mb: 2, color: 'info.main' }}>
                            This will change the name, description, or other properties for the selected events.
                        </Typography>
                    )}
                    <FormControl component="fieldset">
                        <RadioGroup defaultValue="single" onChange={(e) => routineUpdateDialog.onConfirm(e.target.value as 'single' | 'all' | 'future')}>
                            <FormControlLabel value="single" control={<Radio />} label="Only this occurrence" />
                            <FormControlLabel value="future" control={<Radio />} label="This and all future occurrences" />
                            <FormControlLabel value="all" control={<Radio />} label="All occurrences of this routine" />
                        </RadioGroup>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRoutineUpdateDialog({ ...routineUpdateDialog, isOpen: false })}>Cancel</Button>
                </DialogActions>
            </Dialog>
            {/* Routine Delete Dialog */}
            <Dialog open={routineDeleteDialog.isOpen} onClose={handleRoutineDeleteCancel} maxWidth="sm" fullWidth>
                <DialogTitle>Delete Routine Event</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        You're deleting the routine event "{routineDeleteDialog.eventName}".
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        What would you like to delete?
                    </Typography>
                    <FormControl component="fieldset">
                        <RadioGroup
                            value={routineDeleteDialog.selectedScope}
                            onChange={(e) => setRoutineDeleteDialog({ ...routineDeleteDialog, selectedScope: e.target.value as 'single' | 'all' | 'future' })}
                        >
                            <FormControlLabel value="single" control={<Radio />} label="Only this occurrence" />
                            <FormControlLabel value="future" control={<Radio />} label="This and all future occurrences" />
                            <FormControlLabel value="all" control={<Radio />} label="All occurrences of this routine" />
                        </RadioGroup>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleRoutineDeleteCancel}>Cancel</Button>
                    <Button onClick={handleRoutineDeleteConfirm} color="error" variant="contained">Delete</Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
};

// --------------------
// Static helpers to open/close GoalMenu imperatively
// --------------------
let currentInstance: (() => void) | null = null;
let currentRoot: Root | null = null;

interface GoalMenuComponent extends React.FC<GoalMenuProps> {
    open: (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => void;
    close: () => void;
}

const GoalMenuBase = GoalMenu;
const GoalMenuWithStatic = GoalMenuBase as GoalMenuComponent;

GoalMenuWithStatic.open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
    console.log('[GoalMenu.open] Opening goal menu:', { goalId: goal.id, goalName: goal.name, mode: initialMode });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const cleanup = () => {
        console.log('[GoalMenu.open] Cleaning up goal menu');
        if (currentRoot) {
            currentRoot.unmount();
            currentRoot = null;
        }
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
        currentInstance = null;
    };

    currentInstance = cleanup;

    currentRoot = createRoot(container);
    currentRoot.render(
        <GoalMenuBase
            goal={goal}
            mode={initialMode}
            onClose={cleanup}
            onSuccess={(updatedGoal: Goal) => {
                if (onSuccess) {
                    onSuccess(updatedGoal);
                }
                cleanup();
            }}
        />
    );

    console.log('[GoalMenu.open] Goal menu rendered');
};

GoalMenuWithStatic.close = () => {
    if (currentInstance) currentInstance();
};

export default GoalMenuWithStatic;
