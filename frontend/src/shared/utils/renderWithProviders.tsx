import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { GoalMenuProvider } from '../contexts/GoalMenuContext';
import { AuthProvider } from '../contexts/AuthContext';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
    initialEntries?: MemoryRouterProps['initialEntries'];
    initialIndex?: MemoryRouterProps['initialIndex'];
    withDnd?: boolean;
    withGoalMenu?: boolean;
    withAuth?: boolean;
}

/**
 * Renders a React component with common providers (Router, Dnd, Contexts).
 * Use this helper to avoid duplicating provider setup across tests.
 *
 * @example
 * ```tsx
 * const { getByText } = renderWithProviders(<MyComponent />, {
 *   initialEntries: ['/my-route'],
 *   withDnd: true,
 *   withGoalMenu: true
 * });
 * ```
 */
export function renderWithProviders(
    ui: ReactElement,
    {
        initialEntries = ['/'],
        initialIndex,
        withDnd = false,
        withGoalMenu = false,
        withAuth = false,
        ...renderOptions
    }: RenderWithProvidersOptions = {}
) {
    function Wrapper({ children }: { children: React.ReactNode }) {
        let content = children;

        if (withAuth) {
            content = <AuthProvider>{content}</AuthProvider>;
        }

        if (withGoalMenu) {
            content = <GoalMenuProvider>{content}</GoalMenuProvider>;
        }

        if (withDnd) {
            content = (
                <DndProvider backend={HTML5Backend}>
                    {content}
                </DndProvider>
            );
        }

        return (
            <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
                {content}
            </MemoryRouter>
        );
    }

    return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Helper to wrap a test function with timezone mocking.
 * Ensures timezone is always restored after the test.
 *
 * @example
 * ```tsx
 * test('my test', () => {
 *   withMockTimezone(300, () => {
 *     // Test code here with EST timezone
 *   });
 * });
 * ```
 */
export function withMockTimezone(
    offsetMinutes: number,
    fn: () => void | Promise<void>
): void {
    const { mockTimezone } = require('./testUtils');
    const restore = mockTimezone(offsetMinutes);
    try {
        const result = fn();
        if (result instanceof Promise) {
            result.finally(() => restore());
        } else {
            restore();
        }
    } catch (error) {
        restore();
        throw error;
    }
}




