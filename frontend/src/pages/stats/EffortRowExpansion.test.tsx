import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../shared/utils/renderWithProviders';
import EffortRowExpansion from './EffortRowExpansion';
import { privateRequest } from '../../shared/utils/api';

jest.mock('../../shared/utils/api', () => ({
    privateRequest: jest.fn(),
}));

describe('EffortRowExpansion', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockResolvedValue([]);
    });

    test('renders effort row expansion component', async () => {
        renderWithProviders(<EffortRowExpansion goalId={1} range="2023-01" />, {
            withGoalMenu: true,
        });

        // Component should render without crashing
        await waitFor(() => {
            expect(screen.getByText(/loading/i) || document.body.textContent).toBeTruthy();
        });
    });
});

