import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NetworkPreview from './NetworkPreview';

describe('NetworkPreview', () => {
    test('renders network preview', () => {
        render(<NetworkPreview />);
        expect(screen.getByText(/Project Alpha/i)).toBeInTheDocument();
    });
});

