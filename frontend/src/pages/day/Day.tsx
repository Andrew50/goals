import { privateRequest } from '../../shared/utils/api';
import { timestampToDisplayString } from '../../shared/utils/time';
import React, { useEffect, useState, useCallback } from 'react';
import { getGoalColor } from '../../shared/styles/colors';
import { useGoalMenu } from '../../shared/contexts/GoalMenuContext';
import { Box, Typography, Paper, Button, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import TodayIcon from '@mui/icons-material/Today';
import './Day.css';

// Event type returned from the day endpoint
interface DayEvent {
    id: number;
    name: string;
    description?: string;
    goal_type: string;
    priority: string;
    color?: string;
    completed: boolean;
    scheduled_timestamp: number;
    goal_id: number;
    recurrence_pattern?: string;
}

const Day: React.FC = () => {
    const { openGoalMenu } = useGoalMenu();
    const [events, setEvents] = useState<DayEvent[]>([]);
    const [currentDate, setCurrentDate] = useState<Date>(new Date());

    // Helper function to get start and end of a given date
    const getDayBounds = (date: Date) => {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    };

    // Helper function to check if a date is today
    const isToday = (date: Date) => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    // Helper function to format date for display
    const formatDateForDisplay = (date: Date) => {
        if (isToday(date)) {
            return "Today's Tasks";
        }

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday's Tasks";
        }

        if (date.toDateString() === tomorrow.toDateString()) {
            return "Tomorrow's Tasks";
        }

        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    };

    // Function to fetch events for a specific date
    const fetchEventsForDate = useCallback((date: Date) => {
        const { start, end } = getDayBounds(date);

        privateRequest<DayEvent[]>('day', 'GET', undefined, {
            start: start.getTime(),
            end: end.getTime()
        }).then((dayEvents) => {
            setEvents(dayEvents);
        }).catch(error => {
            console.error('Error fetching events:', error);
        });
    }, []);

    useEffect(() => {
        fetchEventsForDate(currentDate);
    }, [currentDate, fetchEventsForDate]);

    // Navigation functions
    const goToPreviousDay = useCallback(() => {
        const previousDay = new Date(currentDate);
        previousDay.setDate(previousDay.getDate() - 1);
        setCurrentDate(previousDay);
    }, [currentDate]);

    const goToNextDay = useCallback(() => {
        const nextDay = new Date(currentDate);
        nextDay.setDate(nextDay.getDate() + 1);
        setCurrentDate(nextDay);
    }, [currentDate]);

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                goToPreviousDay();
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                goToNextDay();
            } else if (event.key === 't' || event.key === 'T') {
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    goToToday();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goToNextDay, goToPreviousDay]);

    const handleEventComplete = (event: DayEvent) => {
        privateRequest<void>(
            `day/complete/${event.id}`,
            'PUT'
        ).then(() => {
            setEvents(prevEvents => prevEvents.map(e => {
                if (e.id === event.id) {
                    return { ...e, completed: !e.completed };
                }
                return e;
            }));
        });
    };

    const handleEventClick = (event: DayEvent) => {
        // Convert event to Goal format for GoalMenu
        const goalFormat = {
            id: event.goal_id,
            name: event.name,
            description: event.description,
            goal_type: event.goal_type,
            priority: event.priority,
            color: event.color,
            scheduled_timestamp: new Date(event.scheduled_timestamp),
        };

        openGoalMenu(goalFormat as any, 'view', (updatedGoal) => {
            fetchEventsForDate(currentDate);
        });
    };

    const handleEventContextMenu = (e: React.MouseEvent, event: DayEvent) => {
        e.preventDefault();
        // Convert event to Goal format for GoalMenu
        const goalFormat = {
            id: event.goal_id,
            name: event.name,
            description: event.description,
            goal_type: event.goal_type,
            priority: event.priority,
            color: event.color,
            scheduled_timestamp: new Date(event.scheduled_timestamp),
        };

        openGoalMenu(goalFormat as any, 'edit', (updatedGoal) => {
            fetchEventsForDate(currentDate);
        });
    };

    const organizedEvents = () => {
        const todoItems = events.filter(item => !item.completed);
        const completedItems = events.filter(item => item.completed);

        const sortByScheduled = (a: DayEvent, b: DayEvent) => {
            const aTime = a.scheduled_timestamp || 0;
            const bTime = b.scheduled_timestamp || 0;
            return aTime - bTime;
        };

        return {
            todo: todoItems.sort(sortByScheduled),
            completed: completedItems.sort(sortByScheduled)
        };
    };

    const getCompletionPercentage = () => {
        if (events.length === 0) return 0;
        const completed = events.filter(event => event.completed).length;
        return Math.round((completed / events.length) * 100);
    };

    const handleCreateGoal = () => {
        const { start } = getDayBounds(currentDate);

        openGoalMenu(
            { scheduled_timestamp: start, goal_type: 'task' } as any,
            'create',
            (newGoal) => {
                fetchEventsForDate(currentDate);
            }
        );
    };

    return (
        <Box className="day-container">
            <div className="day-content">
                <div className="day-header">
                    <div className="day-navigation">
                        <IconButton
                            onClick={goToPreviousDay}
                            className="nav-button"
                            title="Previous day (←)"
                        >
                            <ArrowBackIosIcon />
                        </IconButton>

                        <div className="day-title-section">
                            <Typography variant="h4" className="day-title">
                                {formatDateForDisplay(currentDate)}
                            </Typography>
                            {!isToday(currentDate) && (
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={goToToday}
                                    startIcon={<TodayIcon />}
                                    className="today-button"
                                    title="Go to today (Ctrl/Cmd + T)"
                                >
                                    Today
                                </Button>
                            )}
                        </div>

                        <IconButton
                            onClick={goToNextDay}
                            className="nav-button"
                            title="Next day (→)"
                        >
                            <ArrowForwardIosIcon />
                        </IconButton>
                    </div>

                    <Box className="completion-status">
                        <span>{getCompletionPercentage()}% complete</span>
                        <span> • {organizedEvents().completed.length} of {events.length} tasks</span>
                    </Box>
                </div>

                <Box className="columns-container">
                    <Box className="column">
                        <div className="column-header">
                            <Typography variant="h6" className="column-title">To Do</Typography>
                            <span className="column-count">{organizedEvents().todo.length}</span>
                        </div>
                        <div className="tasks-list">
                            {organizedEvents().todo.length === 0 ? (
                                <div className="empty-state">
                                    <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                    </svg>
                                    <p className="empty-state-text">No tasks for today</p>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={handleCreateGoal}
                                        startIcon={<AddIcon />}
                                        size="small"
                                    >
                                        Add Task
                                    </Button>
                                </div>
                            ) : (
                                organizedEvents().todo.map(event => {
                                    const goalColor = getGoalColor({ priority: event.priority, color: event.color } as any);
                                    const timeString = timestampToDisplayString(new Date(event.scheduled_timestamp), 'time');
                                    return (
                                        <Paper
                                            key={event.id}
                                            className="task-card"
                                            style={{
                                                borderLeft: `4px solid ${goalColor}`,
                                            }}
                                        >
                                            <div
                                                className="task-content"
                                                onClick={() => handleEventClick(event)}
                                                onContextMenu={(e) => handleEventContextMenu(e, event)}
                                            >
                                                <div className="task-header">
                                                    <Typography variant="body1" className="task-name">
                                                        {event.name}
                                                    </Typography>
                                                    {timeString && (
                                                        <span className="task-time">{timeString}</span>
                                                    )}
                                                </div>
                                                {event.description && (
                                                    <Typography variant="body2" className="task-description">
                                                        {event.description}
                                                    </Typography>
                                                )}
                                            </div>

                                            <label className="checkbox-container">
                                                <input
                                                    type="checkbox"
                                                    className="hidden-checkbox"
                                                    checked={false}
                                                    onChange={() => handleEventComplete(event)}
                                                />
                                                <div className="custom-checkbox" />
                                            </label>
                                        </Paper>
                                    );
                                })
                            )}
                        </div>
                    </Box>

                    <Box className="column">
                        <div className="column-header">
                            <Typography variant="h6" className="column-title completed">
                                Completed
                            </Typography>
                            <span className="column-count">{organizedEvents().completed.length}</span>
                        </div>
                        <div className="tasks-list completed">
                            {organizedEvents().completed.length === 0 ? (
                                <div className="empty-state">
                                    <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="empty-state-text">No completed tasks yet</p>
                                </div>
                            ) : (
                                organizedEvents().completed.map(event => {
                                    const goalColor = getGoalColor({ priority: event.priority, color: event.color } as any);
                                    return (
                                        <Paper
                                            key={event.id}
                                            className="task-card completed"
                                            style={{
                                                borderLeft: `4px solid ${goalColor}`,
                                            }}
                                        >
                                            <div
                                                className="task-content"
                                                onClick={() => handleEventClick(event)}
                                                onContextMenu={(e) => handleEventContextMenu(e, event)}
                                            >
                                                <Typography variant="body1" className="task-name completed">
                                                    {event.name}
                                                </Typography>
                                            </div>

                                            <label className="checkbox-container">
                                                <input
                                                    type="checkbox"
                                                    className="hidden-checkbox"
                                                    checked={true}
                                                    onChange={() => handleEventComplete(event)}
                                                />
                                                <div className="custom-checkbox checked" />
                                            </label>
                                        </Paper>
                                    );
                                })
                            )}
                        </div>
                    </Box>
                </Box>
            </div>
        </Box>
    );
};

export default Day;

