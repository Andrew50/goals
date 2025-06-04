import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { Goal } from '../../types/goals';
import './EventMenu.css';

interface EventMenuProps {
    event: Goal;
    parent?: Goal;
    onAction: (action: string) => void;
    onClose: () => void;
}

interface EventMenuComponent extends React.FC<EventMenuProps> {
    open: (event: Goal, parent: Goal | undefined, onAction: (action: string) => void) => void;
    close: () => void;
}

const EventMenuBase: React.FC<EventMenuProps> = ({ event, parent, onAction, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    useEffect(() => {
        // Position the menu at the center of the screen
        const x = window.innerWidth / 2 - 150; // Assuming menu width ~300px
        const y = window.innerHeight / 2 - 100; // Assuming menu height ~200px
        setPosition({ x, y });

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

    const handleAction = (action: string) => {
        onAction(action);
        onClose();
    };

    return ReactDOM.createPortal(
        <div className="event-menu-overlay">
            <div
                className="event-menu"
                ref={menuRef}
                style={{ left: position.x, top: position.y }}
            >
                <div className="event-menu-header">
                    <h3>{event.name}</h3>
                    {parent && (
                        <div className="event-parent-info">
                            {parent.goal_type}: {parent.name}
                        </div>
                    )}
                </div>

                <div className="event-menu-actions">
                    <button
                        className="event-menu-action complete"
                        onClick={() => handleAction('complete')}
                        disabled={event.completed}
                    >
                        <i className="icon-check"></i>
                        {event.completed ? 'Completed' : 'Complete Event'}
                    </button>

                    <button
                        className="event-menu-action split"
                        onClick={() => handleAction('split')}
                    >
                        <i className="icon-split"></i>
                        Split Event
                    </button>

                    <button
                        className="event-menu-action delete"
                        onClick={() => handleAction('delete')}
                    >
                        <i className="icon-delete"></i>
                        Delete Event
                    </button>

                    <button
                        className="event-menu-action edit"
                        onClick={() => handleAction('edit')}
                    >
                        <i className="icon-edit"></i>
                        Edit Event
                    </button>
                </div>

                <div className="event-menu-info">
                    <div className="info-item">
                        <span className="label">Duration:</span>
                        <span className="value">{event.duration} minutes</span>
                    </div>
                    {event.parent_type === 'routine' && event.routine_instance_id && (
                        <div className="info-item">
                            <span className="label">Type:</span>
                            <span className="value">Routine Event</span>
                        </div>
                    )}
                </div>

                <div className="event-menu-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Static methods for opening the modal
let currentInstance: (() => void) | null = null;
let currentRoot: Root | null = null;

const EventMenu = EventMenuBase as EventMenuComponent;

EventMenu.open = (event: Goal, parent: Goal | undefined, onAction: (action: string) => void) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const cleanup = () => {
        if (currentRoot) {
            currentRoot.unmount();
            currentRoot = null;
        }
        document.body.removeChild(container);
        currentInstance = null;
    };

    currentInstance = cleanup;

    // Use createRoot instead of ReactDOM.render
    currentRoot = createRoot(container);
    currentRoot.render(
        <EventMenuBase
            event={event}
            parent={parent}
            onAction={onAction}
            onClose={cleanup}
        />
    );
};

EventMenu.close = () => {
    if (currentInstance) {
        currentInstance();
    }
};

export default EventMenu; 