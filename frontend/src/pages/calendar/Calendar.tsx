import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Goal, CalendarEvent, CalendarTask } from '../../types/goals';
import { updateGoal, createEvent, updateRoutineEvent, expandTaskDateRange, TaskDateValidationError, updateRoutineEventProperties, syncFromGoogleCalendar, syncToGoogleCalendar, syncBidirectionalGoogleCalendar, GCalSyncResult, getGoogleCalendars, CalendarListEntry } from '../../shared/utils/api';
import { getGoalStyle } from '../../shared/styles/colors';
import { useGoalMenu } from '../../shared/contexts/GoalMenuContext';
import { fetchCalendarData } from './calendarData';
import TaskList from './TaskList';
import { useHistoryState } from '../../shared/hooks/useHistoryState';
import './Calendar.css';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  Select,
  SelectChangeEvent,
  MenuItem,
  InputLabel,
  CircularProgress
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import { useSearchParams } from 'react-router-dom';

interface CalendarState {
  events: CalendarEvent[];
  tasks: CalendarTask[];
  isLoading: boolean;
  dateRange: {
    start: Date;
    end: Date;
  };
}

interface RoutineRescheduleDialogState {
  isOpen: boolean;
  eventId: number | null;
  eventName: string;
  newTimestamp: Date | null;
  originalTimestamp: Date | null;
  eventInfo: any; // FullCalendar event info for reverting
}

interface RoutineResizeDialogState {
  isOpen: boolean;
  eventId: number | null;
  eventName: string;
  newDuration: number | null;
  eventInfo: any; // FullCalendar event info for reverting
}

// Task Date Range Warning Dialog Component
interface TaskDateRangeWarningDialogProps {
  open: boolean;
  onClose: () => void;
  onRevert: () => void;
  onExpand: () => void;
  validationError: TaskDateValidationError | null;
  eventName: string;
}

