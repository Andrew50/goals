import React, { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import { EventApi } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable, DateClickArg, EventReceiveArg, EventResizeStopArg } from '@fullcalendar/interaction';
import { EventClickArg, EventDropArg } from '@fullcalendar/core';
import { Goal, CalendarEvent, CalendarTask } from '../../types/goals';
import { updateGoal } from '../../shared/utils/api';
import { goalColors } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import TaskList from './TaskList';




const Calendar: React.FC = () => {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const calendarRef = useRef<FullCalendar>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadCalendarData = async () => {
      const data = await fetchCalendarData();
      const formattedEvents = [...data.events, ...data.achievements].map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
        //allDay: false
      }));
      setEvents(formattedEvents);
      setTasks(data.unscheduledTasks);
    };

    loadCalendarData();
  }, []);

  useEffect(() => {
    if (taskListRef.current) {
      new Draggable(taskListRef.current, {
        itemSelector: '.external-event',
        eventData: (eventEl) => {
          const taskId = eventEl.getAttribute('data-task-id');
          const task = tasks.find(t => t.id === taskId);
          const durationMinutes = task?.goal?.duration || 60; // Default to 60 minutes if duration not set
          const hours = Math.floor(durationMinutes / 60);
          const minutes = durationMinutes % 60;
          const duration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          return {
            id: task?.id,
            title: task?.title,
            duration: duration, // Use duration from goal
            extendedProps: {
              task: task
            }
          };
        },
      });
    }
  }, [tasks]);



  const handleEventClick = (info: EventClickArg) => {
    const event = events.find((e) => e.id === info.event.id);
    if (event && event.goal) {
      GoalMenu.open(event.goal, 'view', async (updatedGoal) => {
        const data = await fetchCalendarData();
        const formattedEvents = [...data.events, ...data.achievements].map((event) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
          allDay: false,
        }));
        setEvents(formattedEvents);
        setTasks(data.unscheduledTasks);
      });
    }
  };


  const handleDateClick = (arg: DateClickArg) => {
    // Open GoalMenu or handle date click events
  };

  const handleEventReceive = async (info: EventReceiveArg) => {
    console.log('event recevied');
    const task = info.event.extendedProps.task;
    console.log('task', task);
    if (!task || !task.goal) {
      console.error('Task or goal information missing');
      info.revert(); // Revert the drop
      return;
    }

    const start = info.event.start;
    if (!start) {
      console.error('Event start date missing');
      info.revert(); // Revert the drop
      return;
    }

    // Update the task's goal with the scheduled timestamp
    const updatedGoal = {
      ...task.goal,
      scheduled_timestamp: start.getTime(),
    };

    try {
      // Send update to backend
      await updateGoal(task.goal.id, updatedGoal);

      // Update local state
      setEvents((prevEvents) => [...prevEvents, {
        id: task.id,
        title: task.title,
        start: start,
        end: new Date(start.getTime() + (task.duration || 60) * 60000),
        goal: updatedGoal,
        type: task.type || 'task',
      }]);

      // Remove the task from the tasks list
      setTasks((prevTasks) => prevTasks.filter((t) => t.id !== task.id));
    } catch (error) {
      console.error('Failed to update goal:', error);
      // Revert the event on the calendar
      info.revert();
    }
  };

  const handleEventDrop = async (info: EventDropArg) => {
    const existingEvent = events.find((e: CalendarEvent) => e.id === info.event.id);
    if (!existingEvent || !existingEvent.goal || !info.event.start || !info.event.end) {
      console.error('Event drop failed: missing event or goal');
      return;
    }

    const start = info.event.start;
    const end = info.event.end;

    const submissionGoal = {
      ...existingEvent.goal,
      scheduled_timestamp: start.getTime(),
    };

    if (existingEvent.goal.goal_type === 'routine') {
      submissionGoal.routine_time = start.getTime();
    }

    const updatedEvent: CalendarEvent = {
      ...existingEvent,
      id: info.event.id,
      title: info.event.title,
      start: start,
      end: end,
      allDay: info.event.allDay,
      goal: submissionGoal,
    };

    try {
      // Send update to backend
      await updateGoal(existingEvent.goal.id, submissionGoal);

      // Update local state if backend call succeeds
      setEvents((prevEvents: CalendarEvent[]) =>
        prevEvents.map((event: CalendarEvent) =>
          event.id === updatedEvent.id ? updatedEvent : event
        )
      );
    } catch (error) {
      console.error('Failed to update event schedule:', error);
      // Revert the drag if the backend update fails
      info.revert();
    }
  };




  const handleEventResize = async (info: EventResizeStopArg) => {
    const existingEvent = events.find((e) => e.id === info.event.id);
    if (!existingEvent || !existingEvent.goal || !info.event.start || !info.event.end) {
      console.error('Event resize failed: missing event or goal');
      return;
    }

    const start = info.event.start;
    const end = info.event.end;
    const durationInMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));

    const submissionGoal = {
      ...existingEvent.goal,
      duration: durationInMinutes,
      scheduled_timestamp: start.getTime()
    };

    if (existingEvent.goal.goal_type === 'routine') {
      submissionGoal.routine_time = start.getTime();
    }

    const updatedEvent = {
      ...existingEvent,
      start,
      end,
      goal: submissionGoal,
    };

    try {
      await updateGoal(submissionGoal.id, submissionGoal);
      setEvents((prevEvents) =>
        prevEvents.map((event) => (event.id === updatedEvent.id ? updatedEvent : event))
      );
    } catch (error) {
      console.error('Failed to update event duration:', error);
      info.event.setStart(existingEvent.start);
      info.event.setEnd(existingEvent.end);
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

    GoalMenu.open(tempGoal, 'create', async (updatedGoal) => {
      const data = await fetchCalendarData();
      const formattedEvents = [...data.events, ...data.achievements].map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: false
      }));
      setEvents(formattedEvents);
      setTasks(data.unscheduledTasks);
    });
  };

  const handleTaskClick = (task: CalendarTask) => {
    GoalMenu.open(task.goal, 'edit', async (updatedGoal) => {
      const data = await fetchCalendarData();
      const formattedEvents = [...data.events, ...data.achievements].map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: false
      }));
      setEvents(formattedEvents);
      setTasks(data.unscheduledTasks);
    });
  };

  const handleTaskUpdate = (data: { events: CalendarEvent[], tasks: CalendarTask[] }) => {
    setEvents(data.events);
    setTasks(data.tasks);
  };

  return (
    <div style={{
      height: 'calc(100vh - 64px)',
      display: 'flex',
      padding: '20px',
      gap: '20px',
      overflow: 'hidden'
    }}>
      <div style={{
        width: '250px',
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#101f33',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
      }}>
        <TaskList
          tasks={tasks}
          onAddTask={handleAddTask}
          onTaskClick={handleTaskClick}
          onTaskUpdate={handleTaskUpdate}
        />
      </div>

      <div style={{
        flex: 1,
        height: '100%',
        backgroundColor: '#101f33',
        borderRadius: '12px',
        padding: '16px',
        overflow: 'hidden'
      }}>
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
          events={events}
          dateClick={handleDateClick}
          eventReceive={handleEventReceive}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventResizableFromStart={true}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          allDaySlot={true}
          eventContent={(arg) => {
            const event = events.find((e) => e.id === arg.event.id);
            const backgroundColor = event?.goal ? goalColors[event.goal.goal_type] : '#f5f5f5';
            return (
              <div style={{
                backgroundColor,
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
                padding: '4px',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
              }}>
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
          eventDidMount={(info) => {
            info.el.addEventListener('contextmenu', (e) => {
              e.preventDefault(); // Prevent default context menu

              const fcEvent = info.event;
              const event = events.find((e) => e.id === fcEvent.id);
              if (event && event.goal) {
                GoalMenu.open(event.goal, 'edit', async (updatedGoal) => {
                  const data = await fetchCalendarData();
                  const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                    ...event,
                    start: new Date(event.start),
                    end: new Date(event.end),
                  }));
                  setEvents(formattedEvents);
                  setTasks(data.unscheduledTasks);
                });
              }
            });
          }}
          snapDuration="00:01:00"
        />
      </div>
    </div>
  );
};

export default Calendar;
