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

// Import FullCalendar dynamically to avoid build errors
let FullCalendar: any;
let dayGridPlugin: any;
let timeGridPlugin: any;
let interactionPlugin: any;
let Draggable: any;

// Dynamically load FullCalendar when component mounts
const loadFullCalendar = async () => {
  try {
    // Add a timeout to prevent hanging if imports fail
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('FullCalendar loading timeout')), 15000);
    });

    const loadPromise = Promise.all([
      import('@fullcalendar/react'),
      import('@fullcalendar/daygrid'),
      import('@fullcalendar/timegrid'),
      import('@fullcalendar/interaction')
    ]);

    // Race between the loading and the timeout
    const [
      fullCalendarReact,
      fullCalendarDayGrid,
      fullCalendarTimeGrid,
      fullCalendarInteraction
    ] = await Promise.race([loadPromise, timeoutPromise]) as any;

    // Check if all modules were loaded correctly
    if (!fullCalendarReact || !fullCalendarDayGrid ||
      !fullCalendarTimeGrid || !fullCalendarInteraction) {
      console.error('Some FullCalendar modules failed to load');
      return false;
    }

    // Assign the loaded modules to variables
    try {
      FullCalendar = fullCalendarReact.default;
      dayGridPlugin = fullCalendarDayGrid.default;
      timeGridPlugin = fullCalendarTimeGrid.default;
      interactionPlugin = fullCalendarInteraction.default;
      Draggable = fullCalendarInteraction.Draggable;

      // Verify that all required components are available
      if (!FullCalendar || !dayGridPlugin || !timeGridPlugin ||
        !interactionPlugin || !Draggable) {
        console.error('Some FullCalendar components are missing');
        return false;
      }

      return true;
    } catch (assignError) {
      console.error('Error assigning FullCalendar modules:', assignError);
      return false;
    }
  } catch (error) {
    console.error('Failed to load FullCalendar:', error);
    return false;
  }
};

interface CalendarState {
  events: CalendarEvent[];
  tasks: CalendarTask[];
  isLoading: boolean;
  dateRange: {
    start: Date;
    end: Date;
  };
  fullCalendarLoaded: boolean;
}

// Define interfaces for FullCalendar callbacks
interface DateInfo {
  startStr: string;
  endStr: string;
  start: Date;
  end: Date;
}

