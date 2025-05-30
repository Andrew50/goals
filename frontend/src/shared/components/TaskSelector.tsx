import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Goal, CalendarTask } from '../../types/goals';
import { getGoalColor } from '../styles/colors';
import './TaskSelector.css';

interface TaskSelectorProps {
    tasks: CalendarTask[];
    onSelect: (task: Goal) => void;
    onClose: () => void;
}

interface TaskSelectorComponent extends React.FC<TaskSelectorProps> {
    open: (tasks: CalendarTask[], onSelect: (task: Goal) => void) => void;
    close: () => void;
}

const TaskSelectorBase: React.FC<TaskSelectorProps> = ({ tasks, onSelect, onClose }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const modalRef = useRef<HTMLDivElement>(null);

    const filteredTasks = tasks.filter(task =>
        task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.goal.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscape);
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    const handleTaskClick = (task: CalendarTask) => {
        onSelect(task.goal);
    };

    return ReactDOM.createPortal(
        <div className="task-selector-overlay">
            <div className="task-selector-modal" ref={modalRef}>
                <div className="task-selector-header">
                    <h2>Select a Task</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="task-selector-search">
                    <input
                        type="text"
                        placeholder="Search tasks..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="task-selector-list">
                    {filteredTasks.length === 0 ? (
                        <div className="no-tasks">No tasks found</div>
                    ) : (
                        filteredTasks.map(task => (
                            <div
                                key={task.id}
                                className="task-selector-item"
                                onClick={() => handleTaskClick(task)}
                                style={{
                                    borderLeftColor: getGoalColor(task.goal)
                                }}
                            >
                                <div className="task-name">{task.title}</div>
                                {task.goal.description && (
                                    <div className="task-description">{task.goal.description}</div>
                                )}
                                <div className="task-info">
                                    <span className="task-type">{task.goal.goal_type}</span>
                                    {task.goal.priority && (
                                        <span className={`task-priority priority-${task.goal.priority}`}>
                                            {task.goal.priority}
                                        </span>
                                    )}
                                    {task.goal.duration && (
                                        <span className="task-duration">{task.goal.duration} min</span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="task-selector-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Static methods for opening the modal
let currentInstance: (() => void) | null = null;

const TaskSelector = TaskSelectorBase as TaskSelectorComponent;

TaskSelector.open = (tasks: CalendarTask[], onSelect: (task: Goal) => void) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const cleanup = () => {
        ReactDOM.unmountComponentAtNode(container);
        document.body.removeChild(container);
        currentInstance = null;
    };

    currentInstance = cleanup;

    ReactDOM.render(
        <TaskSelectorBase
            tasks={tasks}
            onSelect={(task) => {
                onSelect(task);
                cleanup();
            }}
            onClose={cleanup}
        />,
        container
    );
};

TaskSelector.close = () => {
    if (currentInstance) {
        currentInstance();
    }
};

export default TaskSelector; 