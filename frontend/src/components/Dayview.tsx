import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
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
}


const localizer = momentLocalizer(moment);

const MyCalendar: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [newTask, setNewTask] = useState('');

  const handleAddTask = () => {
    if (newTask.trim()) {
      const newTaskObj = {
        id: (tasks.length + 1).toString(),
        title: newTask,
      };
      setTasks([...tasks, newTaskObj]);
      setNewTask(''); 
    }
  };

  const handleDragEnd = (result: DropResult) => {
    console.log(result);
    const { destination, draggableId } = result;
    if (!destination) return;

    // Dragged to the calendar
    if (destination.droppableId === 'calendar') {
      const task = tasks.find((t) => t.id === draggableId);
      if (task) {
        const newEvent: Event = {
          id: task.id,
          title: task.title,
          start: new Date(),
          end: new Date(Date.now() + 3600000),
        };
        setEvents((prevEvents) => [...prevEvents, newEvent]);
      setTasks((prevTasks) => prevTasks.filter((t) => t.id !== draggableId));
      }
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd} enableDefaultSensors>
      <div style={{ display: 'flex' }}>
        {/* Sidebar */}
        <Droppable droppableId="tasks">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              style={{
                width: '20%',
                padding: '10px',
                backgroundColor: '#f0f0f0',
              }}
            >
              <h4>Tasks</h4>
              {/* Input Field and Add Button */}
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
                <button
                  onClick={handleAddTask}
                  style={{
                    width: '100%',
                    padding: '8px',
                    backgroundColor: '#007BFF',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Add Task
                </button>
              </div>
              {tasks.map((task, index) => (
                <Draggable key={task.id} draggableId={task.id} index={index}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      style={{
                        ...provided.draggableProps.style,
                        marginBottom: '8px',
                        padding: '10px',
                        backgroundColor: '#fff',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                      }}
                    >
                      {task.title}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>

        {/* Calendar */}
        <Droppable droppableId="calendar" isDropDisabled={false}>
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              style={{
                flex: 1,
                padding: '10px',
              }}
            >
              <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                style={{ height: '80vh' }}
              />
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    </DragDropContext>
  );
};

export default MyCalendar;
