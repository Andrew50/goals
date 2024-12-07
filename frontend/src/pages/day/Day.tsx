import { privateRequest, goalToLocal } from '../../shared/utils/api';
import React, { useEffect, useState } from 'react';
import { Goal } from '../../types/goals';
import { goalColors } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
//

const Day: React.FC = () => {
    const [tasks, setTasks] = useState<Goal[]>([]);

    useEffect(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const startTimestamp = today.getTime();
        const endTimestamp = todayEnd.getTime();

        console.log('Frontend timestamps:', {
            start: startTimestamp,
            end: endTimestamp,
            startDate: new Date(startTimestamp).toISOString(),
            endDate: new Date(endTimestamp).toISOString()
        });

        privateRequest<Goal[]>('day', 'GET', {
            params: {
                start: startTimestamp,
                end: endTimestamp
            }
        }).then((tasks) => {
            console.log('Received tasks:', tasks);
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

            setTasks(prevTasks => prevTasks.filter(t => t.id !== task.id));
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

    return (
        <div className="p-4 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold mb-2">Today's Tasks</h2>
            <div className="flex items-center gap-2 mb-4 text-gray-600">
                <span>{getCompletionPercentage()}% complete</span>
                <span>({organizedTasks().completed.length}/{tasks.length} tasks)</span>
            </div>

            <div className="tasks-list space-y-2">
                {organizedTasks().todo.map(task => {
                    const goalColor = goalColors[task.goal_type];
                    const timeString = formatTime(task.scheduled_timestamp);
                    return (
                        <div
                            key={task.id}
                            className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-all border border-gray-100"
                            style={{
                                borderLeft: `4px solid ${goalColor}`,
                            }}
                        >
                            <div
                                className="flex-grow cursor-pointer"
                                onClick={() => handleTaskClick(task)}
                                onContextMenu={(e) => handleTaskContextMenu(e, task)}
                            >
                                <div className="flex items-center gap-2">
                                    <h3 className="font-medium">{task.name}</h3>
                                    {timeString && (
                                        <span className="text-sm text-gray-500">
                                            {timeString}
                                        </span>
                                    )}
                                </div>
                                {task.description && (
                                    <p className="text-gray-600 text-sm mt-1">{task.description}</p>
                                )}
                            </div>

                            <label className="flex-shrink-0 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={false}
                                    onChange={() => handleTaskComplete(task)}
                                />
                                <div 
                                    className="w-4 h-4 border-2 rounded peer-checked:bg-gray-100 hover:bg-gray-50 flex items-center justify-center"
                                    style={{ borderColor: goalColor }}
                                >
                                    {task.completed && (
                                        <svg viewBox="0 0 24 24" className="w-3 h-3 text-gray-600">
                                            <path
                                                fill="currentColor"
                                                d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                            />
                                        </svg>
                                    )}
                                </div>
                            </label>
                        </div>
                    );
                })}
            </div>

            {organizedTasks().completed.length > 0 && (
                <div className="mt-8">
                    <h2 className="text-lg font-bold mb-2 text-gray-500">Completed</h2>
                    <div className="tasks-list space-y-2 opacity-60">
                        {organizedTasks().completed.map(task => {
                            const goalColor = goalColors[task.goal_type];
                            return (
                                <div
                                    key={task.id}
                                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-all border border-gray-100"
                                    style={{
                                        borderLeft: `4px solid ${goalColor}`,
                                    }}
                                >
                                    <div
                                        className="flex-grow cursor-pointer line-through"
                                        onClick={() => handleTaskClick(task)}
                                        onContextMenu={(e) => handleTaskContextMenu(e, task)}
                                    >
                                        <h3 className="font-medium">{task.name}</h3>
                                    </div>

                                    <label className="flex-shrink-0 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={true}
                                            onChange={() => handleTaskComplete(task)}
                                        />
                                        <div 
                                            className="w-4 h-4 border-2 rounded bg-gray-100 hover:bg-gray-50 flex items-center justify-center"
                                            style={{ borderColor: goalColor }}
                                        >
                                            <svg viewBox="0 0 24 24" className="w-3 h-3 text-gray-600">
                                                <path
                                                    fill="currentColor"
                                                    d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                                />
                                            </svg>
                                        </div>
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Day;