interface EventInfo {
  event: {
    id: string;
    title: string;
    extendedProps?: any;
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
    },
    fullCalendarLoaded: false
  }, {
    hotkeyScope: 'calendar'
  });

  // Add error state
  const [error, setError] = useState<string | null>(null);
  const [loadAttempts, setLoadAttempts] = useState(0);
  const [dataLoadAttempts, setDataLoadAttempts] = useState(0);

  const calendarRef = useRef<any>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const debouncingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load FullCalendar dynamically
  useEffect(() => {
    const loadCalendarLibraries = async () => {
      try {
        setError(null);
        const success = await loadFullCalendar();

        if (success) {
          setState({
            ...state,
            fullCalendarLoaded: true
          });
        } else {
          setError("Failed to load calendar components. Please try refreshing the page.");
          // Try to reload if we haven't tried too many times
          if (loadAttempts < 2) {
            setTimeout(() => {
              setLoadAttempts((prev: number) => prev + 1);
            }, 2000);
          }
        }
      } catch (err) {
        console.error("Error in loadCalendarLibraries:", err);
        setError("An error occurred while loading the calendar. Please try refreshing the page.");
      }
    };

    loadCalendarLibraries();
  }, [loadAttempts]);

  // Load calendar data
  useEffect(() => {
    if (state.fullCalendarLoaded) {
      loadCalendarData().catch(err => {
        console.error("Error loading calendar data:", err);
        setError("Failed to load calendar data. Please try refreshing the page.");
      });
    }
  }, [state.fullCalendarLoaded]);

  // Initialize draggable functionality for external events
  useEffect(() => {
    if (state.fullCalendarLoaded && taskListRef.current && Draggable) {
      console.log(`Initializing draggable functionality for ${state.tasks.length} tasks`);

      // Clean up any previous draggable instance to prevent duplicates
      const container = taskListRef.current;

      // Initialize draggable for external events
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

          console.log(`Creating drag data for task: ${task.title}`);

          return {
            title: task.title,
            allDay: isAllDay,
            duration: task.goal.duration ? { minutes: task.goal.duration } : undefined,
            task: task
          };
        }
      });

      // Return cleanup function
      return () => {
        console.log("Cleaning up draggable instance");
        draggableInstance.destroy();
      };
    }
  }, [state.fullCalendarLoaded, state.tasks]);

  // Set a timeout for data loading
  useEffect(() => {
    if (state.isLoading) {
      // Set a timeout to prevent infinite loading
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

      // Log raw data from API
      console.log(`Raw data from API: ${data.events.length} events, ${data.unscheduledTasks.length} tasks, ${data.achievements.length} achievements`);

      // Check for scheduled tasks in the events
      const scheduledEvents = data.events.filter(event => event.type === 'scheduled');
      console.log(`Found ${scheduledEvents.length} scheduled events in raw data`);

      if (scheduledEvents.length > 0) {
        console.log('Sample scheduled events:', scheduledEvents.slice(0, 3).map(event => ({
          id: event.id,
          title: event.title,
          start: new Date(event.start).toISOString(),
          end: new Date(event.end).toISOString()
        })));
      }

      // Safely format events with error handling
      const formattedEvents: CalendarEvent[] = [];
      try {
        for (const event of [...data.events, ...data.achievements]) {
          try {
            formattedEvents.push({
              ...event,
              start: new Date(event.start),
              end: new Date(event.end),
              allDay: event.allDay || false,
            });
          } catch (eventError) {
            console.error('Error formatting event:', eventError, event);
          }
        }
      } catch (eventsError) {
        console.error('Error processing events array:', eventsError);
      }

      // Clear any loading timeout
      if (dataLoadingTimeoutRef.current) {
        clearTimeout(dataLoadingTimeoutRef.current);
      }

      // Ensure tasks are properly formatted
      const formattedTasks = data.unscheduledTasks || [];

      // Log task count for debugging
      console.log(`Loaded ${formattedTasks.length} unscheduled tasks`);

      // Add debug logging for events
      console.log(`Calendar events count: ${formattedEvents.length}`);
      console.log(`Event types breakdown:`, formattedEvents.reduce((acc: Record<string, number>, event: CalendarEvent) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      }, {}));

      // Log a few sample events for debugging
      if (formattedEvents.length > 0) {
        console.log(`Sample events:`, formattedEvents.slice(0, 3));
      }

      // Update state with the loaded data
      setState({
        ...state,
        events: formattedEvents,
        tasks: formattedTasks,
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
    const newStart = dateInfo.start;
    const newEnd = dateInfo.end;

    // Add buffer days for smoother scrolling/navigation
    const bufferStart = new Date(newStart);
    bufferStart.setDate(bufferStart.getDate() - 7); // 1 week before

    const bufferEnd = new Date(newEnd);
    bufferEnd.setDate(bufferEnd.getDate() + 7); // 1 week after

    // Check if the new range is significantly different from what we already have
    const currentStart = state.dateRange.start;
    const currentEnd = state.dateRange.end;

    const needsUpdate =
      bufferStart < currentStart ||
      bufferEnd > currentEnd ||
      Math.abs(bufferStart.getTime() - currentStart.getTime()) > 86400000 * 14 ||
      Math.abs(bufferEnd.getTime() - currentEnd.getTime()) > 86400000 * 14;

    if (needsUpdate) {
      // Debounce the data loading to prevent multiple rapid requests
      if (debouncingRef.current) {
        clearTimeout(debouncingRef.current);
      }

      debouncingRef.current = setTimeout(() => {
        loadCalendarData({
          start: bufferStart,
          end: bufferEnd
        });
        debouncingRef.current = null;
      }, 300);
    }
  };

  // Other handlers can be simplified to just call loadCalendarData 
  // after making their API changes

  const handleDateClick = (arg: any) => {
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

      GoalMenu.open(tempGoal, 'create', async () => {
        loadCalendarData();
      });
    } catch (error) {
      console.error('Error handling date click:', error);
    }
  };

  const handleEventClick = (info: any) => {
    const event = state.events.find((e: CalendarEvent) => e.id === info.event.id);
    if (event && event.goal) {
      GoalMenu.open(event.goal, 'view', async () => {
        loadCalendarData();
      });
    }
  };

  const handleEventReceive = async (info: any) => {
    console.log('Event received:', info);
    try {
      // Check if we have the task data
      if (!info.event.extendedProps.task) {
        console.error('Task data is missing in the received event:', info);
        info.revert();
        return;
      }

      const task = info.event.extendedProps.task;
      console.log('Scheduling task:', task);

      // Process event receive and update server
      await updateGoal(task.goal.id, {
        ...task.goal,
        scheduled_timestamp: dateToTimestamp(info.event.start)
      });

      console.log('Task scheduled successfully, reloading calendar data');

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

  // Add a useEffect to log the events whenever they change
  useEffect(() => {
    console.log(`FullCalendar events updated: ${state.events.length} events`);

    // Log event types breakdown
    const eventTypes = state.events.reduce((acc: Record<string, number>, event: CalendarEvent) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});
    console.log('Event types in FullCalendar:', eventTypes);

    // Log a few sample events
    if (state.events.length > 0) {
      console.log('Sample events for FullCalendar:', state.events.slice(0, 3).map((event: CalendarEvent) => ({
        id: event.id,
        title: event.title,
        type: event.type,
        start: event.start.toISOString(),
        end: event.end.toISOString()
      })));
    }
  }, [state.events]);

  // Render fallback UI if there's an error or calendar isn't loaded
  if (error) {
    return (
      <div className="calendar-error-container">
        <h2>Calendar Error</h2>
        <p>{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoadAttempts((prev: number) => prev + 1);
          }}
          className="retry-button"
        >
          Retry Loading
        </button>
      </div>
    );
  }

  if (!state.fullCalendarLoaded) {
    return (
      <div className="calendar-loading-container">
        <h2>Loading Calendar</h2>
        <p>Please wait while the calendar components are being loaded...</p>
        <div className="loading-spinner"></div>
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
          events={(info: DateInfo, successCallback: (events: any[]) => void, failureCallback: (error: Error) => void) => {
            // This is a function that will be called by FullCalendar to fetch events
            console.log(`FullCalendar requesting events for: ${info.startStr} to ${info.endStr}`);

            // Use the events from state
            if (state.events.length > 0) {
              console.log(`Providing ${state.events.length} events to FullCalendar`);
              successCallback(state.events.map((event: CalendarEvent) => ({
                id: event.id,
                title: event.title,
                start: event.start,
                end: event.end,
                allDay: event.allDay,
                extendedProps: {
                  type: event.type,
                  goal: event.goal
                }
              })));
            } else {
              console.log('No events to provide to FullCalendar');
              successCallback([]);
            }
          }}
          dateClick={handleDateClick}
          eventReceive={handleEventReceive}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventResizableFromStart={true}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          timeZone="local"
          datesSet={handleDatesSet}
          lazyFetching={true}
          eventDidMount={(info: EventInfo) => {
            console.log(`Event mounted: ${info.event.id}, title: ${info.event.title}`);
          }}
          eventContent={(arg: any) => {
            // Use extendedProps instead of looking up in state
            const goal = arg.event.extendedProps?.goal;
            const eventType = arg.event.extendedProps?.type;

            console.log(`Event ${arg.event.id} has goal: ${!!goal}, type: ${eventType}`);

            // If event is not found in state, use the default event data from FullCalendar
            if (!goal) {
              console.log(`Event not found in state, using default: ${arg.event.title}`);
              return (
                <div
                  className="custom-calendar-event"
                  style={{
                    backgroundColor: '#f5f5f5',
                    borderColor: '#f5f5f5',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    width: '100%'
                  }}
                  title={arg.event.title}
                >
                  {arg.event.title}
                </div>
              );
            }

            const backgroundColor = goal ? getGoalColor(goal) : '#f5f5f5';
            return (
              <div
                className="custom-calendar-event"
                style={{
                  backgroundColor,
                  borderColor: backgroundColor,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  width: '100%'
                }}
                title={goal ? `${goal.name} (${goal.goal_type})` : arg.event.title}
              >
                {arg.event.title}
              </div>
            );
          }}
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          scrollTime="08:00:00"
          eventTimeFormat={{
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short'
          }}
          snapDuration="00:05:00"
          nowIndicator={true}
          dayMaxEvents={true}
        />
      </div>
    </div>
  );
};

export default Calendar;
