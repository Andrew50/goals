//calender.tsx
import React, { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable, DateClickArg, EventReceiveArg, EventResizeStopArg } from '@fullcalendar/interaction';
import { EventClickArg, EventDropArg } from '@fullcalendar/core';
import { Goal, CalendarEvent, CalendarTask } from '../../types/goals';
import { updateGoal } from '../../shared/utils/api';
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import TaskList from './TaskList';
import { dateToTimestamp } from '../../shared/utils/time';
import { useHistoryState } from '../../shared/hooks/useHistoryState';
import './Calendar.css';

interface CalendarState {
  events: CalendarEvent[];
  tasks: CalendarTask[];
}

const Calendar: React.FC = () => {
  const [state, setState] = useHistoryState<CalendarState>(
    {
      events: [],
      tasks: []
    },
    {
      hotkeyScope: 'calendar',
      onUndo: (newState) => {
        console.log('Undid calendar action');
      },
      onRedo: (newState) => {
        console.log('Redid calendar action');
      }
    }
  );

  const calendarRef = useRef<FullCalendar>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadCalendarData = async () => {
      const data = await fetchCalendarData();
      const formattedEvents = [...data.events, ...data.achievements].map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay || false,
      }));

      setState({
        events: formattedEvents,
        tasks: data.unscheduledTasks
      });
    };

    loadCalendarData();
  }, []);

  useEffect(() => {
    if (taskListRef.current) {
      new Draggable(taskListRef.current, {
        itemSelector: '.external-event',
        eventData: (eventEl) => {
          const taskId = eventEl.getAttribute('data-task-id');
          const task = state.tasks.find(t => t.id === taskId);
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
  }, [state.tasks]);

  const handleEventClick = (info: EventClickArg) => {
    const event = state.events.find((e) => e.id === info.event.id);
    if (event && event.goal) {
      GoalMenu.open(event.goal, 'view', async (updatedGoal) => {
        const data = await fetchCalendarData();
        const formattedEvents = [...data.events, ...data.achievements].map((event) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
          allDay: false,
        }));
        setState({
          events: formattedEvents,
          tasks: data.unscheduledTasks
        });
      });
    }
  };

  const handleDateClick = (arg: DateClickArg) => {
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

    GoalMenu.open(tempGoal, 'create', async (updatedGoal) => {
      // After goal creation, refresh calendar data
      const data = await fetchCalendarData();
      const formattedEvents = [...data.events, ...data.achievements].map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay || false,
      }));
      setState({
        events: formattedEvents,
        tasks: data.unscheduledTasks
      });
    });
  };

  const handleEventReceive = async (info: EventReceiveArg) => {
    const task = info.event.extendedProps.task;
    if (!task || !task.goal) {
      console.error('Task or goal information missing');
      info.revert();
      return;
    }
    const start = info.event.start;
    if (!start) {
      console.error('Event start date missing');
      info.revert();
      return;
    }
    const isAllDay = task.goal.duration === 1440;
    const updatedGoal = {
      ...task.goal,
      scheduled_timestamp: dateToTimestamp(start),
    };
    console.log('updatedGoal', updatedGoal);
    try {
      const redoFunction = async () => {
        await updateGoal(task.goal.id, updatedGoal);
      };
      const undoFunction = async () => {
        await updateGoal(task.goal.id, task.goal);
      };
      await redoFunction();
      setState({
        events: [...state.events, {
          id: task.id,
          title: task.title,
          start: start,
          end: isAllDay
            ? new Date(start.setHours(23, 59, 59, 999))
            : new Date(start.getTime() + (task.goal.duration || 60) * 60000),
          goal: updatedGoal,
          type: task.type || 'task',
          allDay: isAllDay,
        }],
        tasks: state.tasks.filter((t) => t.id !== task.id)
      }, undoFunction, redoFunction);
    } catch (error) {
      console.error('Failed to update goal:', error);
      info.revert();
    }
  };

  const handleEventDrop = async (info: EventDropArg) => {
    const existingEvent = state.events.find((e: CalendarEvent) => e.id === info.event.id);
    if (!existingEvent || !existingEvent.goal) {
      console.error('Event drop failed: missing event or goal');
      info.revert();
      return;
    }

    const _start = info.event.start;
    if (!_start) {
      console.error('Event drop failed: missing start date');
      info.revert();
      return;
    }

    let start: number;
    let eventStart: Date;
    let eventEnd: Date;

    const newDuration = (() => {
      if (info.event.allDay) {
        return 1440;
      } else if (existingEvent.goal.duration === 1440) {
        return 60;
      }
      return existingEvent.goal.duration || 60;
    })();

    if (info.event.allDay) {
      // When moving to all-day section
      eventStart = new Date(_start);
      eventStart.setHours(0, 0, 0, 0);
      eventEnd = new Date(_start);
      eventEnd.setHours(23, 59, 59, 999);
      start = dateToTimestamp(eventStart);
    } else {
      // Regular timed event
      eventStart = _start;
      eventEnd = new Date(_start.getTime() + (newDuration * 60000));
      start = dateToTimestamp(eventStart);
    }

    const submissionGoal = {
      ...existingEvent.goal,
      duration: newDuration,
      allDay: info.event.allDay
    };

    if (existingEvent.goal.goal_type === 'routine') {
      submissionGoal.routine_time = start;
      try {
        await updateGoal(existingEvent.goal.id, submissionGoal);
        setState({
          events: state.events.map((event: CalendarEvent) => {
            if (event.goal.id === existingEvent.goal.id) {
              const newStart = new Date(event.start);
              newStart.setHours(_start.getHours(), _start.getMinutes(), _start.getSeconds());
              const newEnd = new Date(newStart);
              const durationInMinutes = submissionGoal.duration;
              newEnd.setMinutes(newStart.getMinutes() + durationInMinutes);

              return {
                ...event,
                start: newStart,
                end: newEnd,
                allDay: info.event.allDay,
                goal: submissionGoal,
              };
            }
            return event;
          }),
          tasks: state.tasks
        });
      } catch (error) {
        console.error('Failed to update routine schedule:', error);
        info.revert();
      }
    } else {
      submissionGoal.scheduled_timestamp = start;
      const updatedEvent: CalendarEvent = {
        ...existingEvent,
        id: info.event.id,
        title: info.event.title,
        start: eventStart,
        end: eventEnd,
        allDay: info.event.allDay,
        goal: submissionGoal,
      };

      try {
        await updateGoal(existingEvent.goal.id, submissionGoal);
        setState({
          events: state.events.map((event: CalendarEvent) =>
            event.id === updatedEvent.id ? updatedEvent : event
          ),
          tasks: state.tasks
        });
      } catch (error) {
        console.error('Failed to update event schedule:', error);
        info.revert();
      }
    }
  };

  const handleEventResize = async (info: EventResizeStopArg) => {
    const existingEvent = state.events.find((e) => e.id === info.event.id);
    if (!existingEvent || !existingEvent.goal || !info.event.start || !info.event.end) {
      console.error('Event resize failed: missing event or goal');
      return;
    }
    const _start = info.event.start;
    const _end = info.event.end;

    const start = Date.UTC(
      _start.getFullYear(),
      _start.getMonth(),
      _start.getDate(),
      _start.getHours(),
      _start.getMinutes(),
      _start.getSeconds()
    );

    const end = Date.UTC(
      _end.getFullYear(),
      _end.getMonth(),
      _end.getDate(),
      _end.getHours(),
      _end.getMinutes(),
      _end.getSeconds()
    );

    const durationInMinutes = Math.round((end - start) / (1000 * 60));
    const submissionGoal = {
      ...existingEvent.goal,
      duration: durationInMinutes,
      scheduled_timestamp: start
    };

    if (existingEvent.goal.goal_type === 'routine') {
      submissionGoal.routine_time = start;
      try {
        await updateGoal(submissionGoal.id, submissionGoal);
        setState({
          events: state.events.map((event) => {
            if (event.goal.id === existingEvent.goal.id) {
              const newStart = new Date(event.start);
              newStart.setHours(_start.getHours(), _start.getMinutes(), _start.getSeconds());
              const newEnd = new Date(newStart);
              newEnd.setMinutes(newStart.getMinutes() + durationInMinutes);

              return {
                ...event,
                start: newStart,
                end: newEnd,
                goal: submissionGoal,
              };
            }
            return event;
          }),
          tasks: state.tasks
        });
      } catch (error) {
        console.error('Failed to update routine duration:', error);
        info.event.setStart(existingEvent.start);
        info.event.setEnd(existingEvent.end);
      }
    } else {
      try {
        await updateGoal(submissionGoal.id, submissionGoal);
        setState({
          events: state.events.map((event) => (event.id === existingEvent.id ? {
            ...existingEvent,
            start: _start,
            end: _end,
            goal: submissionGoal,
          } : event)),
          tasks: state.tasks
        });
      } catch (error) {
        console.error('Failed to update event duration:', error);
        info.event.setStart(existingEvent.start);
        info.event.setEnd(existingEvent.end);
      }
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
      setState({
        events: formattedEvents,
        tasks: data.unscheduledTasks
      });
    });
  };

  /*const handleTaskClick = (task: CalendarTask) => {
    GoalMenu.open(task.goal, 'edit', async (updatedGoal) => {
      const data = await fetchCalendarData();
      const formattedEvents = [...data.events, ...data.achievements].map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay || false,
      }));
      setState({
        events: formattedEvents,
        tasks: data.unscheduledTasks
      });
    });
  };*/

  const handleTaskUpdate = (data: { events: CalendarEvent[], tasks: CalendarTask[] }) => {
    setState(data);
  };


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
          //eventStartEditable={true}
          //eventDurationEditable={true}
          events={state.events}
          dateClick={handleDateClick}
          eventReceive={handleEventReceive}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventResizableFromStart={true}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          allDaySlot={true}
          timeZone="local"
          eventContent={(arg) => {
            const event = state.events.find((e) => e.id === arg.event.id);
            const backgroundColor = event?.goal ? getGoalColor(event.goal) : '#f5f5f5';
            return (
              <>
                <div
                  className="custom-calendar-event"
                  style={{
                    backgroundColor,
                    borderColor: backgroundColor,
                  }}
                  title={event?.goal ? `${event.goal.name} (${event.goal.goal_type})` : arg.event.title}
                >
                  {arg.event.title}
                </div>
              </>
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
              e.preventDefault();
              const fcEvent = info.event;
              const event = state.events.find((e) => e.id === fcEvent.id);
              if (event && event.goal) {
                GoalMenu.open(event.goal, 'edit', async (updatedGoal) => {
                  const data = await fetchCalendarData();
                  const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                    ...event,
                    start: new Date(event.start),
                    end: new Date(event.end),
                  }));
                  setState({
                    events: formattedEvents,
                    tasks: data.unscheduledTasks
                  });
                });
              }
            });
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
