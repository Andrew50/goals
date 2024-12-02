import React, { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import { EventApi } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable, DateClickArg, EventReceiveArg } from '@fullcalendar/interaction';
import { EventClickArg, EventDropArg } from '@fullcalendar/core';

import { Goal, CalendarEvent, CalendarTask } from '../types';
import { fetchCalendarData } from '../utils/calendarData';
import { goalColors } from '../theme/colors';
import GoalMenu from './GoalMenu';

interface DraggableTaskProps {
    task: CalendarTask;
    onTaskClick: (task: CalendarTask) => void;
}

const DraggableTask = ({ task, onTaskClick }: DraggableTaskProps) => {
    const taskRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (taskRef.current) {
            new Draggable(taskRef.current, {
                eventData: {
                    id: task.id,
                    title: task.title,
                },
            });
        }
    }, [task]);

    const handleClick = () => {
        onTaskClick(task);
    };

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
            ref={taskRef}
            className="fc-event"
            style={{
                marginBottom: '8px',
                padding: '12px 16px',
                backgroundColor: colors.bg,
                border: `2px solid ${colors.border}`,
                borderRadius: '8px',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
            }}
            onClick={handleClick}
        >
            <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: colors.border,
            }} />
            {task.title}
        </div>
    );
};

const TaskList = ({
    tasks,
    onAddTask,
    onTaskClick,
}: {
    tasks: CalendarTask[];
    onAddTask: () => void;
    onTaskClick: (task: CalendarTask) => void;
}) => {
    const taskListRef = useRef<HTMLDivElement>(null);

    return (
        <div
            ref={taskListRef}
            style={{
                width: '300px',
                padding: '20px',
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                margin: '10px',
                height: 'calc(100vh - 40px)',
                overflow: 'auto',
            }}
        >
            <h3 style={{
                margin: '0 0 20px 0',
                color: '#333',
                fontSize: '20px',
                fontWeight: 600,
            }}>Unscheduled Tasks</h3>

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

const MyCalendar: React.FC = () => {
    const [tasks, setTasks] = useState<CalendarTask[]>([]);
    const [events, setEvents] = useState<CalendarEvent[]>([]);

    const calendarRef = useRef<FullCalendar>(null);
    const taskListRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const loadCalendarData = async () => {
            const data = await fetchCalendarData();
            const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                ...event,
                start: new Date(event.start),
                end: new Date(event.end),
                allDay: false
            }));
            setEvents(formattedEvents);
            setTasks(data.unscheduledTasks);
        };

        loadCalendarData();
    }, []);

    useEffect(() => {
        if (taskListRef.current) {
            new Draggable(taskListRef.current, {
                itemSelector: '.fc-event',
                eventData: (eventEl) => {
                    const id = eventEl.getAttribute('data-task-id');
                    const task = tasks.find((t) => t.id.toString() === id);
                    return task ? {
                        id: task.id,
                        title: task.title,
                        extendedProps: { task },
                    } : null;
                },
            });
        }
    }, [tasks]);

    const handleDateClick = (arg: DateClickArg) => {
        // Open GoalMenu or handle date click events
    };

    const handleEventReceive = (info: EventReceiveArg) => {
        const task: CalendarTask = info.event.extendedProps.task;
        const dropDate = info.event.start;

        GoalMenu.open(task.goal, 'edit', async (updatedGoal) => {
            const data = await fetchCalendarData();
            const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                ...event,
                start: new Date(event.start),
                end: new Date(event.end),
                allDay: false
            }));
            setEvents(formattedEvents);
            setTasks(data.unscheduledTasks);
        });
    };

    const handleEventClick = (info: EventClickArg) => {
        const event = events.find((e) => e.id === info.event.id);
        if (event && event.goal) {
            GoalMenu.open(event.goal, 'view', async (updatedGoal) => {
                const data = await fetchCalendarData();
                const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                    ...event,
                    start: new Date(event.start),
                    end: new Date(event.end),
                    allDay: false
                }));
                setEvents(formattedEvents);
                setTasks(data.unscheduledTasks);
            });
        }
    };

    const handleEventDrop = (info: EventDropArg) => {
        const existingEvent = events.find(e => e.id === info.event.id);
        if (!existingEvent) return;

        const updatedEvent: CalendarEvent = {
            ...existingEvent,
            id: info.event.id,
            title: info.event.title,
            start: info.event.start || existingEvent.start,
            end: info.event.end || existingEvent.end,
        };

        setEvents((prevEvents) =>
            prevEvents.map((event) => (event.id === updatedEvent.id ? updatedEvent : event))
        );
    };

    const handleAddTask = () => {
        const tempGoal: Goal = {
            id: 0,
            name: '',
            goal_type: 'task',
            description: '',
            priority: 'medium',
        };

        GoalMenu.open(tempGoal, 'create', async (updatedGoal) => {
            const data = await fetchCalendarData();
            const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                ...event,
                start: new Date(event.start),
                end: new Date(event.end),
                allDay: false
            }));
            setEvents(formattedEvents);
            setTasks(data.unscheduledTasks);
        });
    };

    const handleTaskClick = (task: CalendarTask) => {
        GoalMenu.open(task.goal, 'edit', async (updatedGoal) => {
            const data = await fetchCalendarData();
            const formattedEvents = [...data.events, ...data.achievements].map(event => ({
                ...event,
                start: new Date(event.start),
                end: new Date(event.end),
                allDay: false
            }));
            setEvents(formattedEvents);
            setTasks(data.unscheduledTasks);
        });
    };

    return (
        <div style={{ height: '100vh', display: 'flex' }}>
            <TaskList
                tasks={tasks}
                onAddTask={handleAddTask}
                onTaskClick={handleTaskClick}
            />
            <div style={{ flex: 1, margin: '10px' }}>
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'dayGridMonth,timeGridWeek,timeGridDay',
                    }}
                    initialView="dayGridMonth"
                    editable={true}
                    droppable={true}
                    events={events}
                    dateClick={handleDateClick}
                    eventReceive={handleEventReceive}
                    eventClick={handleEventClick}
                    eventDrop={handleEventDrop}
                    slotMinTime="00:00:00"
                    slotMaxTime="24:00:00"
                    allDaySlot={false}
                    eventContent={(arg) => {
                        const event = events.find((e) => e.id === arg.event.id);
                        const backgroundColor = event?.goal ? goalColors[event.goal.goal_type] : '#f5f5f5';
                        return (
                            <div style={{
                                backgroundColor,
                                padding: '2px 4px',
                                borderRadius: '4px',
                                width: '100%'
                            }}>
                                <div>{arg.event.title}</div>
                            </div>
                        );
                    }}
                    slotDuration="00:30:00"
                    slotLabelInterval="01:00"
                    scrollTime="08:00:00"
                    eventTimeFormat={{
                        hour: 'numeric',
                        minute: '2-digit',
                        meridiem: 'short'
                    }}
                />
            </div>
        </div>
    );
};

export default MyCalendar;
