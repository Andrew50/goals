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
import { privateRequest } from './frontend/src/utils/api';
import { Goal, CalendarEvent } from './frontend/src/types';
import { fetchCalendarData } from './frontend/src/utils/calendarData';

interface Task {
  id: string;
  title: string;
  type: 'meeting' | 'task' | 'appointment';
}



interface SlotInfo {
  start: Date;
  end: Date;
  slots: Date[];
  action: 'select' | 'click' | 'doubleClick';
}

interface TaskActionsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onTimeSelect: (startTime: Date, endTime: Date) => void;
  onDelete: () => void;
  onRepeat: (options: RepeatOptions) => void;
  task: Task;
}

interface DraggableTaskProps {
  task: Task;
  onTaskClick: (task: Task, position: { x: number; y: number }) => void;
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
  newTask,
  setNewTask,
  onTaskClick
}: {
  tasks: Task[];
  onAddTask: () => void;
  newTask: string;
  setNewTask: (value: string) => void;
  onTaskClick: (task: Task, position: { x: number; y: number }) => void;
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
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Enter a task"
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #e0e0e0',
            marginBottom: '10px',
            fontSize: '14px',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => e.target.style.borderColor = '#2196f3'}
          onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
        />
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

      {tasks.map((task) => (
        <DraggableTask
          key={task.id}
          task={task}
          onTaskClick={onTaskClick}
        />
      ))}
    </div>
  );
};

const CalendarEventDisplay = ({ event }: { event: CalendarEvent }) => {
  return (
    <div style={{
      padding: '2px 4px',
      fontSize: '14px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }}>
      {event.title}
    </div>
  );
};

interface SelectedTaskState {
  task: Task;
  position: { x: number; y: number };
  date?: Date;
}

// Add type definition for valid event types
type EventType = 'meeting' | 'task' | 'appointment';

// Add type definition for the colors object
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
        selectable={true}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={(event: CalendarEvent) => onEventClick(event)}
        step={60}
        eventPropGetter={(event: CalendarEvent) => {
          const eventType = (event.type || 'task') as EventType;
          return {
            style: eventColors[eventType]
          };
        }}
      />
    </div>
  );
};

interface TimeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (startTime: Date, endTime: Date) => void;
  defaultDate: Date;
  taskTitle: string;
}

