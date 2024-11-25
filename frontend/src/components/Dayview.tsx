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

interface Task {
  id: string;
  title: string;
  type: 'meeting' | 'task' | 'appointment';
}

interface Event {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type?: 'meeting' | 'task' | 'appointment';
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
  onDelete: (options: { deleteAll: boolean }) => void;
  onRepeat: (options: RepeatOptions) => void;
  task: Task;
  isEvent?: boolean;
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
  const {attributes, listeners, setNodeRef, transform, isDragging} = useDraggable({
    id: task.id,
    data: task
  });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    console.log('Task clicked:', task.title);
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
    switch(type) {
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

const CalendarEvent = ({ event }: { event: Event }) => {
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
  isEvent?: boolean;
}

interface CalendarDropAreaProps {
  events: Event[];
  onDeleteEvent: (id: string) => void;
  onDropTask: (date: Date) => void;
  onEventClick: (event: Event) => void;
}

const CalendarDropArea = ({ 
  events, 
  onDeleteEvent, 
  onDropTask,
  onEventClick 
}: CalendarDropAreaProps) => {
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
          event: CalendarEvent
        }}
        views={['month', 'week', 'day']}
        defaultView="month"
        selectable={true}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={(event: Event) => onEventClick(event)}
        step={60}
        eventPropGetter={(event: Event) => {
          const colors = {
            meeting: { backgroundColor: '#e3f2fd', color: '#2196f3' },
            task: { backgroundColor: '#f1f8e9', color: '#8bc34a' },
            appointment: { backgroundColor: '#fce4ec', color: '#e91e63' }
          };
          return {
            style: colors[event.type || 'task']
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
    switch(type) {
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
  task,
  isEvent 
}: TaskActionsMenuProps) => {
  console.log('TaskActionsMenu rendered:', { isOpen, task });
  
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now;
  });
  const [duration, setDuration] = useState(60);
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);
  const [showRepeatOptions, setShowRepeatOptions] = useState(false);
  const [repeatFrequency, setRepeatFrequency] = useState('one-time');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [repeatType, setRepeatType] = useState('one-time');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleRepeatClick = () => {
    setShowRepeatOptions(true);
    setShowDeleteOptions(false);
  };

  const handleTimeSelect = () => {
    const eventStartTime = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      startTime.getHours(),
      startTime.getMinutes()
    );
    
    const eventEndTime = new Date(eventStartTime);
    eventEndTime.setMinutes(eventStartTime.getMinutes() + duration);
    
