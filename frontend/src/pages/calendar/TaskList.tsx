import React, { useEffect, useMemo, useState } from 'react';
import { useDrop } from 'react-dnd';
import { CalendarTask, CalendarEvent, Goal } from '../../types/goals';
import { getGoalStyle } from '../../shared/styles/colors';
import { useGoalMenu } from '../../shared/contexts/GoalMenuContext';
import { fetchCalendarData } from './calendarData';
import { timestampToDisplayString } from '../../shared/utils/time';
import { SearchBar } from '../../shared/components/SearchBar';
import { List, ListItem } from '@mui/material';
import { getTaskEvents } from '../../shared/utils/api';

export interface TaskListProps {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  onAddTask: () => void;
  onTaskUpdate: (data: { events: CalendarEvent[]; tasks: CalendarTask[] }) => void;
  overlapSuggestions?: Array<{
    dateKey: string;
    date: Date;
    count: number;
    samples: Array<{ a: CalendarEvent; b: CalendarEvent }>;
  }>;
  onNavigateDate?: (d: Date) => void;
  onToggleSuggestions?: (visible: boolean) => void;
}

interface TaskWithEventInfo extends CalendarTask {
  eventCount: number;
  completedEventCount: number;
  nextEventDate?: Date;
  isOverdue?: boolean;
  isFutureStart?: boolean;
  pastUncompletedCount: number;
  futureUncompletedCount: number;
}

