import React from 'react';
import { render, screen } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { MemoryRouter } from 'react-router-dom';
import TaskList from './TaskList';
import { getTaskEvents } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    getTaskEvents: jest.fn(() => Promise.reject(new Error('per-task fetch should not run'))),
}));

jest.mock('../../shared/contexts/GoalMenuContext', () => ({
    useGoalMenu: () => ({ openGoalMenu: jest.fn() }),
}));

test('renders sidebar counts from the task payload', () => {
    render(
        <MemoryRouter>
            <DndProvider backend={HTML5Backend}>
                <TaskList
                    tasks={[{
                        id: '1',
                        title: 'Write',
                        type: 'task',
                        eventCount: 2,
                        completedEventCount: 1,
                        pastUncompletedCount: 1,
                        futureUncompletedCount: 0,
                        goal: { id: 1, name: 'Write', goal_type: 'task' },
                    }]}
                    events={[]}
                    onAddTask={() => undefined}
                    onTaskUpdate={() => undefined}
                />
            </DndProvider>
        </MemoryRouter>
    );

    expect(screen.getByText('1/2 events complete')).toBeInTheDocument();
    expect(getTaskEvents).not.toHaveBeenCalled();
});