const TimeSelectionModal = ({ isOpen, onClose, onSave, defaultDate, taskTitle }: TimeSelectionModalProps) => {
  const [startTime, setStartTime] = useState(defaultDate);
  const [duration, setDuration] = useState(60);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '12px',
        width: '400px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <h3 style={{
          margin: '0 0 20px 0',
          color: '#333',
          fontSize: '20px',
          fontWeight: 600
        }}>Schedule: {taskTitle}</h3>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            color: '#666',
            fontSize: '14px'
          }}>
            Start Time:
          </label>
          <input
            type="datetime-local"
            value={startTime.toISOString().slice(0, 16)}
            onChange={(e) => setStartTime(new Date(e.target.value))}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #e0e0e0',
              fontSize: '14px',
              outline: 'none'
            }}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            color: '#666',
            fontSize: '14px'
          }}>
            Duration:
          </label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #e0e0e0',
              fontSize: '14px',
              outline: 'none'
            }}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
          </select>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: '6px',
              border: '1px solid #e0e0e0',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const endTime = new Date(startTime);
              endTime.setMinutes(startTime.getMinutes() + duration);
              onSave(startTime, endTime);
              onClose();
            }}
            style={{
              padding: '10px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#2196f3',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const taskDefaults = {
  meeting: { duration: 60, defaultHour: 10 },
  task: { duration: 30, defaultHour: 9 },
  appointment: { duration: 45, defaultHour: 14 },
};

const TaskDragOverlay = ({ task }: { task: Task | null }) => {
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

const TaskActionsMenu = ({
  isOpen,
  onClose,
  onTimeSelect,
  onDelete,
  onRepeat,
  task
}: TaskActionsMenuProps) => {
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now;
  });
  const [duration, setDuration] = useState(60);
  const [showRepeatOptions, setShowRepeatOptions] = useState(false);
  const [repeatFrequency, setRepeatFrequency] = useState('none');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  const daysOfWeek = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  const handleDayToggle = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  if (!isOpen) return null;

  const handleTimeSelect = () => {
    const endTime = new Date(startTime);
    endTime.setMinutes(startTime.getMinutes() + duration);
    onTimeSelect(startTime, endTime);
    onClose();
  };

  const handleRepeatClick = () => {
    setShowRepeatOptions(true);
  };

  const handleRepeatSelect = () => {
    onRepeat({
      frequency: repeatFrequency,
      days: selectedDays,
      startDate: selectedDate
    });
    setShowRepeatOptions(false);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      {!showRepeatOptions ? (
        // Main Menu
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            width: '400px',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '24px', borderBottom: '1px solid #eee' }}>
            <h3 style={{ margin: '0', color: '#333', fontSize: '20px', fontWeight: 600 }}>
              {task.title}
            </h3>
          </div>

          <div style={{ padding: '24px' }}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                Date:
              </label>
              <input
                type="date"
                value={selectedDate.toISOString().split('T')[0]}
                onChange={(e) => setSelectedDate(new Date(e.target.value))}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid #e0e0e0',
                  fontSize: '14px',
                  outline: 'none',
                  marginBottom: '16px'
                }}
              />

              <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                Start Time:
              </label>
              <input
                type="time"
                value={startTime.toTimeString().slice(0, 5)}
                onChange={(e) => {
                  const [hours, minutes] = e.target.value.split(':');
                  const newTime = new Date(startTime);
                  newTime.setHours(parseInt(hours), parseInt(minutes), 0);
                  setStartTime(newTime);
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid #e0e0e0',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                Duration:
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid #e0e0e0',
                  fontSize: '14px',
                  outline: 'none'
                }}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <button
                onClick={handleRepeatClick}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                🔄 Repeat
              </button>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={onDelete}
                  style={{
                    padding: '10px 20px',
                    border: '1px solid #ff4444',
                    borderRadius: '6px',
                    background: 'white',
                    color: '#ff4444',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  🗑️ Delete
                </button>

                <button
                  onClick={handleTimeSelect}
                  style={{
                    padding: '10px 20px',
                    border: 'none',
                    borderRadius: '6px',
                    background: '#2196f3',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Reschedule
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // Repeat Options Menu
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            width: '400px',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '24px', borderBottom: '1px solid #eee' }}>
            <h3 style={{ margin: '0', color: '#333', fontSize: '20px', fontWeight: 600 }}>
              Set Repeat Options
            </h3>
          </div>

          <div style={{ padding: '24px' }}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                Repeat Frequency:
              </label>
              <select
                value={repeatFrequency}
                onChange={(e) => setRepeatFrequency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid #e0e0e0',
                  fontSize: '14px',
                  outline: 'none',
                  marginBottom: '16px'
                }}
              >
                <option value="none">One-time Event</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>

              {(repeatFrequency === 'weekly' || repeatFrequency === 'biweekly') && (
                <div style={{ marginTop: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    Repeat on Days:
                  </label>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '16px'
                  }}>
                    {daysOfWeek.map(day => (
                      <button
                        key={day}
                        onClick={() => handleDayToggle(day)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '20px',
                          border: '1px solid #e0e0e0',
                          background: selectedDays.includes(day) ? '#2196f3' : 'white',
                          color: selectedDays.includes(day) ? 'white' : '#333',
                          cursor: 'pointer',
                          fontSize: '14px',
                          transition: 'all 0.2s'
                        }}
                      >
                        {day.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setShowRepeatOptions(false)}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Back
              </button>
              <button
                onClick={handleRepeatSelect}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '6px',
                  background: '#2196f3',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Set Repeat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MyCalendar: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [newTask, setNewTask] = useState('');
  const [selectedTask, setSelectedTask] = useState<SelectedTaskState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

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

  const handleTimeSelect = (startTime: Date, endTime: Date) => {
    if (!selectedTask) return;

    if (isDuplicateEvent(startTime, endTime, selectedTask.task.id)) {
      alert('There is already an event scheduled at this time. Please choose a different time.');
      return;
    }

    const newEvent: CalendarEvent = {
      id: selectedTask.task.id,
      title: selectedTask.task.title,
      start: startTime,
      end: endTime,
      type: selectedTask.task.type
    };

    setEvents(prevEvents => [...prevEvents, newEvent]);

    setTasks(prevTasks => prevTasks.filter(task => task.id !== selectedTask.task.id));

    setSelectedTask(null);
    setModalOpen(false);
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

    setSelectedTask({
      task: draggedTask,
      position: { x: 0, y: 0 },
      date: dropDate
    });
    setModalOpen(true);
    setDraggedTask(null);
  };

  const handleAddTask = () => {
    if (!newTask.trim()) return;

    const newTaskObj: Task = {
      id: Date.now().toString(),
      title: newTask.trim(),
      type: 'task',
    };

    setTasks([...tasks, newTaskObj]);
    setNewTask('');
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents((prevEvents) => prevEvents.filter((event) => event.id !== eventId));
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setSelectedTask(null);
  };

  const handleRepeat = (options: RepeatOptions) => {
    if (!selectedTask) return;

    const { frequency, days, startDate } = options;
    const events: CalendarEvent[] = [];

    switch (frequency) {
      case 'daily':
        for (let i = 0; i < 30; i++) {
          const eventDate = new Date(startDate);
          eventDate.setDate(eventDate.getDate() + i);
          events.push({
            id: `${selectedTask.task.id}-${i}`,
            title: selectedTask.task.title,
            start: new Date(eventDate.setHours(startDate.getHours(), startDate.getMinutes())),
            end: new Date(eventDate.setHours(startDate.getHours() + 1)),
            type: selectedTask.task.type
          });
        }
        break;

      case 'weekly':
      case 'biweekly':
        const weekIncrement = frequency === 'weekly' ? 1 : 2;
        for (let week = 0; week < 12; week++) {
          days.forEach(day => {
            const eventDate = new Date(startDate);
            eventDate.setDate(eventDate.getDate() + (getDayNumber(day) - eventDate.getDay()) + (week * 7 * weekIncrement));
            events.push({
              id: `${selectedTask.task.id}-${week}-${day}`,
              title: selectedTask.task.title,
              start: new Date(eventDate.setHours(startDate.getHours(), startDate.getMinutes())),
              end: new Date(eventDate.setHours(startDate.getHours() + 1)),
              type: selectedTask.task.type
            });
          });
        }
        break;

      case 'monthly':
        for (let i = 0; i < 12; i++) {
          const eventDate = new Date(startDate);
          eventDate.setMonth(eventDate.getMonth() + i);
          events.push({
            id: `${selectedTask.task.id}-${i}`,
            title: selectedTask.task.title,
            start: new Date(eventDate.setHours(startDate.getHours(), startDate.getMinutes())),
            end: new Date(eventDate.setHours(startDate.getHours() + 1)),
            type: selectedTask.task.type
          });
        }
        break;

      case 'yearly':
        for (let i = 0; i < 5; i++) {
          const eventDate = new Date(startDate);
          eventDate.setFullYear(eventDate.getFullYear() + i);
          events.push({
            id: `${selectedTask.task.id}-${i}`,
            title: selectedTask.task.title,
            start: new Date(eventDate.setHours(startDate.getHours(), startDate.getMinutes())),
            end: new Date(eventDate.setHours(startDate.getHours() + 1)),
            type: selectedTask.task.type
          });
        }
        break;
    }

    setEvents(prevEvents => [...prevEvents, ...events]);

    setTasks(prevTasks => prevTasks.filter(task => task.id !== selectedTask.task.id));

    setSelectedTask(null);
  };

  const getDayNumber = (day: string): number => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days.indexOf(day);
  };

  const handleTaskClick = (task: Task, position: { x: number; y: number }) => {
    setSelectedTask({ task, position });
  };

  const handleEventClick = (event: CalendarEvent) => {
    const task: Task = {
      id: event.id,
      title: event.title,
      type: event.type || 'task'
    };

    setSelectedTask({
      task,
      position: { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 200 },
      date: event.start
    });
  };

  return (
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
          newTask={newTask}
          setNewTask={setNewTask}
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

      {modalOpen && selectedTask && (
        <TimeSelectionModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSave={handleTimeSelect}
          defaultDate={selectedTask.date || new Date()}
          taskTitle={selectedTask.task.title}
        />
      )}

      {selectedTask && (
        <TaskActionsMenu
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onTimeSelect={handleTimeSelect}
          onDelete={() => {
            handleDeleteTask(selectedTask.task.id);
            setEvents(prev => prev.filter(event => event.id !== selectedTask.task.id));
          }}
          onRepeat={handleRepeat}
          task={selectedTask.task}
        />
      )}
    </DndContext>
  );
};

export default MyCalendar;
