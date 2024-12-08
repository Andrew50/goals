import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import React, { useEffect, useState } from 'react';
import { Goal } from '../../types/goals';
import { goalColors } from '../../shared/styles/colors';
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

        const startTimestamp = today.getTime();
        const endTimestamp = todayEnd.getTime();

        privateRequest<Goal[]>('day', 'GET', {
            params: {
                start: startTimestamp,
                end: endTimestamp
            }
        }).then((tasks) => {
            setTasks(tasks.map(goalToLocal));
        }).catch(error => {
            console.error('Error fetching tasks:', error);
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

    const formatTime = (scheduledTimestamp: number | null | undefined): string => {
        if (!scheduledTimestamp) return '';
        return new Date(scheduledTimestamp).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const organizedTasks = () => {
        const todoTasks = tasks.filter(task => !task.completed);
        const completedTasks = tasks.filter(task => task.completed);

        const sortByScheduled = (a: Goal, b: Goal) => {
            const aTime = a.scheduled_timestamp || 0;
            const bTime = b.scheduled_timestamp || 0;
            return aTime - bTime;
        };

        return {
            todo: todoTasks.sort(sortByScheduled),
            completed: completedTasks.sort(sortByScheduled)
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
            { scheduled_timestamp: today.getTime(), goal_type: 'task' } as Goal,
            'create',
            (newGoal) => {
                if (newGoal.id) {
                    setTasks(prevTasks => [...prevTasks, goalToLocal(newGoal)]);
                }
            }
        );
    };

    return (
        <Box className="day-container">
            <div className="day-header">
                <Typography variant="h4" className="day-title">Today's Tasks</Typography>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleCreateGoal}
                    startIcon={<AddIcon />}
                >
                    New Task
                </Button>
            </div>
            <Box className="completion-status">
                <span>{getCompletionPercentage()}% complete</span>
                <span>({organizedTasks().completed.length}/{tasks.length} tasks)</span>
            </Box>

            <Box className="columns-container">
                <Box className="column todo-column">
                    <Typography variant="h6" className="column-title">To Do</Typography>
                    <div className="tasks-list">
                        {organizedTasks().todo.map(task => {
                            const goalColor = goalColors[task.goal_type];
                            const timeString = formatTime(task.scheduled_timestamp);
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
                                        <div
                                            className="custom-checkbox"
                                            style={{ borderColor: goalColor }}
                                        />
                                    </label>
                                </Paper>
                            );
                        })}
                    </div>
                </Box>

                <Box className="column completed-column">
                    <Typography variant="h6" className="column-title completed">
                        Completed
                    </Typography>
                    <div className="tasks-list completed">
                        {organizedTasks().completed.map(task => {
                            const goalColor = goalColors[task.goal_type];
                            return (
                                <Paper
                                    key={task.id}
                                    className="task-card completed"
                                    style={{
                                        borderLeft: `4px solid ${goalColor}`,
                                    }}
                                >
                                    <div
                                        className="task-content completed"
                                        onClick={() => handleTaskClick(task)}
                                        onContextMenu={(e) => handleTaskContextMenu(e, task)}
                                    >
                                        <Typography variant="body1" className="task-name">
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
                                        <div
                                            className="custom-checkbox checked"
                                            style={{ borderColor: goalColor }}
                                        />
                                    </label>
                                </Paper>
                            );
                        })}
                    </div>
                </Box>
            </Box>
        </Box>
    );
};

export default Day;

