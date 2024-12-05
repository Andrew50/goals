//tasklist.tsx
import { CalendarTask, CalendarEvent } from '../../types/goals';
import { goalColors } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { fetchCalendarData } from './calendarData';
import { useRef, useEffect } from 'react';
import { Goal } from '../../types/goals';
import { Draggable } from '@fullcalendar/interaction';

interface DraggableTaskProps {
    task: CalendarTask;
    //onTaskClick: (task: CalendarTask) => void;
    onTaskUpdate: (data: { events: CalendarEvent[], tasks: CalendarTask[] }) => void;
}

const DraggableTask = ({ task, onTaskUpdate }: DraggableTaskProps) => {

    const handleClick = () => {
        if (task.goal) {
            GoalMenu.open(task.goal, 'view', async (updatedGoal: Goal) => {
                const data = await fetchCalendarData();
                const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                    ...event,
                    start: new Date(event.start),
                    end: new Date(event.end),
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
                    start: new Date(event.start),
                    end: new Date(event.end),
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
            style={{
                marginBottom: '8px',
                padding: '12px 16px',
                backgroundColor: goalColors["task"],
                //border: '1px solid' + goalColors["task"],
                borderRadius: '8px',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
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
            {task.title}
        </div>
    );
};

interface TaskListProps {
    tasks: CalendarTask[];
    onAddTask: () => void;
    //onTaskClick: (task: CalendarTask) => void;
    onTaskUpdate: (data: { events: CalendarEvent[], tasks: CalendarTask[] }) => void;
    ref: React.RefObject<HTMLDivElement>;
}

const TaskList = ({
    tasks,
    onAddTask,
    //onTaskClick,
    onTaskUpdate,
    ref
}: TaskListProps) => {
    return (
        <div
            ref={ref}
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                padding: '16px',
            }}
        >
            <h3 style={{
                margin: '0 0 16px 0',
                color: '#ffffff',
                fontSize: '20px',
                fontWeight: 600,
            }}>Unscheduled Tasks</h3>

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

            <div style={{
                flex: 1,
                overflowY: 'auto',
                marginRight: '-8px',
                paddingRight: '8px'
            }}>
                {tasks.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: '14px'
                    }}>
                        No tasks yet
                    </div>
                ) : (
                    tasks.map((task) => (
                        <DraggableTask
                            key={task.id}
                            task={task}
                 //           onTaskClick={onTaskClick}
                            onTaskUpdate={onTaskUpdate}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default TaskList;
