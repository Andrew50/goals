import { privateRequest, updateEvent, expandTaskDateRange, TaskDateValidationError } from '../../shared/utils/api';
import { timestampToDisplayString } from '../../shared/utils/time';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getGoalStyle } from '../../shared/styles/colors';
import { useGoalMenu } from '../../shared/contexts/GoalMenuContext';
import { Box, Typography, Paper, Button, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import TodayIcon from '@mui/icons-material/Today';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import './Day.css';
import '../../shared/styles/badges.css';
import { useSearchParams } from 'react-router-dom';
import CompletionBar from '../../shared/components/CompletionBar';
import { ResolutionStatus } from '../../types/goals';
import ResolutionStatusToggle from '../../shared/components/ResolutionStatusToggle';
import { useDrag, useDrop } from 'react-dnd';

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

    // Default duration for events without duration (60 minutes)
    const DEFAULT_DURATION_MINUTES = 60;

    // Helper functions for event timing
    const getEventStartMs = (event: DayEvent) => event.scheduled_timestamp;
    const getEventDurationMs = (event: DayEvent) => (event.duration ?? DEFAULT_DURATION_MINUTES) * 60_000;
    const getEventEndMs = (event: DayEvent) => getEventStartMs(event) + getEventDurationMs(event);

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

    // Compute new scheduled timestamp based on drop position
    const computeNewTimestamp = (
        draggedEvent: DayEvent,
        anchorType: 'event' | 'now',
        anchorEvent: DayEvent | null,
        position: 'before' | 'after',
        allEvents: DayEvent[]
    ): number => {
        const draggedDurationMs = getEventDurationMs(draggedEvent);
        const currentTimeMs = currentTime.getTime();

        if (anchorType === 'now') {
            // Dropped relative to current time
            if (position === 'after') {
                return currentTimeMs;
            } else {
                // before: schedule so it ends at now
                return currentTimeMs - draggedDurationMs;
            }
        }

        // anchorType === 'event'
        if (!anchorEvent) {
            // End of list: find the last event and schedule after it
            const sortedEvents = [...allEvents].sort((a, b) => getEventStartMs(a) - getEventStartMs(b));
            if (sortedEvents.length > 0) {
                const lastEvent = sortedEvents[sortedEvents.length - 1];
                return getEventEndMs(lastEvent);
            }
            // Fallback: use current time
            return currentTimeMs;
        }

        const anchorStartMs = getEventStartMs(anchorEvent);
        const anchorEndMs = getEventEndMs(anchorEvent);

        if (position === 'after') {
            // Schedule after the anchor event ends
            return anchorEndMs;
        } else {
            // before: prefer placing in the gap by anchoring to the *previous* event's end time,
            // rather than calculating "before this event" by subtracting duration.
            const sortedEvents = [...allEvents].sort((a, b) => getEventStartMs(a) - getEventStartMs(b));
            const anchorIndex = sortedEvents.findIndex(e => e.id === anchorEvent.id);
            
            if (anchorIndex > 0) {
                // There's a previous event - default to after previous (per plan rule)
                const previousEvent = sortedEvents[anchorIndex - 1];
                return getEventEndMs(previousEvent);
            } else {
                // No previous event - snap to the start of the day
                return getDayBounds(currentDate).start.getTime();
            }
        }
    };

    // Helper to check if error is a task date range violation
    const isTaskDateValidationError = (error: any): error is TaskDateValidationError => {
        try {
            // Check if it's already a parsed object
            if (error?.response?.data?.error_type === 'task_date_range_violation') {
                return true;
            }
            // Check if it's a JSON string that needs parsing
            if (typeof error?.response?.data === 'string') {
                try {
                    const parsed = JSON.parse(error.response.data);
                    return parsed?.error_type === 'task_date_range_violation';
                } catch {
                    // If parsing fails, check if the string contains the error type
                    return error.response.data.includes('task_date_range_violation');
                }
            }
            // Check if axios already parsed it but it's nested
            if (error?.response?.data && typeof error.response.data === 'object') {
                return error.response.data.error_type === 'task_date_range_violation';
            }
            return false;
        } catch {
            return false;
        }
    };

    // Helper to extract validation error
    const extractValidationError = (error: any): TaskDateValidationError | null => {
        try {
            // Check if it's already a parsed object
            if (error?.response?.data?.error_type === 'task_date_range_violation') {
                return error.response.data;
            }
            // Check if it's a JSON string that needs parsing
            if (typeof error?.response?.data === 'string') {
                try {
                    const parsed = JSON.parse(error.response.data);
                    if (parsed?.error_type === 'task_date_range_violation') {
                        return parsed;
                    }
                } catch (parseError) {
                    console.warn('Failed to parse error response:', parseError);
                }
            }
            // Check if axios already parsed it but it's nested
            if (error?.response?.data && typeof error.response.data === 'object') {
                if (error.response.data.error_type === 'task_date_range_violation') {
                    return error.response.data;
                }
            }
            return null;
        } catch (e) {
            console.warn('Error extracting validation error:', e);
            return null;
        }
    };

    // Handle drop to reschedule event
    const handleDrop = useCallback(async (
        draggedEvent: DayEvent,
        anchorType: 'event' | 'now',
        anchorEvent: DayEvent | null,
        position: 'before' | 'after'
    ) => {
        const newTimestampMs = computeNewTimestamp(draggedEvent, anchorType, anchorEvent, position, events);
        const newTimestamp = new Date(newTimestampMs);

        try {
            await updateEvent(draggedEvent.id, {
                scheduled_timestamp: newTimestamp,
                move_reason: 'Reordered in Day view'
            });
            // Refresh events
            fetchEventsForDate(currentDate);
        } catch (error: any) {
            console.log('Drop error caught:', error);
            console.log('Error response data:', error?.response?.data);
            console.log('Error response status:', error?.response?.status);
            
            // Check if it's a task date range violation
            if (isTaskDateValidationError(error)) {
                console.log('Detected task date range violation');
                const validationError = extractValidationError(error);
                console.log('Extracted validation error:', validationError);
                
                if (validationError && draggedEvent.parent_id) {
                    try {
                        console.log('Attempting to expand task date range for task:', draggedEvent.parent_id);
                        // Automatically expand the task date range
                        await expandTaskDateRange({
                            task_id: draggedEvent.parent_id,
                            new_start_timestamp: validationError.violation.suggested_task_start
                                ? new Date(validationError.violation.suggested_task_start)
                                : undefined,
                            new_end_timestamp: validationError.violation.suggested_task_end
                                ? new Date(validationError.violation.suggested_task_end)
                                : undefined,
                        });
                        console.log('Task date range expanded, retrying update');
                        // Retry the update
                        await updateEvent(draggedEvent.id, {
                            scheduled_timestamp: newTimestamp,
                            move_reason: 'Reordered in Day view'
                        });
                        // Refresh events
                        fetchEventsForDate(currentDate);
                        return;
                    } catch (expandError) {
                        console.error('Error expanding task date range:', expandError);
                        // Fall through to show error message
                    }
                } else {
                    console.warn('No validation error or parent_id:', { validationError, parent_id: draggedEvent.parent_id });
                }
                // Show user-friendly error message
                const errorMessage = validationError?.message || 'Event cannot be moved outside the task\'s date range.';
                alert(errorMessage);
            } else {
                console.error('Error rescheduling event (not a date range violation):', error);
            }
            // Refresh anyway to get back to correct state
            fetchEventsForDate(currentDate);
        }
    }, [events, currentDate, fetchEventsForDate, currentTime]);

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

    // Draggable event component
    const DraggableEvent: React.FC<{
        event: DayEvent;
        isResolved?: boolean;
        onDrop: (draggedEvent: DayEvent, anchorType: 'event' | 'now', anchorEvent: DayEvent | null, position: 'before' | 'after') => void;
    }> = ({ event, isResolved = false, onDrop }) => {
        const cardRef = useRef<HTMLDivElement | null>(null);
        const [hoverPosition, setHoverPosition] = useState<'before' | 'after' | null>(null);

        const [{ isDragging }, drag, dragPreview] = useDrag({
            type: 'day-event',
            item: { event },
            collect: (monitor) => ({
                isDragging: monitor.isDragging()
            })
        });

        const [{ isOver }, drop] = useDrop({
            accept: 'day-event',
            drop: (item: { event: DayEvent }) => {
                if (item.event.id === event.id) return; // Don't drop on itself
                // Determine position based on hover
                const position = hoverPosition || 'after';
                onDrop(item.event, 'event', event, position);
            },
            hover: (item, monitor) => {
                if (item.event.id === event.id) return;
                // Determine if we're in top or bottom half of the event
                const clientOffset = monitor.getClientOffset();
                if (clientOffset && cardRef.current) {
                    const rect = cardRef.current.getBoundingClientRect();
                    const relativeY = clientOffset.y - rect.top;
                    const midPoint = rect.height / 2;
                    setHoverPosition(relativeY < midPoint ? 'before' : 'after');
                }
            },
            collect: (monitor) => ({
                isOver: monitor.isOver()
            })
        });

        const parentType = event.parent_goal_type === 'routine' ? 'routine' : (event.parent_goal_type === 'task' ? 'task' : undefined);
        const priority = (event.priority === 'high' || event.priority === 'medium' || event.priority === 'low') ? event.priority : undefined;
        const goalStyle = getGoalStyle({ goal_type: 'event', parent_type: parentType, priority, resolution_status: event.resolution_status } as any);
        const timeString = isAllDay(event) ? 'All day' : timestampToDisplayString(new Date(event.scheduled_timestamp), 'time');
        const isCompleted = event.resolution_status === 'completed';

        return (
            <>
                <Paper
                    ref={(node) => {
                        if (node) {
                            (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
                        }
                        dragPreview(node);
                        drop(node);
                    }}
                    className={`task-card ${isResolved ? 'resolved' : ''} ${isDragging ? 'dragging' : ''} ${
                        isOver && hoverPosition === 'before' ? 'drop-indicator-before' : ''
                    } ${
                        isOver && hoverPosition === 'after' ? 'drop-indicator-after' : ''
                    }`}
                    style={{ opacity: isDragging ? 0.5 : 1 }}
                >
                    <div
                        ref={drag}
                        className="drag-handle"
                        style={{ cursor: 'grab' }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <DragIndicatorIcon style={{ fontSize: '20px', color: '#718096' }} />
                    </div>
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
                        {!isResolved && event.description && (
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
            </>
        );
    };

    // Current time line component with built-in drop zones (before/after) without affecting layout
    const CurrentTimeLine: React.FC<{
        onDrop: (draggedEvent: DayEvent, anchorType: 'event' | 'now', anchorEvent: DayEvent | null, position: 'before' | 'after') => void;
    }> = ({ onDrop }) => {
        // Single explicit hitbox so "after now" is always targetable (including end-of-list).
        // Current-time behaves like a zero-duration "event" at the current time for dropping.
        const [{ isOverAfter }, dropAfter] = useDrop({
            accept: 'day-event',
            drop: (item: { event: DayEvent }) => {
                onDrop(item.event, 'now', null, 'after');
            },
            collect: (monitor) => ({
                isOverAfter: monitor.isOver()
            })
        });

        const timeString = currentTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        const showDropAfter = isOverAfter;

        return (
            <div
                className="current-time-line"
            >
                    <div
                        ref={dropAfter}
                        className="current-time-drop-zone current-time-drop-zone--after"
                        aria-hidden="true"
                    />
                    {showDropAfter && <div className="drop-indicator-line drop-indicator-line--after" />}
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

    const renderResolvedEvent = (event: DayEvent, index: number, allEvents: DayEvent[]) => {
        return (
            <DraggableEvent
                key={event.id}
                event={event}
                isResolved={true}
                onDrop={handleDrop}
            />
        );
    };

    const resolvedGroups: Array<{ status: ResolvedStatus; items: DayEvent[] }> = [
        { status: 'completed', items: organized.resolved.completed },
        { status: 'skipped', items: organized.resolved.skipped },
        { status: 'failed', items: organized.resolved.failed },
    ];
    const nonEmptyResolvedGroups = resolvedGroups.filter(group => group.items.length > 0);

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
                                    {isToday(currentDate) && (
                                        <CurrentTimeLine
                                            onDrop={handleDrop}
                                        />
                                    )}
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
                                        return (
                                            <CurrentTimeLine
                                                key={`current-time-todo-${index}`}
                                                onDrop={handleDrop}
                                            />
                                        );
                                    }

                                    const event = item.event!;
                                    return (
                                        <DraggableEvent
                                            key={event.id}
                                            event={event}
                                            isResolved={false}
                                            onDrop={handleDrop}
                                        />
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
                                <>
                                    {                                nonEmptyResolvedGroups.map((group, groupIndex) => {
                                    return (
                                        <div
                                            key={group.status}
                                            className={`resolved-group ${groupIndex > 0 ? 'not-first' : ''}`}
                                        >
                                            {group.items.map((event, index) => {
                                                const allResolved = [...organized.resolved.completed, ...organized.resolved.skipped, ...organized.resolved.failed];
                                                const sortedResolved = allResolved.sort((a, b) => getEventStartMs(a) - getEventStartMs(b));
                                                const eventIndex = sortedResolved.findIndex(e => e.id === event.id);
                                                const previousEvent = eventIndex > 0 ? sortedResolved[eventIndex - 1] : null;
                                                const nextEvent = eventIndex < sortedResolved.length - 1 ? sortedResolved[eventIndex + 1] : null;
                                                return renderResolvedEvent(event, eventIndex, sortedResolved);
                                            })}
                                        </div>
                                    );
                                })}
                                </>
                            )}
                        </div>
                    </Box>
                </Box>
            </div>
        </Box>
    );
};

export default Day;

