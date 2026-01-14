
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

// Goal relations API
export interface GoalRelationsResponse {
    parents: Goal[];
    children: Goal[];
}

export const getGoalRelations = async (goalId: number): Promise<GoalRelationsResponse> => {
    const response = await privateRequest<{ parents: ApiGoal[]; children: ApiGoal[] }>(`goals/${goalId}/relations`, 'GET');
    return {
        parents: response.parents.map(processGoalFromAPI),
        children: response.children.map(processGoalFromAPI),
    };
};

// Goal subgraph API (for MiniNetworkGraph)
export interface GoalSubgraphResponse {
    nodes: ApiGoal[];
    edges: Array<{
        from: number;
        to: number;
        relationship_type: string;
    }>;
    truncated: boolean;
}

export const getGoalSubgraph = async (goalId: number): Promise<{
    nodes: Goal[];
    edges: Array<{
        from: number;
        to: number;
        relationship_type: string;
    }>;
    truncated: boolean;
}> => {
    const response = await privateRequest<GoalSubgraphResponse>(`goals/${goalId}/subgraph`, 'GET');
    return {
        nodes: response.nodes.map(processGoalFromAPI),
        edges: response.edges,
        truncated: response.truncated,
    };
};
