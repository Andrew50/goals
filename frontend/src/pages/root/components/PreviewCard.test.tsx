import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '../../../shared/utils/renderWithProviders';
import PreviewCard from './PreviewCard';

describe('PreviewCard', () => {
    test('renders preview card with title and subtitle', () => {
        renderWithProviders(
            <PreviewCard title="Test Title" subtitle="Test Subtitle" to="/test">
                <div>Test Content</div>
            </PreviewCard>
        );

        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Subtitle')).toBeInTheDocument();
    });
});

