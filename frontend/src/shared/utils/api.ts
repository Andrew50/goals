
// Autofill API
export interface GoalContext {
    name?: string;
    description?: string;
    goal_type?: string;
    start_timestamp?: number;
    scheduled_timestamp?: number;
}

export interface AutofillRequest {
    field_name: string;
    current_value?: string;
    goal_context: GoalContext;
    parent_ids?: number[];
    child_ids?: number[];
}

export interface AutofillResponse {
    suggestions: string[];
}

export const getAutofillSuggestions = async (request: AutofillRequest): Promise<AutofillResponse> => {
    return privateRequest<AutofillResponse>('goals/autofill', 'POST', request);
};
