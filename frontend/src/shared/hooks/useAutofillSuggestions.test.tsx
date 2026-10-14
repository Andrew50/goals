import { renderHook, act } from '@testing-library/react';
import { useAutofillSuggestions } from './useAutofillSuggestions';

describe('useAutofillSuggestions', () => {
    test('does not call the network when autofill is disabled', async () => {
        const onApply = jest.fn();
        const { result } = renderHook(() => useAutofillSuggestions({
            fieldName: 'name',
            getContext: () => ({ name: 'Draft' }),
            onApply,
        }));

        await act(async () => {
            await result.current.fetchSuggestions('Dra');
        });

        expect(result.current.suggestions).toEqual([]);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    test('applies a suggestion and clears the list', () => {
        const onApply = jest.fn();
        const { result } = renderHook(() => useAutofillSuggestions({
            fieldName: 'name',
            getContext: () => ({}),
            onApply,
        }));

        act(() => {
            result.current.applySuggestion('Ship it');
        });

        expect(onApply).toHaveBeenCalledWith('Ship it');
        expect(result.current.suggestions).toEqual([]);
    });

    test('clears suggestions and ignores enter when none are available', () => {
        const { result } = renderHook(() => useAutofillSuggestions({
            fieldName: 'name',
            getContext: () => ({}),
        }));

        const event = {
            key: 'Enter',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };

        act(() => {
            result.current.clearSuggestions();
            result.current.applySuggestion('unused');
            result.current.handleKeyDown(event as any);
        });

        expect(event.preventDefault).not.toHaveBeenCalled();
    });
});
