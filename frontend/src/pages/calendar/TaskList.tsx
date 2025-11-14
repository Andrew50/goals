import React, { useEffect, useMemo, useState } from 'react';
import { useDrop } from 'react-dnd';
import { CalendarTask, CalendarEvent, Goal } from '../../types/goals';
import { getGoalStyle } from '../../shared/styles/colors';
import { useGoalMenu } from '../../shared/contexts/GoalMenuContext';
import { fetchCalendarData } from './calendarData';
import { timestampToDisplayString } from '../../shared/utils/time';
import { SearchBar } from '../../shared/components/SearchBar';

interface TaskListProps {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  onAddTask: () => void;
  onTaskUpdate: (data: { events: CalendarEvent[]; tasks: CalendarTask[] }) => void;
}

interface TaskWithEventInfo extends CalendarTask {
  eventCount: number;
  completedEventCount: number;
  nextEventDate?: Date;
  isOverdue?: boolean;
  isFutureStart?: boolean;
}

/**
 * Represents a single Task item that FullCalendar will see
 * as an external event via the .external-event class.
 */
const DraggableTask: React.FC<{
  task: TaskWithEventInfo;
  onTaskUpdate: TaskListProps['onTaskUpdate'];
}> = ({ task, onTaskUpdate }) => {
  const { openGoalMenu } = useGoalMenu();
  const { goal } = task;

  const formatDate = (timestamp?: Date) => {
    if (!timestamp) return '';
    return timestampToDisplayString(timestamp, 'date');
  };

  const isAllDay = goal?.duration === 1440; // e.g. a 24-hour event

  // Left click = view
  const handleClick = () => {
    if (!goal) return;
    openGoalMenu(goal, 'view', async () => {
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
    openGoalMenu(goal, 'edit', async () => {
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
        ...getGoalStyle(goal),
        borderRadius: '8px',
        color: '#ffffff',
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span style={{ fontWeight: 500 }}>{task.title}</span>
        <span style={{
          fontSize: '0.85em',
          opacity: 0.9,
          textTransform: 'capitalize'
        }}>
          {goal?.goal_type}
        </span>
      </div>

      {/* Event Progress */}
      {task.eventCount > 0 && (
        <div style={{
          fontSize: '0.85em',
          opacity: 0.9,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>
            {task.completedEventCount}/{task.eventCount} events complete
          </span>
          {task.completedEventCount > 0 && task.eventCount > 0 && (
            <div style={{
              flex: 1,
              height: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.3)',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${(task.completedEventCount / task.eventCount) * 100}%`,
                height: '100%',
                backgroundColor: 'rgba(255, 255, 255, 0.8)'
              }} />
            </div>
          )}
        </div>
      )}

      {/* Task dates and next event */}
      <div style={{
        fontSize: '0.85em',
        opacity: 0.9,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }}>
        {task.eventCount === 0 && (
          <span style={{
            color: '#ffeb3b',
            fontWeight: 500
          }}>
            ⚠️ No events scheduled
          </span>
        )}
        {task.nextEventDate && (
          <span>Next: {formatDate(task.nextEventDate)}</span>
        )}
        {goal?.start_timestamp && (
          <span style={task.isFutureStart ? { color: 'rgba(255, 255, 255, 0.6)' } : undefined}>
            Start: {formatDate(goal.start_timestamp)}
          </span>
        )}
        {goal?.end_timestamp && (
          <span style={task.isOverdue ? { color: '#ff4d4f', fontWeight: 600 } : undefined}>
            Due: {formatDate(goal.end_timestamp)}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Main TaskList component that:
 * - Renders all active (non-completed) tasks
 * - Provides a "Create Goal" button
 * - Allows dropping scheduled events from the Calendar
 *   back into the TaskList (i.e., "unscheduling" them)
 */
const TaskList = React.forwardRef<HTMLDivElement, TaskListProps>(
  ({ tasks, events, onAddTask, onTaskUpdate }, ref) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchIds, setSearchIds] = useState<Set<number>>(new Set());
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

    const filteredTasks = useMemo(() => {
      const q = searchQuery.trim();
      if (!q) return tasks;
      return tasks.filter(t => t.goal && searchIds.has(t.goal.id));
    }, [tasks, searchQuery, searchIds]);

    // Calculate task event info
    const tasksWithInfo: TaskWithEventInfo[] = useMemo(() => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const now = new Date();
      return filteredTasks.map(task => {
        const taskEvents = events.filter(e =>
          e.goal.parent_id === task.goal?.id &&
          !e.goal.is_deleted
        );

        const completedEvents = taskEvents.filter(e => e.goal.completed);
        const futureEvents = taskEvents
          .filter(e => !e.goal.completed && e.start > new Date())
          .sort((a, b) => a.start.getTime() - b.start.getTime());

        const endTs = task.goal?.end_timestamp
          ? new Date(task.goal.end_timestamp)
          : undefined;
        const startTs = task.goal?.start_timestamp
          ? new Date(task.goal.start_timestamp)
          : undefined;
        const isCompleted = task.goal?.completed ?? false;
        const isOverdue =
          !!endTs && !isCompleted && endTs.getTime() < startOfToday.getTime();
        const isFutureStart =
          !!startTs && startTs.getTime() > now.getTime();

        return {
          ...task,
          eventCount: taskEvents.length,
          completedEventCount: completedEvents.length,
          nextEventDate: futureEvents[0]?.start,
          isOverdue,
          isFutureStart
        };
      });
    }, [filteredTasks, events]);

    // Sort tasks by priority/status
    const sortedTasks = useMemo(() => {
      const priorityRank = (priority?: string): number => {
        switch (priority) {
          case 'high': return 0;
          case 'medium': return 1;
          case 'low': return 2;
          default: return 3; // undefined or other values
        }
      };

      return [...tasksWithInfo].sort((a, b) => {
        // Future-start tasks should be placed at the end, regardless of priority
        if ((a.isFutureStart ?? false) !== (b.isFutureStart ?? false)) {
          return a.isFutureStart ? 1 : -1;
        }

        // Overdue tasks first
        if (a.isOverdue !== b.isOverdue) {
          return a.isOverdue ? -1 : 1;
        }

        // Tasks with no events next
        if (a.eventCount === 0 && b.eventCount > 0) return -1;
        if (b.eventCount === 0 && a.eventCount > 0) return 1;

        // Primary: Completion status (incomplete first)
        const aCompleted = a.goal?.completed || false;
        const bCompleted = b.goal?.completed || false;
        if (aCompleted !== bCompleted) {
          return aCompleted ? 1 : -1; // false (incomplete) comes first
        }

        // Secondary: Priority (high → medium → low → undefined)
        const aPriority = priorityRank(a.goal?.priority);
        const bPriority = priorityRank(b.goal?.priority);
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        // Tertiary: Alphabetical by task title
        const aTitle = a.title || '';
        const bTitle = b.title || '';
        return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
      });
    }, [tasksWithInfo]);

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
          Active Tasks
        </h3>

        <div style={{ marginBottom: '12px' }}>
          <SearchBar
            items={tasks.map(t => t.goal).filter(Boolean) as Goal[]}
            value={searchQuery}
            onChange={setSearchQuery}
            onResults={(_, ids) => setSearchIds(new Set(ids))}
            placeholder="Search tasks…"
            size="md"
            fullWidth
          />
        </div>

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
          Create Goal
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
              {searchQuery.trim() ? 'No matching tasks' : 'No tasks yet'}
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
