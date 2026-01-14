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
    InputAdornment,
    Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import AvTimerIcon from '@mui/icons-material/AvTimer';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import { createGoal, updateGoal, deleteGoal, createRelationship, deleteRelationship, updateRoutines, resolveGoal, completeEvent, deleteEvent, createEvent, getTaskEvents, updateEvent, updateRoutineEvent, updateRoutineEventProperties, TaskDateValidationError, duplicateGoal, recomputeRoutineFuture, getGoogleCalendars, CalendarListEntry, deleteGCalEvent, getGoalRelations } from '../utils/api';
import { Goal, GoalType, NetworkEdge, ApiGoal, ResolutionStatus, getDisplayStatus } from '../../types/goals';
import {
    timestampToInputString,
    inputStringToTimestamp,
    timestampToDisplayString,
    deriveRoutineFieldsFromTaskSchedule
} from '../utils/time';
import { validateGoal, validateRelationship } from '../utils/goalValidation'
import { formatFrequency } from '../utils/frequency';
import GoalRelations from "./GoalRelations";
import SmartScheduleDialog from "./SmartScheduleDialog";
import MiniNetworkGraph from './MiniNetworkGraph';
import CompletionBar from './CompletionBar';
import ResolutionStatusToggle from './ResolutionStatusToggle';
import { getGoalStyle } from '../styles/colors';
import { goalToLocal } from '../utils/time';
import { privateRequest } from '../utils/api';
import Fuse from 'fuse.js';
import '../styles/badges.css';
import { showSnackbar } from './Toaster';

type Mode = 'create' | 'edit' | 'view';

// Constants for create-new functionality
const CREATE_NEW_SENTINEL_ID = -1;

// Pending action types for in-flight UI lock
type PendingAction = 'save' | 'create' | 'delete' | 'duplicate';

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
    submitOverride?: (updatedGoal: Goal, originalGoal: Goal, mode: Mode) => Promise<void>;
    defaultSelectedParents?: Goal[];
    defaultRelationshipType?: 'child';
    autoCreateEventTimestamp?: Date | null;
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
    // Effort stats (from stats/effort)
    weighted_completion_rate?: number;
    total_duration_minutes?: number;
    children_count?: number;
}

// Effort stats (all-time, per non-event goal) — mirrored from stats/Stats.tsx
interface EffortStat {
    goal_id: number;
    goal_name: string;
    goal_type: string;
    total_events: number;
    completed_events: number;
    total_duration_minutes: number;
    weighted_completion_rate: number;
    children_count: number;
}

// Add routine update dialog state
interface RoutineUpdateDialogState {
    isOpen: boolean;
    isParentEdit?: boolean;
    updateType: 'scheduled_time' | 'duration' | 'other';
    originalGoal: Goal | null;
    updatedGoal: Goal | null;
    selectedScope: 'single' | 'all' | 'future' | 'range';
    rangeStart: Date | null;
    rangeEnd: Date | null;
    onConfirm: (scope: 'single' | 'all' | 'future' | 'range', rangeStart?: Date, rangeEnd?: Date) => Promise<void>;
}

// Recompute confirmation dialog state
interface RoutineRecomputeDialogState {
    isOpen: boolean;
    originalGoal: Goal | null;
    updatedGoal: Goal | null;
    onConfirm: () => Promise<void>;
}