interface TaskStats {
  eventCount: number;
  completedEventCount: number;
  pastUncompletedCount: number;
  futureUncompletedCount: number;
  nextEventDate?: Date;
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
        <div
          style={{
            flex: 1,
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.3)',
            borderRadius: '2px',
            overflow: 'hidden',
            display: 'flex'
          }}
          aria-label={`Progress: ${task.completedEventCount} completed, ${Math.max(0, task.eventCount - task.completedEventCount - task.futureUncompletedCount)} past uncompleted, ${task.futureUncompletedCount} future uncompleted out of ${task.eventCount}`}
        >
          {task.eventCount === 0 ? (
            <div style={{ width: '100%', height: '100%', backgroundColor: '#ff4d4f' }} />
          ) : (
            <>
              <div style={{
                width: `${(task.completedEventCount / task.eventCount) * 100}%`,
                height: '100%',
                backgroundColor: 'rgba(255, 255, 255, 0.8)'
              }} />
              <div style={{
                width: `${(task.pastUncompletedCount / task.eventCount) * 100}%`,
                height: '100%',
                backgroundColor: 'transparent'
              }} />
              <div style={{
                width: `${(task.futureUncompletedCount / task.eventCount) * 100}%`,
                height: '100%',
                backgroundColor: '#ffeb3b'
              }} />
            </>
          )}
        </div>
      </div>

      {/* Task dates and next event */}
      <div style={{
        fontSize: '0.85em',
        opacity: 0.9,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }}>
        {task.nextEventDate && (
          <span>Next: {formatDate(task.nextEventDate)}</span>
        )}
        {goal?.start_timestamp && (
          <span style={task.isFutureStart ? { color: 'rgba(255, 255, 255, 0.6)' } : undefined}>
            Start: {formatDate(goal.start_timestamp)}
          </span>
        )}
        <span style={task.isOverdue ? { color: '#ff4d4f', fontWeight: 600 } : undefined}>
          Due: {goal?.end_timestamp ? formatDate(goal.end_timestamp) : 'No due date'}
        </span>
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
  ({ tasks, events, onAddTask, onTaskUpdate, overlapSuggestions = [], onNavigateDate, onToggleSuggestions }, ref) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchIds, setSearchIds] = useState<Set<number>>(new Set());
    const [activeTab, setActiveTab] = useState<'tasks' | 'suggestions'>('tasks');
    const [taskStats, setTaskStats] = useState<Record<number, TaskStats>>({});
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

    // Fetch per-task stats from backend so completion counts don't depend on the visible calendar range
    useEffect(() => {
      const goalIds = filteredTasks
        .map(t => t.goal?.id)
        .filter((id): id is number => typeof id === 'number');

      if (goalIds.length === 0) {
        return;
      }

      const uniqueIds = Array.from(new Set(goalIds));
      let cancelled = false;

      const loadStats = async () => {
        try {
          const results = await Promise.all(
            uniqueIds.map(async (goalId) => {
              try {
                const data = await getTaskEvents(goalId);
                return { goalId, data };
              } catch (err) {
                console.error('[TaskList] Failed to fetch task events for goal', goalId, err);
                return null;
              }
            })
          );

          if (cancelled) return;

          setTaskStats((prev) => {
            const next = { ...prev };
            for (const entry of results) {
              if (!entry) continue;
              const { goalId, data } = entry;
              next[goalId] = {
                eventCount: data.event_count,
                completedEventCount: data.completed_event_count,
                pastUncompletedCount: data.past_uncompleted_count,
                futureUncompletedCount: data.future_uncompleted_count,
                nextEventDate: data.next_uncompleted || undefined
              };
            }
            return next;
          });
        } catch (err) {
          console.error('[TaskList] Unexpected error while loading task stats', err);
        }
      };

      loadStats();

      return () => {
        cancelled = true;
      };
    }, [filteredTasks, events]);

    // Calculate task event info
    const tasksWithInfo: TaskWithEventInfo[] = useMemo(() => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const now = new Date();
      return filteredTasks.map(task => {
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

        const goalId = task.goal?.id;
        const stats = typeof goalId === 'number' ? taskStats[goalId] : undefined;

        const eventCount = stats?.eventCount ?? 0;
        const completedEventCount = stats?.completedEventCount ?? 0;
        const futureUncompletedCount = stats?.futureUncompletedCount ?? 0;
        const pastUncompletedCount =
          stats?.pastUncompletedCount ??
          Math.max(0, eventCount - completedEventCount - futureUncompletedCount);
        const nextEventDate = stats?.nextEventDate;

        return {
          ...task,
          eventCount,
          completedEventCount,
          nextEventDate,
          isOverdue,
          isFutureStart,
          pastUncompletedCount,
          futureUncompletedCount
        };
      });
    }, [filteredTasks, taskStats]);

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
        <div style={{ margin: '0 0 12px 0', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => {
              setActiveTab('tasks');
              if (typeof onToggleSuggestions === 'function') {
                onToggleSuggestions(false);
              }
            }}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: activeTab === 'tasks' ? '2px solid #2196f3' : '1px solid #c1c1c1',
              background: activeTab === 'tasks' ? '#e3f2fd' : '#f3f3f3',
              color: '#333333',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            aria-pressed={activeTab === 'tasks'}
          >
            Tasks
          </button>
          <button
            onClick={() => {
              setActiveTab('suggestions');
              if (typeof onToggleSuggestions === 'function') {
                onToggleSuggestions(true);
              }
            }}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: activeTab === 'suggestions' ? '2px solid #2196f3' : '1px solid #c1c1c1',
              background: activeTab === 'suggestions' ? '#e3f2fd' : '#f3f3f3',
              color: '#333333',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            aria-pressed={activeTab === 'suggestions'}
          >
            Suggestions
          </button>
        </div>

        {activeTab === 'tasks' && (
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
        )}

        {activeTab === 'tasks' && (
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
        )}

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            marginRight: '-8px',
            paddingRight: '8px'
          }}
        >
          {activeTab === 'tasks' ? (
            sortedTasks.length === 0 ? (
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
            )
          ) : (
            <div>
              {(!overlapSuggestions || overlapSuggestions.length === 0) ? (
                <div style={{ color: 'rgba(255, 255, 255, 0.9)' }}>No overlaps today or upcoming</div>
              ) : (
                <List dense style={{ padding: 0 }}>
                  {overlapSuggestions.map(row => {
                    const label = `${row.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — ${row.count} overlap${row.count !== 1 ? 's' : ''}`;
                    return (
                      <ListItem
                        key={`suggest-${row.dateKey}`}
                        button
                        onClick={() => onNavigateDate && onNavigateDate(row.date)}
                        style={{ display: 'block', paddingLeft: 0, paddingRight: 0 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                            <span
                              className="goal-type-badge"
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                backgroundColor: '#f5f5f5',
                                fontWeight: 600,
                                maxWidth: '100%',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                              title={label}
                            >
                              {label}
                            </span>
                            {row.samples && row.samples.length > 0 && (
                              <div style={{ marginTop: '4px', display: 'grid', gap: '4px' }}>
                                {row.samples.map((pair, idx) => {
                                  const aColors = getGoalStyle(pair.a.goal, pair.a.parent);
                                  const bColors = getGoalStyle(pair.b.goal, pair.b.parent);
                                  return (
                                    <div key={`pair-${row.dateKey}-${idx}`} style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
                                      <span
                                        className="goal-type-badge"
                                        style={{
                                          display: 'inline-block',
                                          padding: '2px 8px',
                                          borderRadius: '999px',
                                          backgroundColor: aColors.backgroundColor,
                                          color: aColors.textColor,
                                          maxWidth: '45%',
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          border: `1px solid ${aColors.borderColor}`
                                        }}
                                        title={pair.a.title}
                                      >
                                        {pair.a.title}
                                      </span>
                                      <span style={{ opacity: 0.7 }}>×</span>
                                      <span
                                        className="goal-type-badge"
                                        style={{
                                          display: 'inline-block',
                                          padding: '2px 8px',
                                          borderRadius: '999px',
                                          backgroundColor: bColors.backgroundColor,
                                          color: bColors.textColor,
                                          maxWidth: '45%',
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          border: `1px solid ${bColors.borderColor}`
                                        }}
                                        title={pair.b.title}
                                      >
                                        {pair.b.title}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default TaskList;