    onTimeSelect(eventStartTime, eventEndTime);
    onClose();
  };

  const handleDeleteConfirm = (deleteAll: boolean) => {
    onDelete({ deleteAll });
    onClose();
  };

  const handleRepeatConfirm = () => {
    const repeatOptions: RepeatOptions = {
      frequency: repeatFrequency,
      days: selectedDays,
      startDate: new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        startTime.getHours(),
        startTime.getMinutes()
      )
    };
    onRepeat(repeatOptions);
    onClose();
  };

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
      zIndex: 1000,
    }}
    onClick={onClose}
    >
      <div 
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          width: '400px',
        }}
      >
        {showDeleteConfirm ? (
          <div style={{ padding: '24px' }}>
            <h4 style={{ margin: '0 0 16px 0' }}>Delete Event</h4>
            {isEvent && (
              <button
                onClick={() => handleDeleteConfirm(true)}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginBottom: '8px',
                  border: '1px solid #ff4444',
                  borderRadius: '6px',
                  background: 'white',
                  color: '#ff4444',
                  cursor: 'pointer'
                }}
              >
                Delete All Recurring Events
              </button>
            )}
            <button
              onClick={() => handleDeleteConfirm(false)}
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: '8px',
                border: '1px solid #ff4444',
                borderRadius: '6px',
                background: 'white',
                color: '#ff4444',
                cursor: 'pointer'
              }}
            >
              Delete This Event
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #e0e0e0',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        ) : showRepeatOptions ? (
          <div style={{ padding: '24px' }}>
            <h4 style={{ margin: '0 0 16px 0' }}>Repeat Options</h4>
            <select
              value={repeatFrequency}
              onChange={(e) => setRepeatFrequency(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '16px',
                borderRadius: '6px',
                border: '1px solid #e0e0e0'
              }}
            >
              <option value="one-time">One Time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleRepeatConfirm}
                style={{
                  flex: 1,
                  padding: '10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: '#2196f3',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Apply
              </button>
              <button
                onClick={() => setShowRepeatOptions(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ padding: '24px', borderBottom: '1px solid #eee' }}>
              <h3 style={{ margin: '0', fontSize: '20px' }}>{task.title}</h3>
            </div>
            <div style={{ padding: '24px' }}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ 
                  display: 'block', 
                  marginBottom: '8px',
                  color: '#666',
                  fontSize: '14px'
                }}>
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
                    outline: 'none'
                  }}
                />
              </div>

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
                  type="time"
                  value={`${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`}
                  onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(':').map(Number);
                    const newTime = new Date(startTime);
                    newTime.setHours(hours, minutes, 0, 0);
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

              <div style={{ marginBottom: '20px' }}>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
                <button
                  onClick={handleDeleteClick}
                  style={{
                    padding: '10px 20px',
                    border: '1px solid #ff4444',
                    borderRadius: '6px',
                    background: 'white',
                    color: '#ff4444',
                    cursor: 'pointer'
                  }}
                >
                  Delete
                </button>
                <button
                  onClick={() => setShowRepeatOptions(true)}
                  style={{
                    padding: '10px 20px',
                    border: '1px solid #2196f3',
                    borderRadius: '6px',
                    background: 'white',
                    color: '#2196f3',
                    cursor: 'pointer'
                  }}
                >
                  Repeat
                </button>
                <button
                  onClick={() => {
                    const eventStartTime = new Date(selectedDate);
                    eventStartTime.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
                    
                    const eventEndTime = new Date(eventStartTime);
                    eventEndTime.setMinutes(eventStartTime.getMinutes() + duration);
                    
                    onTimeSelect(eventStartTime, eventEndTime);
                  }}
                  style={{
                    padding: '10px 20px',
                    border: 'none',
                    borderRadius: '6px',
                    background: '#2196f3',
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  {isEvent ? 'Update' : 'Schedule'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const MyCalendar: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [newTask, setNewTask] = useState('');
  const [selectedTask, setSelectedTask] = useState<SelectedTaskState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

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
      // Skip comparing with the same event (for rescheduling)
      if (event.id === taskId) return false;
      
      // Check if dates overlap
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

    // Create new event with exact dates
    const newEvent: Event = {
      id: selectedTask.task.id,
      title: selectedTask.task.title,
      start: startTime,
      end: endTime,
      type: selectedTask.task.type
    };

    setEvents(prevEvents => [...prevEvents, newEvent]);
    setTasks(prevTasks => prevTasks.filter(task => task.id !== selectedTask.task.id));
    setSelectedTask(null);
  };

  const handleDropTask = (date: Date) => {
    if (!draggedTask) return;

    const defaults = taskDefaults[draggedTask.type] || { defaultHour: 9, duration: 30 };
    const dropDate = new Date(date);
    dropDate.setHours(defaults.defaultHour, 0, 0, 0);

    // Create tentative end time to check for duplicates
    const endDate = new Date(dropDate);
    endDate.setMinutes(dropDate.getMinutes() + defaults.duration);

    // Check for duplicates
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
      type: 'task', // Default type, you can add UI to select different types
    };

    setTasks([...tasks, newTaskObj]);
    setNewTask('');
  };

  const handleDeleteTask = (taskId: string, options?: { deleteAll: boolean }) => {
    if (options?.deleteAll) {
      // Delete all recurring instances (events that start with the same base ID)
      const baseId = taskId.split('-')[0]; // Get the base ID without the recurring suffix
      setEvents(prevEvents => prevEvents.filter(event => !event.id.startsWith(baseId)));
    } else {
      // Delete only the specific instance
      setEvents(prevEvents => prevEvents.filter(event => event.id !== taskId));
    }
    
    // Remove from tasks list if it exists there
    setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));
    setSelectedTask(null);
  };

  const handleRepeat = (options: RepeatOptions) => {
    if (!selectedTask) return;
    
    const { frequency, startDate } = options;
    const events: Event[] = [];
    
    const createEventDate = (baseDate: Date, daysToAdd: number = 0) => {
      return new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + daysToAdd,
        baseDate.getHours(),
        baseDate.getMinutes(),
        0
      );
    };

    switch (frequency) {
      case 'daily':
        for (let i = 0; i < 30; i++) {
          const eventStartTime = createEventDate(startDate, i);
          const eventEndTime = new Date(eventStartTime);
          eventEndTime.setMinutes(eventStartTime.getMinutes() + 60);

          events.push({
            id: `${selectedTask.task.id}-${i}`,
            title: selectedTask.task.title,
            start: eventStartTime,
            end: eventEndTime,
            type: selectedTask.task.type
          });
        }
        break;

      case 'weekly':
        for (let i = 0; i < 12; i++) {
          const eventStartTime = createEventDate(startDate, i * 7);
          const eventEndTime = new Date(eventStartTime);
          eventEndTime.setMinutes(eventStartTime.getMinutes() + 60);

          events.push({
            id: `${selectedTask.task.id}-week-${i}`,
            title: selectedTask.task.title,
            start: eventStartTime,
            end: eventEndTime,
            type: selectedTask.task.type
          });
        }
        break;

      case 'biweekly':
        for (let i = 0; i < 12; i++) {
          const eventStartTime = createEventDate(startDate, i * 14);
          const eventEndTime = new Date(eventStartTime);
          eventEndTime.setMinutes(eventStartTime.getMinutes() + 60);

          events.push({
            id: `${selectedTask.task.id}-biweek-${i}`,
            title: selectedTask.task.title,
            start: eventStartTime,
            end: eventEndTime,
            type: selectedTask.task.type
          });
        }
        break;

      case 'monthly':
        for (let i = 0; i < 12; i++) {
          const eventStartTime = new Date(startDate);
          eventStartTime.setMonth(eventStartTime.getMonth() + i);
          const eventEndTime = new Date(eventStartTime);
          eventEndTime.setMinutes(eventStartTime.getMinutes() + 60);

          events.push({
            id: `${selectedTask.task.id}-month-${i}`,
            title: selectedTask.task.title,
            start: eventStartTime,
            end: eventEndTime,
            type: selectedTask.task.type
          });
        }
        break;

      case 'yearly':
        for (let i = 0; i < 5; i++) {
          const eventStartTime = new Date(startDate);
          eventStartTime.setFullYear(eventStartTime.getFullYear() + i);
          const eventEndTime = new Date(eventStartTime);
          eventEndTime.setMinutes(eventStartTime.getMinutes() + 60);

          events.push({
            id: `${selectedTask.task.id}-year-${i}`,
            title: selectedTask.task.title,
            start: eventStartTime,
            end: eventEndTime,
            type: selectedTask.task.type
          });
        }
        break;
    }

    setEvents(prevEvents => [...prevEvents, ...events]);
    setTasks(prevTasks => prevTasks.filter(task => task.id !== selectedTask.task.id));
    setSelectedTask(null);
  };

  const handleTaskClick = (task: Task, position: { x: number; y: number }) => {
    console.log('handleTaskClick called:', task.title);
    setSelectedTask({ 
      task, 
      position,
      isEvent: false 
    });
  };

  const handleEventClick = (event: Event) => {
    console.log('handleEventClick called:', event.title);
    const task: Task = {
      id: event.id,
      title: event.title,
      type: event.type || 'task'
    };

    setSelectedTask({
      task,
      position: { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 200 },
      date: event.start,
      isEvent: true
    });
  };

  // Add this to monitor selectedTask changes
  useEffect(() => {
    console.log('selectedTask changed:', selectedTask);
  }, [selectedTask]);

  return (
    <div>
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
            onDeleteEvent={(id) => handleDeleteTask(id)}
            onDropTask={handleDropTask}
            onEventClick={handleEventClick}
          />
        </div>
        
        <DragOverlay>
          {draggedTask ? <TaskDragOverlay task={draggedTask} /> : null}
        </DragOverlay>
      </DndContext>

      {/* TaskActionsMenu outside DndContext to avoid interference */}
      {selectedTask && (
        <TaskActionsMenu
          isOpen={true}
          onClose={() => {
            console.log('Closing TaskActionsMenu');
            setSelectedTask(null);
          }}
          onTimeSelect={(startTime: Date, endTime: Date) => {
            console.log('Time selected:', startTime, endTime);
            handleTimeSelect(startTime, endTime);
          }}
          onDelete={(options) => {
            console.log('Delete requested:', options);
            handleDeleteTask(selectedTask.task.id, options);
          }}
          onRepeat={(options) => {
            console.log('Repeat requested:', options);
            handleRepeat(options);
          }}
          task={selectedTask.task}
          isEvent={selectedTask.isEvent}
        />
      )}
    </div>
  );
};

export default MyCalendar;

