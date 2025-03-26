//tasklist.tsx
import { CalendarTask, CalendarEvent } from '../../types/goals';
import React, { useEffect } from 'react';
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import { useRef } from 'react';
import { Goal } from '../../types/goals';
import { Draggable } from '@fullcalendar/interaction';
import { useDrop } from 'react-dnd';
import { timestampToDisplayString } from '../../shared/utils/time';

interface DraggableTaskProps {
  task: CalendarTask;
  //onTaskClick: (task: CalendarTask) => void;
  onTaskUpdate: (data: { events: CalendarEvent[], tasks: CalendarTask[] }) => void;
}

const DraggableTask = ({ task, onTaskUpdate }: DraggableTaskProps) => {
  const formatDueDate = (timestamp?: number) => {
    if (!timestamp) return '';
    return timestampToDisplayString(timestamp, 'date');
  };

  const isAllDay = task.goal.duration === 1440;

  // Debug log for task
  console.log(`Rendering task ${task.id}:`, {
    title: task.title,
    isAllDay,
    goalId: task.goal.id,
    goalType: task.goal.goal_type
  });

  const handleClick = () => {
    if (task.goal) {
      GoalMenu.open(task.goal, 'view', async (updatedGoal: Goal) => {
        const data = await fetchCalendarData();
        const formattedEvents = [...data.events, ...data.achievements].map(event => ({
          ...event,
          // Preserve Date objects instead of recreating them to avoid timezone issues
          start: event.start instanceof Date ? event.start : new Date(event.start),
          end: event.end instanceof Date ? event.end : new Date(event.end),
        }));
        onTaskUpdate({
          events: formattedEvents,
          tasks: data.unscheduledTasks
        });
      });
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (task.goal) {
      GoalMenu.open(task.goal, 'edit', async (updatedGoal: Goal) => {
        const data = await fetchCalendarData();
        const formattedEvents = [...data.events, ...data.achievements].map(event => ({
          ...event,
          // Preserve Date objects instead of recreating them to avoid timezone issues
          start: event.start instanceof Date ? event.start : new Date(event.start),
          end: event.end instanceof Date ? event.end : new Date(event.end),
        }));
        onTaskUpdate({
          events: formattedEvents,
          tasks: data.unscheduledTasks
        });
      });
    }
  };

  return (
    <div
      className="external-event"
      data-task-id={task.id}
      data-all-day={isAllDay.toString()}
      data-title={task.title}
      data-goal-id={task.goal.id.toString()}
      style={{
        marginBottom: '8px',
        padding: '12px 16px',
        backgroundColor: getGoalColor(task.goal),
        //border: '1px solid' + goalColors["task"],
        borderRadius: '8px',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        color: '#ffffff',
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/*<div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: '#2196f3',
      }} />*/}
      <span>{task.title}</span>
      {task.goal.end_timestamp && (
        <span style={{
          fontSize: '0.85em',
          opacity: 0.9,
          marginLeft: '8px',
          whiteSpace: 'nowrap'
        }}>
          Due {formatDueDate(task.goal.end_timestamp)}
        </span>
      )}
    </div>
  );
};

interface TaskListProps {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  onAddTask: () => void;
  onTaskUpdate: (data: { events: CalendarEvent[]; tasks: CalendarTask[] }) => void;
}

const TaskList = React.forwardRef<HTMLDivElement, TaskListProps>(
  ({ tasks, events, onAddTask, onTaskUpdate }, ref) => {
    // Add debug logging on mount and when tasks change
    useEffect(() => {
      console.log('===== TASK LIST MOUNTED/UPDATED =====');
      console.log(`TaskList received ${tasks.length} tasks`);
      if (tasks.length > 0) {
        console.log('First few tasks:', tasks.slice(0, 3));
      } else {
        console.log('No tasks received in TaskList component');
      }
    }, [tasks]);

    const [, drop] = useDrop({
      accept: ['calendar-event', 'task'],
      drop: (item: { id: string }) => {
        console.log('Dropping item:', item);
        const taskToUnschedule = events.find((event) => event.id === item.id);
        if (taskToUnschedule) {
          const updatedGoal = {
            ...taskToUnschedule.goal,
            scheduled_timestamp: undefined,
          };
          const updatedTask: CalendarTask = {
            ...taskToUnschedule,
            goal: updatedGoal,
            type: 'task',
          };
          onTaskUpdate({
            events: events.filter((event) => event.id !== item.id),
            tasks: [...tasks, updatedTask],
          });
        }
      },
    });

    /// Sort tasks by due date (end date) descending
    const sortedTasks = tasks.sort((a, b) => {
      const aDueDate = a.goal.end_timestamp ? new Date(a.goal.end_timestamp).getTime() : 0;
      const bDueDate = b.goal.end_timestamp ? new Date(b.goal.end_timestamp).getTime() : 0;
      return bDueDate - aDueDate; // Sort by due date descending
    });

    // Debug log for tasks
    console.log(`TaskList rendering ${tasks.length} tasks:`, tasks);

    return (
      <div
        ref={(node) => {
          drop(node);
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '16px',
        }}
      >
        <h3
          style={{
            margin: '0 0 16px 0',
            color: '#ffffff',
            fontSize: '20px',
            fontWeight: 600,
          }}
        >
          Unscheduled Tasks
        </h3>

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

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            marginRight: '-8px',
            paddingRight: '8px',
          }}
        >
          {sortedTasks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: '14px',
              }}
            >
              No tasks yet
            </div>
          ) : (
            tasks.map((task) => (
              <DraggableTask
                key={task.id || `task-${Date.now()}-${Math.random()}`}
                task={{
                  ...task,
                  // Ensure task has a valid ID
                  id: task.id || `task-${Date.now()}-${Math.random()}`
                }}
                onTaskUpdate={onTaskUpdate}
              />
            ))
          )}
        </div>
      </div>
    );
  }
);

export default TaskList;

