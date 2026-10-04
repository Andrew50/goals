import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import AccountSettings from './AccountSettings';
import {
    getGCalSettings,
    getGoogleCalendars,
    getGoogleStatus,
    getNotificationSettings,
    getTelegramSettings,
    privateRequest,
    sendTelegramTest,
    unlinkGoogleAccount,
    updateGCalSettings,
    updateNotificationSettings,
    updateTelegramSettings,
} from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
    getGoogleStatus: jest.fn(),
    getGCalSettings: jest.fn(),
    getGoogleCalendars: jest.fn(),
    updateGCalSettings: jest.fn(),
    unlinkGoogleAccount: jest.fn(),
    refreshAccessToken: () => Promise.resolve(null),
    setAccessToken: jest.fn(),
    getAccessToken: () => null,
    onAccessTokenChange: () => () => {},
    getTelegramSettings: jest.fn(),
    updateTelegramSettings: jest.fn(),
    sendTelegramTest: jest.fn(),
    getNotificationSettings: jest.fn(),
    updateNotificationSettings: jest.fn(),
}));

const notificationSettings = {
    notifications_enabled: true,
    notify_via_telegram: true,
    notify_high_priority_events: true,
    notify_event_reminders: false,
    reminder_offsets_minutes: [15, 60, 1440],
};

describe('AccountSettings', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (url === 'account') {
                return Promise.resolve({
                    user_id: 1,
                    username: 'testuser',
                    display_name: 'Test User',
                    auth_methods: [],
                    is_email_verified: false,
                });
            }
            if (url === 'auth/google') {
                return Promise.resolve({ auth_url: 'https://accounts.example/auth', state: 'state-1' });
            }
            if (url === 'account/set-password') {
                return Promise.resolve({ token: 'next-token' });
            }
            return Promise.resolve({});
        });
        (getGoogleStatus as jest.Mock).mockResolvedValue({
            linked: true,
            email: 'ada@example.com',
            calendars_synced: 2,
        });
        (getGCalSettings as jest.Mock).mockResolvedValue({
            gcal_auto_sync_enabled: false,
            gcal_default_calendar_id: 'cal-1',
        });
        (getGoogleCalendars as jest.Mock).mockResolvedValue([
            { id: 'cal-1', summary: 'Personal', primary: true, access_role: 'owner' },
            { id: 'cal-2', summary: 'Work', access_role: 'writer' },
        ]);
        (getTelegramSettings as jest.Mock).mockResolvedValue({
            chat_id: '123',
            has_bot_token: true,
        });
        (getNotificationSettings as jest.Mock).mockResolvedValue(notificationSettings);
        (updateNotificationSettings as jest.Mock).mockResolvedValue(undefined);
        (updateTelegramSettings as jest.Mock).mockResolvedValue(undefined);
        (sendTelegramTest as jest.Mock).mockResolvedValue(undefined);
        (updateGCalSettings as jest.Mock).mockResolvedValue({
            gcal_auto_sync_enabled: true,
            gcal_default_calendar_id: 'cal-2',
        });
        (unlinkGoogleAccount as jest.Mock).mockResolvedValue(undefined);
        window.confirm = jest.fn(() => true);
    });

    test('renders account settings page', async () => {
        renderWithProviders(<AccountSettings />, {
            withAuth: true,
            withGoalMenu: true,
            withTheme: true,
        });

        await waitFor(() => {
            expect(screen.getByText(/settings/i)).toBeInTheDocument();
        });
        expect(await screen.findByText('Test User')).toBeInTheDocument();
    });

    test('updates password, notifications, calendar, telegram, and theme', async () => {
        renderWithProviders(<AccountSettings />, { withTheme: true });
        expect(await screen.findByText('Test User')).toBeInTheDocument();
        expect(screen.getByText('Configured')).toBeInTheDocument();
        expect(screen.getByText('1d')).toBeInTheDocument();
        expect(screen.getByText('1h')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /set password/i }));
        fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(privateRequest).toHaveBeenCalledWith(
            'account/set-password',
            'POST',
            { password: 'secret' }
        ));

        fireEvent.click(screen.getByRole('checkbox', { name: /event reminders/i }));
        await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText('Add (min)'), { target: { value: '90' } });
        fireEvent.click(screen.getByTestId('AddIcon').closest('button') as HTMLButtonElement);
        fireEvent.change(screen.getByLabelText('Add (min)'), { target: { value: '15' } });
        fireEvent.click(screen.getByTestId('AddIcon').closest('button') as HTMLButtonElement);
        fireEvent.change(screen.getByLabelText('Add (min)'), { target: { value: 'nope' } });
        fireEvent.click(screen.getByTestId('AddIcon').closest('button') as HTMLButtonElement);
        const chipDelete = screen.getByText('15m').parentElement?.querySelector('svg')?.closest('button')
            || screen.getByText('15m').closest('.MuiChip-root')?.querySelector('button');
        if (chipDelete) fireEvent.click(chipDelete);

        fireEvent.click(screen.getByRole('checkbox', { name: /auto-sync/i }));
        fireEvent.mouseDown(screen.getByLabelText('Default Calendar'));
        const work = await screen.findByText('Work');
        fireEvent.click(work);

        fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
        fireEvent.change(screen.getByLabelText('Telegram Chat ID'), { target: { value: '999' } });
        fireEvent.change(screen.getByLabelText('Telegram Bot Token'), { target: { value: 'token' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send Test' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
        await waitFor(() => expect(updateTelegramSettings).toHaveBeenCalled());
        expect(sendTelegramTest).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        (window.confirm as jest.Mock).mockReturnValueOnce(false);
        const unlink = screen.getByTitle('Unlink Google account');
        fireEvent.click(unlink);
        expect(unlinkGoogleAccount).not.toHaveBeenCalled();
        fireEvent.click(unlink);
        await waitFor(() => expect(unlinkGoogleAccount).toHaveBeenCalled());
    });

    test('shows load and save errors', async () => {
        (privateRequest as jest.Mock).mockImplementation((url: string) => {
            if (url === 'account') {
                return Promise.resolve({
                    user_id: 1,
                    username: 'testuser',
                    display_name: 'Test User',
                    auth_methods: [],
                    is_email_verified: false,
                });
            }
            if (url === 'auth/google') return Promise.reject(new Error('oauth'));
            if (url === 'account/set-password') return Promise.reject({ response: { data: { message: 'weak' } } });
            return Promise.resolve({});
        });
        (getGoogleStatus as jest.Mock).mockResolvedValue({ linked: false, email: null, calendars_synced: 0 });
        (getGCalSettings as jest.Mock).mockRejectedValue(new Error('gcal'));
        (getTelegramSettings as jest.Mock).mockRejectedValue(new Error('telegram'));
        (getNotificationSettings as jest.Mock).mockRejectedValue(new Error('notes'));

        renderWithProviders(<AccountSettings />, { withTheme: true });
        expect(await screen.findByText('Failed to load notification settings')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /set password/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: /set password/i }));
        fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('weak')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /link google/i }));
        expect(await screen.findByText('Failed to initiate Google linking')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
        expect(screen.getByText('Failed to load Telegram settings')).toBeInTheDocument();
    });
});
