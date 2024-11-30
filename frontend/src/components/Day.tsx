import { privateRequest } from '../utils/api';
import React, { useEffect, useState } from 'react';
import { Goal } from '../types';
import { goalColors } from '../theme/colors';
import GoalMenu from './GoalMenu';
//

const Day: React.FC = () => {
    const [tasks, setTasks] = useState<Goal[]>([]);

    useEffect(() => {
        privateRequest<Goal[]>('day').then((tasks) => {
            setTasks(tasks);
            console.log(tasks);
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
        GoalMenu.open(task, 'view');
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

    return (
        <div className="p-4 max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold mb-6">Today's Tasks</h2>

            <div className="tasks-list space-y-4 mb-8">
                {organizedTasks().todo.map(task => {
                    const goalColor = goalColors[task.goal_type];
                    const timeString = formatTime(task.scheduled_timestamp);
                    return (
                        <div
                            key={task.id}
                            className="flex items-start gap-4 p-4 rounded-lg shadow-sm transition-all hover:shadow-md"
                            style={{
                                borderLeft: `4px solid ${goalColor}`,
                                backgroundColor: `${goalColor}10`,
                            }}
                        >
                            <div
                                className="flex-shrink-0 w-6 h-6 border-2 rounded cursor-pointer hover:bg-gray-100"
                                style={{ borderColor: goalColor }}
                                onClick={() => handleTaskComplete(task)}
                            />

                            <div
                                className="flex-grow cursor-pointer"
                                onClick={() => handleTaskClick(task)}
                                onContextMenu={(e) => handleTaskContextMenu(e, task)}
                            >
                                {timeString && (
                                    <span className="text-sm text-gray-500 mb-1 block">
                                        {timeString}
                                    </span>
                                )}
                                <h3 className="font-bold text-lg mb-2">{task.name}</h3>
                                <p className="text-gray-600 mb-3 text-sm">{task.description}</p>
                                <div className="flex flex-wrap gap-2 text-sm">
                                    <span
                                        className="px-2 py-1 rounded-full text-xs"
                                        style={{
                                            backgroundColor: `${goalColor}30`,
                                            color: goalColor
                                        }}
                                    >
                                        {task.goal_type}
                                    </span>
                                    {task.priority && (
                                        <span className="px-2 py-1 rounded-full bg-gray-100 text-xs">
                                            {task.priority}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {organizedTasks().completed.length > 0 && (
                <>
                    <h2 className="text-xl font-bold mb-4">Completed</h2>
                    <div className="tasks-list space-y-4 opacity-60">
                        {organizedTasks().completed.map(task => {
                            const goalColor = goalColors[task.goal_type];
                            const timeString = formatTime(task.scheduled_timestamp);
                            return (
                                <div
                                    key={task.id}
                                    className="flex items-start gap-4 p-4 rounded-lg shadow-sm transition-all hover:shadow-md"
                                    style={{
                                        borderLeft: `4px solid ${goalColor}`,
                                        backgroundColor: `${goalColor}10`,
                                    }}
                                >
                                    <div
                                        className="flex-shrink-0 w-6 h-6 border-2 rounded cursor-pointer hover:bg-gray-100"
                                        style={{ borderColor: goalColor }}
                                        onClick={() => handleTaskComplete(task)}
                                    />

                                    <div
                                        className="flex-grow cursor-pointer"
                                        onClick={() => handleTaskClick(task)}
                                        onContextMenu={(e) => handleTaskContextMenu(e, task)}
                                    >
                                        {timeString && (
                                            <span className="text-sm text-gray-500 mb-1 block">
                                                {timeString}
                                            </span>
                                        )}
                                        <h3 className="font-bold text-lg mb-2">{task.name}</h3>
                                        <p className="text-gray-600 mb-3 text-sm">{task.description}</p>
                                        <div className="flex flex-wrap gap-2 text-sm">
                                            <span
                                                className="px-2 py-1 rounded-full text-xs"
                                                style={{
                                                    backgroundColor: `${goalColor}30`,
                                                    color: goalColor
                                                }}
                                            >
                                                {task.goal_type}
                                            </span>
                                            {task.priority && (
                                                <span className="px-2 py-1 rounded-full bg-gray-100 text-xs">
                                                    {task.priority}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

export default Day;
