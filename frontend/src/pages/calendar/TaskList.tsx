import React, { useEffect, useMemo } from 'react';
import { useDrop } from 'react-dnd';
import { CalendarTask, CalendarEvent, Goal } from '../../types/goals';
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import { timestampToDisplayString } from '../../shared/utils/time';

interface TaskListProps {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  onAddTask: () => void;
  onTaskUpdate: (data: { events: CalendarEvent[]; tasks: CalendarTask[] }) => void;
}

/**
 * Represents a single Task item that FullCalendar will see
 * as an external event via the .external-event class.
 */
const DraggableTask: React.FC<{
  task: CalendarTask;
  onTaskUpdate: TaskListProps['onTaskUpdate'];
}> = ({ task, onTaskUpdate }) => {
  const { goal } = task;

  const formatDate = (timestamp?: Date) => {
    if (!timestamp) return '';
    return timestampToDisplayString(timestamp, 'date');
  };

  const isAllDay = goal?.duration === 1440; // e.g. a 24-hour event

  // Left click = view
  const handleClick = () => {
    if (!goal) return;
    GoalMenu.open(goal, 'view', async () => {
      // After user closes the "view" menu, reload data
      const data = await fetchCalendarData();
      onTaskUpdate({
        events: data.events,
        tasks: data.unscheduledTasks
      });
    });
  };

  // Right click = edit
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!goal) return;
    GoalMenu.open(goal, 'edit', async () => {
      // After user closes the "edit" menu, reload data
      const data = await fetchCalendarData();
      onTaskUpdate({
        events: data.events,
        tasks: data.unscheduledTasks
      });
    });
  };

  return (
    <div
      className="external-event"
      data-task-id={task.id}
      data-all-day={String(isAllDay)}
      style={{
        marginBottom: '8px',
        padding: '12px 16px',
        backgroundColor: getGoalColor(goal),
        borderRadius: '8px',
        color: '#ffffff',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <span>{task.title}</span>
      <div
        style={{
          fontSize: '0.85em',
          opacity: 0.9,
          marginLeft: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          whiteSpace: 'nowrap'
        }}
      >
        {goal?.start_timestamp && (
          <span>Start {formatDate(goal.start_timestamp)}</span>
        )}
        {goal?.end_timestamp && (
          <span>Due {formatDate(goal.end_timestamp)}</span>
        )}
      </div>
    </div>
  );
};

/**
 * Main TaskList component that:
 * - Renders the unscheduled tasks
 * - Provides an "Add Task" button
 * - Allows dropping scheduled events from the Calendar
 *   back into the TaskList (i.e., "unscheduling" them)
 */
const TaskList = React.forwardRef<HTMLDivElement, TaskListProps>(
  ({ tasks, events, onAddTask, onTaskUpdate }, ref) => {
    /**
     * React DnD drop hook:
     * Accepts drops of type 'calendar-event' or 'task'—depending on how you label them.
     * If a user drags an event from the calendar and drops it here, we "unschedule" it.
     */
    const [, dropRef] = useDrop({
      accept: ['calendar-event', 'task'],
      drop: (item: { id: string }) => {
        // Find the matching event in `events` by ID
        const eventToUnschedule = events.find((ev) => ev.id === item.id);
        if (!eventToUnschedule || !eventToUnschedule.goal) return;

        // "Unschedule" means remove its scheduled_timestamp
        const updatedGoal: Goal = {
          ...eventToUnschedule.goal,
          scheduled_timestamp: undefined
        };

        // Convert that event to a new unscheduled task
        const newTask: CalendarTask = {
          id: eventToUnschedule.id, // or a newly generated ID
          title: eventToUnschedule.title,
          goal: updatedGoal,
          type: 'task' // or your default
        };

        // Remove the event from the calendar list
        const updatedEvents = events.filter((ev) => ev.id !== item.id);
        // Add the newly created unscheduled task
        const updatedTasks = [...tasks, newTask];

        onTaskUpdate({
          events: updatedEvents,
          tasks: updatedTasks
        });
      }
    });

    // Sort tasks by some criterion, e.g., earliest due date at the top, or descending
    const sortedTasks = useMemo(() => {
      return [...tasks].sort((a, b) => {
        const aDue = a.goal?.end_timestamp?.getTime() || 0;
        const bDue = b.goal?.end_timestamp?.getTime() || 0;
        return aDue - bDue; // earliest due date first
      });
    }, [tasks]);

    // Debug or introspection
    useEffect(() => {
      if (!tasks?.length) {
        // console.log('No tasks in TaskList');
      } else {
        // console.log(`TaskList has ${tasks.length} tasks`, tasks);
      }
    }, [tasks]);

    return (
      <div
        ref={(node) => {
          // Attach the react-dnd drop target
          dropRef(node);
          // Also forward this ref up to the parent if needed
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            // @ts-ignore
            ref.current = node;
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '16px'
        }}
      >
        <h3
          style={{
            margin: '0 0 16px 0',
            color: '#ffffff',
            fontSize: '20px',
            fontWeight: 600
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
            marginBottom: '16px'
          }}
        >
          Add Task
        </button>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            marginRight: '-8px',
            paddingRight: '8px'
          }}
        >
          {sortedTasks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: '14px'
              }}
            >
              No tasks yet
            </div>
          ) : (
            sortedTasks.map((task) => (
              <DraggableTask
                key={task.id}
                task={task}
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
