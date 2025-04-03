import React, { useState, useEffect, useRef } from 'react';
import { Goal, CalendarEvent, CalendarTask } from '../../types/goals';
import { updateGoal } from '../../shared/utils/api';
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import TaskList from './TaskList';
import { dateToTimestamp } from '../../shared/utils/time';
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
  // Effects
  // -----------------------------
  // Initial data load
  useEffect(() => {
    loadCalendarData().catch((err) => {
      console.error('Error loading calendar data:', err);
      setError('Failed to load calendar data. Please try refreshing the page.');
    });
  }, []);

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
          setState({ ...state, isLoading: false });

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
  }, [state.isLoading, dataLoadAttempts]);

  // Optional debug: global click logging
  useEffect(() => {
    if (!debugMode) return;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      console.log('[DEBUG] Global click:', target.tagName, target.className);
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
  // Data Loading
  // -----------------------------
  const loadCalendarData = async (dateRange = state.dateRange) => {
    if (state.isLoading) return;

    try {
      setState({ ...state, isLoading: true });
      const data = await fetchCalendarData(dateRange);

      // Clear any data-loading timeouts
      if (dataLoadingTimeoutRef.current) {
        clearTimeout(dataLoadingTimeoutRef.current);
      }

      setState({
        ...state,
        events: data.events,
        tasks: data.unscheduledTasks,
        isLoading: false,
        dateRange
      });
    } catch (error) {
      console.error('Error loading calendar data:', error);
      setState({ ...state, isLoading: false });

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
  };

  // -----------------------------
  // Handlers
  // -----------------------------
  const handleDatesSet = (dateInfo: any) => {
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

    debouncingRef.current = setTimeout(() => {
      setState({ ...state, dateRange: { start, end } });
      loadCalendarData({ start, end });
      debouncingRef.current = null;
    }, 300);
  };

  const handleDateClick = (arg: any) => {
    console.log('Date clicked:', arg.date);
    try {
      const tempGoal: Goal = {
        id: 0,
        name: '',
        goal_type: 'task',
        description: '',
        priority: 'medium',
        scheduled_timestamp: dateToTimestamp(arg.date),
        routine_time: dateToTimestamp(arg.date),
        _tz: 'user'
      };

      // If clicked in the all-day area, default to 24 hours
      if (arg.allDay) {
        tempGoal.duration = 1440; // 24 hours in minutes
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

    // By default, FullCalendar calls preventDefault on the jsEvent, so no need to overdo it
    const goal = info.event.extendedProps?.goal;
    if (goal) {
      GoalMenu.open(goal, 'view', async () => {
        loadCalendarData();
      });
      return;
    }

    // Fallback: find in state
    const foundEvent = state.events.find((e) => e.id === info.event.id);
    if (foundEvent && foundEvent.goal) {
      GoalMenu.open(foundEvent.goal, 'view', async () => {
        loadCalendarData();
      });
    } else {
      console.warn('No associated goal found for event:', info.event.id);
    }
  };

  // If you need right-click (context menu) behavior on events:
  const handleEventDidMount = (info: any) => {
    // Minimal example of attaching a right-click listener
    info.el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault(); // keep custom context menu from interfering
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

      await updateGoal(task.goal.id, {
        ...task.goal,
        scheduled_timestamp: dateToTimestamp(info.event.start)
      });
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
        await updateGoal(existingEvent.goal.id, {
          ...existingEvent.goal,
          scheduled_timestamp: dateToTimestamp(info.event.start)
        });
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
        const durationInMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

        await updateGoal(existingEvent.goal.id, {
          ...existingEvent.goal,
          duration: durationInMinutes
        });
      }
      loadCalendarData();
    } catch (error) {
      console.error('Failed to resize event:', error);
      info.revert();
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
    let bgColor = '#999';
    let txtColor = '#fff';

    if (goal) {
      bgColor = getGoalColor(goal) || '#999';
      txtColor = '#fff';
    }

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
          eventDidMount={handleEventDidMount} // For optional right-click
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
