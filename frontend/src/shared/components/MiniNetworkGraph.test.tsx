import React from 'react';
import { waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import MiniNetworkGraph from './MiniNetworkGraph';
import { privateRequest } from '../utils/api';

jest.mock('../utils/api', () => ({
    privateRequest: jest.fn(),
}));

jest.mock('../../pages/network/buildHierarchy', () => ({
    buildHierarchy: jest.fn().mockResolvedValue({
        nodes: [],
        edges: [],
    }),
}));

describe('MiniNetworkGraph', () => {
    beforeEach(() => {
        (privateRequest as jest.Mock).mockResolvedValue({
            nodes: [],
            edges: [],
        });
    });

    test('renders mini network graph container', () => {
        renderWithProviders(<MiniNetworkGraph centerId={1} />, {
            withGoalMenu: true,
        });

        // Component should render without crashing
        expect(document.querySelector('div')).toBeInTheDocument();
    });

    test('handles empty network data', async () => {
        renderWithProviders(<MiniNetworkGraph centerId={1} />, {
            withGoalMenu: true,
        });

        await waitFor(() => {
            // Should not crash with empty data
            expect(document.querySelector('div')).toBeInTheDocument();
        });
    });

    test('handles missing centerId', () => {
        renderWithProviders(<MiniNetworkGraph />, {
            withGoalMenu: true,
        });

        // Should render without crashing
        expect(document.querySelector('div')).toBeInTheDocument();
    });
});

