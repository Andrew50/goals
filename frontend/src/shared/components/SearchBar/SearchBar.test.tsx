import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Goal } from '../../../types/goals';
import { SearchBar } from './SearchBar';

function goal(id: number, name: string, description = ''): Goal {
    return { id, name, description, goal_type: id === 3 ? 'event' : 'task' };
}

const items = [
    goal(1, 'Write tests', 'cover the api module'),
    goal(2, 'Ship backup', 'restore the dump'),
    goal(3, 'Ignore me', 'event noise'),
];

describe('SearchBar', () => {
    test('searches locally, falls back to other fields, and clears', async () => {
        const onResults = jest.fn();
        const onChange = jest.fn();
        render(
            <SearchBar
                items={items}
                onResults={onResults}
                onChange={onChange}
                debounceMs={0}
                placeholder="Find goals"
                excludeGoalTypes={['event']}
                showFilterToggle
                filterActive
                onFilterToggle={jest.fn()}
                size="sm"
            />
        );

        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Write' } });
        expect(onChange).toHaveBeenCalledWith('Write');
        await waitFor(() => {
            const ids = onResults.mock.calls.at(-1)?.[1];
            expect(ids).toEqual(expect.arrayContaining([1]));
        });

        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'dump' } });
        await waitFor(() => {
            const ids = onResults.mock.calls.at(-1)?.[1];
            expect(ids).toEqual([2]);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(onChange).toHaveBeenCalledWith('');
        expect(screen.getByRole('button', { name: 'Toggle filters' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('supports controlled, server, and legacy modes', async () => {
        const onResults = jest.fn();
        const onChange = jest.fn();
        const onFilterToggle = jest.fn();
        const controlled = render(
            <SearchBar
                items={items}
                value="ship"
                onChange={onChange}
                onResults={onResults}
                debounceMs={0}
                serverSearch
                size="lg"
                fullWidth={false}
                className="extra"
                showFilterToggle
                onFilterToggle={onFilterToggle}
            />
        );
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'other' } });
        expect(onChange).toHaveBeenCalledWith('other');
        expect(onResults).not.toHaveBeenCalled();
        controlled.unmount();

        render(
            <SearchBar
                items={items}
                defaultValue="Write"
                onResults={onResults}
                debounceMs={0}
                useLegacyListStyles
                showFilterToggle
                onFilterToggle={onFilterToggle}
                keys={['description']}
            />
        );
        await waitFor(() => expect(onResults).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Toggle filters' }));
        expect(onFilterToggle).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        await waitFor(() => {
            const last = onResults.mock.calls.at(-1);
            expect(last?.[1]).toEqual([]);
        });
    });
});
