import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Goal, CalendarEvent, CalendarTask } from '../../types/goals';
import { updateGoal, createEvent, updateRoutineEvent } from '../../shared/utils/api';
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
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
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl
} from '@mui/material';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';

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
  eventInfo: any; // FullCalendar event info for reverting
}

const Calendar: React.FC = () => {
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
    eventInfo: null
  });
  const [selectedUpdateScope, setSelectedUpdateScope] = useState<'single' | 'all' | 'future'>('single');
  const calendarRef = useRef<FullCalendar | null>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const debouncingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debugging mode toggles global logs, etc.
  const [debugMode] = useState(true);

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
      const target = e.target as HTMLElement;
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
    const clickedDate = arg.date instanceof Date ? arg.date : new Date(arg.date);

    // Create a new goal with the clicked date pre-populated for tasks
    const newGoal: Goal = {
      id: 0,
      name: '',
      goal_type: 'task', // Default to task
      description: '',
      priority: 'medium',
      scheduled_timestamp: clickedDate, // Pre-populate scheduled date
      duration: 60 // Default duration
    };

    // Open GoalMenu in create mode
    GoalMenu.open(newGoal, 'create', async () => {
      loadCalendarData();
    });
  };

  const handleEventClick = (info: any) => {
    if (debugMode) {
      console.log('[DEBUG] Event clicked:', info.event.title, info.event.id);
    }

    const event = info.event.extendedProps?.goal;
    const parent = info.event.extendedProps?.parent;

    if (event) {
      // Open GoalMenu for all goal types, including events
      // GoalMenu will handle view/edit mode and all actions internally
      GoalMenu.open(event, 'view', async () => {
        // This callback is called when the goal is updated/deleted/split
        loadCalendarData();
      });
    }
  };

  const handleEventDidMount = (info: any) => {
    info.el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const goal = info.event.extendedProps?.goal;
      const parent = info.event.extendedProps?.parent;

      if (goal) {
        // Use GoalMenu for all goal types on right-click
        // For events, it will open in view mode by default
        GoalMenu.open(goal, goal.goal_type === 'event' ? 'view' : 'edit', async () => {
          loadCalendarData();
        });
      }
    });
  };

  const handleEventReceive = async (info: any) => {
    try {
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
        duration: duration
      });

      info.revert(); // Revert the drag since we're creating a new event
      loadCalendarData();
    } catch (error) {
      console.error('Failed to create event:', error);
      info.revert();
      setError('Failed to create event. Please try again.');
    }
  };

  const handleEventDrop = async (info: any) => {
    try {
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
    } catch (error) {
      console.error('Failed to move event:', error);
      info.revert();
      setError('Failed to move event. Please try again.');
    }
  };

  const handleRoutineRescheduleConfirm = async () => {
    try {
      if (!routineRescheduleDialog.eventId || !routineRescheduleDialog.newTimestamp) {
        return;
      }

      await updateRoutineEvent(
        routineRescheduleDialog.eventId,
        routineRescheduleDialog.newTimestamp,
        selectedUpdateScope
      );

      // Close dialog and reload data
      setRoutineRescheduleDialog({
        isOpen: false,
        eventId: null,
        eventName: '',
        newTimestamp: null,
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
      eventInfo: null
    });
    setSelectedUpdateScope('single');
  };

  const handleEventResize = async (info: any) => {
    try {
      const existingEvent = state.events.find((e) => e.id === info.event.id);
      if (existingEvent?.goal && existingEvent.goal.goal_type === 'event') {
        const start = info.event.start;
        const end = info.event.end;
        const durationInMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

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
    } catch (error) {
      console.error('Failed to resize event:', error);
      info.revert();
      setError('Failed to resize event. Please try again.');
    }
  };

  // -----------------------------
  // Helpers and UI
  // -----------------------------
  const handleAddTask = () => {
    const tempGoal: Goal = {
      id: 0,
      name: '',
      goal_type: 'task',
      description: '',
      priority: 'medium'
    };

    GoalMenu.open(tempGoal, 'create', async () => {
      loadCalendarData();
    });
  };

  const handleTaskUpdate = (data: { events: CalendarEvent[]; tasks: CalendarTask[] }) => {
    setState({ ...state, events: data.events, tasks: data.tasks });
  };

  // Build events array with color from the goal
  const eventsWithColors = state.events.map((evt) => {
    const goal = evt.goal;
    const parent = evt.parent;
    const bgColor = evt.backgroundColor || getGoalColor(parent || goal) || '#999';
    let txtColor = evt.textColor || '#fff';

    return {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      allDay: evt.allDay,
      backgroundColor: bgColor,
      borderColor: evt.borderColor || bgColor,
      textColor: txtColor,
      extendedProps: {
        ...evt,
        goal,
        parent
      }
    };
  });

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
          />
        </div>
        <div className="calendar-main">
          {state.isLoading && (
            <div className="calendar-loading-indicator">
              <div className="loading-spinner" />
              <span className="loading-text">Loading calendar data...</span>
            </div>
          )}
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            eventDisplay="block" //supposed to add full background color but doesnt ?
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay'
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
            eventTimeFormat={{
              hour: 'numeric',
              minute: '2-digit',
              meridiem: 'short'
            }}
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
          <Box sx={{ mb: 2 }}>
            <Typography variant="body1" sx={{ mb: 2 }}>
              You're rescheduling the routine event "{routineRescheduleDialog.eventName}".
              What would you like to update?
            </Typography>

            <FormControl component="fieldset">
              <RadioGroup
                value={selectedUpdateScope}
                onChange={(e) => setSelectedUpdateScope(e.target.value as 'single' | 'all' | 'future')}
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
          </Box>
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
    </div>
  );
};

export default Calendar;
