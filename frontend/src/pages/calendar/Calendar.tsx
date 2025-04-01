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

  useEffect(() => {
    if (state.fullCalendarLoaded && taskListRef.current && Draggable) {
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

          //console.log(`Creating drag data for task: ${task.title}`);

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
  }, [state.fullCalendarLoaded, state.tasks]);

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
      // Log the date range being requested
      //console.log('===== LOADING CALENDAR DATA =====');
      //console.log(`Date range: ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);
      //console.log(`Local date range: ${dateRange.start.toLocaleString()} to ${dateRange.end.toLocaleString()}`);
      //console.log(`Timezone offset: ${new Date().getTimezoneOffset()} minutes`);

      // Set loading state
      setState({
        ...state,
        isLoading: true
      });

      const data = await fetchCalendarData(dateRange);

      // Log raw data from API
      //console.log(`Raw data from API: ${data.events.length} events, ${data.unscheduledTasks.length} tasks, ${data.achievements.length} achievements`);

      // Create a map to deduplicate events by ID
      const deduplicatedEvents = new Map<string, CalendarEvent>();

      // Process all events and deduplicate by ID
      [...data.events, ...data.achievements].forEach(event => {
        if (!deduplicatedEvents.has(event.id)) {
          try {
            // Fix timezone issues by preserving the existing Date objects
            // instead of creating new ones which causes the 5-hour offset
            deduplicatedEvents.set(event.id, {
              ...event,
              // Don't recreate Date objects if they're already Date objects
              start: event.start instanceof Date ? event.start : new Date(event.start),
              end: event.end instanceof Date ? event.end : new Date(event.end),
              allDay: event.allDay || false,
            });
          } catch (eventError) {
            console.error('Error processing event:', eventError, event);
          }
        } else {
          console.warn(`Skipping duplicate event ID: ${event.id}, title: ${event.title}`);
        }
      });
      const formattedEvents = Array.from(deduplicatedEvents.values());
      const scheduledEvents = formattedEvents.filter(event => event.type === 'scheduled');
      if (dataLoadingTimeoutRef.current) {
        clearTimeout(dataLoadingTimeoutRef.current);
      }

      const formattedTasks = data.unscheduledTasks || [];


      const eventTypeCounts: Record<string, number> = {};
      formattedEvents.forEach(event => {
        eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
      });

      // Log a few sample events for debugging
      if (formattedEvents.length > 0) {
        //console.log(`Sample events:`, formattedEvents.slice(0, 3));
      }

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
    const event = dateInfo as any; // Use type assertion for TypeScript

    // Ensure we preserve the date objects properly
    const start = event.start instanceof Date ? event.start : new Date(event.start);
    const end = event.end instanceof Date ? event.end : new Date(event.end);

    //console.log(`Calendar dates set: ${start.toISOString()} to ${end.toISOString()}`);

    // Check if the date range is significantly different from the current one
    const currentStart = state.dateRange.start;
    const currentEnd = state.dateRange.end;

    // Check if the date range is already covered by current data (with some buffer)
    // Use instanceof check to avoid unnecessary Date creation
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
      //console.log('New date range is already covered by current data, skipping reload');
      return;
    }

    // Clear any existing debounce timer
    if (debouncingRef.current) {
      clearTimeout(debouncingRef.current);
    }

    // Set a debounce timer to prevent rapid reloading during navigation
    debouncingRef.current = setTimeout(() => {
      //console.log('Loading calendar data due to date range change');

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

  // Other handlers can be simplified to just call loadCalendarData 
  // after making their API changes

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

      GoalMenu.open(tempGoal, 'create', async () => {
        loadCalendarData();
      });
    } catch (error) {
      console.error('Error handling date click:', error);
    }
  };

  const handleEventClick = (info: any) => {
    console.log('Event clicked:', info.event);

    // First try to get the goal from extendedProps (direct from FullCalendar)
    const goal = info.event.extendedProps?.goal;

    if (goal) {
      //console.log('Opening goal from event extendedProps:', goal);
      GoalMenu.open(goal, 'view', async () => {
        loadCalendarData();
      });
      return;
    }

    // Fallback to searching in state (the old method)
    const event = state.events.find((e: CalendarEvent) => e.id === info.event.id);
    if (event && event.goal) {
      //console.log('Opening goal from state events:', event.goal);
      GoalMenu.open(event.goal, 'view', async () => {
        loadCalendarData();
      });
    } else {
      console.warn('Could not find goal for clicked event:', info.event.id, info.event.title);
    }
  };

  const handleEventReceive = async (info: any) => {
    //console.log('Event received:', info);
    try {
      // Check if we have the task data
      if (!info.event.extendedProps.task) {
        console.error('Task data is missing in the received event:', info);
        info.revert();
        return;
      }

      const task = info.event.extendedProps.task;
      //console.log('Scheduling task:', task);

      // Process event receive and update server
      await updateGoal(task.goal.id, {
        ...task.goal,
        scheduled_timestamp: dateToTimestamp(info.event.start)
      });

      //console.log('Task scheduled successfully, reloading calendar data');

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
    const eventTypes = state.events.reduce((acc: Record<string, number>, event: CalendarEvent) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});
  }, [state.events]);

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
            if (state.events.length > 0) {
              const viewStart = new Date(info.start);
              const viewEnd = new Date(info.end);

              viewStart.setDate(viewStart.getDate() - 1);
              viewEnd.setDate(viewEnd.getDate() + 1);

              const filteredEvents = state.events.filter(event => {
                // Preserve Date objects to avoid timezone conversion issues
                const eventStart = event.start instanceof Date ? event.start : new Date(event.start);
                const eventEnd = (event.end instanceof Date ? event.end : new Date(event.end || event.start)); // Use start as fallback if end is missing

                // Check if the event overlaps with the current view range
                return (eventStart <= viewEnd && eventEnd >= viewStart);
              });

              // Debug the types of events being passed to FullCalendar
              const eventTypes = filteredEvents.reduce((acc: Record<string, number>, event: CalendarEvent) => {
                acc[event.type] = (acc[event.type] || 0) + 1;
                return acc;
              }, {});


              const eventsWithExtendedProps = filteredEvents.map((event: CalendarEvent) => {
                const eventWithProps = {
                  ...event,
                  extendedProps: {
                    ...event,
                    goal: event.goal,
                    type: event.type
                  }
                };
                return eventWithProps;
              });

              //console.log('First few events with extendedProps:', eventsWithExtendedProps.slice(0, 3));

              // If we have scheduled tasks, log them
              const scheduledTasks = filteredEvents.filter((event: CalendarEvent) => event.type === 'scheduled');
              if (scheduledTasks.length > 0) {
                const potentialIssues = scheduledTasks.filter((e: CalendarEvent) =>
                  !e.goal ||
                  !e.goal.goal_type ||
                  !e.start ||
                  !e.end
                );

                if (potentialIssues.length > 0) {
                  /*console.log(`Found ${potentialIssues.length} scheduled tasks with potential issues:`,
                    potentialIssues.slice(0, 3)
                  );*/
                }

                // Check if dates are in the future
                const now = new Date();
                const pastTasks = scheduledTasks.filter((e: CalendarEvent) =>
                  e.start < now
                );
                const rangeStart = new Date(info.start);
                const rangeEnd = new Date(info.end);
                const tasksInRange = scheduledTasks.filter((e: CalendarEvent) =>
                  e.start >= rangeStart && e.start <= rangeEnd
                );


              }
              successCallback(eventsWithExtendedProps);
            } else {
              console.warn('No events available in state');
              successCallback([]);
            }
          }}
          eventReceive={handleEventReceive}
          eventClick={handleEventClick}
          //dateClick={handleDateClick} //uncomment after done with event click debugging
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventResizableFromStart={true}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          timeZone="local"
          datesSet={handleDatesSet}
          lazyFetching={true}
          eventDidMount={(info: EventInfo) => {
            const event = info.event as any; // Use type assertion
            const startDate = event.start;
            const eventDateFormatted = startDate ?
              `${startDate.toISOString()} (local: ${startDate.toLocaleString()})` :
              'No date';

            //console.log(`Event mounted: ${event.id}, title: ${event.title}, date: ${eventDateFormatted}`);

            // Check for debug key that indicates potential duplicate
            const debugKey = event.extendedProps?._debug_key;
            if (debugKey) {
              //console.log(`Event ${event.id} has debug key: ${debugKey}`);
            }
          }}
          eventContent={(arg: any) => {
            const event = arg.event as any; // Use type assertion
            const goal = event.extendedProps?.goal;
            const eventType = event.extendedProps?.type;
            const isScheduledTask = eventType === 'scheduled';
            if (isScheduledTask) {
              const taskColor = '#81c784'; // Green color for tasks
              return (
                <div
                  className="custom-calendar-event"
                  style={{
                    backgroundColor: taskColor,
                    borderColor: taskColor,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    width: '100%',
                    zIndex: 1000,
                  }}
                  title={`${event.title} (scheduled task)`}
                >
                  {event.title}
                </div>
              );
            }

            // If event is not found in state, use the default event data from FullCalendar
            if (!goal) {
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
                  title={event.title}
                >
                  {event.title}
                </div>
              );
            }

            // Set a default goal_type if missing to ensure correct color
            if (!goal.goal_type) {
              if (eventType === 'scheduled') {
                goal.goal_type = 'task';
              } else if (eventType === 'routine') {
                goal.goal_type = 'routine';
              }
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
                title={goal ? `${goal.name} (${goal.goal_type || eventType})` : event.title}
              >
                {event.title}
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
