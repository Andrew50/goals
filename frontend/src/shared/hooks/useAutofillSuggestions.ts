import { useState, useCallback, useRef } from 'react';
import { getAutofillSuggestions, AutofillRequest, AutofillResponse } from '../utils/api';

export interface UseAutofillSuggestionsOptions {
    fieldName: string;
    getContext: () => any;
    allowedValues?: string[];
    allowedGoals?: any[];
    onApply?: (value: string) => void;
}

export function useAutofillSuggestions(options: UseAutofillSuggestionsOptions) {
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchSuggestions = useCallback(async (currentValue?: string) => {
        const context = options.getContext();
        
        setIsLoading(true);
        setError(null);
        try {
            const request: AutofillRequest = {
                field_name: options.fieldName,
                current_value: currentValue,
                goal_context: {
                    name: context.name,
                    description: context.description,
                    goal_type: context.goal_type,
                    start_timestamp: context.start_timestamp instanceof Date ? context.start_timestamp.getTime() : (typeof context.start_timestamp === 'number' ? context.start_timestamp : undefined),
                    end_timestamp: context.end_timestamp instanceof Date ? context.end_timestamp.getTime() : (typeof context.end_timestamp === 'number' ? context.end_timestamp : undefined),
                    scheduled_timestamp: context.scheduled_timestamp instanceof Date ? context.scheduled_timestamp.getTime() : (typeof context.scheduled_timestamp === 'number' ? context.scheduled_timestamp : undefined),
                    duration: context.duration,
                    priority: context.priority,
                    resolution_status: context.resolution_status,
                    frequency: context.frequency,
                    routine_time: context.routine_time instanceof Date ? context.routine_time.getTime() : (typeof context.routine_time === 'number' ? context.routine_time : undefined),
                    routine_type: context.routine_type,
                },
                parent_ids: context.parent_ids,
                child_ids: context.child_ids,
                allowed_values: options.allowedValues,
                allowed_goals: options.allowedGoals?.map(g => ({ id: g.id, name: g.name, goal_type: g.goal_type })),
            };

            const response = await getAutofillSuggestions(request);
            setSuggestions(response.suggestions);
        } catch (err) {
            console.error(`Failed to fetch suggestions for ${options.fieldName}:`, err);
            setError('Failed to load suggestions');
        } finally {
            setIsLoading(false);
        }
    }, [options]);

    const clearSuggestions = useCallback(() => {
        setSuggestions([]);
    }, []);

    const applySuggestion = useCallback((value: string) => {
        if (options.onApply) {
            options.onApply(value);
        }
        // Clear suggestions after applying to avoid visual clutter
        clearSuggestions();
    }, [options, clearSuggestions]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && suggestions.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            applySuggestion(suggestions[0]);
        }
    }, [suggestions, applySuggestion]);

    return {
        suggestions,
        isLoading,
        error,
        fetchSuggestions,
        clearSuggestions,
        applySuggestion,
        handleKeyDown
    };
}

