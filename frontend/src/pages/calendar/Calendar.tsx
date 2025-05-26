import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Goal, CalendarEvent, CalendarTask } from '../../types/goals';
import { updateGoal } from '../../shared/utils/api';
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import TaskList from './TaskList';
import { useHistoryState } from '../../shared/hooks/useHistoryState';
import './Calendar.css';

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
    try {
      // Use getTime() to get the timestamp representing the local time instant

      const tempGoal: Goal = {
        id: 0,
        name: '',
        goal_type: 'task',
        description: '',
        priority: 'medium',
        // Assign the Date object directly
        scheduled_timestamp: clickedDate,
        // Also use the Date object if routine_time should default to the clicked time
        routine_time: clickedDate,
        _tz: 'user' // Keep track that this is user's local time
      };
      // Use a different logging method for objects to avoid premature stringification issues
      console.log('[Calendar.tsx] handleDateClick: tempGoal before opening menu:', tempGoal);

      if (arg.allDay) {
        tempGoal.duration = 1440;
      }

      GoalMenu.open(tempGoal, 'create', async () => {
        loadCalendarData();
      });
    } catch (error) {
      console.error('Error handling date click:', error);
    }
  };

  const handleEventClick = (info: any) => {
    if (debugMode) {
      console.log('[DEBUG] Event clicked:', info.event.title, info.event.id);
    }

    const goal = info.event.extendedProps?.goal;
    if (goal) {
      GoalMenu.open(goal, 'view', async () => {
        loadCalendarData();
      });
      return;
    }

    const foundEvent = state.events.find((e) => e.id === info.event.id);
    if (foundEvent && foundEvent.goal) {
      GoalMenu.open(foundEvent.goal, 'view', async () => {
        loadCalendarData();
      });
    } else {
      console.warn('No associated goal found for event:', info.event.id);
    }
  };

  const handleEventDidMount = (info: any) => {
    info.el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const goal = info.event.extendedProps?.goal;
      if (goal) {
        GoalMenu.open(goal, 'edit', async () => {
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
      const isRoutine = goal.goal_type === 'routine';
      const updates = { ...goal };

      if (isRoutine) {
        updates.routine_time = info.event.start;
      } else {
        updates.scheduled_timestamp = info.event.start;
      }

      await updateGoal(goal.id, updates);
      loadCalendarData();
    } catch (error) {
      console.error('Failed to update goal:', error);
      info.revert();
    }
  };

  const handleEventDrop = async (info: any) => {
    try {
      const existingEvent = state.events.find((e) => e.id === info.event.id);
      if (existingEvent?.goal) {
        const goal = existingEvent.goal;
        const isRoutine = goal.goal_type === 'routine';
        const updates = { ...goal };
        console.log(info.event.start,info.event.end)

        if (isRoutine) {
          updates.routine_time = info.event.start;
        } else {
          updates.scheduled_timestamp = info.event.start;
        }

        await updateGoal(goal.id, updates);
      }
      loadCalendarData();
    } catch (error) {
      console.error('Failed to move event:', error);
      info.revert();
    }
  };

  const handleEventResize = async (info: any) => {
    try {
      const existingEvent = state.events.find((e) => e.id === info.event.id);
      if (existingEvent?.goal) {
        const start = info.event.start;
        const end = info.event.end;
        console.log(end, start)
        console.log(typeof end)
        const durationInMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

        const oldStartTime = new Date(existingEvent.start).getTime();
        const newStartTime = start.getTime();
        const goal = existingEvent.goal;
        const isRoutine = goal.goal_type === 'routine';

        if (oldStartTime !== newStartTime) {
          const updates = {
            ...goal,
            duration: durationInMinutes
          };

          if (isRoutine) {
            updates.routine_time = start;
          } else {
            updates.scheduled_timestamp = start;
          }

          await updateGoal(goal.id, updates);
        } else {
          await updateGoal(goal.id, {
            ...goal,
            duration: durationInMinutes
          });
        }
      }
      loadCalendarData();
    } catch (error) {
      console.error('Failed to resize event:', error);
      info.revert();
    }
  };

  const handleEventDragStop = async (info: any) => {
    try {
      if (!taskListRef.current) return;
      const rect = taskListRef.current.getBoundingClientRect();
      const { clientX, clientY } = info.jsEvent;
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const existingEvent = state.events.find((e) => e.id === info.event.id);
        if (existingEvent?.goal) {
          const goal = existingEvent.goal;
          await updateGoal(goal.id, { ...goal, scheduled_timestamp: null });
          info.event.remove();
          loadCalendarData();
        }
      }
    } catch (error) {
      console.error('Failed to unschedule event:', error);
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
    const bgColor = goal ? getGoalColor(goal) || '#999' : '#999';
    let txtColor = '#fff';

    return {
      id: evt.id,
      title: evt.title,
      start: evt.start,
      end: evt.end,
      allDay: evt.allDay,
      backgroundColor: bgColor,
      borderColor: bgColor,
      textColor: txtColor,
      extendedProps: {
        ...evt,
        goal
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
            <span>Loading calendar data...</span>
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
          eventDragStop={handleEventDragStop}
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
  );
};

export default Calendar;
