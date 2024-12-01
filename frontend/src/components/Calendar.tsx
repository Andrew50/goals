import React, { useState, useEffect } from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragEndEvent,
  closestCenter,
  DragOverlay
} from '@dnd-kit/core';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { privateRequest } from '../utils/api';
import { Goal, CalendarEvent, CalendarTask } from '../types';
import { fetchCalendarData } from '../utils/calendarData';
import { goalColors } from '../theme/colors';
import GoalMenu from './GoalMenu';
type EventType = 'meeting' | 'task' | 'appointment';
interface SlotInfo {
  start: Date;
  end: Date;
  slots: Date[];
  action: 'select' | 'click' | 'doubleClick';
}
interface DraggableTaskProps {
  task: CalendarTask;
  onTaskClick: (task: CalendarTask, position: { x: number; y: number }) => void;
}

interface RepeatOptions {
  frequency: string;
  days: string[];
  startDate: Date;
}
const localizer = momentLocalizer(moment);
const DraggableTask = ({ task, onTaskClick }: DraggableTaskProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: task
  });
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onTaskClick(task, { x: rect.right + 5, y: rect.top });
  };
  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={{
          opacity: 0.5,
          marginBottom: '8px',
          height: '43px'
        }}
      />
    );
  }
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
      ref={setNodeRef}
      style={{
        ...transform,
        marginBottom: '8px',
        padding: '12px 16px',
        backgroundColor: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: '8px',
        cursor: 'grab',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        transition: 'all 0.2s ease',
        fontSize: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}
      {...listeners}
      {...attributes}
      onClick={handleClick}
    >
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: colors.border
      }} />
      {task.title}
    </div>
  );
};
const TaskList = ({
  tasks,
  onAddTask,
  onTaskClick
}: {
  tasks: CalendarTask[];
  onAddTask: () => void;
  onTaskClick: (task: CalendarTask, position: { x: number; y: number }) => void;
}) => {
  return (
    <div
      style={{
        width: '300px',
        padding: '20px',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        margin: '10px',
        height: 'calc(100vh - 40px)',
        overflow: 'auto'
      }}
    >
      <h3 style={{
        margin: '0 0 20px 0',
        color: '#333',
        fontSize: '20px',
        fontWeight: 600
      }}>Tasks</h3>

      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={onAddTask}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            transition: 'background-color 0.2s',
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1976d2'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2196f3'}
        >
          Add Task
        </button>
      </div>
      <div style={{ marginTop: '20px' }}>
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', fontSize: '14px' }}>
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

const CalendarEventDisplay: React.FC<{ event: CalendarEvent }> = ({ event }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    GoalMenu.open(event.goal, 'view', () => {
      //update event
    });
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    GoalMenu.open(event.goal, 'edit', () => {
      //update event
    });
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleRightClick}
      style={{
        height: '100%',
        width: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        cursor: 'pointer'
      }}
    >
      {event.title}
    </div>
  );
};

interface SelectedTaskState {
  task: CalendarTask;
  position: { x: number; y: number };
  date?: Date;
}

const eventColors: Record<EventType, { backgroundColor: string; color: string }> = {
  meeting: { backgroundColor: '#e3f2fd', color: '#2196f3' },
  task: { backgroundColor: '#f1f8e9', color: '#8bc34a' },
  appointment: { backgroundColor: '#fce4ec', color: '#e91e63' }
};

const CalendarDropArea = ({
  events,
  onDeleteEvent,
  onDropTask,
  onEventClick
}: {
  events: CalendarEvent[];
  onDeleteEvent: (id: string) => void;
  onDropTask: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) => {
  const [currentView, setCurrentView] = useState('month');
  const { setNodeRef, isOver } = useDroppable({
    id: 'calendar'
  });

  const handleSelectSlot = (slotInfo: { start: Date; end: Date }) => {
    onDropTask(slotInfo.start);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1,
        padding: '10px',
        backgroundColor: isOver ? 'rgba(33, 150, 243, 0.1)' : undefined,
        transition: 'background-color 0.2s',
        height: '100%'
      }}
    >
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: '80vh' }}
        components={{
          event: CalendarEventDisplay
        }}
        views={['month', 'week', 'day']}
        defaultView="month"
        view={currentView}
        onView={setCurrentView}
        selectable={true}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={(event: CalendarEvent) => onEventClick(event)}
        step={60}
        eventPropGetter={(event: CalendarEvent, start: Date, end: Date, isSelected: boolean) => {
          const duration = event.goal?.duration || 60;
          const backgroundColor = event.goal ? goalColors[event.goal.goal_type] : '#f5f5f5';

          // Adjust styling based on view
          const baseStyle = {
            backgroundColor: backgroundColor,
            border: `2px solid ${backgroundColor}`,
            borderLeft: `4px solid ${backgroundColor}`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            margin: '1px',
            borderRadius: '4px',
            padding: '2px 4px',
            fontSize: '14px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            zIndex: 1
          };

          // Add height only for week and day views
          if (currentView === 'week' || currentView === 'day') {
            const heightPerHour = 50;
            const height = (duration / 60) * heightPerHour;
            return {
              style: {
                ...baseStyle,
                height: `${height}px`,
                minHeight: `${height}px`,
              }
            };
          }

          // For month view, use minimal height
          return {
            style: {
              ...baseStyle,
              height: '20px',
              minHeight: '20px',
            }
          };
        }}
      />
    </div>
  );
};

