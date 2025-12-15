import { showSnackbar } from './Toaster';
import { waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';

describe('Toaster', () => {
    beforeEach(() => {
        // Clean up any existing snackbars
        document.body.innerHTML = '';
    });

    test('shows snackbar with message', async () => {
        act(() => {
            showSnackbar({ message: 'Test message' });
        });
        
        // Wait for React to render
        await waitFor(() => {
            const alert = document.body.querySelector('[data-testid="alert-info"]') || 
                         document.body.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain('Test message');
        }, { timeout: 3000 });
    });

    test('shows snackbar with different severity', async () => {
        act(() => {
            showSnackbar({ message: 'Error message', severity: 'error' });
        });

        await waitFor(() => {
            const alert = document.body.querySelector('[data-testid="alert-error"]') ||
                         document.body.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain('Error message');
        }, { timeout: 3000 });
    });

    test('shows snackbar with action button', async () => {
        const onAction = jest.fn();
        act(() => {
            showSnackbar({
                message: 'Action message',
                actionLabel: 'Undo',
                onAction,
            });
        });

        await waitFor(() => {
            const button = document.body.querySelector('button');
            expect(button).toBeTruthy();
            if (button) {
                act(() => {
                    button.click();
                });
                expect(onAction).toHaveBeenCalled();
            }
        }, { timeout: 3000 });
    });
});

