import { privateRequest, updateEvent } from '../../shared/utils/api';
import { timestampToDisplayString } from '../../shared/utils/time';
import React, { useEffect, useState, useCallback } from 'react';
import { getGoalStyle } from '../../shared/styles/colors';
import { useGoalMenu } from '../../shared/contexts/GoalMenuContext';
import { Box, Typography, Paper, Button, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import TodayIcon from '@mui/icons-material/Today';
import './Day.css';
import '../../shared/styles/badges.css';
import { useSearchParams } from 'react-router-dom';
import CompletionBar from '../../shared/components/CompletionBar';
import { ResolutionStatus } from '../../types/goals';
import ResolutionStatusToggle from '../../shared/components/ResolutionStatusToggle';

// Event type returned from the day endpoint
interface DayEvent {
    id: number;
    name: string;
    description?: string;
    goal_type: 'event';
    priority: string;
    color?: string;
    resolution_status: ResolutionStatus;
    resolved_at?: number;
    scheduled_timestamp: number;
    duration?: number;
    parent_id: number;
    parent_goal_type?: string;
    routine_instance_id?: number;
}

const Day: React.FC = () => {
    const { openGoalMenu } = useGoalMenu();
    const [searchParams] = useSearchParams();
    const [events, setEvents] = useState<DayEvent[]>([]);
    const [currentDate, setCurrentDate] = useState<Date>(new Date());
    const [currentTime, setCurrentTime] = useState<Date>(new Date());

    // Determine if an event is an all-day task
    const isAllDay = (event: DayEvent) => event.duration === 1440;

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

    // Update current time every minute to keep the current time line accurate
    useEffect(() => {
        const updateCurrentTime = () => {
            setCurrentTime(new Date());
        };

        // Update immediately
        updateCurrentTime();

        // Then update every minute
        const interval = setInterval(updateCurrentTime, 60000);

        return () => clearInterval(interval);
    }, []);

    // Handle ?date=YYYY-MM-DD navigation
    useEffect(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            const parsed = new Date(`${dateParam}T00:00:00`);
            if (!isNaN(parsed.getTime())) {
                setCurrentDate(parsed);
            }
        }
    }, [searchParams]);

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

    const handleStatusChange = (event: DayEvent, newStatus: ResolutionStatus) => {
        updateEvent(event.id, {
            resolution_status: newStatus
        }).then(() => {
            setEvents(prevEvents => prevEvents.map(e => {
                if (e.id === event.id) {
                    return { ...e, resolution_status: newStatus };
                }
                return e;
            }));
        }).catch(error => {
            console.error('Error updating status:', error);
        });
    };

    const handleEventClick = (event: DayEvent) => {
        // Convert event to Goal format for GoalMenu
        const eventGoal = {
            id: event.id,
            name: event.name,
            description: event.description,
            goal_type: 'event',
            priority: event.priority,
            scheduled_timestamp: new Date(event.scheduled_timestamp),
            parent_id: event.parent_id,
            parent_type: event.parent_goal_type === 'routine' ? 'routine' : 'task',
            duration: event.duration,
            resolution_status: event.resolution_status, // Ensure status is passed
        };

        openGoalMenu(eventGoal as any, 'view', (updatedGoal) => {
            fetchEventsForDate(currentDate);
        });
    };

    const handleEventContextMenu = (e: React.MouseEvent, event: DayEvent) => {
        e.preventDefault();
        // Convert event to Goal format for GoalMenu
        const eventGoal = {
            id: event.id,
            name: event.name,
            description: event.description,
            goal_type: 'event',
            priority: event.priority,
            scheduled_timestamp: new Date(event.scheduled_timestamp),
            parent_id: event.parent_id,
            parent_type: event.parent_goal_type === 'routine' ? 'routine' : 'task',
            duration: event.duration,
            resolution_status: event.resolution_status, // Ensure status is passed
        };

        openGoalMenu(eventGoal as any, 'edit', (updatedGoal) => {
            fetchEventsForDate(currentDate);
        });
    };

    type ResolvedStatus = Exclude<ResolutionStatus, 'pending'>;

    const organizedEvents = () => {
        const todoItems = events.filter(item => item.resolution_status === 'pending');
        const resolvedItems = events.filter(item => item.resolution_status !== 'pending');

        const sortByScheduled = (a: DayEvent, b: DayEvent) => {
            // All-day events (duration = 1440 minutes) should be sorted to the bottom
            const aIsAllDay = isAllDay(a);
            const bIsAllDay = isAllDay(b);

            if (aIsAllDay && !bIsAllDay) return 1; // a goes after b
            if (!aIsAllDay && bIsAllDay) return -1; // a goes before b

            // If both are all-day or both are timed, sort by scheduled time
            const aTime = a.scheduled_timestamp || 0;
            const bTime = b.scheduled_timestamp || 0;
            return aTime - bTime;
        };

        return {
            todo: todoItems.sort(sortByScheduled),
            resolved: {
                completed: resolvedItems.filter(item => item.resolution_status === 'completed').sort(sortByScheduled),
                skipped: resolvedItems.filter(item => item.resolution_status === 'skipped').sort(sortByScheduled),
                failed: resolvedItems.filter(item => item.resolution_status === 'failed').sort(sortByScheduled),
            }
        };
    };

    const getCompletionPercentage = () => {
        // Exclude skipped events from denominator (they don't count toward completion metrics)
        const eligibleEvents = events.filter(event => event.resolution_status !== 'skipped');
        if (eligibleEvents.length === 0) return 0;
        const completed = eligibleEvents.filter(event => event.resolution_status === 'completed').length;
        return Math.round((completed / eligibleEvents.length) * 100);
    };

    // Current time line component
    const CurrentTimeLine = () => {
        const timeString = currentTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        return (
            <div className="current-time-line">
                <div className="current-time-circle"></div>
                <div className="current-time-text">{timeString}</div>
            </div>
        );
    };

    // Function to determine where current time line should appear in a list of events
    const insertCurrentTimeLine = (eventsList: DayEvent[]) => {
        // Only show current time line if viewing today
        if (!isToday(currentDate)) {
            return eventsList.map((event, index) => ({ type: 'event', event, index }));
        }

        const currentTimeStamp = currentTime.getTime();
        const result: Array<{ type: 'event' | 'current-time', event?: DayEvent, index: number }> = [];
        let timeLineInserted = false;

        eventsList.forEach((event, index) => {
            // If current time is before this event and we haven't inserted the line yet
            if (!timeLineInserted && currentTimeStamp < event.scheduled_timestamp) {
                result.push({ type: 'current-time', index: result.length });
                timeLineInserted = true;
            }
            result.push({ type: 'event', event, index: result.length });
        });

        // If we haven't inserted the line yet (current time is after all events), add it at the end
        if (!timeLineInserted) {
            result.push({ type: 'current-time', index: result.length });
        }

        return result;
    };

    const handleCreateGoal = () => {
        // Use current local time-of-day on the selected date instead of midnight
        const now = new Date();
        const scheduled = new Date(currentDate);
        scheduled.setHours(now.getHours(), now.getMinutes(), 0, 0);

        openGoalMenu(
            { scheduled_timestamp: scheduled, goal_type: 'task' } as any,
            'create',
            (newGoal) => {
                fetchEventsForDate(currentDate);
            },
            { autoCreateEventTimestamp: scheduled }
        );
    };

    const organized = organizedEvents();
    const resolvedCounts = {
        completed: organized.resolved.completed.length,
        skipped: organized.resolved.skipped.length,
        failed: organized.resolved.failed.length,
    };
    const resolvedTotalCount = resolvedCounts.completed + resolvedCounts.skipped + resolvedCounts.failed;

    const renderResolvedEvent = (event: DayEvent) => {
        const parentType = event.parent_goal_type === 'routine' ? 'routine' : (event.parent_goal_type === 'task' ? 'task' : undefined);
        const priority = (event.priority === 'high' || event.priority === 'medium' || event.priority === 'low') ? event.priority : undefined;
        const goalStyle = getGoalStyle({ goal_type: 'event', parent_type: parentType, priority, resolution_status: event.resolution_status } as any);
        const timeString = isAllDay(event) ? 'All day' : timestampToDisplayString(new Date(event.scheduled_timestamp), 'time');
        const isCompleted = event.resolution_status === 'completed';

        return (
            <Paper
                key={event.id}
                className="task-card resolved"
            >
                <div
                    className="priority-strip"
                    style={{ backgroundColor: goalStyle.borderColor }}
                />
                <div
                    className="task-content"
                    onClick={() => handleEventClick(event)}
                    onContextMenu={(e) => handleEventContextMenu(e, event)}
                >
                    <div className="task-header">
                        <Typography variant="body1" className={`task-name ${isCompleted ? 'completed' : ''}`}>
                            {event.name}
                        </Typography>
                        {timeString && (
                            <span className="task-time">{timeString}</span>
                        )}
                    </div>
                </div>

                <Box onClick={(e) => e.stopPropagation()}>
                    <ResolutionStatusToggle
                        value={event.resolution_status}
                        onChange={(status) => handleStatusChange(event, status)}
                        ariaLabel="Set event status"
                        dense
                    />
                </Box>
            </Paper>
        );
    };

    const resolvedGroups: Array<{ status: ResolvedStatus; items: DayEvent[] }> = [
        { status: 'completed', items: organized.resolved.completed },
        { status: 'skipped', items: organized.resolved.skipped },
        { status: 'failed', items: organized.resolved.failed },
    ];

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
                        <CompletionBar
                            value={getCompletionPercentage() / 100}
                            hasTasks={events.length > 0}
                            width={60}
                            height={8}
                            title={`${getCompletionPercentage()}%`}
                            style={{ margin: '0 8px' }}
                        />
                        {(() => {
                            const eligibleCount = events.filter(e => e.resolution_status !== 'skipped').length;
                            return <span> • {resolvedCounts.completed} of {eligibleCount} tasks completed</span>;
                        })()}
                    </Box>

                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleCreateGoal}
                        startIcon={<AddIcon />}
                        className="create-task-button"
                        size="medium"
                    >
                        Create New
                    </Button>
                </div>

                <Box className="columns-container">
                    <Box className="column">
                        <div className="column-header">
                            <Typography variant="h6" className="column-title">To Do</Typography>
                            <span className="column-count">{organized.todo.length}</span>
                        </div>
                        <div className="tasks-list">
                            {organized.todo.length === 0 ? (
                                <>
                                    {isToday(currentDate) && <CurrentTimeLine />}
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
                                </>
                            ) : (
                                insertCurrentTimeLine(organized.todo).map((item, index) => {
                                    if (item.type === 'current-time') {
                                        return <CurrentTimeLine key={`current-time-todo-${index}`} />;
                                    }

                                    const event = item.event!;
                                    const parentType = event.parent_goal_type === 'routine' ? 'routine' : (event.parent_goal_type === 'task' ? 'task' : undefined);
                                    const priority = (event.priority === 'high' || event.priority === 'medium' || event.priority === 'low') ? event.priority : undefined;
                                    const goalStyle = getGoalStyle({ goal_type: 'event', parent_type: parentType, priority, resolution_status: event.resolution_status } as any);
                                    const timeString = isAllDay(event) ? 'All day' : timestampToDisplayString(new Date(event.scheduled_timestamp), 'time');
                                    return (
                                        <Paper
                                            key={event.id}
                                            className="task-card"
                                        >
                                            <div 
                                                className="priority-strip" 
                                                style={{ backgroundColor: goalStyle.borderColor }}
                                            />
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

                                            <Box onClick={(e) => e.stopPropagation()}>
                                                <ResolutionStatusToggle
                                                    value={event.resolution_status}
                                                    onChange={(status) => handleStatusChange(event, status)}
                                                    ariaLabel="Set event status"
                                                    dense
                                                />
                                            </Box>
                                        </Paper>
                                    );
                                })
                            )}
                        </div>
                    </Box>

                    <Box className="column">
                        <div className="column-header">
                            <Typography variant="h6" className="column-title resolved">
                                Resolved
                            </Typography>
                            <span className="column-count">{resolvedTotalCount}</span>
                        </div>
                        <div className="tasks-list resolved">
                            {resolvedTotalCount === 0 ? (
                                <div className="empty-state">
                                    <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="empty-state-text">No resolved tasks yet</p>
                                </div>
                            ) : (
                                resolvedGroups.map((group, groupIndex) => {
                                    if (group.items.length === 0) return null;
                                    return (
                                        <div
                                            key={group.status}
                                            className={`resolved-group ${groupIndex > 0 ? 'not-first' : ''}`}
                                        >
                                            {group.items.map(renderResolvedEvent)}
                                        </div>
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

