import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import CompletionBar from './CompletionBar';

describe('CompletionBar', () => {
    test('renders completion bar with correct width', () => {
        const { container } = render(
            <CompletionBar value={0.5} hasTasks={true} width={100} height={10} />
        );

        const innerBar = container.querySelector('span > span > span') as HTMLElement;
        expect(innerBar?.style.width).toBe('50px');
    });

    test('renders transparent when no tasks', () => {
        const { container } = render(
            <CompletionBar value={0.5} hasTasks={false} />
        );

        const innerBar = container.querySelector('span > span > span') as HTMLElement;
        expect(innerBar?.style.width).toBe('0px');
        expect(innerBar?.style.backgroundColor).toBe('transparent');
    });

    test('shows minimum width for zero value with tasks', () => {
        const { container } = render(
            <CompletionBar value={0} hasTasks={true} minNonZeroWidth={4} />
        );

        const innerBar = container.querySelector('span > span > span') as HTMLElement;
        expect(innerBar?.style.width).toBe('4px');
    });

    test('clamps value to 0-1 range', () => {
        const { container: container1 } = render(
            <CompletionBar value={-0.5} hasTasks={true} width={100} />
        );
        const innerBar1 = container1.querySelector('span > span > span') as HTMLElement;
        expect(innerBar1?.style.width).toBe('4px'); // minNonZeroWidth

        const { container: container2 } = render(
            <CompletionBar value={1.5} hasTasks={true} width={100} />
        );
        const innerBar2 = container2.querySelector('span > span > span') as HTMLElement;
        expect(innerBar2?.style.width).toBe('100px');
    });

    test('applies custom className and style', () => {
        const { container } = render(
            <CompletionBar
                value={0.5}
                hasTasks={true}
                className="custom-class"
                style={{ margin: '10px' }}
            />
        );

        const outerSpan = container.querySelector('span.custom-class') as HTMLElement;
        expect(outerSpan?.style.margin).toBe('10px');
    });
});