const TaskDateRangeWarningDialog: React.FC<TaskDateRangeWarningDialogProps> = ({
  open,
  onClose,
  onRevert,
  onExpand,
  validationError,
  eventName
}) => {
  if (!validationError) return null;

  const { violation } = validationError;
  const eventDate = new Date(violation.event_timestamp);
  const taskStartDate = violation.task_start ? new Date(violation.task_start) : null;
  const taskEndDate = violation.task_end ? new Date(violation.task_end) : null;
  const suggestedStartDate = violation.suggested_task_start ? new Date(violation.suggested_task_start) : null;
  const suggestedEndDate = violation.suggested_task_end ? new Date(violation.suggested_task_end) : null;

  const formatDate = (date: Date | null) => {
    return date ? date.toLocaleDateString() : 'Not set';
  };

  const getExpandMessage = () => {
    if (violation.violation_type === 'before_start') {
      return `This will move the task start date from ${formatDate(taskStartDate)} to ${formatDate(suggestedStartDate)}.`;
    } else {
      return `This will move the task end date from ${formatDate(taskEndDate)} to ${formatDate(suggestedEndDate)}.`;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: 'warning.main' }}>
        ⚠️ Event Outside Task Date Range
      </DialogTitle>
      <DialogContent>
        <Typography variant="body1" sx={{ mb: 2 }}>
          The event "{eventName}" is scheduled for <strong>{eventDate.toLocaleDateString()}</strong>,
          which is {violation.violation_type === 'before_start' ? 'before' : 'after'} the task's date range.
        </Typography>

        <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Current Task Date Range:</Typography>
          <Typography variant="body2">
            Start: {formatDate(taskStartDate)}
            <br />
            End: {formatDate(taskEndDate)}
          </Typography>
        </Box>

        <Typography variant="body2" sx={{ mb: 2 }}>
          What would you like to do?
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box>
            <strong>Option 1: Cancel event creation</strong>
            <br />
            <Typography variant="body2" color="text.secondary">
              Don't create this event and keep the task dates as they are.
            </Typography>
          </Box>
          <Box>
            <strong>Option 2: Expand task date range</strong>
            <br />
            <Typography variant="body2" color="text.secondary">
              {getExpandMessage()}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onRevert} color="secondary">
          Cancel Event
        </Button>
        <Button onClick={onExpand} color="primary" variant="contained">
          Expand Task Dates
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const Calendar: React.FC = () => {
  const { openGoalMenu } = useGoalMenu();
  // -----------------------------
  // URL Query Params
  // -----------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const availableViews = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'] as const;
  const viewParam = searchParams.get('view') || '';
  const initialCalendarView = (availableViews as readonly string[]).includes(viewParam)
    ? (viewParam as string)
    : 'dayGridMonth';
  // -----------------------------
  // State and Refs
  // -----------------------------
  const [state, setState] = useHistoryState<CalendarState>(
    {
      events: [],
      tasks: [],
      isLoading: false,
      dateRange: {
        start: new Date(),
        end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      }
    },
    {
      hotkeyScope: 'calendar'
    }
  );

  const [error, setError] = useState<string | null>(null);
  const [dataLoadAttempts, setDataLoadAttempts] = useState(0);
  const [routineRescheduleDialog, setRoutineRescheduleDialog] = useState<RoutineRescheduleDialogState>({
    isOpen: false,
    eventId: null,
    eventName: '',
    newTimestamp: null,
    originalTimestamp: null,
    eventInfo: null
  });
  const [selectedUpdateScope, setSelectedUpdateScope] = useState<'single' | 'all' | 'future'>('single');
  const [routineResizeDialog, setRoutineResizeDialog] = useState<RoutineResizeDialogState>({
    isOpen: false,
    eventId: null,
    eventName: '',
    newDuration: null,
    eventInfo: null
  });
  const [selectedResizeScope, setSelectedResizeScope] = useState<'single' | 'all' | 'future'>('single');
  const calendarRef = useRef<FullCalendar | null>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const debouncingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Task date range warning dialog state
  const [taskDateWarningDialog, setTaskDateWarningDialog] = useState<{
    isOpen: boolean;
    validationError: TaskDateValidationError | null;
    eventName: string;
    onRetry: () => void;
    originalAction: () => Promise<void>;
    eventInfo: any; // For reverting the FullCalendar drag operation
  }>({
    isOpen: false,
    validationError: null,
    eventName: '',
    onRetry: () => { },
    originalAction: async () => { },
    eventInfo: null
  });

  // Google Calendar sync state
  const [gcalSyncDialog, setGcalSyncDialog] = useState<{
    isOpen: boolean;
    isLoading: boolean;
    lastResult: GCalSyncResult | null;
    calendarId: string;
    syncDirection: 'bidirectional' | 'to_gcal' | 'from_gcal';
    calendars: CalendarListEntry[];
    loadingCalendars: boolean;
  }>({
    isOpen: false,
    isLoading: false,
    lastResult: null,
    calendarId: 'primary',
    syncDirection: 'bidirectional',
    calendars: [],
    loadingCalendars: false
  });

  // Debugging mode toggles global logs, etc.
  const [debugMode] = useState(false);

  // -----------------------------
  // Data Loading
  // -----------------------------
  const loadCalendarData = useCallback(async (dateRange = state.dateRange) => {
    if (state.isLoading) return;

    try {
      // Set loading state
      setState({
        ...state,
        isLoading: true
      });

      const data = await fetchCalendarData(dateRange);

      // Clear any data-loading timeouts
      if (dataLoadingTimeoutRef.current) {
        clearTimeout(dataLoadingTimeoutRef.current);
      }

      // Update with new data
      setState({
        events: data.events,
        tasks: data.unscheduledTasks,
        isLoading: false,
        dateRange
      });
    } catch (error) {
      console.error('Error loading calendar data:', error);
      setState({
        ...state,
        isLoading: false
      });

      if (dataLoadAttempts < 2) {
        setTimeout(() => {
          setDataLoadAttempts((prev) => prev + 1);
          loadCalendarData(dateRange);
        }, 2000);
      } else {
        setError(
          'Failed to load calendar data after multiple attempts. Please try refreshing.'
        );
      }
    }
  }, [state, setState, dataLoadAttempts, setDataLoadAttempts, setError]);

  // -----------------------------
  // Effects
  // -----------------------------
  // Initial data load - with a flag to prevent duplicate calls
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;

    loadCalendarData().catch((err) => {
      console.error('Error loading calendar data:', err);
      setError('Failed to load calendar data. Please try refreshing the page.');
    });
  }, [loadCalendarData, setError]);

  // Set up drag-and-drop from the task list
  useEffect(() => {
    if (taskListRef.current) {
      const container = taskListRef.current;
      const draggable = new Draggable(container, {
        itemSelector: '.external-event',
        eventData: function (eventEl: HTMLElement) {
          const taskId = eventEl.getAttribute('data-task-id');
          const isAllDay = eventEl.getAttribute('data-all-day') === 'true';
          const task = state.tasks.find((t) => t.id === taskId);

          if (!task) {
            console.error(`Task with ID ${taskId} not found`);
            return {};
          }

          return {
            title: task.title,
            allDay: isAllDay,
            duration: task.goal.duration ? { minutes: task.goal.duration } : undefined,
            task
          };
        }
      });
      return () => draggable.destroy();
    }
  }, [state.tasks]);

  // Handle loading timeouts
  useEffect(() => {
    if (state.isLoading) {
      dataLoadingTimeoutRef.current = setTimeout(() => {
        if (state.isLoading) {
          console.warn('Calendar data loading timeout');
          setState({
            ...state,
            isLoading: false
          });

          if (dataLoadAttempts < 2) {
            setDataLoadAttempts((prev) => prev + 1);
            loadCalendarData();
          } else {
            setError(
              'Calendar data loading timed out. Please try refreshing the page.'
            );
          }
        }
      }, 20000);
    }
    return () => {
      if (dataLoadingTimeoutRef.current) {
        clearTimeout(dataLoadingTimeoutRef.current);
      }
    };
  }, [state, dataLoadAttempts, loadCalendarData, setState, setError]);

  // Optional debug: global click logging
  useEffect(() => {
    if (!debugMode) return;

    const handleGlobalClick = (e: MouseEvent) => {
      // Remove unused target assignment
    };

    document.addEventListener('click', handleGlobalClick);
    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [debugMode]);

  // Optional debug: global right-click logging
  useEffect(() => {
    if (!debugMode) return;

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      console.log('[DEBUG] Right-click on:', target.tagName, target.className);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [debugMode]);

  // -----------------------------
  // Handlers
  // -----------------------------
  const handleDatesSet = (dateInfo: any) => {
    // Update the "view" query param so refreshes keep the current view
    const currentViewType = dateInfo.view?.type;
    if (currentViewType && searchParams.get('view') !== currentViewType) {
      const params = new URLSearchParams(searchParams);
      params.set('view', currentViewType);
      // Defer URL update to a microtask to avoid flushSync during render
      const schedule = typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (cb: () => void) => Promise.resolve().then(cb);
      schedule(() => setSearchParams(params, { replace: true }));
    }

    // Skip if the calendar is already loading data
    if (state.isLoading) return;

    const start = dateInfo.start instanceof Date
      ? dateInfo.start
      : new Date(dateInfo.start);
    const end = dateInfo.end instanceof Date
      ? dateInfo.end
      : new Date(dateInfo.end);

    // Check if current date range covers this new date range
    const { start: currentStart, end: currentEnd } = state.dateRange;
    const isStartCovered = start >= new Date(currentStart.getTime() - 86400000);
    const isEndCovered = end <= new Date(currentEnd.getTime() + 86400000);

    // Only load new data if outside current range
    if (isStartCovered && isEndCovered) {
      return;
    }

    if (debouncingRef.current) {
      clearTimeout(debouncingRef.current);
    }

    // Store the new date range to prevent duplicate requests
    const newDateRange = { start, end };

    debouncingRef.current = setTimeout(() => {
      // First update the state with new date range
      setState({
        ...state,
        dateRange: newDateRange
      });

      debouncingRef.current = null;

      // Use a separate call with requestAnimationFrame to load data after state update
      requestAnimationFrame(() => {
        // Prevent duplicate calls by checking if we're already loading for this range
        if (!state.isLoading) {
          loadCalendarData(newDateRange);
        }
      });
    }, 300);
  };

  const handleDateClick = (arg: any) => {
    console.log('[Calendar] Date clicked:', arg);
    const clickedDate = arg.date instanceof Date ? arg.date : new Date(arg.date);
    console.log('[Calendar] Parsed date:', clickedDate);

    const newGoal: Goal = {
      ...({} as Goal),
      name: '',
      goal_type: 'task',
      description: '',
      scheduled_timestamp: clickedDate,
      routine_time: clickedDate,
      duration: 60
    };

    console.log('[Calendar] Opening goal menu with goal:', newGoal);
    openGoalMenu(newGoal, 'create', () => {
      console.log('[Calendar] Goal menu success callback called');
      loadCalendarData();
    }, { autoCreateEventTimestamp: clickedDate });
  };

  const handleEventClick = (info: any) => {
    const event = info.event.extendedProps?.goal;
    if (event) {
      openGoalMenu(event, 'view', () => {
        loadCalendarData();
      });
    }
  };

  const handleEventDidMount = (info: any) => {
    // Set tooltip/title without using React custom event content
    const title = info.event.title || '';
    const timeText = info.timeText || '';
    const tooltip = timeText ? `${timeText} — ${title}` : title;
    info.el.setAttribute('title', tooltip);

    info.el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const goal = info.event.extendedProps?.goal;
      if (goal) {
        openGoalMenu(goal, goal.goal_type === 'event' ? 'view' : 'edit', () => {
          loadCalendarData();
        });
      }
    });
  };

  const handleEventReceive = async (info: any) => {
    const executeEventCreation = async () => {
      const task = info.event.extendedProps?.task;
      if (!task) {
        console.error('Received event has no task data:', info);
        info.revert();
        return;
      }

      const goal = task.goal;

      // Handle duration based on whether it was dropped in all-day section
      let duration: number;
      if (info.event.allDay) {
        // Event was dropped in all-day section - set duration to 1440 minutes (24 hours)
        duration = 1440;
      } else {
        // Event was dropped in timed section - use task's duration or default to 60 minutes
        duration = goal.duration || 60;
      }

      // Create an event instead of updating the task
      await createEvent({
        parent_id: goal.id,
        parent_type: goal.goal_type,
        scheduled_timestamp: info.event.start,
        duration: duration,
        priority: goal.priority
      });

      info.revert(); // Revert the drag since we're creating a new event
      loadCalendarData();
    };

    try {
      await executeEventCreation();
    } catch (error) {
      console.error('Failed to create event:', error);

      // Check if it's a task date validation error
      if (isTaskDateValidationError(error)) {
        const validationError = extractValidationError(error);
        if (validationError) {
          const taskName = info.event.extendedProps?.task?.goal?.name || 'Unknown Task';
          showTaskDateWarning(validationError, `${taskName} Event`, executeEventCreation, info);
          return;
        }
      }

      // For other errors, show generic error and revert
      info.revert();
      setError('Failed to create event. Please try again.');
    }
  };

  const handleEventDrop = async (info: any) => {
    const executeEventMove = async () => {
      const existingEvent = state.events.find((e) => e.id === info.event.id);
      if (existingEvent?.goal && existingEvent.goal.goal_type === 'event') {
        // Check if this is a routine event
        if (existingEvent.goal.parent_type === 'routine') {
          // Show dialog for routine event rescheduling
          setRoutineRescheduleDialog({
            isOpen: true,
            eventId: existingEvent.goal.id!,
            eventName: existingEvent.goal.name,
            newTimestamp: info.event.start,
            originalTimestamp: (existingEvent.goal.scheduled_timestamp as Date | undefined) ?? existingEvent.start,
            eventInfo: info
          });
          return; // Don't proceed with immediate update
        }

        // For non-routine events, proceed with normal update
        const updates = { ...existingEvent.goal };
        updates.scheduled_timestamp = info.event.start;

        // Handle duration changes when moving between all-day and timed sections
        if (info.event.allDay) {
          // Event was dropped in all-day section - set duration to 1440 minutes (24 hours)
          updates.duration = 1440;
        } else if (existingEvent.goal.duration === 1440) {
          // Event was moved from all-day to timed section - restore reasonable duration
          // Use 60 minutes as default (same as GoalMenu does when unchecking "All Day")
          updates.duration = 60;
        }
        // If duration is not 1440 and not moving to all-day, keep existing duration

        await updateGoal(existingEvent.goal.id, updates);
        loadCalendarData();
      } else {
        // Non-event goals shouldn't be draggable in the new system
        info.revert();
      }
    };

    try {
      await executeEventMove();
    } catch (error) {
      console.error('Failed to move event:', error);

      // Check if it's a task date validation error
      if (isTaskDateValidationError(error)) {
        const validationError = extractValidationError(error);
        if (validationError) {
          const eventName = info.event.title || 'Event';
          showTaskDateWarning(validationError, eventName, executeEventMove, info);
          return;
        }
      }

      // For other errors, show generic error and revert
      info.revert();
      setError('Failed to move event. Please try again.');
    }
  };

  const handleRoutineRescheduleConfirm = async () => {
    try {
      if (!routineRescheduleDialog.eventId || !routineRescheduleDialog.newTimestamp) {
        return;
      }

      // -----------------------------
      // Fetch parent routine (if applicable)
      // -----------------------------
      const movedEvent = state.events.find((e) => e.goal?.id === routineRescheduleDialog.eventId!);
      const parentRoutine = movedEvent?.parent;

      // If we are changing more than a single occurrence and the routine has no
      // default time set, set it to the ORIGINAL time first so that the backend
      // update query matches all default-time events.
      if (
        selectedUpdateScope !== 'single' &&
        parentRoutine &&
        parentRoutine.goal_type === 'routine' &&
        !parentRoutine.routine_time &&
        routineRescheduleDialog.originalTimestamp
      ) {
        try {
          await updateGoal(parentRoutine.id!, {
            ...parentRoutine,
            routine_time: routineRescheduleDialog.originalTimestamp
          } as Goal);
        } catch (preUpdateErr) {
          console.warn('Failed to prime routine_time before bulk update', preUpdateErr);
        }
      }

      // Perform the bulk/single update of events
      await updateRoutineEvent(
        routineRescheduleDialog.eventId,
        routineRescheduleDialog.newTimestamp,
        selectedUpdateScope
      );

      // After events have been shifted, update the routine defaults so that new
      // events are generated at the NEW time and (for weekly routines) correct weekday.
      if (selectedUpdateScope !== 'single' && parentRoutine && parentRoutine.goal_type === 'routine') {
        const routineUpdates: Partial<Goal> = {
          routine_time: routineRescheduleDialog.newTimestamp
        };

        if (parentRoutine.frequency && parentRoutine.frequency.includes('W')) {
          const parts = parentRoutine.frequency.split(':');
          const intervalPart = parts[0];
          const newDay = routineRescheduleDialog.newTimestamp.getDay();
          routineUpdates.frequency = `${intervalPart}:${newDay}`;
        }

        try {
          await updateGoal(parentRoutine.id!, { ...parentRoutine, ...routineUpdates } as Goal);
        } catch (postUpdateErr) {
          console.warn('Failed to write routine default updates', postUpdateErr);
        }
      }

      // Note: No need to call updateRoutines() here since updateRoutineEvent already
      // updates all existing events. Calling updateRoutines() can cause race conditions
      // where the routine generator interferes with recently moved events.

      // Close dialog and reload data
      setRoutineRescheduleDialog({
        isOpen: false,
        eventId: null,
        eventName: '',
        newTimestamp: null,
        originalTimestamp: null,
        eventInfo: null
      });
      setSelectedUpdateScope('single');
      loadCalendarData();
    } catch (error) {
      console.error('Failed to update routine event:', error);
      setError('Failed to update routine event. Please try again.');
      // Revert the drag operation
      if (routineRescheduleDialog.eventInfo) {
        routineRescheduleDialog.eventInfo.revert();
      }
      handleRoutineRescheduleCancel();
    }
  };

  const handleRoutineRescheduleCancel = () => {
    // Revert the drag operation
    if (routineRescheduleDialog.eventInfo) {
      routineRescheduleDialog.eventInfo.revert();
    }

    setRoutineRescheduleDialog({
      isOpen: false,
      eventId: null,
      eventName: '',
      newTimestamp: null,
      originalTimestamp: null,
      eventInfo: null
    });
    setSelectedUpdateScope('single');
  };

  const handleRoutineResizeConfirm = async () => {
    try {
      if (!routineResizeDialog.eventId || !routineResizeDialog.newDuration) {
        return;
      }

      // Build routine-aware updates; include start if available (start can shift when resizing from start)
      const scheduledStart: Date | undefined = routineResizeDialog.eventInfo?.event?.start ?? undefined;
      await updateRoutineEventProperties(
        routineResizeDialog.eventId,
        {
          duration: routineResizeDialog.newDuration,
          ...(scheduledStart ? { scheduled_timestamp: scheduledStart } : {})
        },
        selectedResizeScope
      );

      // Close dialog and reload data
      setRoutineResizeDialog({
        isOpen: false,
        eventId: null,
        eventName: '',
        newDuration: null,
        eventInfo: null
      });
      setSelectedResizeScope('single');
      loadCalendarData();
    } catch (error) {
      console.error('Failed to resize routine event:', error);
      setError('Failed to resize routine event. Please try again.');
      // Revert the resize operation
      if (routineResizeDialog.eventInfo) {
        routineResizeDialog.eventInfo.revert();
      }
      handleRoutineResizeCancel();
    }
  };

  const handleRoutineResizeCancel = () => {
    // Revert the resize operation
    if (routineResizeDialog.eventInfo) {
      routineResizeDialog.eventInfo.revert();
    }

    setRoutineResizeDialog({
      isOpen: false,
      eventId: null,
      eventName: '',
      newDuration: null,
      eventInfo: null
    });
    setSelectedResizeScope('single');
  };

  const handleEventResize = async (info: any) => {
    const executeEventResize = async () => {
      const existingEvent = state.events.find((e) => e.id === info.event.id);
      if (existingEvent?.goal && existingEvent.goal.goal_type === 'event') {
        const start = info.event.start;
        const end = info.event.end;
        const durationInMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

        // Check if this is a routine event
        if (existingEvent.goal.parent_type === 'routine') {
          // Show dialog for routine event resizing
          setRoutineResizeDialog({
            isOpen: true,
            eventId: existingEvent.goal.id!,
            eventName: existingEvent.goal.name,
            newDuration: durationInMinutes,
            eventInfo: info
          });
          return; // Don't proceed with immediate update
        }

        // For non-routine events, proceed with normal update
        const updates = {
          ...existingEvent.goal,
          duration: durationInMinutes,
          scheduled_timestamp: start
        };

        await updateGoal(existingEvent.goal.id, updates);
        loadCalendarData();
      } else {
        info.revert();
      }
    };

    try {
      await executeEventResize();
    } catch (error) {
      console.error('Failed to resize event:', error);

      // Check if it's a task date validation error
      if (isTaskDateValidationError(error)) {
        const validationError = extractValidationError(error);
        if (validationError) {
          const eventName = info.event.title || 'Event';
          showTaskDateWarning(validationError, eventName, executeEventResize, info);
          return;
        }
      }

      // For other errors, show generic error and revert
      info.revert();
      setError('Failed to resize event. Please try again.');
    }
  };

  // -----------------------------
  // Helpers and UI
  // -----------------------------
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  };
  const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => {
    return aStart < bEnd && bStart < aEnd;
  };

  const gotoDate = (d: Date) => {
    try {
      calendarRef.current?.getApi().gotoDate(d);
    } catch {
      // ignore
    }
  };

  const overlapSuggestions = useMemo(() => {
    try {
      const today = startOfDay(new Date());
      // Group events by local day they touch, limited to today or later
      const byDay = new Map<string, CalendarEvent[]>();
      (state.events || []).forEach((evt) => {
        if (!evt?.start || !evt?.end) return;
        const start = new Date(evt.start);
        const end = new Date(evt.end);
        // Skip events that end before today
        if (end < today) return;
        // Treat end as exclusive boundary to avoid assigning to the next day when exactly at midnight
        const endForGrouping = new Date(end.getTime() - 1);
        let dayCursor = startOfDay(start);
        const lastDay = startOfDay(endForGrouping);
        while (dayCursor <= lastDay) {
          const key = dayCursor.toISOString().slice(0, 10);
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key)!.push(evt);
          dayCursor = addDays(dayCursor, 1);
        }
      });

      const suggestions = Array.from(byDay.entries()).map(([key, events]) => {
        // Detect overlaps within this day's set
        const list = events.slice().sort((a, b) => a.start.getTime() - b.start.getTime());
        let count = 0;
        const samples: Array<{ a: CalendarEvent; b: CalendarEvent }> = [];
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            if (b.start >= a.end) break;
            if (rangesOverlap(a.start, a.end, b.start, b.end)) {
              count++;
              if (samples.length < 3) samples.push({ a, b });
            }
          }
        }
        return {
          dateKey: key,
          date: new Date(`${key}T00:00:00`),
          count,
          samples
        };
      }).filter(s => s.count > 0)
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      return suggestions;
    } catch {
      return [];
    }
  }, [state.events]);

  const handleAddTask = () => {
    const tempGoal: Goal = {
      ...({} as Goal),
      name: '',
      goal_type: 'task',
      description: ''
    };

    openGoalMenu(tempGoal, 'create', () => {
      loadCalendarData();
    });
  };

  const handleTaskUpdate = (data: { events: CalendarEvent[]; tasks: CalendarTask[] }) => {
    setState({ ...state, events: data.events, tasks: data.tasks });
  };

  // Build events array using centralized styling from colors.ts
  const eventsWithColors = state.events.map((evt) => {
    const goal = evt.goal;
    const parent = evt.parent;

    // Use centralized styling that handles parent types and priority borders
    // Pass parent goal so priority borders fall back to parent if event has no priority
    const { backgroundColor, textColor, borderColor } = getGoalStyle(goal, parent);

    return {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      allDay: evt.allDay,
      backgroundColor,
      borderColor,
      textColor,
      color: backgroundColor, // Explicitly set color property for FullCalendar
      extendedProps: {
        ...evt,
        goal,
        parent
      }
    };
  });

  // Helper function to check if an error is a task date validation error
  const isTaskDateValidationError = (error: any): error is TaskDateValidationError => {
    try {
      if (error?.response?.data?.error_type === 'task_date_range_violation') {
        return true;
      }
      if (typeof error?.response?.data === 'string') {
        const parsed = JSON.parse(error.response.data);
        return parsed.error_type === 'task_date_range_violation';
      }
      return false;
    } catch {
      return false;
    }
  };

  // Helper function to extract validation error from axios error
  const extractValidationError = (error: any): TaskDateValidationError | null => {
    try {
      if (error?.response?.data?.error_type === 'task_date_range_violation') {
        return error.response.data;
      }
      if (typeof error?.response?.data === 'string') {
        return JSON.parse(error.response.data);
      }
      return null;
    } catch {
      return null;
    }
  };

  // Helper function to show task date warning dialog
  const showTaskDateWarning = (error: TaskDateValidationError, eventName: string, retryAction: () => Promise<void>, eventInfo: any) => {
    setTaskDateWarningDialog({
      isOpen: true,
      validationError: error,
      eventName,
      onRetry: () => { },
      originalAction: retryAction,
      eventInfo
    });
  };

  // Handle task date warning dialog actions
  const handleTaskDateWarningRevert = () => {
    // Revert the drag operation
    if (taskDateWarningDialog.eventInfo) {
      taskDateWarningDialog.eventInfo.revert();
    }

    setTaskDateWarningDialog({
      isOpen: false,
      validationError: null,
      eventName: '',
      onRetry: () => { },
      originalAction: async () => { },
      eventInfo: null
    });
  };

  const handleTaskDateWarningExpand = async () => {
    const { validationError, originalAction, eventInfo } = taskDateWarningDialog;
    if (!validationError) return;

    try {
      // Expand the task date range
      await expandTaskDateRange({
        task_id: validationError.violation.task_start !== null || validationError.violation.task_end !== null
          ? eventInfo?.event?.extendedProps?.task?.goal?.id
          : eventInfo?.event?.extendedProps?.task?.goal?.id,
        new_start_timestamp: validationError.violation.suggested_task_start
          ? new Date(validationError.violation.suggested_task_start)
          : undefined,
        new_end_timestamp: validationError.violation.suggested_task_end
          ? new Date(validationError.violation.suggested_task_end)
          : undefined,
      });

      // Close the warning dialog
      setTaskDateWarningDialog({
        isOpen: false,
        validationError: null,
        eventName: '',
        onRetry: () => { },
        originalAction: async () => { },
        eventInfo: null
      });

      // Retry the original action
      await originalAction();

    } catch (expandError) {
      console.error('Failed to expand task date range:', expandError);
      // Revert the drag operation
      if (eventInfo) {
        eventInfo.revert();
      }
      setError('Failed to expand task date range. Please try again.');
    }
  };

  // Helper to format time delta between two timestamps in a human-readable way
  const formatTimeDelta = (ms: number): string => {
    const sign = ms >= 0 ? '+' : '-';
    const absMs = Math.abs(ms);
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    if (absMs % oneDay === 0) {
      const days = Math.round(absMs / oneDay);
      return `${sign}${days} day${days !== 1 ? 's' : ''}`;
    }

    const hours = Math.round(absMs / oneHour);
    if (hours > 0) {
      return `${sign}${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    const minutes = Math.round(absMs / (60 * 1000));
    return `${sign}${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  

  // Google Calendar sync handlers
  const handleGoogleCalendarSync = async () => {
    setGcalSyncDialog({
      ...gcalSyncDialog,
      isOpen: true,
      loadingCalendars: true
    });

    try {
      const calendars = await getGoogleCalendars();
      setGcalSyncDialog(prev => ({
        ...prev,
        calendars,
        loadingCalendars: false,
        // Set primary calendar as default if available
        calendarId: calendars.find(c => c.primary)?.id || calendars[0]?.id || 'primary'
      }));
    } catch (error) {
      console.error('Failed to load calendars:', error);
      setGcalSyncDialog(prev => ({
        ...prev,
        loadingCalendars: false,
        calendars: []
      }));
    }
  };

  const handleGcalSyncConfirm = async () => {
    setGcalSyncDialog({
      ...gcalSyncDialog,
      isLoading: true
    });

    try {
      let result: GCalSyncResult;
      const request = {
        calendar_id: gcalSyncDialog.calendarId,
        sync_direction: gcalSyncDialog.syncDirection
      };

      switch (gcalSyncDialog.syncDirection) {
        case 'from_gcal':
          result = await syncFromGoogleCalendar(request);
          break;
        case 'to_gcal':
          result = await syncToGoogleCalendar(request);
          break;
        case 'bidirectional':
        default:
          result = await syncBidirectionalGoogleCalendar(request);
          break;
      }

      setGcalSyncDialog({
        ...gcalSyncDialog,
        isLoading: false,
        lastResult: result
      });

      // Reload calendar data to show synced events
      loadCalendarData();
    } catch (error) {
      console.error('Google Calendar sync failed:', error);
      setGcalSyncDialog({
        ...gcalSyncDialog,
        isLoading: false,
        lastResult: {
          imported_events: 0,
          exported_events: 0,
          updated_events: 0,
          errors: ['Sync failed: ' + (error instanceof Error ? error.message : 'Unknown error')]
        }
      });
    }
  };

  const handleGcalSyncClose = () => {
    setGcalSyncDialog({
      ...gcalSyncDialog,
      isOpen: false,
      lastResult: null
    });
  };

  // -----------------------------
  // Render
  // -----------------------------
  if (error) {
    return (
      <div className="calendar-error-container">
        <h2>Calendar Error</h2>
        <p>{error}</p>
        <button
          onClick={() => {
            setError(null);
            setDataLoadAttempts((prev) => prev + 1);
          }}
          className="retry-button"
        >
          Retry Loading
        </button>
      </div>
    );
  }

  return (
    <div className="calendar-container">
      <div className="calendar-content">
        <div className="calendar-sidebar">
          <TaskList
            ref={taskListRef}
            tasks={state.tasks}
            events={state.events}
            onAddTask={handleAddTask}
            onTaskUpdate={handleTaskUpdate}
            overlapSuggestions={overlapSuggestions}
            onNavigateDate={gotoDate}
          />
        </div>
        <div className="calendar-main" style={{ position: 'relative' }}>
          {state.isLoading && (
            <div className="calendar-loading-indicator">
              <div className="loading-spinner" />
              <span className="loading-text">Loading calendar data...</span>
            </div>
          )}
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={initialCalendarView}
            eventDisplay="block" //supposed to add full background color but doesnt ?
            eventMinHeight={12}
            displayEventTime={false}
            eventClassNames={() => 'event-compact'}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'gcalSync dayGridMonth,timeGridWeek,timeGridDay'
            }}
            customButtons={{
              gcalSync: {
                text: '📅 Sync',
                click: handleGoogleCalendarSync
              }
            }}
            height="100%"
            allDaySlot={true}
            editable={true}
            droppable={true}
            dropAccept=".external-event"
            events={eventsWithColors}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            eventReceive={handleEventReceive}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventDidMount={handleEventDidMount}
            eventResizableFromStart={true}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            nowIndicator={true}
            dayMaxEvents={true}
            timeZone="local"
            lazyFetching={true}
            datesSet={handleDatesSet}
            slotDuration="00:30:00"
            slotLabelInterval="01:00"
            scrollTime="08:00:00"
            snapDuration="00:05:00"
          />
        </div>
      </div>

      {/* Routine Reschedule Dialog */}
      <Dialog
        open={routineRescheduleDialog.isOpen}
        onClose={handleRoutineRescheduleCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Reschedule Routine Event
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            You're rescheduling the routine event "{routineRescheduleDialog.eventName}".
          </Typography>

          {routineRescheduleDialog.originalTimestamp && routineRescheduleDialog.newTimestamp && (
            <Box sx={{ mb: 2, p: 1, bgcolor: 'info.light', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Time shift:&nbsp;
                {formatTimeDelta(
                  routineRescheduleDialog.newTimestamp.getTime() -
                  routineRescheduleDialog.originalTimestamp.getTime()
                )}
              </Typography>
            </Box>
          )}

          <Typography variant="body1" sx={{ mb: 2 }}>
            What would you like to update?
          </Typography>

          <FormControl component="fieldset">
            <RadioGroup
              value={selectedUpdateScope}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setSelectedUpdateScope(event.target.value as 'single' | 'all' | 'future')
              }
            >
              <FormControlLabel
                value="single"
                control={<Radio />}
                label="Only this occurrence"
              />
              <FormControlLabel
                value="future"
                control={<Radio />}
                label="This and all future occurrences"
              />
              <FormControlLabel
                value="all"
                control={<Radio />}
                label="All occurrences of this routine"
              />
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRoutineRescheduleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleRoutineRescheduleConfirm}
            color="primary"
            variant="contained"
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>

      {/* Routine Resize Dialog */}
      <Dialog
        open={routineResizeDialog.isOpen}
        onClose={handleRoutineResizeCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Resize Routine Event
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            You're resizing the routine event "{routineResizeDialog.eventName}".
          </Typography>

          {routineResizeDialog.newDuration && (
            <Box sx={{ mb: 2, p: 1, bgcolor: 'info.light', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                New duration: {Math.floor(routineResizeDialog.newDuration / 60)}h {routineResizeDialog.newDuration % 60}m
              </Typography>
            </Box>
          )}

          <Typography variant="body1" sx={{ mb: 2 }}>
            What would you like to update?
          </Typography>

          <FormControl component="fieldset">
            <RadioGroup
              value={selectedResizeScope}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setSelectedResizeScope(event.target.value as 'single' | 'all' | 'future')
              }
            >
              <FormControlLabel
                value="single"
                control={<Radio />}
                label="Only this occurrence"
              />
              <FormControlLabel
                value="future"
                control={<Radio />}
                label="This and all future occurrences"
              />
              <FormControlLabel
                value="all"
                control={<Radio />}
                label="All occurrences of this routine"
              />
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRoutineResizeCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleRoutineResizeConfirm}
            color="primary"
            variant="contained"
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>

      {/* Task Date Range Warning Dialog */}
      <TaskDateRangeWarningDialog
        open={taskDateWarningDialog.isOpen}
        onClose={handleTaskDateWarningRevert}
        onRevert={handleTaskDateWarningRevert}
        onExpand={handleTaskDateWarningExpand}
        validationError={taskDateWarningDialog.validationError}
        eventName={taskDateWarningDialog.eventName}
      />

      {/* Google Calendar Sync Dialog */}
      <Dialog
        open={gcalSyncDialog.isOpen}
        onClose={handleGcalSyncClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Google Calendar Sync
        </DialogTitle>
        <DialogContent>
          {!gcalSyncDialog.lastResult ? (
            <>
              <Typography variant="body1" sx={{ mb: 2 }}>
                Sync your events with Google Calendar.
              </Typography>

              {gcalSyncDialog.loadingCalendars ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : gcalSyncDialog.calendars.length > 0 ? (
                <Box sx={{ mb: 2 }}>
                  <FormControl fullWidth>
                    <InputLabel id="calendar-select-label">Calendar</InputLabel>
                    <Select
                      labelId="calendar-select-label"
                      value={gcalSyncDialog.calendarId}
                      label="Calendar"
                      onChange={(event: SelectChangeEvent<string>) =>
                        setGcalSyncDialog({
                          ...gcalSyncDialog,
                          calendarId: event.target.value as string
                        })
                      }
                    >
                      {gcalSyncDialog.calendars.map((calendar) => (
                        <MenuItem key={calendar.id} value={calendar.id}>
                          {calendar.summary} {calendar.primary && '(Primary)'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              ) : (
                <Typography variant="body2" color="error" sx={{ mb: 2 }}>
                  No calendars found. Please ensure you have linked your Google account and granted calendar permissions.
                </Typography>
              )}

              <Box sx={{ mb: 2 }}>
                <FormControl component="fieldset" fullWidth>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Sync Direction
                  </Typography>
                  <RadioGroup
                    value={gcalSyncDialog.syncDirection}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setGcalSyncDialog({
                        ...gcalSyncDialog,
                        syncDirection: event.target.value as 'bidirectional' | 'to_gcal' | 'from_gcal'
                      })
                    }
                  >
                    <FormControlLabel
                      value="bidirectional"
                      control={<Radio />}
                      label="Bidirectional (sync both ways)"
                    />
                    <FormControlLabel
                      value="from_gcal"
                      control={<Radio />}
                      label="Import from Google Calendar only"
                    />
                    <FormControlLabel
                      value="to_gcal"
                      control={<Radio />}
                      label="Export to Google Calendar only"
                    />
                  </RadioGroup>
                </FormControl>
              </Box>

              <Typography variant="caption" color="text.secondary">
                Note: Google Calendar sync requires proper configuration on the server.
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Sync Results
              </Typography>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2">
                  📥 Imported: {gcalSyncDialog.lastResult.imported_events} events
                </Typography>
                <Typography variant="body2">
                  📤 Exported: {gcalSyncDialog.lastResult.exported_events} events
                </Typography>
                <Typography variant="body2">
                  🔄 Updated: {gcalSyncDialog.lastResult.updated_events} events
                </Typography>
              </Box>

              {gcalSyncDialog.lastResult.errors.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ color: 'error.main', mb: 1 }}>
                    Errors:
                  </Typography>
                  {gcalSyncDialog.lastResult.errors.map((error, index) => (
                    <Typography key={index} variant="body2" sx={{ color: 'error.main', ml: 1 }}>
                      • {error}
                    </Typography>
                  ))}
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleGcalSyncClose}>
            {gcalSyncDialog.lastResult ? 'Close' : 'Cancel'}
          </Button>
          {!gcalSyncDialog.lastResult && (
            <Button
              onClick={handleGcalSyncConfirm}
              color="primary"
              variant="contained"
              disabled={gcalSyncDialog.isLoading || gcalSyncDialog.loadingCalendars || gcalSyncDialog.calendars.length === 0}
            >
              {gcalSyncDialog.isLoading ? 'Syncing...' : 'Sync Now'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default Calendar;
