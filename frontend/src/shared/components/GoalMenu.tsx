import React, { useState, useEffect, useCallback, ChangeEvent, useMemo, useRef } from 'react';
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
    FormControl,
    RadioGroup,
    Radio,
    CircularProgress,
    LinearProgress,
    Tooltip,
    Skeleton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import AvTimerIcon from '@mui/icons-material/AvTimer';
import { createGoal, updateGoal, deleteGoal, createRelationship, updateRoutines, completeGoal, completeEvent, deleteEvent, createEvent, getTaskEvents, updateEvent, updateRoutineEvent, updateRoutineEventProperties, TaskDateValidationError, duplicateGoal } from '../utils/api';
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
import { getGoalStyle } from '../styles/colors';
import { goalToLocal } from '../utils/time';
import { privateRequest } from '../utils/api';
import Fuse from 'fuse.js';

type Mode = 'create' | 'edit' | 'view';

// Constants for create-new functionality
const CREATE_NEW_SENTINEL_ID = -1;

interface CreateNewPlaceholder {
    id: number;
    name: string;
    goal_type: '__create__';
}

const isCreatePlaceholder = (g: Goal | CreateNewPlaceholder): g is CreateNewPlaceholder =>
    (g as CreateNewPlaceholder).goal_type === '__create__';

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
    selectedScope: 'single' | 'all' | 'future';
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

        // Default scheduled time in create mode for time-based goal types if missing
        if (
            initialMode === 'create' &&
            (goalCopy.goal_type === 'task' || goalCopy.goal_type === 'event' || goalCopy.goal_type === 'routine') &&
            !goalCopy.scheduled_timestamp
        ) {
            goalCopy.scheduled_timestamp = new Date();
        }

        // Set start_timestamp for create mode if not already set
        if (initialMode === 'create' && !goalCopy.start_timestamp) {
            // If we have a scheduled_timestamp (from calendar click), use that as start_timestamp
            // Otherwise default to today
            goalCopy.start_timestamp = goalCopy.scheduled_timestamp || new Date();
        }

        // For routines, ensure routine_time defaults sensibly
        if (initialMode === 'create' && goalCopy.goal_type === 'routine' && !goalCopy.routine_time) {
            goalCopy.routine_time = goalCopy.scheduled_timestamp || new Date();
        }

        // Provide a reasonable default duration for time-based items
        if (
            initialMode === 'create' &&
            (goalCopy.goal_type === 'event' || goalCopy.goal_type === 'routine') &&
            !goalCopy.duration
        ) {
            goalCopy.duration = 60;
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
    const [autoEventAdded, setAutoEventAdded] = useState<boolean>(false);

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

    // Local string states for duration inputs to allow temporary empty values and smooth editing
    const [durationHoursInput, setDurationHoursInput] = useState<string>('');
    const [durationMinutesInput, setDurationMinutesInput] = useState<string>('');

    // Local string states for each task event's hours/minutes
    const [taskEventInputs, setTaskEventInputs] = useState<Array<{ hours: string; minutes: string }>>([]);

    // Add routine update dialog state
    const [routineUpdateDialog, setRoutineUpdateDialog] = useState<RoutineUpdateDialogState>({
        isOpen: false,
        updateType: 'other',
        originalGoal: null,
        updatedGoal: null,
        selectedScope: 'single',
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

    // Ensure the error at the top is visible by resetting scroll to top when errors appear
    const contentRef = useRef<HTMLDivElement | null>(null);
    const scrollDialogToTop = useCallback(() => {
        if (contentRef.current) {
            contentRef.current.scrollTo({ top: 0, behavior: 'auto' });
            return;
        }
        const fallback = document.querySelector('.MuiDialogContent-root') as HTMLDivElement | null;
        if (fallback) fallback.scrollTop = 0;
    }, []);
    useEffect(() => {
        if (isOpen && state.error) {
            // Scroll after render so the error element is in the DOM
            setTimeout(() => scrollDialogToTop(), 0);
        }
    }, [isOpen, state.error, scrollDialogToTop]);

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

    // Auto-add event for new tasks created from calendar clicks
    useEffect(() => {
        if (!autoEventAdded &&
            state.mode === 'create' &&
            state.goal.goal_type === 'task' &&
            state.goal.scheduled_timestamp &&
            !state.goal.id &&
            taskEvents.length === 0) {
            // This is a new task created from a calendar click - auto-add an event
            const tempEvent = makeTempEvent(state.goal.scheduled_timestamp, 60);
            setTaskEvents([tempEvent]);
            setTotalDuration(60);
            setAutoEventAdded(true);
        }
    }, [autoEventAdded, state.mode, state.goal.goal_type, state.goal.scheduled_timestamp, state.goal.id, taskEvents.length]);

    // Auto-add event when user changes goal type to 'task' in create mode
    useEffect(() => {
        if (!autoEventAdded &&
            state.mode === 'create' &&
            state.goal.goal_type === 'task' &&
            state.goal.scheduled_timestamp &&
            taskEvents.length === 0) {
            // User selected task type, add event with the scheduled timestamp
            const tempEvent = makeTempEvent(state.goal.scheduled_timestamp, 60);
            setTaskEvents([tempEvent]);
            setTotalDuration(60);
            setAutoEventAdded(true);
        }
    }, [autoEventAdded, state.goal.goal_type, state.mode, state.goal.scheduled_timestamp, taskEvents.length]);

    // Fetch parent goals using traversal API
    const fetchParentGoals = useCallback(async (goalId: number, mode: Mode) => {
        console.log('[GoalMenu] fetchParentGoals called with goalId:', goalId);

        // Skip fetching for events - they get their parent from the event-specific helper
        if (state.goal.goal_type === 'event') {
            console.log('[GoalMenu] Skipping fetchParentGoals for event type');
            return;
        }

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

            // Always update parentGoals, even if empty to clear stale data
            setParentGoals(parents);
            console.log('✅ [GoalMenu] Updated parentGoals to:', parents.length, 'items');

            // In edit mode, also populate selectedParents so they show in the selector
            if (mode === 'edit') {
                setSelectedParents(parents);
            }
        } catch (error) {
            console.error('Failed to fetch parent goals:', error);
            // Since we return early for events, this will only run for non-events
            setParentGoals([]);
            if (mode === 'edit') {
                setSelectedParents([]);
            }
        }
    }, [state.goal.goal_type]);

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
            // Skip fetchParentGoals for events - they use their own parent logic
            if (goal.goal_type !== 'event') {
                fetchParentGoals(goal.id, actualMode);
            }
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
            // Don't clear parentGoals for events as they have their own parent management
            if (goalCopy.goal_type !== 'event') {
                setParentGoals([]);
            }
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
            // Skip fetchParentGoals for events - they use their own parent logic
            if (state.goal.goal_type !== 'event') {
                fetchParentGoals(state.goal.id, state.mode);
            }
            fetchChildGoals(state.goal.id, state.mode);
        } else {
            console.log('[GoalMenu] useEffect: No goal ID or dialog closed, clearing relationships');
            // Don't clear parentGoals for events as they have their own parent management
            if (state.goal.goal_type !== 'event') {
                setParentGoals([]);
            }
            setChildGoals([]);
        }
    }, [state.goal.id, state.goal.goal_type, state.mode, isOpen, fetchParentGoals, fetchChildGoals]);

    // Fetch task events when component mounts or goal changes (for tasks opened directly via props)
    useEffect(() => {
        if (state.goal.id && state.goal.goal_type === 'task' && isOpen) {
            console.log('[GoalMenu] useEffect: Fetching task events for task ID:', state.goal.id);
            fetchTaskEvents(state.goal.id);
        } else if (state.goal.goal_type !== 'task') {
            // Clear task events if not a task
            setTaskEvents([]);
            setTotalDuration(0);
        }
    }, [state.goal.id, state.goal.goal_type, isOpen, fetchTaskEvents]);

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
            setAutoEventAdded(false);
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

    // Initialize duration input strings when opening a goal or switching goals
    useEffect(() => {
        if (state.goal.duration !== undefined && state.goal.duration !== 1440) {
            const hours = Math.floor((state.goal.duration || 0) / 60);
            const minutes = (state.goal.duration || 0) % 60;
            setDurationHoursInput(String(hours));
            setDurationMinutesInput(String(minutes));
        } else {
            // For all-day or no duration, clear inputs so user can start fresh
            setDurationHoursInput('');
            setDurationMinutesInput('');
        }
    }, [state.goal.id, isOpen]);

    // Initialize per-event input strings when taskEvents list changes size (e.g., fetched or item added/removed)
    useEffect(() => {
        setTaskEventInputs(prev => {
            if (prev.length !== taskEvents.length) {
                return taskEvents.map(evt => {
                    const dur = evt.duration || 0;
                    return {
                        hours: String(Math.floor(dur / 60)),
                        minutes: String(dur % 60)
                    };
                });
            }
            return prev;
        });
    }, [taskEvents]);

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

    // Helper function to infer default goal type for new parent goals
    const inferParentType = useCallback((child: Goal, relationshipType: 'child' | 'queue'): GoalType => {
        if (relationshipType === 'queue') return 'achievement';
        if (child.goal_type === 'event') return 'task';     // routine also allowed—user can change later
        return 'project';                                    // sensible general default
    }, []);

    // Open nested create dialog for new parent goal
    const openNestedCreateDialog = useCallback((name: string, goalType: GoalType) => {
        GoalMenuWithStatic.open(
            { name, goal_type: goalType } as Goal,
            'create',
            (created) => {
                // 1. make it selectable
                setAllGoals(prev => [...prev, created]);
                setSelectedParents(prev => [...prev, created]);
            }
        );
    }, []);

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

        // Add "Create new goal" option if there's a search query
        let options: (Goal | CreateNewPlaceholder)[] = validGoals;
        if (parentSearchQuery.trim()) {
            const placeholder: CreateNewPlaceholder = {
                id: CREATE_NEW_SENTINEL_ID,
                name: `Create new goal "${parentSearchQuery.trim()}"`,
                goal_type: '__create__'
            };
            options = [placeholder, ...options];
        }

        return options.slice(0, 11); // Limit to 11 results (10 + create option)
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
                    selectedScope: 'single',
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
                        duration: state.goal.duration || 60,
                        priority: state.goal.priority
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
                                        duration: event.duration!,
                                        priority: updatedGoal.priority
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
                // Merge local changes in case API omits some fields (e.g., priority)
                updatedGoal = { ...state.goal, ...updatedGoal };
                console.log('[GoalMenu] updateGoal response priority:', updatedGoal.priority);

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
                        console.log('➖ [GoalMenu] Removing relationship:', parent.id, '->', state.goal.id);
                        await privateRequest(
                            `goals/relationship/${parent.id!}/${state.goal.id!}`,
                            'DELETE'
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
                    GoalMenuWithStatic.open(newGoal, 'create', onSuccess);
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
                selectedScope: 'single',
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

    const handleDuplicate = async () => {
        if (!state.goal.id) return;
        try {
            const duplicated = await duplicateGoal(state.goal.id);
            if (onSuccess) onSuccess(duplicated);
            // Optionally open the duplicate in edit mode for quick rename
            setIsOpen(false);
            setTimeout(() => {
                GoalMenuWithStatic.open(duplicated, 'edit', onSuccess);
            }, 100);
        } catch (error) {
            console.error('Failed to duplicate goal:', error);
            setState({ ...state, error: 'Failed to duplicate goal' });
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
                        type="text"
                        value={durationHoursInput}
                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                            const raw = (e.target.value || '').replace(/\D/g, '');
                            setDurationHoursInput(raw);
                            const hours = raw === '' ? 0 : parseInt(raw, 10);
                            const minutesStr = durationMinutesInput;
                            const minutes = minutesStr === '' ? (state.goal.duration ? state.goal.duration % 60 : 0) : Math.min(59, parseInt(minutesStr, 10) || 0);
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...state.goal,
                                duration: newDuration
                            });
                        }}
                        onBlur={() => {
                            if (durationHoursInput === '') setDurationHoursInput('0');
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{
                            inputMode: 'numeric',
                            pattern: '[0-9]*'
                        }}
                        disabled={isViewOnly}
                        sx={{ width: '50%' }}
                    />
                    <TextField
                        label="Minutes"
                        type="text"
                        value={durationMinutesInput}
                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                            const raw = (e.target.value || '').replace(/\D/g, '');
                            // clamp to 0-59
                            const clamped = raw === '' ? '' : String(Math.min(59, parseInt(raw, 10) || 0));
                            setDurationMinutesInput(clamped);
                            const minutes = clamped === '' ? 0 : parseInt(clamped, 10);
                            const hoursStr = durationHoursInput;
                            const hours = hoursStr === '' ? (state.goal.duration ? Math.floor(state.goal.duration / 60) : 0) : parseInt(hoursStr, 10) || 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...state.goal,
                                duration: newDuration
                            });
                        }}
                        onBlur={() => {
                            if (durationMinutesInput === '') setDurationMinutesInput('0');
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{
                            inputMode: 'numeric',
                            pattern: '[0-9]*'
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
                autoFocus
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
                isOptionEqualToValue={(option, value) => option.id === value.id}
                onChange={(event, newValue) => {
                    // Did user click the create-new item?
                    const createIdx = newValue.findIndex(isCreatePlaceholder);
                    if (createIdx !== -1) {
                        const query = parentSearchQuery.trim();
                        const inferred = inferParentType(state.goal, relationshipType);
                        // Remove placeholder before we open nested dialog
                        const filteredValue = newValue.filter(v => !isCreatePlaceholder(v)) as Goal[];
                        setSelectedParents(filteredValue);
                        openNestedCreateDialog(query, inferred);
                        return; // don't set state yet
                    }
                    setSelectedParents(newValue.filter(v => !isCreatePlaceholder(v)) as Goal[]);
                }}
                inputValue={parentSearchQuery}
                onInputChange={(event, newInputValue) => {
                    setParentSearchQuery(newInputValue);
                }}
                options={getParentOptions()}
                getOptionLabel={(option) => option.name}
                renderOption={(props, option) => {
                    if (isCreatePlaceholder(option)) {
                        return (
                            <Box component="li" {...props} sx={{ color: 'primary.main', fontWeight: 500 }}>
                                <AddIcon sx={{ mr: 1, fontSize: 18 }} />
                                {option.name}
                            </Box>
                        );
                    }
                    return (
                        <Box component="li" {...props}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                {(() => {
                                    const style = getGoalStyle(option);
                                    return (
                                        <Chip
                                            label={option.goal_type}
                                            size="small"
                                            sx={{
                                                ...style,
                                                color: style.textColor,
                                                fontSize: '0.75rem'
                                            }}
                                        />
                                    );
                                })()}
                                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                                    {option.name}
                                </Typography>
                            </Box>
                        </Box>
                    );
                }}
                renderTags={(value, getTagProps) =>
                    value.filter((option): option is Goal => !isCreatePlaceholder(option)).map((option, index) => {
                        const { key, ...tagProps } = getTagProps({ index });
                        const style = getGoalStyle(option);
                        return (
                            <Chip
                                key={key}
                                label={option.name}
                                size="small"
                                sx={{
                                    ...style,
                                    color: style.textColor,
                                    '& .MuiChip-deleteIcon': {
                                        color: style.textColor
                                    }
                                }}
                                {...tagProps}
                            />
                        );
                    })
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
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 1, overflow: 'hidden' }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', flexShrink: 0 }}>
                                        Events {taskEvents.length > 0 && `(${taskEvents.length})`}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        Total: {Math.floor(totalDuration / 60)}h {totalDuration % 60}m
                                    </Typography>
                                </Box>
                                {!isViewOnly && (
                                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                                        <Button
                                            size="small"
                                            onClick={() => handleSmartSchedule('new-task-event', 60, state.goal.name)}
                                            variant="outlined"
                                            color="secondary"
                                        >
                                            Smart Schedule
                                        </Button>
                                        <IconButton
                                            size="small"
                                            onClick={addTempEvent}
                                            sx={{ color: 'primary.main' }}
                                        >
                                            <AddIcon />
                                        </IconButton>
                                    </Box>
                                )}
                            </Box>

                            {/* Events List */}
                            {taskEvents.length > 0 ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {taskEvents.map((event, index) => (
                                        <Box key={index} sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            p: 1,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                            bgcolor: 'background.paper'
                                        }}>
                                            <TextField
                                                type="datetime-local"
                                                value={timestampToInputString(event.scheduled_timestamp, 'datetime')}
                                                onChange={(e) => {
                                                    const newTimestamp = inputStringToTimestamp(e.target.value, 'datetime');
                                                    setTaskEvents(prev => prev.map((evt, idx) =>
                                                        idx === index ? { ...evt, scheduled_timestamp: newTimestamp } : evt
                                                    ));
                                                }}
                                                size="small"
                                                InputLabelProps={{ shrink: true }}
                                                disabled={isViewOnly}
                                                sx={{ flex: 1 }}
                                            />
                                            <TextField
                                                label="H"
                                                type="text"
                                                value={taskEventInputs[index]?.hours ?? String(Math.floor((event.duration || 0) / 60))}
                                                onChange={(e) => {
                                                    const raw = (e.target.value || '').replace(/\D/g, '');
                                                    setTaskEventInputs(prev => {
                                                        const next = [...prev];
                                                        const current = next[index] || { hours: '', minutes: '' };
                                                        next[index] = { ...current, hours: raw };
                                                        return next;
                                                    });
                                                    const hours = raw === '' ? 0 : parseInt(raw, 10);
                                                    const minutesStr = taskEventInputs[index]?.minutes;
                                                    const minutes = minutesStr === undefined || minutesStr === '' ? ((event.duration || 0) % 60) : Math.min(59, parseInt(minutesStr, 10) || 0);
                                                    const newDuration = hours * 60 + minutes;
                                                    const oldDuration = event.duration || 0;
                                                    setTaskEvents(prev => prev.map((evt, idx) =>
                                                        idx === index ? { ...evt, duration: newDuration } : evt
                                                    ));
                                                    setTotalDuration(prev => prev - oldDuration + newDuration);
                                                }}
                                                onBlur={() => {
                                                    setTaskEventInputs(prev => {
                                                        const next = [...prev];
                                                        const current = next[index] || { hours: '', minutes: '' };
                                                        if (current.hours === '') next[index] = { ...current, hours: '0' };
                                                        return next;
                                                    });
                                                }}
                                                size="small"
                                                inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                                                disabled={isViewOnly}
                                                sx={{ width: 60 }}
                                            />
                                            <TextField
                                                label="M"
                                                type="text"
                                                value={taskEventInputs[index]?.minutes ?? String((event.duration || 0) % 60)}
                                                onChange={(e) => {
                                                    const raw = (e.target.value || '').replace(/\D/g, '');
                                                    const clamped = raw === '' ? '' : String(Math.min(59, parseInt(raw, 10) || 0));
                                                    setTaskEventInputs(prev => {
                                                        const next = [...prev];
                                                        const current = next[index] || { hours: '', minutes: '' };
                                                        next[index] = { ...current, minutes: clamped };
                                                        return next;
                                                    });
                                                    const minutes = clamped === '' ? 0 : parseInt(clamped, 10);
                                                    const hoursStr = taskEventInputs[index]?.hours;
                                                    const hours = hoursStr === undefined || hoursStr === '' ? Math.floor((event.duration || 0) / 60) : parseInt(hoursStr, 10) || 0;
                                                    const newDuration = hours * 60 + minutes;
                                                    const oldDuration = event.duration || 0;
                                                    setTaskEvents(prev => prev.map((evt, idx) =>
                                                        idx === index ? { ...evt, duration: newDuration } : evt
                                                    ));
                                                    setTotalDuration(prev => prev - oldDuration + newDuration);
                                                }}
                                                onBlur={() => {
                                                    setTaskEventInputs(prev => {
                                                        const next = [...prev];
                                                        const current = next[index] || { hours: '', minutes: '' };
                                                        if (current.minutes === '') next[index] = { ...current, minutes: '0' };
                                                        return next;
                                                    });
                                                }}
                                                size="small"
                                                inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                                                disabled={isViewOnly}
                                                sx={{ width: 60 }}
                                            />
                                            {!isViewOnly && (
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleRemoveEvent(index)}
                                                    sx={{ color: 'error.main' }}
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            )}
                                        </Box>
                                    ))}
                                </Box>
                            ) : null}
                        </Box>
                        {completedField}
                    </>
                );
            case 'event':
                // Events should display their scheduled time and duration
                return (
                    <>
                        {priorityField}
                        {scheduleField}
                        <Box sx={{ mt: 1, mb: 2, display: 'flex', gap: 1 }}>
                            <Button
                                onClick={() => handleSmartSchedule('event', state.goal.duration || 60, state.goal.name, state.goal.scheduled_timestamp)}
                                variant="outlined"
                                color="secondary"
                                size="small"
                            >
                                Smart Schedule
                            </Button>
                        </Box>
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

    const renderStatsTiles = () => {
        if (state.mode !== 'view') return null;
        if (!(state.goal.goal_type === 'routine' || state.goal.goal_type === 'task' || state.goal.goal_type === 'event')) return null;

        if (statsLoading) {
            return (
                <Box sx={{ mt: 2 }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
                        {[0, 1, 2, 3].map((idx) => (
                            <Box key={idx} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                                <Skeleton variant="rectangular" height={64} />
                            </Box>
                        ))}
                    </Box>
                </Box>
            );
        }

        const isEvent = state.goal.goal_type === 'event';
        const normalizeRate = (value: unknown): number => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return 0;
            return Math.max(0, Math.min(1, numeric));
        };
        const completionRate = normalizeRate(goalStats?.completion_rate);
        const allTimeRate = isEvent ? normalizeRate(goalStats?.last_30_days_completion_rate) : completionRate;
        const total = goalStats?.total_events || 0;
        const completed = goalStats?.completed_events || 0;
        const completedPct = total > 0 ? completed / total : 0;
        const reschedules = goalStats?.reschedule_count ?? 0;
        const avgMove = goalStats?.avg_reschedule_distance_hours ?? 0;

        const RateTile = (props: { label: string; tooltip: string; value: number; icon: React.ReactNode; color?: string; }) => {
            const pct = Number.isFinite(props.value) ? Math.max(0, Math.min(1, props.value)) : 0;
            return (
                <Tooltip title={props.tooltip} placement="top" arrow>
                    <Box sx={{
                        p: 1,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        minHeight: 56,
                        overflow: 'hidden'
                    }}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper', borderRadius: '8px', width: 24, height: 24, flexShrink: 0 }}>
                            {props.icon}
                        </Box>
                        <Box sx={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
                            <CircularProgress size={32} thickness={4} variant="determinate" value={pct * 100} sx={{ color: props.color || 'primary.main' }} />
                            <Typography
                                variant="caption"
                                sx={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    fontWeight: 700,
                                    lineHeight: 1
                                }}
                            >
                                {(pct * 100).toFixed(0)}%
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 48, overflow: 'hidden' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', hyphens: 'none' }}>
                                {props.label}
                            </Typography>
                        </Box>
                    </Box>
                </Tooltip>
            );
        };

        const SimpleTile = (props: { label: string; tooltip: string; primary: string; icon: React.ReactNode; }) => (
            <Tooltip title={props.tooltip} placement="top" arrow>
                <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1, minHeight: 56 }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper', borderRadius: '8px', width: 28, height: 28, color: 'text.secondary' }}>
                        {props.icon}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                            {props.primary}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', hyphens: 'none' }}>
                            {props.label}
                        </Typography>
                    </Box>
                </Box>
            </Tooltip>
        );

        const CompletedTile = () => (
            <Tooltip title="Completed vs total events" placement="top" arrow>
                <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', minHeight: 56, overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper', borderRadius: '8px', width: 28, height: 28, color: 'text.secondary' }}>
                            <EventAvailableIcon sx={{ fontSize: 16 }} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>Done</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>{completed}/{total}</Typography>
                    <LinearProgress variant="determinate" value={completedPct * 100} sx={{ height: 6, borderRadius: 999 }} />
                </Box>
            </Tooltip>
        );

        return (
            <Box sx={{ mt: 2 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1 }}>
                    <RateTile label={isEvent ? '10d' : 'Completion'} tooltip={isEvent ? '10-day completion rate' : 'Completion rate'} value={completionRate} icon={<CheckCircleOutlineIcon sx={{ fontSize: 16, color: 'primary.main' }} />} />
                    {isEvent ? (
                        <RateTile label="All" tooltip="All-time completion rate" value={allTimeRate} icon={<TrendingUpIcon sx={{ fontSize: 16, color: 'secondary.main' }} />} color={'secondary.main'} />
                    ) : (
                        <CompletedTile />
                    )}
                    <SimpleTile label={isEvent ? 'Done' : 'Reschedules'} tooltip={isEvent ? 'Events completed' : 'Number of reschedules'} primary={isEvent ? `${completed}/${total}` : String(reschedules)} icon={<EventAvailableIcon sx={{ fontSize: 16 }} />} />
                    <SimpleTile label={isEvent ? 'Cons' : 'Avg move'} tooltip={isEvent ? 'Consistency (std dev)' : 'Average move distance (hours)'} primary={isEvent ? `${(avgMove || 0).toFixed(1)}%` : `${(avgMove || 0).toFixed(1)}h`} icon={<AvTimerIcon sx={{ fontSize: 16 }} />} />
                </Box>
            </Box>
        );
    };

    const handleEdit = () => {
        setState({
            ...state,
            mode: 'edit'
        });
        setTitle('Edit Goal');
    };

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
                // For tasks: if task already exists, create the event immediately via API
                if (state.goal.goal_type === 'task' && state.goal.id) {
                    const newEvent = makeTempEvent(timestamp, smartScheduleContext.duration);
                    await createEventForExistingTask(newEvent, state.goal.id);
                } else {
                    // For unsaved tasks, add a new temporary event with the smart scheduled time
                    const tempEvent = makeTempEvent(timestamp, smartScheduleContext.duration);
                    setTaskEvents(prev => [...prev, tempEvent]);
                    setTotalDuration(prev => prev + smartScheduleContext.duration);
                }
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

                // Create updated goal object with new completion status
                const updatedGoal = {
                    ...state.goal,
                    completed: completion
                };

                // Update the completion status
                setState({
                    ...state,
                    goal: updatedGoal
                });

                if (onSuccess) {
                    onSuccess(updatedGoal);
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

    // Helper function to add a new temporary event to the task
    const addTempEvent = useCallback(() => {
        const defaultTime = new Date();
        defaultTime.setMinutes(Math.ceil(defaultTime.getMinutes() / 15) * 15); // Round to next 15 min
        const tempEvent = makeTempEvent(defaultTime, 60);
        setTaskEvents(prev => [...prev, tempEvent]);
        setTotalDuration(prev => prev + 60);
    }, []);

    // Helper function to create an event immediately for existing tasks
    const createEventForExistingTask = useCallback(async (event: Goal, taskId: number) => {
        try {
            await createEvent({
                parent_id: taskId,
                parent_type: 'task',
                scheduled_timestamp: event.scheduled_timestamp!,
                duration: event.duration!,
                priority: state.goal.priority
            });
            fetchTaskEvents(taskId);
        } catch (error) {
            console.error('Failed to create event:', error);
            if (isTaskDateValidationError(error)) {
                showTaskDateWarning(error, "New Event", () => createEventForExistingTask(event, taskId));
            } else {
                setState({ ...state, error: 'Failed to create event' });
            }
        }
    }, [setState, state, fetchTaskEvents]);

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
            <DialogContent ref={contentRef}>
                {state.error && (
                    <Box role="alert" sx={{ color: 'error.main', mb: 2 }}>{state.error}</Box>
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
                                        ...getGoalStyle(parent),
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
                                        ...getGoalStyle(child),
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

                {commonFields}
                {parentSelectorField}
                {renderTypeSpecificFields()}
                {renderStatsTiles()}
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
                                    <Button onClick={handleDuplicate} color="secondary">Duplicate</Button>
                                    <Button onClick={handleDelete} color="error">Delete</Button>
                                    {/* <Button onClick={handleRelations} color="secondary">Relationships</Button> */}
                                </>
                            )}
                            {state.goal.goal_type === 'event' && (
                                <>
                                    <Button onClick={handleEdit} color="primary">Edit</Button>
                                    <Button onClick={handleDuplicate} color="secondary">Duplicate</Button>
                                    <Button onClick={handleDelete} color="error">Delete</Button>
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
                    eventDescription={state.goal.description}
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
                        <RadioGroup
                            value={routineUpdateDialog.selectedScope}
                            onChange={(e) => setRoutineUpdateDialog({ ...routineUpdateDialog, selectedScope: e.target.value as 'single' | 'all' | 'future' })}
                        >
                            <FormControlLabel value="single" control={<Radio />} label="Only this occurrence" />
                            <FormControlLabel value="future" control={<Radio />} label="This and all future occurrences" />
                            <FormControlLabel value="all" control={<Radio />} label="All occurrences of this routine" />
                        </RadioGroup>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRoutineUpdateDialog({ ...routineUpdateDialog, isOpen: false })}>Cancel</Button>
                    <Button
                        onClick={() => routineUpdateDialog.onConfirm(routineUpdateDialog.selectedScope)}
                        color="primary"
                        variant="contained"
                    >
                        Update
                    </Button>
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
            // Defer unmounting to the next tick so we don't unmount while React is still rendering
            const rootToUnmount = currentRoot;
            currentRoot = null;
            setTimeout(() => {
                rootToUnmount.unmount();
            });
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
            }}
        />
    );

    console.log('[GoalMenu.open] Goal menu rendered');
};

GoalMenuWithStatic.close = () => {
    if (currentInstance) currentInstance();
};

export default GoalMenuWithStatic;
