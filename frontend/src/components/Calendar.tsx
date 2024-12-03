import React, { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import { EventApi } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable, DateClickArg, EventReceiveArg } from '@fullcalendar/interaction';
import { EventClickArg, EventDropArg } from '@fullcalendar/core';

import { Goal, CalendarEvent, CalendarTask } from '../types';
import { fetchCalendarData } from '../utils/calendarData';
import { goalColors } from '../theme/colors';
import GoalMenu from './GoalMenu';

interface DraggableTaskProps {
  task: CalendarTask;
  onTaskClick: (task: CalendarTask) => void;
}

const DraggableTask = ({ task, onTaskClick }: DraggableTaskProps) => {
  const taskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taskRef.current) {
      new Draggable(taskRef.current, {
        eventData: {
          id: task.id,
          title: task.title,
        },
      });
    }
  }, [task]);

  const handleClick = () => {
    onTaskClick(task);
  };

  const getTaskColor = (type: string) => {
    switch (type) {
      case 'meeting': return { bg: '#e3f2fd', border: '#2196f3' };
      case 'task': return { bg: '#f1f8e9', border: '#8bc34a' };
      case 'appointment': return { bg: '#fce4ec', border: '#e91e63' };
      default: return { bg: '#f5f5f5', border: '#9e9e9e' };
    }
  };

  const colors = getTaskColor(task.type);

  return (
    <div
      ref={taskRef}
      className="fc-event"
      style={{
        marginBottom: '8px',
        padding: '12px 16px',
        backgroundColor: '#1e3a5f',
        border: '1px solid #2196f3',
        borderRadius: '8px',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#ffffff',
      }}
      onClick={handleClick}
    >
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: '#2196f3',
      }} />
      {task.title}
    </div>
  );
};

const TaskList = ({
  tasks,
  onAddTask,
  onTaskClick,
}: {
  tasks: CalendarTask[];
  onAddTask: () => void;
  onTaskClick: (task: CalendarTask) => void;
}) => {
  const taskListRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={taskListRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '16px',
      }}
    >
      <h3 style={{
        margin: '0 0 16px 0',
        color: '#ffffff',
        fontSize: '20px',
        fontWeight: 600,
      }}>Unscheduled Tasks</h3>

      <button
        onClick={onAddTask}
        style={{
          padding: '12px',
          backgroundColor: '#2196f3',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          marginBottom: '16px',
        }}
      >
        Add Task
      </button>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        marginRight: '-8px',
        paddingRight: '8px'
      }}>
        {tasks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: '14px'
          }}>
            No tasks yet
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTask
              key={task.id}
              task={task}
              onTaskClick={onTaskClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

interface EventContextMenuInfo {
  event: EventApi;
  jsEvent: MouseEvent;
}

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
        itemSelector: '.fc-event',
        eventData: (eventEl) => {
          const id = eventEl.getAttribute('data-task-id');
          const task = tasks.find((t) => t.id.toString() === id);
          return task ? {
            id: task.id,
            title: task.title,
            extendedProps: { task },
          } : null;
        },
      });
    }
  }, [tasks]);


  const handleDateClick = (arg: DateClickArg) => {
    // Open GoalMenu or handle date click events
  };

  const handleEventReceive = (info: EventReceiveArg) => {
    const task: CalendarTask = info.event.extendedProps.task;
    const dropDate = info.event.start;

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

  const handleEventClick = (info: EventClickArg) => {
    const event = events.find((e) => e.id === info.event.id);
    if (event && event.goal) {
      GoalMenu.open(event.goal, 'view', async (updatedGoal) => {
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
    }
  };

  const handleEventDrop = (info: EventDropArg) => {
    const existingEvent = events.find(e => e.id === info.event.id);
    if (!existingEvent) return;

    const updatedEvent: CalendarEvent = {
      ...existingEvent,
      id: info.event.id,
      title: info.event.title,
      start: info.event.start || existingEvent.start,
      end: info.event.end || existingEvent.end,
      allDay: info.event.allDay,
    };

    setEvents((prevEvents) =>
      prevEvents.map((event) => (event.id === updatedEvent.id ? updatedEvent : event))
    );
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
        />
      </div>
    </div>
  );
};

export default Calendar;
