import React, { useState } from 'react';
import { 
  DndContext, 
  useDraggable,
  useDroppable,
  DragEndEvent,
  closestCenter 
} from '@dnd-kit/core';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';

interface Task {
  id: string;
  title: string;
}

interface Event {
  id: string;
  title: string;
  start: Date;
  end: Date;
  onDelete?: (id: string) => void;
}

const localizer = momentLocalizer(moment);

const DraggableTask = ({ task }: { task: Task }) => {
  const {attributes, listeners, setNodeRef, transform} = useDraggable({
    id: task.id,
    data: task
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <div 
      ref={setNodeRef} 
      style={{
        ...style,
        marginBottom: '8px',
        padding: '10px',
        backgroundColor: '#fff',
        border: '1px solid #ccc',
        borderRadius: '4px',
        cursor: 'grab'
      }}
      {...listeners} 
      {...attributes}
    >
      {task.title}
    </div>
  );
};

const TaskList = ({ tasks, onAddTask, newTask, setNewTask }: {
  tasks: Task[];
  onAddTask: () => void;
  newTask: string;
  setNewTask: (value: string) => void;
}) => {
  return (
    <div
      style={{
        width: '20%',
        padding: '10px',
        backgroundColor: '#f0f0f0',
        minHeight: '100px',
      }}
    >
      <h4>Tasks</h4>
      <div style={{ marginBottom: '10px' }}>
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Enter a task"
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '5px',
          }}
        />
        <button onClick={onAddTask}>Add Task</button>
      </div>

      {tasks.map((task) => (
        <DraggableTask key={task.id} task={task} />
      ))}
    </div>
  );
};

const CalendarEvent = ({ event }: { event: Event }) => {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (event.onDelete) {
      event.onDelete(event.id);
    }
  };

  return (
    <div style={{ position: 'relative', padding: '2px 4px' }}>
      {event.title}
      <button 
        onClick={handleDelete}
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 6px',
          color: 'red',
          fontSize: '16px'
        }}
      >
        ×
      </button>
    </div>
  );
};

const CalendarDropArea = ({ events, onDeleteEvent }: { 
  events: Event[],
  onDeleteEvent: (id: string) => void 
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'calendar'
  });

  return (
    <div 
      ref={setNodeRef}
      style={{ 
        flex: 1, 
        padding: '10px',
        backgroundColor: isOver ? 'rgba(0, 255, 0, 0.1)' : undefined,
        transition: 'background-color 0.2s'
      }}
    >
      <Calendar
        localizer={localizer}
        events={events.map(event => ({
          ...event,
          onDelete: onDeleteEvent
        }))}
        startAccessor="start"
        endAccessor="end"
        style={{ height: '80vh' }}
        components={{
          event: CalendarEvent
        }}
      />
    </div>
  );
};

const MyCalendar: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [newTask, setNewTask] = useState('');

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) return;

    // If dropping on calendar
    if (over.id === 'calendar') {
      const task = tasks.find((t) => t.id === active.id);
      if (task) {
        const newEvent: Event = {
          id: task.id,
          title: task.title,
          start: new Date(),
          end: new Date(Date.now() + 3600000),
        };
        setEvents([...events, newEvent]);
        setTasks((prevTasks) => prevTasks.filter((t) => t.id !== task.id));
      }
    }
  };

  const handleAddTask = () => {
    if (!newTask.trim()) return;
    
    const newTaskObj = {
      id: Date.now().toString(),
      title: newTask.trim(),
    };

    setTasks([...tasks, newTaskObj]);
    setNewTask('');
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents((prevEvents) => prevEvents.filter((event) => event.id !== eventId));
  };

  return (
    <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
      <div style={{ display: 'flex' }}>
        <TaskList 
          tasks={tasks}
          onAddTask={handleAddTask}
          newTask={newTask}
          setNewTask={setNewTask}
        />
        <CalendarDropArea 
          events={events} 
          onDeleteEvent={handleDeleteEvent}
        />
      </div>
    </DndContext>
  );
};

export default MyCalendar;