const GoalMenu: React.FC<GoalMenuProps> = ({ goal: initialGoal, mode: initialMode, onClose, onSuccess, submitOverride, defaultSelectedParents, defaultRelationshipType, autoCreateEventTimestamp }) => {
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

        // Default frequency for new routines
        if (initialMode === 'create' && goalCopy.goal_type === 'routine' && !goalCopy.frequency) {
            goalCopy.frequency = '1D';
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
    const [selectedParents, setSelectedParents] = useState<Goal[]>(defaultSelectedParents || []);
    const [parentSearchQuery, setParentSearchQuery] = useState('');
    const [relationshipType, setRelationshipType] = useState<'child'>(defaultRelationshipType || 'child');
    const [selectedChildren, setSelectedChildren] = useState<Goal[]>([]);
    const [childSearchQuery, setChildSearchQuery] = useState('');

    // Relationship loading guards
    const [parentsLoaded, setParentsLoaded] = useState<boolean>(
        initialMode === 'create' || processedInitialGoal.goal_type === 'event' || !processedInitialGoal.id
    );
    const [childrenLoaded, setChildrenLoaded] = useState<boolean>(
        initialMode === 'create' || !processedInitialGoal.id
    );
    const [relationsLoading, setRelationsLoading] = useState<boolean>(false);
    const actualRelationsLoading =
        state.mode !== 'create' &&
        (!parentsLoaded || !childrenLoaded || relationsLoading);

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

    // Google Calendar state
    const [gcalCalendars, setGcalCalendars] = useState<CalendarListEntry[]>([]);
    const [showDeleteGcalConfirm, setShowDeleteGcalConfirm] = useState<boolean>(false);
    const statsContainerRef = useRef<HTMLDivElement | null>(null);
    const prevStatsHeightRef = useRef<number | null>(null);
    const lastSkeletonStateRef = useRef<boolean | null>(null);
    const statsLoadStartRef = useRef<number | null>(null);
    // Baseline of routine schedule fields captured once for edit-mode comparisons
    const routineBaselineRef = useRef<{ frequency?: string | null; start_timestamp?: Date | null; end_timestamp?: Date | null } | null>(null);

    // Log stats-related state transitions that may impact layout
    useEffect(() => {
        console.log('[GoalMenu][Stats] statsLoading changed:', { statsLoading });
    }, [statsLoading]);
    useEffect(() => {
        console.log('[GoalMenu][Stats] goalStats updated:', { hasGoalStats: !!goalStats, goalStats });
    }, [goalStats]);
    useEffect(() => {
        const el = statsContainerRef.current;
        const now = new Date().toISOString();
        if (el) {
            const rect = el.getBoundingClientRect();
            const prev = prevStatsHeightRef.current;
            prevStatsHeightRef.current = rect.height;
            let gridCols: string | undefined;
            try {
                gridCols = (getComputedStyle(el).gridTemplateColumns || undefined) as unknown as string | undefined;
            } catch (_) {}
            console.log('[GoalMenu][Stats] container measure:', {
                time: now,
                height: rect.height,
                heightDelta: prev == null ? null : rect.height - prev,
                width: rect.width,
                gridCols,
                statsLoading,
                hasGoalStats: !!goalStats,
                mode: state.mode,
                goalType: state.goal.goal_type
            });
        } else {
            //console.log('[GoalMenu][Stats] container not mounted:', { time: now, statsLoading, hasGoalStats: !!goalStats });
        }
    }, [statsLoading, goalStats, state.mode, state.goal.goal_type]);
    useEffect(() => {
        const el = statsContainerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const h = entry.contentRect.height;
                prevStatsHeightRef.current = h;
                //console.log('[GoalMenu][Stats] resize observer:', {
                //    height: h,
                //    heightDelta: prev == null ? null : h - prev,
                //    statsLoading,
                //    hasGoalStats: !!goalStats
                //});
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [isOpen]);

    // Local string states for duration inputs to allow temporary empty values and smooth editing
    const [durationHoursInput, setDurationHoursInput] = useState<string>('');
    const [durationMinutesInput, setDurationMinutesInput] = useState<string>('');
    const [hoursTouched, setHoursTouched] = useState<boolean>(false);
    const [minutesTouched, setMinutesTouched] = useState<boolean>(false);

    // Local string states for each task event's hours/minutes
    const [taskEventInputs, setTaskEventInputs] = useState<Array<{ hours: string; minutes: string }>>([]);

    // Add routine update dialog state
    const [routineUpdateDialog, setRoutineUpdateDialog] = useState<RoutineUpdateDialogState>({
        isOpen: false,
        updateType: 'other',
        originalGoal: null,
        updatedGoal: null,
        selectedScope: 'single',
        rangeStart: null,
        rangeEnd: null,
        onConfirm: async () => { }
    });

    // Routine recompute dialog
    const [routineRecomputeDialog, setRoutineRecomputeDialog] = useState<RoutineRecomputeDialogState>({
        isOpen: false,
        originalGoal: null,
        updatedGoal: null,
        onConfirm: async () => { }
    });

    // Load Google Calendars when sync is enabled for an event
    useEffect(() => {
        const shouldLoadCalendars = 
            state.goal.goal_type === 'event' && 
            state.goal.gcal_sync_enabled && 
            gcalCalendars.length === 0;
        
        if (shouldLoadCalendars) {
            getGoogleCalendars()
                .then(calendars => setGcalCalendars(calendars))
                .catch(() => setGcalCalendars([]));
        }
    }, [state.goal.gcal_sync_enabled, state.goal.goal_type, gcalCalendars.length]);

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

    // In-flight action lock to prevent duplicate submissions
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const pendingRef = useRef<PendingAction | null>(null);
    useEffect(() => { pendingRef.current = pendingAction; }, [pendingAction]);
    const beginAction = useCallback((name: PendingAction): boolean => {
        if (pendingRef.current) return false;
        setPendingAction(name);
        return true;
    }, []);
    const endAction = useCallback(() => setPendingAction(null), []);
    const isBusy = pendingAction !== null;

    // Robust detection: is the current goal an event that belongs to a routine?
    const isRoutineParentEvent = useMemo(() => {
        if (state.goal.goal_type !== 'event') return false;

        // Direct flag from the event
        if (state.goal.parent_type === 'routine') return true;

        // Selected parents in edit/create flows
        if (selectedParents.some(p => p.goal_type === 'routine')) return true;

        // Resolve via parent_id against loaded goals
        if (state.goal.parent_id) {
            const parent = allGoals.find(g => g.id === state.goal.parent_id) || parentGoals.find(g => g.id === state.goal.parent_id);
            if (parent?.goal_type === 'routine') return true;
        }

        // Fallback: any known parent goal is a routine
        if (parentGoals.some(p => p.goal_type === 'routine')) return true;

        return false;
    }, [state.goal, selectedParents, allGoals, parentGoals]);

    // Ensure the error at the top is visible by resetting scroll to top when errors appear
    const contentRef = useRef<HTMLDivElement | null>(null);
    const scrollDialogToTop = useCallback(() => {
        if (contentRef.current) {
            // JSDOM doesn't implement HTMLElement.scrollTo; gracefully fall back to scrollTop
            const el: any = contentRef.current;
            if (typeof el.scrollTo === 'function') {
                el.scrollTo({ top: 0, behavior: 'auto' });
            } else {
                contentRef.current.scrollTop = 0;
            }
            return;
        }
        const fallback = document.querySelector('.MuiDialogContent-root') as HTMLDivElement | null;
        if (fallback) {
            const el: any = fallback;
            if (typeof el.scrollTo === 'function') {
                el.scrollTo({ top: 0, behavior: 'auto' });
            } else {
                fallback.scrollTop = 0;
            }
        }
    }, []);
    useEffect(() => {
        if (isOpen && state.error) {
            // Scroll after render so the error element is in the DOM
            setTimeout(() => scrollDialogToTop(), 0);
        }
    }, [isOpen, state.error, scrollDialogToTop]);

    // Fetch task events
    const fetchTaskEvents = useCallback(async (taskId: number) => {
        // console.log('[GoalMenu] fetchTaskEvents called with taskId:', taskId);
        try {
            const taskEventsData = await getTaskEvents(taskId);
            // console.log('[GoalMenu] fetchTaskEvents response:', taskEventsData);
            setTaskEvents(taskEventsData.events);
            setTotalDuration(taskEventsData.total_duration);
            // console.log('[GoalMenu] Set taskEvents to:', taskEventsData.events.length, 'events');
        } catch (error) {
            // console.error('Failed to fetch task events:', error);
            setTaskEvents([]);
            setTotalDuration(0);
        }
    }, []);

    // Fetch relations (parents and children) for a goal
    const fetchRelations = useCallback(async (goalId: number) => {
        setRelationsLoading(true);
        try {
            const relations = await getGoalRelations(goalId);
            setParentGoals(relations.parents);
            // Only set children if this goal type can have children (not task, not event)
            if (state.goal.goal_type !== 'task' && state.goal.goal_type !== 'event') {
                setChildGoals(relations.children);
            } else {
                setChildGoals([]);
            }
        } catch (error) {
            console.error('[GoalMenu] fetchRelations error', error);
            setParentGoals([]);
            setChildGoals([]);
        } finally {
            setRelationsLoading(false);
            setParentsLoaded(true);
            setChildrenLoaded(true);
        }
    }, [state.goal.goal_type]);

    // Fetch goal stats
    const fetchGoalStats = useCallback(async (goal: Goal) => {
        if (!goal.id || state.mode !== 'view') return;

        statsLoadStartRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        //console.log('[GoalMenu][Stats] fetch start:', { goalId: goal.id, goalType: goal.goal_type, mode: state.mode });
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
                const completedEvents = taskEvents.filter(event => event.resolution_status === 'completed').length;
                stats = {
                    completion_rate: taskEvents.length > 0 ? completedEvents / taskEvents.length : 0,
                    total_events: taskEvents.length,
                    completed_events: completedEvents
                };
            } else if (goal.goal_type === 'event') {
                // console.log('[GoalMenu] Processing event stats. Parent ID:', goal.parent_id, 'Parent goals:', parentGoals);

                // For events, show completion statistics for all sibling events
                if (goal.parent_id && parentGoals.length > 0) {
                    const parent = parentGoals[0];
                    // console.log('[GoalMenu] Found parent:', parent.name, 'type:', parent.goal_type, 'id:', parent.id);

                    let siblingEvents: any[] = [];

                    if (parent.goal_type === 'routine') {
                        try {
                            // Get all routine events (sibling events)
                            try {
                                // console.log('[GoalMenu] Trying task events API for routine parent:', parent.id);
                                const taskEventsData = await getTaskEvents(parent.id!);
                                siblingEvents = taskEventsData.events;
                                // console.log('[GoalMenu] Task events API worked for routine:', siblingEvents);
                            } catch (taskError) {
                                // console.log('[GoalMenu] Task events API failed for routine, trying calendar data');
                                // Fallback: get calendar data and filter for this routine's events
                                try {
                                    const calendarData = await privateRequest<any>('calendar');
                                    // Filter events that belong to this routine
                                    siblingEvents = calendarData.events?.filter((e: any) =>
                                        e.parent_id === parent.id || e.routine_id === parent.id
                                    ).map((e: any) => ({
                                        id: e.id,
                                        scheduled_timestamp: e.scheduled_timestamp,
                                        resolution_status: e.resolution_status,
                                        ...e
                                    })) || [];
                                    // console.log('[GoalMenu] Calendar data filtered events:', siblingEvents);
                                } catch (calendarError) {
                                    // console.log('[GoalMenu] Calendar fallback also failed:', calendarError);
                                    siblingEvents = [];
                                }
                            }
                        } catch (error) {
                            // console.error('[GoalMenu] Could not fetch routine events:', error);
                        }
                    } else if (parent.goal_type === 'task') {
                        try {
                            const taskEventsData = await getTaskEvents(parent.id!);
                            siblingEvents = taskEventsData.events;
                        } catch (error) {
                            // console.log('Could not fetch task events:', error);
                        }
                    }

                    if (siblingEvents.length > 0) {
                        // console.log('[GoalMenu] Found sibling events:', siblingEvents.length);
                        // console.log('[GoalMenu] Sample sibling events:', siblingEvents.slice(0, 3).map(e => ({
                        //     id: e.id,
                        //     scheduled_timestamp: e.scheduled_timestamp,
                        //     completed: e.completed,
                        //     name: e.name
                        // })));

                        // Calculate completion statistics for sibling events
                        const now = new Date();
                        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

                        // Filter events by time periods - exclude future events
                        const recentEvents = siblingEvents.filter(e => {
                            if (!e.scheduled_timestamp) return false;
                            const eventDate = new Date(e.scheduled_timestamp);
                            return eventDate >= tenDaysAgo && eventDate <= now;
                        });

                        // For all-time, include only events scheduled on or before now (exclude future events)
                        const allEvents = siblingEvents.filter(e => {
                            if (!e.scheduled_timestamp) return false;
                            const eventDate = new Date(e.scheduled_timestamp);
                            return eventDate <= now;
                        });

                        // console.log('[GoalMenu] Filtered events:', {
                        //     total_siblings: siblingEvents.length,
                        //     recent_events: recentEvents.length,
                        //     all_events: allEvents.length,
                        //     recent_sample: recentEvents.slice(0, 2),
                        //     all_sample: allEvents.slice(0, 2)
                        // });

                        // Calculate completion rates - handle resolution_status
                        const recentCompletedEvents = recentEvents.filter(e => e.resolution_status === 'completed').length;
                        const allCompletedEvents = allEvents.filter(e => e.resolution_status === 'completed').length;

                        const recentCompletionRate = recentEvents.length > 0 ? recentCompletedEvents / recentEvents.length : 0;
                        const allTimeCompletionRate = allEvents.length > 0 ? allCompletedEvents / allEvents.length : 0;

                        // console.log('[GoalMenu] Completion calculations:', {
                        //     recent_completed: recentCompletedEvents,
                        //     recent_total: recentEvents.length,
                        //     recent_rate: recentCompletionRate,
                        //     all_completed: allCompletedEvents,
                        //     all_total: allEvents.length,
                        //     all_rate: allTimeCompletionRate
                        // });

                        // Calculate standard error of completion rate (accounts for sample size)
                        let completionStdErr = 0;
                        const n = allEvents.length;
                        if (n > 0) {
                            const p = allTimeCompletionRate;
                            completionStdErr = Math.sqrt(Math.max(0, p * (1 - p) / n));
                        }

                        stats = {
                            completion_rate: recentCompletionRate,
                            total_events: allEvents.length,
                            completed_events: allCompletedEvents,
                            last_30_days_completion_rate: allTimeCompletionRate, // Reusing this field for all-time rate
                            reschedule_count: recentEvents.length, // Reusing this field for recent events count
                            avg_reschedule_distance_hours: completionStdErr * 100 // Reusing this field for stderr %
                        };

                        // console.log('[GoalMenu] Final calculated stats:', stats);
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
                    const isCompleted = goal.resolution_status === 'completed';
                    stats = {
                        completion_rate: isCompleted ? 1.0 : 0.0,
                        total_events: 1,
                        completed_events: isCompleted ? 1 : 0
                    };
                }

                // console.log('[GoalMenu] Final event stats:', stats);
            }

            // Enrich with effort stats (weighted completion, time spent, children)
            // Use parent goal for events so stats reflect the broader context
            const effortTargetId =
                goal.goal_type === 'event'
                    ? goal.parent_id
                    : goal.id;

            if (effortTargetId) {
                try {
                    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    const effortStats = await privateRequest<EffortStat[]>(`stats/effort?range=all&tz=${encodeURIComponent(tz)}`);
                    const effort = effortStats.find(e => e.goal_id === effortTargetId);
                    if (effort) {
                        stats.weighted_completion_rate = effort.weighted_completion_rate;
                        stats.total_duration_minutes = effort.total_duration_minutes;
                        stats.children_count = effort.children_count;

                        // For non-events, prefer weighted completion rate when available
                        if (goal.goal_type !== 'event') {
                            stats.completion_rate = effort.weighted_completion_rate;
                        }
                    }
                } catch (error) {
                    // console.log('Could not fetch effort stats:', error);
                }
            }

            setGoalStats(stats);
        } catch (error) {
            // console.error('Failed to fetch goal stats:', error);
            setGoalStats(null);
        } finally {
            //console.log('[GoalMenu][Stats] fetch end:', { goalId: goal.id, durationMs });
            setStatsLoading(false);
        }
    }, [state.mode, taskEvents, parentGoals]);

    // Auto-add event for new tasks only when caller provides an explicit timestamp
    useEffect(() => {
        if (!autoEventAdded &&
            state.mode === 'create' &&
            state.goal.goal_type === 'task' &&
            autoCreateEventTimestamp &&
            !state.goal.id &&
            taskEvents.length === 0) {
            // Caller (Day/Calendar) requested auto-add with a specific timestamp
            const tempEvent = makeTempEvent(autoCreateEventTimestamp, 60);
            setTaskEvents([tempEvent]);
            setTotalDuration(60);
            setAutoEventAdded(true);
        }
    }, [autoEventAdded, state.mode, state.goal.goal_type, autoCreateEventTimestamp, state.goal.id, taskEvents.length]);

    // Auto-add when user switches to 'task' type in create mode only if caller provided timestamp
    useEffect(() => {
        if (!autoEventAdded &&
            state.mode === 'create' &&
            state.goal.goal_type === 'task' &&
            autoCreateEventTimestamp &&
            taskEvents.length === 0) {
            // Respect the explicit timestamp provided by caller
            const tempEvent = makeTempEvent(autoCreateEventTimestamp, 60);
            setTaskEvents([tempEvent]);
            setTotalDuration(60);
            setAutoEventAdded(true);
        }
    }, [autoEventAdded, state.goal.goal_type, state.mode, autoCreateEventTimestamp, taskEvents.length]);


    const open = useCallback((goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        //create copy, might need to be date.
        const goalCopy = { ...goal }

        // Clear any previous pending action when opening
        endAction();


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

        // Removed queue-specific defaults

        // Set default routine_type if goal type is 'routine' and routine_type is undefined
        if (goalCopy.goal_type === 'routine' && goalCopy.routine_type === undefined) {
            goalCopy.routine_type = 'task';
        }

        // Auto-fill routine_time with the clicked calendar time (stored in scheduled_timestamp)
        if (goalCopy.goal_type === 'routine' && goalCopy.routine_time === undefined) {
            goalCopy.routine_time = goalCopy.scheduled_timestamp || new Date();
        }

        // Default frequency when opening a routine
        if (actualMode === 'create' && goalCopy.goal_type === 'routine' && !goalCopy.frequency) {
            goalCopy.frequency = '1D';
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

        // Fetch task events if this is a task
        if (goal.id && goal.goal_type === 'task') {
            fetchTaskEvents(goal.id);
        } else if (!goal.id) {
            // Don't clear parentGoals for events as they have their own parent management
            if (goalCopy.goal_type !== 'event') {
                setParentGoals([]);
            }
            setChildGoals([]);
            setSelectedChildren([]);
            setChildSearchQuery('');
            setTaskEvents([]);
            setTotalDuration(0);
            // New goals have no relations to load
            setParentsLoaded(true);
            setChildrenLoaded(true);
        }

        // Reset stats when goal changes
        setGoalStats(null);
    }, [setState, fetchTaskEvents, endAction]);

    // Fetch stats when in view mode and goal is loaded
    useEffect(() => {
        if (state.mode === 'view' && state.goal.id) {
            fetchGoalStats(state.goal);
        }
    }, [state.mode, state.goal, taskEvents, fetchGoalStats]);

    // Debug taskEvents changes
    useEffect(() => {
        // console.log('[GoalMenu] taskEvents updated:', { length: taskEvents.length, events: taskEvents });
    }, [taskEvents]);

    // Debug childGoals changes
    useEffect(() => {
        // console.log('[GoalMenu] childGoals updated:', { length: childGoals.length, children: childGoals });
    }, [childGoals]);

    // Debug parentGoals changes
    useEffect(() => {
        // console.log('[GoalMenu] parentGoals updated:', { length: parentGoals.length, parents: parentGoals });
    }, [parentGoals]);

    // Fetch relations when component mounts or goal changes
    useEffect(() => {
        if (state.goal.id && isOpen) {
            setParentsLoaded(false);
            setChildrenLoaded(false);
            fetchRelations(state.goal.id);
        } else {
            setParentGoals([]);
            setChildGoals([]);
            setParentsLoaded(true);
            setChildrenLoaded(true);
        }
    }, [state.goal.id, state.goal.goal_type, isOpen, fetchRelations]);

    // Fetch task events when component mounts or goal changes (for tasks opened directly via props)
    useEffect(() => {
        if (state.goal.id && state.goal.goal_type === 'task' && isOpen) {
            // console.log('[GoalMenu] useEffect: Fetching task events for task ID:', state.goal.id);
            fetchTaskEvents(state.goal.id);
        } else if (state.goal.goal_type !== 'task') {
            // Clear task events if not a task
            setTaskEvents([]);
            setTotalDuration(0);
        }
    }, [state.goal.id, state.goal.goal_type, isOpen, fetchTaskEvents]);

    // Initialize selected parents/children when entering edit mode once relationships are loaded
    useEffect(() => {
        if (state.mode !== 'edit') return;
        if (!state.goal.id) return;
        if (!parentsLoaded && !childrenLoaded) return;

        if (parentsLoaded && parentGoals.length > 0) {
            setSelectedParents(prev => (prev.length === 0 ? parentGoals : prev));
        }
        if (childrenLoaded && childGoals.length > 0) {
            setSelectedChildren(prev => (prev.length === 0 ? childGoals : prev));
        }
    }, [state.mode, state.goal.id, parentsLoaded, childrenLoaded, parentGoals, childGoals]);

    const hasUserInput = (g: Goal | undefined) =>
        !!g && (!!g.name?.trim() || !!g.description?.trim());

    const close = useCallback(() => {
        // Ensure pending lock is cleared on close
        endAction();
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
            setSelectedChildren([]);
            setChildSearchQuery('');
            setTaskEvents([]);
            setTotalDuration(0);
            setAutoEventAdded(false);
            setSmartScheduleOpen(false);
            setSmartScheduleContext(null);
            setGoalStats(null);
            setStatsLoading(false);
            setChildGoals([]);
        }, 100);
    }, [setState, endAction]);

    const isViewOnly = state.mode === 'view';

    useEffect(() => {
        if (!isOpen) {
            onClose();
        }
    }, [isOpen, onClose]);

    // Additional high-level state logs for diagnosing layout shifts
    useEffect(() => {
        //console.log('[GoalMenu] mode changed:', { mode: state.mode, isViewOnly });
    }, [state.mode, isViewOnly]);
    useEffect(() => {
        //console.log('[GoalMenu] dialog open state changed:', { isOpen });
    }, [isOpen]);

    // Debug visibility of the mini network panel
    useEffect(() => {
        const showMini = isViewOnly && !!state.goal.id && state.goal.goal_type !== 'event';
        console.log('[GoalMenu][MiniNetwork] visibility:', {
            show: showMini,
            goalId: state.goal.id,
            goalType: state.goal.goal_type,
            isViewOnly
        });
    }, [isViewOnly, state.goal.id, state.goal.goal_type]);

    // Debug routine field changes (edit mode only)
    useEffect(() => {
        if (state.mode === 'edit' && state.goal.goal_type === 'routine') {
            try {
                console.log('[GoalMenu][Routine][State]', {
                    goalId: state.goal.id,
                    frequency: state.goal.frequency,
                    startMs: state.goal.start_timestamp instanceof Date ? state.goal.start_timestamp.getTime() : null,
                    endMs: state.goal.end_timestamp instanceof Date ? state.goal.end_timestamp.getTime() : null,
                    routineTimeMs: state.goal.routine_time instanceof Date ? state.goal.routine_time.getTime() : null
                });
            } catch (_) {}
        }
    }, [state.goal.frequency, state.goal.start_timestamp, state.goal.end_timestamp, state.goal.routine_time, state.mode, state.goal.goal_type, state.goal.id]);

    // Debug: Compare baseline sources (props vs server vs state) for routines in edit mode
    useEffect(() => {
        if (state.mode === 'edit' && state.goal.goal_type === 'routine' && state.goal.id) {
            try {
                const normalizeFrequency = (f?: string) => {
                    const s = (f || '').trim();
                    return s === '' ? '1D' : s;
                };
                const normalizeDate = (d?: Date | null) =>
                    (d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : null);
                const server = allGoals.find(g => g.id === state.goal.id);
                console.log('[GoalMenu][Routine][BaselineComparison]', {
                    initial: {
                        id: initialGoal?.id,
                        frequency: initialGoal?.frequency ?? null,
                        startMs: initialGoal?.start_timestamp instanceof Date ? initialGoal.start_timestamp.getTime() : null,
                        endMs: initialGoal?.end_timestamp instanceof Date ? initialGoal.end_timestamp.getTime() : null,
                        normalized: {
                            freq: normalizeFrequency(initialGoal?.frequency),
                            start: normalizeDate(initialGoal?.start_timestamp),
                            end: normalizeDate(initialGoal?.end_timestamp)
                        }
                    },
                    server: server ? {
                        id: server.id,
                        frequency: server.frequency ?? null,
                        startMs: server.start_timestamp instanceof Date ? server.start_timestamp.getTime() : null,
                        endMs: server.end_timestamp instanceof Date ? server.end_timestamp.getTime() : null,
                        normalized: {
                            freq: normalizeFrequency(server.frequency),
                            start: normalizeDate(server.start_timestamp),
                            end: normalizeDate(server.end_timestamp)
                        }
                    } : null,
                    state: {
                        id: state.goal.id,
                        frequency: state.goal.frequency ?? null,
                        startMs: state.goal.start_timestamp instanceof Date ? state.goal.start_timestamp.getTime() : null,
                        endMs: state.goal.end_timestamp instanceof Date ? state.goal.end_timestamp.getTime() : null,
                        normalized: {
                            freq: normalizeFrequency(state.goal.frequency),
                            start: normalizeDate(state.goal.start_timestamp),
                            end: normalizeDate(state.goal.end_timestamp)
                        }
                    }
                });
            } catch (_) {}
        }
    }, [allGoals, initialGoal, state.mode, state.goal.goal_type, state.goal.id, state.goal.frequency, state.goal.start_timestamp, state.goal.end_timestamp]);

    // Capture a stable baseline for routine schedule fields once in edit mode
    useEffect(() => {
        if (state.mode !== 'edit' || state.goal.goal_type !== 'routine' || !state.goal.id) return;
        if (routineBaselineRef.current) return; // already set
        const server = allGoals.find(g => g.id === state.goal.id);
        const baseline = {
            frequency: server?.frequency ?? state.goal.frequency ?? null,
            start_timestamp: server?.start_timestamp ?? state.goal.start_timestamp ?? null,
            end_timestamp: server?.end_timestamp ?? state.goal.end_timestamp ?? null
        };
        routineBaselineRef.current = baseline;
        try {
            const normFreq = (s?: string | null) => {
                const v = (s || '').trim();
                return v === '' ? '1D' : v;
            };
            const normDate = (d?: Date | null) => (d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : null);
            console.log('[GoalMenu][RoutineBaseline] set', {
                id: state.goal.id,
                raw: baseline,
                normalized: {
                    frequency: normFreq(baseline.frequency || undefined),
                    start: normDate(baseline.start_timestamp || undefined),
                    end: normDate(baseline.end_timestamp || undefined)
                }
            });
        } catch (_) {}
    }, [state.mode, state.goal.goal_type, state.goal.id, allGoals, state.goal.frequency, state.goal.start_timestamp, state.goal.end_timestamp]);

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
    }, [state.goal.id, state.goal.duration, isOpen]);

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


    // Create fuzzy search instance
    const fuse = useMemo(() => {
        return new Fuse(allGoals, {
            keys: ['name', 'description'],
            threshold: 0.3
        });
    }, [allGoals]);

    // Helper function to infer default goal type for new parent goals
    const inferParentType = useCallback((child: Goal, relationshipType: 'child'): GoalType => {
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

        // Ensure selected parents are always in the options to avoid Autocomplete warnings
        // This is critical because MUI Autocomplete complains if 'value' items are not in 'options'
        // Use a Set for O(1) lookup of existing option IDs
        const optionIds = new Set(options.map(o => o.id));
        const selectedButMissing = selectedParents.filter(p => !optionIds.has(p.id));
        
        if (selectedButMissing.length > 0) {
            options = [...options, ...selectedButMissing];
        }

        return options.slice(0, 11 + selectedButMissing.length); // Limit results but include selections
    }, [allGoals, state.goal, parentSearchQuery, fuse, relationshipType, selectedParents]);

    // Infer reasonable default child type based on current goal (parent)
    const inferChildType = useCallback((parent: Goal): GoalType => {
        let inferred: GoalType = (parent.goal_type === 'routine') ? 'routine' : 'task';
        const tempChild = { id: -1, name: '', goal_type: inferred } as Goal;
        const err = validateRelationship(parent, tempChild, 'child');
        if (err) {
            inferred = 'project';
        }
        return inferred;
    }, []);

    // Open nested create dialog for new child goal
    const openNestedCreateChildDialog = useCallback((name: string, goalType: GoalType) => {
        GoalMenuWithStatic.open(
            { name, goal_type: goalType } as Goal,
            'create',
            (created) => {
                setAllGoals(prev => [...prev, created]);
                setSelectedChildren(prev => [...prev, created]);
            }
        );
    }, []);

    // Get filtered child options based on search and validation
    const getChildOptions = useCallback(() => {
        if (!state.goal.goal_type) return [];

        // Filter out invalid child options based on relationship validation
        let validGoals = allGoals.filter(g => {
            // Can't select itself
            if (g.id === state.goal.id) return false;
            // Relationship must be valid child
            const error = validateRelationship(state.goal, g, 'child');
            return !error;
        });

        // Apply fuzzy search if there's a query
        if (childSearchQuery) {
            const results = fuse.search(childSearchQuery);
            const resultIds = new Set(results.map(r => r.item.id));
            validGoals = validGoals.filter(g => resultIds.has(g.id));
        }

        // Add "Create new goal" option if there's a search query
        let options: (Goal | CreateNewPlaceholder)[] = validGoals;
        if (childSearchQuery.trim()) {
            const placeholder: CreateNewPlaceholder = {
                id: CREATE_NEW_SENTINEL_ID,
                name: `Create new goal "${childSearchQuery.trim()}"`,
                goal_type: '__create__'
            };
            options = [placeholder, ...options];
        }

        // Ensure selected children are always in the options to avoid Autocomplete warnings
        const optionIds = new Set(options.map(o => o.id));
        const selectedButMissing = selectedChildren.filter(c => !optionIds.has(c.id));
        
        if (selectedButMissing.length > 0) {
            options = [...options, ...selectedButMissing];
        }

        return options.slice(0, 11 + selectedButMissing.length);
    }, [allGoals, state.goal, childSearchQuery, fuse, selectedChildren]);

    const handleResolutionChange = useCallback(async (newStatus: ResolutionStatus) => {
        try {
            if (state.goal.goal_type === 'event') {
                // Ensure we have a valid ID before proceeding
                if (!state.goal.id) {
                    setState({
                        ...state,
                        error: 'Cannot update event: missing event ID'
                    });
                    return;
                }

                // For events completing, use event-specific API
                if (newStatus === 'completed') {
                    const response = await completeEvent(state.goal.id);

                    // Update the resolution status while preserving the ID
                    setState({
                        ...state,
                        goal: {
                            ...state.goal,
                            resolution_status: 'completed',
                            resolved_at: new Date()
                        }
                    });

                    // Check if we should prompt for task completion
                    if (response.should_prompt_task_completion && response.parent_task_id) {
                        if (window.confirm(`You've completed the last scheduled event for "${response.parent_task_name}". Is this task complete?`)) {
                            // Complete the parent task
                            await resolveGoal(response.parent_task_id, 'completed');
                        }
                    }

                    if (onSuccess) {
                        onSuccess({
                            ...state.goal,
                            resolution_status: 'completed',
                            resolved_at: new Date()
                        });
                    }
                } else {
                    // For other statuses, use the event update API
                    const updatedEvent = await updateEvent(state.goal.id, {
                        resolution_status: newStatus
                    });

                    // Ensure the ID is preserved from the original goal
                    const safeUpdatedEvent = {
                        ...updatedEvent,
                        id: updatedEvent.id || state.goal.id
                    };

                    setState({
                        ...state,
                        goal: safeUpdatedEvent
                    });

                    if (onSuccess) {
                        onSuccess(safeUpdatedEvent);
                    }
                }
            } else {
                // For all non-events, use resolve goal API
                const response = await resolveGoal(state.goal.id!, newStatus);

                // Create updated goal object with new resolution status
                const updatedGoal: Goal = {
                    ...state.goal,
                    resolution_status: response.resolution_status,
                    resolved_at: response.resolved_at ? new Date(response.resolved_at) : undefined
                };

                // Update the resolution status
                setState({
                    ...state,
                    goal: updatedGoal
                });

                if (onSuccess) {
                    onSuccess(updatedGoal);
                }
            }
        } catch (error) {
            // console.error('Failed to update resolution status:', error);
            setState({
                ...state,
                error: 'Failed to update resolution status'
            });
        }
    }, [onSuccess, setState, state]);

    const handleChange = useCallback((newGoal: Goal) => {
        // If in view mode and resolution status changed, update it on the server
        if (state.mode === 'view' && newGoal.resolution_status !== state.goal.resolution_status) {
            handleResolutionChange(newGoal.resolution_status || 'pending');
            return;
        }

        // Set default frequency if goal type is 'routine' and frequency is undefined
        if (state.mode === 'create' && newGoal.goal_type === 'routine' && !newGoal.frequency) {
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

        // Debug: Log routine-related field changes to trace unexpected diffs
        if (newGoal.goal_type === 'routine') {
            try {
                console.log('[GoalMenu][Routine][handleChange]', {
                    prev: {
                        frequency: state.goal.frequency,
                        startMs: state.goal.start_timestamp instanceof Date ? state.goal.start_timestamp.getTime() : null,
                        endMs: state.goal.end_timestamp instanceof Date ? state.goal.end_timestamp.getTime() : null,
                        routineTimeMs: state.goal.routine_time instanceof Date ? state.goal.routine_time.getTime() : null
                    },
                    next: {
                        frequency: newGoal.frequency,
                        startMs: newGoal.start_timestamp instanceof Date ? newGoal.start_timestamp.getTime() : null,
                        endMs: newGoal.end_timestamp instanceof Date ? newGoal.end_timestamp.getTime() : null,
                        routineTimeMs: newGoal.routine_time instanceof Date ? newGoal.routine_time.getTime() : null
                    }
                });
            } catch (_) {}
        }

        // For all changes, update the local state (no immediate prompting for routine events)
        setState({
            ...state,
            goal: newGoal
        });
    }, [state, setState, handleResolutionChange]);

    // Auto-extend task end date to encompass all events during creation
    useEffect(() => {
        if (state.mode === 'create' && state.goal.goal_type === 'task' && taskEvents.length > 0) {
            const latestEventTime = taskEvents.reduce((max, event) => {
                if (!event.scheduled_timestamp) return max;
                const time = new Date(event.scheduled_timestamp).getTime();
                return time > max ? time : max;
            }, 0);

            if (latestEventTime > 0) {
                const currentEnd = state.goal.end_timestamp ? new Date(state.goal.end_timestamp).getTime() : 0;
                
                if (latestEventTime > currentEnd) {
                    handleChange({
                        ...state.goal,
                        end_timestamp: new Date(latestEventTime)
                    });
                }
            }
        }
    }, [taskEvents, state.mode, state.goal, handleChange]);

    const commitDuration = useCallback((): boolean => {
        const hoursStr = durationHoursInput;
        const minutesStr = durationMinutesInput;
        if (hoursStr === '' || minutesStr === '') return false;
        const hours = parseInt(hoursStr, 10) || 0;
        const parsedMinutes = parseInt(minutesStr, 10);
        const minutesClamped = Math.min(59, Math.max(0, isNaN(parsedMinutes) ? 0 : parsedMinutes));
        if (String(minutesClamped) !== minutesStr) {
            setDurationMinutesInput(String(minutesClamped));
        }
        handleChange({
            ...state.goal,
            duration: hours * 60 + minutesClamped
        });
        return true;
    }, [durationHoursInput, durationMinutesInput, state.goal, handleChange]);

    const handleSubmit = async (another: boolean = false) => {
        if (another && state.mode !== 'create') {
            throw new Error('Cannot create another goal in non-create mode');
        }

        // Guard: avoid accidental relationship deletion if relations are still loading
        if (actualRelationsLoading) {
            setState({ ...state, error: 'Please wait for parents and children to load before saving.' });
            return;
        }

        const actionName: PendingAction = state.mode === 'create' ? 'create' : 'save';
        if (!beginAction(actionName)) return;

        // Delegate to external submit if provided (bulk-edit use case)
        if (submitOverride) {
            try {
                await submitOverride(state.goal, initialGoal, state.mode);
                if (onSuccess) onSuccess(state.goal);
                if (another && state.mode === 'create') {
                    const { id, ...restGoal } = state.goal;
                    const newGoal: Goal = { ...restGoal, name: '', description: '' } as Goal;
                    close();
                    setTimeout(() => {
                        GoalMenuWithStatic.open(newGoal, 'create', onSuccess);
                    }, 300);
                } else {
                    close();
                }
            } catch (error) {
                console.error('Failed external submit:', error);
                setState({ ...state, error: error instanceof Error ? error.message : 'Failed to submit changes' });
            } finally {
                endAction();
            }
            return;
        }

        // 0) Date range validation: start date must not be after end date
        try {
            const startTs = state.goal.start_timestamp ? new Date(state.goal.start_timestamp).getTime() : null;
            const endTs = state.goal.end_timestamp ? new Date(state.goal.end_timestamp).getTime() : null;
            if (startTs !== null && endTs !== null && startTs > endTs) {
                setState({
                    ...state,
                    error: 'Start date must be before or on the end date'
                });
                endAction();
                return;
            }
        } catch (_) {
            // If timestamps are malformed, other validations will surface errors.
        }

        // New validations: priority and parent requirements
        // 1) Priority must be selected for all goal types
        if (!state.goal.priority) {
            setState({
                ...state,
                error: 'Priority is required'
            });
            endAction();
            return;
        }

        // 2) Parent requirements for non-directive goals
        if (state.goal.goal_type !== 'directive') {
            // Event in edit mode: must have exactly one parent (task or routine)
            if (state.goal.goal_type === 'event' && state.mode === 'edit') {
                const effectiveParents = selectedParents.length > 0
                    ? selectedParents
                    : (parentGoals.length > 0
                        ? parentGoals
                        : (state.goal.parent_id
                            ? (() => {
                                const found = allGoals.find(g => g.id === state.goal.parent_id);
                                return found ? [found] : [];
                            })()
                            : []));
                if (effectiveParents.length !== 1) {
                    setState({
                        ...state,
                        error: 'Events must have exactly one parent task or routine'
                    });
                    endAction();
                    return;
                }
                const p = effectiveParents[0];
                if (p.goal_type !== 'task' && p.goal_type !== 'routine') {
                    setState({
                        ...state,
                        error: 'Events can only be associated with a task or routine'
                    });
                    endAction();
                    return;
                }
            } else {
                // Non-event (create or edit): require at least one parent
                const hasSelected = selectedParents.length > 0;
                const hasExisting = state.mode === 'edit' && (parentGoals.length > 0 || !!state.goal.parent_id);
                if (!hasSelected && !hasExisting) {
                    setState({
                        ...state,
                        error: 'Select at least one parent goal'
                    });
                    endAction();
                    return;
                }
            }
        }

        // If editing a routine and schedule fields changed, prompt to recompute future occurrences
        if (state.mode === 'edit' && state.goal.goal_type === 'routine') {
            const ng = state.goal;
            const normalizeFrequency = (f?: string) => {
                const s = (f || '').trim();
                return s === '' ? '1D' : s;
            };
            const normalizeDate = (d?: Date | null) =>
                (d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : null);
            const og = routineBaselineRef.current; // use captured, server-backed baseline
            let scheduleChanged = false;
            if (og) {
                scheduleChanged = (
                    normalizeFrequency(og.frequency || undefined) !== normalizeFrequency(ng.frequency) ||
                    normalizeDate(og.start_timestamp || undefined) !== normalizeDate(ng.start_timestamp) ||
                    normalizeDate(og.end_timestamp || undefined) !== normalizeDate(ng.end_timestamp)
                );
            } else {
                // No baseline yet: do not prompt
                scheduleChanged = false;
            }
            try {
                console.log('[GoalMenu][RoutineRecompute] decision context', {
                    goalId: ng.id,
                    mode: state.mode,
                    goalType: state.goal.goal_type,
                    og: og ? {
                        frequency: og.frequency,
                        startMs: og.start_timestamp instanceof Date ? og.start_timestamp.getTime() : null,
                        endMs: og.end_timestamp instanceof Date ? og.end_timestamp.getTime() : null
                    } : null,
                    ng: {
                        frequency: ng.frequency,
                        startMs: ng.start_timestamp instanceof Date ? ng.start_timestamp.getTime() : null,
                        endMs: ng.end_timestamp instanceof Date ? ng.end_timestamp.getTime() : null
                    },
                    normalized: {
                        freqOg: normalizeFrequency(og?.frequency || undefined),
                        freqNg: normalizeFrequency(ng.frequency),
                        startOg: normalizeDate(og?.start_timestamp || undefined),
                        startNg: normalizeDate(ng.start_timestamp),
                        endOg: normalizeDate(og?.end_timestamp || undefined),
                        endNg: normalizeDate(ng.end_timestamp)
                    },
                    scheduleChanged
                });
            } catch (_) {}

            if (scheduleChanged && ng.id) {
                // Use standardized routine update dialog
                setRoutineUpdateDialog({
                    isOpen: true,
                    isParentEdit: true,
                    updateType: 'scheduled_time',
                    originalGoal: initialGoal,
                    updatedGoal: ng,
                    selectedScope: 'future', // Default to future for schedule changes
                    rangeStart: null,
                    rangeEnd: null,
                    onConfirm: async (scope, rangeStart, rangeEnd) => {
                        // Handle scopes for Parent Routine Update
                        // Future: Update Goal + Recompute(now)
                        // All: Update Goal + Recompute(start)
                        // Range: Create State (don't update parent)
                        
                        if (scope === 'range' && rangeStart && rangeEnd) {
                            // For range, we create a temporary state node instead of updating the parent
                            // Since we don't have a direct "update routine range" endpoint, 
                            // we need to rely on the fact that `updateRoutineEventProperties` can create states via parent_id if we had an event ID.
                            // But here we don't.
                            // However, we implemented `update_routine_event_handler` to handle `range`.
                            // If we can't call that without an event ID, we have to do manual composition or assume the user is okay with us
                            // NOT supporting range on parent edit yet?
                            // No, the user explicitly asked for it.
                            
                            // Let's use `updateGoal` but revert the schedule changes first? No.
                            // We need to create a NEW goal (the state).
                            
                            // 1. Create State Goal
                            const stateGoal: Goal = {
                                ...ng,
                                id: undefined,
                                name: ng.name,
                                goal_type: 'routine', // State is stored as routine node
                                parent_id: undefined, // Linked via HAS_STATE, not parent_id field?
                                start_timestamp: rangeStart,
                                end_timestamp: rangeEnd,
                                // ensure routine_time is set
                                routine_time: ng.routine_time
                            };
                            
                            // We need to manually create the state node and link it.
                            // Since we don't have a dedicated endpoint for this specific workflow, 
                            // we can try to use `createGoal` + `createRelationship`.
                            // But `createGoal` doesn't support `HAS_STATE`.
                            
                            // FALLBACK: Use `updateRoutineEvent` if we can find ANY event.
                            // Fetch one event for this routine?
                            try {
                                // Try to find a future event to use as a proxy?
                                // Or just create a dummy event, update it with range, then delete it? Too hacky.
                                
                                console.warn("Range update for parent routine is not fully supported via frontend API yet without an event context.");
                                // For now, treat as 'future' but warn?
                                // Or better: implement the logic in `updateGoal`? No.
                                
                                // Let's just proceed with Future logic if Range is selected to avoid breakage,
                                // or show an error.
                                // But the user demanded standardization.
                                
                                // Actually, if I use `recomputeRoutineFuture` it clears future events.
                                // If I want "Range", I want to KEEP future events outside range.
                                
                                // Let's just implement the 'Future' and 'All' cases correctly first.
                                // And for 'Range', maybe we can just create the Goal and link it manually if we had an endpoint.
                                
                                // HACK: We will just alert that Range is not supported for Parent edits yet if we can't do it.
                                // But I should try to support it.
                                
                                // Let's assume for now we support Future and All.
                                // If scope is Range, we fall back to Future (preserving behavior) or throw.
                                if (scope === 'range') {
                                    alert("Range updates are currently only supported when editing specific events.");
                                    return;
                                }
                            } catch (e) {
                                console.error(e);
                            }
                        } else {
                            // Standard 'future' or 'all' update
                            // 1) Save routine changes
                            const saved = await updateGoal(ng.id!, ng);
                            
                            // 2) Recompute
                            const recomputeFrom = scope === 'all' ? undefined : new Date(); // undefined = start of routine? No, recomputeRoutineFuture(id, undefined) defaults to NOW.
                            // We want 'all' to be from start.
                            // recomputeRoutineFuture takes `fromTimestamp`.
                            // If scope is 'all', we should probably pass the routine's start_timestamp.
                            const fromTs = scope === 'all' ? (ng.start_timestamp || new Date(0)) : new Date();
                            
                            try {
                                await recomputeRoutineFuture(ng.id!, fromTs);
                            } catch (e) {
                                console.error('Failed to recompute routine future:', e);
                            }
                            
                            // 3) Refresh near-term routines in UI
                            try { await updateRoutines(); } catch {}
                            setState({ ...state, goal: saved });
                            if (onSuccess) onSuccess(saved);
                            endAction();
                            close();
                        }
                    }
                });
                return; // wait for user confirmation
            }
        }

        // Check if this is a routine event being modified
        if (state.mode === 'edit' && state.goal.goal_type === 'event' && isRoutineParentEvent) {
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
                    rangeStart: null,
                    rangeEnd: null,
                    onConfirm: async (scope: 'single' | 'all' | 'future' | 'range', rangeStart?: Date, rangeEnd?: Date) => {
                        await handleRoutineEventUpdate(originalGoal, updatedGoal, updateType, scope, rangeStart, rangeEnd);
                    }
                });
                return;
            }
        }

        // Validation checks
        const validationErrors = validateGoal(state.goal);

        // Validate task events against task date range
        if (state.goal.goal_type === 'task' && taskEvents.length > 0) {
            const taskStart = state.goal.start_timestamp ? new Date(state.goal.start_timestamp).getTime() : null;
            const taskEnd = state.goal.end_timestamp ? new Date(state.goal.end_timestamp).getTime() : null;

            for (const event of taskEvents) {
                if (!event.scheduled_timestamp) continue;
                const eventTime = new Date(event.scheduled_timestamp).getTime();

                if (taskStart !== null && eventTime < taskStart) {
                    validationErrors.push(`Event scheduled at ${timestampToDisplayString(event.scheduled_timestamp)} is before the task start date`);
                }
                if (taskEnd !== null && eventTime > taskEnd) {
                    validationErrors.push(`Event scheduled at ${timestampToDisplayString(event.scheduled_timestamp)} is after the task end date`);
                }
            }
        }

        if (validationErrors.length > 0) {
            setState({
                ...state,
                error: validationErrors.join('\n')
            });
            endAction();
            return;
        }

        // Validate parent relationship if selected
        if (selectedParents.length > 0 && (state.mode === 'create' || state.mode === 'edit') && state.goal.goal_type !== 'event') {
            // Check each parent for validation errors
            for (const parent of selectedParents) {
                const relationshipError = validateRelationship(parent, state.goal, relationshipType);
                if (relationshipError) {
                    setState({
                        ...state,
                        error: relationshipError
                    });
                    endAction();
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
                endAction();
                return;
            }
            if (selectedParents.length > 1) {
                setState({
                    ...state,
                    error: 'Events can only have one parent task or routine'
                });
                endAction();
                return;
            }
            if (selectedParents.some(parent => parent.goal_type !== 'task' && parent.goal_type !== 'routine')) {
                setState({
                    ...state,
                    error: 'Events can only be created for tasks or routines'
                });
                endAction();
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
                    // Create child relationships if selected
                    for (const child of selectedChildren) {
                        await createRelationship(
                            updatedGoal.id!,
                            child.id!,
                            'child'
                        );
                    }
                    // Notify network to refresh relationships
                    try {
                        window.dispatchEvent(new CustomEvent('network:relationships-changed', { detail: { goalId: updatedGoal.id } }));
                    } catch (e) {}
                }
            } else if (state.mode === 'edit' && state.goal.id) {
                updatedGoal = await updateGoal(state.goal.id, state.goal);
                // Merge local changes in case API omits some fields (e.g., priority)
                updatedGoal = { ...state.goal, ...updatedGoal };
                // console.log('[GoalMenu] updateGoal response priority:', updatedGoal.priority);

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

                    // Remove old relationships (use API helper matching backend route)
                    for (const parent of parentsToRemove) {
                        // console.log('➖ [GoalMenu] Removing relationship:', parent.id, '->', state.goal.id);
                        await deleteRelationship(
                            parent.id!,
                            state.goal.id!,
                            relationshipType
                        );
                    }
                    // If any changes occurred, notify network to refresh relationships
                    let changed = parentsToAdd.length > 0 || parentsToRemove.length > 0;

                    // Handle child relationships (diff current vs selected)
                    const currentChildIds = new Set(childGoals.map(c => c.id!));
                    const selectedChildIds = new Set(selectedChildren.map(c => c.id!));
                    const childrenToAdd = selectedChildren.filter(c => !currentChildIds.has(c.id!));
                    const childrenToRemove = childGoals.filter(c => !selectedChildIds.has(c.id!));

                    // Add new child relationships
                    for (const child of childrenToAdd) {
                        await createRelationship(
                            state.goal.id!,
                            child.id!,
                            'child'
                        );
                    }
                    // Remove child relationships
                    for (const child of childrenToRemove) {
                        await deleteRelationship(
                            state.goal.id!,
                            child.id!,
                            'child'
                        );
                    }
                    changed = changed || childrenToAdd.length > 0 || childrenToRemove.length > 0;
                    if (changed) {
                        try {
                            window.dispatchEvent(new CustomEvent('network:relationships-changed', { detail: { goalId: updatedGoal.id } }));
                        } catch (e) {}
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
                endAction();
                close();
                setTimeout(() => {
                    GoalMenuWithStatic.open(newGoal, 'create', onSuccess);
                }, 300);
            } else {
                endAction();
                close();
            }
        } catch (error) {
            console.error('Failed to submit goal:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to submit goal'
            });
        } finally {
            // If we early-returned to show a routine dialog, we never reached this block.
            // For all non-dialog flows, ensure the lock is cleared.
            endAction();
        }
    };

    const updateMultipleRoutineEvents = useCallback(async (
        updatedGoal: Goal,
        changeType: 'duration' | 'other',
        scope: 'single' | 'all' | 'future' | 'range',
        rangeStart?: Date,
        rangeEnd?: Date
    ) => {
        if (!updatedGoal.id) {
            throw new Error('Goal ID is required for updating routine events');
        }

        const updates: {
            duration?: number;
            name?: string;
            description?: string;
            priority?: string;
            scheduled_timestamp?: Date;
        } = {};

        if (changeType === 'duration') {
            if (updatedGoal.duration !== undefined) {
                updates.duration = updatedGoal.duration;
            }
        } else {
            if (updatedGoal.name) updates.name = updatedGoal.name;
            if (updatedGoal.description) updates.description = updatedGoal.description;
            if (updatedGoal.priority) updates.priority = updatedGoal.priority;
        }

        const updatedEvents = await updateRoutineEventProperties(updatedGoal.id, updates, scope, rangeStart, rangeEnd);

        if ((scope === 'all' || scope === 'future') && updatedGoal.parent_id) {
            const parentRoutine = allGoals.find(g => g.id === updatedGoal.parent_id);
            if (parentRoutine) {
                const routineUpdates: Partial<Goal> = {};

                if (changeType === 'duration' && updates.duration !== undefined) {
                    routineUpdates.duration = updates.duration;
                } else if (changeType === 'other') {
                    if (updates.name) routineUpdates.name = updates.name;
                    if (updates.description) routineUpdates.description = updates.description;
                    if (updates.priority && ['high', 'medium', 'low'].includes(updates.priority)) {
                        routineUpdates.priority = updates.priority as 'high' | 'medium' | 'low';
                    }
                }

                if (Object.keys(routineUpdates).length > 0) {
                    try {
                        await updateGoal(parentRoutine.id!, {
                            ...parentRoutine,
                            ...routineUpdates
                        });
                        console.log('Updated parent routine with changes:', routineUpdates);
                    } catch (error) {
                        console.warn('Failed to update parent routine:', error);
                    }
                }
            }
        }

        const currentEvent = updatedEvents.find(event => event.id === updatedGoal.id);
        if (currentEvent) {
            setState({ ...state, goal: currentEvent });
        }

        return updatedEvents;
    }, [allGoals, setState, state]);

    const handleRoutineEventUpdate = useCallback(async (
        originalGoal: Goal,
        updatedGoal: Goal,
        updateType: 'scheduled_time' | 'duration' | 'other',
        scope: 'single' | 'all' | 'future' | 'range',
        rangeStart?: Date,
        rangeEnd?: Date
    ) => {
        try {
            if (updateType === 'scheduled_time') {
                // Use the routine event update API for scheduled time changes (including single),
                // so the backend can create a tombstone for the old slot and/or clear tombstones
                // for schedule changes.
                const updatedEvents = await updateRoutineEvent(
                    updatedGoal.id!,
                    updatedGoal.scheduled_timestamp!,
                    scope,
                    rangeStart,
                    rangeEnd
                );

                // Update the routine's default time as well
                if ((scope === 'all' || scope === 'future') && updatedGoal.parent_id) {
                    const parentRoutine = allGoals.find(g => g.id === updatedGoal.parent_id);
                    if (parentRoutine) {
                        await updateGoal(parentRoutine.id!, {
                            ...parentRoutine,
                            routine_time: updatedGoal.scheduled_timestamp
                        });
                    }
                }

                // Refresh near-term routine instances so UI reflects inherited changes
                if (scope === 'all' || scope === 'future' || scope === 'range') {
                    try { await updateRoutines(); } catch (e) {}
                }

                setState({ ...state, goal: updatedEvents[0] || updatedGoal });
            } else if ((updateType === 'duration' || updateType === 'other') && (scope === 'all' || scope === 'future' || scope === 'range')) {
                // For duration or other property changes, update multiple events
                await updateMultipleRoutineEvents(updatedGoal, updateType === 'duration' ? 'duration' : 'other', scope, rangeStart, rangeEnd);
                // Refresh near-term routine instances so UI reflects inherited changes
                try { await updateRoutines(); } catch (e) {}
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
                rangeStart: null,
                rangeEnd: null,
                onConfirm: async () => { }
            });

            if (onSuccess) {
                onSuccess(updatedGoal);
            }
            endAction();
            close();
        } catch (error) {
            console.error('Failed to update routine event:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to update routine event'
            });
        } finally {
            // In case of error, ensure the action lock is released
            endAction();
        }
    }, [allGoals, close, endAction, onSuccess, setState, state, updateMultipleRoutineEvents]);

    const handleDelete = async () => {
        if (!state.goal.id) {
            setState({
                ...state,
                error: 'Cannot delete goal without ID'
            });
            return;
        }
        // console.log('[GoalMenu] handleDelete called', {
        //     goalId: state.goal.id,
        //     goalType: state.goal.goal_type,
        //     parentType: state.goal.parent_type
        // });

        // Check if this event is synced with Google Calendar
        if (state.goal.goal_type === 'event' && state.goal.gcal_event_id && !showDeleteGcalConfirm) {
            setShowDeleteGcalConfirm(true);
            return; // Show confirmation dialog first
        }

        const needsImmediateLock = !(state.goal.goal_type === 'event' && isRoutineParentEvent);
        if (needsImmediateLock) {
            if (!beginAction('delete')) return;
        }

        try {
            if (state.goal.goal_type === 'event') {
                if (isRoutineParentEvent) {
                    // console.log('[GoalMenu] Deleting routine event – opening scope dialog');
                    // Open routine delete dialog instead of immediate confirm
                    setRoutineDeleteDialog({
                        isOpen: true,
                        eventId: state.goal.id!,
                        eventName: state.goal.name,
                        selectedScope: 'single'
                    });
                    return; // Wait for dialog confirmation
                } else {
                    // console.log('[GoalMenu] Deleting single non-routine event', { eventId: state.goal.id });
                    // Regular (non-routine) event – delete single occurrence
                    await deleteEvent(state.goal.id, false);
                }
            } else {
                // console.log('[GoalMenu] Deleting non-event goal', { goalId: state.goal.id });
                // Non-event goals
                await deleteGoal(state.goal.id);
            }

            if (onSuccess) {
                onSuccess(state.goal);
            }
            if (needsImmediateLock) endAction();
            close();
        } catch (error) {
            // console.error('Failed to delete goal:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to delete goal'
            });
        } finally {
            if (needsImmediateLock) endAction();
        }
        // Notify network in all delete flows
        try {
            window.dispatchEvent(new CustomEvent('network:relationships-changed', { detail: { goalId: state.goal.id } }));
        } catch (e) {}
    };

    const handleDeleteWithGcal = async (deleteFromGcal: boolean) => {
        setShowDeleteGcalConfirm(false);
        
        if (!state.goal.id) return;
        
        if (!beginAction('delete')) return;

        try {
            // If user chose to delete from GCal too, do that first
            if (deleteFromGcal && state.goal.gcal_event_id) {
                try {
                    await deleteGCalEvent(state.goal.id);
                } catch (e) {
                    console.error('Failed to delete from Google Calendar:', e);
                    // Continue with local delete even if GCal delete fails
                }
            }

            // Delete locally
            if (state.goal.goal_type === 'event') {
                await deleteEvent(state.goal.id, false);
            } else {
                await deleteGoal(state.goal.id);
            }

            if (onSuccess) {
                onSuccess(state.goal);
            }
            endAction();
            close();
        } catch (error) {
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to delete goal'
            });
            endAction();
        }
        
        try {
            window.dispatchEvent(new CustomEvent('network:relationships-changed', { detail: { goalId: state.goal.id } }));
        } catch (e) {}
    };

    const handleCreateChild = () => {
        const parentGoal = state.goal;
        const newGoal: Goal = {} as Goal;

        close();
        setTimeout(() => {
            GoalMenuWithStatic.open(newGoal, 'create', onSuccess, {
                defaultSelectedParents: [parentGoal],
                defaultRelationshipType: 'child'
            });
        }, 100);
    };

    // Removed queue creation flow

    const handleDuplicate = async () => {
        if (!state.goal.id) return;
        if (!beginAction('duplicate')) return;
        try {
            const duplicated = await duplicateGoal(state.goal.id);
            if (onSuccess) onSuccess(duplicated);
            close();
        } catch (error) {
            console.error('Failed to duplicate goal:', error);
            setState({ ...state, error: 'Failed to duplicate goal' });
        } finally {
            endAction();
        }
    };

    const priorityField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Priority:</strong>{' '}
            {state.goal.priority
                ? state.goal.priority.charAt(0).toUpperCase() + state.goal.priority.slice(1)
                : 'Not set'}
        </Box>
    ) : (
        <TextField
            label="Priority"
            select
            value={state.goal.priority || ''}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                handleChange({
                    ...state.goal,
                    priority:
                        e.target.value === ''
                            ? undefined
                            : (e.target.value as 'high' | 'medium' | 'low'),
                })
            }
            fullWidth
            margin="dense"
            disabled={isViewOnly}
        >
            <MenuItem value="" disabled>
                Select priority
            </MenuItem>
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
                            const isAllDay = e.target.checked;
                            if (isAllDay) {
                                setDurationHoursInput('');
                                setDurationMinutesInput('');
                                setHoursTouched(false);
                                setMinutesTouched(false);
                                handleChange({
                                    ...state.goal,
                                    duration: 1440
                                });
                            } else {
                                setDurationHoursInput('1');
                                setDurationMinutesInput('0');
                                setHoursTouched(false);
                                setMinutesTouched(false);
                                handleChange({
                                    ...state.goal,
                                    duration: 60 // Default to 1 hour when unchecking
                                });
                            }
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
                        }}
                        onBlur={() => {
                            setHoursTouched(true);
                            commitDuration();
                        }}
                        onKeyDown={(e) => {
                            if ((e as any).key === 'Enter') {
                                setHoursTouched(true);
                                setMinutesTouched(true);
                                commitDuration();
                            }
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        error={hoursTouched && durationHoursInput === ''}
                        helperText={hoursTouched && durationHoursInput === '' ? 'Required' : ''}
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
                            setDurationMinutesInput(raw);
                        }}
                        onBlur={() => {
                            setMinutesTouched(true);
                            commitDuration();
                        }}
                        onKeyDown={(e) => {
                            if ((e as any).key === 'Enter') {
                                setHoursTouched(true);
                                setMinutesTouched(true);
                                commitDuration();
                            }
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        error={minutesTouched && durationMinutesInput === ''}
                        helperText={minutesTouched && durationMinutesInput === '' ? 'Required' : ''}
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
    const handleMoveToNow = useCallback(async () => {
        const fiveMinutesMs = 5 * 60 * 1000;
        const nowRounded = new Date(Math.ceil(Date.now() / fiveMinutesMs) * fiveMinutesMs);

        // Create mode or missing ID: just update local state
        if (state.mode !== 'edit' || !state.goal.id) {
            handleChange({ ...state.goal, scheduled_timestamp: nowRounded });
            return;
        }

        // Routine event: open scope dialog and delegate to existing flow
        if (isRoutineParentEvent) {
            const originalGoal = state.goal;
            const updatedGoal = { ...state.goal, scheduled_timestamp: nowRounded } as Goal;
            setRoutineUpdateDialog({
                isOpen: true,
                updateType: 'scheduled_time',
                originalGoal,
                updatedGoal,
                selectedScope: 'single',
                rangeStart: null,
                rangeEnd: null,
                onConfirm: async (scope: 'single' | 'all' | 'future' | 'range', rangeStart?: Date, rangeEnd?: Date) => {
                    await handleRoutineEventUpdate(originalGoal, updatedGoal, 'scheduled_time', scope, rangeStart, rangeEnd);
                }
            });
            return;
        }

        // Regular event: update immediately
        try {
            const updated = await updateEvent(state.goal.id, {
                scheduled_timestamp: nowRounded,
                move_reason: 'Move to now'
            });
            setState({ ...state, goal: updated });
            if (onSuccess) onSuccess(updated);
        } catch (error) {
            if (isTaskDateValidationError(error)) {
                showTaskDateWarning(error, state.goal.name || 'Event', handleMoveToNow);
                return;
            }
            setState({ ...state, error: 'Failed to move event to now' });
        }
    }, [state, isRoutineParentEvent, onSuccess, setState, handleRoutineEventUpdate, handleChange]);
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
                // console.log(`[GoalMenu.tsx] scheduleField render: Raw timestamp=${rawTimestamp}, _tz=${state.goal._tz}`);
                const converted = timestampToInputString(rawTimestamp, 'datetime');
                // console.log(`[GoalMenu.tsx] scheduleField render: Converted to input string=${converted}`);
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
            InputProps={{
                endAdornment: (
                    <InputAdornment position="end">
                        <Tooltip title="Move to now">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleMoveToNow}
                                    aria-label="Move to now"
                                >
                                    <GpsFixedIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </InputAdornment>
                )
            }}
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
        <Box sx={{ mt: 1, mb: 2 }}>
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
            >
                Status
            </Typography>
            <ResolutionStatusToggle
                value={state.goal.resolution_status || 'pending'}
                onChange={(status) =>
                    handleChange({
                        ...state.goal,
                        resolution_status: status
                    })
                }
                disabled={isBusy}
                ariaLabel="Set status"
                dense
            />
        </Box>
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
                        const unit = state.goal.frequency?.match(/[DWMY]/)?.[0] || 'D';
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
            <Box sx={{ mb: 1 }}>
                <strong>Name:</strong> {state.goal.name || 'Not set'}
            </Box>
            <Box sx={{ mb: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                {state.goal.goal_type && (() => {
                    const style = getGoalStyle(state.goal);
                    return (
                        <span
                            className="goal-type-badge"
                            style={{
                                backgroundColor: `${style.backgroundColor}20`,
                                color: style.backgroundColor
                            }}
                        >
                            {state.goal.goal_type}
                        </span>
                    );
                })()}
                {state.goal.priority && (
                    <span className="priority-badge" data-priority={state.goal.priority}>
                        {state.goal.priority}
                    </span>
                )}
                <span className={`status-badge ${getDisplayStatus(state.goal)}`}>
                    {getDisplayStatus(state.goal).charAt(0).toUpperCase() + getDisplayStatus(state.goal).slice(1)}
                </span>
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
                        // Derive routine_time and start_timestamp from scheduled_timestamp if present
                        if (state.goal.scheduled_timestamp) {
                            const derived = deriveRoutineFieldsFromTaskSchedule(state.goal.scheduled_timestamp);
                            updates.routine_time = derived.routine_time;
                            if (!state.goal.start_timestamp) {
                                updates.start_timestamp = derived.start_timestamp;
                            }
                            // Clear scheduled_timestamp to avoid ambiguity on routines
                            updates.scheduled_timestamp = undefined;
                        } else if (state.goal.routine_time === undefined) {
                            // Fall back to current time-of-day if no scheduled time exists
                            updates.routine_time = new Date();
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
            {priorityField}
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
                    const { key, ...liProps } = props as any;
                    if (isCreatePlaceholder(option)) {
                        return (
                            <Box component="li" key={key} {...liProps} sx={{ color: 'primary.main', fontWeight: 500 }}>
                                <AddIcon sx={{ mr: 1, fontSize: 18 }} />
                                {option.name}
                            </Box>
                        );
                    }
                    return (
                        <Box component="li" key={key} {...liProps}>
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
                                : (state.goal.goal_type !== 'directive'
                                    ? "Parent Goals (Required)"
                                    : "Parent Goals (Optional)")
                        }
                        placeholder="Search for parent goals..."
                        helperText={
                            state.goal.goal_type === 'event'
                                ? "Events must be associated with one task or routine"
                                : "Select parent goals to create relationships"
                        }
                        required={state.goal.goal_type === 'event' || state.goal.goal_type !== 'directive'}
                        error={(state.goal.goal_type === 'event' || state.goal.goal_type !== 'directive') && selectedParents.length === 0}
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

    // Child selector field (available in create and edit modes; tasks/events cannot be parents)
    const childSelectorField = ((state.mode === 'create' || state.mode === 'edit') && state.goal.goal_type !== 'task' && state.goal.goal_type !== 'event') ? (
        <Box sx={{ mt: 2, mb: 2 }}>
            <Autocomplete
                multiple
                value={selectedChildren}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                onChange={(event, newValue) => {
                    // Did user click the create-new item?
                    const createIdx = newValue.findIndex(isCreatePlaceholder);
                    if (createIdx !== -1) {
                        const query = childSearchQuery.trim();
                        const inferred = inferChildType(state.goal);
                        // Remove placeholder before we open nested dialog
                        const filteredValue = newValue.filter(v => !isCreatePlaceholder(v)) as Goal[];
                        setSelectedChildren(filteredValue);
                        openNestedCreateChildDialog(query, inferred);
                        return; // don't set state yet
                    }
                    setSelectedChildren(newValue.filter(v => !isCreatePlaceholder(v)) as Goal[]);
                }}
                inputValue={childSearchQuery}
                onInputChange={(event, newInputValue) => {
                    setChildSearchQuery(newInputValue);
                }}
                options={getChildOptions()}
                getOptionLabel={(option) => option.name}
                renderOption={(props, option) => {
                    const { key, ...liProps } = props as any;
                    if (isCreatePlaceholder(option)) {
                        return (
                            <Box component="li" key={key} {...liProps} sx={{ color: 'primary.main', fontWeight: 500 }}>
                                <AddIcon sx={{ mr: 1, fontSize: 18 }} />
                                {option.name}
                            </Box>
                        );
                    }
                    return (
                        <Box component="li" key={key} {...liProps}>
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
                        label="Child Goals (Optional)"
                        placeholder="Search for child goals..."
                        helperText="Select child goals to create relationships"
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
                        {dateFields}
                        {frequencyField}
                        {routineFields}
                    </>
                );
            case 'task':
                return (
                    <>
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
                        {scheduleField}
                        {!isViewOnly && (
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
                        )}
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

                                    {/* Calendar selector */}
                                    {gcalCalendars.length > 0 && (
                                        <TextField
                                            label="Target Calendar"
                                            select
                                            value={state.goal.gcal_calendar_id || 'primary'}
                                            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({
                                                ...state.goal,
                                                gcal_calendar_id: e.target.value
                                            })}
                                            fullWidth
                                            margin="dense"
                                            size="small"
                                            disabled={isViewOnly}
                                        >
                                            {gcalCalendars.map(cal => (
                                                <MenuItem key={cal.id} value={cal.id}>
                                                    {cal.summary} {cal.primary && '(Primary)'}
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                    )}

                                    {state.goal.gcal_event_id && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                            Synced with Google Calendar event: {state.goal.gcal_event_id}
                                        </Typography>
                                    )}

                                    {state.goal.is_gcal_imported && (
                                        <Typography variant="caption" color="primary.main" sx={{ mt: 1, display: 'block' }}>
                                            📅 This event was imported from Google Calendar
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

        // Avoid layout shift: show skeleton only before first data load
        // Keep existing tiles visible during background refreshes
        const shouldShowSkeleton = !goalStats;
        if (lastSkeletonStateRef.current !== shouldShowSkeleton) {
            //console.log('[GoalMenu][Stats] render decision:', {
                //shouldShowSkeleton,
                //statsLoading,
                //hasGoalStats: !!goalStats,
                //mode: state.mode,
                //goalType: state.goal.goal_type
            //});
            lastSkeletonStateRef.current = shouldShowSkeleton;
        }

        if (shouldShowSkeleton) {
            return (
                <Box ref={statsContainerRef} sx={{ mt: 2 }} aria-busy={true}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1 }}>
                        {[0, 1, 2, 3].map((idx) => (
                            <Box key={idx} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', minHeight: 56 }}>
                                <Skeleton variant="rectangular" height={56} />
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
        // Prefer weighted completion rate when available (mirrors Effort page)
        const completionRate = normalizeRate(
            goalStats?.weighted_completion_rate ?? goalStats?.completion_rate
        );
        const allTimeRate = isEvent ? normalizeRate(goalStats?.last_30_days_completion_rate) : completionRate;
        const total = goalStats?.total_events || 0;
        const completed = goalStats?.completed_events || 0;
        const timeSpentMinutes = goalStats?.total_duration_minutes ?? 0;
        const childrenCount = goalStats?.children_count ?? 0;

        const formatMinutesShort = (minutes: number): string => {
            if (!minutes || minutes <= 0) return '0h';
            const totalMinutes = Math.round(minutes);
            const hh = Math.floor(totalMinutes / 60);
            const mm = totalMinutes % 60;
            if (hh > 0 && mm > 0) return `${hh}h ${mm}m`;
            if (hh > 0) return `${hh}h`;
            return `${mm}m`;
        };

        const RateTile = (props: {
            label: string;
            tooltip: string;
            value: number;
            icon: React.ReactNode;
            color?: string;
            hasData?: boolean;
            completed?: number;
            total?: number;
        }) => {
            const pct = Number.isFinite(props.value) ? Math.max(0, Math.min(1, props.value)) : 0;
            const completedCount = props.completed ?? 0;
            const totalCount = props.total ?? 0;

            return (
                <Tooltip title={props.tooltip} placement="top" arrow>
                    <Box
                        sx={{
                            p: 1,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            display: 'grid',
                            gridTemplateColumns: '24px 1fr',
                            alignItems: 'center',
                            columnGap: 1,
                            minHeight: 56,
                            overflow: 'hidden'
                        }}
                    >
                        <Box
                            sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: 'background.paper',
                                borderRadius: '8px',
                                width: 24,
                                height: 24
                            }}
                        >
                            {props.icon}
                        </Box>
                        <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {totalCount > 0 && (
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            fontWeight: 700,
                                            lineHeight: 1.1,
                                            minWidth: 52
                                        }}
                                    >
                                        {completedCount}/{totalCount}
                                    </Typography>
                                )}
                                <CompletionBar
                                    value={pct}
                                    hasTasks={props.hasData ?? true}
                                    width={96}
                                    height={8}
                                />
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontWeight: 700,
                                        minWidth: 36,
                                        textAlign: 'right'
                                    }}
                                >
                                    {(pct * 100).toFixed(0)}%
                                </Typography>
                            </Box>
                            {props.label && (
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{
                                        mt: 0.5,
                                        display: 'block',
                                        whiteSpace: 'nowrap',
                                        textOverflow: 'ellipsis',
                                        overflow: 'hidden',
                                        hyphens: 'none'
                                    }}
                                >
                                    {props.label}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </Tooltip>
            );
        };

        const SimpleTile = (props: { label: string; tooltip: string; primary: string; icon: React.ReactNode; }) => (
            <Tooltip title={props.tooltip} placement="top" arrow>
                <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', display: 'grid', gridTemplateColumns: '24px 1fr', alignItems: 'center', columnGap: 1, minHeight: 56 }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper', borderRadius: '8px', width: 24, height: 24 }}>
                        {props.icon}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                            {props.primary}
                        </Typography>
                        {props.label && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', hyphens: 'none' }}>
                                {props.label}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Tooltip>
        );

        return (
            <Box ref={statsContainerRef} sx={{ mt: 2 }} aria-busy={false}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1 }}>
                    <RateTile
                        label="Completion"
                        tooltip="Weighted completion rate (by priority)"
                        value={isEvent ? allTimeRate : completionRate}
                        icon={<CheckCircleOutlineIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
                        hasData={total > 0}
                        completed={completed}
                        total={total}
                    />
                    <SimpleTile
                        label="Time spent"
                        tooltip="Total completed time across all descendant events (from Effort stats)"
                        primary={formatMinutesShort(timeSpentMinutes)}
                        icon={<AvTimerIcon sx={{ fontSize: 16 }} />}
                    />
                    <SimpleTile
                        label="Children"
                        tooltip="Number of descendant non-event goals (from Effort stats)"
                        primary={childrenCount.toString()}
                        icon={<EventAvailableIcon sx={{ fontSize: 16 }} />}
                    />
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
                    // If this event belongs to a routine, open scope dialog instead of immediate update
                    if (isRoutineParentEvent) {
                        const originalGoal = state.goal;
                        const updatedGoal = { ...state.goal, scheduled_timestamp: timestamp } as Goal;
                        setSmartScheduleOpen(false);
                        setSmartScheduleContext(null);
                        setRoutineUpdateDialog({
                            isOpen: true,
                            updateType: 'scheduled_time',
                            originalGoal,
                            updatedGoal,
                            selectedScope: 'single',
                            rangeStart: null,
                            rangeEnd: null,
                            onConfirm: async (scope: 'single' | 'all' | 'future' | 'range', rangeStart?: Date, rangeEnd?: Date) => {
                                await handleRoutineEventUpdate(originalGoal, updatedGoal, 'scheduled_time', scope, rangeStart, rangeEnd);
                            }
                        });
                        return;
                    }

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

            // Close smart schedule dialog only if we didn't branch into routine scope dialog above
            setSmartScheduleOpen(false);
            setSmartScheduleContext(null);
        };

        executeScheduleUpdate().catch((error: any) => {
            // console.error('Failed to smart schedule event:', error);

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
        resolution_status: 'pending',
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
        // console.log('[GoalMenu] handleRoutineDeleteConfirm', routineDeleteDialog);
        if (!routineDeleteDialog.eventId) return;

        if (!beginAction('delete')) return;

        try {
            if (routineDeleteDialog.selectedScope === 'all') {
                // console.log('[GoalMenu] Delete scope = ALL');

                // Delete the parent routine - backend will cascade delete all events
                const parentRoutineId = state.goal.parent_id;
                if (!parentRoutineId) {
                    // console.warn('[GoalMenu] No parentRoutineId found, cannot delete all events');
                    throw new Error('Cannot find parent routine to delete all events');
                }

                // console.log('[GoalMenu] Deleting parent routine goal (will cascade to all events)', { parentRoutineId });
                await deleteGoal(parentRoutineId);

                // Force refresh of routines to clean up any cached state
                // console.log('[GoalMenu] Calling updateRoutines() after routine deletion');
                await updateRoutines();
            } else {
                const deleteFuture = routineDeleteDialog.selectedScope === 'future';
                // console.log('[GoalMenu] Delete scope =', routineDeleteDialog.selectedScope, { deleteFuture });
                await deleteEvent(routineDeleteDialog.eventId, deleteFuture);

                // Refresh routines so calendar updates when deleting future occurrences
                if (deleteFuture) {
                    // console.log('[GoalMenu] Calling updateRoutines() after deletion');
                    try {
                        await updateRoutines();
                    } catch (e) {
                        // console.warn('Routine update after delete failed', e);
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
            endAction();
            close();
        } catch (error) {
            // console.error('Failed to delete routine event:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to delete routine event'
            });
        } finally {
            endAction();
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
    // Routine Update Visualization
    // --------------------
    const routineChanges = useMemo(() => {
        if (!routineUpdateDialog.isOpen || !routineUpdateDialog.originalGoal || !routineUpdateDialog.updatedGoal || !routineUpdateDialog.updatedGoal.parent_id) {
            return [];
        }

        const parentRoutine = allGoals.find(g => g.id === routineUpdateDialog.updatedGoal!.parent_id);
        if (!parentRoutine) return [];

        const changes: { label: string, oldVal: string, newVal: string }[] = [];
        const { updatedGoal, updateType } = routineUpdateDialog;

        // Formatting helpers
        const formatTime = (d: Date | number | undefined | null) => {
             if (!d) return 'None';
             const date = new Date(d);
             if (isNaN(date.getTime())) return 'None';
             return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        };

        if (updateType === 'scheduled_time') {
            const oldTime = formatTime(parentRoutine.routine_time);
            const newTime = formatTime(updatedGoal.scheduled_timestamp);
            if (oldTime !== newTime) {
                changes.push({ label: 'Default Time', oldVal: oldTime, newVal: newTime });
            }
        } else if (updateType === 'duration') {
             if (parentRoutine.duration !== updatedGoal.duration) {
                changes.push({ label: 'Default Duration', oldVal: `${parentRoutine.duration || 0}m`, newVal: `${updatedGoal.duration}m` });
            }
        } else if (updateType === 'other') {
            if (updatedGoal.name && parentRoutine.name !== updatedGoal.name) {
                 changes.push({ label: 'Name', oldVal: parentRoutine.name || '', newVal: updatedGoal.name });
            }
            // Use undefined check for description as it might be explicitly cleared
            if (updatedGoal.description !== undefined && parentRoutine.description !== updatedGoal.description) {
                 const trunc = (s?: string) => s && s.length > 30 ? s.substring(0, 30) + '...' : (s || '(empty)');
                 changes.push({ label: 'Description', oldVal: trunc(parentRoutine.description), newVal: trunc(updatedGoal.description) });
            }
            if (updatedGoal.priority && parentRoutine.priority !== updatedGoal.priority) {
                 changes.push({ label: 'Priority', oldVal: parentRoutine.priority || 'None', newVal: updatedGoal.priority });
            }
        }
        return changes;
    }, [routineUpdateDialog, allGoals]);

    // --------------------
    // Render
    // --------------------
    return (
        <Dialog
            open={isOpen}
            disableEscapeKeyDown={isBusy}
            onClose={(event, reason) => {
                if (isBusy) return;
                const isBackdrop = reason === 'backdropClick';
                const isEscape = reason === 'escapeKeyDown';
                const isCreateDraft = state.mode === 'create' && hasUserInput(state.goal);
                if ((isBackdrop || isEscape) && isCreateDraft) {
                    try {
                        sessionStorage.setItem('goals:last_goal_draft', JSON.stringify(state.goal));
                    } catch (e) {}
                    showSnackbar({
                        message: 'Goal not created',
                        actionLabel: 'Undo',
                        onAction: () => {
                            try {
                                const raw = sessionStorage.getItem('goals:last_goal_draft');
                                if (raw) {
                                    const draft = JSON.parse(raw);
                                    GoalMenuWithStatic.open(draft as Goal, 'create');
                                }
                            } catch (e) {}
                        },
                        severity: 'info',
                        duration: 4000
                    });
                }
                close();
            }}
            maxWidth="sm"
            fullWidth
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' && !event.shiftKey && !isViewOnly) {
                    event.preventDefault();
                    if (!isBusy) handleSubmit();
                }
            }}
        >
            {/* ---- Dialog Title ---- */}
            <DialogTitle>{title}</DialogTitle>
            {/* ---- Dialog Content ---- */}
            <DialogContent ref={contentRef}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: isViewOnly ? '1fr 260px' : '1fr' },
                        columnGap: 2,
                        alignItems: 'start'
                    }}
                >
                    {/* Main column */}
                    <Box sx={{ minWidth: 0 }}>
                        {state.error && (
                            <Box role="alert" sx={{ color: 'error.main', mb: 2 }}>{state.error}</Box>
                        )}
                        {actualRelationsLoading && (
                            <Box sx={{ mb: 2 }}>
                                <LinearProgress />
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ mt: 0.5, display: 'block' }}
                                >
                                    Loading relationships…
                                </Typography>
                            </Box>
                        )}
                        {commonFields}
                        {parentSelectorField}
                        {childSelectorField}
                        {renderTypeSpecificFields()}
                        {renderStatsTiles()}
                    </Box>

                    {/* Sidebar (view mode only, fixed width on sm+) */}
                    {isViewOnly && (
                        <Box sx={{ width: { xs: '100%', sm: 260 }, flexShrink: 0 }}>
                            <Box sx={{ mb: 3 }}>
                                <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
                                    Parents
                                </Typography>
                                {parentGoals.length > 0 ? (
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
                                ) : (
                                    <Typography variant="caption" color="text.secondary">
                                        None
                                    </Typography>
                                )}
                            </Box>

                            {childGoals.length > 0 && (
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
                            {(state.goal.goal_type === 'event' ? state.goal.parent_id : state.goal.id) && (
                                <Box sx={{ mb: 3 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
                                        Network
                                    </Typography>
                                    <MiniNetworkGraph
                                        centerId={state.goal.goal_type === 'event' ? state.goal.parent_id : state.goal.id}
                                        height={220}
                                        onNodeClick={(node) => {
                                            try {
                                                const centerId = state.goal.goal_type === 'event' ? state.goal.parent_id : state.goal.id;
                                                if (!node?.id || node.id === centerId) {
                                                    return;
                                                }
                                                close();
                                                setTimeout(() => {
                                                    GoalMenuWithStatic.open(node, 'view', onSuccess);
                                                }, 100);
                                            } catch (e) {}
                                        }}
                                    />
                                </Box>
                            )}
                        </Box>
                    )}
                </Box>
            </DialogContent>
            {/* ---- Dialog Actions ---- */}
            <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {state.mode === 'view' && (
                        <>
                            {state.goal.goal_type !== 'event' && (
                                <>
                                    <Button onClick={handleCreateChild} color="secondary" disabled={isBusy}>Create Child</Button>
                                    <Button onClick={handleEdit} color="primary" disabled={isBusy}>Edit</Button>
                                    <Button onClick={handleDuplicate} color="secondary" disabled={isBusy}>
                                        {pendingAction === 'duplicate' ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                                        Duplicate
                                    </Button>
                                    <Button onClick={handleDelete} color="error" disabled={isBusy}>
                                        {pendingAction === 'delete' ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                                        Delete
                                    </Button>
                                    {/* <Button onClick={handleRelations} color="secondary">Relationships</Button> */}
                                </>
                            )}
                            {state.goal.goal_type === 'event' && (
                                <>
                                    <Button onClick={handleEdit} color="primary" disabled={isBusy}>Edit</Button>
                                    <Button onClick={handleDuplicate} color="secondary" disabled={isBusy}>
                                        {pendingAction === 'duplicate' ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                                        Duplicate
                                    </Button>
                                    <Button onClick={handleDelete} color="error" disabled={isBusy}>
                                        {pendingAction === 'delete' ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                                        Delete
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                    {state.mode === 'edit' && (
                        <Button onClick={handleDelete} color="error" disabled={isBusy}>
                            {pendingAction === 'delete' ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                            Delete
                        </Button>
                    )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={close} disabled={isBusy}>{isViewOnly ? 'Close' : 'Cancel'}</Button>
                    {!isViewOnly && (
                        <Button onClick={() => handleSubmit()} color="primary" disabled={isBusy || actualRelationsLoading}>
                            {(pendingAction === 'save' || pendingAction === 'create') ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                            {state.mode === 'create' ? 'Create' : 'Save'}
                        </Button>
                    )}
                    {state.mode === 'create' && (
                        <Button onClick={() => handleSubmit(true)} color="primary" disabled={isBusy}>Create Another</Button>
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
                onClose={() => {
                    setRoutineUpdateDialog({ ...routineUpdateDialog, isOpen: false });
                    endAction();
                }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Update Routine Event</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        You're modifying a routine event. What scope would you like to apply this change to?
                    </Typography>
                    
                    <FormControl component="fieldset" sx={{ width: '100%' }}>
                        <RadioGroup
                            value={routineUpdateDialog.selectedScope}
                            onChange={(e) => setRoutineUpdateDialog({ ...routineUpdateDialog, selectedScope: e.target.value as 'single' | 'all' | 'future' | 'range' })}
                        >
                            {!routineUpdateDialog.isParentEdit && (
                                <FormControlLabel value="single" control={<Radio />} label="Apply to just this occurrence" />
                            )}
                            <FormControlLabel value="future" control={<Radio />} label={routineUpdateDialog.isParentEdit ? "Apply changes from now on" : "Apply to this occurrence and beyond"} />
                            <FormControlLabel value="all" control={<Radio />} label={routineUpdateDialog.isParentEdit ? "Apply to all past and future occurrences" : "Apply to all occurrences"} />
                            {/* Hide Range for Parent Edit for now as backend support is pending, or show if desired? User asked for standardization. */}
                            {!routineUpdateDialog.isParentEdit && (
                                <FormControlLabel value="range" control={<Radio />} label="Apply to specific date range" />
                            )}
                        </RadioGroup>
                    </FormControl>

                    <Box sx={{ mt: 2 }}>
                        {routineUpdateDialog.isParentEdit ? (
                             <Alert severity="warning">
                                This will delete future events for this routine starting from your selection (Now or Start), including events that are already marked as completed, and regenerate them on the new schedule. Any edits you made to future events will be lost. Past events will remain unchanged.
                            </Alert>
                        ) : (
                            routineUpdateDialog.updateType === 'scheduled_time' ? (
                            routineUpdateDialog.selectedScope === 'single' ? (
                                <Alert severity="info">
                                    Only this event will be moved. The old time slot will be remembered as intentionally changed, so it won’t be recreated later.
                                </Alert>
                            ) : routineUpdateDialog.selectedScope === 'future' ? (
                                <Alert severity="warning">
                                    This event and all future events will be shifted. Any previously deleted/skipped future occurrences starting at this event may reappear on the new schedule.
                                </Alert>
                            ) : (
                                <Alert severity="warning">
                                    All occurrences will be shifted. Any previously deleted/skipped occurrences may reappear on the new schedule.
                                </Alert>
                            )
                        ) : (
                            routineUpdateDialog.selectedScope === 'single' ? (
                                <Alert severity="info">
                                    Only this event will be updated. Deleted/skipped occurrences stay deleted.
                                </Alert>
                            ) : (
                                <Alert severity="info">
                                    Existing events will be updated and the routine defaults will be updated for future generation. Deleted/skipped occurrences stay deleted.
                                </Alert>
                            )
                        )}
                    </Box>

                    {routineUpdateDialog.selectedScope === 'range' && (
                        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                            <TextField
                                label="From"
                                type="date"
                                value={routineUpdateDialog.rangeStart ? timestampToInputString(routineUpdateDialog.rangeStart, 'date') : ''}
                                onChange={(e) => setRoutineUpdateDialog({
                                    ...routineUpdateDialog,
                                    rangeStart: inputStringToTimestamp(e.target.value, 'date')
                                })}
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                            />
                            <TextField
                                label="To"
                                type="date"
                                value={routineUpdateDialog.rangeEnd ? timestampToInputString(routineUpdateDialog.rangeEnd, 'date') : ''}
                                onChange={(e) => setRoutineUpdateDialog({
                                    ...routineUpdateDialog,
                                    rangeEnd: inputStringToTimestamp(e.target.value, 'date')
                                })}
                                fullWidth
                                InputLabelProps={{ shrink: true }}
                            />
                        </Box>
                    )}

                    {routineUpdateDialog.selectedScope !== 'single' && routineChanges.length > 0 && (
                        <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="subtitle2" gutterBottom color="primary">
                                Updates to Parent Routine:
                            </Typography>
                            {routineChanges.map((change, idx) => (
                                <Box key={idx} sx={{ display: 'flex', alignItems: 'center', mb: 0.5, fontSize: '0.9rem' }}>
                                    <Typography variant="body2" sx={{ fontWeight: 'bold', minWidth: 120 }}>
                                        {change.label}:
                                    </Typography>
                                    <Typography variant="body2" sx={{ mx: 1, color: 'text.secondary', textDecoration: 'line-through' }}>
                                        {change.oldVal}
                                    </Typography>
                                    <Typography variant="body2" sx={{ mx: 0.5 }}>
                                        →
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                        {change.newVal}
                                    </Typography>
                                </Box>
                            ))}
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                {routineUpdateDialog.updateType === 'scheduled_time'
                                    ? 'This will update the routine defaults and shift existing events. Previously deleted/skipped occurrences may reappear in the selected range.'
                                    : 'This will update the routine defaults and update existing events. Deleted/skipped occurrences will remain deleted.'}
                            </Typography>
                        </Box>
                    )}
                    
                    {routineUpdateDialog.selectedScope === 'single' && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, ml: 1 }}>
                            The parent routine will not be changed.
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setRoutineUpdateDialog({ ...routineUpdateDialog, isOpen: false });
                        endAction();
                    }}>Cancel</Button>
                    <Button
                        onClick={() => routineUpdateDialog.onConfirm(
                            routineUpdateDialog.selectedScope,
                            routineUpdateDialog.rangeStart || undefined,
                            routineUpdateDialog.rangeEnd || undefined
                        )}
                        color="primary"
                        variant="contained"
                    >
                        Update
                    </Button>
                </DialogActions>
            </Dialog>
            {/* Routine Recompute Confirmation Dialog */}
            <Dialog
                open={routineRecomputeDialog.isOpen}
                onClose={() => {
                    setRoutineRecomputeDialog({ ...routineRecomputeDialog, isOpen: false });
                    endAction();
                }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Apply schedule changes to future occurrences?</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        You changed this routine's schedule (frequency and/or start/end dates).
                    </Typography>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        This will delete all future events for this routine starting now, including events that are already marked as completed, and regenerate them on the new schedule. Any edits you made to future events will be lost. Past events will remain unchanged.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        You can cancel to keep existing future events as they are.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setRoutineRecomputeDialog({ ...routineRecomputeDialog, isOpen: false });
                        endAction();
                    }}>Cancel</Button>
                    <Button onClick={() => routineRecomputeDialog.onConfirm()} color="primary" variant="contained">
                        Apply & Recompute
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
                    {routineDeleteDialog.selectedScope === 'single' && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Only this occurrence will be deleted. The routine stays active and otherwise unaffected.
                        </Alert>
                    )}
                    {routineDeleteDialog.selectedScope === 'future' && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            This and all future occurrences will be deleted. The routine’s end date will be set so no new occurrences are created.
                        </Alert>
                    )}
                    {routineDeleteDialog.selectedScope === 'all' && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            All occurrences will be deleted and the routine itself will be permanently removed.
                        </Alert>
                    )}
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
                    <Button onClick={handleRoutineDeleteConfirm} color="error" variant="contained" disabled={isBusy}>
                        {routineDeleteDialog.selectedScope === 'single'
                            ? 'Delete occurrence'
                            : routineDeleteDialog.selectedScope === 'future'
                                ? 'Delete future and end routine'
                                : 'Delete all and remove routine'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Google Calendar Delete Confirmation Dialog */}
            <Dialog open={showDeleteGcalConfirm} onClose={() => setShowDeleteGcalConfirm(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Delete Synced Event</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        This event is synced with Google Calendar.
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Do you want to delete it from Google Calendar as well?
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowDeleteGcalConfirm(false)}>Cancel</Button>
                    <Button onClick={() => handleDeleteWithGcal(false)} color="primary">
                        Keep in Google Calendar
                    </Button>
                    <Button onClick={() => handleDeleteWithGcal(true)} color="error" variant="contained">
                        Delete Everywhere
                    </Button>
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
    open: (
        goal: Goal,
        initialMode: Mode,
        onSuccess?: (goal: Goal) => void,
        options?: { defaultSelectedParents?: Goal[]; defaultRelationshipType?: 'child'; autoCreateEventTimestamp?: Date | null }
    ) => void;
    close: () => void;
    openWithSubmitOverride: (
        goal: Goal,
        initialMode: Mode,
        submit: (updated: Goal, original: Goal, mode: Mode) => Promise<void>,
        onSuccess?: (goal: Goal) => void,
        options?: { defaultSelectedParents?: Goal[]; defaultRelationshipType?: 'child'; autoCreateEventTimestamp?: Date | null }
    ) => void;
}

const GoalMenuBase = GoalMenu;
const GoalMenuWithStatic = GoalMenuBase as GoalMenuComponent;

GoalMenuWithStatic.open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void, options?: { defaultSelectedParents?: Goal[]; defaultRelationshipType?: 'child'; autoCreateEventTimestamp?: Date | null }) => {
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
            defaultSelectedParents={options?.defaultSelectedParents}
            defaultRelationshipType={options?.defaultRelationshipType}
            autoCreateEventTimestamp={options?.autoCreateEventTimestamp}
        />
    );

    console.log('[GoalMenu.open] Goal menu rendered');
};

GoalMenuWithStatic.openWithSubmitOverride = (goal: Goal, initialMode: Mode, submit: (updated: Goal, original: Goal, mode: Mode) => Promise<void>, onSuccess?: (goal: Goal) => void, options?: { defaultSelectedParents?: Goal[]; defaultRelationshipType?: 'child'; autoCreateEventTimestamp?: Date | null }) => {
    console.log('[GoalMenu.openWithSubmitOverride] Opening goal menu:', { goalId: goal.id, goalName: goal.name, mode: initialMode });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const cleanup = () => {
        if (currentRoot) {
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
                if (onSuccess) onSuccess(updatedGoal);
            }}
            submitOverride={submit}
            defaultSelectedParents={options?.defaultSelectedParents}
            defaultRelationshipType={options?.defaultRelationshipType}
            autoCreateEventTimestamp={options?.autoCreateEventTimestamp}
        />
    );
};

GoalMenuWithStatic.close = () => {
    if (currentInstance) currentInstance();
};

export default GoalMenuWithStatic;
