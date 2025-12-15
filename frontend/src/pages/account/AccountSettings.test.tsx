import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import AccountSettings from './AccountSettings';
import { privateRequest, getGoogleStatus, getGCalSettings } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
    getGoogleStatus: jest.fn(),
    getGCalSettings: jest.fn(),
    getGoogleCalendars: jest.fn(),
    updateGCalSettings: jest.fn(),
    unlinkGoogleAccount: jest.fn(),
}));

jest.mock('../../shared/hooks/usePushNotifications', () => ({
    usePushNotifications: () => ([
        {
            isSupported: false,
            isStandalone: false,
            permission: 'default',
            isSubscribed: false,
            isLoading: false,
            error: null,
        },
        {
            requestPermission: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            sendTestNotification: jest.fn(),
        }
    ]),
    useInstallPrompt: () => ({
        showPrompt: false,
        dismissPrompt: jest.fn(),
        resetPrompt: jest.fn(),
    }),
}));

describe('AccountSettings', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockResolvedValue({
            user_id: 1,
            username: 'testuser',
            auth_methods: [],
            is_email_verified: false,
        });
        (getGoogleStatus as jest.Mock).mockResolvedValue({ linked: false });
        (getGCalSettings as jest.Mock).mockResolvedValue({ sync_enabled: false });
    });

    test('renders account settings page', async () => {
        renderWithProviders(<AccountSettings />, {
            withAuth: true,
            withGoalMenu: true,
        });

        await waitFor(() => {
            expect(screen.getByText(/account/i)).toBeInTheDocument();
        });
    });
});

