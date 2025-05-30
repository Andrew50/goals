import { privateRequest } from '../../shared/utils/api';
import { goalToLocal, timestampToDisplayString } from '../../shared/utils/time';
import React, { useEffect, useState } from 'react';
import { Goal, ApiGoal } from '../../types/goals'; // Import ApiGoal
import { getGoalColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { Box, Typography, Paper, Button } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import './Day.css';

const Day: React.FC = () => {
    const [tasks, setTasks] = useState<Goal[]>([]);

    useEffect(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const endTimestamp = todayEnd.getTime();
        const startTimestamp = today.getTime();
        //console.log(startTimestamp, endTimestamp);

        // Expect ApiGoal[] from the API
        privateRequest<ApiGoal[]>('day', 'GET', undefined, {
            start: startTimestamp,
            end: endTimestamp
        }).then((apiGoals) => {
            //console.log(apiGoals);
            // Now map ApiGoal[] to Goal[] using goalToLocal
            const localGoals = apiGoals.map(goalToLocal) as Goal[];
            //console.log(localGoals);
            setTasks(localGoals);
        }).catch(error => {
            console.error('Error fetching goals:', error);
        });
    }, []);

    const handleTaskComplete = (task: Goal) => {
        privateRequest<void>(
            `day/complete/${task.id}`,
            'PUT'
        ).then(() => {
            setTasks(prevTasks => prevTasks.map(t => {
                if (t.id === task.id) {
                    return { ...t, completed: !t.completed };
                }
                return t;
            }));
        });
    };

    const handleTaskClick = (task: Goal) => {
        GoalMenu.open(task, 'view', (updatedTask) => {
            setTasks(prevTasks => {
                if (!updatedTask.id) {
                    return prevTasks.filter(t => t.id !== task.id);
                }
                return prevTasks.map(t => t.id === updatedTask.id ? updatedTask : t);
            });
        });
    };

    const handleTaskContextMenu = (event: React.MouseEvent, task: Goal) => {
        event.preventDefault();
        GoalMenu.open(task, 'edit', (updatedTask) => {
            setTasks(prevTasks => {
                if (!updatedTask.id) {
                    return prevTasks.filter(t => t.id !== task.id);
                }
                return prevTasks.map(t => t.id === updatedTask.id ? updatedTask : t);
            });
        });
    };

    const organizedTasks = () => {
        const todoItems = tasks.filter(item => !item.completed);
        const completedItems = tasks.filter(item => item.completed);

        const sortByScheduled = (a: Goal, b: Goal) => {
            const aTime = a.scheduled_timestamp?.getTime() || 0;
            const bTime = b.scheduled_timestamp?.getTime() || 0;
            return aTime - bTime;
        };

        return {
            todo: todoItems.sort(sortByScheduled),
            completed: completedItems.sort(sortByScheduled)
        };
    };

    const getCompletionPercentage = () => {
        if (tasks.length === 0) return 0;
        const completed = tasks.filter(task => task.completed).length;
        return Math.round((completed / tasks.length) * 100);
    };

    const handleCreateGoal = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        GoalMenu.open(
            { scheduled_timestamp: today, goal_type: 'task' } as Goal,
            'create',
            (newGoal) => {
                if (newGoal.id) {
                    setTasks(prevTasks => [...prevTasks, newGoal]);
                }
            }
        );
    };

    return (
        <Box className="day-container">
            <div className="day-content">
                <div className="day-header">
                    <Typography variant="h4" className="day-title">Today's Tasks</Typography>
                    <Box className="completion-status">
                        <span>{getCompletionPercentage()}% complete</span>
                        <span> • {organizedTasks().completed.length} of {tasks.length} tasks</span>
                    </Box>
                </div>

                <Box className="columns-container">
                    <Box className="column">
                        <div className="column-header">
                            <Typography variant="h6" className="column-title">To Do</Typography>
                            <span className="column-count">{organizedTasks().todo.length}</span>
                        </div>
                        <div className="tasks-list">
                            {organizedTasks().todo.length === 0 ? (
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
                                organizedTasks().todo.map(task => {
                                    const goalColor = getGoalColor(task);
                                    const timeString = timestampToDisplayString(task.scheduled_timestamp, 'time');
                                    return (
                                        <Paper
                                            key={task.id}
                                            className="task-card"
                                            style={{
                                                borderLeft: `4px solid ${goalColor}`,
                                            }}
                                        >
                                            <div
                                                className="task-content"
                                                onClick={() => handleTaskClick(task)}
                                                onContextMenu={(e) => handleTaskContextMenu(e, task)}
                                            >
                                                <div className="task-header">
                                                    <Typography variant="body1" className="task-name">
                                                        {task.name}
                                                    </Typography>
                                                    {timeString && (
                                                        <span className="task-time">{timeString}</span>
                                                    )}
                                                </div>
                                                {task.description && (
                                                    <Typography variant="body2" className="task-description">
                                                        {task.description}
                                                    </Typography>
                                                )}
                                            </div>

                                            <label className="checkbox-container">
                                                <input
                                                    type="checkbox"
                                                    className="hidden-checkbox"
                                                    checked={false}
                                                    onChange={() => handleTaskComplete(task)}
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
                            <span className="column-count">{organizedTasks().completed.length}</span>
                        </div>
                        <div className="tasks-list completed">
                            {organizedTasks().completed.length === 0 ? (
                                <div className="empty-state">
                                    <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="empty-state-text">No completed tasks yet</p>
                                </div>
                            ) : (
                                organizedTasks().completed.map(task => {
                                    const goalColor = getGoalColor(task);
                                    return (
                                        <Paper
                                            key={task.id}
                                            className="task-card completed"
                                            style={{
                                                borderLeft: `4px solid ${goalColor}`,
                                            }}
                                        >
                                            <div
                                                className="task-content"
                                                onClick={() => handleTaskClick(task)}
                                                onContextMenu={(e) => handleTaskContextMenu(e, task)}
                                            >
                                                <Typography variant="body1" className="task-name completed">
                                                    {task.name}
                                                </Typography>
                                            </div>

                                            <label className="checkbox-container">
                                                <input
                                                    type="checkbox"
                                                    className="hidden-checkbox"
                                                    checked={true}
                                                    onChange={() => handleTaskComplete(task)}
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

