import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import List from './List';
import { privateRequest } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
    deleteGoal: jest.fn(),
    duplicateGoal: jest.fn(),
    updateGoal: jest.fn(),
    resolveGoal: jest.fn(),
    deleteEvent: jest.fn(),
    updateEvent: jest.fn(),
}));

describe('List', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockResolvedValue([]);
    });

    test('renders list page', async () => {
        renderWithProviders(<List />, {
            withGoalMenu: true,
            initialEntries: ['/list'],
        });

        await waitFor(() => {
            // Look for search bar or table headers
            expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
        });
    });
});

