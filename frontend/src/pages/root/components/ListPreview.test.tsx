import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ListPreview from './ListPreview';

describe('ListPreview', () => {
    test('renders list preview', () => {
        render(<ListPreview />);
        expect(screen.getByText(/Finish weekly plan/i)).toBeInTheDocument();
    });
});

