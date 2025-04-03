//calender.tsx
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

// Import FullCalendar and plugins directly instead of dynamically
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
  // State
  const [state, setState] = useHistoryState<CalendarState>({
    events: [],
    tasks: [],
    isLoading: false,
    dateRange: {
      start: new Date(),
      end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    }
  }, {
    hotkeyScope: 'calendar'
  });

  // Add error state
  const [error, setError] = useState<string | null>(null);
  const [dataLoadAttempts, setDataLoadAttempts] = useState(0);

  const calendarRef = useRef<any>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const debouncingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add a debug flag for more verbose output
  const [debugMode] = useState(true);

  // Load calendar data
  useEffect(() => {
    loadCalendarData().catch(err => {
      console.error("Error loading calendar data:", err);
      setError("Failed to load calendar data. Please try refreshing the page.");
    });
  }, []);

  useEffect(() => {
    if (taskListRef.current) {
      const container = taskListRef.current;
      const draggableInstance = new Draggable(container, {
        itemSelector: '.external-event',
        eventData: function (eventEl: HTMLElement) {
          const taskId = eventEl.getAttribute('data-task-id');
          const isAllDay = eventEl.getAttribute('data-all-day') === 'true';
          const task = state.tasks.find((t: CalendarTask) => t.id === taskId);

          if (!task) {
            console.error(`Task with ID ${taskId} not found`);
            return {};
          }

          return {
            title: task.title,
            allDay: isAllDay,
            duration: task.goal.duration ? { minutes: task.goal.duration } : undefined,
            task: task
          };
        }
      });
      return () => {
        draggableInstance.destroy();
      };
    }
  }, [state.tasks]);

  useEffect(() => {
    if (state.isLoading) {
      dataLoadingTimeoutRef.current = setTimeout(() => {
        if (state.isLoading) {
          console.warn("Calendar data loading timeout");
          setState({
            ...state,
            isLoading: false
          });

          // Try to reload if we haven't tried too many times
          if (dataLoadAttempts < 2) {
            setDataLoadAttempts((prev: number) => prev + 1);
            loadCalendarData();
          } else {
            setError("Calendar data loading timed out. Please try refreshing the page.");
          }
        }
      }, 20000); // 20 second timeout
    }

    return () => {
      if (dataLoadingTimeoutRef.current) {
        clearTimeout(dataLoadingTimeoutRef.current);
      }
    };
  }, [state.isLoading, dataLoadAttempts]);

  // Load calendar data based on the current date range
  const loadCalendarData = async (dateRange = state.dateRange) => {
    if (state.isLoading) return;

    try {
      // Set loading state
      setState({
        ...state,
        isLoading: true
      });

      const data = await fetchCalendarData(dateRange);

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
      setState({
        ...state,
        isLoading: false
      });

      // Try to reload if we haven't tried too many times
      if (dataLoadAttempts < 2) {
        setTimeout(() => {
          setDataLoadAttempts((prev: number) => prev + 1);
          loadCalendarData(dateRange);
        }, 2000);
      } else {
        setError("Failed to load calendar data after multiple attempts. Please try refreshing the page.");
      }
    }
  };

  // Handle date view changes
  const handleDatesSet = (dateInfo: any) => {
    const event = dateInfo as any;

    // Ensure we preserve the date objects properly
    const start = event.start instanceof Date ? event.start : new Date(event.start);
    const end = event.end instanceof Date ? event.end : new Date(event.end);

    // Check if the date range is significantly different from the current one
    const currentStart = state.dateRange.start;
    const currentEnd = state.dateRange.end;

    // Check if the date range is already covered by current data (with some buffer)
    const isStartCovered = start >= (
      currentStart instanceof Date
        ? new Date(currentStart.getTime() - 86400000)
        : new Date(new Date(currentStart).getTime() - 86400000)
    ); // 1 day buffer
    const isEndCovered = end <= (
      currentEnd instanceof Date
        ? new Date(currentEnd.getTime() + 86400000)
        : new Date(new Date(currentEnd).getTime() + 86400000)
    );   // 1 day buffer

    if (isStartCovered && isEndCovered) {
      return;
    }

    // Clear any existing debounce timer
    if (debouncingRef.current) {
      clearTimeout(debouncingRef.current);
    }

    // Set a debounce timer to prevent rapid reloading during navigation
    debouncingRef.current = setTimeout(() => {
      // Update state with the new date range
      setState({
        ...state,
        dateRange: { start, end }
      });

      // Load data for the new date range
      loadCalendarData({ start, end });

      // Clear the timer reference
      debouncingRef.current = null;
    }, 300); // 300ms debounce time
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

      // Set duration to 1440 minutes (24 hours) when clicking in the all-day section
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

  // Log click events for debugging purposes
  useEffect(() => {
    if (!debugMode) return;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const path = getElementPath(target);
      console.log('Click detected:', {
        target: target.tagName,
        classes: target.className,
        id: target.id,
        path: path,
        coordinates: { x: e.clientX, y: e.clientY }
      });
    };

    // Helper function to get DOM path for better debugging
    const getElementPath = (element: HTMLElement): string => {
      let path = '';
      let currentElement: HTMLElement | null = element;

      while (currentElement) {
        const tag = currentElement.tagName.toLowerCase();
        const id = currentElement.id ? `#${currentElement.id}` : '';
        const classes = Array.from(currentElement.classList).map(c => `.${c}`).join('');

        path = `${tag}${id}${classes}${path ? ' > ' + path : ''}`;
        currentElement = currentElement.parentElement;
      }

      return path;
    };

    // Add the click listener
    document.addEventListener('click', handleGlobalClick);

    // Clean up the listener when component unmounts
    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [debugMode]);

  // Add right-click (context menu) support
  useEffect(() => {
    if (!debugMode) return;

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      console.log('Right-click detected:', {
        target: target.tagName,
        classes: target.className,
        coordinates: { x: e.clientX, y: e.clientY }
      });
    };

    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [debugMode]);

  const handleEventClick = (info: any) => {
    if (debugMode) {
      console.log('handleEventClick triggered:', {
        eventId: info.event.id,
        eventTitle: info.event.title,
        target: info.jsEvent?.target,
        targetElement: info.jsEvent?.target ? {
          tagName: info.jsEvent.target.tagName,
          className: info.jsEvent.target.className
        } : 'No target',
        eventElement: info.el ? {
          tagName: info.el.tagName,
          className: info.el.className
        } : 'No element',
        event: info.event,
        jsEvent: info.jsEvent ? {
          type: info.jsEvent.type,
          clientX: info.jsEvent.clientX,
          clientY: info.jsEvent.clientY,
          defaultPrevented: info.jsEvent.defaultPrevented
        } : 'No jsEvent'
      });
    }

    // Always prevent default browser behavior
    if (info.jsEvent) {
      info.jsEvent.preventDefault();
      // This is important to stop any parent handlers from firing
      info.jsEvent.stopImmediatePropagation();
      if (debugMode) console.log('Default prevented for event click');
    }

    // First try to get the goal from extendedProps (direct from FullCalendar)
    const goal = info.event.extendedProps?.goal;
    if (debugMode) console.log('Goal from extendedProps:', goal);

    if (goal) {
      if (debugMode) console.log('Opening GoalMenu with goal:', goal);
      GoalMenu.open(goal, 'view', async () => {
        if (debugMode) console.log('GoalMenu closed, reloading calendar data');
        loadCalendarData();
      });
      return;
    }

    // Fallback to searching in state (the old method)
    const event = state.events.find((e: CalendarEvent) => e.id === info.event.id);
    if (debugMode) console.log('Event from state search:', event);

    if (event && event.goal) {
      if (debugMode) console.log('Opening GoalMenu with event goal from state:', event.goal);
      GoalMenu.open(event.goal, 'view', async () => {
        if (debugMode) console.log('GoalMenu closed, reloading calendar data');
        loadCalendarData();
      });
    } else {
      console.warn('Could not find goal for clicked event:', info.event.id, info.event.title);
    }
  };

  // Handle right-click on events
  const handleEventRightClick = (info: any) => {
    if (debugMode) console.log('Event right-clicked:', info.event.title);

    // Prevent the default context menu
    if (info.jsEvent) {
      info.jsEvent.preventDefault();
      info.jsEvent.stopImmediatePropagation();
    }

    // Get the goal from extendedProps
    const goal = info.event.extendedProps?.goal;

    if (goal) {
      // Open GoalMenu in edit mode on right-click
      GoalMenu.open(goal, 'edit', async () => {
        loadCalendarData();
      });
    }
  };

  const handleEventReceive = async (info: any) => {
    try {
      // Check if we have the task data
      if (!info.event.extendedProps.task) {
        console.error('Task data is missing in the received event:', info);
        info.revert();
        return;
      }

      const task = info.event.extendedProps.task;

      // Process event receive and update server
      await updateGoal(task.goal.id, {
        ...task.goal,
        scheduled_timestamp: dateToTimestamp(info.event.start)
      });

      // Reload calendar data
      loadCalendarData();
    } catch (error) {
      console.error('Failed to update goal:', error);
      info.revert();
    }
  };

  const handleEventDrop = async (info: any) => {
    try {
      // Process event drop and update server
      const existingEvent = state.events.find((e: CalendarEvent) => e.id === info.event.id);
      if (existingEvent && existingEvent.goal) {
        await updateGoal(existingEvent.goal.id, {
          ...existingEvent.goal,
          scheduled_timestamp: dateToTimestamp(info.event.start)
        });
      }

      // Reload calendar data
      loadCalendarData();
    } catch (error) {
      console.error('Failed to update event position:', error);
      info.revert();
    }
  };

  const handleEventResize = async (info: any) => {
    try {
      // Process event resize and update server
      const existingEvent = state.events.find((e: CalendarEvent) => e.id === info.event.id);
      if (existingEvent && existingEvent.goal) {
        const start = info.event.start;
        const end = info.event.end;
        const durationInMinutes = Math.round((end - start) / (1000 * 60));

        await updateGoal(existingEvent.goal.id, {
          ...existingEvent.goal,
          duration: durationInMinutes
        });
      }

      // Reload calendar data
      loadCalendarData();
    } catch (error) {
      console.error('Failed to update event duration:', error);
      info.revert();
    }
  };

  const handleAddTask = () => {
    const tempGoal: Goal = {
      id: 0,
      name: '',
      goal_type: 'task',
      description: '',
      priority: 'medium',
    };

    GoalMenu.open(tempGoal, 'create', async () => {
      loadCalendarData();
    });
  };

  const handleTaskUpdate = (data: { events: CalendarEvent[], tasks: CalendarTask[] }) => {
    setState({
      ...state,
      events: data.events,
      tasks: data.tasks
    });
  };

  if (error) {
    return (
      <div className="calendar-error-container">
        <h2>Calendar Error</h2>
        <p>{error}</p>
        <button
          onClick={() => {
            setError(null);
            setDataLoadAttempts((prev: number) => prev + 1);
          }}
          className="retry-button"
        >
          Retry Loading
        </button>
      </div>
    );
  }

  // Prepare the events with proper color information
  const eventsWithColors = state.events.map(event => {
    const goal = event.goal;
    const eventType = event.type;

    // Determine the background color
    let backgroundColor = '#f5f5f5';
    if (goal) {
      const goalWithType = { ...goal };
      // Set a default goal_type if missing
      if (!goalWithType.goal_type) {
        if (eventType === 'scheduled') {
          goalWithType.goal_type = 'task';
        } else if (eventType === 'routine') {
          goalWithType.goal_type = 'routine';
        }
      }
      backgroundColor = getGoalColor(goalWithType);
    }

    // Format for FullCalendar - ensure we keep all needed properties
    return {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      backgroundColor,
      borderColor: backgroundColor,
      textColor: '#ffffff',
      // Preserve all original data in extendedProps
      extendedProps: {
        ...event,
        goal,
        type: eventType
      }
    };
  });

  return (
    <div className="calendar-container" onClick={(e) => console.log('Calendar container clicked', e.target)}>
      <div className="calendar-sidebar">
        <TaskList
          ref={taskListRef}
          tasks={state.tasks}
          events={state.events}
          onAddTask={handleAddTask}
          onTaskUpdate={handleTaskUpdate}
        />
      </div>
      <div className="calendar-main" onClick={(e) => console.log('Calendar main clicked', e.target)}>
        {state.isLoading && (
          <div className="calendar-loading-indicator">
            <div className="loading-spinner"></div>
            <span>Loading calendar data...</span>
          </div>
        )}
        <FullCalendar
          ref={calendarRef}
          height="100%"
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          initialView="dayGridMonth"
          editable={true}
          droppable={true}
          allDaySlot={true}
          dropAccept=".external-event"
          events={eventsWithColors}
          eventReceive={handleEventReceive}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventResizableFromStart={true}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          timeZone="local"
          datesSet={handleDatesSet}
          lazyFetching={true}
          nowIndicator={true}
          dayMaxEvents={true}
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          scrollTime="08:00:00"
          snapDuration="00:05:00"
          eventTimeFormat={{
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short'
          }}
          eventClassNames="fc-custom-event"
          eventDidMount={(info) => {
            // Apply coloring directly to the event elements
            const backgroundColor = info.event.backgroundColor;
            const textColor = info.event.textColor || '#ffffff';

            if (debugMode) {
              console.log('Event mounted:', {
                id: info.event.id,
                title: info.event.title,
                el: info.el ? {
                  tagName: info.el.tagName,
                  className: info.el.className
                } : 'No element'
              });
            }

            // Apply colors to the main event element
            if (info.el) {
              // For better visibility, set a proper background color
              info.el.style.backgroundColor = backgroundColor;
              info.el.style.borderColor = backgroundColor;
              info.el.style.color = textColor;

              // Explicitly ensure event has pointer-events enabled
              info.el.style.pointerEvents = 'auto';
              info.el.style.cursor = 'pointer';
              info.el.style.zIndex = '5';

              // Add explicit click handler directly to event elements as a fallback
              info.el.addEventListener('click', (e) => {
                if (debugMode) {
                  console.log('Direct event element click detected:', {
                    eventId: info.event.id,
                    eventTitle: info.event.title,
                    target: e.target,
                    currentTarget: e.currentTarget
                  });
                }

                // Prevent the default action and stop propagation
                e.preventDefault();
                e.stopImmediatePropagation();

                // Call the eventClick handler directly in case the FullCalendar binding isn't working
                handleEventClick({
                  event: info.event,
                  el: info.el,
                  jsEvent: e,
                  view: calendarRef.current?.getApi().view
                });
              });

              // Add right-click (context menu) handler
              info.el.addEventListener('contextmenu', (e) => {
                if (debugMode) {
                  console.log('Direct event element right-click detected:', {
                    eventId: info.event.id,
                    eventTitle: info.event.title
                  });
                }

                // Prevent the default context menu
                e.preventDefault();
                e.stopImmediatePropagation();

                // Handle right-click
                handleEventRightClick({
                  event: info.event,
                  el: info.el,
                  jsEvent: e,
                  view: calendarRef.current?.getApi().view
                });
              });

              // Find and style the inner elements - cast to HTMLElement to access style property
              const eventMain = info.el.querySelector('.fc-event-main') as HTMLElement;
              if (eventMain) {
                eventMain.style.backgroundColor = backgroundColor;
                eventMain.style.color = textColor;
                eventMain.style.pointerEvents = 'auto';
                eventMain.style.cursor = 'pointer';
                eventMain.style.zIndex = '5';

                // Add click handlers to the main event element too (extra redundancy)
                eventMain.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopImmediatePropagation();

                  handleEventClick({
                    event: info.event,
                    el: info.el,
                    jsEvent: e,
                    view: calendarRef.current?.getApi().view
                  });
                });
              }

              // Style title and time elements for better visibility and interactions
              const titleEl = info.el.querySelector('.fc-event-title') as HTMLElement;
              const timeEl = info.el.querySelector('.fc-event-time') as HTMLElement;

              if (titleEl) {
                titleEl.style.color = textColor;
                titleEl.style.pointerEvents = 'auto';
                titleEl.style.cursor = 'pointer';
                titleEl.style.zIndex = '6';
              }
              if (timeEl) {
                timeEl.style.color = textColor;
                timeEl.style.pointerEvents = 'auto';
                timeEl.style.cursor = 'pointer';
                timeEl.style.zIndex = '6';
              }

              // Add a slight shadow for better text readability on any background color
              info.el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2)';
            }
          }}
        />
      </div>
    </div>
  );
};

export default Calendar;
