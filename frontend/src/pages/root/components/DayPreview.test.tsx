import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DayPreview from './DayPreview';

describe('DayPreview', () => {
    test('renders day preview with tasks', () => {
        render(<DayPreview />);
        expect(screen.getByText(/To Do/i)).toBeInTheDocument();
    });
});

