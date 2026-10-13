import React, { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { MemoryRouter } from 'react-router-dom';
import TaskList from './TaskList';
import { getTaskEvents } from '../../shared/utils/api';
import { CalendarEvent, CalendarTask, Goal } from '../../types/goals';

const mockOpenGoalMenu = jest.fn();
let mockDropConfig: { drop?: (item: { id: string }) => void } | undefined;

jest.mock('../../shared/utils/api', () => ({
    getTaskEvents: jest.fn(() => Promise.reject(new Error('per-task fetch should not run'))),
}));

jest.mock('../../shared/contexts/GoalMenuContext', () => ({
    useGoalMenu: () => ({ openGoalMenu: mockOpenGoalMenu }),
}));

jest.mock('react-dnd', () => ({
    useDrop: (config: { drop?: (item: { id: string }) => void }) => {
        mockDropConfig = config;
        return [{}, () => undefined];
    },
    useDrag: () => [{}, () => undefined, () => undefined],
    DndProvider: ({ children }: { children: React.ReactNode }) => children,
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

function task(partial: Partial<CalendarTask> & { goal?: Partial<Goal> }): CalendarTask {
    return {
        id: partial.id || '1',
        title: partial.title || 'Task',
        type: partial.type || 'task',
        eventCount: partial.eventCount,
        completedEventCount: partial.completedEventCount,
        pastUncompletedCount: partial.pastUncompletedCount,
        futureUncompletedCount: partial.futureUncompletedCount,
        nextEventDate: partial.nextEventDate,
        goal: {
            id: Number(partial.id || 1),
            name: partial.title || 'Task',
            goal_type: 'task',
            ...partial.goal,
        },
    };
}

test('sorts mixed tasks and opens them from click and context menu', () => {
    const onTasksChanged = jest.fn();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);

    render(
        <MemoryRouter>
            <DndProvider backend={HTML5Backend}>
                <TaskList
                    tasks={[
                        task({ id: '1', title: 'Zebra', eventCount: 0, goal: { priority: 'low' } }),
                        task({
                            id: '2',
                            title: 'Alpha',
                            eventCount: 3,
                            completedEventCount: 1,
                            futureUncompletedCount: 1,
                            goal: { priority: 'high', resolution_status: 'completed', duration: 1440 },
                        }),
                        task({
                            id: '3',
                            title: 'Overdue',
                            eventCount: 2,
                            completedEventCount: 0,
                            goal: { priority: 'medium', end_timestamp: yesterday },
                        }),
                        task({
                            id: '4',
                            title: 'Later',
                            eventCount: 1,
                            goal: { priority: 'high', start_timestamp: tomorrow },
                        }),
                        task({ id: '5', title: 'beta', eventCount: 1, goal: { priority: 'high' } }),
                    ]}
                    events={[]}
                    onAddTask={() => undefined}
                    onTaskUpdate={() => undefined}
                    onTasksChanged={onTasksChanged}
                />
            </DndProvider>
        </MemoryRouter>
    );

    fireEvent.click(screen.getByText('Overdue'));
    expect(mockOpenGoalMenu).toHaveBeenCalledWith(expect.objectContaining({ name: 'Overdue' }), 'view', expect.any(Function));
    const success = mockOpenGoalMenu.mock.calls[0][2];
    success();
    expect(onTasksChanged).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText('Alpha'));
    expect(mockOpenGoalMenu).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alpha' }), 'edit', expect.any(Function));
});

test('switches tabs, searches, and unschedules a dropped event', () => {
    const onAddTask = jest.fn();
    const onTaskUpdate = jest.fn();
    const onToggleSuggestions = jest.fn();
    const onNavigateDate = jest.fn();
    const ref = createRef<HTMLDivElement>();
    const forwarded = jest.fn();
    const when = new Date('2026-10-13T15:00:00Z');
    const event: CalendarEvent = {
        id: 'event-9',
        title: 'Review',
        start: when,
        end: new Date(when.getTime() + 3600000),
        type: 'event',
        goal: { id: 9, name: 'Review', goal_type: 'event', scheduled_timestamp: when },
    };
    const sampleGoal = { id: 8, name: 'Sample', goal_type: 'task' as const };

    const { rerender } = render(
        <MemoryRouter>
            <TaskList
                ref={forwarded}
                tasks={[task({ id: '8', title: 'Sample', eventCount: 1, goal: sampleGoal })]}
                events={[event]}
                onAddTask={onAddTask}
                onTaskUpdate={onTaskUpdate}
                onToggleSuggestions={onToggleSuggestions}
                onNavigateDate={onNavigateDate}
                overlapSuggestions={[{
                    dateKey: '2026-10-13',
                    date: when,
                    count: 2,
                    samples: [{ a: event, b: { ...event, id: 'event-10', title: 'Other', goal: sampleGoal } }],
                }]}
            />
        </MemoryRouter>
    );

    expect(forwarded).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onAddTask).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Suggestions' }));
    expect(onToggleSuggestions).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText(/overlap/));
    expect(onNavigateDate).toHaveBeenCalledWith(when);

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(onToggleSuggestions).toHaveBeenCalledWith(false);

    mockDropConfig?.drop?.({ id: 'missing' });
    mockDropConfig?.drop?.({ id: 'event-9' });
    expect(onTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
        events: [],
        tasks: expect.arrayContaining([expect.objectContaining({ title: 'Review' })]),
    }));

    rerender(
        <MemoryRouter>
            <TaskList
                ref={ref}
                tasks={[]}
                events={[]}
                onAddTask={onAddTask}
                onTaskUpdate={onTaskUpdate}
                overlapSuggestions={[]}
            />
        </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Suggestions' }));
    expect(screen.getByText('No overlaps today or upcoming')).toBeInTheDocument();
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
});