const taskDefaults = {
  meeting: { duration: 60, defaultHour: 10 },
  task: { duration: 30, defaultHour: 9 },
  appointment: { duration: 45, defaultHour: 14 },
};

const TaskDragOverlay = ({ task }: { task: CalendarTask | null }) => {
  if (!task) return null;

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
      style={{
        padding: '12px 16px',
        backgroundColor: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: '8px',
        boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
        fontSize: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '280px',
        zIndex: 1000,
        cursor: 'grabbing',
      }}
    >
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: colors.border
      }} />
      {task.title}
    </div>
  );
};

const MyCalendar: React.FC = () => {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [draggedTask, setDraggedTask] = useState<CalendarTask | null>(null);

  useEffect(() => {
    const loadCalendarData = async () => {
      const data = await fetchCalendarData();
      setEvents([...data.events, ...data.achievements]);
      setTasks(data.unscheduledTasks);
    };

    loadCalendarData();
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || over.id !== 'calendar') {
      setDraggedTask(null);
      return;
    }

    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      setDraggedTask(task);
      const dropDate = new Date();
      handleDropTask(dropDate);
    }
  };

  const isDuplicateEvent = (newStart: Date, newEnd: Date, taskId: string): boolean => {
    return events.some(event => {
      if (event.id === taskId) return false;

      const sameDay = event.start.toDateString() === newStart.toDateString();
      const timeOverlap = (
        (newStart >= event.start && newStart < event.end) ||
        (newEnd > event.start && newEnd <= event.end) ||
        (newStart <= event.start && newEnd >= event.end)
      );

      return sameDay && timeOverlap;
    });
  };

  const handleDropTask = (date: Date) => {
    if (!draggedTask) return;

    const defaults = taskDefaults[draggedTask.type] || { defaultHour: 9, duration: 30 };
    const dropDate = new Date(date);
    dropDate.setHours(defaults.defaultHour, 0, 0, 0);

    const endDate = new Date(dropDate);
    endDate.setMinutes(dropDate.getMinutes() + defaults.duration);

    if (isDuplicateEvent(dropDate, endDate, draggedTask.id)) {
      alert('There is already an event scheduled at this time. Please choose a different time.');
      setDraggedTask(null);
      return;
    }

    GoalMenu.open(draggedTask.goal, 'edit', async (updatedGoal) => {
      const data = await fetchCalendarData();
      setEvents([...data.events, ...data.achievements]);
      setTasks(data.unscheduledTasks);
    });

    setDraggedTask(null);
  };

  const handleAddTask = () => {
    // Create a temporary goal object with all required fields
    const tempGoal: Goal = {
      id: 0,
      name: '',
      goal_type: 'task',
      description: '',
      priority: 'medium'
    };

    // Open the goal menu with create mode
    GoalMenu.open(tempGoal, 'create', async (updatedGoal) => {
      // Refresh calendar data after goal creation
      const data = await fetchCalendarData();
      setEvents([...data.events, ...data.achievements]);
      setTasks(data.unscheduledTasks);
    });
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents((prevEvents) => prevEvents.filter((event) => event.id !== eventId));
  };

  const handleTaskClick = (task: CalendarTask, position: { x: number; y: number }) => {
    GoalMenu.open(task.goal, 'edit', async (updatedGoal) => {
      const data = await fetchCalendarData();
      setEvents([...data.events, ...data.achievements]);
      setTasks(data.unscheduledTasks);
    });
  };

  const handleEventClick = (event: CalendarEvent) => {
    if (event.goal) {
      GoalMenu.open(event.goal, 'view', async (updatedGoal) => {
        const data = await fetchCalendarData();
        setEvents([...data.events, ...data.achievements]);
        setTasks(data.unscheduledTasks);
      });
    }
  };

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      <DndContext
        onDragEnd={handleDragEnd}
        onDragStart={(event) => {
          const task = tasks.find(t => t.id === event.active.id);
          setDraggedTask(task || null);
        }}
        onDragCancel={() => setDraggedTask(null)}
      >
        <div style={{ display: 'flex', height: '100vh' }}>
          <TaskList
            tasks={tasks}
            onAddTask={handleAddTask}
            onTaskClick={handleTaskClick}
          />
          <CalendarDropArea
            events={events}
            onDeleteEvent={handleDeleteEvent}
            onDropTask={handleDropTask}
            onEventClick={handleEventClick}
          />
        </div>
        <DragOverlay>
          {draggedTask ? <TaskDragOverlay task={draggedTask} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
export default MyCalendar;